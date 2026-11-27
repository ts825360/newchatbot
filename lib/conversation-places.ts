import { usableLocation } from "./location-links";

export const maxConversationPlaces = 12;
export const maxPlaceMemoLength = 600;
export const conversationPlaceCategories = {
  lodging: "숙소", restaurant: "음식점", cafe: "카페", attraction: "관광지",
  meeting: "집결 장소", church: "교회", other: "기타",
} as const;
export type ConversationPlaceCategory = keyof typeof conversationPlaceCategories;
export type ConversationPlaceMemo = { text: string; authorId?: string; updatedAt: string };
export const isGooglePlaceId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{8,250}$/.test(value);
export type ConversationPlaceMetadata = { name: string; category?: ConversationPlaceCategory; privateMemo?: ConversationPlaceMemo; googlePlaceId?: string };
export type ConversationPlaceDetails = { name: string; address: string; notes: string };
export type ConversationPlaceRecord = {
  location: string;
  places?: string[];
  details?: ConversationPlaceDetails[];
  placeMetadata?: ConversationPlaceMetadata[];
};
const verifiedPlace = {
  name: "한화리조트 대천 파로스",
  address: "충청남도 보령시 해수욕장3길 11-10",
  notes: "숙박 리조트 · 마리스 식당 · 대표전화 041-931-5500",
  source: "https://m2.hanwharesort.co.kr/resort/resort_place/view.do?locCd=0901",
};
export const verifiedPublicAddresses: readonly string[] = [verifiedPlace.address];
const validPlace = (place: unknown): place is string =>
  typeof place === "string" && place.length <= 180 && usableLocation(place) && !/[\x00-\x1f\x7f]/.test(place);
export const placeSearchKey = (place: string) => place.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s/g, "");
export const isConversationPlaceCategory = (category: unknown): category is ConversationPlaceCategory =>
  typeof category === "string" && Object.hasOwn(conversationPlaceCategories, category);

function validMemo(memo: ConversationPlaceMemo | undefined) {
  return memo === undefined || !!memo && typeof memo.text === "string" && !!memo.text.trim()
    && memo.text.length <= maxPlaceMemoLength && !memo.text.includes("\u0000")
    && (memo.authorId === undefined || typeof memo.authorId === "string" && !!memo.authorId.trim()
      && memo.authorId.length <= 256 && !/[\x00-\x1f\x7f]/.test(memo.authorId))
    && typeof memo.updatedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(memo.updatedAt)
    && Number.isFinite(Date.parse(memo.updatedAt));
}

export function isConversationPlaceRecord(value: unknown): value is ConversationPlaceRecord {
  if (!value || typeof value !== "object") return false;
  const { location, places, details, placeMetadata } = value as Partial<ConversationPlaceRecord>;
  if (typeof location !== "string" || location.length > 180 || location.includes("\u0000")) return false;
  if (places !== undefined && (!Array.isArray(places) || places.length > maxConversationPlaces || !places.every(validPlace)
    || new Set(places).size !== places.length || (places[0] ?? "") !== location)) return false;
  const names = places ?? [location];
  if (details !== undefined && !(Array.isArray(details) && details.length <= maxConversationPlaces && details.every(entry => entry && names.includes(entry.name)
    && typeof entry.address === "string" && entry.address.length <= 250 && !/[\x00-\x1f\x7f]/.test(entry.address)
    && typeof entry.notes === "string" && entry.notes.length <= 600 && !entry.notes.includes("\u0000"))
    && new Set(details.map(entry => entry.name)).size === details.length)) return false;
  return placeMetadata === undefined || Array.isArray(placeMetadata) && placeMetadata.length <= maxConversationPlaces
    && placeMetadata.every(entry => entry && validPlace(entry.name) && names.includes(entry.name)
      && (entry.category === undefined || isConversationPlaceCategory(entry.category)) && validMemo(entry.privateMemo)
      && (entry.googlePlaceId === undefined || isGooglePlaceId(entry.googlePlaceId)))
    && new Set(placeMetadata.map(entry => entry.name)).size === placeMetadata.length
    && new Set(placeMetadata.flatMap(entry => entry.googlePlaceId ? [entry.googlePlaceId] : [])).size === placeMetadata.filter(entry => entry.googlePlaceId).length;
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

export function orderConversationPlaces(record: ConversationPlaceRecord, places: string[]): ConversationPlaceRecord {
  const { details, placeMetadata, ...rest } = record;
  const keep = <T extends { name: string }>(entries: T[] = []) => entries.flatMap(entry => {
    const name = record.places ? entry.name : entry.name.trim();
    return places.includes(name) ? [{ ...entry, name }] : [];
  });
  const keptDetails = keep(details);
  const keptMetadata = keep(placeMetadata);
  return { ...rest, location: places[0] ?? "", places,
    ...(keptDetails.length ? { details: keptDetails } : {}), ...(keptMetadata.length ? { placeMetadata: keptMetadata } : {}) };
}

export function appendConversationPlace(value: unknown, input: string): ConversationPlaceRecord | null {
  if (!isConversationPlaceRecord(value)) throw new Error("저장된 장소를 불러오지 못했습니다.");
  const name = input.trim();
  if (!validPlace(name)) throw new Error("저장할 장소 이름을 확인해 주세요.");
  const places = readConversationPlaces(value);
  if (places.some(place => placeSearchKey(place) === placeSearchKey(name))) return null;
  if (places.length >= maxConversationPlaces) throw new Error(`장소는 최대 ${maxConversationPlaces}개까지 저장할 수 있습니다.`);
  return orderConversationPlaces(value, [...places, name]);
}
