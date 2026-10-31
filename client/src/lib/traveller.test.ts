import { describe, expect, it } from "vitest";
import {
  calculatePartySize,
  getDefaultCallingCode,
  validateLeadTravellerForm,
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
