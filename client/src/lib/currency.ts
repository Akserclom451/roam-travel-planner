/**
 * ROAM Currency Conversion & Formatting Utilities
 * Uses the official Frankfurter API (European Central Bank reference rates).
 * All activity catalog prices are denominated in base EUR as planning estimates.
 */

export type CurrencyCode = "EUR" | "JPY" | "ISK";

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  EUR: { code: "EUR", symbol: "€", name: "Euro" },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  ISK: { code: "ISK", symbol: "kr", name: "Icelandic Króna" },
};

export const CURRENCY_OPTIONS: CurrencyCode[] = ["JPY", "EUR", "ISK"];

export type RateStatus = "loading" | "cached" | "live" | "stale" | "fallback";

export interface RatesState {
  rates: Record<CurrencyCode, number>;
  date: string | null;
  status: RateStatus;
  lastUpdated: number | null;
  errorMessage?: string;
}

export const DEFAULT_RATES_STATE: RatesState = {
  rates: {
    EUR: 1,
    JPY: 0,
    ISK: 0,
  },
  date: null,
  status: "loading",
  lastUpdated: null,
};

const CACHE_STORAGE_KEY = "roam-exchange-rates-v2";

/**
 * Validates that a string is a strictly valid YYYY-MM-DD calendar date.
 */
export function isValidRateDate(dateStr: unknown): boolean {
  if (typeof dateStr !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (year < 2020 || year > 2050 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dateObj = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(dateObj.getTime())) return false;
  if (
    dateObj.getUTCFullYear() !== year ||
    dateObj.getUTCMonth() + 1 !== month ||
    dateObj.getUTCDate() !== day
  ) {
    return false;
  }
  return true;
}

/**
 * Validates and normalizes Frankfurter v2 response data:
 * Array<{ date: string; base: string; quote: string; rate: number }>
 * or v1 response data:
 * { amount: number; base: string; date: string; rates: { ISK?: number; JPY?: number } }
 */
export function parseFrankfurterResponse(data: unknown): {
  rates: Record<CurrencyCode, number>;
  date: string;
} | null {
  if (!data || typeof data !== "object") return null;

  // Frankfurter v2 format: array of quote objects
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    const rates: Record<CurrencyCode, number> = { EUR: 1, JPY: 0, ISK: 0 };
    let dateStr = "";

    for (const item of data) {
      if (
        item &&
        typeof item === "object" &&
        typeof item.quote === "string" &&
        typeof item.rate === "number" &&
        Number.isFinite(item.rate) &&
        item.rate > 0
      ) {
        const quote = item.quote.toUpperCase() as CurrencyCode;
        if (quote === "JPY" || quote === "ISK") {
          rates[quote] = item.rate;
        }
        if (typeof item.date === "string" && !dateStr) {
          dateStr = item.date;
        }
      }
    }

    if (rates.JPY > 0 && rates.ISK > 0 && dateStr && isValidRateDate(dateStr)) {
      return { rates, date: dateStr };
    }
  }

  // Frankfurter v1 format fallback: { date: string, rates: { ... } }
  const obj = data as Record<string, any>;
  if (
    typeof obj.date === "string" &&
    isValidRateDate(obj.date) &&
    obj.rates &&
    typeof obj.rates === "object"
  ) {
    const jpy = Number(obj.rates.JPY);
    const isk = Number(obj.rates.ISK);
    if (Number.isFinite(jpy) && jpy > 0 && Number.isFinite(isk) && isk > 0) {
      return {
        rates: { EUR: 1, JPY: jpy, ISK: isk },
        date: obj.date,
      };
    }
  }

  return null;
}

/**
 * Loads cached exchange rates from localStorage if available.
 */
export function loadCachedRates(): RatesState | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.rates &&
      typeof parsed.rates.JPY === "number" &&
      parsed.rates.JPY > 0 &&
      typeof parsed.rates.ISK === "number" &&
      parsed.rates.ISK > 0 &&
      isValidRateDate(parsed.date)
    ) {
      return {
        rates: {
          EUR: 1,
          JPY: parsed.rates.JPY,
          ISK: parsed.rates.ISK,
        },
        date: parsed.date,
        status: "cached",
        lastUpdated: parsed.lastUpdated || Date.now(),
      };
    }
  } catch {
    // Ignore storage parse errors
  }
  return null;
}

/**
 * Saves valid exchange rates to localStorage.
 */
export function saveCachedRates(rates: Record<CurrencyCode, number>, date: string) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(
      CACHE_STORAGE_KEY,
      JSON.stringify({
        rates,
        date,
        lastUpdated: Date.now(),
      })
    );
  } catch {
    // Ignore storage write errors (e.g., quota exceeded)
  }
}

/**
 * Fetches reference exchange rates from Frankfurter API v2 with automatic fallback to v1.
 */
export async function fetchExchangeRates(timeoutMs = 8000): Promise<{
  rates: Record<CurrencyCode, number>;
  date: string;
}> {
  const v2Url = "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=JPY,ISK";
  const v1Url = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY,ISK";

  // Try official v2 endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(v2Url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseFrankfurterResponse(data);
        if (parsed) return parsed;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Proceed to fallback endpoint
  }

  // Fallback to v1 endpoint
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resFallback = await fetch(v1Url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resFallback.ok) {
      throw new Error(`Frankfurter rate request failed with HTTP ${resFallback.status}`);
    }
    const dataFallback = await resFallback.json();
    const parsedFallback = parseFrankfurterResponse(dataFallback);
    if (!parsedFallback) {
      throw new Error("Invalid exchange rate payload received from rate provider");
    }
    return parsedFallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the effective conversion rate and the actual currency to display.
 * If target currency is JPY or ISK but rate data is not yet available and conversion
 * cannot proceed safely, falls back to EUR to avoid showing an unconverted EUR amount
 * with a JPY or ISK symbol.
 */
export function getConversionRate(
  targetCurrency: CurrencyCode,
  ratesState: RatesState
): {
  rate: number;
  effectiveCurrency: CurrencyCode;
  isConverted: boolean;
} {
  if (targetCurrency === "EUR") {
    return { rate: 1, effectiveCurrency: "EUR", isConverted: true };
  }

  const rate = ratesState.rates[targetCurrency];
  const hasValidRate =
    typeof rate === "number" &&
    Number.isFinite(rate) &&
    rate > 0 &&
    ratesState.date !== null &&
    isValidRateDate(ratesState.date) &&
    ratesState.status !== "fallback";

  if (hasValidRate) {
    return { rate, effectiveCurrency: targetCurrency, isConverted: true };
  }

  // Safe fallback: when conversion rate is missing/failed/loading without cache, display in base EUR
  // to avoid ever showing unconverted amounts with a misleading foreign currency symbol.
  return { rate: 1, effectiveCurrency: "EUR", isConverted: false };
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/**
 * Formats a monetary amount into a clean, localized string.
 * Uses Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
 * and prepends the symbol from CURRENCIES ("¥7,398", "€42", "kr 11,742").
 */
export function formatCurrency(amount: number, currencyCode: CurrencyCode): string {
  const symbol = CURRENCIES[currencyCode]?.symbol ?? currencyCode;
  if (!Number.isFinite(amount)) {
    return currencyCode === "ISK" ? `${symbol} 0` : `${symbol}0`;
  }

  const rounded = Math.round(amount);
  const isNegative = rounded < 0;
  const formattedAbs = numberFormatter.format(Math.abs(rounded));
  const prefix = isNegative ? "-" : "";

  return currencyCode === "ISK"
    ? `${prefix}${symbol} ${formattedAbs}`
    : `${prefix}${symbol}${formattedAbs}`;
}

/**
 * Formats a reference exchange rate with two decimal places.
 * Example: 176.18 -> "¥176.18", 136.54 -> "kr 136.54".
 */
export function formatExchangeRate(rate: number, currencyCode: CurrencyCode): string {
  const sym = CURRENCIES[currencyCode]?.symbol || currencyCode;
  const formatted = rate.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currencyCode === "ISK" ? `${sym} ${formatted}` : `${sym}${formatted}`;
}

/**
 * Calculates display-rounded unit price for a given activity.
 */
export function getConvertedUnitPrice(priceEur: number, rate: number): number {
  return Math.round(priceEur * rate);
}

/**
 * Calculates display line item total matching unitPrice * quantity arithmetic.
 */
export function getConvertedLineTotal(priceEur: number, quantity: number, rate: number): number {
  return getConvertedUnitPrice(priceEur, rate) * quantity;
}

/**
 * Converts a base EUR price into the target currency and formats it.
 */
export function formatEurPrice(
  amountEur: number,
  targetCurrency: CurrencyCode,
  ratesState: RatesState
): {
  formatted: string;
  amount: number;
  effectiveCurrency: CurrencyCode;
  isConverted: boolean;
} {
  const { rate, effectiveCurrency, isConverted } = getConversionRate(targetCurrency, ratesState);
  const convertedAmount = getConvertedUnitPrice(amountEur, rate);
  return {
    formatted: formatCurrency(convertedAmount, effectiveCurrency),
    amount: convertedAmount,
    effectiveCurrency,
    isConverted,
  };
}

/**
 * Calculates day subtotals, item totals, and overall total following the display-consistent
 * integer arithmetic policy:
 * displayed_unit_price = Math.round(priceEur * rate)
 * displayed_line_total = displayed_unit_price * quantity
 * daySubtotal = sum(displayed_line_total)
 * totalCost = sum(daySubtotal)
 * This guarantees zero discrepancy between line items and totals in all views.
 */
export function calculateItineraryAmounts(
  itinerary: Record<string, { activityId: string; quantity: number }[]>,
  activities: { id: string; price: number }[],
  targetCurrency: CurrencyCode,
  ratesState: RatesState
): {
  daySubtotals: Record<string, number>;
  totalCost: number;
  totalCostEur: number;
  effectiveCurrency: CurrencyCode;
  isConverted: boolean;
  unitPrices: Record<string, number>;
  lineTotals: Record<string, number>;
} {
  const { rate, effectiveCurrency, isConverted } = getConversionRate(targetCurrency, ratesState);
  const daySubtotals: Record<string, number> = {};
  const unitPrices: Record<string, number> = {};
  const lineTotals: Record<string, number> = {};
  let totalCost = 0;
  let totalCostEur = 0;

  for (const activity of activities) {
    unitPrices[activity.id] = getConvertedUnitPrice(activity.price, rate);
  }

  for (const [day, items] of Object.entries(itinerary)) {
    let dayTotal = 0;
    for (const item of items) {
      const activity = activities.find((a) => a.id === item.activityId);
      if (activity) {
        const unitPrice = unitPrices[activity.id] ?? getConvertedUnitPrice(activity.price, rate);
        const lineTotal = unitPrice * item.quantity;
        lineTotals[`${day}-${activity.id}`] = lineTotal;
        dayTotal += lineTotal;
        totalCostEur += activity.price * item.quantity;
      }
    }
    daySubtotals[day] = dayTotal;
    totalCost += dayTotal;
  }

  return {
    daySubtotals,
    totalCost,
    totalCostEur,
    effectiveCurrency,
    isConverted,
    unitPrices,
    lineTotals,
  };
}

/**
 * Generates honest status labels for reference rates.
 */
export function getRateStatusDescription(ratesState: RatesState, selectedCurrency: CurrencyCode): string {
  if (ratesState.status === "fallback") {
    return "Live conversion unavailable · Showing EUR estimates";
  }

  if (selectedCurrency === "EUR" && ratesState.status !== "loading") {
    return "Base reference currency (EUR)";
  }

  switch (ratesState.status) {
    case "live":
      return ratesState.date
        ? `ECB reference rate: ${ratesState.date} · Planning estimates`
        : "Live ECB reference rate · Planning estimates";
    case "cached":
      return ratesState.date
        ? `ECB reference rate: ${ratesState.date} (cached) · Planning estimates`
        : "Cached reference rate · Planning estimates";
    case "stale":
      return ratesState.date
        ? `Stale reference rate from ${ratesState.date} (cached, refresh failed) · Planning estimates`
        : "Stale reference rate (cached, refresh failed) · Planning estimates";
    case "loading":
      return ratesState.date
        ? `Fetching reference exchange rates (using cached rate from ${ratesState.date})...`
        : "Fetching reference exchange rates · Displaying base EUR estimates";
    default:
      return "Live conversion unavailable · Showing EUR estimates";
  }
}

export interface BudgetComparisonResult {
  budgetInput: string;
  budgetNumber: number | null;
  budgetCurrency: CurrencyCode;
  budgetEur: number | null;
  budgetInDisplayCurrency: number | null;
  totalCostInDisplayCurrency: number;
  totalCostEur: number;
  isComparisonAvailable: boolean;
  status: "unset" | "within" | "exceeded" | "unavailable";
  statusHeading: string;
  meterPercent: number;
  summaryText: string;
}

/**
 * Compares user budget with itinerary total in underlying base EUR.
 * If rates are unavailable or invalid, marks comparison as unavailable.
 */
export function compareBudget(
  rawInput: string,
  budgetCurrency: CurrencyCode,
  totalCostEur: number,
  totalCostInDisplayCurrency: number,
  displayCurrency: CurrencyCode,
  ratesState: RatesState
): BudgetComparisonResult {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {
      budgetInput: rawInput,
      budgetNumber: null,
      budgetCurrency,
      budgetEur: null,
      budgetInDisplayCurrency: null,
      totalCostInDisplayCurrency,
      totalCostEur,
      isComparisonAvailable: true,
      status: "unset",
      statusHeading: "Not set",
      meterPercent: totalCostEur > 0 ? 100 : 0,
      summaryText: "Add a limit to keep your trip on track.",
    };
  }

  const budgetNumber = Math.max(0, Number(trimmed) || 0);

  // Convert budget to base EUR
  let budgetEur: number | null = null;
  if (budgetCurrency === "EUR") {
    budgetEur = budgetNumber;
  } else {
    const bRate = ratesState.rates[budgetCurrency];
    const isRateValid =
      typeof bRate === "number" &&
      Number.isFinite(bRate) &&
      bRate > 0 &&
      ratesState.date !== null &&
      isValidRateDate(ratesState.date) &&
      ratesState.status !== "fallback";
    if (isRateValid) {
      budgetEur = budgetNumber / bRate;
    }
  }

  // If rate is missing or invalid, comparison is unavailable
  if (budgetEur === null) {
    return {
      budgetInput: rawInput,
      budgetNumber,
      budgetCurrency,
      budgetEur: null,
      budgetInDisplayCurrency: null,
      totalCostInDisplayCurrency,
      totalCostEur,
      isComparisonAvailable: false,
      status: "unavailable",
      statusHeading: "Comparison unavailable",
      meterPercent: 0,
      summaryText: `Exchange rate unavailable to compare ${formatCurrency(budgetNumber, budgetCurrency)} with trip total.`,
    };
  }

  const { rate: displayRate } = getConversionRate(displayCurrency, ratesState);
  const budgetInDisplayCurrency =
    budgetCurrency === displayCurrency
      ? budgetNumber
      : Math.round(budgetEur * displayRate);

  const exceeded = totalCostInDisplayCurrency > budgetInDisplayCurrency;
  const diffInDisplayCurrency = Math.abs(totalCostInDisplayCurrency - budgetInDisplayCurrency);
  const meterPercent =
    budgetInDisplayCurrency === 0
      ? totalCostInDisplayCurrency > 0
        ? 100
        : 0
      : Math.min(100, (totalCostInDisplayCurrency / budgetInDisplayCurrency) * 100);

  let summaryText = "";
  if (budgetCurrency === displayCurrency) {
    summaryText = `${formatCurrency(totalCostInDisplayCurrency, displayCurrency)} of ${formatCurrency(budgetInDisplayCurrency, displayCurrency)} · ${
      exceeded
        ? `${formatCurrency(diffInDisplayCurrency, displayCurrency)} over`
        : `${formatCurrency(diffInDisplayCurrency, displayCurrency)} left`
    }`;
  } else {
    summaryText = `${formatCurrency(totalCostInDisplayCurrency, displayCurrency)} of ${formatCurrency(budgetInDisplayCurrency, displayCurrency)} (orig. ${formatCurrency(budgetNumber, budgetCurrency)}) · ${
      exceeded
        ? `${formatCurrency(diffInDisplayCurrency, displayCurrency)} over`
        : `${formatCurrency(diffInDisplayCurrency, displayCurrency)} left`
    }`;
  }

  return {
    budgetInput: rawInput,
    budgetNumber,
    budgetCurrency,
    budgetEur,
    budgetInDisplayCurrency,
    totalCostInDisplayCurrency,
    totalCostEur,
    isComparisonAvailable: true,
    status: exceeded ? "exceeded" : "within",
    statusHeading: exceeded ? "Over budget" : "Within budget",
    meterPercent,
    summaryText,
  };
}

/**
 * Converts a budget amount between currencies.
 */
export function convertBudgetBetweenCurrencies(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  ratesState: RatesState
): number | null {
  if (fromCurrency === toCurrency) return amount;

  let amountEur: number | null = null;
  if (fromCurrency === "EUR") {
    amountEur = amount;
  } else {
    const rateFrom = ratesState.rates[fromCurrency];
    if (
      typeof rateFrom === "number" &&
      rateFrom > 0 &&
      ratesState.date &&
      isValidRateDate(ratesState.date) &&
      ratesState.status !== "fallback"
    ) {
      amountEur = amount / rateFrom;
    }
  }

  if (amountEur === null) return null;

  if (toCurrency === "EUR") {
    return Math.round(amountEur * 100) / 100;
  }
  const rateTo = ratesState.rates[toCurrency];
  if (
    typeof rateTo === "number" &&
    rateTo > 0 &&
    ratesState.date &&
    isValidRateDate(ratesState.date) &&
    ratesState.status !== "fallback"
  ) {
    return Math.round(amountEur * rateTo);
  }

  return null;
}
