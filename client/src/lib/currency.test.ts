import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatEurPrice,
  formatExchangeRate,
  getConversionRate,
  calculateItineraryAmounts,
  parseFrankfurterResponse,
  getRateStatusDescription,
  CURRENCIES,
  DEFAULT_RATES_STATE,
  compareBudget,
  convertBudgetBetweenCurrencies,
  isValidRateDate,
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

    it("regression test: loading state without cache never converts JPY/ISK with 1:1 rate", () => {
      // 1. Test DEFAULT_RATES_STATE (initial state on mount before network responds)
      const defaultStateConversion = formatEurPrice(42, "JPY", DEFAULT_RATES_STATE);
      expect(defaultStateConversion.effectiveCurrency).toBe("EUR");
      expect(defaultStateConversion.formatted).toBe("€42");
      expect(defaultStateConversion.isConverted).toBe(false);

      const iskDefaultConversion = formatEurPrice(86, "ISK", DEFAULT_RATES_STATE);
      expect(iskDefaultConversion.effectiveCurrency).toBe("EUR");
      expect(iskDefaultConversion.formatted).toBe("€86");
      expect(iskDefaultConversion.isConverted).toBe(false);

      // 2. Test uninitialized rates where rates were 1 but date was null and status was loading
      const mockUninitializedLoading: RatesState = {
        rates: { EUR: 1, JPY: 1, ISK: 1 },
        date: null,
        status: "loading",
        lastUpdated: null,
      };
      const uninitJpy = formatEurPrice(42, "JPY", mockUninitializedLoading);
      expect(uninitJpy.effectiveCurrency).toBe("EUR");
      expect(uninitJpy.formatted).toBe("€42");
      expect(uninitJpy.formatted).not.toBe("¥42");
      expect(uninitJpy.isConverted).toBe(false);

      const uninitIsk = formatEurPrice(86, "ISK", mockUninitializedLoading);
      expect(uninitIsk.effectiveCurrency).toBe("EUR");
      expect(uninitIsk.formatted).toBe("€86");
      expect(uninitIsk.formatted).not.toContain("kr 86");
      expect(uninitIsk.isConverted).toBe(false);
    });

    it("preserves valid cached rates during background refresh loading state", () => {
      // When background re-fetching happens while valid cached rates exist
      const mockRefreshingCachedState: RatesState = {
        rates: { EUR: 1, JPY: 176.18, ISK: 136.54 },
        date: "2026-10-26",
        status: "loading",
        lastUpdated: Date.now() - 3600000,
      };

      const result = formatEurPrice(42, "JPY", mockRefreshingCachedState);
      expect(result.effectiveCurrency).toBe("JPY");
      expect(result.formatted).toBe("¥7,400");
      expect(result.isConverted).toBe(true);

      const statusDesc = getRateStatusDescription(mockRefreshingCachedState, "JPY");
      expect(statusDesc).toContain("2026-10-26");
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

    it("calculates display-consistent totals matching line items without discrepancy", () => {
      const result = calculateItineraryAmounts(
        mockItinerary,
        mockActivities,
        "JPY",
        mockLiveRatesState
      );

      // Total EUR = 84 + 28 = 112 EUR
      expect(result.totalCostEur).toBe(112);
      // Day 1: unitPrice Math.round(42 * 176.18) = 7400 JPY * 2 = 14,800 JPY
      expect(result.daySubtotals["Day 1"]).toBe(14800);
      expect(formatCurrency(result.daySubtotals["Day 1"], "JPY")).toBe("¥14,800");

      // Day 2: unitPrice Math.round(28 * 176.18) = 4933 JPY * 1 = 4,933 JPY
      expect(result.daySubtotals["Day 2"]).toBe(4933);
      expect(formatCurrency(result.daySubtotals["Day 2"], "JPY")).toBe("¥4,933");

      // Sum of day subtotals equals totalCost: 14800 + 4933 = 19733 JPY
      expect(result.totalCost).toBe(19733);
      expect(formatCurrency(result.totalCost, "JPY")).toBe("¥19,733");
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

  describe("Requirement 7: Date validation and cross-currency budget comparison", () => {
    it("validates standard calendar dates strictly", () => {
      expect(isValidRateDate("2026-10-26")).toBe(true);
      expect(isValidRateDate("2024-02-29")).toBe(true); // leap year
      expect(isValidRateDate("2023-02-29")).toBe(false); // non-leap year
      expect(isValidRateDate("not-a-date")).toBe(false);
      expect(isValidRateDate("")).toBe(false);
      expect(isValidRateDate(null)).toBe(false);
    });

    it("compares budget across currencies accurately", () => {
      // 100 EUR budget vs 112 EUR total -> exceeded by 12 EUR
      const resEur = compareBudget("100", "EUR", 112, 112, "EUR", mockLiveRatesState);
      expect(resEur.status).toBe("exceeded");
      expect(resEur.statusHeading).toBe("Over budget");
      expect(resEur.summaryText).toContain("12");

      // 25,000 JPY budget vs 112 EUR trip (19,733 JPY) -> within budget
      const resJpy = compareBudget("25000", "JPY", 112, 19733, "JPY", mockLiveRatesState);
      expect(resJpy.status).toBe("within");
      expect(resJpy.statusHeading).toBe("Within budget");

      // Budget input empty -> status unset
      const resEmpty = compareBudget("", "EUR", 112, 112, "EUR", mockLiveRatesState);
      expect(resEmpty.status).toBe("unset");
    });

    it("converts budget between currencies without precision loss", () => {
      // 100 EUR to JPY at 176.18 -> 17618 JPY
      const jpy = convertBudgetBetweenCurrencies(100, "EUR", "JPY", mockLiveRatesState);
      expect(jpy).toBe(17618);

      // Same currency returns original amount
      expect(convertBudgetBetweenCurrencies(500, "EUR", "EUR", mockLiveRatesState)).toBe(500);
    });

    it("formats exchange rates with 2 decimal places", () => {
      expect(formatExchangeRate(176.18, "JPY")).toBe("¥176.18");
      expect(formatExchangeRate(136.54, "ISK")).toBe("kr 136.54");
    });

    it("describes cached rate status accurately without mentioning failure", () => {
      const cachedState: RatesState = {
        rates: { EUR: 1, JPY: 176.18, ISK: 136.54 },
        date: "2026-10-26",
        status: "cached",
        lastUpdated: 1700000000000,
      };
      const desc = getRateStatusDescription(cachedState, "JPY");
      expect(desc).toContain("2026-10-26");
      expect(desc.toLowerCase()).toContain("cached");
      expect(desc.toLowerCase()).not.toContain("failed");
    });

    it("computes unitPrices and lineTotals for 3 x kyoto-tea in JPY with sum matching totalCost", () => {
      const singleActivityItinerary = {
        "Day 1": [{ activityId: "kyoto-tea", quantity: 3 }],
        "Day 2": [],
        "Day 3": [],
      };
      const result = calculateItineraryAmounts(
        singleActivityItinerary,
        [{ id: "kyoto-tea", price: 42 }],
        "JPY",
        mockLiveRatesState
      );
      // unit price = Math.round(42 * 176.18) = 7400
      expect(result.unitPrices["kyoto-tea"]).toBe(7400);
      // line total = 7400 * 3 = 22200
      expect(result.lineTotals["Day 1-kyoto-tea"]).toBe(22200);
      expect(result.daySubtotals["Day 1"]).toBe(22200);
      expect(result.totalCost).toBe(22200);
      const sumOfLines = Object.values(result.lineTotals).reduce((a, b) => a + b, 0);
      expect(sumOfLines).toBe(result.totalCost);
    });

    it("round-trips budget conversion JPY -> EUR -> JPY within 1 of original 100,000", () => {
      const eur = convertBudgetBetweenCurrencies(100000, "JPY", "EUR", mockLiveRatesState);
      expect(eur).not.toBeNull();
      const jpy = convertBudgetBetweenCurrencies(eur!, "EUR", "JPY", mockLiveRatesState);
      expect(jpy).not.toBeNull();
      expect(Math.abs(jpy! - 100000)).toBeLessThanOrEqual(1);
    });

    it("evaluates boundary comparison correctly: 22199 is exceeded (1 over) and 22200 is within (0 left)", () => {
      const exceededRes = compareBudget("22199", "JPY", 126, 22200, "JPY", mockLiveRatesState);
      expect(exceededRes.status).toBe("exceeded");
      expect(exceededRes.summaryText).toContain("1 over");

      const withinRes = compareBudget("22200", "JPY", 126, 22200, "JPY", mockLiveRatesState);
      expect(withinRes.status).toBe("within");
      expect(withinRes.summaryText).toContain("0 left");
    });

    it("marks compareBudget as unavailable when budget is JPY and rates are in fallback", () => {
      const res = compareBudget("25000", "JPY", 126, 126, "EUR", mockFallbackRatesState);
      expect(res.status).toBe("unavailable");
      expect(res.isComparisonAvailable).toBe(false);
    });
  });
});
