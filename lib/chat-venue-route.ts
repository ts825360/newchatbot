import { verifiedPublicPlace } from "./conversation-places";
import { googleMapsUrl } from "./location-links";
import type { ChatMessage, ChatMessageReference } from "./types";

const modes = ["driving", "transit", "walking"] as const;
export type VenueRouteMode = typeof modes[number];
export type VenueRoute = { venueName: string; origin?: string; mode?: VenueRouteMode; sources?: string[] };
const railStation = /^[가-힣0-9]{1,16}역$/;
// Do not send station-shaped user text to an external lookup without a public match.
const publicStations = new Set(["대전역", "중구청역", "서대전역", "오송역", "천안아산역", "서울역", "용산역", "수서역", "광명역", "부산역", "동대구역", "익산역", "대천역", "광주송정역", "목포역", "전주역", "수원역"]);
export const isPublicRouteStation = (value: string) => publicStations.has(value);
export const venueRouteClockPattern = "(?:(오전|오후)\\s*)?(\\d{1,2})\\s*(?::\\s*(\\d{2})|시(?:\\s*(\\d{1,2})\\s*분?)?)";

export function venueRouteArrivalMatch(message: string) {
  return message.trim().normalize("NFKC").match(new RegExp(`^(?:(?:[가-힣a-z]{1,24}\\s+){0,3}[가-힣a-z]{1,24}(?:은|는|이|가)\\s+)?(?:([가-힣0-9]{1,16}역)(?:에|으로)\\s*)?${venueRouteClockPattern}\\s*(?:에\\s*)?도착(?:해(?:요)?|합니다|예정(?:이야|이에요)?|이야|이에요)?[.!]?$`, "iu"));
}

export function venueTravelAnchor(messages: readonly ChatMessage[], reference?: ChatMessageReference) {
  if (reference?.kind === "edit") return;
  const target = reference ? messages.findIndex(message => message.id === reference.messageId) : messages.length - 1;
  if (target < 0) return;
  const index = messages[target]?.sender === "user" ? target + 1 : target;
  const answer = messages[index], question = messages[index - 1];
  if (answer?.sender === "assistant" && answer.venueRoute && question?.sender === "user") return { question, answer };
}

export function isEventVenueRouteQuestion(message: string) {
  return /(?:우리|대표|행사(?:방)?(?:의)?)\s*(?:숙소|장소)|숙소\s*(?:위치|주소|까지|가는\s*길)/.test(message)
    && /얼마나\s*걸|소요\s*시간|이동\s*시간|길\s*찾기|경로|어떻게\s*가|교통편|도착\s*(?:예정\s*)?(?:시각|시간|언제)|(?:언제|몇\s*시)[^.!?\n]{0,12}도착/.test(message);
}

export function venueRouteFor(venueName: string, message: string): VenueRoute {
  const value = message.normalize("NFKC");
  const stations = [...new Set([...value.matchAll(/(?<![\p{L}\p{N}])([가-힣0-9]{1,16}역)\s*(?:에서|출발)/gu)].map(match => match[1]))];
  const travel = modes.filter(mode => ({ driving: /차량(?:으)?로|자가용|자차|운전|차로|택시/, transit: /대중교통|기차로|버스로|지하철로/, walking: /도보|걸어서/ })[mode].test(value));
  return { venueName, ...(stations.length === 1 && isPublicRouteStation(stations[0]) && { origin: stations[0] }), ...(travel.length === 1 && { mode: travel[0] }) };
}

export function venueRouteSource(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    // Do not retain user info, query parameters or fragments in search citations.
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) && url.pathname !== "/"
      && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

export function isVenueRoute(value: unknown): value is VenueRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as Record<string, unknown>;
  return Object.keys(route).every(key => ["venueName", "origin", "mode", "sources"].includes(key))
    && typeof route.venueName === "string" && verifiedPublicPlace(route.venueName)?.name === route.venueName
    && (route.origin === undefined || typeof route.origin === "string" && railStation.test(route.origin))
    && (route.mode === undefined || modes.some(mode => mode === route.mode))
    && (route.sources === undefined || Array.isArray(route.sources) && route.sources.length <= 2 && route.sources.every(url => venueRouteSource(url) === url));
}

export function venueDirectionsUrl(route: VenueRoute) {
  if (!isVenueRoute(route)) return null;
  const place = verifiedPublicPlace(route.venueName)!;
  const url = new URL(googleMapsUrl(`${place.name} ${place.address}`, "directions")!);
  if (route.origin && isPublicRouteStation(route.origin)) url.searchParams.set("origin", route.origin);
  if (route.mode) url.searchParams.set("travelmode", route.mode);
  return url.href;
}
