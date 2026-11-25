import { usableLocation } from "./location-links";

export const maxConversationPlaces = 12;
export type ConversationPlaceDetails = { name: string; address: string; notes: string };
type ConversationPlaceRecord = { location: string; places?: string[]; details?: ConversationPlaceDetails[] };
const verifiedPlace = {
  address: "충청남도 보령시 해수욕장3길 11-10",
  notes: "숙박 리조트 · 마리스 식당 · 대표전화 041-931-5500",
  source: "https://m2.hanwharesort.co.kr/resort/resort_place/view.do?locCd=0901",
};
const validPlace = (place: unknown): place is string =>
  typeof place === "string" && place.length <= 180 && usableLocation(place) && !/[\x00-\x1f\x7f]/.test(place);

export function isConversationPlaceRecord(value: unknown): value is ConversationPlaceRecord {
  if (!value || typeof value !== "object") return false;
  const { location, places, details } = value as Partial<ConversationPlaceRecord>;
  if (typeof location !== "string" || location.length > 180 || location.includes("\u0000")) return false;
  if (places !== undefined && (!Array.isArray(places) || places.length > maxConversationPlaces || !places.every(validPlace)
    || new Set(places).size !== places.length || (places[0] ?? "") !== location)) return false;
  if (details === undefined) return true;
  return Array.isArray(details) && details.length <= maxConversationPlaces && details.every(entry => entry && (places ?? [location]).includes(entry.name)
    && typeof entry.address === "string" && entry.address.length <= 250 && !/[\x00-\x1f\x7f]/.test(entry.address)
    && typeof entry.notes === "string" && entry.notes.length <= 600 && !entry.notes.includes("\u0000"))
    && new Set(details.map(entry => entry.name)).size === details.length;
}

export function conversationPlaceDetails(name: string, saved: ConversationPlaceDetails[] = []) {
  const entry = saved.find(place => place.name === name);
  const exact = /^(한화리조트대천파로스|한화리조트\/대천파로스)$/.test(name.normalize("NFC").replace(/\s/g, ""));
  if (entry) return { address: entry.address, notes: entry.notes, source: exact ? verifiedPlace.source : undefined };
  return exact ? verifiedPlace : undefined;
}

export function readConversationPlaces(value: unknown): string[] {
  if (!isConversationPlaceRecord(value)) throw new Error("이 대화의 장소를 불러오지 못했습니다.");
  const legacy = value.location.trim();
  return value.places ?? (validPlace(legacy) ? [legacy] : []);
}
