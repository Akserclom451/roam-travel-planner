import { describe, expect, it } from "vitest";
import {
  calculatePartySize,
  getDefaultCallingCode,
  validateLeadTravellerForm,
  sanitizePhoneNumber,
  formatDisplayPhone,
  formatRazorpayContact,
  sanitizeLeadTravellerForm,
  type LeadTravellerForm,
} from "./traveller";

describe("ROAM Checkout Step 2: Lead Traveller Logic", () => {
  describe("Party Size Calculation", () => {
    it("defaults to 1 traveller when no activities are planned", () => {
      expect(calculatePartySize([])).toBe(1);
    });

    it("returns the maximum participant quantity among planned activities", () => {
      expect(calculatePartySize([1, 1, 1])).toBe(1);
      expect(calculatePartySize([2, 2])).toBe(2);
      expect(calculatePartySize([1, 4, 2])).toBe(4);
    });
  });

  describe("Default Calling Code", () => {
    it("returns correct default calling code based on destination", () => {
      expect(getDefaultCallingCode("kyoto")).toBe("+81");
      expect(getDefaultCallingCode("lisbon")).toBe("+351");
      expect(getDefaultCallingCode("reykjavik")).toBe("+354");
      expect(getDefaultCallingCode("unknown")).toBe("+1");
    });
  });

  describe("Phone Sanitization and Cross-Stage Consistency", () => {
    it("strips redundant leading country code when pasted with plus or digits", () => {
      expect(sanitizePhoneNumber("+81 90 1234 5678", "+81")).toBe("90 1234 5678");
      expect(sanitizePhoneNumber("+819012345678", "+81")).toBe("9012345678");
      expect(sanitizePhoneNumber("00819012345678", "+81")).toBe("9012345678");
      expect(sanitizePhoneNumber("+1 (555) 019-9234", "+1")).toBe("(555) 019-9234");
    });

    it("preserves national number when already cleanly formatted", () => {
      expect(sanitizePhoneNumber("555-0199", "+1")).toBe("555-0199");
      expect(sanitizePhoneNumber("90 1234 5678", "+81")).toBe("90 1234 5678");
    });

    it("formats display phone consistently for Step 2, Step 3, and receipt", () => {
      expect(formatDisplayPhone("+81", "90 1234 5678")).toBe("+81 90 1234 5678");
      expect(formatDisplayPhone("+81", "+81 90 1234 5678")).toBe("+81 90 1234 5678");
      expect(formatDisplayPhone("+1", "555-0199")).toBe("+1 555-0199");
      expect(formatDisplayPhone("+351", "912 345 678")).toBe("+351 912 345 678");
    });

    it("formats Razorpay contact in clean E.164 compatible format", () => {
      expect(formatRazorpayContact("+81", "90 1234 5678")).toBe("+819012345678");
      expect(formatRazorpayContact("+81", "+81 90 1234 5678")).toBe("+819012345678");
      expect(formatRazorpayContact("+1", "(555) 019-9234")).toBe("+15550199234");
      expect(formatRazorpayContact("+351", "912 345 678")).toBe("+351912345678");
    });

    it("ensures contact is strictly consistent across all 4 checkout stages", () => {
      const rawInput: LeadTravellerForm = {
        fullName: "  Eleanor Vance  ",
        email: "  eleanor.vance@example.com  ",
        countryCode: "+81",
        phone: "+81 90 1234 5678", // Pasted with calling code
      };

      // Stage (a): Sanitized Form (Step 2)
      const sanitized = sanitizeLeadTravellerForm(rawInput);
      expect(sanitized.fullName).toBe("Eleanor Vance");
      expect(sanitized.email).toBe("eleanor.vance@example.com");
      expect(sanitized.countryCode).toBe("+81");
      expect(sanitized.phone).toBe("90 1234 5678");

      // Stage (b): Step 3 Summary
      const step3Display = `${sanitized.email} · ${formatDisplayPhone(sanitized.countryCode, sanitized.phone)}`;
      expect(step3Display).toBe("eleanor.vance@example.com · +81 90 1234 5678");

      // Stage (c): Order notes & Razorpay prefill
      const orderNotesPhone = formatDisplayPhone(sanitized.countryCode, sanitized.phone);
      const razorpayPrefillContact = formatRazorpayContact(sanitized.countryCode, sanitized.phone);
      expect(orderNotesPhone).toBe("+81 90 1234 5678");
      expect(razorpayPrefillContact).toBe("+819012345678");

      // Stage (d): Receipt Contact
      const receiptContact = `${sanitized.email} · ${formatDisplayPhone(sanitized.countryCode, sanitized.phone)}`;
      expect(receiptContact).toBe(step3Display);
    });
  });

  describe("Form Validation", () => {
    const validForm: LeadTravellerForm = {
      fullName: "Eleanor Vance",
      email: "eleanor.vance@example.com",
      countryCode: "+1",
      phone: "555-0199",
    };

    it("passes validation with complete valid details", () => {
      const errors = validateLeadTravellerForm(validForm);
      expect(Object.keys(errors).length).toBe(0);
    });

    it("requires full name", () => {
      const errorsEmpty = validateLeadTravellerForm({ ...validForm, fullName: "  " });
      expect(errorsEmpty.fullName).toBe("Please enter your full name");

      const errorsShort = validateLeadTravellerForm({ ...validForm, fullName: "A" });
      expect(errorsShort.fullName).toBe("Please enter a valid full name");
    });

    it("validates email address format", () => {
      const errorsEmpty = validateLeadTravellerForm({ ...validForm, email: "" });
      expect(errorsEmpty.email).toBe("Please enter your email address");

      const errorsInvalid1 = validateLeadTravellerForm({ ...validForm, email: "notanemail" });
      expect(errorsInvalid1.email).toContain("valid email address");

      const errorsInvalid2 = validateLeadTravellerForm({ ...validForm, email: "test@domain" });
      expect(errorsInvalid2.email).toContain("valid email address");

      const errorsValid = validateLeadTravellerForm({ ...validForm, email: "user@domain.co.uk" });
      expect(errorsValid.email).toBeUndefined();
    });

    it("requires country calling code", () => {
      const errors = validateLeadTravellerForm({ ...validForm, countryCode: "  " });
      expect(errors.countryCode).toBe("Please select a country calling code");
    });

    it("validates phone number presence, characters, and length", () => {
      const errorsEmpty = validateLeadTravellerForm({ ...validForm, phone: "" });
      expect(errorsEmpty.phone).toBe("Please enter your phone number");

      const errorsLetters = validateLeadTravellerForm({ ...validForm, phone: "12345abc" });
      expect(errorsLetters.phone).toBe("Phone number can only contain digits, spaces, and hyphens");

      const errorsTooShort = validateLeadTravellerForm({ ...validForm, phone: "123" });
      expect(errorsTooShort.phone).toBe("Please enter a valid phone number (6 to 15 digits)");

      // Valid international phone formats
      expect(validateLeadTravellerForm({ ...validForm, phone: "+1 (555) 019-9234" }).phone).toBeUndefined();
      expect(validateLeadTravellerForm({ ...validForm, phone: "090 1234 5678" }).phone).toBeUndefined();
      expect(validateLeadTravellerForm({ ...validForm, phone: "555-0199" }).phone).toBeUndefined();
    });

    it("preserves valid fields and isolates errors to invalid fields", () => {
      const partialForm: LeadTravellerForm = {
        fullName: "Eleanor Vance",
        email: "bad-email",
        countryCode: "+81",
        phone: "",
      };
      const errors = validateLeadTravellerForm(partialForm);
      expect(errors.fullName).toBeUndefined();
      expect(errors.countryCode).toBeUndefined();
      expect(errors.email).toBeDefined();
      expect(errors.phone).toBeDefined();
    });
  });
});

