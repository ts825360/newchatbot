import { verifiedPublicPlace } from "./conversation-places";
import { googleMapsUrl } from "./location-links";

const modes = ["driving", "transit", "walking"] as const;
type Mode = typeof modes[number];
export type VenueRoute = { venueName: string; origin?: string; mode?: Mode };
const railStation = /^[가-힣0-9]{1,16}역$/;

export function isEventVenueRouteQuestion(message: string) {
  return /(?:우리|대표|행사(?:방)?(?:의)?)\s*(?:숙소|장소)|숙소\s*(?:위치|주소|까지|가는\s*길)/.test(message)
    && /얼마나\s*걸|소요\s*시간|이동\s*시간|길\s*찾기|경로|어떻게\s*가|교통편/.test(message);
}

export function venueRouteFor(venueName: string, message: string): VenueRoute {
  const stations = [...new Set([...message.matchAll(/(?<![\p{L}\p{N}])([가-힣0-9]{1,16}역)\s*(?:에서|출발)/gu)].map(match => match[1]))];
  const travel = modes.filter(mode => ({ driving: /차량(?:으)?로|자가용|운전|차로/, transit: /대중교통|기차로|버스로|지하철로/, walking: /도보|걸어서/ })[mode].test(message));
  return { venueName, ...(stations.length === 1 && { origin: stations[0] }), ...(travel.length === 1 && { mode: travel[0] }) };
}

export function isVenueRoute(value: unknown): value is VenueRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as Record<string, unknown>;
  return Object.keys(route).every(key => ["venueName", "origin", "mode"].includes(key))
    && typeof route.venueName === "string" && verifiedPublicPlace(route.venueName)?.name === route.venueName
    && (route.origin === undefined || typeof route.origin === "string" && railStation.test(route.origin))
    && (route.mode === undefined || modes.some(mode => mode === route.mode));
}

export function venueDirectionsUrl(route: VenueRoute) {
  if (!isVenueRoute(route)) return null;
  const place = verifiedPublicPlace(route.venueName)!;
  const url = new URL(googleMapsUrl(`${place.name} ${place.address}`, "directions")!);
  if (route.origin) url.searchParams.set("origin", route.origin);
  if (route.mode) url.searchParams.set("travelmode", route.mode);
  return url.href;
}
