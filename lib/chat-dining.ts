import { validDate } from "./room-timing";

export type DiningSource = { url: string; label: string };
export type DiningRestaurant = { name: string; reason: string; hours: string; rating: { value: number; count: number | null; source: DiningSource } | null; sources: DiningSource[] };
export type DiningRecommendations = { date: string; visitTime: string; checkedAt: string; venue: string; restaurants: DiningRestaurant[] };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const diningLine = (value: unknown, limit: number): value is string => typeof value === "string" && !!value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
export const diningClock = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function diningSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1800) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal|test|lan|home|onion)$/i.test(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

const source = (value: unknown): value is DiningSource => record(value) && diningLine(value.label, 96) && !!diningSourceUrl(value.url);
const rating = (value: unknown) => record(value) && typeof value.value === "number" && value.value > 0 && value.value <= 5
  && (value.count === null || typeof value.count === "number" && Number.isSafeInteger(value.count) && value.count > 0) && source(value.source);

export function isDiningRecommendations(value: unknown): value is DiningRecommendations {
  return record(value) && typeof value.date === "string" && validDate(value.date) && diningClock(value.visitTime)
    && diningLine(value.checkedAt, 24) && Number.isFinite(Date.parse(value.checkedAt)) && diningLine(value.venue, 100)
    && Array.isArray(value.restaurants) && value.restaurants.length > 0 && value.restaurants.length <= 3
    && value.restaurants.every(row => record(row) && diningLine(row.name, 90) && diningLine(row.reason, 250) && diningLine(row.hours, 150)
      && (row.rating === null || rating(row.rating)) && Array.isArray(row.sources) && row.sources.length > 0 && row.sources.length <= 3 && row.sources.every(source));
}

export function diningMapUrl(restaurant: string, venue: string) {
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${restaurant} ${venue} 근처` })}`;
}
