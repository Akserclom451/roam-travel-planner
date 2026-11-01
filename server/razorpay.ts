import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import Razorpay from "razorpay";

export interface StoredOrder {
  orderId: string;
  amount: number; // in minor units / subunits (e.g. cents, paise, or whole JPY)
  displayAmount: number; // in major units (e.g. 42 for €42)
  currency: string;
  receipt: string;
  status: "created" | "paid" | "failed";
  createdAt: number;
  paidAt?: number;
  paymentId?: string;
  notes?: Record<string, string | number>;
}

export const ZERO_DECIMAL_CURRENCIES = ["JPY", "ISK", "KRW", "VND", "CLP", "PYG"];

/**
 * Returns the minor subunit multiplier for Razorpay amounts.
 * Standard currencies (EUR, USD, INR) use 100 subunits per unit (cents/paise).
 * Zero-decimal currencies (JPY, ISK) use 1 unit.
 */
export function getSubunitMultiplier(currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase())) {
    return 1;
  }
  return 100;
}

/**
 * Converts a major unit amount (e.g. 42 EUR or 7400 JPY) to Razorpay minor subunits.
 */
export function toSubunits(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid payment amount: ${amount}`);
  }
  const multiplier = getSubunitMultiplier(currency);
  return Math.round(amount * multiplier);
}

/**
 * Resolves and sanitizes environment credentials for Razorpay Test Mode.
 * Strictly forbids production live keys (rzp_live_) for safety.
 * Handles single/combined formatting safely without leaking credential values.
 */
export function getRazorpayCredentials(overrides?: {
  keyId?: string;
  keySecret?: string;
  skipDotEnv?: boolean;
}): {
  keyId: string | null;
  keySecret: string | null;
  isConfigured: boolean;
  isTestMode: boolean;
  error?: string;
} {
  if (!overrides?.skipDotEnv) {
    try {
      process.loadEnvFile?.();
    } catch {
      // Non-fatal if .env does not exist
    }
  }

  let rawKeyId = (overrides?.keyId !== undefined ? overrides.keyId : process.env.RAZORPAY_KEY_ID || "")
    .replace(/^["']|["']$/g, "")
    .trim();
  let rawKeySecret = (overrides?.keySecret !== undefined ? overrides.keySecret : process.env.RAZORPAY_KEY_SECRET || "")
    .replace(/^["']|["']$/g, "")
    .trim();

  // Handle case where credentials were typed or pasted together with comma/whitespace
  if (rawKeySecret.includes(",") || rawKeySecret.includes(" ") || rawKeySecret.includes("\n")) {
    const parts = rawKeySecret.split(/[,:\s\n]+/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const foundTestKey = parts.find((p) => p.startsWith("rzp_test_"));
    const foundSecret = parts.find((p) => !p.startsWith("rzp_test_") && p.length >= 10);
    if (foundTestKey) rawKeyId = foundTestKey;
    if (foundSecret) rawKeySecret = foundSecret;
  }

  if (rawKeyId.includes(",") || rawKeyId.includes(" ") || rawKeyId.includes("\n")) {
    const parts = rawKeyId.split(/[,:\s\n]+/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const foundTestKey = parts.find((p) => p.startsWith("rzp_test_"));
    const foundSecret = parts.find((p) => !p.startsWith("rzp_test_") && p.length >= 10);
    if (foundTestKey) rawKeyId = foundTestKey;
    if (foundSecret && (!rawKeySecret || rawKeySecret.toLowerCase().includes("key_secret"))) {
      rawKeySecret = foundSecret;
    }
  }

  const isLiveKey = rawKeyId.startsWith("rzp_live_") || rawKeySecret.startsWith("rzp_live_");
  if (isLiveKey) {
    throw new Error(
      "Security Error: Production live keys (rzp_live_) are strictly prohibited in ROAM. Only Razorpay TEST MODE keys (starting with 'rzp_test_') are permitted in ROAM."
    );
  }

  const isPlaceholder =
    rawKeyId.toLowerCase().includes("placeholder") ||
    rawKeySecret.toLowerCase().includes("placeholder") ||
    rawKeyId.toLowerCase() === "key_id" ||
    rawKeySecret.toLowerCase() === "key_secret";

  if (!rawKeyId || !rawKeySecret || isPlaceholder) {
    return {
      keyId: null,
      keySecret: null,
      isConfigured: false,
      isTestMode: true,
      error: "Razorpay test credentials are not configured in environment.",
    };
  }

  if (!rawKeyId.startsWith("rzp_test_")) {
    return {
      keyId: null,
      keySecret: null,
      isConfigured: false,
      isTestMode: true,
      error: "Invalid Razorpay Key ID format. Sandbox Key ID must start with 'rzp_test_'.",
    };
  }

  return {
    keyId: rawKeyId,
    keySecret: rawKeySecret,
    isConfigured: true,
    isTestMode: true,
  };
}

/**
 * Authoritative activity catalog base prices in EUR.
 */
export const ACTIVITY_BASE_PRICES_EUR: Record<string, number> = {
  "kyoto-tea": 42,
  "kyoto-fushimi": 28,
  "kyoto-nishiki": 64,
  "kyoto-philosopher": 35,
  "kyoto-ryokan": 18,
  "lisbon-alfama": 32,
  "lisbon-sailing": 58,
  "lisbon-tram": 22,
  "lisbon-tile": 45,
  "lisbon-fado": 65,
  "reykjavik-lagoon": 85,
  "reykjavik-aurora": 75,
  "reykjavik-golden": 95,
  "reykjavik-whale": 80,
  "reykjavik-food": 68,
};

export interface OrderCalculationInput {
  amount?: number;
  currency: string;
  items?: Array<{ activityId: string; quantity: number }>;
}

/**
 * Validates and calculates order amounts server-side to prevent browser tampering.
 */
export function calculateServerOrderAmount(input: OrderCalculationInput): {
  amount: number;
  totalCostEur: number;
} {
  const { amount, currency, items } = input;
  const cleanCurrency = (currency || "").trim().toUpperCase();

  if (!cleanCurrency || !["EUR", "JPY", "ISK", "INR", "USD"].includes(cleanCurrency)) {
    throw new Error(`Unsupported or invalid currency: ${currency}`);
  }

  // If item breakdown is provided, calculate authoritative total from catalog
  if (Array.isArray(items) && items.length > 0) {
    let totalEur = 0;
    for (const item of items) {
      const basePrice = ACTIVITY_BASE_PRICES_EUR[item.activityId];
      if (typeof basePrice !== "number" || basePrice <= 0) {
        throw new Error(`Unknown activity ID: ${item.activityId}`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 50) {
        throw new Error(`Invalid item quantity for ${item.activityId}`);
      }
      totalEur += basePrice * item.quantity;
    }

    // In EUR currency, the server amount is strictly authoritatively computed
    if (cleanCurrency === "EUR") {
      return { amount: totalEur, totalCostEur: totalEur };
    }

    // For converted currencies, ensure client cannot tamper amount below reasonable conversion threshold
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      if (amount < totalEur * 0.5) {
        throw new Error("Client amount is inconsistent with authoritative itinerary total.");
      }
      return { amount: Math.round(amount), totalCostEur: totalEur };
    }

    return { amount: totalEur, totalCostEur: totalEur };
  }

  // If items not supplied, validate client amount strictly
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid payment amount. Amount must be a positive number.");
  }

  if (amount > 10_000_000) {
    throw new Error("Amount exceeds maximum permitted transaction limit.");
  }

  return { amount: Math.round(amount), totalCostEur: amount };
}

/**
 * Verifies Razorpay payment HMAC SHA-256 signature using timingSafeEqual to prevent timing attacks.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string
): boolean {
  if (!orderId || !paymentId || !signature || !keySecret) {
    return false;
  }

  const payload = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(payload)
    .digest("hex");

  try {
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const signatureBuffer = Buffer.from(signature, "utf8");

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

// In-memory server-authoritative store for tracking orders and preventing duplicate verifications
export const ordersStore = new Map<string, StoredOrder>();

export function createRazorpayRouter(): Router {
  const router = Router();

  /**
   * GET /api/razorpay/config
   * Provides public sandbox configuration to the frontend (never exposes secrets).
   */
  router.get("/config", (_req: Request, res: Response) => {
    try {
      const credentials = getRazorpayCredentials();
      res.json({
        isConfigured: credentials.isConfigured,
        keyId: credentials.keyId,
        isTestMode: true,
        supportedCurrencies: ["EUR", "JPY", "ISK", "INR", "USD"],
        error: credentials.error,
      });
    } catch (err) {
      res.status(400).json({
        isConfigured: false,
        keyId: null,
        isTestMode: true,
        supportedCurrencies: ["EUR", "JPY", "ISK", "INR", "USD"],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * POST /api/razorpay/create-order
   * Validates amount, currency, and creates a sandbox test order with Razorpay.
   */
  router.post("/create-order", async (req: Request, res: Response) => {
    try {
      const { amount, currency, receipt, notes, items } = req.body;

      const calculation = calculateServerOrderAmount({
        amount,
        currency,
        items,
      });

      const cleanCurrency = currency.trim().toUpperCase();
      const amountInSubunits = toSubunits(calculation.amount, cleanCurrency);
      const credentials = getRazorpayCredentials();

      if (!credentials.isConfigured || !credentials.keyId || !credentials.keySecret) {
        res.status(503).json({
          error: credentials.error || "Razorpay Test Mode credentials are not configured in the environment.",
          isConfigured: false,
          requiredEnvVars: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
          previewPayload: {
            amount: amountInSubunits,
            displayAmount: calculation.amount,
            currency: cleanCurrency,
            receipt: receipt || `roam_test_${Date.now()}`,
          },
        });
        return;
      }

      const razorpay = new Razorpay({
        key_id: credentials.keyId,
        key_secret: credentials.keySecret,
      });

      const orderReceipt = receipt || `roam_rcpt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // Create order with Razorpay test API
      const razorpayOrder = await razorpay.orders.create({
        amount: amountInSubunits,
        currency: cleanCurrency,
        receipt: orderReceipt,
        notes: {
          platform: "ROAM Travel Planner",
          environment: "TEST_MODE_SANDBOX",
          ...(notes || {}),
        },
      });

      // Save order in authoritative server memory store
      const storedOrder: StoredOrder = {
        orderId: razorpayOrder.id,
        amount: Number(razorpayOrder.amount),
        displayAmount: amount,
        currency: razorpayOrder.currency,
        receipt: orderReceipt,
        status: "created",
        createdAt: Date.now(),
        notes: notes || {},
      };
      ordersStore.set(razorpayOrder.id, storedOrder);

      res.status(201).json({
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        displayAmount: amount,
        currency: razorpayOrder.currency,
        keyId: credentials.keyId,
        isTestMode: true,
      });
    } catch (err: any) {
      console.error("[Razorpay create-order error]:", err);
      res.status(500).json({
        error: err?.error?.description || err?.message || "Failed to create Razorpay test order.",
      });
    }
  });

  /**
   * POST /api/razorpay/verify-payment
   * Verifies payment signature and prevents duplicate callbacks.
   */
  router.post("/verify-payment", (req: Request, res: Response) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        res.status(400).json({
          error: "Missing payment verification parameters (order_id, payment_id, or signature).",
          verified: false,
        });
        return;
      }

      const credentials = getRazorpayCredentials();
      if (!credentials.keySecret) {
        res.status(503).json({
          error: "Server missing Razorpay secret key for signature verification.",
          verified: false,
        });
        return;
      }

      // Check against stored order
      const storedOrder = ordersStore.get(razorpay_order_id);
      if (!storedOrder) {
        res.status(404).json({
          error: "Order ID not found in server records. Cannot verify uninitiated order.",
          verified: false,
        });
        return;
      }

      // Handle duplicate verification attempts safely
      if (storedOrder.status === "paid") {
        res.status(200).json({
          verified: true,
          duplicate: true,
          paymentId: storedOrder.paymentId,
          orderId: storedOrder.orderId,
          amount: storedOrder.displayAmount,
          currency: storedOrder.currency,
          isTestMode: true,
          message: "Payment previously verified in test mode.",
          disclaimer:
            "Processed in Razorpay Sandbox Test Mode. ROAM does not have live supplier booking integration; no activity booking or supplier reservation has been confirmed.",
        });
        return;
      }

      // Verify HMAC SHA-256 signature
      const isSignatureValid = verifyRazorpaySignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        credentials.keySecret
      );

      if (!isSignatureValid) {
        storedOrder.status = "failed";
        res.status(400).json({
          error: "Invalid payment signature. Verification failed.",
          verified: false,
        });
        return;
      }

      // Update stored order state
      storedOrder.status = "paid";
      storedOrder.paidAt = Date.now();
      storedOrder.paymentId = razorpay_payment_id;

      res.status(200).json({
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: storedOrder.displayAmount,
        currency: storedOrder.currency,
        isTestMode: true,
        message: "Payment signature verified in test mode.",
        disclaimer:
          "Processed in Razorpay Sandbox Test Mode. ROAM does not have live supplier booking integration; no activity booking or supplier reservation has been confirmed.",
      });
    } catch (err) {
      console.error("[Razorpay verify-payment error]:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Error verifying payment signature.",
        verified: false,
      });
    }
  });

  /**
   * POST /api/razorpay/record-failure
   * Safely logs cancelled or declined payment attempts for auditability.
   */
  router.post("/record-failure", (req: Request, res: Response) => {
    const { orderId, reason } = req.body;
    if (orderId && ordersStore.has(orderId)) {
      const order = ordersStore.get(orderId)!;
      if (order.status !== "paid") {
        order.status = "failed";
      }
    }
    res.json({ recorded: true, reason: reason || "Payment cancelled or declined" });
  });

  return router;
}
