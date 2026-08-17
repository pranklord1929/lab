import { DAYS, type DayKey, type Hours, type ReservationDifficulty } from "@/lib/types";

export function formatDate(value: string | null | undefined) {
  if (!value) return "Unverified";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatPrice(amount: number | null | undefined, currency = "MXN") {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDifficulty(value: ReservationDifficulty) {
  return value.replaceAll("_", " ");
}

const DAY_LABEL: Record<DayKey, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export function formatHours(hours: Hours | null | undefined) {
  if (!hours) return [];
  return DAYS.map((day) => {
    const ranges = hours[day] ?? [];
    return {
      day: DAY_LABEL[day],
      value:
        ranges.length === 0
          ? "Closed"
          : ranges.map((range) => `${range.open}–${range.close}`).join(" / "),
    };
  });
}

export function formatOpeningHours(hours: Hours | null | undefined) {
  if (!hours) return [];
  const schemaDay: Record<DayKey, string> = {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday",
  };
  return DAYS.flatMap((day) =>
    (hours[day] ?? []).map((range) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: schemaDay[day],
      opens: range.open,
      closes: range.close,
    })),
  );
}
