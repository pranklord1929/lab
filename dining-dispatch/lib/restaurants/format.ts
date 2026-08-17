import type { MenuItem, MenuState } from "@/lib/restaurants/types";

const MENU_STATE_LABEL: Record<MenuState, string> = {
  structured_candidate: "structured_candidate",
  local_extraction_candidate: "local_extraction_candidate",
  document_only: "document_only",
  missing: "missing",
};

export function formatObserved(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatPrice(
  amount: number | null | undefined,
  currency = "MXN",
  opts?: { dated: boolean },
) {
  if (amount === null || amount === undefined) return null;
  if (!opts?.dated) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatPriceLevel(level: number | null | undefined) {
  if (level === null || level === undefined) return null;
  if (level < 1 || level > 4) return String(level);
  return "$".repeat(level);
}

export function formatCuisine(value: string | null | undefined) {
  if (!value) return null;
  return value.replaceAll("_", " ");
}

export function formatMenuState(state: string | null | undefined) {
  if (!state) return "missing";
  return MENU_STATE_LABEL[state as MenuState] ?? state;
}

export function instagramHref(value: string | null | undefined) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, "");
  return `https://instagram.com/${handle}`;
}

export function instagramHandle(value: string | null | undefined) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    const match = value.match(/instagram\.com\/([^/?#]+)/i);
    return match ? `@${match[1].replace(/^@/, "")}` : "Instagram";
  }
  return value.startsWith("@") ? value : `@${value}`;
}

export function mapsHref(input: {
  googleMapsUrl: string | null;
  address: string | null;
}) {
  if (input.googleMapsUrl) return input.googleMapsUrl;
  if (!input.address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input.address)}`;
}

export function menuSourceUrl(documents: Array<{ sourceUrl: string | null }>) {
  return documents.find((doc) => doc.sourceUrl)?.sourceUrl ?? null;
}

function platformLabel(value: string | null | undefined) {
  if (!value) return "Reservation";
  const key = value.toLowerCase();
  if (key.includes("opentable")) return "OpenTable";
  if (key.includes("resy")) return "Resy";
  if (key.includes("thefork") || key.includes("lafourchette")) return "TheFork";
  if (key === "website") return "Official site";
  return value.replaceAll("_", " ");
}

export function reservationBookings(input: {
  openTableUrl: string | null;
  links: Array<{
    url?: string | null;
    platform?: string | null;
    provider?: string | null;
    type?: string | null;
  }>;
  extra: Array<{ type: string; provider: string; url: string }>;
}) {
  const bookings: Array<{ platform: string; url: string }> = [];
  const seen = new Set<string>();
  const push = (platform: string, url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    bookings.push({ platform, url });
  };

  push("OpenTable", input.openTableUrl);
  for (const link of input.links) {
    push(platformLabel(link.platform ?? link.provider), link.url);
  }
  for (const link of input.extra) {
    if (link.type === "reservation") {
      push(platformLabel(link.provider), link.url);
    }
  }
  return bookings;
}

export function itemIsDated(item: MenuItem, menuObservedAt: string | null) {
  return Boolean(item.observedAt || item.sourceUrl || menuObservedAt);
}

export function groupMenuItems(items: MenuItem[]) {
  const groups = new Map<string, MenuItem[]>();
  for (const item of items) {
    const key = item.category ?? "";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "" && b !== "") return 1;
    if (b === "" && a !== "") return -1;
    return a.localeCompare(b);
  });
}

export function editorialIsPending(status: string | null | undefined) {
  return status !== "reviewed";
}
