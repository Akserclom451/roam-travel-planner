import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Filter,
  GripVertical,
  Heart,
  MapPin,
  Menu,
  Navigation,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

type DestinationId = "kyoto" | "lisbon" | "reykjavik";
type DayId = "Day 1" | "Day 2" | "Day 3";
type Category = "All" | "Culture" | "Food" | "Outdoors" | "Slow travel";
type PriceFilter = "All" | "under30" | "30to70" | "over70";

type Currency = {
  code: string;
  symbol: string;
};

type CurrencyCode = "JPY" | "EUR" | "ISK";

type SavedPlan = {
  id: string;
  destinationId: DestinationId;
  itinerary: Record<DayId, PlannedActivity[]>;
  budgetInput: string;
  createdAt: number;
};

type CheckoutStep = "review" | "payment" | "processing" | "success" | "failure";

type PaymentForm = {
  name: string;
  cardNumber: string;
  expiry: string;
  securityCode: string;
  forceFailure: boolean;
};

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
    image: "/manus-storage/roam-kyoto_443cd089.jpg",
    note: "Temple paths, quiet lanes, and small rituals.",
    currency: { code: "JPY", symbol: "¥" },
  },
  {
    id: "lisbon",
    name: "Lisbon",
    country: "Portugal",
    days: "3 days",
    image: "/manus-storage/roam-lisbon_33475605.jpg",
    note: "Sun-warmed tiles, sea air, and late dinners.",
    currency: { code: "EUR", symbol: "€" },
  },
  {
    id: "reykjavik",
    name: "Reykjavík",
    country: "Iceland",
    days: "3 days",
    image: "/manus-storage/roam-reykjavik_8421fb14.jpg",
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
      image: "/manus-storage/roam-lisbon_33475605.jpg",
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
const currencies: Record<CurrencyCode, Currency> = {
  JPY: { code: "JPY", symbol: "¥" },
  EUR: { code: "EUR", symbol: "€" },
  ISK: { code: "ISK", symbol: "kr" },
};
const currencyOptions: CurrencyCode[] = ["JPY", "EUR", "ISK"];

function formatPrice(price: number, currency: Currency) {
  return currency.code === "ISK" ? `${currency.symbol} ${price}` : `${currency.symbol}${price}`;
}

function getPriceFilterLabel(filter: PriceFilter, currency: Currency) {
  if (filter === "under30") return `Under ${formatPrice(30, currency)}`;
  if (filter === "30to70") return `${formatPrice(30, currency)}–${formatPrice(70, currency)}`;
  if (filter === "over70") return `${formatPrice(70, currency)}+`;
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
  const [itinerary, setItinerary] = useState<Record<DayId, PlannedActivity[]>>({
    "Day 1": [],
    "Day 2": [],
    "Day 3": [],
  });
  const [budgetInput, setBudgetInput] = useState("");
  const [showMobilePlan, setShowMobilePlan] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSavedPlans, setShowSavedPlans] = useState(false);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("roam-saved-plans") || "[]") as SavedPlan[];
    } catch {
      return [];
    }
  });
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() => typeof window !== "undefined" && (localStorage.getItem("roam-reduce-motion") === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches));
  const [notice, setNotice] = useState("");
  const [draggingActivityId, setDraggingActivityId] = useState<string | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>({ name: "", cardNumber: "", expiry: "", securityCode: "", forceFailure: false });
  const [paymentError, setPaymentError] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const paymentTimer = useRef<number | null>(null);

  const selectedCurrency = currencies[currencyCode];
  const destination = { ...(destinations.find((item) => item.id === selectedDestination) ?? destinations[0]), currency: selectedCurrency };
  const activities = activityData[selectedDestination];
  const selectedActivity = activities.find((activity) => activity.id === selectedActivityId) ?? null;
  const selectedItems = useMemo(() => Object.values(itinerary).flat(), [itinerary]);
  const selectedIds = useMemo(() => selectedItems.map((item) => item.activityId), [selectedItems]);
  const checkoutItems = useMemo(() => dayIds.flatMap((day) => itinerary[day]
    .map((item) => ({ day, item, activity: activities.find((candidate) => candidate.id === item.activityId) }))
    .filter((entry): entry is { day: DayId; item: PlannedActivity; activity: Activity } => Boolean(entry.activity))), [activities, itinerary]);
  const daySubtotals = useMemo(() => dayIds.reduce<Record<DayId, number>>((totals, day) => {
    totals[day] = itinerary[day].reduce((sum, item) => {
      const activity = activities.find((candidate) => candidate.id === item.activityId);
      return sum + (activity ? activity.price * item.quantity : 0);
    }, 0);
    return totals;
  }, { "Day 1": 0, "Day 2": 0, "Day 3": 0 }), [activities, itinerary]);
  const totalCost = Object.values(daySubtotals).reduce((sum, subtotal) => sum + subtotal, 0);
  const budget = budgetInput.trim() === "" ? null : Math.max(0, Number(budgetInput) || 0);
  const budgetExceeded = budget !== null && totalCost > budget;
  const budgetPercent = budget === null || budget === 0 ? (totalCost > 0 ? 100 : 0) : Math.min(100, (totalCost / budget) * 100);
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
  const isPlanSaved = useMemo(() => savedPlans.some((plan) => plan.destinationId === selectedDestination && plan.budgetInput === budgetInput && JSON.stringify(plan.itinerary) === JSON.stringify(itinerary)), [budgetInput, itinerary, savedPlans, selectedDestination]);

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
    if (!selectedActivityId && !showMobilePlan && !checkoutStep && !showMenu && !showResetConfirm) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedActivityId, showMobilePlan, checkoutStep, showMenu, showResetConfirm]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
    localStorage.setItem("roam-reduce-motion", String(reduceMotion));
  }, [reduceMotion]);

  useEffect(() => {
    localStorage.setItem("roam-saved-plans", JSON.stringify(savedPlans));
  }, [savedPlans]);

  useEffect(() => {
    if (!showMenu && !showResetConfirm) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowMenu(false);
        setShowResetConfirm(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showMenu, showResetConfirm]);

  useEffect(() => () => {
    if (paymentTimer.current !== null) window.clearTimeout(paymentTimer.current);
  }, []);

  const switchDestination = (id: DestinationId) => {
    const previousDestination = destination.name;
    const hadItinerary = selectedIds.length > 0;
    const nextDestination = destinations.find((item) => item.id === id)?.name ?? "your destination";
    const nextCurrency = destinations.find((item) => item.id === id)?.currency.code as CurrencyCode | undefined;
    setSelectedDestination(id);
    if (nextCurrency) setCurrencyCode(nextCurrency);
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
      createdAt: Date.now(),
    };
    setSavedPlans((current) => [plan, ...current.filter((item) => !(item.destinationId === selectedDestination && item.budgetInput === budgetInput && JSON.stringify(item.itinerary) === JSON.stringify(itinerary)))].slice(0, 12));
    flashNotice(isPlanSaved ? "Plan already saved" : "Plan saved locally");
  };

  const loadSavedPlan = (plan: SavedPlan) => {
    const savedDestination = destinations.find((item) => item.id === plan.destinationId) ?? destinations[0];
    setSelectedDestination(savedDestination.id);
    setCurrencyCode(savedDestination.currency.code as CurrencyCode);
    setItinerary(JSON.parse(JSON.stringify(plan.itinerary)) as Record<DayId, PlannedActivity[]>);
    setBudgetInput(plan.budgetInput);
    setActiveDay("Day 1");
    setShowSavedPlans(false);
    closeMenu();
    flashNotice(`${savedDestination.name} plan reopened`);
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
    if (checkoutItems.length === 0) {
      flashNotice("Add at least one activity before checkout");
      return;
    }
    setShowMobilePlan(false);
    setSelectedActivityId(null);
    setPaymentError("");
    setCheckoutStep("review");
  };

  const updatePaymentField = (field: keyof PaymentForm, value: string | boolean) => {
    setPaymentForm((current) => ({ ...current, [field]: value }));
    if (paymentError) setPaymentError("");
  };

  const validatePayment = () => {
    const digits = paymentForm.cardNumber.replace(/\s/g, "");
    if (paymentForm.name.trim().length < 2) return "Enter the name on this test card.";
    if (!/^\d{16}$/.test(digits)) return "Enter a 16-digit test card number.";
    if (!/^(0[1-9]|1[0-2])\/?(2[6-9]|[3-9]\d)$/.test(paymentForm.expiry.trim())) return "Use a valid expiry in MM/YY format.";
    if (!/^\d{3,4}$/.test(paymentForm.securityCode.trim())) return "Enter a 3 or 4 digit security code.";
    return "";
  };

  const submitPayment = () => {
    if (checkoutStep !== "payment" || paymentTimer.current !== null) return;
    const validationError = validatePayment();
    if (validationError) {
      setPaymentError(validationError);
      return;
    }
    setPaymentError("");
    setCheckoutStep("processing");
    paymentTimer.current = window.setTimeout(() => {
      paymentTimer.current = null;
      if (paymentForm.forceFailure) {
        setCheckoutStep("failure");
        setPaymentError("This test-only failure was requested. No payment was sent or stored.");
        return;
      }
      setOrderReference(`ROAM-${Date.now().toString(36).toUpperCase().slice(-6)}`);
      setCheckoutStep("success");
    }, 1400);
  };

  const returnToItinerary = () => {
    setCheckoutStep(null);
    setPaymentError("");
    setShowMobilePlan(false);
  };

  const closeMenu = () => {
    setShowMenu(false);
    window.setTimeout(() => menuTriggerRef.current?.focus(), reduceMotion ? 0 : 180);
  };

  const scrollToSection = (id: string) => {
    closeMenu();
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }), 170);
  };

  const resetPlan = () => {
    setItinerary({ "Day 1": [], "Day 2": [], "Day 3": [] });
    setBudgetInput("");
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
              <small>{getSchedule(activity).label} · {activity.duration} · {formatPrice(activity.price * item.quantity, destination.currency)}</small>
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
            <button ref={menuTriggerRef} className="nav-action options-trigger" aria-label="Open options" aria-expanded={showMenu} onClick={() => setShowMenu(true)}><span className="options-trigger-label">Options</span><Menu size={17} /></button>
          </div>
        </div>
      </header>

      <main id="top" className="page-wrap">
        <section className="intro-section" aria-labelledby="page-title">
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

        <section className="destination-picker" id="destination-picker" aria-label="Choose a destination">
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
            {destinations.map((item) => (
              <button key={item.id} className={`destination-chip ${selectedDestination === item.id ? "selected" : ""}`} onClick={() => switchDestination(item.id)}>
                <img src={item.image} alt="" />
                <span><strong>{item.name}</strong><small>{item.country}</small></span>
                {selectedDestination === item.id && <Check size={15} />}
              </button>
            ))}
          </div>
        </section>

        <section className="destination-banner" aria-label={`Selected destination: ${destination.name}`}>
          <img src={destination.image} alt={`${destination.name} travel scene`} />
          <div className="banner-scrim" />
          <div className="banner-content">
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
          <div><span>{selectedIds.length} {selectedIds.length === 1 ? "activity" : "activities"}</span><strong>{formatPrice(totalCost, destination.currency)}</strong></div>
          <button onClick={() => setShowMobilePlan(true)}>View itinerary <ArrowRight size={15} /></button>
        </div>

        <section className="planning-layout" id="explore">
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
              <div className="filter-options">{priceFilters.map((item) => <button key={item} className={priceFilter === item ? "active" : ""} onClick={() => setPriceFilter(item)}>{getPriceFilterLabel(item, destination.currency)}</button>)}</div>
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
                      onClick={() => setSelectedActivityId(activity.id)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedActivityId(activity.id); }}
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
                        <div className="activity-card-footer"><span><Clock3 size={13} /> {activity.duration}</span><strong>{formatPrice(activity.price, destination.currency)}</strong><ChevronRight size={16} className="card-arrow" /></div>
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
            <div className="rail-total"><div><span>Estimated total</span><strong>{formatPrice(totalCost, destination.currency)}</strong></div><div className="rail-count"><span>{selectedIds.length}</span> {selectedIds.length === 1 ? "activity" : "activities"}</div></div>
            <div className={`budget-card ${budget === null ? "unset" : budgetExceeded ? "exceeded" : "within"}`}>
              <div className="budget-heading"><span>Trip budget</span><strong>{budget === null ? "Not set" : budgetExceeded ? "Over budget" : "Within budget"}</strong></div>
              <div className="budget-input-row"><span>{destination.currency.symbol}</span><input type="number" min="0" step="1" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} placeholder="Set amount" aria-label={`Trip budget in ${destination.currency.code}`} /></div>
              <div className="budget-meter"><span style={{ width: `${budgetPercent}%` }} /></div>
              <small>{budget === null ? "Add a limit to keep your trip on track." : `${formatPrice(totalCost, destination.currency)} of ${formatPrice(budget, destination.currency)} · ${budgetExceeded ? formatPrice(totalCost - budget, destination.currency) + " over" : formatPrice(budget - totalCost, destination.currency) + " left"}`}</small>
            </div>
            {conflictCount > 0 && <div className="conflict-alert"><AlertTriangle size={15} /><div><strong>{conflictCount} scheduling conflict{conflictCount === 1 ? "" : "s"}</strong>{dayIds.filter((day) => conflictsByDay[day].length > 0).map((day) => <small key={day}>{day}: {conflictsByDay[day].map((id) => activities.find((activity) => activity.id === id)?.name).filter(Boolean).join(" + ")}</small>)}</div></div>}
            <div className="day-tabs" role="tablist" aria-label="Trip days">
              {dayIds.map((day, index) => <button key={day} className={`${activeDay === day ? "active" : ""} ${draggingActivityId ? "drop-target" : ""}`} onClick={() => setActiveDay(day)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDayDrop(event, day)} role="tab" aria-selected={activeDay === day}><span>0{index + 1}</span>{day.replace(" ", " ")}{itinerary[day].length > 0 && <i>{itinerary[day].length}</i>}</button>)}
            </div>
            <div className="selected-day-label"><span>{activeDay}</span><div><small>{draggingActivityId ? "Drop on a day tab to move" : activeDay === "Day 1" ? "Arrive & orient" : activeDay === "Day 2" ? "Go a little deeper" : "Leave room for one more thing"}</small><strong>{formatPrice(daySubtotals[activeDay], destination.currency)}</strong></div></div>
            {renderDayItems(activeDay)}
            <div className="rail-tip"><Sparkles size={15} /><span><strong>Leave 20% unplanned.</strong><br />The best moments rarely make the first draft.</span></div>
            <button className="checkout-button" onClick={openCheckout}><Wallet size={15} /> Review & mock pay <ArrowRight size={15} /></button>
            <button className="continue-button" onClick={() => document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" })}>Keep exploring <ArrowRight size={16} /></button>
          </aside>
        </section>
        <section className="journey-section" id="how-it-works" aria-labelledby="journey-title">
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
        <div className="menu-overlay" onClick={closeMenu}>
          <aside className="menu-panel" role="dialog" aria-modal="true" aria-labelledby="menu-title" onClick={(event) => event.stopPropagation()}>
            <div className="menu-header"><div><span className="section-kicker">ROAM / Options</span><h2 id="menu-title">Make room<br /><em>to move.</em></h2></div><button className="icon-button menu-close" onClick={closeMenu} aria-label="Close menu"><X size={18} /></button></div>
            <nav className="menu-nav" aria-label="ROAM menu">
              <button onClick={() => scrollToSection("destination-picker")}><span>01</span><strong>Destinations</strong><ArrowRight size={16} /></button>
              <button onClick={() => scrollToSection("explore")}><span>02</span><strong>Curated activities</strong><ArrowRight size={16} /></button>
              <button onClick={() => { closeMenu(); if (window.matchMedia("(max-width: 760px)").matches) setShowMobilePlan(true); else window.setTimeout(() => document.getElementById("itinerary")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }), 170); }}><span>03</span><strong>Active itinerary ({selectedIds.length})</strong><ArrowRight size={16} /></button>
              <button className="menu-saved" onClick={() => setShowSavedPlans((current) => !current)}><span>04</span><strong>Saved Plans ({savedPlans.length})</strong><ChevronDown size={15} className={showSavedPlans ? "rotated" : ""} /></button>
            </nav>
            {showSavedPlans && <div className="saved-plans-list">{savedPlans.length === 0 ? <p>No saved plans yet. Save an itinerary to find it here.</p> : savedPlans.map((plan) => { const savedDestination = destinations.find((item) => item.id === plan.destinationId) ?? destinations[0]; return <div className="saved-plan-row" key={plan.id}><button onClick={() => loadSavedPlan(plan)}><strong>{savedDestination.name}, slowly.</strong><small>{Object.values(plan.itinerary).flat().length} activities · {new Date(plan.createdAt).toLocaleDateString()}</small></button><button className="saved-plan-delete" aria-label={`Delete ${savedDestination.name} saved plan`} onClick={() => deleteSavedPlan(plan.id)}><Trash2 size={14} /></button></div>; })}</div>}
            <div className="menu-settings">
              <button className="menu-setting currency-control" onClick={() => setCurrencyCode(currencyOptions[(currencyOptions.indexOf(currencyCode) + 1) % currencyOptions.length])}><span>05</span><strong>Currency</strong><b>{selectedCurrency.code} ({selectedCurrency.symbol})</b></button>
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

      {selectedActivity && (
        <div className="detail-overlay" onClick={() => setSelectedActivityId(null)}>
          <aside className="detail-panel" onClick={(event) => event.stopPropagation()} aria-label="Activity details">
            <div className="detail-image-wrap"><img src={selectedActivity.image} alt={`${selectedActivity.name} preview`} /><div className="detail-image-scrim" /><button className="detail-close" onClick={() => setSelectedActivityId(null)} aria-label="Close activity details"><X size={18} /></button><span className="detail-category">{selectedActivity.category}</span></div>
            <div className="detail-content">
              <div className="activity-location"><MapPin size={13} /> {selectedActivity.location}</div>
              <h2>{selectedActivity.name}</h2>
              <p className="detail-description">{selectedActivity.details}</p>
              <div className="detail-facts"><span><Clock3 size={15} /><strong>{getSchedule(selectedActivity).label} · {selectedActivity.duration}</strong><small>Time & duration</small></span><span><Wallet size={15} /><strong>{formatPrice(selectedActivity.price, destination.currency)}</strong><small>Per person · {destination.currency.code}</small></span></div>
              <div className="add-section"><span className="add-label">Add to your trip</span><div className="detail-day-picker">{dayIds.map((day) => <button key={day} className={activeDay === day ? "active" : ""} onClick={() => setActiveDay(day)}>{day}<span>{itinerary[day].some((item) => item.activityId === selectedActivity.id) ? <Check size={14} /> : <Plus size={14} />}</span></button>)}</div><button className="add-primary" onClick={() => addToDay(selectedActivity.id, activeDay)}>{itinerary[activeDay].some((item) => item.activityId === selectedActivity.id) ? <><Check size={16} /> Added to {activeDay}</> : <>Add to {activeDay} <ArrowRight size={16} /></>}</button></div>
              {selectedIds.includes(selectedActivity.id) && <p className="detail-note"><Check size={14} /> In your itinerary · {dayIds.find((day) => itinerary[day].some((item) => item.activityId === selectedActivity.id))}</p>}
            </div>
          </aside>
        </div>
      )}

      {showMobilePlan && (
        <div className="mobile-plan-overlay" onClick={() => setShowMobilePlan(false)}>
          <aside className="mobile-plan-sheet" onClick={(event) => event.stopPropagation()} aria-label="Mobile itinerary">
            <div className="sheet-handle" /><div className="sheet-header"><div><span className="section-kicker">Your trip</span><h2>{destination.name}, slowly.</h2></div><button className="icon-button" onClick={() => setShowMobilePlan(false)} aria-label="Close itinerary"><X size={18} /></button></div>
            <div className="rail-total"><div><span>Estimated total</span><strong>{formatPrice(totalCost, destination.currency)}</strong></div><div className="rail-count"><span>{selectedIds.length}</span> {selectedIds.length === 1 ? "activity" : "activities"}</div></div>
            <div className={`budget-card ${budget === null ? "unset" : budgetExceeded ? "exceeded" : "within"}`}>
              <div className="budget-heading"><span>Trip budget</span><strong>{budget === null ? "Not set" : budgetExceeded ? "Over budget" : "Within budget"}</strong></div>
              <div className="budget-input-row"><span>{destination.currency.symbol}</span><input type="number" min="0" step="1" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} placeholder="Set amount" aria-label={`Trip budget in ${destination.currency.code}`} /></div>
              <div className="budget-meter"><span style={{ width: `${budgetPercent}%` }} /></div>
              <small>{budget === null ? "Add a limit to keep your trip on track." : `${formatPrice(totalCost, destination.currency)} of ${formatPrice(budget, destination.currency)} · ${budgetExceeded ? formatPrice(totalCost - budget, destination.currency) + " over" : formatPrice(budget - totalCost, destination.currency) + " left"}`}</small>
            </div>
            {conflictCount > 0 && <div className="conflict-alert"><AlertTriangle size={15} /><div><strong>{conflictCount} scheduling conflict{conflictCount === 1 ? "" : "s"}</strong>{dayIds.filter((day) => conflictsByDay[day].length > 0).map((day) => <small key={day}>{day}: {conflictsByDay[day].map((id) => activities.find((activity) => activity.id === id)?.name).filter(Boolean).join(" + ")}</small>)}</div></div>}
            <div className="day-tabs">{dayIds.map((day, index) => <button key={day} className={`${activeDay === day ? "active" : ""} ${draggingActivityId ? "drop-target" : ""}`} onClick={() => setActiveDay(day)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDayDrop(event, day)}><span>0{index + 1}</span>{day}<i>{itinerary[day].length}</i></button>)}</div>
            <div className="selected-day-label"><span>{activeDay}</span><div><small>Tap an activity to edit quantity</small><strong>{formatPrice(daySubtotals[activeDay], destination.currency)}</strong></div></div>{renderDayItems(activeDay)}
            <button className="checkout-button" onClick={openCheckout}><Wallet size={15} /> Review & mock pay <ArrowRight size={15} /></button>
            <button className="continue-button" onClick={() => { setShowMobilePlan(false); document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" }); }}>Keep exploring <ArrowRight size={16} /></button>
          </aside>
        </div>
      )}

      {checkoutStep && (
        <div className="checkout-overlay" role="dialog" aria-modal="true" aria-label="ROAM mock checkout">
          <section className="checkout-panel" onClick={(event) => event.stopPropagation()}>
            <div className="checkout-header">
              <div>
                <span className="section-kicker">ROAM mock checkout · {destination.currency.code}</span>
                <h2>{checkoutStep === "review" ? "Review your slow days." : checkoutStep === "payment" ? "A small step to go." : checkoutStep === "processing" ? "Taking a moment." : checkoutStep === "success" ? "Your plan is held." : "No payment was completed."}</h2>
                <p>{checkoutStep === "review" ? "Check the details before entering fictional test payment information." : checkoutStep === "payment" ? "This is a prototype payment form. Nothing is sent or stored." : checkoutStep === "processing" ? "We are simulating a secure payment check." : checkoutStep === "success" ? "Your mock payment was accepted for this prototype." : "Your itinerary is unchanged and ready to try again."}</p>
              </div>
              <button className="icon-button" onClick={returnToItinerary} aria-label="Return to itinerary"><X size={18} /></button>
            </div>

            <div className="checkout-progress" aria-label="Checkout progress">
              {(["review", "payment", "processing", "result"] as const).map((step, index) => <span key={step} className={`${checkoutStep === step || (step === "result" && (checkoutStep === "success" || checkoutStep === "failure")) ? "active" : ""} ${index < (["review", "payment", "processing", "success", "failure"].indexOf(checkoutStep)) ? "complete" : ""}`}><i>{index + 1}</i>{step === "result" ? "Result" : step[0].toUpperCase() + step.slice(1)}</span>)}
            </div>

            {checkoutStep === "review" && (
              <div className="checkout-body">
                <div className="checkout-destination"><img src={destination.image} alt="" /><div><span>Destination</span><strong>{destination.name}, {destination.country}</strong><small>Three unhurried days · {destination.currency.code}</small></div></div>
                <div className="checkout-section-heading"><span>Selected activities</span><small>{checkoutItems.length} {checkoutItems.length === 1 ? "activity" : "activities"}</small></div>
                <div className="checkout-items">
                  {dayIds.map((day) => {
                    const dayItems = checkoutItems.filter((entry) => entry.day === day);
                    if (!dayItems.length) return null;
                    return <div className="checkout-day" key={day}><div className="checkout-day-heading"><strong>{day}</strong><span>{formatPrice(daySubtotals[day], destination.currency)}</span></div>{dayItems.map(({ item, activity }) => <div className="checkout-item" key={`${day}-${activity.id}`}><img src={activity.image} alt="" /><div><strong>{activity.name}</strong><small>{item.quantity} × {formatPrice(activity.price, destination.currency)} · {activity.duration}</small></div><b>{formatPrice(activity.price * item.quantity, destination.currency)}</b></div>)}</div>;
                  })}
                </div>
                <div className="checkout-total"><span>Final amount</span><strong>{formatPrice(totalCost, destination.currency)}</strong></div>
                <div className="checkout-actions"><button className="checkout-secondary" onClick={returnToItinerary}>Edit itinerary</button><button className="checkout-primary" onClick={() => setCheckoutStep("payment")}>Continue to payment <ArrowRight size={16} /></button></div>
              </div>
            )}

            {checkoutStep === "payment" && (
              <form className="checkout-body payment-body" onSubmit={(event) => { event.preventDefault(); submitPayment(); }}>
                <div className="payment-total"><div><span>Paying for</span><strong>{destination.name} itinerary</strong></div><b>{formatPrice(totalCost, destination.currency)}</b></div>
                <div className="mock-payment-note"><Wallet size={16} /><span>Test mode only · no payment provider connected · card data never leaves this page.</span></div>
                <div className="payment-grid">
                  <label className="payment-field payment-field-wide"><span>Name on test card</span><input value={paymentForm.name} onChange={(event) => updatePaymentField("name", event.target.value)} placeholder="Avery Wander" autoComplete="off" /></label>
                  <label className="payment-field payment-field-wide"><span>Card number</span><input inputMode="numeric" value={paymentForm.cardNumber} onChange={(event) => updatePaymentField("cardNumber", event.target.value)} placeholder="4242 4242 4242 4242" autoComplete="off" /></label>
                  <label className="payment-field"><span>Expiry</span><input inputMode="numeric" value={paymentForm.expiry} onChange={(event) => updatePaymentField("expiry", event.target.value)} placeholder="MM/YY" autoComplete="off" /></label>
                  <label className="payment-field"><span>Security code</span><input inputMode="numeric" value={paymentForm.securityCode} onChange={(event) => updatePaymentField("securityCode", event.target.value)} placeholder="123" autoComplete="off" /></label>
                </div>
                <label className="failure-toggle"><input type="checkbox" checked={paymentForm.forceFailure} onChange={(event) => updatePaymentField("forceFailure", event.target.checked)} /><span><strong>Test failure path</strong><small>Deterministically simulate a declined mock payment.</small></span></label>
                {paymentError && <div className="payment-error" role="alert"><AlertTriangle size={15} /><span>{paymentError}</span></div>}
                <div className="checkout-actions"><button type="button" className="checkout-secondary" onClick={() => { setPaymentError(""); setCheckoutStep("review"); }}>Back to review</button><button type="submit" className="checkout-primary">Pay {formatPrice(totalCost, destination.currency)} <ArrowRight size={16} /></button></div>
              </form>
            )}

            {checkoutStep === "processing" && (
              <div className="checkout-body checkout-processing" aria-live="polite"><div className="processing-spinner"><Wallet size={21} /></div><h3>Checking your test payment</h3><p>One intentional pause while ROAM simulates the payment result.</p><span className="processing-bar"><i /></span></div>
            )}

            {checkoutStep === "success" && (
              <div className="checkout-body checkout-result"><div className="result-mark success-mark"><Check size={27} /></div><span className="result-kicker">Mock payment successful</span><h3>Keep this plan close.</h3><p>No real charge or external booking was made. Your itinerary remains available to edit.</p><div className="confirmation-meta"><span><small>Test reference</small><strong>{orderReference}</strong></span><span><small>Final amount</small><strong>{formatPrice(totalCost, destination.currency)}</strong></span></div><div className="confirmation-list">{checkoutItems.map(({ day, item, activity }) => <div key={`${day}-${activity.id}`}><span>{day}</span><strong>{activity.name} × {item.quantity}</strong></div>)}</div><div className="checkout-actions"><button className="checkout-secondary" onClick={returnToItinerary}>Return to itinerary</button><button className="checkout-primary" onClick={() => { setCheckoutStep(null); document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" }); }}>Continue exploring <ArrowRight size={16} /></button></div></div>
            )}

            {checkoutStep === "failure" && (
              <div className="checkout-body checkout-result"><div className="result-mark failure-mark"><AlertTriangle size={27} /></div><span className="result-kicker">Mock payment not completed</span><h3>Nothing was charged.</h3><p>{paymentError || "This prototype declined the requested test payment."}</p><div className="failure-preserved"><Check size={15} /> Your itinerary and quantities are still intact.</div><div className="checkout-actions"><button className="checkout-secondary" onClick={returnToItinerary}>Edit itinerary</button><button className="checkout-primary" onClick={() => { setPaymentError(""); setCheckoutStep("payment"); }}>Retry payment <ArrowRight size={16} /></button></div></div>
            )}
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status"><Check size={15} /> {notice}</div>}
    </div>
  );
}
