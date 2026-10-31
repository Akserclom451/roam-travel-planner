import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Filter,
  GripVertical,
  Heart,
  Mail,
  MapPin,
  Menu,
  Navigation,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  Wallet,
  X,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  type CurrencyCode,
  type RatesState,
  CURRENCIES,
  CURRENCY_OPTIONS,
  DEFAULT_RATES_STATE,
  calculateItineraryAmounts,
  compareBudget,
  fetchExchangeRates,
  formatCurrency,
  formatExchangeRate,
  getConversionRate,
  getConvertedLineTotal,
  getConvertedUnitPrice,
  getRateStatusDescription,
  loadCachedRates,
  saveCachedRates,
} from "@/lib/currency";
import {
  type CountryCallingCode,
  type LeadTravellerErrors,
  type LeadTravellerForm,
  COUNTRY_CALLING_CODES,
  calculatePartySize,
  getDefaultCallingCode,
  validateLeadTravellerForm,
} from "@/lib/traveller";

type DestinationId = "kyoto" | "lisbon" | "reykjavik";
type DayId = "Day 1" | "Day 2" | "Day 3";
type Category = "All" | "Culture" | "Food" | "Outdoors" | "Slow travel";
type PriceFilter = "All" | "under30" | "30to70" | "over70";

type Currency = {
  code: CurrencyCode;
  symbol: string;
};

type SavedPlan = {
  id: string;
  destinationId: DestinationId;
  itinerary: Record<DayId, PlannedActivity[]>;
  budgetInput: string;
  budgetCurrency?: CurrencyCode;
  createdAt: number;
};

function normalizeSavedPlan(plan: SavedPlan): SavedPlan {
  if (plan.budgetCurrency && (plan.budgetCurrency === "EUR" || plan.budgetCurrency === "JPY" || plan.budgetCurrency === "ISK")) {
    return plan;
  }
  const defaultCurrency: CurrencyCode =
    plan.destinationId === "kyoto" ? "JPY" : plan.destinationId === "reykjavik" ? "ISK" : "EUR";
  return {
    ...plan,
    budgetCurrency: defaultCurrency,
  };
}

type CheckoutStep = "review" | "traveller" | "payment-placeholder";

type Activity = {
  id: string;
  name: string;
  category: Exclude<Category, "All">;
  description: string;
  details: string;
  duration: string;
  price: number;
  location: string;
  image: string;
  accent: string;
};

type PlannedActivity = {
  activityId: string;
  quantity: number;
};

type ActivitySchedule = {
  startMinutes: number;
  durationMinutes: number;
  label: string;
};

type Destination = {
  id: DestinationId;
  name: string;
  country: string;
  days: string;
  image: string;
  note: string;
  currency: Currency;
};

const destinations: Destination[] = [
  {
    id: "kyoto",
    name: "Kyoto",
    country: "Japan",
    days: "3 days",
    image: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=86",
    note: "Temple paths, quiet lanes, and small rituals.",
    currency: { code: "JPY", symbol: "¥" },
  },
  {
    id: "lisbon",
    name: "Lisbon",
    country: "Portugal",
    days: "3 days",
    image: "https://images.unsplash.com/photo-1509840841025-9088ba78a826?auto=format&fit=crop&w=1200&q=86",
    note: "Sun-warmed tiles, sea air, and late dinners.",
    currency: { code: "EUR", symbol: "€" },
  },
  {
    id: "reykjavik",
    name: "Reykjavík",
    country: "Iceland",
    days: "3 days",
    image: "https://images.unsplash.com/photo-1504893524553-b855bce32c67?auto=format&fit=crop&w=1200&q=86",
    note: "Wide skies, warm pools, and wild edges.",
    currency: { code: "ISK", symbol: "kr" },
  },
];

const activityData: Record<DestinationId, Activity[]> = {
  kyoto: [
    {
      id: "kyoto-tea",
      name: "Tea ceremony in Gion",
      category: "Culture",
      description: "A quiet introduction to matcha, movement, and Kyoto ritual.",
      details:
        "Step into a small machiya house tucked behind Gion's lantern-lit lanes. A host guides you through the rhythms of whisking matcha, seasonal sweets, and the ideas behind ichi-go ichi-e — one time, one meeting.",
      duration: "1 hr 30 min",
      price: 42,
      location: "Gion, Kyoto",
      image: "https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=900&q=86",
      accent: "#d85d43",
    },
    {
      id: "kyoto-fushimi",
      name: "Fushimi Inari at first light",
      category: "Outdoors",
      description: "Walk the vermilion gates before the city wakes up.",
      details:
        "Meet your local guide near the lower shrine and follow the forested trail as the light changes. This gentle early walk gives you context on the shrine's history, fox symbolism, and the best quiet overlooks.",
      duration: "2 hr 15 min",
      price: 28,
      location: "Fushimi, Kyoto",
      image: "https://images.unsplash.com/photo-1478436127897-769e1b3f0f36?auto=format&fit=crop&w=900&q=86",
      accent: "#a14d35",
    },
    {
      id: "kyoto-nishiki",
      name: "Nishiki market tasting walk",
      category: "Food",
      description: "Five neighborhood bites with a chef who knows every stall.",
      details:
        "Taste your way through Kyoto's covered kitchen with a chef-host. Expect dashi-rich broth, pickles, yuba, seasonal wagashi, and a few stories about the vendors who have shaped the market.",
      duration: "2 hr",
      price: 64,
      location: "Nishiki, Kyoto",
      image: "https://images.unsplash.com/photo-1554797589-7241bb691973?auto=format&fit=crop&w=900&q=86",
      accent: "#c89438",
    },
    {
      id: "kyoto-philosopher",
      name: "Philosopher's Path by bicycle",
      category: "Slow travel",
      description: "A leafy ride between small temples and neighborhood coffee.",
      details:
        "Take the long way between Ginkaku-ji and Nanzen-ji on a lightweight city bicycle. Your route follows the canal, pauses at a hand-drip coffee shop, and leaves room for whatever catches your eye.",
      duration: "3 hr",
      price: 35,
      location: "Higashiyama, Kyoto",
      image: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=900&q=86",
      accent: "#5c786c",
    },
    {
      id: "kyoto-ryokan",
      name: "Evening at a neighborhood sento",
      category: "Slow travel",
      description: "Warm up, slow down, and borrow a local evening ritual.",
      details:
        "A small-group introduction to sento etiquette followed by time to soak at a neighborhood bathhouse. Towels, a locker, and a little printed guide are included so you can settle in with confidence.",
      duration: "1 hr 45 min",
      price: 18,
      location: "Nishijin, Kyoto",
      image: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=900&q=86",
      accent: "#819a8e",
    },
  ],
  lisbon: [
    {
      id: "lisbon-alfama",
      name: "Alfama stories & pastries",
      category: "Culture",
      description: "Follow the oldest streets with a resident storyteller.",
      details:
        "Climb the tiled lanes of Alfama with a local writer who will point out hidden courtyards, old fado houses, and the tiny bakeries worth stopping for. Come hungry and wear comfortable shoes.",
      duration: "2 hr",
      price: 38,
      location: "Alfama, Lisbon",
      image: "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=86",
      accent: "#d85d43",
    },
    {
      id: "lisbon-tram",
      name: "Tram 28, the long way",
      category: "Slow travel",
      description: "Ride the famous line with a pause for a neighborhood lunch.",
      details:
        "Skip the rush and trace the historic route in two relaxed legs, with time to step off for a bifana and a view. Your guide shares the history of the line and the streets it still connects.",
      duration: "3 hr",
      price: 24,
      location: "Graça, Lisbon",
      image: "https://images.unsplash.com/photo-1513735492246-483525079686?auto=format&fit=crop&w=900&q=86",
      accent: "#d0a449",
    },
    {
      id: "lisbon-surf",
      name: "Atlantic beginner surf",
      category: "Outdoors",
      description: "A small group lesson on a bright, uncrowded stretch of coast.",
      details:
        "Head west with a patient instructor for a two-hour introduction to the Atlantic. Wetsuit, board, transfer, and a warm drink after the lesson are included.",
      duration: "4 hr",
      price: 72,
      location: "Carcavelos, Lisbon",
      image: "https://images.unsplash.com/photo-1502680390469-be75c86b636f?auto=format&fit=crop&w=900&q=86",
      accent: "#4e7c83",
    },
    {
      id: "lisbon-tasca",
      name: "Tasca table for two",
      category: "Food",
      description: "A generous local dinner in three tiny neighborhood stops.",
      details:
        "Share petiscos, regional wine, and a little dessert across three family-run spots away from the main squares. The menu follows what looks best that day.",
      duration: "2 hr 30 min",
      price: 68,
      location: "Mouraria, Lisbon",
      image: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=86",
      accent: "#9b5c39",
    },
    {
      id: "lisbon-tile",
      name: "Make your own azulejo",
      category: "Culture",
      description: "Design a tile with a working artist in a bright old studio.",
      details:
        "Learn the basics of Portuguese tile painting, from pattern to pigment, then make a piece to take home. No experience needed; just bring an idea or borrow one from the studio wall.",
      duration: "2 hr",
      price: 46,
      location: "Estrela, Lisbon",
      image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=900&q=86",
      accent: "#40708b",
    },
  ],
  reykjavik: [
    {
      id: "reykjavik-lagoon",
      name: "Sky Lagoon at golden hour",
      category: "Slow travel",
      description: "A long soak, ocean views, and the seven-step ritual.",
      details:
        "Ease into the geothermal water at the edge of the Atlantic, then follow the warm-cold ritual at your own pace. A towel, ritual pass, and a quiet seat with a view are included.",
      duration: "2 hr 30 min",
      price: 86,
      location: "Kópavogur",
      image: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=86",
      accent: "#4c7983",
    },
    {
      id: "reykjavik-food",
      name: "Harbor-to-table supper",
      category: "Food",
      description: "A five-course tasting menu rooted in the North Atlantic.",
      details:
        "Taste Iceland through a thoughtful five-course menu built around the day's catch, rye, wild herbs, and local dairy. Your host explains the landscapes behind every plate.",
      duration: "2 hr 45 min",
      price: 94,
      location: "Old Harbour, Reykjavík",
      image: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=86",
      accent: "#bd7b4a",
    },
    {
      id: "reykjavik-coast",
      name: "The coast by e-bike",
      category: "Outdoors",
      description: "A wind-friendly ride along the city's wide-open edge.",
      details:
        "Cruise the shoreline on an electric bike with stops at a lighthouse, a sculpture garden, and a local bakery. The route is easygoing and designed for changing weather.",
      duration: "3 hr 30 min",
      price: 58,
      location: "Seltjarnarnes",
      image: "https://images.unsplash.com/photo-1476610182048-b716b8518aae?auto=format&fit=crop&w=900&q=86",
      accent: "#6f8d8c",
    },
    {
      id: "reykjavik-northern",
      name: "Northern lights, without the bus",
      category: "Outdoors",
      description: "A small-group chase with a photographer and hot chocolate.",
      details:
        "Leave the city in a comfortable 4x4 with a local photographer who reads the cloud cover and the forecast. You will get help with settings, but the night is yours to experience.",
      duration: "4 hr",
      price: 79,
      location: "Outside Reykjavík",
      image: "https://images.unsplash.com/photo-1483347756197-71ef80e95f73?auto=format&fit=crop&w=900&q=86",
      accent: "#52628b",
    },
    {
      id: "reykjavik-design",
      name: "Nordic design walk",
      category: "Culture",
      description: "Independent studios, wool, ceramics, and one excellent bookshop.",
      details:
        "Meet a design writer for a walk through the city's independent scene. Browse small studios, hear how Icelandic materials shape everyday objects, and leave with a short list for later.",
      duration: "2 hr",
      price: 32,
      location: "Miðborg, Reykjavík",
      image: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=86",
      accent: "#ba8e54",
    },
  ],
};

const activitySchedules: Record<string, ActivitySchedule> = {
  "kyoto-tea": { startMinutes: 9 * 60, durationMinutes: 90, label: "09:00" },
  "kyoto-fushimi": { startMinutes: 10 * 60, durationMinutes: 135, label: "10:00" },
  "kyoto-nishiki": { startMinutes: 13 * 60, durationMinutes: 120, label: "13:00" },
  "kyoto-philosopher": { startMinutes: 14 * 60 + 30, durationMinutes: 180, label: "14:30" },
  "kyoto-ryokan": { startMinutes: 19 * 60, durationMinutes: 105, label: "19:00" },
  "lisbon-alfama": { startMinutes: 9 * 60, durationMinutes: 120, label: "09:00" },
  "lisbon-tram": { startMinutes: 10 * 60 + 30, durationMinutes: 180, label: "10:30" },
  "lisbon-surf": { startMinutes: 8 * 60, durationMinutes: 240, label: "08:00" },
  "lisbon-tasca": { startMinutes: 19 * 60, durationMinutes: 150, label: "19:00" },
  "lisbon-tile": { startMinutes: 14 * 60, durationMinutes: 120, label: "14:00" },
  "reykjavik-lagoon": { startMinutes: 17 * 60, durationMinutes: 150, label: "17:00" },
  "reykjavik-food": { startMinutes: 19 * 60, durationMinutes: 165, label: "19:00" },
  "reykjavik-coast": { startMinutes: 10 * 60, durationMinutes: 210, label: "10:00" },
  "reykjavik-northern": { startMinutes: 21 * 60, durationMinutes: 240, label: "21:00" },
  "reykjavik-design": { startMinutes: 13 * 60, durationMinutes: 120, label: "13:00" },
};

function getSchedule(activity: Activity): ActivitySchedule {
  return activitySchedules[activity.id] ?? { startMinutes: 9 * 60, durationMinutes: 60, label: "09:00" };
}

const dayIds: DayId[] = ["Day 1", "Day 2", "Day 3"];
const categories: Category[] = ["All", "Culture", "Food", "Outdoors", "Slow travel"];
const priceFilters: PriceFilter[] = ["All", "under30", "30to70", "over70"];
const currencies: Record<CurrencyCode, Currency> = CURRENCIES;
const currencyOptions: CurrencyCode[] = CURRENCY_OPTIONS;

function getPriceFilterLabel(filter: PriceFilter, displayCurrency: CurrencyCode, rate: number) {
  if (filter === "under30") return `Under ${formatCurrency(30 * rate, displayCurrency)}`;
  if (filter === "30to70") return `${formatCurrency(30 * rate, displayCurrency)}–${formatCurrency(70 * rate, displayCurrency)}`;
  if (filter === "over70") return `${formatCurrency(70 * rate, displayCurrency)}+`;
  return "All";
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [selectedDestination, setSelectedDestination] = useState<DestinationId>("kyoto");
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>("JPY");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [activityQuery, setActivityQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Exclude<Category, "All">[]>([]);
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("All");
  const [activeDay, setActiveDay] = useState<DayId>("Day 1");
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [isDetailClosing, setIsDetailClosing] = useState(false);
  const detailCloseTimeout = useRef<number | null>(null);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const menuCloseTimeout = useRef<number | null>(null);
  const [itinerary, setItinerary] = useState<Record<DayId, PlannedActivity[]>>({
    "Day 1": [],
    "Day 2": [],
    "Day 3": [],
  });
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState<CurrencyCode>("JPY");
  const [showMobilePlan, setShowMobilePlan] = useState(false);
  const [isMobilePlanClosing, setIsMobilePlanClosing] = useState(false);
  const mobilePlanCloseTimeout = useRef<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSavedPlans, setShowSavedPlans] = useState(false);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = JSON.parse(localStorage.getItem("roam-saved-plans") || "[]") as SavedPlan[];
      return Array.isArray(raw) ? raw.map(normalizeSavedPlan) : [];
    } catch {
      return [];
    }
  });
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingPlanToLoad, setPendingPlanToLoad] = useState<SavedPlan | null>(null);
  const [reduceMotion, setReduceMotion] = useState(() => typeof window !== "undefined" && (localStorage.getItem("roam-reduce-motion") === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches));
  const [notice, setNotice] = useState("");
  const [draggingActivityId, setDraggingActivityId] = useState<string | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const [ratesState, setRatesState] = useState<RatesState>(() => {
    const cached = loadCachedRates();
    return cached ?? DEFAULT_RATES_STATE;
  });

  useEffect(() => {
    let isMounted = true;
    fetchExchangeRates()
      .then(({ rates, date }) => {
        if (!isMounted) return;
        setRatesState({
          rates,
          date,
          status: "live",
          lastUpdated: Date.now(),
        });
        saveCachedRates(rates, date);
      })
      .catch((err) => {
        if (!isMounted) return;
        setRatesState((current) => {
          if (current.rates.JPY > 0 && current.rates.ISK > 0 && current.date) {
            return {
              ...current,
              status: "stale",
              errorMessage: err instanceof Error ? err.message : String(err),
            };
          }
          return {
            ...current,
            status: "fallback",
            errorMessage: err instanceof Error ? err.message : String(err),
          };
        });
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const conversion = getConversionRate(currencyCode, ratesState);
  const displayCurrency: CurrencyCode = conversion.effectiveCurrency;
  const rate = conversion.rate;
  const selectedCurrency = CURRENCIES[displayCurrency];
  const destination = { ...(destinations.find((item) => item.id === selectedDestination) ?? destinations[0]), currency: selectedCurrency };
  const activities = activityData[selectedDestination];
  const selectedActivity = activities.find((activity) => activity.id === selectedActivityId) ?? null;
  const selectedItems = useMemo(() => Object.values(itinerary).flat(), [itinerary]);
  const selectedIds = useMemo(() => selectedItems.map((item) => item.activityId), [selectedItems]);
  const checkoutItems = useMemo(() => dayIds.flatMap((day) => itinerary[day]
    .map((item) => ({ day, item, activity: activities.find((candidate) => candidate.id === item.activityId) }))
    .filter((entry): entry is { day: DayId; item: PlannedActivity; activity: Activity } => Boolean(entry.activity))), [activities, itinerary]);

  const itineraryAmounts = useMemo(
    () => calculateItineraryAmounts(itinerary, activities, currencyCode, ratesState),
    [itinerary, activities, currencyCode, ratesState]
  );
  const daySubtotals = itineraryAmounts.daySubtotals as Record<DayId, number>;
  const totalCost = itineraryAmounts.totalCost;
  const totalCostEur = itineraryAmounts.totalCostEur;

  // Derive guest count / party size directly from the itinerary activity participant quantities
  const partySize = useMemo(
    () => calculatePartySize(checkoutItems.map((ci) => ci.item.quantity)),
    [checkoutItems]
  );

  const [travellerForm, setTravellerForm] = useState<LeadTravellerForm>(() => ({
    fullName: "",
    email: "",
    countryCode: getDefaultCallingCode(selectedDestination),
    phone: "",
  }));
  const [travellerErrors, setTravellerErrors] = useState<LeadTravellerErrors>({});
  const [travellerTouched, setTravellerTouched] = useState<Record<keyof LeadTravellerForm, boolean>>({
    fullName: false,
    email: false,
    countryCode: false,
    phone: false,
  });

  // Keep country calling code aligned with destination until user enters phone or customizes code
  useEffect(() => {
    if (!travellerTouched.countryCode && travellerForm.phone === "") {
      setTravellerForm((prev) => ({
        ...prev,
        countryCode: getDefaultCallingCode(selectedDestination),
      }));
    }
  }, [selectedDestination, travellerTouched.countryCode, travellerForm.phone]);

  const handleTravellerChange = (field: keyof LeadTravellerForm, value: string) => {
    const updated = { ...travellerForm, [field]: value };
    setTravellerForm(updated);
    if (travellerTouched[field]) {
      const errs = validateLeadTravellerForm(updated);
      setTravellerErrors(errs);
    }
  };

  const handleTravellerBlur = (field: keyof LeadTravellerForm) => {
    setTravellerTouched((prev) => ({ ...prev, [field]: true }));
    const errs = validateLeadTravellerForm(travellerForm);
    setTravellerErrors(errs);
  };

  const handleProceedToPayment = () => {
    setTravellerTouched({
      fullName: true,
      email: true,
      countryCode: true,
      phone: true,
    });
    const errs = validateLeadTravellerForm(travellerForm);
    setTravellerErrors(errs);
    if (Object.keys(errs).length === 0) {
      setCheckoutStep("payment-placeholder");
    } else {
      const firstInvalidField = Object.keys(errs)[0];
      const el = document.getElementById(`traveller-${firstInvalidField}`);
      if (el) {
        el.focus();
      }
    }
  };

  // Keep only: when budgetInput is empty, keep budgetCurrency synced to displayCurrency.
  useEffect(() => {
    if (budgetInput.trim() === "") {
      setBudgetCurrency(displayCurrency);
    }
  }, [displayCurrency, budgetInput]);

  // Synchronize currency selector with fallback lock
  useEffect(() => {
    if (ratesState.status === "fallback" && currencyCode !== "EUR") {
      setCurrencyCode("EUR");
    }
  }, [ratesState.status, currencyCode]);

  const formatEurPrice = (priceEur: number) => formatCurrency(getConvertedUnitPrice(priceEur, rate), displayCurrency);
  const formatAmount = (amount: number) => formatCurrency(amount, displayCurrency);

  const budgetComparison = useMemo(() => {
    return compareBudget(
      budgetInput,
      budgetCurrency,
      totalCostEur,
      totalCost,
      displayCurrency,
      ratesState
    );
  }, [budgetInput, budgetCurrency, totalCostEur, totalCost, displayCurrency, ratesState]);
  const conflictsByDay = useMemo(() => dayIds.reduce<Record<DayId, string[]>>((conflicts, day) => {
    const dayItems = itinerary[day]
      .map((item) => ({ item, activity: activities.find((candidate) => candidate.id === item.activityId) }))
      .filter((entry): entry is { item: PlannedActivity; activity: Activity } => Boolean(entry.activity));
    const ids = new Set<string>();
    dayItems.forEach((current, index) => {
      const currentSchedule = getSchedule(current.activity);
      const currentEnd = currentSchedule.startMinutes + currentSchedule.durationMinutes;
      dayItems.slice(index + 1).forEach((next) => {
        const nextSchedule = getSchedule(next.activity);
        const nextEnd = nextSchedule.startMinutes + nextSchedule.durationMinutes;
        if (currentSchedule.startMinutes < nextEnd && nextSchedule.startMinutes < currentEnd) {
          ids.add(current.activity.id);
          ids.add(next.activity.id);
        }
      });
    });
    conflicts[day] = Array.from(ids);
    return conflicts;
  }, { "Day 1": [], "Day 2": [], "Day 3": [] }), [activities, itinerary]);
  const conflictCount = Object.values(conflictsByDay).reduce((sum, ids) => sum + ids.length, 0);
  const isPlanSaved = useMemo(() => savedPlans.some((plan) =>
    plan.destinationId === selectedDestination &&
    plan.budgetInput === budgetInput &&
    (plan.budgetCurrency ?? (destinations.find((d) => d.id === plan.destinationId)?.currency.code ?? "EUR")) === budgetCurrency &&
    JSON.stringify(plan.itinerary) === JSON.stringify(itinerary)
  ), [budgetCurrency, budgetInput, itinerary, savedPlans, selectedDestination]);

  const filteredDestinations = useMemo(() => {
    const query = destinationQuery.trim().toLowerCase();
    if (!query) return destinations;
    return destinations.filter((item) => `${item.name} ${item.country}`.toLowerCase().includes(query));
  }, [destinationQuery]);

  const filteredActivities = useMemo(() => {
    const query = activityQuery.trim().toLowerCase();
    return activities.filter((activity) => {
      const matchesQuery = `${activity.name} ${activity.description} ${activity.location}`.toLowerCase().includes(query);
      const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(activity.category);
      const matchesPrice =
        priceFilter === "All" ||
        (priceFilter === "under30" && activity.price < 30) ||
        (priceFilter === "30to70" && activity.price >= 30 && activity.price <= 70) ||
        (priceFilter === "over70" && activity.price > 70);
      return matchesQuery && matchesCategory && matchesPrice;
    });
  }, [activities, activityQuery, selectedCategories, priceFilter]);

  const flashNotice = (message: string) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      noticeTimer.current = null;
    }, 2400);
  };

  useEffect(() => {
    if (!selectedActivityId && (!showMobilePlan || isMobilePlanClosing) && !checkoutStep && (!showMenu || isMenuClosing) && !showResetConfirm && !pendingPlanToLoad) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedActivityId, showMobilePlan, isMobilePlanClosing, checkoutStep, showMenu, isMenuClosing, showResetConfirm, pendingPlanToLoad]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
    localStorage.setItem("roam-reduce-motion", String(reduceMotion));
  }, [reduceMotion]);

  useEffect(() => {
    localStorage.setItem("roam-saved-plans", JSON.stringify(savedPlans));
  }, [savedPlans]);

  useEffect(() => {
    if (!showMenu && !showResetConfirm && !pendingPlanToLoad && !showMobilePlan && !checkoutStep) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        setShowResetConfirm(false);
        setPendingPlanToLoad(null);
        closeMobilePlan();
        setCheckoutStep(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showMenu, showResetConfirm, pendingPlanToLoad, showMobilePlan, checkoutStep]);

  useEffect(() => () => {
    if (detailCloseTimeout.current !== null) window.clearTimeout(detailCloseTimeout.current);
    if (menuCloseTimeout.current !== null) window.clearTimeout(menuCloseTimeout.current);
    if (mobilePlanCloseTimeout.current !== null) window.clearTimeout(mobilePlanCloseTimeout.current);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal-on-scroll").forEach((el) => {
        el.classList.add("is-revealed");
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -30px 0px" }
    );

    const elements = document.querySelectorAll(".reveal-on-scroll:not(.is-revealed)");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [reduceMotion, selectedDestination]);

  const openDetail = (id: string) => {
    if (detailCloseTimeout.current !== null) {
      window.clearTimeout(detailCloseTimeout.current);
      detailCloseTimeout.current = null;
    }
    setIsDetailClosing(false);
    setSelectedActivityId(id);
  };

  const closeDetail = () => {
    if (reduceMotion) {
      setSelectedActivityId(null);
      setIsDetailClosing(false);
      return;
    }
    if (detailCloseTimeout.current !== null) {
      window.clearTimeout(detailCloseTimeout.current);
    }
    setIsDetailClosing(true);
    detailCloseTimeout.current = window.setTimeout(() => {
      setSelectedActivityId(null);
      setIsDetailClosing(false);
      detailCloseTimeout.current = null;
    }, 180);
  };

  const switchDestination = (id: DestinationId) => {
    const previousDestination = destination.name;
    const hadItinerary = selectedIds.length > 0;
    const nextDestination = destinations.find((item) => item.id === id)?.name ?? "your destination";
    const nextCurrency = destinations.find((item) => item.id === id)?.currency.code as CurrencyCode | undefined;
    setSelectedDestination(id);
    const effectiveNextCurrency = ratesState.status === "fallback" ? "EUR" : (nextCurrency ?? "EUR");
    setCurrencyCode(effectiveNextCurrency);
    setBudgetInput("");
    setBudgetCurrency(effectiveNextCurrency);
    setDestinationQuery("");
    setActivityQuery("");
    setSelectedCategories([]);
    setPriceFilter("All");
    setSelectedActivityId(null);
    setCheckoutStep(null);
    setItinerary({ "Day 1": [], "Day 2": [], "Day 3": [] });
    flashNotice(hadItinerary ? `${previousDestination} itinerary cleared · Now planning ${nextDestination}` : `Now planning ${nextDestination}`);
  };

  const saveCurrentPlan = () => {
    if (selectedIds.length === 0) {
      flashNotice("Add an activity before saving this plan");
      return;
    }
    const plan: SavedPlan = {
      id: `plan-${Date.now()}`,
      destinationId: selectedDestination,
      itinerary: JSON.parse(JSON.stringify(itinerary)) as Record<DayId, PlannedActivity[]>,
      budgetInput,
      budgetCurrency,
      createdAt: Date.now(),
    };
    setSavedPlans((current) => [plan, ...current.filter((item) => !(
      item.destinationId === selectedDestination &&
      item.budgetInput === budgetInput &&
      (item.budgetCurrency ?? (destinations.find((d) => d.id === item.destinationId)?.currency.code ?? "EUR")) === budgetCurrency &&
      JSON.stringify(item.itinerary) === JSON.stringify(itinerary)
    ))].slice(0, 12));
    flashNotice(isPlanSaved ? "Plan already saved" : "Plan saved locally");
  };

  const loadSavedPlan = (rawPlan: SavedPlan) => {
    const plan = normalizeSavedPlan(rawPlan);
    const savedDestination = destinations.find((item) => item.id === plan.destinationId) ?? destinations[0];
    setSelectedDestination(savedDestination.id);
    const planCurrency = plan.budgetCurrency ?? (savedDestination.currency.code as CurrencyCode);
    setCurrencyCode(ratesState.status === "fallback" ? "EUR" : planCurrency);
    setItinerary(JSON.parse(JSON.stringify(plan.itinerary)) as Record<DayId, PlannedActivity[]>);
    setBudgetInput(plan.budgetInput);
    setBudgetCurrency(planCurrency);
    setActiveDay("Day 1");
    setShowSavedPlans(false);
    closeMenu();
    flashNotice(`${savedDestination.name} plan reopened`);
  };

  const requestLoadSavedPlan = (plan: SavedPlan) => {
    const hasUnsavedPlanningState = (selectedIds.length > 0 || budgetInput.trim() !== "") && !isPlanSaved;
    if (hasUnsavedPlanningState) {
      setPendingPlanToLoad(plan);
      return;
    }
    loadSavedPlan(plan);
  };

  const deleteSavedPlan = (id: string) => {
    setSavedPlans((current) => current.filter((plan) => plan.id !== id));
    flashNotice("Saved plan deleted");
  };

  const addToDay = (activityId: string, day: DayId) => {
    if (itinerary[day].some((item) => item.activityId === activityId)) {
      flashNotice("Already on this day");
      return;
    }
    setItinerary((current) => ({
      ...current,
      [day]: [...current[day], { activityId, quantity: 1 }],
    }));
    setActiveDay(day);
    flashNotice(`Added to ${day}`);
  };

  const toggleCategory = (value: Category) => {
    if (value === "All") {
      setSelectedCategories([]);
      return;
    }
    setSelectedCategories((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  const moveActivityToDay = (activityId: string, targetDay: DayId) => {
    const sourceDay = dayIds.find((day) => itinerary[day].some((item) => item.activityId === activityId));
    if (!sourceDay || sourceDay === targetDay) {
      setDraggingActivityId(null);
      return;
    }
    setItinerary((current) => ({
      ...current,
      [sourceDay]: current[sourceDay].filter((item) => item.activityId !== activityId),
      [targetDay]: [...current[targetDay].filter((item) => item.activityId !== activityId), current[sourceDay].find((item) => item.activityId === activityId)!],
    }));
    setActiveDay(targetDay);
    setDraggingActivityId(null);
    flashNotice(`Moved to ${targetDay}`);
  };

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, activityId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", activityId);
    setDraggingActivityId(activityId);
  };

  const handleDayDrop = (event: React.DragEvent<HTMLButtonElement>, day: DayId) => {
    event.preventDefault();
    const activityId = event.dataTransfer.getData("text/plain") || draggingActivityId;
    if (activityId) moveActivityToDay(activityId, day);
  };

  const removeFromDay = (activityId: string, day: DayId) => {
    setItinerary((current) => ({
      ...current,
      [day]: current[day].filter((item) => item.activityId !== activityId),
    }));
    flashNotice("Removed from itinerary");
  };

  const updateQuantity = (activityId: string, day: DayId, delta: number) => {
    setItinerary((current) => ({
      ...current,
      [day]: current[day].map((item) => item.activityId === activityId
        ? { ...item, quantity: Math.min(5, Math.max(1, item.quantity + delta)) }
        : item),
    }));
  };

  const resetFilters = () => {
    setActivityQuery("");
    setSelectedCategories([]);
    setPriceFilter("All");
  };

  const openCheckout = () => {
    closeMobilePlan();
    setSelectedActivityId(null);
    setCheckoutStep("review");
  };

  const returnToItinerary = () => {
    setCheckoutStep(null);
    closeMobilePlan();
  };

  const openMobilePlan = () => {
    if (mobilePlanCloseTimeout.current !== null) {
      window.clearTimeout(mobilePlanCloseTimeout.current);
      mobilePlanCloseTimeout.current = null;
    }
    setIsMobilePlanClosing(false);
    setShowMobilePlan(true);
  };

  const closeMobilePlan = (onComplete?: () => void) => {
    if (reduceMotion) {
      if (mobilePlanCloseTimeout.current !== null) {
        window.clearTimeout(mobilePlanCloseTimeout.current);
        mobilePlanCloseTimeout.current = null;
      }
      setShowMobilePlan(false);
      setIsMobilePlanClosing(false);
      onComplete?.();
      return;
    }

    if (mobilePlanCloseTimeout.current !== null) return;

    setIsMobilePlanClosing(true);

    mobilePlanCloseTimeout.current = window.setTimeout(() => {
      setShowMobilePlan(false);
      setIsMobilePlanClosing(false);
      mobilePlanCloseTimeout.current = null;
      onComplete?.();
    }, 180);
  };

  const closeMenu = () => {
    if (reduceMotion) {
      if (menuCloseTimeout.current !== null) {
        window.clearTimeout(menuCloseTimeout.current);
        menuCloseTimeout.current = null;
      }
      setShowMenu(false);
      setIsMenuClosing(false);
      window.setTimeout(() => menuTriggerRef.current?.focus(), 0);
      return;
    }

    if (menuCloseTimeout.current !== null) return;

    setIsMenuClosing(true);

    menuCloseTimeout.current = window.setTimeout(() => {
      setShowMenu(false);
      setIsMenuClosing(false);
      menuCloseTimeout.current = null;
      menuTriggerRef.current?.focus();
    }, 180);
  };

  const openMenu = () => {
    if (menuCloseTimeout.current !== null) {
      window.clearTimeout(menuCloseTimeout.current);
      menuCloseTimeout.current = null;
    }

    setIsMenuClosing(false);
    setShowMenu(true);
  };

  const scrollToSection = (id: string) => {
    closeMenu();
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }), 170);
  };

  const handleCycleCurrency = () => {
    if (ratesState.status === "fallback") {
      flashNotice("Exchange rates unavailable · Display locked to EUR");
      return;
    }
    const next = currencyOptions[(currencyOptions.indexOf(currencyCode) + 1) % currencyOptions.length];
    setCurrencyCode(next);
  };

  const resetPlan = () => {
    setItinerary({ "Day 1": [], "Day 2": [], "Day 3": [] });
    setBudgetInput("");
    setBudgetCurrency(displayCurrency);
    setActiveDay("Day 1");
    setSelectedActivityId(null);
    setShowMobilePlan(false);
    setCheckoutStep(null);
    setShowResetConfirm(false);
    closeMenu();
    flashNotice("Plan reset · Start with a fresh day");
  };

  const renderDayItems = (day: DayId) => {
    const dayActivities = itinerary[day]
      .map((item) => ({ item, activity: activities.find((activity) => activity.id === item.activityId) }))
      .filter((entry): entry is { item: PlannedActivity; activity: Activity } => Boolean(entry.activity));

    if (!dayActivities.length) {
      return (
        <div className="empty-day" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          const activityId = event.dataTransfer.getData("text/plain") || draggingActivityId;
          if (activityId) moveActivityToDay(activityId, day);
        }}>
          <div className="empty-day-mark"><Compass size={17} strokeWidth={1.7} /></div>
          <p>Nothing planned yet.</p>
          <span>Pick a few things you would love to remember.</span>
        </div>
      );
    }

    return (
      <div className="day-items">
        {dayActivities.map(({ item, activity }) => {
          const hasConflict = conflictsByDay[day].includes(activity.id);
          const lineTotal = itineraryAmounts.lineTotals[`${day}-${activity.id}`] ?? getConvertedLineTotal(activity.price, item.quantity, rate);
          return (
          <div
            className={`day-item ${draggingActivityId === activity.id ? "is-dragging" : ""}`}
            key={activity.id}
            draggable
            onDragStart={(event) => handleDragStart(event, activity.id)}
            onDragEnd={() => setDraggingActivityId(null)}
            title="Drag to another day"
          >
            <img src={activity.image} alt="" />
            <div className="day-item-copy">
              <span>{activity.category}</span>
              <strong>{activity.name}</strong>
              <small>{getSchedule(activity).label} · {activity.duration} · {formatCurrency(lineTotal, displayCurrency)}</small>
              <div className="quantity-control" aria-label={`Quantity for ${activity.name}`}>
                <button type="button" onClick={(event) => { event.stopPropagation(); updateQuantity(activity.id, day, -1); }} disabled={item.quantity <= 1} aria-label={`Decrease ${activity.name} quantity`}>−</button>
                <span>{item.quantity}</span>
                <button type="button" onClick={(event) => { event.stopPropagation(); updateQuantity(activity.id, day, 1); }} disabled={item.quantity >= 5} aria-label={`Increase ${activity.name} quantity`}>+</button>
              </div>
            </div>
            <GripVertical className="drag-handle" size={15} aria-hidden="true" />
            {hasConflict && <span className="conflict-mark" title="Scheduling conflict"><AlertTriangle size={14} /></span>}
            <button
              className="icon-button subtle"
              aria-label={`Remove ${activity.name}`}
              onClick={() => removeFromDay(activity.id, day)}
            >
              <Trash2 size={14} />
            </button>
          </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="roam-app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#top" aria-label="ROAM home">
            <span className="brand-mark"><Navigation size={17} fill="currentColor" /></span>
            <span>ROAM</span>
          </a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <a className="active" href="#explore">Explore</a>
            <a href="#itinerary">My itinerary <span className="nav-count">{selectedIds.length}</span></a>
          </nav>
          <div className="topbar-actions">
            <button ref={menuTriggerRef} className="nav-action options-trigger" aria-label="Open options" aria-expanded={showMenu} onClick={openMenu}><span className="options-trigger-label">Options</span><Menu size={17} /></button>
          </div>
        </div>
      </header>

      <main id="top" className="page-wrap">
        <section className="intro-section reveal-on-scroll" aria-labelledby="page-title">
          <div className="intro-copy">
            <div className="eyebrow"><Sparkles size={14} /> Trip planning, with room to wander</div>
            <h1 id="page-title">Make space for<br /><em>the good stuff.</em></h1>
            <p className="intro-text">Choose a destination, collect the experiences that fit, and shape them into three unhurried days.</p>
          </div>
          <div className="intro-side-note">
            <span className="side-note-line" />
            <span>Thoughtful plans<br />for unhurried days.</span>
          </div>
        </section>

        <section className="destination-picker reveal-on-scroll" id="destination-picker" aria-label="Choose a destination">
          <div className="picker-label"><Compass size={15} /> Where are you going?</div>
          <div className="destination-search-wrap">
            <Search size={20} />
            <input
              aria-label="Search destinations"
              value={destinationQuery}
              onChange={(event) => setDestinationQuery(event.target.value)}
              placeholder="Search a destination"
            />
            {destinationQuery && <button className="clear-search" onClick={() => setDestinationQuery("")} aria-label="Clear destination search"><X size={16} /></button>}
          </div>
          {destinationQuery && (
            <div className="destination-suggestions">
              {filteredDestinations.length ? filteredDestinations.map((item) => (
                <button key={item.id} className="destination-suggestion" onClick={() => switchDestination(item.id)}>
                  <img src={item.image} alt="" />
                  <span><strong>{item.name}</strong><small>{item.country} · {item.days}</small></span>
                  <ChevronRight size={16} />
                </button>
              )) : <div className="suggestion-empty">No destinations found. Try Kyoto, Lisbon, or Reykjavík.</div>}
            </div>
          )}
          <div className="destination-chips">
            {destinations.map((item, index) => (
              <button
                key={item.id}
                className={`destination-chip ${selectedDestination === item.id ? "selected" : ""}`}
                style={{ "--chip-index": index } as CSSProperties}
                onClick={() => switchDestination(item.id)}
              >
                <img src={item.image} alt="" />
                <span><strong>{item.name}</strong><small>{item.country}</small></span>
                {selectedDestination === item.id && <Check size={15} />}
              </button>
            ))}
          </div>
        </section>

        <section className="destination-banner reveal-on-scroll" aria-label={`Selected destination: ${destination.name}`}>
          <img key={`banner-img-${destination.id}`} src={destination.image} alt={`${destination.name} travel scene`} />
          <div className="banner-scrim" />
          <div key={`banner-content-${destination.id}`} className="banner-content">
            <div>
              <span className="banner-kicker">Now planning</span>
              <h2>{destination.name}<span className="banner-country">, {destination.country}</span></h2>
              <p>{destination.note}</p>
            </div>
            <div className="banner-meta"><CalendarDays size={15} /> 3 days <span>·</span> {activities.length} ideas</div>
          </div>
          <button className={`banner-save ${isPlanSaved ? "is-saved" : ""}`} onClick={saveCurrentPlan}><Heart size={16} fill={isPlanSaved ? "currentColor" : "none"} /> {isPlanSaved ? "Saved" : "Save plan"}</button>
        </section>

        <div className="mobile-summary-bar">
          <div><span>{selectedIds.length} {selectedIds.length === 1 ? "activity" : "activities"}</span><strong>{formatAmount(totalCost)}</strong></div>
          <button onClick={openMobilePlan}>View itinerary <ArrowRight size={15} /></button>
        </div>

        <section className="planning-layout reveal-on-scroll" id="explore">
          <div className="discovery-column">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">Build your days</span>
                <h2>Things worth making time for</h2>
              </div>
              <span className="result-count">{filteredActivities.length} of {activities.length}</span>
            </div>

            <div className="search-and-filter-row">
              <label className="activity-search">
                <Search size={17} />
                <input aria-label="Search activities" value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Search ideas" />
                {activityQuery && <button className="clear-search" onClick={() => setActivityQuery("")} aria-label="Clear activity search"><X size={15} /></button>}
              </label>
              <button className={`filter-toggle ${showFilters ? "active" : ""}`} onClick={() => setShowFilters((current) => !current)}><SlidersHorizontal size={16} /> Filters <span>{selectedCategories.length + (priceFilter !== "All" ? 1 : 0)}</span></button>
            </div>

            <div className={`filters-panel ${showFilters ? "open" : ""}`}>
              <div className="filter-group">
                <div className="filter-label"><Filter size={13} /> Type <small>Choose one or more</small></div>
                <div className="filter-options">{categories.map((item) => <button key={item} className={(item === "All" ? selectedCategories.length === 0 : selectedCategories.includes(item)) ? "active" : ""} onClick={() => toggleCategory(item)}>{item}{item !== "All" && selectedCategories.includes(item) && <Check size={12} />}</button>)}</div>
              </div>
              <div className="filter-group">
                <div className="filter-label"><Wallet size={13} /> Price</div>
              <div className="filter-options">{priceFilters.map((item) => <button key={item} className={priceFilter === item ? "active" : ""} onClick={() => setPriceFilter(item)}>{getPriceFilterLabel(item, displayCurrency, rate)}</button>)}</div>
              </div>
              {(selectedCategories.length > 0 || priceFilter !== "All" || activityQuery) && <button className="reset-filters" onClick={resetFilters}>Reset filters <X size={13} /></button>}
            </div>

            {filteredActivities.length ? (
              <div className="activity-grid">
                {filteredActivities.map((activity, index) => {
                  const isAdded = selectedIds.includes(activity.id);
                  return (
                    <article
                      className={`activity-card ${isAdded ? "added" : ""}`}
                      key={activity.id}
                      style={{ "--card-accent": activity.accent, "--stagger": `${index * 45}ms` } as React.CSSProperties}
                      onClick={() => openDetail(activity.id)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openDetail(activity.id); }}
                      tabIndex={0}
                      role="button"
                      aria-label={`View details for ${activity.name}`}
                    >
                      <div className="activity-image-wrap">
                        <img src={activity.image} alt="" className="activity-image" />
                        <span className="activity-category">{activity.category}</span>
                        {isAdded && <span className="added-badge"><Check size={12} /> Planned</span>}
                        <button className="card-heart" aria-label={`Save current plan with ${activity.name}`} onClick={(event) => { event.stopPropagation(); saveCurrentPlan(); }}><Heart size={16} fill={isPlanSaved ? "currentColor" : "none"} /></button>
                      </div>
                      <div className="activity-card-body">
                        <div className="activity-location"><MapPin size={12} /> {activity.location}</div>
                        <h3>{activity.name}</h3>
                        <p>{activity.description}</p>
                        <div className="activity-card-footer"><span><Clock3 size={13} /> {activity.duration}</span><strong title="Indicative planning estimate">{formatEurPrice(activity.price)} <small className="price-est-label">est.</small></strong><ChevronRight size={16} className="card-arrow" /></div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="no-results"><div className="no-results-icon"><Search size={19} /></div><h3>Nothing matches that search.</h3><p>Try a different phrase or open up the filters.</p><button onClick={resetFilters}>Clear all filters</button></div>
            )}
          </div>

          <aside className="itinerary-rail" id="itinerary" aria-label="Your itinerary">
            <div className="rail-topline"><span className="section-kicker">Your trip</span><span className="rail-private-note">Private plan</span></div>
            <div className="rail-title-row"><h2>{destination.name}, slowly.</h2><span className="rail-days">3 days</span></div>
            <div className="rail-total"><div><span>Estimated total</span><strong>{formatAmount(totalCost)}</strong></div><div className="rail-count"><span>{selectedIds.length}</span> {selectedIds.length === 1 ? "activity" : "activities"}</div></div>
            <div className="rate-status-banner">
              <strong>{getRateStatusDescription(ratesState, displayCurrency)}</strong>
              {displayCurrency !== "EUR" && ratesState.rates[displayCurrency] && ratesState.status !== "fallback" && (
                <span>1 EUR = {formatExchangeRate(ratesState.rates[displayCurrency], displayCurrency)} reference rate</span>
              )}
              <small>Planning estimates only · Supplier rates may vary</small>
            </div>
            <div className={`budget-card ${budgetComparison.status}`}>
              <div className="budget-heading"><span>Trip budget</span><strong>{budgetComparison.statusHeading}</strong></div>
              <div className="budget-input-row"><span>{CURRENCIES[budgetCurrency].symbol}</span><input type="number" min="0" step="1" value={budgetInput} onChange={(event) => { const value = event.target.value; if (budgetInput.trim() === "") { setBudgetCurrency(displayCurrency); } setBudgetInput(value); }} placeholder="Set amount" aria-label={`Trip budget in ${budgetCurrency}`} /></div>
              <div className="budget-meter"><span style={{ width: `${budgetComparison.meterPercent}%` }} /></div>
              <small>{budgetComparison.summaryText}</small>
            </div>
            {conflictCount > 0 && <div className="conflict-alert"><AlertTriangle size={15} /><div><strong>{conflictCount} scheduling conflict{conflictCount === 1 ? "" : "s"}</strong>{dayIds.filter((day) => conflictsByDay[day].length > 0).map((day) => <small key={day}>{day}: {conflictsByDay[day].map((id) => activities.find((activity) => activity.id === id)?.name).filter(Boolean).join(" + ")}</small>)}</div></div>}
            <div className="day-tabs" role="tablist" aria-label="Trip days">
              {dayIds.map((day, index) => <button key={day} className={`${activeDay === day ? "active" : ""} ${draggingActivityId ? "drop-target" : ""}`} onClick={() => setActiveDay(day)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDayDrop(event, day)} role="tab" aria-selected={activeDay === day}><span>0{index + 1}</span>{day.replace(" ", " ")}{itinerary[day].length > 0 && <i>{itinerary[day].length}</i>}</button>)}
            </div>
            <div className="selected-day-label"><span>{activeDay}</span><div><small>{draggingActivityId ? "Drop on a day tab to move" : activeDay === "Day 1" ? "Arrive & orient" : activeDay === "Day 2" ? "Go a little deeper" : "Leave room for one more thing"}</small><strong>{formatAmount(daySubtotals[activeDay])}</strong></div></div>
            {renderDayItems(activeDay)}
            <div className="rail-tip"><Sparkles size={15} /><span><strong>Leave 20% unplanned.</strong><br />The best moments rarely make the first draft.</span></div>
            <button className="checkout-button" onClick={openCheckout}><Wallet size={15} /> Review & checkout <ArrowRight size={15} /></button>
            <button className="continue-button" onClick={() => document.getElementById("explore")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" })}>Keep exploring <ArrowRight size={16} /></button>
          </aside>
        </section>
        <section className="journey-section reveal-on-scroll" id="how-it-works" aria-labelledby="journey-title">
          <div className="journey-heading">
            <span className="section-kicker">A gentler way to plan</span>
            <h2 id="journey-title">From a first idea<br /><em>to a trip with shape.</em></h2>
            <p>ROAM keeps the early wandering and the practical details in the same place, so your itinerary can become coherent without becoming crowded.</p>
          </div>
          <div className="journey-steps">
            <div className="journey-step"><span>01</span><strong>Choose a place</strong><p>Start with a destination and a pace that feels right.</p></div>
            <div className="journey-step"><span>02</span><strong>Make time for what fits</strong><p>Collect curated experiences, then give each one a day.</p></div>
            <div className="journey-step"><span>03</span><strong>Keep the good parts</strong><p>Review the shape of the trip before you head out.</p></div>
          </div>
          <button className="journey-cta" onClick={() => scrollToSection("top")}>Start with a destination <ArrowRight size={16} /></button>
        </section>
      </main>

      {showMenu && (
        <div className={`menu-overlay ${isMenuClosing ? "is-closing" : ""}`} onClick={closeMenu}>
          <aside className={`menu-panel ${isMenuClosing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="menu-title" onClick={(event) => event.stopPropagation()}>
            <div className="menu-header"><div><span className="section-kicker">ROAM / Options</span><h2 id="menu-title">Make room<br /><em>to move.</em></h2></div><button className="icon-button menu-close" onClick={closeMenu} aria-label="Close menu"><X size={18} /></button></div>
            <nav className="menu-nav" aria-label="ROAM menu">
              <button onClick={() => scrollToSection("destination-picker")}><span>01</span><strong>Destinations</strong><ArrowRight size={16} /></button>
              <button onClick={() => scrollToSection("explore")}><span>02</span><strong>Curated activities</strong><ArrowRight size={16} /></button>
              <button onClick={() => { closeMenu(); if (window.matchMedia("(max-width: 760px)").matches) openMobilePlan(); else window.setTimeout(() => document.getElementById("itinerary")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }), 170); }}><span>03</span><strong>Active itinerary ({selectedIds.length})</strong><ArrowRight size={16} /></button>
              <button className="menu-saved" onClick={() => setShowSavedPlans((current) => !current)}><span>04</span><strong>Saved Plans ({savedPlans.length})</strong><ChevronDown size={15} className={showSavedPlans ? "rotated" : ""} /></button>
            </nav>
            {showSavedPlans && <div className="saved-plans-list">{savedPlans.length === 0 ? <p>No saved plans yet. Save an itinerary to find it here.</p> : savedPlans.map((plan) => { const savedDestination = destinations.find((item) => item.id === plan.destinationId) ?? destinations[0]; return <div className="saved-plan-row" key={plan.id}><button onClick={() => requestLoadSavedPlan(plan)}><strong>{savedDestination.name}, slowly.</strong><small>{Object.values(plan.itinerary).flat().length} activities · {new Date(plan.createdAt).toLocaleDateString()}</small></button><button className="saved-plan-delete" aria-label={`Delete ${savedDestination.name} saved plan`} onClick={() => deleteSavedPlan(plan.id)}><Trash2 size={14} /></button></div>; })}</div>}
            <div className="menu-settings">
              <button className={`menu-setting currency-control ${ratesState.status === "fallback" ? "is-locked" : ""}`} onClick={handleCycleCurrency}><span>05</span><strong>Currency</strong><b>{displayCurrency} ({CURRENCIES[displayCurrency].symbol})</b></button>
              <div className="menu-rate-info">
                <small>
                  {ratesState.status === "fallback"
                    ? "Live conversion unavailable · Showing EUR estimates"
                    : displayCurrency === "EUR"
                    ? "Base currency (EUR) · Planning estimates"
                    : `1 EUR = ${formatExchangeRate(rate, displayCurrency)} · ${getRateStatusDescription(ratesState, displayCurrency)}`}
                </small>
              </div>
              <button className="menu-setting menu-toggle" onClick={() => toggleTheme?.()}><span>06</span><strong>Dark mode</strong><b>{theme === "dark" ? "On" : "Off"}</b></button>
              <button className={`menu-setting menu-toggle ${reduceMotion ? "active" : ""}`} onClick={() => setReduceMotion((current) => !current)}><span>07</span><strong>Reduce motion</strong><b>{reduceMotion ? "On" : "Off"}</b></button>
            </div>
            <button className="menu-reset" onClick={() => { closeMenu(); setShowResetConfirm(true); }}><span>08</span><strong>Reset plan</strong><Trash2 size={15} /></button>
          </aside>
        </div>
      )}

      {showResetConfirm && (
        <div className="reset-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" onClick={(event) => event.stopPropagation()}>
            <span className="section-kicker">Start over</span>
            <h2 id="reset-title">Reset your trip?</h2>
            <p>This will remove your selected activities, quantities, and budget.</p>
            <div className="reset-actions"><button className="checkout-secondary" onClick={() => setShowResetConfirm(false)}>Cancel</button><button className="checkout-primary" onClick={resetPlan}>Reset plan</button></div>
          </div>
        </div>
      )}

      {pendingPlanToLoad && (
        <div className="reset-overlay" onClick={() => setPendingPlanToLoad(null)}>
          <div className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="overwrite-plan-title" onClick={(event) => event.stopPropagation()}>
            <span className="section-kicker">Saved plan</span>
            <h2 id="overwrite-plan-title">Replace current plan?</h2>
            <p>Your current unsaved plan and budget will be replaced with this saved itinerary.</p>
            <div className="reset-actions">
              <button className="checkout-secondary" onClick={() => setPendingPlanToLoad(null)}>Cancel</button>
              <button className="checkout-primary" onClick={() => { const target = pendingPlanToLoad; setPendingPlanToLoad(null); loadSavedPlan(target); }}>Replace plan</button>
            </div>
          </div>
        </div>
      )}

      {selectedActivity && (
        <div className={`detail-overlay ${isDetailClosing ? "is-closing" : ""}`} onClick={closeDetail}>
          <aside className={`detail-panel ${isDetailClosing ? "is-closing" : ""}`} onClick={(event) => event.stopPropagation()} aria-label="Activity details">
            <div className="detail-image-wrap"><img src={selectedActivity.image} alt={`${selectedActivity.name} preview`} /><div className="detail-image-scrim" /><button className="detail-close" onClick={closeDetail} aria-label="Close activity details"><X size={18} /></button><span className="detail-category">{selectedActivity.category}</span></div>
            <div className="detail-content">
              <div className="activity-location"><MapPin size={13} /> {selectedActivity.location}</div>
              <h2>{selectedActivity.name}</h2>
              <p className="detail-description">{selectedActivity.details}</p>
              <div className="detail-facts"><span><Clock3 size={15} /><strong>{getSchedule(selectedActivity).label} · {selectedActivity.duration}</strong><small>Time & duration</small></span><span><Wallet size={15} /><strong>{formatEurPrice(selectedActivity.price)}</strong><small>Per person (estimate) · {displayCurrency}</small>{displayCurrency !== "EUR" && <span className="detail-rate-note">Base: €{selectedActivity.price}</span>}</span></div>
              <div className="add-section"><span className="add-label">Add to your trip</span><div className="detail-day-picker">{dayIds.map((day) => <button key={day} className={activeDay === day ? "active" : ""} onClick={() => setActiveDay(day)}>{day}<span>{itinerary[day].some((item) => item.activityId === selectedActivity.id) ? <Check size={14} /> : <Plus size={14} />}</span></button>)}</div><button className="add-primary" onClick={() => addToDay(selectedActivity.id, activeDay)}>{itinerary[activeDay].some((item) => item.activityId === selectedActivity.id) ? <><Check size={16} /> Added to {activeDay}</> : <>Add to {activeDay} <ArrowRight size={16} /></>}</button></div>
              {selectedIds.includes(selectedActivity.id) && <p className="detail-note"><Check size={14} /> In your itinerary · {dayIds.find((day) => itinerary[day].some((item) => item.activityId === selectedActivity.id))}</p>}
            </div>
          </aside>
        </div>
      )}

      {showMobilePlan && (
        <div className={`mobile-plan-overlay ${isMobilePlanClosing ? "is-closing" : ""}`} onClick={() => closeMobilePlan()}>
          <aside className={`mobile-plan-sheet ${isMobilePlanClosing ? "is-closing" : ""}`} onClick={(event) => event.stopPropagation()} aria-label="Mobile itinerary">
            <div className="sheet-handle" /><div className="sheet-header"><div><span className="section-kicker">Your trip</span><h2>{destination.name}, slowly.</h2></div><button className="icon-button" onClick={() => closeMobilePlan()} aria-label="Close itinerary"><X size={18} /></button></div>
            <div className="rail-total"><div><span>Estimated total</span><strong>{formatAmount(totalCost)}</strong></div><div className="rail-count"><span>{selectedIds.length}</span> {selectedIds.length === 1 ? "activity" : "activities"}</div></div>
            <div className="rate-status-banner">
              <strong>{getRateStatusDescription(ratesState, displayCurrency)}</strong>
              {displayCurrency !== "EUR" && ratesState.rates[displayCurrency] && ratesState.status !== "fallback" && (
                <span>1 EUR = {formatExchangeRate(ratesState.rates[displayCurrency], displayCurrency)} reference rate</span>
              )}
              <small>Planning estimates only · Supplier rates may vary</small>
            </div>
            <div className={`budget-card ${budgetComparison.status}`}>
              <div className="budget-heading"><span>Trip budget</span><strong>{budgetComparison.statusHeading}</strong></div>
              <div className="budget-input-row"><span>{CURRENCIES[budgetCurrency].symbol}</span><input type="number" min="0" step="1" value={budgetInput} onChange={(event) => { const value = event.target.value; if (budgetInput.trim() === "") { setBudgetCurrency(displayCurrency); } setBudgetInput(value); }} placeholder="Set amount" aria-label={`Trip budget in ${budgetCurrency}`} /></div>
              <div className="budget-meter"><span style={{ width: `${budgetComparison.meterPercent}%` }} /></div>
              <small>{budgetComparison.summaryText}</small>
            </div>
            {conflictCount > 0 && <div className="conflict-alert"><AlertTriangle size={15} /><div><strong>{conflictCount} scheduling conflict{conflictCount === 1 ? "" : "s"}</strong>{dayIds.filter((day) => conflictsByDay[day].length > 0).map((day) => <small key={day}>{day}: {conflictsByDay[day].map((id) => activities.find((activity) => activity.id === id)?.name).filter(Boolean).join(" + ")}</small>)}</div></div>}
            <div className="day-tabs">{dayIds.map((day, index) => <button key={day} className={`${activeDay === day ? "active" : ""} ${draggingActivityId ? "drop-target" : ""}`} onClick={() => setActiveDay(day)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDayDrop(event, day)}><span>0{index + 1}</span>{day}<i>{itinerary[day].length}</i></button>)}</div>
            <div className="selected-day-label"><span>{activeDay}</span><div><small>Tap an activity to edit quantity</small><strong>{formatAmount(daySubtotals[activeDay])}</strong></div></div>{renderDayItems(activeDay)}
            <button className="checkout-button" onClick={openCheckout}><Wallet size={15} /> Review & checkout <ArrowRight size={15} /></button>
            <button className="continue-button" onClick={() => closeMobilePlan(() => document.getElementById("explore")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }))}>Keep exploring <ArrowRight size={16} /></button>
          </aside>
        </div>
      )}

      {checkoutStep && (
        <div className="checkout-overlay" role="dialog" aria-modal="true" aria-labelledby="checkout-dialog-title" onClick={returnToItinerary}>
          <section className="checkout-panel" onClick={(event) => event.stopPropagation()}>
            <div className="checkout-header">
              <div>
                <span className="section-kicker">ROAM checkout · {destination.name}</span>
                <h2 id="checkout-dialog-title">
                  {checkoutStep === "review"
                    ? "Review your trip"
                    : checkoutStep === "traveller"
                    ? "Traveller details"
                    : "Booking and payment"}
                </h2>
                <p>
                  {checkoutStep === "review"
                    ? "Make sure everything is right before continuing."
                    : checkoutStep === "traveller"
                    ? "Enter contact details for the lead traveller managing this booking."
                    : `Online booking is not yet available for ${destination.name}.`}
                </p>
              </div>
              <button type="button" className="icon-button" onClick={returnToItinerary} aria-label="Return to itinerary"><X size={18} /></button>
            </div>

            <div className="checkout-progress" aria-label="Checkout steps">
              <span
                className={`${checkoutStep === "review" ? "active" : "complete"}`}
                aria-current={checkoutStep === "review" ? "step" : undefined}
              >
                <i>{checkoutStep !== "review" ? <Check size={12} strokeWidth={2.8} /> : "1"}</i>
                <span>Review your trip</span>
              </span>
              <span
                className={`${
                  checkoutStep === "traveller"
                    ? "active"
                    : checkoutStep === "payment-placeholder"
                    ? "complete"
                    : "upcoming"
                }`}
                aria-current={checkoutStep === "traveller" ? "step" : undefined}
              >
                <i>{checkoutStep === "payment-placeholder" ? <Check size={12} strokeWidth={2.8} /> : "2"}</i>
                <span>Traveller details</span>
              </span>
              <span
                className={`${checkoutStep === "payment-placeholder" ? "active" : "upcoming"}`}
                aria-current={checkoutStep === "payment-placeholder" ? "step" : undefined}
              >
                <i>3</i>
                <span>Booking and payment</span>
              </span>
            </div>

            {checkoutStep === "review" && (
              <div className="checkout-body">
                {checkoutItems.length === 0 ? (
                  <div className="checkout-empty-state">
                    <div className="checkout-empty-icon" aria-hidden="true">
                      <Compass size={32} />
                    </div>
                    <h3>Your itinerary is empty</h3>
                    <p>
                      You haven't selected any activities yet. Return to the itinerary planner to choose curated local experiences for {destination.name}.
                    </p>
                    <button type="button" className="checkout-primary" onClick={returnToItinerary}>
                      Return to itinerary planning <ArrowRight size={15} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="checkout-destination-card">
                      <img
                        src={destination.image}
                        alt={destination.name}
                        className="checkout-destination-img"
                        referrerPolicy="no-referrer"
                      />
                      <div className="checkout-destination-info">
                        <div className="checkout-destination-kicker">
                          <span>Destination</span>
                          <strong>{destination.name}, {destination.country}</strong>
                        </div>
                        {destination.note && (
                          <p className="checkout-destination-note">{destination.note}</p>
                        )}
                        <div className="checkout-dates-panel">
                          <div className="checkout-date-entry">
                            <CalendarDays size={14} className="checkout-date-icon" aria-hidden="true" />
                            <div>
                              <span className="checkout-date-label">Travel dates</span>
                              <strong className="checkout-date-unselected">Travel dates not selected</strong>
                            </div>
                          </div>
                          <div className="checkout-date-entry">
                            <Clock3 size={14} className="checkout-date-icon" aria-hidden="true" />
                            <div>
                              <span className="checkout-date-label">Trip duration</span>
                              <span className="checkout-date-val">3 days planned (calendar dates unassigned)</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="checkout-section-heading">
                      <span>Selected activities</span>
                      <small>{checkoutItems.length} {checkoutItems.length === 1 ? "activity" : "activities"}</small>
                    </div>

                    <div className="checkout-items">
                      {dayIds.map((day) => {
                        const dayItems = checkoutItems.filter((entry) => entry.day === day);
                        if (!dayItems.length) return null;
                        return (
                          <div className="checkout-day" key={day}>
                            <div className="checkout-day-heading">
                              <strong>{day}</strong>
                              <span>{formatAmount(daySubtotals[day])}</span>
                            </div>
                            {dayItems.map(({ item, activity }) => {
                              const unit = itineraryAmounts.unitPrices[activity.id] ?? getConvertedUnitPrice(activity.price, rate);
                              const line = itineraryAmounts.lineTotals[`${day}-${activity.id}`] ?? getConvertedLineTotal(activity.price, item.quantity, rate);
                              return (
                                <div className="checkout-item" key={`${day}-${activity.id}`}>
                                  <img
                                    src={activity.image}
                                    alt={activity.name}
                                    className="checkout-item-thumb"
                                    referrerPolicy="no-referrer"
                                  />
                                  <div className="checkout-item-details">
                                    <div className="checkout-item-header">
                                      <strong>{activity.name}</strong>
                                      <b className="checkout-item-price">{formatCurrency(line, displayCurrency)}</b>
                                    </div>
                                    {activity.description && (
                                      <p className="checkout-item-desc">{activity.description}</p>
                                    )}
                                    <div className="checkout-item-meta">
                                      <span>{item.quantity} {item.quantity === 1 ? "participant" : "participants"} × {formatCurrency(unit, displayCurrency)}</span>
                                      <span aria-hidden="true">·</span>
                                      <span>{activity.duration}</span>
                                      <span aria-hidden="true">·</span>
                                      <span>{activity.location}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>

                    <div className="checkout-breakdown">
                      <div className="checkout-breakdown-row">
                        <span>Activities subtotal ({checkoutItems.length} {checkoutItems.length === 1 ? "activity" : "activities"})</span>
                        <strong>{formatAmount(totalCost)}</strong>
                      </div>
                      <div className="checkout-breakdown-total">
                        <div>
                          <span className="checkout-total-label">Estimated total</span>
                          <small className="checkout-currency-tag">{displayCurrency} · Indicative estimate</small>
                        </div>
                        <strong className="checkout-total-figure">{formatAmount(totalCost)}</strong>
                      </div>
                    </div>

                    <div className="checkout-pricing-note" role="note">
                      <p>
                        <strong>Prices are estimates.</strong> Supplier availability, final prices, taxes and additional charges must be verified before booking.
                      </p>
                      <small className="checkout-rate-caption">
                        {getRateStatusDescription(ratesState, displayCurrency)}
                        {displayCurrency !== "EUR" && ratesState.rates[displayCurrency] && ratesState.status !== "fallback" && (
                          <> · 1 EUR = {formatExchangeRate(ratesState.rates[displayCurrency], displayCurrency)} reference rate</>
                        )}
                      </small>
                    </div>

                    <div className="checkout-actions">
                      <button type="button" className="checkout-secondary" onClick={returnToItinerary}>
                        Edit itinerary
                      </button>
                      <button
                        type="button"
                        className="checkout-primary"
                        onClick={() => setCheckoutStep("traveller")}
                      >
                        Continue to traveller details <ArrowRight size={15} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {checkoutStep === "traveller" && (
              <div className="checkout-body">
                <div className="traveller-summary-card">
                  <div className="traveller-summary-header">
                    <div className="traveller-summary-badge">
                      <User size={14} />
                      <span>Lead Traveller</span>
                    </div>
                    <div className="traveller-guest-count">
                      <strong>{partySize} {partySize === 1 ? "traveller" : "travellers"}</strong>
                      <span>in booking party</span>
                    </div>
                  </div>
                  <p className="traveller-summary-note">
                    Derived from your {checkoutItems.length} planned {checkoutItems.length === 1 ? "activity" : "activities"} in {destination.name}. As lead traveller, this person will receive tickets, booking confirmations, and host communications for all party members.
                  </p>
                </div>

                <form
                  className="traveller-form"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleProceedToPayment();
                  }}
                >
                  <div className="traveller-form-section">
                    <h3 className="traveller-form-title">Lead traveller contact details</h3>
                    <p className="traveller-form-subtitle">
                      Enter contact information for the primary adult traveller in your group.
                    </p>

                    <div className={`form-group ${travellerTouched.fullName && travellerErrors.fullName ? "has-error" : ""}`}>
                      <label htmlFor="traveller-fullName">
                        Full name <span className="req-star" aria-hidden="true">*</span>
                      </label>
                      <div className="input-with-icon">
                        <User size={15} className="input-icon" aria-hidden="true" />
                        <input
                          id="traveller-fullName"
                          name="fullName"
                          type="text"
                          autoComplete="name"
                          placeholder="e.g. Eleanor Vance"
                          value={travellerForm.fullName}
                          onChange={(e) => handleTravellerChange("fullName", e.target.value)}
                          onBlur={() => handleTravellerBlur("fullName")}
                          required
                          aria-invalid={Boolean(travellerTouched.fullName && travellerErrors.fullName)}
                          aria-describedby={
                            travellerTouched.fullName && travellerErrors.fullName
                              ? "traveller-fullName-error"
                              : "traveller-fullName-hint"
                          }
                        />
                      </div>
                      <span id="traveller-fullName-hint" className="form-hint">
                        Enter your full name as you would like it shown on your booking.
                      </span>
                      {travellerTouched.fullName && travellerErrors.fullName && (
                        <span id="traveller-fullName-error" className="form-error" role="alert">
                          <AlertTriangle size={12} /> {travellerErrors.fullName}
                        </span>
                      )}
                    </div>

                    <div className={`form-group ${travellerTouched.email && travellerErrors.email ? "has-error" : ""}`}>
                      <label htmlFor="traveller-email">
                        Email address <span className="req-star" aria-hidden="true">*</span>
                      </label>
                      <div className="input-with-icon">
                        <Mail size={15} className="input-icon" aria-hidden="true" />
                        <input
                          id="traveller-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          placeholder="e.g. eleanor@example.com"
                          value={travellerForm.email}
                          onChange={(e) => handleTravellerChange("email", e.target.value)}
                          onBlur={() => handleTravellerBlur("email")}
                          required
                          aria-invalid={Boolean(travellerTouched.email && travellerErrors.email)}
                          aria-describedby={
                            travellerTouched.email && travellerErrors.email
                              ? "traveller-email-error"
                              : "traveller-email-hint"
                          }
                        />
                      </div>
                      <span id="traveller-email-hint" className="form-hint">
                        Vouchers, itinerary confirmation, and notifications will be sent here
                      </span>
                      {travellerTouched.email && travellerErrors.email && (
                        <span id="traveller-email-error" className="form-error" role="alert">
                          <AlertTriangle size={12} /> {travellerErrors.email}
                        </span>
                      )}
                    </div>

                    <div className={`form-group ${travellerTouched.phone && travellerErrors.phone ? "has-error" : ""}`}>
                      <label htmlFor="traveller-phone">
                        Phone number <span className="req-star" aria-hidden="true">*</span>
                      </label>
                      <div className="phone-input-combo">
                        <div className="country-code-select-wrap">
                          <label htmlFor="traveller-countryCode" className="sr-only">Country calling code</label>
                          <select
                            id="traveller-countryCode"
                            name="countryCode"
                            value={travellerForm.countryCode}
                            onChange={(e) => handleTravellerChange("countryCode", e.target.value)}
                            onBlur={() => handleTravellerBlur("countryCode")}
                            aria-invalid={Boolean(travellerTouched.countryCode && travellerErrors.countryCode)}
                          >
                            {COUNTRY_CALLING_CODES.map((item) => (
                              <option key={`${item.code}-${item.country}`} value={item.code}>
                                {item.flag} {item.code} ({item.country})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="input-with-icon phone-number-input">
                          <Phone size={15} className="input-icon" aria-hidden="true" />
                          <input
                            id="traveller-phone"
                            name="phone"
                            type="tel"
                            autoComplete="tel-national"
                            placeholder="e.g. 555-0199"
                            value={travellerForm.phone}
                            onChange={(e) => handleTravellerChange("phone", e.target.value)}
                            onBlur={() => handleTravellerBlur("phone")}
                            required
                            aria-invalid={Boolean(travellerTouched.phone && travellerErrors.phone)}
                            aria-describedby={
                              travellerTouched.phone && travellerErrors.phone
                                ? "traveller-phone-error"
                                : "traveller-phone-hint"
                            }
                          />
                        </div>
                      </div>
                      <span id="traveller-phone-hint" className="form-hint">
                        Used for urgent pickup coordination or timing updates by local hosts
                      </span>
                      {travellerTouched.phone && travellerErrors.phone && (
                        <span id="traveller-phone-error" className="form-error" role="alert">
                          <AlertTriangle size={12} /> {travellerErrors.phone}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="traveller-privacy-note">
                    <Mail size={16} className="privacy-icon" />
                    <div>
                      <strong>Contact & coordination</strong>
                      <p>
                        Your name, email address, and phone number are used to address your booking summary and coordinate activity timings with hosts.
                      </p>
                    </div>
                  </div>

                  <div className="checkout-actions">
                    <button
                      type="button"
                      className="checkout-secondary"
                      onClick={() => setCheckoutStep("review")}
                    >
                      <ArrowLeft size={15} /> Back to trip review
                    </button>
                    <button
                      type="submit"
                      className="checkout-primary"
                    >
                      Continue to booking and payment <ArrowRight size={15} />
                    </button>
                  </div>
                </form>
              </div>
            )}

            {checkoutStep === "payment-placeholder" && (
              <div className="checkout-body placeholder-body">
                <div className="placeholder-status-card" role="status" aria-live="polite">
                  <div className="placeholder-status-icon" aria-hidden="true">
                    <Compass size={22} />
                  </div>
                  <div>
                    <h3>Booking integration in progress</h3>
                    <p>
                      Your itinerary and traveller details are ready. Booking integration for {destination.name} activities is not available yet. You can return to your itinerary and continue planning.
                    </p>
                  </div>
                </div>

                <div className="placeholder-summary-card">
                  <div className="placeholder-summary-row">
                    <span>Destination</span>
                    <strong>{destination.name}, {destination.country}</strong>
                  </div>
                  <div className="placeholder-summary-row">
                    <span>Lead traveller</span>
                    <strong>{travellerForm.fullName}</strong>
                  </div>
                  <div className="placeholder-summary-row">
                    <span>Contact</span>
                    <strong>{travellerForm.email} · {travellerForm.countryCode} {travellerForm.phone}</strong>
                  </div>
                  <div className="placeholder-summary-row">
                    <span>Booking party</span>
                    <strong>{partySize} {partySize === 1 ? "traveller" : "travellers"} ({checkoutItems.length} {checkoutItems.length === 1 ? "activity" : "activities"})</strong>
                  </div>
                  <div className="placeholder-summary-row">
                    <span>Estimated total</span>
                    <strong>{formatAmount(totalCost)}</strong>
                  </div>
                </div>

                <ul className="placeholder-guarantee-list">
                  <li>No payment card or payment details have been requested or charged.</li>
                  <li>No booking or reservation order has been placed with suppliers.</li>
                  <li>Your entered traveller details remain accessible during your current session.</li>
                </ul>

                <div className="checkout-actions">
                  <button type="button" className="checkout-secondary" onClick={() => setCheckoutStep("traveller")}>
                    <ArrowLeft size={15} /> Back to traveller details
                  </button>
                  <button type="button" className="checkout-primary" onClick={returnToItinerary}>
                    Back to Itinerary
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status"><Check size={15} /> {notice}</div>}
    </div>
  );
}
