import { validDate } from "./room-timing";
import type { VisitBasis } from "./chat-continuity";
import { isWorkCondition, type WorkConditions } from "./chat-work-state";

export type DiningSource = { url: string; label: string };
export type NearbyKind = "restaurant" | "attraction";
export const nearbyRouteModes = ["walking", "driving", "transit"] as const;
export const nearbyTraitLabels = {
  "step-free": "계단 없는 접근",
  "children-menu": "어린이 메뉴",
  "private-room": "독립된 식사 공간",
  "mild-food": "매운 음식 제외",
  "accessible-restroom": "접근 가능한 화장실",
  parking: "공개 주차 가능",
  "walkable-area": "주차 후 걸어서 둘러볼 수 있는 범위",
} as const;
export type NearbyTrait = keyof typeof nearbyTraitLabels;
export const nearbyTraits = Object.keys(nearbyTraitLabels) as NearbyTrait[];
export type NearbyRouteMode = typeof nearbyRouteModes[number];
export type NearbyVisit = {
  date: string | null; basis: VisitBasis; visitTime: string | null; meal: string | null; assumedMeal: boolean;
  groupBand: string | null; people: number | null; transport: NearbyRouteMode | null;
  cuisine: string[]; interests: string[]; excludedCuisine: string[]; budgetPerPerson: number | null;
  timeWindow?: { start: string; end: string }; timeAlternatives?: string[]; excludedTimes?: string[];
  traits?: NearbyTrait[];
};
export type NearbyTask = { kind: NearbyKind; visit: NearbyVisit | null; origin: "saved" | "hypothetical" | "unverified"; venueName?: string; temporaryResult?: true;
  candidateMessageId?: string; venueFingerprint?: string; work?: WorkConditions<{ people: number }> };
export type NearbyRoute = { mode: NearbyRouteMode; distanceKm: number | null; durationMinutes: number | null; source: DiningSource };
export type DiningRestaurant = {
  name: string; reason: string; hours: string; rating: { value: number; count: number | null; source: DiningSource } | null; sources: DiningSource[];
  address?: string | null; closures?: string | null; feature?: { text: string; source: DiningSource } | null; route?: NearbyRoute | null;
};
export type DiningRecommendations = { kind?: NearbyKind; date: string | null; visitTime: string | null; checkedAt: string; venue: string; restaurants: DiningRestaurant[];
  transportMode?: NearbyRouteMode | null; evidence?: "reported"; selectedRank?: number };

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
export const isNearbyRouteMode = (value: unknown): value is NearbyRouteMode => nearbyRouteModes.some(mode => mode === value);
export const isNearbyDistance = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 150;
export const isNearbyDuration = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 360;
const validRoute = (value: unknown) => record(value) && isNearbyRouteMode(value.mode) && source(value.source)
  && (value.distanceKm === null || isNearbyDistance(value.distanceKm)) && (value.durationMinutes === null || isNearbyDuration(value.durationMinutes))
  && (value.distanceKm !== null || value.durationMinutes !== null);
const nullableDate = (value: unknown) => value === null || typeof value === "string" && validDate(value);
const nullableInteger = (value: unknown, max: number) => value === null || typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
const terms = (values: unknown) => Array.isArray(values) && values.length <= 15 && values.every(value => diningLine(value, 15));
const temporalList = (value: unknown, valid: (item: unknown) => boolean) => value === undefined || Array.isArray(value) && value.length <= 8 && value.every(valid);
const temporalRange = (value: unknown, valid: (item: unknown) => boolean) => value === undefined || record(value) && value.start != null && value.end != null && valid(value.start) && valid(value.end);

export function isNearbyTask(value: unknown): value is NearbyTask {
  if (!record(value) || !(value.kind === "restaurant" || value.kind === "attraction")
    || !(value.origin === "saved" || value.origin === "hypothetical" || value.origin === "unverified")
    || (value.candidateMessageId !== undefined && (typeof value.candidateMessageId !== "string" || !/^dining-[a-f0-9]{64}$/.test(value.candidateMessageId)))
    || (value.venueFingerprint !== undefined && (typeof value.venueFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.venueFingerprint)))
    || (value.work !== undefined && (!record(value.work) || Object.keys(value.work).some(key => key !== "people")
      || value.work.people !== undefined && !isWorkCondition(value.work.people, (value): value is number => typeof value === "number" && nullableInteger(value, 999))))
    || (value.temporaryResult !== undefined && value.temporaryResult !== true)
    || (value.origin === "hypothetical" ? !diningLine(value.venueName, 100) : value.venueName !== undefined)) return false;
  const visit = value.visit;
  return visit === null || record(visit) && record(visit.basis) && nullableDate(visit.date) && visit.basis.date === visit.date
    && ["explicit", "now", "event", "undecided"].includes(String(visit.basis.origin))
    && (visit.basis.eventDay === undefined || visit.basis.eventDay === -1 || typeof visit.basis.eventDay === "number"
      && Number.isInteger(visit.basis.eventDay) && visit.basis.eventDay >= 0 && visit.basis.eventDay <= 99)
    && (visit.visitTime === null || diningClock(visit.visitTime)) && (visit.meal === null || diningLine(visit.meal, 10))
    && temporalList(visit.basis.alternatives, value => value !== null && nullableDate(value)) && temporalList(visit.basis.excluded, value => value !== null && nullableDate(value))
    && temporalRange(visit.basis.range, nullableDate) && temporalRange(visit.timeWindow, diningClock)
    && temporalList(visit.timeAlternatives, diningClock) && temporalList(visit.excludedTimes, diningClock)
    && (visit.traits === undefined || Array.isArray(visit.traits) && visit.traits.length <= nearbyTraits.length && visit.traits.every(trait => nearbyTraits.some(allowed => allowed === trait)))
    && typeof visit.assumedMeal === "boolean" && (visit.groupBand === null || diningLine(visit.groupBand, 24))
    && nullableInteger(visit.people, 999) && (visit.transport === null || isNearbyRouteMode(visit.transport))
    && terms(visit.cuisine) && terms(visit.interests) && terms(visit.excludedCuisine) && nullableInteger(visit.budgetPerPerson, 1_000_000);
}

export function isDiningRecommendations(value: unknown): value is DiningRecommendations {
  return record(value) && nullableDate(value.date) && (value.visitTime === null || diningClock(value.visitTime))
    && (value.evidence === undefined || value.evidence === "reported") && (value.selectedRank === undefined || [1, 2, 3].some(rank => rank === value.selectedRank))
    && diningLine(value.checkedAt, 24) && Number.isFinite(Date.parse(value.checkedAt)) && diningLine(value.venue, 100)
    && (value.kind === undefined || value.kind === "restaurant" || value.kind === "attraction")
    && (value.transportMode == null || isNearbyRouteMode(value.transportMode))
    && Array.isArray(value.restaurants) && value.restaurants.length > 0 && value.restaurants.length <= 3
    && value.restaurants.every(row => record(row) && diningLine(row.name, 90) && diningLine(row.reason, 250) && diningLine(row.hours, 150)
      && (row.address == null || diningLine(row.address, 180)) && (row.closures == null || diningLine(row.closures, 130))
      && (row.feature == null || record(row.feature) && diningLine(row.feature.text, 160) && source(row.feature.source))
      && (row.route == null || validRoute(row.route))
      && (row.rating === null || rating(row.rating)) && Array.isArray(row.sources) && row.sources.length > 0 && row.sources.length <= 3 && row.sources.every(source));
}

export function diningMapUrl(restaurant: string, venue: string, address?: string | null) {
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: address ? `${restaurant} ${address}` : `${restaurant} ${venue} 근처` })}`;
}

export function nearbyDirectionsUrl(venue: string, place: string, address?: string | null, mode?: NearbyRouteMode | null) {
  const params = new URLSearchParams({ api: "1", origin: venue, destination: address ? `${place} ${address}` : `${place} ${venue} 근처` });
  if (mode) params.set("travelmode", mode);
  return `https://www.google.com/maps/dir/?${params}`;
}
