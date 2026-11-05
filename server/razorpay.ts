import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Router, type Request, type Response } from "express";
import Razorpay from "razorpay";

export type OrderStatus = "created" | "paid" | "failed" | "cancelled";

export interface StoredOrder {
  orderId: string;
  amount: number; // in minor units / subunits (e.g. cents or whole JPY/ISK)
  displayAmount: number; // in major units (e.g. 42 for €42)
  currency: string;
  receipt: string;
  status: OrderStatus;
  createdAt: number;
  paidAt?: number;
  paymentId?: string;
  cancelledAt?: number;
  failedAt?: number;
  failureReason?: string;
  items?: Array<{ activityId: string; quantity: number }>;
  notes?: Record<string, string | number>;
}

export const SUPPORTED_PAYMENT_CURRENCIES = ["EUR", "JPY", "ISK", "INR"] as const;
export type SupportedPaymentCurrency = (typeof SUPPORTED_PAYMENT_CURRENCIES)[number];

export const ZERO_DECIMAL_CURRENCIES = ["JPY", "ISK"];

/**
 * Authoritative activity catalog base prices in EUR.
 * Synchronized with client itinerary catalog across all destinations.
 */
export const ACTIVITY_BASE_PRICES_EUR: Record<string, number> = {
  // Kyoto
  "kyoto-tea": 42,
  "kyoto-fushimi": 28,
  "kyoto-nishiki": 64,
  "kyoto-philosopher": 35,
  "kyoto-ryokan": 18,
  // Lisbon
  "lisbon-alfama": 38,
  "lisbon-tram": 24,
  "lisbon-surf": 72,
  "lisbon-tasca": 68,
  "lisbon-tile": 46,
  // Reykjavik
  "reykjavik-lagoon": 86,
  "reykjavik-food": 94,
  "reykjavik-coast": 58,
  "reykjavik-northern": 79,
  "reykjavik-design": 32,
  // Jaipur
  "jaipur-amber": 30,
  "jaipur-blockprint": 25,
  "jaipur-bazaar": 18,
  "jaipur-hawa": 14,
  "jaipur-observatory": 20,
};

/**
 * Returns the minor subunit multiplier for Razorpay amounts.
 * Standard currencies (EUR) use 100 subunits per unit (cents).
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

const serverNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/**
 * Formats display amount matching ROAM currency guidelines.
 * JPY: "¥7,398", EUR: "€42", ISK: "kr 11,742"
 */
export function formatServerCurrency(amount: number, currency: string): string {
  const cleanCurrency = (currency || "").trim().toUpperCase();
  const rounded = Math.round(amount);
  const isNegative = rounded < 0;
  const formattedAbs = serverNumberFormatter.format(Math.abs(rounded));
  const prefix = isNegative ? "-" : "";

  if (cleanCurrency === "JPY") {
    return `${prefix}¥${formattedAbs}`;
  }
  if (cleanCurrency === "EUR") {
    return `${prefix}€${formattedAbs}`;
  }
  if (cleanCurrency === "ISK") {
    return `${prefix}kr ${formattedAbs}`;
  }
  if (cleanCurrency === "INR") {
    return `${prefix}₹${formattedAbs}`;
  }
  return `${prefix}${cleanCurrency} ${formattedAbs}`;
}

// ---------------------------------------------------------------------------
// Server Exchange Rates (European Central Bank Reference via Frankfurter)
// ---------------------------------------------------------------------------

interface ServerRatesCache {
  rates: Record<SupportedPaymentCurrency, number>;
  date: string;
  fetchedAt: number;
}

let serverRatesCache: ServerRatesCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Allows test suites to inject deterministic exchange rates.
 */
export function setMockExchangeRates(
  rates: Partial<Record<SupportedPaymentCurrency, number>>,
  date = "2026-10-31"
): void {
  serverRatesCache = {
    rates: {
      EUR: 1,
      JPY: rates.JPY ?? 176.19,
      ISK: rates.ISK ?? 136.03,
      INR: rates.INR ?? 105.92,
    },
    date,
    fetchedAt: Date.now(),
  };
}

export function resetExchangeRatesCache(): void {
  serverRatesCache = null;
}

/**
 * Fetches authoritative reference exchange rates from the European Central Bank via Frankfurter.
 * Strictly adheres to ROAM's conversion policy: EUR is always 1.0; JPY and ISK require official rates.
 */
export async function fetchServerExchangeRates(timeoutMs = 6000): Promise<{
  rates: Record<SupportedPaymentCurrency, number>;
  date: string;
}> {
  if (serverRatesCache && Date.now() - serverRatesCache.fetchedAt < CACHE_TTL_MS) {
    return { rates: serverRatesCache.rates, date: serverRatesCache.date };
  }

  const v2Url = "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=JPY,ISK,INR";
  const v1Url = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY,ISK,INR";

  let fetchedData: any = null;

  // Try v2 endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(v2Url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.ok) {
        fetchedData = await res.json();
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Proceed to fallback
  }

  // Fallback to v1 endpoint
  if (!fetchedData) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resFallback = await fetch(v1Url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (resFallback.ok) {
        fetchedData = await resFallback.json();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (Array.isArray(fetchedData)) {
    const rates: Record<SupportedPaymentCurrency, number> = { EUR: 1, JPY: 0, ISK: 0, INR: 0 };
    let dateStr = "";
    for (const item of fetchedData) {
      if (item && typeof item === "object") {
        if (item.quote === "JPY" && typeof item.rate === "number" && item.rate > 0) rates.JPY = item.rate;
        if (item.quote === "ISK" && typeof item.rate === "number" && item.rate > 0) rates.ISK = item.rate;
        if (item.quote === "INR" && typeof item.rate === "number" && item.rate > 0) rates.INR = item.rate;
        if (item.date && !dateStr) dateStr = item.date;
      }
    }
    if (rates.JPY > 0 && rates.ISK > 0 && rates.INR > 0 && dateStr) {
      serverRatesCache = { rates, date: dateStr, fetchedAt: Date.now() };
      return { rates, date: dateStr };
    }
  } else if (fetchedData && typeof fetchedData === "object" && fetchedData.rates) {
    const jpy = Number(fetchedData.rates.JPY);
    const isk = Number(fetchedData.rates.ISK);
    const inr = Number(fetchedData.rates.INR);
    if (jpy > 0 && isk > 0 && inr > 0 && fetchedData.date) {
      const rates: Record<SupportedPaymentCurrency, number> = { EUR: 1, JPY: jpy, ISK: isk, INR: inr };
      serverRatesCache = { rates, date: fetchedData.date, fetchedAt: Date.now() };
      return { rates, date: fetchedData.date };
    }
  }

  // If previous cache exists even if expired, use as last-resort fallback
  if (serverRatesCache) {
    return { rates: serverRatesCache.rates, date: serverRatesCache.date };
  }

  throw new Error(
    "Currency conversion unavailable: European Central Bank exchange rates are temporarily unreachable. Payment cannot proceed without authoritative rate verification."
  );
}

// ---------------------------------------------------------------------------
// Authoritative Order Calculation
// ---------------------------------------------------------------------------

export interface OrderCalculationInput {
  amount?: number;
  currency: string;
  items?: Array<{ activityId: string; quantity: number }>;
}

export interface AuthoritativeOrderCalculation {
  amount: number; // in major units (authoritative calculated total)
  amountInSubunits: number; // in minor subunits for Razorpay
  totalCostEur: number;
  effectiveRate: number;
  currency: SupportedPaymentCurrency;
}

/**
 * Validates and authoritatively calculates order amounts server-side.
 * The browser never determines the authoritative price.
 */
export async function calculateServerOrderAmount(
  input: OrderCalculationInput,
  ratesOverride?: Record<string, number>
): Promise<AuthoritativeOrderCalculation> {
  const { amount, currency, items } = input;
  const cleanCurrency = (currency || "").trim().toUpperCase() as SupportedPaymentCurrency;

  if (!cleanCurrency || !SUPPORTED_PAYMENT_CURRENCIES.includes(cleanCurrency)) {
    throw new Error(
      `Unsupported or invalid currency: '${currency}'. ROAM strictly supports EUR, JPY, ISK, and INR.`
    );
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Cannot calculate order amount: itinerary items array is required and must not be empty.");
  }

  // Obtain authoritative conversion rate
  let effectiveRate = 1;
  if (cleanCurrency === "EUR") {
    effectiveRate = 1;
  } else if (ratesOverride && typeof ratesOverride[cleanCurrency] === "number" && ratesOverride[cleanCurrency] > 0) {
    effectiveRate = ratesOverride[cleanCurrency];
  } else {
    try {
      const ratesData = await fetchServerExchangeRates();
      effectiveRate = ratesData.rates[cleanCurrency];
      if (!effectiveRate || effectiveRate <= 0) {
        throw new Error(`Rate missing for ${cleanCurrency}`);
      }
    } catch (err) {
      throw new Error(
        `Currency conversion unavailable: European Central Bank exchange rates for ${cleanCurrency} are temporarily unreachable. Payment cannot proceed without authoritative rate verification.`
      );
    }
  }

  let totalCostEur = 0;
  let authoritativeTotal = 0;

  for (const item of items) {
    const basePriceEur = ACTIVITY_BASE_PRICES_EUR[item.activityId];
    if (typeof basePriceEur !== "number" || basePriceEur <= 0) {
      throw new Error(`Unknown activity ID: ${item.activityId}`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 50) {
      throw new Error(`Invalid item quantity for ${item.activityId}: must be an integer between 1 and 50.`);
    }

    totalCostEur += basePriceEur * item.quantity;

    if (cleanCurrency === "EUR") {
      authoritativeTotal += basePriceEur * item.quantity;
    } else {
      // ROAM rounding policy: unit price is rounded, line total = unitPrice * quantity
      const unitPrice = Math.round(basePriceEur * effectiveRate);
      authoritativeTotal += unitPrice * item.quantity;
    }
  }

  // Option A (Backend Single Source of Truth):
  // The server calculation is authoritative from validated itinerary items.
  // Client-supplied amounts are ignored for authorization and will not cause rejection.

  const amountInSubunits = toSubunits(authoritativeTotal, cleanCurrency);

  return {
    amount: authoritativeTotal,
    amountInSubunits,
    totalCostEur,
    effectiveRate,
    currency: cleanCurrency,
  };
}

// ---------------------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Order Storage & Safe File Persistence (Issue 3)
// ---------------------------------------------------------------------------

export const ordersStore = new Map<string, StoredOrder>();

let orderStorageFilePath = path.resolve(process.cwd(), "data", "orders.json");

export function setOrderStoragePath(customPath: string): void {
  orderStorageFilePath = customPath;
  loadOrdersFromDisk();
}

export function loadOrdersFromDisk(): void {
  ordersStore.clear();
  try {
    if (fs.existsSync(orderStorageFilePath)) {
      const content = fs.readFileSync(orderStorageFilePath, "utf8");
      const records = JSON.parse(content);
      if (Array.isArray(records)) {
        for (const order of records) {
          if (order && typeof order.orderId === "string") {
            ordersStore.set(order.orderId, order);
          }
        }
      }
    }
  } catch (err) {
    console.error("[OrderStorage] Error loading orders from disk:", err);
  }
}

export function persistOrdersToDisk(): void {
  try {
    const dir = path.dirname(orderStorageFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${orderStorageFilePath}.tmp.${Date.now()}`;
    const serialized = JSON.stringify(Array.from(ordersStore.values()), null, 2);
    fs.writeFileSync(tempPath, serialized, "utf8");
    fs.renameSync(tempPath, orderStorageFilePath);
  } catch (err) {
    console.error("[OrderStorage] Error persisting orders to disk:", err);
  }
}

export function getStoredOrder(orderId: string): StoredOrder | undefined {
  return ordersStore.get(orderId);
}

export function saveStoredOrder(order: StoredOrder): void {
  ordersStore.set(order.orderId, order);
  persistOrdersToDisk();
}

export function clearOrderStorage(): void {
  ordersStore.clear();
  try {
    if (fs.existsSync(orderStorageFilePath)) {
      fs.unlinkSync(orderStorageFilePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Initialize on module load
loadOrdersFromDisk();

// ---------------------------------------------------------------------------
// Credentials Resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Express Router
// ---------------------------------------------------------------------------

export function createRazorpayRouter(options?: {
  razorpayClientOverride?: any;
}): Router {
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
        supportedCurrencies: SUPPORTED_PAYMENT_CURRENCIES,
        error: credentials.error,
      });
    } catch (err) {
      res.status(400).json({
        isConfigured: false,
        keyId: null,
        isTestMode: true,
        supportedCurrencies: SUPPORTED_PAYMENT_CURRENCIES,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * POST /api/razorpay/calculate-amount
   * Option A: Backend Single Source of Truth
   * Calculates the authoritative itinerary total and returns:
   * - exact integer amount in minor units
   * - currency code
   * - properly formatted display amount
   */
  router.post("/calculate-amount", async (req: Request, res: Response) => {
    try {
      const { items, currency } = req.body;

      const calculation = await calculateServerOrderAmount({
        items,
        currency,
      });

      const formattedAmount = formatServerCurrency(calculation.amount, calculation.currency);

      res.status(200).json({
        amount: calculation.amount,
        amountInSubunits: calculation.amountInSubunits,
        currency: calculation.currency,
        formattedAmount,
        totalCostEur: calculation.totalCostEur,
      });
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || "Failed to calculate authoritative order amount.",
      });
    }
  });

  /**
   * POST /api/razorpay/create-order
   * Validates items, currency, and creates an authoritative sandbox test order.
   * Client-supplied amount is ignored; server calculation is authoritative.
   */
  router.post("/create-order", async (req: Request, res: Response) => {
    try {
      const { amount, currency, receipt, notes, items } = req.body;

      // Authoritative server calculation (client amount is ignored)
      const calculation = await calculateServerOrderAmount({
        amount,
        currency,
        items,
      });

      const cleanCurrency = calculation.currency;
      const amountInSubunits = calculation.amountInSubunits;
      const formattedAmount = formatServerCurrency(calculation.amount, cleanCurrency);
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
            formattedAmount,
            receipt: receipt || `roam_test_${Date.now()}`,
          },
        });
        return;
      }

      const razorpay =
        options?.razorpayClientOverride ||
        new Razorpay({
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

      // Save order in authoritative persistence store
      const storedOrder: StoredOrder = {
        orderId: razorpayOrder.id,
        amount: Number(razorpayOrder.amount),
        displayAmount: calculation.amount,
        currency: razorpayOrder.currency,
        receipt: orderReceipt,
        status: "created",
        createdAt: Date.now(),
        items,
        notes: notes || {},
      };
      saveStoredOrder(storedOrder);

      res.status(201).json({
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        displayAmount: calculation.amount,
        currency: razorpayOrder.currency,
        formattedAmount,
        keyId: credentials.keyId,
        isTestMode: true,
      });
    } catch (err: any) {
      console.error("[Razorpay create-order error]:", err);
      res.status(400).json({
        error: err?.error?.description || err?.message || "Failed to create Razorpay test order.",
      });
    }
  });

  /**
   * POST /api/razorpay/verify-payment
   * - Validates incoming order ID, payment ID, and signature.
   * - Ensures already-paid orders cannot be hijacked or replaced (Issue 2).
   * - Independently fetches payment status, amount, and currency from Razorpay SDK (Issue 4).
   * - Never marks an order paid before successful end-to-end verification.
   */
  router.post("/verify-payment", async (req: Request, res: Response) => {
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
      if (!credentials.keySecret || !credentials.keyId) {
        res.status(503).json({
          error: "Server missing Razorpay secret key for signature verification.",
          verified: false,
        });
        return;
      }

      // Check stored order
      const storedOrder = getStoredOrder(razorpay_order_id);
      if (!storedOrder) {
        res.status(404).json({
          error: `Order ID '${razorpay_order_id}' not found in server records. Cannot verify uninitiated order.`,
          verified: false,
        });
        return;
      }

      // 1. Verify HMAC SHA-256 signature FIRST
      const isSignatureValid = verifyRazorpaySignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        credentials.keySecret
      );

      if (!isSignatureValid) {
        res.status(400).json({
          error: "Invalid payment signature. Verification failed.",
          verified: false,
        });
        return;
      }

      // 2. Handle duplicate verification attempts safely (Issue 2)
      if (storedOrder.status === "paid") {
        if (storedOrder.paymentId === razorpay_payment_id) {
          // Idempotent success response for the exact same previously verified payment
          res.status(200).json({
            verified: true,
            duplicate: true,
            paymentId: storedOrder.paymentId,
            orderId: storedOrder.orderId,
            amount: storedOrder.displayAmount,
            currency: storedOrder.currency,
            formattedAmount: formatServerCurrency(storedOrder.displayAmount, storedOrder.currency),
            notes: storedOrder.notes || {},
            leadTraveller: storedOrder.notes?.leadTraveller,
            contact: storedOrder.notes?.phone
              ? (storedOrder.notes?.email
                  ? `${storedOrder.notes.email} · ${storedOrder.notes.phone}`
                  : storedOrder.notes.phone)
              : undefined,
            isTestMode: true,
            message: "Payment previously verified in test mode.",
            disclaimer:
              "Processed in Razorpay Sandbox Test Mode. ROAM does not have live supplier booking integration; no activity booking or supplier reservation has been confirmed.",
          });

          return;
        }

        // Reject duplicate request attempting to associate a DIFFERENT payment ID
        res.status(409).json({
          error: `Payment conflict: Order '${razorpay_order_id}' was already verified and paid with payment ID '${storedOrder.paymentId}'. Cannot replace with payment ID '${razorpay_payment_id}'.`,
          verified: false,
        });
        return;
      }

      // 3. Independently verify payment status, amount, and currency with Razorpay API (Issue 4)
      const razorpay =
        options?.razorpayClientOverride ||
        new Razorpay({
          key_id: credentials.keyId,
          key_secret: credentials.keySecret,
        });

      let razorpayPayment: any;
      try {
        razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);
      } catch (apiErr: any) {
        console.error("[Razorpay payments.fetch error]:", apiErr);
        res.status(502).json({
          error: `Failed to confirm payment status with Razorpay API: ${
            apiErr?.error?.description || apiErr?.message || "Payment retrieval error."
          }`,
          verified: false,
        });
        return;
      }

      // Confirm payment belongs to expected Razorpay order
      if (razorpayPayment.order_id !== razorpay_order_id) {
        res.status(400).json({
          error: `Payment order mismatch: Razorpay payment is associated with order '${razorpayPayment.order_id}', expected '${razorpay_order_id}'.`,
          verified: false,
        });
        return;
      }

      // Confirm authorized amount matches server-created order amount in subunits
      if (Number(razorpayPayment.amount) !== storedOrder.amount) {
        res.status(400).json({
          error: `Payment amount mismatch: Razorpay authorized amount (${razorpayPayment.amount}) does not match order amount (${storedOrder.amount}).`,
          verified: false,
        });
        return;
      }

      // Confirm currency matches
      if (razorpayPayment.currency?.toUpperCase() !== storedOrder.currency.toUpperCase()) {
        res.status(400).json({
          error: `Payment currency mismatch: Razorpay payment currency (${razorpayPayment.currency}) does not match order currency (${storedOrder.currency}).`,
          verified: false,
        });
        return;
      }

      // Confirm payment status is captured or authorized
      const paymentStatus = (razorpayPayment.status || "").toLowerCase();
      if (paymentStatus !== "captured" && paymentStatus !== "authorized") {
        res.status(400).json({
          error: `Payment verification failed: Razorpay payment status is '${paymentStatus}'. Expected 'captured' or 'authorized'.`,
          verified: false,
        });
        return;
      }

      // 4. Update stored order state and persist
      storedOrder.status = "paid";
      storedOrder.paidAt = Date.now();
      storedOrder.paymentId = razorpay_payment_id;
      saveStoredOrder(storedOrder);

      res.status(200).json({
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: storedOrder.displayAmount,
        currency: storedOrder.currency,
        formattedAmount: formatServerCurrency(storedOrder.displayAmount, storedOrder.currency),
        notes: storedOrder.notes || {},
        leadTraveller: storedOrder.notes?.leadTraveller,
        contact: storedOrder.notes?.phone
          ? (storedOrder.notes?.email
              ? `${storedOrder.notes.email} · ${storedOrder.notes.phone}`
              : storedOrder.notes.phone)
          : undefined,
        isTestMode: true,
        message: "Payment signature and Razorpay status verified in test mode.",
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
   * Handles browser cancellation or failure reports safely (Issue 5).
   * Untrusted browser messages cannot override an already verified paid state.
   */
  router.post("/record-failure", (req: Request, res: Response) => {
    const { orderId, reason, type } = req.body;

    if (!orderId || typeof orderId !== "string") {
      res.status(400).json({ error: "Missing required 'orderId' parameter." });
      return;
    }

    const order = getStoredOrder(orderId);
    if (!order) {
      res.status(404).json({ error: `Order '${orderId}' not found.` });
      return;
    }

    // Never let client request override an already verified paid state
    if (order.status === "paid") {
      res.status(409).json({
        recorded: false,
        error: "Cannot modify order: order is already verified as paid.",
        status: "paid",
      });
      return;
    }

    const safeReason =
      typeof reason === "string" ? reason.substring(0, 200).trim() : "Unspecified client report";

    const isCancellation =
      type === "cancelled" ||
      safeReason.toLowerCase().includes("closed") ||
      safeReason.toLowerCase().includes("cancel") ||
      safeReason.toLowerCase().includes("dismiss");

    if (isCancellation) {
      order.status = "cancelled";
      order.cancelledAt = Date.now();
      order.failureReason = safeReason;
    } else {
      order.status = "failed";
      order.failedAt = Date.now();
      order.failureReason = safeReason;
    }

    saveStoredOrder(order);
    res.json({ recorded: true, status: order.status, orderId: order.orderId });
  });

  return router;
}
