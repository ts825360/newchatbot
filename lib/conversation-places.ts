import { usableLocation } from "./location-links";

export const maxConversationPlaces = 12;
export type ConversationPlaceDetails = { name: string; address: string; notes: string };
type ConversationPlaceRecord = { location: string; places?: string[]; details?: ConversationPlaceDetails[] };
const verifiedPlace = {
  name: "한화리조트 대천 파로스",
  address: "충청남도 보령시 해수욕장3길 11-10",
  notes: "숙박 리조트 · 마리스 식당 · 대표전화 041-931-5500",
  source: "https://m2.hanwharesort.co.kr/resort/resort_place/view.do?locCd=0901",
};
export const verifiedPublicAddresses: readonly string[] = [verifiedPlace.address];
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

export function verifiedPublicPlace(name: string) {
  if (!/^(한화리조트대천파로스|한화리조트\/대천파로스)$/.test(name.normalize("NFC").replace(/\s/g, ""))) return;
  return verifiedPlace;
}

export function conversationPlaceDetails(name: string, saved: ConversationPlaceDetails[] = []) {
  const entry = saved.find(place => place.name === name);
  const verified = verifiedPublicPlace(name);
  if (entry) return { address: entry.address, notes: entry.notes, source: verified?.source };
  if (verified) return { address: verified.address, notes: verified.notes, source: verified.source };
}

export function readConversationPlaces(value: unknown): string[] {
  if (!isConversationPlaceRecord(value)) throw new Error("이 대화의 장소를 불러오지 못했습니다.");
  const legacy = value.location.trim();
  return value.places ?? (validPlace(legacy) ? [legacy] : []);
}

export function appendConversationPlace(value: unknown, input: string): ConversationPlaceRecord | null {
  if (!isConversationPlaceRecord(value)) throw new Error("저장된 장소를 불러오지 못했습니다.");
  const name = input.trim();
  if (!validPlace(name)) throw new Error("저장할 장소 이름을 확인해 주세요.");
  const places = readConversationPlaces(value);
  const identity = (place: string) => place.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s/g, "");
  if (places.some(place => identity(place) === identity(name))) return null;
  if (places.length >= maxConversationPlaces) throw new Error(`장소는 최대 ${maxConversationPlaces}개까지 저장할 수 있습니다.`);
  const next = [...places, name];
  return { location: next[0], places: next, ...(value.details && { details: value.details }) };
}
