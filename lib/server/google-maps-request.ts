import type { DatabaseSync } from "node:sqlite";
import { hasObviousPrivateData } from "../assistant-privacy";
import { isGooglePlaceId } from "../conversation-places";
import { googleMapsUrl } from "../location-links";
import { requirePermission, requireUser } from "./auth";
import { requireOwnedConversation } from "./conversation-scope";
import { getDatabase } from "./database";
import { ApiError, errorResponse, json, readBytes, readJson } from "./http";
import { id, object } from "./record-schema";

const placesHost = "https://places.googleapis.com/v1";
const routesHost = "https://routes.googleapis.com/directions/v2:computeRoutes";
const attribution = { name: "Google Maps", url: "https://maps.google.com/" };
const categories = new Set(["restaurant", "cafe", "tourist_attraction", "convenience_store", "parking", "hospital"]);
const modes = { driving: "DRIVE", walking: "WALK", transit: "TRANSIT" } as const;
const summaryFields = ["id", "displayName", "formattedAddress", "primaryType", "googleMapsUri", "rating", "userRatingCount", "attributions"];
const perMinute = new Map<string, { until: number; count: number }>();
let inFlight = 0;

class MapsError extends ApiError {
  constructor(status: number, readonly code: string, message: string) { super(status, message); }
}
const malformed = () => new MapsError(502, "maps_provider_error", "Google Maps 응답을 확인하지 못했습니다.");
const unavailable = () => new MapsError(503, "maps_unavailable", "Google Maps API가 설정되지 않았거나 요청 권한을 확인할 수 없습니다. 관리자에게 문의해 주세요.");
const missing = () => new ApiError(404, "Google Maps에서 장소를 찾지 못했습니다.");
const invalid = () => new ApiError(400, "장소 검색 조건을 확인해 주세요.");

function enforceRate(account: string) {
  const now = Date.now();
  for (const [key, value] of perMinute) if (value.until <= now) perMinute.delete(key);
  const current = perMinute.get(account) ?? { until: now + 60_000, count: 0 };
  if (current.count >= 12 || inFlight >= 5) throw new MapsError(429, "maps_rate_limited", "지도 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
  current.count++; perMinute.set(account, current);
}

const text = (value: unknown, limit: number) => typeof value === "string" && value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : undefined;
function safeUrl(value: unknown, test?: (url: URL) => boolean) {
  const raw = text(value, 1800);
  if (!raw) return undefined;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || [...url.searchParams.keys()].some(key => /key|token|credential/i.test(key)) || test && !test(url)) return undefined;
    return url.href;
  } catch { return undefined; }
}
const isMaps = (url: URL) => url.hostname === "maps.google.com" || url.hostname === "www.google.com" && url.pathname.startsWith("/maps/");
const isPhoto = (url: URL) => /^(?:lh\d+|streetviewpixels-pa)\.googleusercontent\.com$/.test(url.hostname);
const array = (list: unknown, limit: number) => Array.isArray(list) ? list.slice(0, limit) : [];
function publicQuery(value: unknown) {
  const raw = text(value, 100);
  if (!raw) return undefined;
  const query = raw.normalize("NFKC").replace(/\s+/g, " ");
  if (hasObviousPrivateData(query) || /(?:https?:|www\.|@|\b\d{1,5}\s+[\w .'-]+\s(?:street|road|lane|drive|st|rd|ave)\b|내부\s*(?:자료|메모)|명단|개인\s*주소)/i.test(query)) return undefined;
  if (!/^[\p{L}\p{M}\p{N} .()·&'/-]+$/u.test(query) || /\p{Cf}/u.test(query)) return undefined;
  return query;
}

async function provider(url: string, key: string, mask: string, signal: AbortSignal, body?: object) {
  try {
    const response = await fetch(url, { method: body ? "POST" : "GET", signal, cache: "no-store", redirect: "error",
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if ([401, 403].includes(response.status)) throw unavailable();
    if (response.status === 404) throw missing();
    if (response.status === 429) throw new MapsError(503, "maps_quota", "Google Maps 할당량이 부족합니다. 나중에 다시 시도해 주세요.");
    if (!response.ok) throw malformed();
    const bytes = await readBytes(response, 128_000);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!object(value)) throw malformed();
    return value;
  } catch (cause) {
    if (signal.aborted) throw new MapsError(504, "maps_timeout", "Google Maps 조회 시간이 초과됐습니다.");
    if (cause instanceof MapsError || cause instanceof ApiError && cause.status === 404) throw cause;
    throw malformed();
  }
}

function narrowPlace(raw: unknown) {
  if (!object(raw) || !isGooglePlaceId(raw.id)) return undefined;
  const name = object(raw.displayName) && text(raw.displayName.text, 250) || "지도 장소";
  const reviewCount = Number.isSafeInteger(raw.userRatingCount) && Number(raw.userRatingCount) >= 0 ? raw.userRatingCount : undefined;
  const rating = typeof raw.rating === "number" && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : undefined;
  const extra = array(raw.attributions, 12).flatMap(value => {
    const name = object(value) && text(value.provider, 160);
    return name ? [{ name, url: safeUrl(value.providerUri) }] : [];
  });
  return { placeId: raw.id, name, address: text(raw.formattedAddress, 400), type: text(raw.primaryType, 100),
    mapsUrl: safeUrl(raw.googleMapsUri, isMaps) ?? googleMapsUrl(name, "search", raw.id)!, rating, reviewCount,
    phone: text(raw.internationalPhoneNumber, 70), website: safeUrl(raw.websiteUri),
    openingHours: object(raw.regularOpeningHours) ? array(raw.regularOpeningHours.weekdayDescriptions, 7).flatMap(entry => text(entry, 250) || []) : undefined,
    ...(extra.length ? { attributions: extra } : {}) };
}

async function photo(raw: Record<string, any>, key: string, signal: AbortSignal, recheck: () => void) {
  const candidate: unknown = array(raw.photos, 1)[0];
  if (!object(candidate) || typeof candidate.name !== "string" || !candidate.name.startsWith(`places/${raw.id}/photos/`) || !/^places\/[A-Za-z0-9_-]{8,250}\/photos\/[A-Za-z0-9_-]{4,2500}$/.test(candidate.name)) return;
  const authors = array(candidate.authorAttributions, 10).flatMap(value => {
    const name = object(value) && text(value.displayName, 160);
    return name ? [{ name, url: safeUrl(value.uri, isMaps), avatarUri: safeUrl(value.photoUri, isPhoto) }] : [];
  });
  if (!authors.length) return;
  recheck();
  try {
    const result = await provider(`${placesHost}/${candidate.name}/media?maxWidthPx=480&skipHttpRedirect=true`, key, "photoUri", signal);
    const uri = safeUrl(result.photoUri, isPhoto);
    if (uri && !uri.includes(key)) return { uri, mapsUrl: safeUrl(candidate.googleMapsUri, isMaps), authors };
  } catch { /* A failed photo must not discard valid details. */ }
}

export async function handleGoogleMaps(request: Request, database?: DatabaseSync) {
  try {
    const db = database ?? getDatabase();
    const actor = requireUser(request, db);
    requirePermission(actor, "viewRoom"); requirePermission(actor, "chat");
    if (request.headers.has("x-maps-account") && request.headers.get("x-maps-account") !== actor.id) throw new ApiError(409, "접속 계정이 변경되었습니다.");
    const body = await readJson(request, 2048);
    if (!object(body) || !id(body.roomId) || !id(body.conversationId)) throw invalid();
    const scope = { accountId: actor.id, roomId: body.roomId, conversationId: body.conversationId };
    const recheck = () => {
      const current = requireUser(request, db);
      if (current.id !== actor.id) throw new ApiError(403, "지도 조회 권한을 확인해 주세요.");
      requirePermission(current, "viewRoom"); requirePermission(current, "chat"); requireOwnedConversation(db, scope);
    };
    recheck();
    const action = body.action;
    const keys = (...other: string[]) => Object.keys(body).every(key => ["action", "roomId", "conversationId", ...other].includes(key));
    let query: string | undefined;
    if (action === "text-search" && keys("query", "confirmPublicQuery")) {
      query = publicQuery(body.query);
      if (!query || body.confirmPublicQuery !== true) throw new MapsError(422, "public_query_required", "개인정보가 없는 공개 시설 이름을 입력해 주세요.");
    } else if (action === "details" && keys("placeId", "includePhoto") && isGooglePlaceId(body.placeId) && (body.includePhoto === undefined || typeof body.includePhoto === "boolean")) {
      // Details below.
    } else if (action === "nearby" && keys("originPlaceId", "category") && isGooglePlaceId(body.originPlaceId) && categories.has(body.category)) {
      // Nearby below.
    } else if (!(action === "compute-route" && keys("originPlaceId", "destinationPlaceId", "mode") && isGooglePlaceId(body.originPlaceId)
      && isGooglePlaceId(body.destinationPlaceId) && body.originPlaceId !== body.destinationPlaceId && Object.hasOwn(modes, body.mode))) throw invalid();

    const key = (action === "compute-route" ? process.env.GOOGLE_ROUTES_API_KEY : process.env.GOOGLE_PLACES_API_KEY)?.trim();
    if (!key) throw unavailable();
    enforceRate(actor.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4900);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    inFlight++;
    try {
      let payload: object;
      if (action === "details") {
        const details = [...summaryFields, "internationalPhoneNumber", "websiteUri", "regularOpeningHours", ...(body.includePhoto ? ["photos"] : [])];
        const result = await provider(`${placesHost}/places/${body.placeId}?languageCode=ko&regionCode=KR`, key, details.join(","), signal);
        if (result.id !== body.placeId) throw missing();
        const place = narrowPlace(result);
        if (!place) throw missing();
        payload = { place: { ...place, ...(body.includePhoto ? { photo: await photo(result, key, signal, recheck) } : {}) } };
      } else if (action === "compute-route") {
        const travelMode = modes[body.mode as keyof typeof modes];
        const result = await provider(routesHost, key, "routes.distanceMeters,routes.duration,routes.warnings", signal, {
          origin: { placeId: body.originPlaceId }, destination: { placeId: body.destinationPlaceId }, travelMode, languageCode: "ko-KR", units: "METRIC",
          ...(travelMode === "DRIVE" ? { routingPreference: "TRAFFIC_UNAWARE" } : {}),
        });
        const raw = array(result.routes, 1)[0];
        const duration = object(raw) && typeof raw.duration === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?s$/.test(raw.duration) ? Number(raw.duration.slice(0, -1)) : NaN;
        const links = new URL("https://www.google.com/maps/dir/");
        for (const [name, value] of Object.entries({ api: "1", origin: "출발 장소", destination: "도착 장소", origin_place_id: body.originPlaceId, destination_place_id: body.destinationPlaceId, travelmode: body.mode })) links.searchParams.set(name, value);
        payload = { mapsUrl: links.href, route: object(raw) && Number.isFinite(duration) && duration <= 604800 && Number.isSafeInteger(raw.distanceMeters) && raw.distanceMeters >= 0
          ? { distanceMeters: raw.distanceMeters, durationSeconds: duration, trafficAware: false, warnings: array(raw.warnings, 5).flatMap(value => text(value, 400) || []) } : null };
      } else {
        let result: Record<string, any>;
        const mask = summaryFields.map(field => `places.${field}`).join(",");
        if (action === "text-search") result = await provider(`${placesHost}/places:searchText`, key, mask, signal, { textQuery: query, pageSize: 8, languageCode: "ko", regionCode: "KR" });
        else {
          const base = await provider(`${placesHost}/places/${body.originPlaceId}`, key, "id,location", signal);
          const center = base.location;
          if (base.id !== body.originPlaceId || !object(center) || typeof center.latitude !== "number" || !Number.isFinite(center.latitude) || Math.abs(center.latitude) > 90 || typeof center.longitude !== "number" || !Number.isFinite(center.longitude) || Math.abs(center.longitude) > 180) throw missing();
          recheck();
          result = await provider(`${placesHost}/places:searchNearby`, key, mask, signal, { includedTypes: [body.category], maxResultCount: 8, languageCode: "ko", regionCode: "KR",
            locationRestriction: { circle: { center: { latitude: center.latitude, longitude: center.longitude }, radius: 1500 } } });
        }
        payload = { places: array(result.places, 8).flatMap(value => narrowPlace(value) ?? []) };
      }
      recheck();
      return json({ action, attribution, ...payload });
    } finally { clearTimeout(timer); inFlight--; }
  } catch (cause) {
    if (!(cause instanceof MapsError)) return errorResponse(cause);
    const response = json({ error: cause.message, code: cause.code }, cause.status);
    if (cause.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
}
