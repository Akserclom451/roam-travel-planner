import crypto from "crypto";
import { describe, expect, it, beforeEach } from "vitest";
import {
  getSubunitMultiplier,
  toSubunits,
  verifyRazorpaySignature,
  getRazorpayCredentials,
  calculateServerOrderAmount,
  ordersStore,
  type StoredOrder,
} from "./razorpay";

describe("ROAM Razorpay Server Logic", () => {
  beforeEach(() => {
    ordersStore.clear();
  });

  describe("Subunit Multiplier and Conversion", () => {
    it("returns 100 for standard currencies with minor subunits (EUR, USD, INR, GBP)", () => {
      expect(getSubunitMultiplier("EUR")).toBe(100);
      expect(getSubunitMultiplier("USD")).toBe(100);
      expect(getSubunitMultiplier("INR")).toBe(100);
      expect(getSubunitMultiplier("GBP")).toBe(100);
    });

    it("returns 1 for zero-decimal currencies (JPY, ISK)", () => {
      expect(getSubunitMultiplier("JPY")).toBe(1);
      expect(getSubunitMultiplier("ISK")).toBe(1);
    });

    it("converts major units to minor subunits correctly", () => {
      expect(toSubunits(42, "EUR")).toBe(4200); // 42.00 EUR -> 4200 cents
      expect(toSubunits(1250, "EUR")).toBe(125000);
      expect(toSubunits(7400, "JPY")).toBe(7400); // 7400 JPY -> 7400
      expect(toSubunits(11742, "ISK")).toBe(11742); // 11742 ISK -> 11742
    });

    it("throws an error for non-positive or non-finite amounts", () => {
      expect(() => toSubunits(0, "EUR")).toThrow("Invalid payment amount");
      expect(() => toSubunits(-10, "EUR")).toThrow("Invalid payment amount");
      expect(() => toSubunits(NaN, "EUR")).toThrow("Invalid payment amount");
    });
  });

  describe("Payment Signature Verification", () => {
    const testSecret = "test_secret_key_123456";
    const orderId = "order_O689ABC123";
    const paymentId = "pay_P890XYZ456";

    it("verifies a valid HMAC SHA-256 signature", () => {
      const validSignature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      const result = verifyRazorpaySignature(orderId, paymentId, validSignature, testSecret);
      expect(result).toBe(true);
    });

    it("rejects an invalid or tampered signature", () => {
      const tamperedSignature = "invalid_signature_hex_value_abcdef123456";
      const result = verifyRazorpaySignature(orderId, paymentId, tamperedSignature, testSecret);
      expect(result).toBe(false);
    });

    it("rejects when signature was generated with a different secret", () => {
      const wrongSecretSignature = crypto
        .createHmac("sha256", "different_secret")
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      const result = verifyRazorpaySignature(orderId, paymentId, wrongSecretSignature, testSecret);
      expect(result).toBe(false);
    });

    it("returns false for missing arguments", () => {
      expect(verifyRazorpaySignature("", paymentId, "sig", testSecret)).toBe(false);
      expect(verifyRazorpaySignature(orderId, "", "sig", testSecret)).toBe(false);
      expect(verifyRazorpaySignature(orderId, paymentId, "", testSecret)).toBe(false);
      expect(verifyRazorpaySignature(orderId, paymentId, "sig", "")).toBe(false);
    });
  });

  describe("Credentials & Test Mode Enforcement", () => {
    it("identifies unconfigured state when environment variables are missing", () => {
      const originalKey = process.env.RAZORPAY_KEY_ID;
      const originalSecret = process.env.RAZORPAY_KEY_SECRET;

      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      const creds = getRazorpayCredentials({ skipDotEnv: true });
      expect(creds.isConfigured).toBe(false);
      expect(creds.keyId).toBeNull();
      expect(creds.keySecret).toBeNull();
      expect(creds.isTestMode).toBe(true);

      // Restore
      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
    });

    it("rejects production live keys (rzp_live_) with a security error", () => {
      const originalKey = process.env.RAZORPAY_KEY_ID;
      const originalSecret = process.env.RAZORPAY_KEY_SECRET;

      process.env.RAZORPAY_KEY_ID = "rzp_live_dangerouskey123";
      process.env.RAZORPAY_KEY_SECRET = "some_secret";

      expect(() => getRazorpayCredentials()).toThrow("Only Razorpay TEST MODE keys");

      // Restore
      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
    });

    it("accepts valid test keys (rzp_test_)", () => {
      const originalKey = process.env.RAZORPAY_KEY_ID;
      const originalSecret = process.env.RAZORPAY_KEY_SECRET;

      process.env.RAZORPAY_KEY_ID = "rzp_test_validkey123";
      process.env.RAZORPAY_KEY_SECRET = "valid_secret_456";

      const creds = getRazorpayCredentials();
      expect(creds.isConfigured).toBe(true);
      expect(creds.keyId).toBe("rzp_test_validkey123");
      expect(creds.isTestMode).toBe(true);

      // Restore
      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
    });

    it("handles invalid key ID format without crashing or exposing credentials", () => {
      const originalKey = process.env.RAZORPAY_KEY_ID;
      const originalSecret = process.env.RAZORPAY_KEY_SECRET;

      process.env.RAZORPAY_KEY_ID = "invalid_prefix_key_123";
      process.env.RAZORPAY_KEY_SECRET = "valid_secret_456";

      const creds = getRazorpayCredentials();
      expect(creds.isConfigured).toBe(false);
      expect(creds.error).toContain("Sandbox Key ID must start with 'rzp_test_'");

      // Restore
      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
    });

    it("sanitizes combined credentials entered with comma or whitespace separator", () => {
      const originalKey = process.env.RAZORPAY_KEY_ID;
      const originalSecret = process.env.RAZORPAY_KEY_SECRET;

      process.env.RAZORPAY_KEY_ID = "key_id,key_secret";
      process.env.RAZORPAY_KEY_SECRET = "rzp_test_combinedKey123,mySecretValue987654";

      const creds = getRazorpayCredentials();
      expect(creds.isConfigured).toBe(true);
      expect(creds.keyId).toBe("rzp_test_combinedKey123");
      expect(creds.keySecret).toBe("mySecretValue987654");

      // Restore
      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
    });
  });

  describe("Server-Side Order Amount & Currency Validation", () => {
    it("authoritatively computes EUR total from catalog activity items", () => {
      // 2 x kyoto-tea (42) + 1 x kyoto-fushimi (28) = 84 + 28 = 112 EUR
      const result = calculateServerOrderAmount({
        currency: "EUR",
        items: [
          { activityId: "kyoto-tea", quantity: 2 },
          { activityId: "kyoto-fushimi", quantity: 1 },
        ],
      });
      expect(result.amount).toBe(112);
      expect(result.totalCostEur).toBe(112);
    });

    it("rejects unknown activity IDs", () => {
      expect(() =>
        calculateServerOrderAmount({
          currency: "EUR",
          items: [{ activityId: "non-existent-activity", quantity: 1 }],
        })
      ).toThrow("Unknown activity ID");
    });

    it("rejects invalid item quantities", () => {
      expect(() =>
        calculateServerOrderAmount({
          currency: "EUR",
          items: [{ activityId: "kyoto-tea", quantity: 0 }],
        })
      ).toThrow("Invalid item quantity");
    });

    it("prevents browser client amount tampering for itinerary items", () => {
      // Base EUR is 112. Client tampered amount to 1 EUR.
      expect(() =>
        calculateServerOrderAmount({
          currency: "JPY",
          amount: 1, // tampered amount
          items: [
            { activityId: "kyoto-tea", quantity: 2 },
            { activityId: "kyoto-fushimi", quantity: 1 },
          ],
        })
      ).toThrow("Client amount is inconsistent with authoritative itinerary total");
    });

    it("rejects unsupported currencies", () => {
      expect(() =>
        calculateServerOrderAmount({
          currency: "BITCOIN",
          amount: 100,
        })
      ).toThrow("Unsupported or invalid currency");
    });
  });

  describe("Authoritative Order Store & Duplicate Detection", () => {
    it("tracks order state and marks order as paid", () => {
      const orderId = "order_test_101";
      const sampleOrder: StoredOrder = {
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_1",
        status: "created",
        createdAt: Date.now(),
      };
      ordersStore.set(orderId, sampleOrder);

      expect(ordersStore.get(orderId)?.status).toBe("created");

      // Mark paid
      sampleOrder.status = "paid";
      sampleOrder.paymentId = "pay_test_999";
      sampleOrder.paidAt = Date.now();

      expect(ordersStore.get(orderId)?.status).toBe("paid");
      expect(ordersStore.get(orderId)?.paymentId).toBe("pay_test_999");
    });

    it("tracks failed and cancelled orders", () => {
      const orderId = "order_test_fail_202";
      const sampleOrder: StoredOrder = {
        orderId,
        amount: 2800,
        displayAmount: 28,
        currency: "EUR",
        receipt: "rcpt_fail",
        status: "created",
        createdAt: Date.now(),
      };
      ordersStore.set(orderId, sampleOrder);

      // Transition to failed
      sampleOrder.status = "failed";
      expect(ordersStore.get(orderId)?.status).toBe("failed");
    });
  });
});
