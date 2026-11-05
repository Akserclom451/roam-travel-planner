import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import express from "express";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getSubunitMultiplier,
  toSubunits,
  verifyRazorpaySignature,
  getRazorpayCredentials,
  calculateServerOrderAmount,
  formatServerCurrency,
  setMockExchangeRates,
  resetExchangeRatesCache,
  ordersStore,
  setOrderStoragePath,
  clearOrderStorage,
  loadOrdersFromDisk,
  saveStoredOrder,
  getStoredOrder,
  createRazorpayRouter,
  isValidCurrency,
  isValidRazorpayOrderId,
  isValidRazorpayPaymentId,
  isValidRazorpaySignature,
  isValidReceipt,
  validateRazorpayNotes,
  type StoredOrder,
} from "./razorpay";

async function createTestServer(app: express.Express): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe("ROAM Razorpay Server Logic", () => {
  let tempStorageDir: string;
  let tempStorageFile: string;

  beforeEach(() => {
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "roam-test-"));
    tempStorageFile = path.join(tempStorageDir, "orders.json");
    setOrderStoragePath(tempStorageFile);
    clearOrderStorage();
    setMockExchangeRates({ JPY: 176.19, ISK: 136.03 });
  });

  afterEach(() => {
    clearOrderStorage();
    resetExchangeRatesCache();
    try {
      if (fs.existsSync(tempStorageDir)) {
        fs.rmSync(tempStorageDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Subunit Multiplier and Conversion", () => {
    it("returns 100 for EUR and INR", () => {
      expect(getSubunitMultiplier("EUR")).toBe(100);
      expect(getSubunitMultiplier("INR")).toBe(100);
    });

    it("returns 1 for zero-decimal currencies (JPY, ISK)", () => {
      expect(getSubunitMultiplier("JPY")).toBe(1);
      expect(getSubunitMultiplier("ISK")).toBe(1);
    });

    it("converts major units to minor subunits correctly", () => {
      expect(toSubunits(42, "EUR")).toBe(4200); // 42 EUR -> 4200 cents
      expect(toSubunits(112, "EUR")).toBe(11200);
      expect(toSubunits(7400, "JPY")).toBe(7400); // zero-decimal
      expect(toSubunits(11700, "ISK")).toBe(11700); // zero-decimal
      expect(toSubunits(3180, "INR")).toBe(318000); // 3180 INR -> 318000 paise
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

      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
    });

    it("rejects production live keys (rzp_live_) with a security error", () => {
      const originalKey = process.env.RAZORPAY_KEY_ID;
      const originalSecret = process.env.RAZORPAY_KEY_SECRET;

      process.env.RAZORPAY_KEY_ID = "rzp_live_dangerouskey123";
      process.env.RAZORPAY_KEY_SECRET = "some_secret";

      expect(() => getRazorpayCredentials()).toThrow("Only Razorpay TEST MODE keys");

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

      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
    });

    it("handles invalid key ID format without crashing", () => {
      const originalKey = process.env.RAZORPAY_KEY_ID;
      const originalSecret = process.env.RAZORPAY_KEY_SECRET;

      process.env.RAZORPAY_KEY_ID = "invalid_prefix_key_123";
      process.env.RAZORPAY_KEY_SECRET = "valid_secret_456";

      const creds = getRazorpayCredentials();
      expect(creds.isConfigured).toBe(false);
      expect(creds.error).toContain("Sandbox Key ID must start with 'rzp_test_'");

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

      if (originalKey) process.env.RAZORPAY_KEY_ID = originalKey;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalSecret) process.env.RAZORPAY_KEY_SECRET = originalSecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
    });
  });

  describe("Issue 1: Authoritative Order Amount & Currency Calculation", () => {
    it("authoritatively computes EUR total from catalog activity items", async () => {
      // 2 x kyoto-tea (42) + 1 x kyoto-fushimi (28) = 84 + 28 = 112 EUR
      const result = await calculateServerOrderAmount({
        currency: "EUR",
        items: [
          { activityId: "kyoto-tea", quantity: 2 },
          { activityId: "kyoto-fushimi", quantity: 1 },
        ],
      });
      expect(result.amount).toBe(112);
      expect(result.amountInSubunits).toBe(11200); // 112 * 100 cents
      expect(result.totalCostEur).toBe(112);
      expect(result.effectiveRate).toBe(1);
    });

    it("authoritatively computes JPY converted total using trusted rate and ROAM rounding", async () => {
      // Rate 176.19
      // kyoto-tea (42): Math.round(42 * 176.19) = Math.round(7399.98) = 7400 -> 2 x 7400 = 14800
      // kyoto-fushimi (28): Math.round(28 * 176.19) = Math.round(4933.32) = 4933 -> 1 x 4933 = 4933
      // Total: 14800 + 4933 = 19733 JPY
      const result = await calculateServerOrderAmount(
        {
          currency: "JPY",
          items: [
            { activityId: "kyoto-tea", quantity: 2 },
            { activityId: "kyoto-fushimi", quantity: 1 },
          ],
        },
        { JPY: 176.19 }
      );
      expect(result.amount).toBe(19733);
      expect(result.amountInSubunits).toBe(19733); // zero-decimal
      expect(result.totalCostEur).toBe(112);
      expect(result.effectiveRate).toBe(176.19);
    });

    it("authoritatively computes ISK converted total using trusted rate and ROAM rounding", async () => {
      // Rate 136.03
      // reykjavik-lagoon (86): Math.round(86 * 136.03) = Math.round(11698.58) = 11699
      const result = await calculateServerOrderAmount(
        {
          currency: "ISK",
          items: [{ activityId: "reykjavik-lagoon", quantity: 1 }],
        },
        { ISK: 136.03 }
      );
      expect(result.amount).toBe(11699);
      expect(result.amountInSubunits).toBe(11699); // zero-decimal
      expect(result.totalCostEur).toBe(86);
    });

    it("rejects unknown activity IDs", async () => {
      await expect(
        calculateServerOrderAmount({
          currency: "EUR",
          items: [{ activityId: "non-existent-activity", quantity: 1 }],
        })
      ).rejects.toThrow("Unknown activity ID");
    });

    it("rejects invalid item quantities", async () => {
      await expect(
        calculateServerOrderAmount({
          currency: "EUR",
          items: [{ activityId: "kyoto-tea", quantity: 0 }],
        })
      ).rejects.toThrow("Invalid item quantity");

      await expect(
        calculateServerOrderAmount({
          currency: "EUR",
          items: [{ activityId: "kyoto-tea", quantity: -2 }],
        })
      ).rejects.toThrow("Invalid item quantity");
    });

    it("authoritatively computes INR converted total for Jaipur activities with paise subunits", async () => {
      // Rate 106.0
      // jaipur-amber (30): Math.round(30 * 106.0) = 3180 INR -> 1 x 3180 = 3180
      // jaipur-blockprint (25): Math.round(25 * 106.0) = 2650 INR -> 1 x 2650 = 2650
      // Total: 3180 + 2650 = 5830 INR
      const result = await calculateServerOrderAmount(
        {
          currency: "INR",
          items: [
            { activityId: "jaipur-amber", quantity: 1 },
            { activityId: "jaipur-blockprint", quantity: 1 },
          ],
        },
        { INR: 106.0 }
      );
      expect(result.amount).toBe(5830);
      expect(result.amountInSubunits).toBe(583000); // 5830 * 100 paise
      expect(result.totalCostEur).toBe(55);
      expect(result.currency).toBe("INR");
      expect(formatServerCurrency(result.amount, result.currency)).toBe("₹5,830");
    });

    it("strictly rejects unsupported currencies", async () => {
      await expect(
        calculateServerOrderAmount({
          currency: "USD",
          items: [{ activityId: "kyoto-tea", quantity: 1 }],
        })
      ).rejects.toThrow("Unsupported or invalid currency");

      await expect(
        calculateServerOrderAmount({
          currency: "GBP",
          items: [{ activityId: "kyoto-tea", quantity: 1 }],
        })
      ).rejects.toThrow("Unsupported or invalid currency");
    });

    it("ignores client amount and authoritatively computes server total (Option A Single Source of Truth)", async () => {
      // Authoritative EUR is 112. Client passes 50 EUR. Server calculates 112 without rejecting.
      const result = await calculateServerOrderAmount({
        currency: "EUR",
        amount: 50, // client-supplied amount
        items: [
          { activityId: "kyoto-tea", quantity: 2 },
          { activityId: "kyoto-fushimi", quantity: 1 },
        ],
      });
      expect(result.amount).toBe(112);
      expect(result.amountInSubunits).toBe(11200);
    });

    it("accepts matching client amount when identical to authoritative calculation", async () => {
      const result = await calculateServerOrderAmount({
        currency: "EUR",
        amount: 112,
        items: [
          { activityId: "kyoto-tea", quantity: 2 },
          { activityId: "kyoto-fushimi", quantity: 1 },
        ],
      });
      expect(result.amount).toBe(112);
    });
  });

  describe("Option A: Authoritative Amount Calculation & Rounding Boundary Regression Tests", () => {
    it("formats server currency strings correctly for JPY, EUR, and ISK", () => {
      expect(formatServerCurrency(3174, "JPY")).toBe("¥3,174");
      expect(formatServerCurrency(3175, "JPY")).toBe("¥3,175");
      expect(formatServerCurrency(42, "EUR")).toBe("€42");
      expect(formatServerCurrency(11699, "ISK")).toBe("kr 11,699");
    });

    it("regression test: handles the JPY 3174 versus 3175 rounding boundary for 18 EUR at rates 176.36 and 176.37", async () => {
      // kyoto-ryokan base price is 18 EUR
      // At rate 176.36: 18 * 176.36 = 3174.48 -> rounds to 3174
      const calc3174 = await calculateServerOrderAmount(
        {
          currency: "JPY",
          items: [{ activityId: "kyoto-ryokan", quantity: 1 }],
        },
        { JPY: 176.36 }
      );
      expect(calc3174.amount).toBe(3174);
      expect(calc3174.amountInSubunits).toBe(3174); // zero decimal
      expect(formatServerCurrency(calc3174.amount, "JPY")).toBe("¥3,174");

      // At rate 176.37: 18 * 176.37 = 3174.66 -> rounds to 3175
      const calc3175 = await calculateServerOrderAmount(
        {
          currency: "JPY",
          items: [{ activityId: "kyoto-ryokan", quantity: 1 }],
        },
        { JPY: 176.37 }
      );
      expect(calc3175.amount).toBe(3175);
      expect(calc3175.amountInSubunits).toBe(3175); // zero decimal
      expect(formatServerCurrency(calc3175.amount, "JPY")).toBe("¥3,175");
    });

    it("regression test: does not reject payment when client amount is 3174 but server calculated 3175", async () => {
      // Client previously calculated 3174 with older rate, server rate yields 3175
      const result = await calculateServerOrderAmount(
        {
          currency: "JPY",
          amount: 3174, // client amount differing by 1
          items: [{ activityId: "kyoto-ryokan", quantity: 1 }],
        },
        { JPY: 176.37 }
      );
      expect(result.amount).toBe(3175); // server authoritative total wins
      expect(result.amountInSubunits).toBe(3175);
    });

    it("POST /api/razorpay/calculate-amount returns authoritative integer amount, subunits, and formatted display string", async () => {
      setMockExchangeRates({ JPY: 176.37 });
      const app = express();
      app.use(express.json());
      app.use("/api/razorpay", createRazorpayRouter({}));

      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/calculate-amount`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ activityId: "kyoto-ryokan", quantity: 1 }],
            currency: "JPY",
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.amount).toBe(3175);
        expect(data.amountInSubunits).toBe(3175);
        expect(data.currency).toBe("JPY");
        expect(data.formattedAmount).toBe("¥3,175");
        expect(data.totalCostEur).toBe(18);
      } finally {
        await server.close();
      }
    });

    it("POST /api/razorpay/create-order creates order with authoritative amount even if client supplies off-by-one amount", async () => {
      setMockExchangeRates({ JPY: 176.37 });
      process.env.RAZORPAY_KEY_ID = "rzp_test_mock_123";
      process.env.RAZORPAY_KEY_SECRET = "mock_secret_456";

      const mockRazorpay = {
        orders: {
          create: async (payload: any) => {
            return {
              id: "order_test_rounding_ok",
              amount: payload.amount,
              currency: payload.currency,
              receipt: payload.receipt,
            };
          },
        },
      };

      const app = express();
      app.use(express.json());
      app.use(
        "/api/razorpay",
        createRazorpayRouter({
          razorpayClientOverride: mockRazorpay,
        })
      );

      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/create-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ activityId: "kyoto-ryokan", quantity: 1 }],
            currency: "JPY",
            amount: 3174, // Client-supplied amount off by 1
          }),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.amount).toBe(3175); // Razorpay amount in subunits is strictly server authoritative
        expect(data.displayAmount).toBe(3175);
        expect(data.formattedAmount).toBe("¥3,175");
        expect(data.currency).toBe("JPY");
      } finally {
        await server.close();
      }
    });
  });

  describe("Issue 3: Persistent Storage & Durability Across Server Restart", () => {
    it("persists created order to file and reloads it on server restart", () => {
      const orderId = "order_persist_001";
      const sampleOrder: StoredOrder = {
        orderId,
        amount: 11200,
        displayAmount: 112,
        currency: "EUR",
        receipt: "rcpt_persist_1",
        status: "created",
        createdAt: Date.now(),
      };
      saveStoredOrder(sampleOrder);

      // Verify file exists on disk
      expect(fs.existsSync(tempStorageFile)).toBe(true);

      // Simulate server restart by clearing memory and reloading from disk
      ordersStore.clear();
      expect(ordersStore.size).toBe(0);

      loadOrdersFromDisk();
      expect(ordersStore.size).toBe(1);
      const reloaded = getStoredOrder(orderId);
      expect(reloaded).toBeDefined();
      expect(reloaded?.amount).toBe(11200);
      expect(reloaded?.status).toBe("created");
    });

    it("ensures a server restart cannot turn a paid order into an unverified or new order", () => {
      const orderId = "order_paid_survives_restart";
      const paidOrder: StoredOrder = {
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_paid_1",
        status: "paid",
        createdAt: Date.now() - 5000,
        paidAt: Date.now(),
        paymentId: "pay_test_verified_123",
      };
      saveStoredOrder(paidOrder);

      // Simulate server restart
      ordersStore.clear();
      loadOrdersFromDisk();

      const restored = getStoredOrder(orderId);
      expect(restored).toBeDefined();
      expect(restored?.status).toBe("paid");
      expect(restored?.paymentId).toBe("pay_test_verified_123");
    });
  });

  describe("Issue 2 & Issue 4: Duplicate Verification and Independent Razorpay Status Checks", () => {
    const testSecret = "test_secret_for_routes";
    const testKeyId = "rzp_test_route_key_123";

    function createApp(mockRazorpayClient: any) {
      const app = express();
      app.use(express.json());

      process.env.RAZORPAY_KEY_ID = testKeyId;
      process.env.RAZORPAY_KEY_SECRET = testSecret;

      app.use(
        "/api/razorpay",
        createRazorpayRouter({
          razorpayClientOverride: mockRazorpayClient,
        })
      );
      return app;
    }

    it("verifies payment, validates with Razorpay SDK, and transitions order to paid", async () => {
      const orderId = "order_valid_flow";
      const paymentId = "pay_valid_123";
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_flow_1",
        status: "created",
        createdAt: Date.now(),
      });

      const mockRazorpay = {
        payments: {
          fetch: async (id: string) => {
            expect(id).toBe(paymentId);
            return {
              id: paymentId,
              order_id: orderId,
              amount: 4200,
              currency: "EUR",
              status: "captured",
            };
          },
        },
      };

      const app = createApp(mockRazorpay);
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.verified).toBe(true);
        expect(body.paymentId).toBe(paymentId);

        const stored = getStoredOrder(orderId);
        expect(stored?.status).toBe("paid");
        expect(stored?.paymentId).toBe(paymentId);
      } finally {
        await server.close();
      }
    });

    it("rejects an invalid HMAC signature with HTTP 400 before checking Razorpay", async () => {
      const orderId = "order_bad_sig";
      const paymentId = "pay_bad_sig";

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_sig_1",
        status: "created",
        createdAt: Date.now(),
      });

      let razorpayCalled = false;
      const mockRazorpay = {
        payments: {
          fetch: async () => {
            razorpayCalled = true;
            return {};
          },
        },
      };

      const app = createApp(mockRazorpay);
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: "e".repeat(64), // Valid 64-hex length, invalid HMAC signature
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.verified).toBe(false);
        expect(body.error).toContain("Invalid payment signature");
        expect(razorpayCalled).toBe(false);
      } finally {
        await server.close();
      }
    });

    it("returns idempotent success for duplicate verification with the EXACT SAME payment ID", async () => {
      const orderId = "order_dup_same";
      const paymentId = "pay_original_123";
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_dup_1",
        status: "paid",
        createdAt: Date.now() - 10000,
        paidAt: Date.now() - 5000,
        paymentId,
      });

      const app = createApp({});
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.verified).toBe(true);
        expect(body.duplicate).toBe(true);
        expect(body.paymentId).toBe(paymentId);
      } finally {
        await server.close();
      }
    });

    it("strictly rejects duplicate verification with a DIFFERENT payment ID (409 Conflict)", async () => {
      const orderId = "order_dup_conflict";
      const originalPaymentId = "pay_legit_100";
      const conflictingPaymentId = "pay_hijack_200";

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_conflict_1",
        status: "paid",
        createdAt: Date.now() - 10000,
        paidAt: Date.now() - 5000,
        paymentId: originalPaymentId,
      });

      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${conflictingPaymentId}`)
        .digest("hex");

      const app = createApp({});
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: conflictingPaymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(409);
        expect(body.verified).toBe(false);
        expect(body.error).toContain("Payment conflict");
        expect(body.error).toContain(originalPaymentId);
      } finally {
        await server.close();
      }
    });

    it("rejects when Razorpay reports payment amount mismatch", async () => {
      const orderId = "order_amt_mismatch";
      const paymentId = "pay_amt_123";
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      saveStoredOrder({
        orderId,
        amount: 4200, // Expected 42.00 EUR
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_amt_1",
        status: "created",
        createdAt: Date.now(),
      });

      const mockRazorpay = {
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            amount: 1000, // Mismatched 10.00 EUR
            currency: "EUR",
            status: "captured",
          }),
        },
      };

      const app = createApp(mockRazorpay);
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.error).toContain("Payment amount mismatch");
        expect(getStoredOrder(orderId)?.status).toBe("created");
      } finally {
        await server.close();
      }
    });

    it("rejects when Razorpay reports payment currency mismatch", async () => {
      const orderId = "order_curr_mismatch";
      const paymentId = "pay_curr_123";
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_curr_1",
        status: "created",
        createdAt: Date.now(),
      });

      const mockRazorpay = {
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            amount: 4200,
            currency: "USD", // Mismatched currency
            status: "captured",
          }),
        },
      };

      const app = createApp(mockRazorpay);
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.error).toContain("Payment currency mismatch");
        expect(getStoredOrder(orderId)?.status).toBe("created");
      } finally {
        await server.close();
      }
    });

    it("rejects when Razorpay payment status is failed or pending", async () => {
      const orderId = "order_status_failed";
      const paymentId = "pay_failed_123";
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_stat_1",
        status: "created",
        createdAt: Date.now(),
      });

      const mockRazorpay = {
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            amount: 4200,
            currency: "EUR",
            status: "failed", // Not captured or authorized
          }),
        },
      };

      const app = createApp(mockRazorpay);
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.error).toContain("Razorpay payment status is 'failed'");
        expect(getStoredOrder(orderId)?.status).toBe("created");
      } finally {
        await server.close();
      }
    });

    it("rejects an authorized-only payment with HTTP 409 and pendingCapture: true without marking the order as paid (S3-01)", async () => {
      const orderId = "order_authorized_only";
      const paymentId = "pay_auth_only_123";
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_auth_only_1",
        status: "created",
        createdAt: Date.now(),
      });

      const mockRazorpay = {
        payments: {
          fetch: async (id: string) => {
            expect(id).toBe(paymentId);
            return {
              id: paymentId,
              order_id: orderId,
              amount: 4200,
              currency: "EUR",
              status: "authorized",
            };
          },
        },
      };

      const app = createApp(mockRazorpay);
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(409);
        expect(body.verified).toBe(false);
        expect(body.pendingCapture).toBe(true);
        expect(body.error).toContain("Payment is authorized but not captured");

        const stored = getStoredOrder(orderId);
        expect(stored?.status).toBe("created");
        expect(stored?.paidAt).toBeUndefined();
        expect(stored?.paymentId).toBeUndefined();
      } finally {
        await server.close();
      }
    });

    it("returns HTTP 502 when Razorpay API fetch encounters network or gateway error", async () => {
      const orderId = "order_api_err";
      const paymentId = "pay_api_err";
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      saveStoredOrder({
        orderId,
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_api_err",
        status: "created",
        createdAt: Date.now(),
      });

      const mockRazorpay = {
        payments: {
          fetch: async () => {
            throw new Error("Razorpay connection timeout");
          },
        },
      };

      const app = createApp(mockRazorpay);
      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(502);
        expect(body.verified).toBe(false);
        expect(body.error).toContain("Razorpay connection timeout");
        expect(getStoredOrder(orderId)?.status).toBe("created");
      } finally {
        await server.close();
      }
    });
  });

  describe("Issue 5: Untrusted Browser Cancellation & Failure Handling", () => {
    it("distinguishes cancelled from failed states based on client action", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/razorpay", createRazorpayRouter({}));

      saveStoredOrder({
        orderId: "order_user_cancelled",
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_c1",
        status: "created",
        createdAt: Date.now(),
      });

      const server = await createTestServer(app);
      try {
        // User closed modal
        const cancelRes = await fetch(`${server.url}/api/razorpay/record-failure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: "order_user_cancelled",
            reason: "User closed checkout modal",
            type: "cancelled",
          }),
        });

        const cancelBody = await cancelRes.json();
        expect(cancelRes.status).toBe(200);
        expect(cancelBody.status).toBe("cancelled");
        expect(getStoredOrder("order_user_cancelled")?.status).toBe("cancelled");

        saveStoredOrder({
          orderId: "order_bank_failed",
          amount: 4200,
          displayAmount: 42,
          currency: "EUR",
          receipt: "rcpt_f1",
          status: "created",
          createdAt: Date.now(),
        });

        // Bank decline
        const failRes = await fetch(`${server.url}/api/razorpay/record-failure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: "order_bank_failed",
            reason: "Payment declined by issuing bank",
            type: "failed",
          }),
        });

        const failBody = await failRes.json();
        expect(failRes.status).toBe(200);
        expect(failBody.status).toBe("failed");
        expect(getStoredOrder("order_bank_failed")?.status).toBe("failed");
      } finally {
        await server.close();
      }
    });

    it("prevents browser cancellation or failure reports from overriding an already paid order (409 Conflict)", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/razorpay", createRazorpayRouter({}));

      saveStoredOrder({
        orderId: "order_paid_immutable",
        amount: 4200,
        displayAmount: 42,
        currency: "EUR",
        receipt: "rcpt_imm_1",
        status: "paid",
        createdAt: Date.now() - 5000,
        paidAt: Date.now() - 1000,
        paymentId: "pay_confirmed_999",
      });

      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/record-failure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: "order_paid_immutable",
            reason: "User closed modal afterwards",
            type: "cancelled",
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(409);
        expect(body.recorded).toBe(false);
        expect(body.error).toContain("order is already verified as paid");
        expect(getStoredOrder("order_paid_immutable")?.status).toBe("paid"); // still paid!
      } finally {
        await server.close();
      }
    });
  });

  describe("Priority 1: Order Amount Integrity Regression Tests", () => {
    const testSecret = "test_secret_key_123456";
    const testKeyId = "rzp_test_integration_key";

    beforeEach(() => {
      process.env.RAZORPAY_KEY_ID = testKeyId;
      process.env.RAZORPAY_KEY_SECRET = testSecret;
    });

    it("strictly verifies order_TvUlP4bZzBbCPl for ¥3,175 and never returns ¥4,939", async () => {
      const orderId3175 = "order_TvUlP4bZzBbCPl";
      const paymentId3175 = "pay_TvUl1ELASJrFJ";

      // Seed order_TvUlP4bZzBbCPl with authoritative amount 3175 JPY
      saveStoredOrder({
        orderId: orderId3175,
        amount: 3175,
        displayAmount: 3175,
        currency: "JPY",
        receipt: "roam_rcpt_1793663636610_590",
        status: "created",
        createdAt: Date.now(),
        items: [{ activityId: "kyoto-ryokan", quantity: 1 }],
        notes: {
          destination: "Kyoto",
          leadTraveller: "Mulla vivadi",
          email: "mullavivadi@gmail.com",
          phone: "+81 2536852142",
        },
      });

      // Mock Razorpay client returning exact 3175 JPY for this payment
      const mockRazorpay = {
        payments: {
          fetch: async (id: string) => {
            if (id === paymentId3175) {
              return {
                id: paymentId3175,
                order_id: orderId3175,
                amount: 3175,
                currency: "JPY",
                status: "captured",
              };
            }
            throw new Error("Payment not found");
          },
        },
      };

      const app = express();
      app.use(express.json());
      app.use("/api/razorpay", createRazorpayRouter({ razorpayClientOverride: mockRazorpay }));

      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId3175}|${paymentId3175}`)
        .digest("hex");

      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId3175,
            razorpay_payment_id: paymentId3175,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.verified).toBe(true);
        expect(body.orderId).toBe("order_TvUlP4bZzBbCPl");
        expect(body.paymentId).toBe("pay_TvUl1ELASJrFJ");
        // Must strictly be 3175, never 4939
        expect(body.amount).toBe(3175);
        expect(body.formattedAmount).toBe("¥3,175");
        expect(body.formattedAmount).not.toBe("¥4,939");
        expect(body.currency).toBe("JPY");
        expect(body.leadTraveller).toBe("Mulla vivadi");
        expect(body.contact).toBe("mullavivadi@gmail.com · +81 2536852142");
      } finally {
        await server.close();
      }
    });

    it("strictly verifies order_TvUpzHjsu4Mpbd for ¥4,939 with separate order identity", async () => {
      const orderId4939 = "order_TvUpzHjsu4Mpbd";
      const paymentId4939 = "pay_TvUsl1ELASJrFJ";

      saveStoredOrder({
        orderId: orderId4939,
        amount: 4939,
        displayAmount: 4939,
        currency: "JPY",
        receipt: "roam_rcpt_1793663897060_895",
        status: "created",
        createdAt: Date.now(),
        items: [{ activityId: "kyoto-fushimi", quantity: 1 }],
        notes: {
          destination: "Kyoto",
          leadTraveller: "Mulla vivadi",
          email: "mullavivadi@gmail.com",
          phone: "+81 2536852142",
        },
      });

      const mockRazorpay = {
        payments: {
          fetch: async (id: string) => {
            if (id === paymentId4939) {
              return {
                id: paymentId4939,
                order_id: orderId4939,
                amount: 4939,
                currency: "JPY",
                status: "captured",
              };
            }
            throw new Error("Payment not found");
          },
        },
      };

      const app = express();
      app.use(express.json());
      app.use("/api/razorpay", createRazorpayRouter({ razorpayClientOverride: mockRazorpay }));

      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId4939}|${paymentId4939}`)
        .digest("hex");

      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId4939,
            razorpay_payment_id: paymentId4939,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.verified).toBe(true);
        expect(body.orderId).toBe("order_TvUpzHjsu4Mpbd");
        expect(body.amount).toBe(4939);
        expect(body.formattedAmount).toBe("¥4,939");
        expect(body.currency).toBe("JPY");
      } finally {
        await server.close();
      }
    });

    it("rejects verification if Razorpay payment amount mismatches order amount (tamper protection)", async () => {
      const orderId = "order_mismatch_audit";
      const paymentId = "pay_mismatch_audit";

      saveStoredOrder({
        orderId,
        amount: 3175,
        displayAmount: 3175,
        currency: "JPY",
        receipt: "rcpt_mismatch",
        status: "created",
        createdAt: Date.now(),
      });

      // Simulates payment returning ¥4,939 for order created for ¥3,175
      const mockRazorpay = {
        payments: {
          fetch: async () => ({
            id: paymentId,
            order_id: orderId,
            amount: 4939, // Tampered or mismatched amount!
            currency: "JPY",
            status: "captured",
          }),
        },
      };

      const app = express();
      app.use(express.json());
      app.use("/api/razorpay", createRazorpayRouter({ razorpayClientOverride: mockRazorpay }));

      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      const server = await createTestServer(app);
      try {
        const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.verified).toBe(false);
        expect(body.error).toContain("Payment amount mismatch");
      } finally {
        await server.close();
      }
    });
  });

  describe("S3-03: Strict Input Validation", () => {
    const testSecret = "test_secret_key_123456";

    describe("Helper function unit checks", () => {
      it("validates currencies without runtime errors on non-string inputs", () => {
        expect(isValidCurrency("EUR")).toBe(true);
        expect(isValidCurrency("JPY")).toBe(true);
        expect(isValidCurrency("ISK")).toBe(true);
        expect(isValidCurrency("INR")).toBe(true);
        expect(isValidCurrency("eur")).toBe(true);
        expect(isValidCurrency("  EUR  ")).toBe(true);
        expect(isValidCurrency("USD")).toBe(false);
        expect(isValidCurrency("")).toBe(false);
        expect(isValidCurrency(null)).toBe(false);
        expect(isValidCurrency(undefined)).toBe(false);
        expect(isValidCurrency(123)).toBe(false);
        expect(isValidCurrency({})).toBe(false);
        expect(isValidCurrency([])).toBe(false);
      });

      it("validates Razorpay order IDs strictly requiring 'order_' prefix", () => {
        expect(isValidRazorpayOrderId("order_12345678")).toBe(true);
        expect(isValidRazorpayOrderId("order_ABC12345xyz")).toBe(true);
        expect(isValidRazorpayOrderId("order_c1")).toBe(false); // under 3 suffix chars
        expect(isValidRazorpayOrderId("pay_12345678")).toBe(false);
        expect(isValidRazorpayOrderId("order_")).toBe(false);
        expect(isValidRazorpayOrderId(" order_12345678 ")).toBe(false); // no silent trimming
        expect(isValidRazorpayOrderId("")).toBe(false);
        expect(isValidRazorpayOrderId(null)).toBe(false);
        expect(isValidRazorpayOrderId(12345)).toBe(false);
      });

      it("validates Razorpay payment IDs strictly requiring 'pay_' prefix", () => {
        expect(isValidRazorpayPaymentId("pay_12345678")).toBe(true);
        expect(isValidRazorpayPaymentId("pay_ABC12345xyz")).toBe(true);
        expect(isValidRazorpayPaymentId("pay_c1")).toBe(false); // under 3 suffix chars
        expect(isValidRazorpayPaymentId("order_12345678")).toBe(false);
        expect(isValidRazorpayPaymentId("pay_")).toBe(false);
        expect(isValidRazorpayPaymentId(" pay_12345678 ")).toBe(false);
        expect(isValidRazorpayPaymentId("")).toBe(false);
        expect(isValidRazorpayPaymentId(null)).toBe(false);
        expect(isValidRazorpayPaymentId({})).toBe(false);
      });

      it("validates signatures strictly as 64 hexadecimal characters", () => {
        const validHex = "a".repeat(64);
        expect(isValidRazorpaySignature(validHex)).toBe(true);
        expect(isValidRazorpaySignature("1234567890abcdef".repeat(4))).toBe(true);
        expect(isValidRazorpaySignature("a".repeat(63))).toBe(false); // too short
        expect(isValidRazorpaySignature("a".repeat(65))).toBe(false); // too long
        expect(isValidRazorpaySignature("g".repeat(64))).toBe(false); // non-hex
        expect(isValidRazorpaySignature(" " + validHex)).toBe(false); // leading space
        expect(isValidRazorpaySignature(null)).toBe(false);
        expect(isValidRazorpaySignature(123)).toBe(false);
      });

      it("validates receipts safely", () => {
        expect(isValidReceipt("rcpt_12345")).toBe(true);
        expect(isValidReceipt("receipt-valid_123")).toBe(true);
        expect(isValidReceipt("a".repeat(40))).toBe(true);
        expect(isValidReceipt("a".repeat(41))).toBe(false); // exceeds 40 chars
        expect(isValidReceipt("receipt with spaces")).toBe(false);
        expect(isValidReceipt("receipt$special")).toBe(false);
        expect(isValidReceipt("")).toBe(false);
        expect(isValidReceipt(null)).toBe(false);
        expect(isValidReceipt(12345)).toBe(false);
      });

      it("validates notes rejecting primitives, arrays, and nested structures", () => {
        expect(validateRazorpayNotes(undefined).isValid).toBe(true);
        expect(validateRazorpayNotes(null).isValid).toBe(true);
        expect(validateRazorpayNotes({}).isValid).toBe(true);
        expect(validateRazorpayNotes({ destination: "Kyoto", guestCount: 2 }).isValid).toBe(true);
        expect(validateRazorpayNotes("string").isValid).toBe(false);
        expect(validateRazorpayNotes([1, 2, 3]).isValid).toBe(false);
        expect(validateRazorpayNotes(123).isValid).toBe(false);
        expect(validateRazorpayNotes({ nested: { a: 1 } }).isValid).toBe(false);
        expect(validateRazorpayNotes({ arr: ["val"] }).isValid).toBe(false);

        // Max 15 key-value pairs
        const sixteenKeys: Record<string, string> = {};
        for (let i = 0; i < 16; i++) sixteenKeys[`key_${i}`] = `val_${i}`;
        expect(validateRazorpayNotes(sixteenKeys).isValid).toBe(false);

        // Key length > 40
        expect(validateRazorpayNotes({ ["k".repeat(41)]: "val" }).isValid).toBe(false);

        // Value length > 255
        expect(validateRazorpayNotes({ key: "v".repeat(256) }).isValid).toBe(false);
      });
    });

    describe("POST /api/razorpay/calculate-amount input validation", () => {
      it("rejects non-string currency with HTTP 400 without crashing", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/calculate-amount`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: 12345, // non-string
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Unsupported or invalid currency");
        } finally {
          await server.close();
        }
      });

      it("rejects invalid item structures (null items, non-object, missing activityId) with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          // null item inside array
          const res1 = await fetch(`${server.url}/api/razorpay/calculate-amount`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [null],
              currency: "EUR",
            }),
          });
          expect(res1.status).toBe(400);
          const body1 = await res1.json();
          expect(body1.error).toContain("must be a non-null object");

          // missing activityId
          const res2 = await fetch(`${server.url}/api/razorpay/calculate-amount`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ quantity: 2 }],
              currency: "EUR",
            }),
          });
          expect(res2.status).toBe(400);
          const body2 = await res2.json();
          expect(body2.error).toContain("activityId must be a non-empty string");

          // non-integer quantity
          const res3 = await fetch(`${server.url}/api/razorpay/calculate-amount`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1.5 }],
              currency: "EUR",
            }),
          });
          expect(res3.status).toBe(400);
          const body3 = await res3.json();
          expect(body3.error).toContain("must be an integer between 1 and 50");
        } finally {
          await server.close();
        }
      });
    });

    describe("POST /api/razorpay/create-order input validation", () => {
      it("accepts an omitted receipt and generates a default receipt", async () => {
        const mockRazorpay = {
          orders: {
            create: async (payload: any) => ({
              id: "order_receipt_omitted",
              amount: payload.amount,
              currency: payload.currency,
              receipt: payload.receipt,
            }),
          },
        };
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({ razorpayClientOverride: mockRazorpay }));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
            }),
          });

          expect(res.status).toBe(201);
          const body = await res.json();
          expect(body.orderId).toBe("order_receipt_omitted");
        } finally {
          await server.close();
        }
      });

      it("accepts a valid supplied receipt", async () => {
        let receivedReceipt = "";
        const mockRazorpay = {
          orders: {
            create: async (payload: any) => {
              receivedReceipt = payload.receipt;
              return {
                id: "order_receipt_custom",
                amount: payload.amount,
                currency: payload.currency,
                receipt: payload.receipt,
              };
            },
          },
        };
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({ razorpayClientOverride: mockRazorpay }));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              receipt: "custom-receipt_12345",
            }),
          });

          expect(res.status).toBe(201);
          expect(receivedReceipt).toBe("custom-receipt_12345");
        } finally {
          await server.close();
        }
      });

      it("rejects receipt: null with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              receipt: null,
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Invalid receipt format");
        } finally {
          await server.close();
        }
      });

      it("rejects receipt: \"\" (empty string) with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              receipt: "",
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Invalid receipt format");
        } finally {
          await server.close();
        }
      });

      it("rejects receipt: 123 with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              receipt: 123,
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Invalid receipt format");
        } finally {
          await server.close();
        }
      });

      it("rejects receipt: {} with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              receipt: {},
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Invalid receipt format");
        } finally {
          await server.close();
        }
      });

      it("rejects receipt: \"!@#$%\" with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              receipt: "!@#$%",
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Invalid receipt format");
        } finally {
          await server.close();
        }
      });

      it("rejects receipt longer than 40 characters with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              receipt: "a".repeat(41),
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Invalid receipt format");
        } finally {
          await server.close();
        }
      });

      it("rejects non-object notes or nested notes with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/create-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ activityId: "kyoto-tea", quantity: 1 }],
              currency: "EUR",
              notes: "a string instead of object",
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.error).toContain("Notes must be a plain object");
        } finally {
          await server.close();
        }
      });
    });

    describe("POST /api/razorpay/verify-payment input validation", () => {
      it("rejects malformed order IDs missing 'order_' prefix with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: "invalid_order_prefix_12345",
              razorpay_payment_id: "pay_valid12345",
              razorpay_signature: "a".repeat(64),
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.verified).toBe(false);
          expect(body.error).toContain("Invalid razorpay_order_id");
        } finally {
          await server.close();
        }
      });

      it("rejects malformed payment IDs missing 'pay_' prefix with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: "order_valid12345",
              razorpay_payment_id: "invalid_payment_prefix_12345",
              razorpay_signature: "a".repeat(64),
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.verified).toBe(false);
          expect(body.error).toContain("Invalid razorpay_payment_id");
        } finally {
          await server.close();
        }
      });

      it("rejects malformed signatures not matching 64 hex characters with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          const res = await fetch(`${server.url}/api/razorpay/verify-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: "order_valid12345",
              razorpay_payment_id: "pay_valid12345",
              razorpay_signature: "not_a_valid_64_hex_signature",
            }),
          });

          expect(res.status).toBe(400);
          const body = await res.json();
          expect(body.verified).toBe(false);
          expect(body.error).toContain("Invalid razorpay_signature");
        } finally {
          await server.close();
        }
      });
    });

    describe("POST /api/razorpay/record-failure input validation", () => {
      it("rejects missing or invalid order ID prefix with HTTP 400", async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/razorpay", createRazorpayRouter({}));
        const server = await createTestServer(app);
        try {
          // Missing orderId
          const res1 = await fetch(`${server.url}/api/razorpay/record-failure`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "cancelled" }),
          });
          expect(res1.status).toBe(400);

          // Invalid orderId format
          const res2 = await fetch(`${server.url}/api/razorpay/record-failure`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: "bad_prefix_12345" }),
          });
          expect(res2.status).toBe(400);
          const body2 = await res2.json();
          expect(body2.error).toContain("Invalid or missing 'orderId'");
        } finally {
          await server.close();
        }
      });
    });
  });
});

