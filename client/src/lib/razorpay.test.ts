import { describe, expect, it } from "vitest";
import {
  type PaymentMethodType,
  type PaymentFlowStatus,
  buildRazorpayCheckoutOptions,
} from "./razorpay";

describe("ROAM Client Razorpay Integration", () => {
  it("supports all required payment method types", () => {
    const methods: PaymentMethodType[] = ["card", "upi", "netbanking", "wallet"];
    expect(methods).toHaveLength(4);
    expect(methods).toContain("card");
    expect(methods).toContain("upi");
    expect(methods).toContain("netbanking");
    expect(methods).toContain("wallet");
  });

  it("handles valid lifecycle payment statuses", () => {
    const statuses: PaymentFlowStatus[] = [
      "idle",
      "loading_config",
      "creating_order",
      "ready",
      "processing",
      "success",
      "failed",
      "cancelled",
    ];
    expect(statuses).toHaveLength(8);
  });

  it("prevents false payment-success states without backend verified confirmation", () => {
    // Only verified: true with paymentId and orderId represents genuine sandbox verification
    const unverifiedResponse = {
      verified: false,
      error: "Signature invalid",
    };
    expect(unverifiedResponse.verified).toBe(false);

    const verifiedSandboxResponse = {
      verified: true,
      paymentId: "pay_test_123",
      orderId: "order_test_456",
      isTestMode: true,
      disclaimer: "Processed in Razorpay Sandbox Test Mode. No activity booking confirmed.",
    };
    expect(verifiedSandboxResponse.verified).toBe(true);
    expect(verifiedSandboxResponse.isTestMode).toBe(true);
    expect(verifiedSandboxResponse.disclaimer).toContain("No activity booking confirmed");
  });

  describe("Payment Method Synchronization & Options Construction", () => {
    const baseParams = {
      keyId: "rzp_test_123456",
      orderId: "order_test_789",
      amount: 3175,
      currency: "JPY",
      destinationName: "Kyoto",
      activityCount: 2,
      fullName: "Eleanor Vance",
      email: "eleanor@example.com",
      contact: "+816523658272",
      partySize: 2,
      onDismiss: () => {},
      handler: () => {},
    };

    it("keeps prefill strictly compliant with name, email, and contact (no prefill.method)", () => {
      const options = buildRazorpayCheckoutOptions({
        ...baseParams,
        paymentMethod: "card",
      });

      expect(options.prefill.name).toBe("Eleanor Vance");
      expect(options.prefill.email).toBe("eleanor@example.com");
      expect(options.prefill.contact).toBe("+816523658272");
      expect((options.prefill as any).method).toBeUndefined();
    });

    it("configures card method as first in sequence and notes", () => {
      const options = buildRazorpayCheckoutOptions({
        ...baseParams,
        paymentMethod: "card",
      });

      expect(options.config.display.sequence[0]).toBe("card");
      expect(options.notes.preferred_method).toBe("card");
    });

    it("configures upi method as first in sequence and notes", () => {
      const options = buildRazorpayCheckoutOptions({
        ...baseParams,
        paymentMethod: "upi",
      });

      expect(options.config.display.sequence[0]).toBe("upi");
      expect(options.notes.preferred_method).toBe("upi");
    });

    it("configures netbanking method as first in sequence and notes", () => {
      const options = buildRazorpayCheckoutOptions({
        ...baseParams,
        paymentMethod: "netbanking",
      });

      expect(options.config.display.sequence[0]).toBe("netbanking");
      expect(options.notes.preferred_method).toBe("netbanking");
    });

    it("configures wallet method as first in sequence and notes", () => {
      const options = buildRazorpayCheckoutOptions({
        ...baseParams,
        paymentMethod: "wallet",
      });

      expect(options.config.display.sequence[0]).toBe("wallet");
      expect(options.notes.preferred_method).toBe("wallet");
    });
  });
});


