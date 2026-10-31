export type LeadTravellerForm = {
  fullName: string;
  email: string;
  countryCode: string;
  phone: string;
};

export type LeadTravellerErrors = {
  fullName?: string;
  email?: string;
  countryCode?: string;
  phone?: string;
};

export type CountryCallingCode = {
  code: string;
  country: string;
  flag: string;
};

export const COUNTRY_CALLING_CODES: CountryCallingCode[] = [
  { code: "+1", country: "United States / Canada", flag: "🇺🇸" },
  { code: "+44", country: "United Kingdom", flag: "🇬🇧" },
  { code: "+81", country: "Japan", flag: "🇯🇵" },
  { code: "+351", country: "Portugal", flag: "🇵🇹" },
  { code: "+354", country: "Iceland", flag: "🇮🇸" },
  { code: "+61", country: "Australia", flag: "🇦🇺" },
  { code: "+49", country: "Germany", flag: "🇩🇪" },
  { code: "+33", country: "France", flag: "🇫🇷" },
  { code: "+34", country: "Spain", flag: "🇪🇸" },
  { code: "+39", country: "Italy", flag: "🇮🇹" },
  { code: "+31", country: "Netherlands", flag: "🇳🇱" },
  { code: "+41", country: "Switzerland", flag: "🇨🇭" },
  { code: "+353", country: "Ireland", flag: "🇮🇪" },
  { code: "+64", country: "New Zealand", flag: "🇳🇿" },
  { code: "+65", country: "Singapore", flag: "🇸🇬" },
  { code: "+91", country: "India", flag: "🇮🇳" },
  { code: "+82", country: "South Korea", flag: "🇰🇷" },
  { code: "+971", country: "United Arab Emirates", flag: "🇦🇪" },
  { code: "+46", country: "Sweden", flag: "🇸🇪" },
  { code: "+47", country: "Norway", flag: "🇳🇴" },
  { code: "+45", country: "Denmark", flag: "🇩🇰" },
  { code: "+32", country: "Belgium", flag: "🇧🇪" },
  { code: "+43", country: "Austria", flag: "🇦🇹" },
  { code: "+55", country: "Brazil", flag: "🇧🇷" },
  { code: "+52", country: "Mexico", flag: "🇲🇽" },
];

export function getDefaultCallingCode(destinationId: string): string {
  if (destinationId === "kyoto") return "+81";
  if (destinationId === "lisbon") return "+351";
  if (destinationId === "reykjavik") return "+354";
  return "+1";
}

/**
 * Calculates the total party size / travellers count directly from the itinerary activities.
 * If there are planned activities, the booking party corresponds to the maximum participant
 * quantity chosen across planned activities. If none, defaults to 1.
 */
export function calculatePartySize(quantities: number[]): number {
  if (!quantities || quantities.length === 0) return 1;
  return Math.max(...quantities, 1);
}

/**
 * Validates lead traveller form fields.
 * Ensures:
 * - Full name is not empty and has at least 2 characters
 * - Email follows basic email format (user@domain.tld)
 * - Country calling code is selected
 * - Phone number contains valid digits (6-15) and standard phone punctuation
 */
export function validateLeadTravellerForm(form: LeadTravellerForm): LeadTravellerErrors {
  const errors: LeadTravellerErrors = {};

  const trimmedName = (form.fullName || "").trim();
  if (!trimmedName) {
    errors.fullName = "Please enter your full name";
  } else if (trimmedName.length < 2) {
    errors.fullName = "Please enter a valid full name";
  }

  const trimmedEmail = (form.email || "").trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!trimmedEmail) {
    errors.email = "Please enter your email address";
  } else if (!emailRegex.test(trimmedEmail)) {
    errors.email = "Please enter a valid email address (e.g. name@example.com)";
  }

  const trimmedCode = (form.countryCode || "").trim();
  if (!trimmedCode) {
    errors.countryCode = "Please select a country calling code";
  }

  const trimmedPhone = (form.phone || "").trim();
  const digitsOnly = trimmedPhone.replace(/\D/g, "");
  const allowedChars = /^[\d\s\-()+.]+$/;

  if (!trimmedPhone) {
    errors.phone = "Please enter your phone number";
  } else if (!allowedChars.test(trimmedPhone)) {
    errors.phone = "Phone number can only contain digits, spaces, and hyphens";
  } else if (digitsOnly.length < 6 || digitsOnly.length > 15) {
    errors.phone = "Please enter a valid phone number (6 to 15 digits)";
  }

  return errors;
}
