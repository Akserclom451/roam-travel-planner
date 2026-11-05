
export type PaymentFlowStatus =
  | "idle"
  | "loading_config"
  | "creating_order"
  | "ready"
  | "processing"
  | "success"
  | "failed"
  | "cancelled";

export interface RazorpayConfigResponse {
  isConfigured: boolean;
  keyId: string | null;
  isTestMode: boolean;
  supportedCurrencies: string[];
  error?: string;
}

export interface AuthoritativeAmountResponse {
  amount: number;
  amountInSubunits: number;
  currency: string;
  formattedAmount: string;
  totalCostEur: number;
}

export interface CreateOrderResponse {
  orderId: string;
  amount: number;
  displayAmount: number;
  currency: string;
  formattedAmount?: string;
  keyId: string;
  isTestMode: boolean;
  error?: string;
  isConfigured?: boolean;
  previewPayload?: {
    amount: number;
    displayAmount: number;
    currency: string;
    formattedAmount?: string;
    receipt: string;
  };
}

export interface VerifyPaymentResponse {
  verified: boolean;
  paymentId?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  formattedAmount?: string;
  notes?: Record<string, string>;
  leadTraveller?: string;
  contact?: string;
  isTestMode?: boolean;
  duplicate?: boolean;
  message?: string;
  disclaimer?: string;
  error?: string;
}


declare global {
  interface Window {
    Razorpay?: any;
  }
}

/**
 * Dynamically loads Razorpay's official checkout script in the browser.
 */
export function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(false);
      return;
    }
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/**
 * Fetches Razorpay sandbox configuration from the server.
 */
export async function fetchRazorpayConfig(): Promise<RazorpayConfigResponse> {
  try {
    const res = await fetch("/api/razorpay/config");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        isConfigured: false,
        keyId: null,
        isTestMode: true,
        supportedCurrencies: ["EUR", "JPY", "ISK"],
        error: data.error || "Failed to load Razorpay sandbox configuration.",
      };
    }
    return await res.json();
  } catch (err) {
    return {
      isConfigured: false,
      keyId: null,
      isTestMode: true,
      supportedCurrencies: ["EUR", "JPY", "ISK"],
      error: err instanceof Error ? err.message : "Network error fetching Razorpay configuration.",
    };
  }
}

/**
 * Fetches the backend single source of truth for authoritative itinerary pricing.
 */
export async function fetchAuthoritativeOrderAmount(payload: {
  items: Array<{ activityId: string; quantity: number }>;
  currency: string;
}): Promise<AuthoritativeAmountResponse> {
  const res = await fetch("/api/razorpay/calculate-amount", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to calculate authoritative order amount.");
  }
  return data;
}

/**
 * Creates a server-side order in Razorpay sandbox.
 */
export async function createServerOrder(payload: {
  amount?: number;
  currency: string;
  items?: Array<{ activityId: string; quantity: number }>;
  notes?: Record<string, string | number>;
}): Promise<CreateOrderResponse> {
  const res = await fetch("/api/razorpay/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    if (data.previewPayload) {
      return data;
    }
    throw new Error(data.error || "Failed to create payment order.");
  }
  return data;
}

/**
 * Verifies payment signature on the server.
 */
export async function verifyServerPayment(payload: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<VerifyPaymentResponse> {
  const res = await fetch("/api/razorpay/verify-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Payment signature verification failed.");
  }
  return data;
}

/**
 * Records cancelled or failed payment for auditability.
 */
export async function recordPaymentFailure(
  orderId: string,
  reason: string,
  type?: "cancelled" | "failed"
): Promise<void> {
  try {
    await fetch("/api/razorpay/record-failure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, reason, type }),
    });
  } catch {
    // Non-critical audit call
  }
}

export interface BuildCheckoutOptionsParams {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  destinationName: string;
  activityCount: number;
  fullName: string;
  email: string;
  contact: string;
  partySize: number;
  onDismiss: () => void;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
}

/**
 * Builds Razorpay Standard Checkout options.
 * Lets Razorpay Standard Checkout present the available payment methods
 * enabled on the merchant account.
 */
export function buildRazorpayCheckoutOptions(params: BuildCheckoutOptionsParams) {
  return {
    key: params.keyId,
    amount: params.amount,
    currency: params.currency,
    name: "ROAM Travel",
    description: `${params.destinationName} Itinerary (${params.activityCount} activities)`,
    order_id: params.orderId,
    prefill: {
      name: params.fullName.trim(),
      email: params.email.trim(),
      contact: params.contact,
    },
    notes: {
      destination: params.destinationName,
      traveller_count: params.partySize.toString(),
    },
    theme: {
      color: "#253b2c",
    },
    modal: {
      ondismiss: params.onDismiss,
    },
    handler: params.handler,
  };
}

