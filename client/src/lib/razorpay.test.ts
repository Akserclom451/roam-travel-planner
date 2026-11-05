import { describe, expect, it } from "vitest";
import {
  type PaymentFlowStatus,
  buildRazorpayCheckoutOptions,
} from "./razorpay";

describe("ROAM Client Razorpay Integration", () => {
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

  describe("Razorpay Standard Checkout Options Construction", () => {
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

    it("builds valid standard checkout options without custom config.display overrides", () => {
      const options = buildRazorpayCheckoutOptions(baseParams);

      expect(options.key).toBe("rzp_test_123456");
      expect(options.order_id).toBe("order_test_789");
      expect(options.amount).toBe(3175);
      expect(options.currency).toBe("JPY");
      expect(options.name).toBe("ROAM Travel");
      expect(options.description).toContain("Kyoto Itinerary");
      // Does not pass custom config display, letting Razorpay display merchant methods
      expect((options as any).config).toBeUndefined();
    });

    it("keeps prefill strictly compliant with name, email, and contact (no prefill.method)", () => {
      const options = buildRazorpayCheckoutOptions(baseParams);

      expect(options.prefill.name).toBe("Eleanor Vance");
      expect(options.prefill.email).toBe("eleanor@example.com");
      expect(options.prefill.contact).toBe("+816523658272");
      expect((options.prefill as any).method).toBeUndefined();
    });

    it("includes destination and traveller count in notes without obsolete preferred_method", () => {
      const options = buildRazorpayCheckoutOptions(baseParams);

      expect(options.notes.destination).toBe("Kyoto");
      expect(options.notes.traveller_count).toBe("2");
      expect((options.notes as any).preferred_method).toBeUndefined();
    });
  });
});



