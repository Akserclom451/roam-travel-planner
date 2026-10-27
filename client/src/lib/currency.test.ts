import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatEurPrice,
  getConversionRate,
  calculateItineraryAmounts,
  parseFrankfurterResponse,
  getRateStatusDescription,
  CURRENCIES,
  type RatesState,
} from "./currency";

describe("ROAM Currency & Pricing Logic", () => {
  const mockLiveRatesState: RatesState = {
    rates: { EUR: 1, JPY: 176.18, ISK: 136.54 },
    date: "2026-10-26",
    status: "live",
    lastUpdated: 1700000000000,
  };

  const mockFallbackRatesState: RatesState = {
    rates: { EUR: 1, JPY: 1, ISK: 1 },
    date: null,
    status: "fallback",
    lastUpdated: null,
  };

  const mockStaleRatesState: RatesState = {
    rates: { EUR: 1, JPY: 170.5, ISK: 135.0 },
    date: "2026-10-20",
    status: "stale",
    lastUpdated: 1699000000000,
  };

  describe("Requirement 4: Formatting and conversion with Intl.NumberFormat", () => {
    it("formats EUR with € symbol and no decimals", () => {
      expect(formatCurrency(42, "EUR")).toBe("€42");
      expect(formatCurrency(1250, "EUR")).toBe("€1,250");
    });

    it("formats JPY with ¥ symbol and commas", () => {
      expect(formatCurrency(7400, "JPY")).toBe("¥7,400");
      expect(formatCurrency(1000000, "JPY")).toBe("¥1,000,000");
    });

    it("formats ISK with narrow kr symbol and thousands separator", () => {
      const formatted = formatCurrency(5735, "ISK");
      // Intl format may use non-breaking space
      expect(formatted.replace(/\u00a0/g, " ")).toBe("kr 5,735");
    });

    it("converts base EUR amounts accurately into selected currencies", () => {
      // 42 EUR tea ceremony
      const eurResult = formatEurPrice(42, "EUR", mockLiveRatesState);
      expect(eurResult.formatted).toBe("€42");
      expect(eurResult.effectiveCurrency).toBe("EUR");
      expect(eurResult.isConverted).toBe(true);

      const jpyResult = formatEurPrice(42, "JPY", mockLiveRatesState);
      // 42 * 176.18 = 7399.56 -> rounded to 7400
      expect(jpyResult.formatted).toBe("¥7,400");
      expect(jpyResult.effectiveCurrency).toBe("JPY");

      const iskResult = formatEurPrice(42, "ISK", mockLiveRatesState);
      // 42 * 136.54 = 5734.68 -> rounded to 5735
      expect(iskResult.formatted.replace(/\u00a0/g, " ")).toBe("kr 5,735");
      expect(iskResult.effectiveCurrency).toBe("ISK");
    });
  });

  describe("Requirement 3 & 6: Frankfurter API parsing, validation & safe fallbacks", () => {
    it("parses valid Frankfurter v2 array format", () => {
      const sampleV2 = [
        { date: "2026-10-26", base: "EUR", quote: "ISK", rate: 136.54 },
        { date: "2026-10-26", base: "EUR", quote: "JPY", rate: 176.18 },
      ];
      const parsed = parseFrankfurterResponse(sampleV2);
      expect(parsed).not.toBeNull();
      expect(parsed?.rates.EUR).toBe(1);
      expect(parsed?.rates.JPY).toBe(176.18);
      expect(parsed?.rates.ISK).toBe(136.54);
      expect(parsed?.date).toBe("2026-10-26");
    });

    it("parses valid Frankfurter v1 object format", () => {
      const sampleV1 = {
        amount: 1,
        base: "EUR",
        date: "2026-10-26",
        rates: { JPY: 176.18, ISK: 136.54 },
      };
      const parsed = parseFrankfurterResponse(sampleV1);
      expect(parsed).not.toBeNull();
      expect(parsed?.rates.JPY).toBe(176.18);
      expect(parsed?.rates.ISK).toBe(136.54);
    });

    it("rejects invalid or corrupted responses", () => {
      expect(parseFrankfurterResponse(null)).toBeNull();
      expect(parseFrankfurterResponse({})).toBeNull();
      expect(parseFrankfurterResponse([])).toBeNull();
      expect(parseFrankfurterResponse([{ quote: "JPY", rate: -10 }])).toBeNull();
      expect(parseFrankfurterResponse([{ quote: "XYZ", rate: 100 }])).toBeNull();
    });

    it("falls back to EUR safely when conversion rates are unavailable, never showing unconverted EUR with JPY symbol", () => {
      const fallbackConversion = formatEurPrice(42, "JPY", mockFallbackRatesState);
      // Critical check: Must NOT format 42 as "¥42"
      expect(fallbackConversion.effectiveCurrency).toBe("EUR");
      expect(fallbackConversion.formatted).toBe("€42");
      expect(fallbackConversion.isConverted).toBe(false);
    });

    it("honestly marks stale rates with cached date", () => {
      const staleDesc = getRateStatusDescription(mockStaleRatesState, "JPY");
      expect(staleDesc).toContain("2026-10-20");
      expect(staleDesc.toLowerCase()).toContain("stale");
    });

    it("identifies live rates as reference rates with date", () => {
      const liveDesc = getRateStatusDescription(mockLiveRatesState, "JPY");
      expect(liveDesc).toContain("2026-10-26");
      expect(liveDesc).toContain("ECB reference rate");
    });
  });

  describe("Requirement 5: Consistency across quantities, day subtotals, and totals", () => {
    const mockActivities = [
      { id: "kyoto-tea", price: 42 },
      { id: "kyoto-fushimi", price: 28 },
    ];

    const mockItinerary = {
      "Day 1": [
        { activityId: "kyoto-tea", quantity: 2 }, // 2 * 42 = 84 EUR
      ],
      "Day 2": [
        { activityId: "kyoto-fushimi", quantity: 1 }, // 1 * 28 = 28 EUR
      ],
      "Day 3": [],
    };

    it("calculates exact EUR totals and converts without premature item rounding", () => {
      const result = calculateItineraryAmounts(
        mockItinerary,
        mockActivities,
        "JPY",
        mockLiveRatesState
      );

      // Total EUR = 84 + 28 = 112 EUR
      expect(result.totalCostEur).toBe(112);
      // Converted total = 112 * 176.18 = 19732.16
      expect(result.totalCost).toBeCloseTo(19732.16, 2);
      expect(formatCurrency(result.totalCost, "JPY")).toBe("¥19,732");

      // Day 1: 84 * 176.18 = 14799.12 -> ¥14,799
      expect(formatCurrency(result.daySubtotals["Day 1"], "JPY")).toBe("¥14,799");
      // Day 2: 28 * 176.18 = 4933.04 -> ¥4,933
      expect(formatCurrency(result.daySubtotals["Day 2"], "JPY")).toBe("¥4,933");
    });

    it("consistently computes budget comparison in the same currency", () => {
      const result = calculateItineraryAmounts(
        mockItinerary,
        mockActivities,
        "EUR",
        mockLiveRatesState
      );
      expect(result.totalCost).toBe(112);

      const budget = 100;
      const budgetExceeded = result.totalCost > budget;
      expect(budgetExceeded).toBe(true);
      expect(result.totalCost - budget).toBe(12);
    });
  });
});
