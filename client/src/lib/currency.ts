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

export type RateStatus = "loading" | "live" | "stale" | "fallback";

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
    JPY: 1,
    ISK: 1,
  },
  date: null,
  status: "loading",
  lastUpdated: null,
};

const CACHE_STORAGE_KEY = "roam-exchange-rates-v2";

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

    if (rates.JPY > 0 && rates.ISK > 0 && dateStr) {
      return { rates, date: dateStr };
    }
  }

  // Frankfurter v1 format fallback: { date: string, rates: { ... } }
  const obj = data as Record<string, any>;
  if (
    typeof obj.date === "string" &&
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
      typeof parsed.date === "string"
    ) {
      return {
        rates: {
          EUR: 1,
          JPY: parsed.rates.JPY,
          ISK: parsed.rates.ISK,
        },
        date: parsed.date,
        status: "stale",
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
export async function fetchExchangeRates(): Promise<{
  rates: Record<CurrencyCode, number>;
  date: string;
}> {
  const v2Url = "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=JPY,ISK";
  const v1Url = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY,ISK";

  // Try official v2 endpoint
  try {
    const res = await fetch(v2Url, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      const parsed = parseFrankfurterResponse(data);
      if (parsed) return parsed;
    }
  } catch {
    // Proceed to fallback endpoint
  }

  // Fallback to v1 endpoint
  const resFallback = await fetch(v1Url, {
    headers: { Accept: "application/json" },
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
  if (typeof rate === "number" && Number.isFinite(rate) && rate > 0 && ratesState.status !== "fallback") {
    return { rate, effectiveCurrency: targetCurrency, isConverted: true };
  }

  // Safe fallback: when conversion rate is missing/failed, display in base EUR
  // to avoid ever showing unconverted amounts with a misleading foreign currency symbol.
  return { rate: 1, effectiveCurrency: "EUR", isConverted: false };
}

/**
 * Formats a monetary amount into a clean, localized string using Intl.NumberFormat.
 * Uses narrowSymbol for standard display: "€42", "¥7,400", "kr 5,735".
 */
export function formatCurrency(amount: number, currencyCode: CurrencyCode): string {
  if (!Number.isFinite(amount)) return `${CURRENCIES[currencyCode].symbol}0`;
  
  // Consistent rounding for integer display (JPY and ISK are zero-decimal, EUR display rounded)
  const rounded = Math.round(amount);

  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
    return formatter.format(rounded);
  } catch {
    // Fallback if Intl.NumberFormat encounters issues with narrowSymbol in older runtimes
    const sym = CURRENCIES[currencyCode]?.symbol || currencyCode;
    const formattedNum = rounded.toLocaleString("en-US");
    return currencyCode === "ISK" ? `${sym} ${formattedNum}` : `${sym}${formattedNum}`;
  }
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
  const convertedAmount = amountEur * rate;
  return {
    formatted: formatCurrency(convertedAmount, effectiveCurrency),
    amount: convertedAmount,
    effectiveCurrency,
    isConverted,
  };
}

/**
 * Calculates day subtotals in base EUR and converts without premature item rounding.
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
} {
  const { rate, effectiveCurrency, isConverted } = getConversionRate(targetCurrency, ratesState);
  const daySubtotals: Record<string, number> = {};
  let totalCostEur = 0;

  for (const [day, items] of Object.entries(itinerary)) {
    let dayTotalEur = 0;
    for (const item of items) {
      const activity = activities.find((a) => a.id === item.activityId);
      if (activity) {
        dayTotalEur += activity.price * item.quantity;
      }
    }
    daySubtotals[day] = dayTotalEur * rate;
    totalCostEur += dayTotalEur;
  }

  const totalCost = totalCostEur * rate;

  return {
    daySubtotals,
    totalCost,
    totalCostEur,
    effectiveCurrency,
    isConverted,
  };
}

/**
 * Generates honest status labels for reference rates.
 */
export function getRateStatusDescription(ratesState: RatesState, selectedCurrency: CurrencyCode): string {
  if (selectedCurrency === "EUR") {
    return "Base reference currency (EUR)";
  }

  switch (ratesState.status) {
    case "live":
      return ratesState.date
        ? `ECB reference rate: ${ratesState.date} · Planning estimates`
        : "Live ECB reference rate · Planning estimates";
    case "stale":
      return ratesState.date
        ? `Stale reference rate from ${ratesState.date} (cached, refresh failed) · Planning estimates`
        : "Stale reference rate (cached, refresh failed) · Planning estimates";
    case "loading":
      return "Fetching reference exchange rates...";
    case "fallback":
    default:
      return "Live conversion unavailable · Displaying base EUR estimates";
  }
}
