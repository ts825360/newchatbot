// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canonicalConversationHistory } from "@/lib/server/conversation-scope";
import { createDatabase } from "@/lib/server/database";
import { handleGoogleMaps } from "@/lib/server/google-maps-request";

const provider = vi.fn<typeof fetch>();
const placeId = "ChIJ_Synthetic_Origin123";
const destinationPlaceId = "ChIJ_Synthetic_Destination123";
const scope = { roomId: "room", conversationId: "thread" };
const search = { action: "text-search", confirmPublicQuery: true, query: "Daejeon City Hall" };
const details = { action: "details", placeId };
const nearby = { action: "nearby", originPlaceId: placeId, category: "restaurant" };
const route = { action: "compute-route", originPlaceId: placeId, destinationPlaceId, mode: "driving" };
const rawPlace = { id: placeId, displayName: { text: "Synthetic venue" }, formattedAddress: "Synthetic address", primaryType: "restaurant",
  googleMapsUri: "https://www.google.com/maps/place/Synthetic", rating: 4.2, userRatingCount: 50, ignored: "RAW_PRIVATE_MARKER" };
const photoName = `places/${placeId}/photos/SyntheticPhotoResource`;
const photo = { name: photoName, googleMapsUri: "https://www.google.com/maps/photos/synthetic",
  authorAttributions: [{ displayName: "Synthetic Author", uri: "//maps.google.com/maps/contrib/123", photoUri: "//lh3.googleusercontent.com/a/synthetic" }] };
const attribution = { name: "Google Maps", url: "https://maps.google.com/" };
const now = "2026-01-01T00:00:00.000Z";
let db: ReturnType<typeof createDatabase>;
let actorId: string;
let auth: string;

function session(id: string, permissions = ["viewRoom", "chat"]) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,3,'test',?,'unused','unused',?)")
    .run(id, id, id, JSON.stringify(permissions), now);
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,0,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), id, "2099-01-01T00:00:00.000Z", now);
  return `church_session=${token}`;
}

function send(input: object = search, cookie = auth, headers: Record<string, string> = {}) {
  return handleGoogleMaps(new Request("https://app.test/api/integrations/google-maps", {
    method: "POST", headers: { cookie, "content-type": "application/json", ...headers }, body: JSON.stringify({ ...scope, ...input }),
  }), db);
}

function call(index = 0) {
  const [url, init] = provider.mock.calls[index];
  return { url: String(url), init, headers: new Headers(init?.headers), body: init?.body && JSON.parse(String(init.body)) };
}

beforeEach(() => {
  provider.mockReset().mockRejectedValue(new Error("Unexpected mocked Maps call"));
  vi.stubGlobal("fetch", provider);
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "SYNTHETIC_PLACES_KEY");
  vi.stubEnv("GOOGLE_ROUTES_API_KEY", "SYNTHETIC_ROUTES_KEY");
  db = createDatabase(":memory:");
  actorId = randomBytes(8).toString("hex");
  auth = session(actorId);
  db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run(scope.roomId, '{"name":"PRIVATE_EVENT"}');
  db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run("other-room", '{}');
  db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,revision,updated_at) VALUES(?,?,?,?,?,1,?)")
    .run(canonicalConversationHistory(actorId, scope.roomId), actorId, scope.roomId, "conversation", '{"conversations":[{"id":"thread","messages":["PRIVATE_CHAT"]}]}', now);
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("requires a signed-in actor with permission and an owned conversation before any provider request", async () => {
  expect((await send(search, "")).status).toBe(401);
  expect((await send(search, session("restricted", ["viewRoom"]))).status).toBe(403);
  expect((await send(search, session("other"))).status).toBe(404);
  expect((await send({ ...search, roomId: "other-room" })).status).toBe(404);
  expect((await send({ ...search, accountId: actorId })).status).toBe(400);
  const crossSite = await send(search, auth, { origin: "https://other.test" });
  expect(crossSite.status).toBe(403);
  expect(crossSite.headers.get("cache-control")).toBe("no-store");
  expect(provider).not.toHaveBeenCalled();
});

it("blocks unconfirmed or private text before dispatch", async () => {
  const blocked = [
    { ...search, confirmPublicQuery: false }, { ...search, confirmPublicQuery: undefined },
    ...["name@example.test", "Cafe ０１０ １２３４ ５６７８", "Daejeon\nPRIVATE CHAT", "12 Main Street", "행사방 내부 메모", "https://example.test", "x".repeat(101)]
      .map(query => ({ ...search, query })),
  ];
  for (const input of blocked) {
    const response = await send(input);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "public_query_required" });
  }
  expect(provider).not.toHaveBeenCalled();
});

it("rejects oversized JSON, non-allowlisted fields, IDs, categories and modes", async () => {
  expect((await send({ ...search, padding: "a".repeat(4096) })).status).toBe(413);
  for (const input of [
    { ...details, includePhoto: "true" }, { ...details, placeId: "places/ChIJ_valid123" },
    { ...nearby, originPlaceId: "37.55,126.97" }, { ...nearby, category: "airport" }, { ...nearby, radius: 500 },
    { ...route, originPlaceId: "Private Home" }, { ...route, originPlaceId: placeId + "\n" },
    { ...route, destinationPlaceId: "https://host.test/" }, { ...route, mode: "cycling" }, { ...route, destinationPlaceId: placeId },
  ]) expect((await send(input)).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});

it("returns explicit unavailability and never borrows a different Google key", async () => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "SYNTHETIC_JS_KEY");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "SYNTHETIC_OAUTH_SECRET");
  const noPlaces = await send(search);
  expect(noPlaces.status).toBe(503);
  expect(await noPlaces.json()).toMatchObject({ code: "maps_unavailable" });
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "SYNTHETIC_PLACES_KEY");
  vi.stubEnv("GOOGLE_ROUTES_API_KEY", "");
  expect((await send(route)).status).toBe(503);
  expect(provider).not.toHaveBeenCalled();
});

it("sends only confirmed public query text and returns capped, transient results", async () => {
  provider.mockResolvedValueOnce(Response.json({ places: Array.from({ length: 12 }, (_, i) => ({ ...rawPlace, id: `${placeId}${i}` })), nextPageToken: "NOT_EXPOSED" }));
  const response = await send({ ...search, query: "  Daejeon   City Hall  " });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result).toMatchObject({ action: "text-search", attribution, places: [expect.objectContaining({ placeId: `${placeId}0`, name: "Synthetic venue" }), ...Array(7).fill(expect.any(Object))] });
  expect(JSON.stringify(result)).not.toMatch(/RAW_PRIVATE_MARKER|NOT_EXPOSED|SYNTHETIC_PLACES_KEY/);
  expect(call()).toMatchObject({ url: "https://places.googleapis.com/v1/places:searchText", init: { method: "POST", cache: "no-store", redirect: "error" },
    body: { textQuery: "Daejeon City Hall", pageSize: 8, languageCode: "ko", regionCode: "KR" } });
  expect(call().headers.get("x-goog-api-key")).toBe("SYNTHETIC_PLACES_KEY");
  expect(call().headers.get("x-goog-fieldmask")).not.toMatch(/photos|reviews|\*/);
  expect(JSON.stringify(provider.mock.calls)).not.toMatch(/PRIVATE_EVENT|PRIVATE_CHAT|conversationId|roomId/);
  expect(db.prepare("SELECT data_json FROM records").all()).toEqual([{ data_json: '{"conversations":[{"id":"thread","messages":["PRIVATE_CHAT"]}]}' }]);
});

it("returns place details with sanitized links and no unrequested photo or inferred data", async () => {
  provider.mockResolvedValueOnce(Response.json({ ...rawPlace, googleMapsUri: "https://www.google.com.evil.test/maps", websiteUri: "javascript:alert(1)",
    internationalPhoneNumber: "+82 42 555 0100", regularOpeningHours: { weekdayDescriptions: ["Monday: 9–5"] },
    attributions: [{ provider: "Synthetic source", providerUri: "https://example.test/source" }], photos: [photo] }));
  const response = await send(details);
  expect(await response.json()).toEqual({ action: "details", attribution, place: {
    placeId, name: "Synthetic venue", address: "Synthetic address", type: "restaurant", mapsUrl: expect.stringContaining("query_place_id="),
    rating: 4.2, reviewCount: 50, phone: "+82 42 555 0100", openingHours: ["Monday: 9–5"], attributions: [{ name: "Synthetic source", url: "https://example.test/source" }],
  } });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(call().headers.get("x-goog-fieldmask")).not.toContain("photos");
});

it("returns a keyless photo only with safe author and individual source information", async () => {
  provider.mockResolvedValueOnce(Response.json({ ...rawPlace, photos: [photo] }))
    .mockResolvedValueOnce(Response.json({ name: `${photoName}/media`, photoUri: "https://lh3.googleusercontent.com/a/photo" }));
  const response = await send({ ...details, includePhoto: true });
  const data = await response.json();
  expect(data.place.photo).toEqual({ uri: "https://lh3.googleusercontent.com/a/photo", mapsUrl: photo.googleMapsUri,
    authors: [{ name: "Synthetic Author", url: "https://maps.google.com/maps/contrib/123", avatarUri: "https://lh3.googleusercontent.com/a/synthetic" }] });
  expect(JSON.stringify(data)).not.toMatch(/SyntheticPhotoResource|SYNTHETIC_PLACES_KEY/);
  expect(call(1).url).toBe(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=480&skipHttpRedirect=true`);
  expect(call(1).headers.get("x-goog-api-key")).toBe("SYNTHETIC_PLACES_KEY");
});

it("omits unsafe photos without hiding otherwise valid details", async () => {
  provider.mockResolvedValueOnce(Response.json({ ...rawPlace, photos: [{ ...photo, authorAttributions: [] }] }));
  expect((await (await send({ ...details, includePhoto: true })).json()).place.photo).toBeUndefined();
  expect(provider).toHaveBeenCalledTimes(1);
  provider.mockResolvedValueOnce(Response.json({ ...rawPlace, photos: [photo] }))
    .mockResolvedValueOnce(Response.json({ photoUri: "https://lh3.googleusercontent.com/a/photo?key=SYNTHETIC_PLACES_KEY" }));
  expect((await (await send({ ...details, includePhoto: true })).json()).place.photo).toBeUndefined();
});

it("looks up and validates the nearby origin with Google and uses only its coordinates and fixed limits", async () => {
  const center = { latitude: 36.35, longitude: 127.38 };
  provider.mockResolvedValueOnce(Response.json({ id: placeId, location: center }))
    .mockResolvedValueOnce(Response.json({ places: [{ ...rawPlace, id: destinationPlaceId }], ignored: "RAW_PRIVATE_MARKER" }));
  const response = await send(nearby);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ action: "nearby", attribution, places: [{ placeId: destinationPlaceId }] });
  expect(call().headers.get("x-goog-fieldmask")).toBe("id,location");
  expect(call(1)).toMatchObject({ url: "https://places.googleapis.com/v1/places:searchNearby", body: {
    includedTypes: ["restaurant"], maxResultCount: 8, locationRestriction: { circle: { center, radius: 1500 } },
  } });
  provider.mockReset().mockResolvedValueOnce(Response.json({ id: destinationPlaceId, location: center }));
  expect((await send(nearby)).status).toBe(404);
  expect(provider).toHaveBeenCalledTimes(1);
});

it("computes actual provider metrics from place IDs without a Places key or a simulated map", async () => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
  provider.mockResolvedValueOnce(Response.json({ routes: [{ distanceMeters: 2100, duration: "410.5s", warnings: ["Use caution"], polyline: { encodedPolyline: "NOT_EXPOSED" } }] }));
  const response = await send(route);
  const data = await response.json();
  expect(data).toMatchObject({ action: "compute-route", attribution, route: { distanceMeters: 2100, durationSeconds: 410.5, trafficAware: false, warnings: ["Use caution"] } });
  const link = new URL(data.mapsUrl);
  expect(link.searchParams.get("origin_place_id")).toBe(placeId);
  expect(link.searchParams.get("destination_place_id")).toBe(destinationPlaceId);
  expect(link.searchParams.get("travelmode")).toBe("driving");
  expect(data.route).not.toHaveProperty("polyline");
  expect(call()).toMatchObject({ url: "https://routes.googleapis.com/directions/v2:computeRoutes", body: {
    origin: { placeId }, destination: { placeId: destinationPlaceId }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE",
  } });
  expect(call().headers.get("x-goog-api-key")).toBe("SYNTHETIC_ROUTES_KEY");
  provider.mockResolvedValueOnce(Response.json({}));
  expect(await (await send({ ...route, mode: "transit" })).json()).toMatchObject({ route: null });
  expect(call(1).body).toMatchObject({ travelMode: "TRANSIT" });
  expect(call(1).body).not.toHaveProperty("routingPreference");
});

it("does not return provider data after the caller loses scope, nor issue a follow-on request", async () => {
  provider.mockImplementationOnce(async () => {
    db.prepare("DELETE FROM records").run();
    return Response.json({ id: placeId, location: { latitude: 36, longitude: 127 } });
  });
  expect((await send(nearby)).status).toBe(404);
  expect(provider).toHaveBeenCalledTimes(1);
});

it("sanitizes provider errors, quota limits, invalid JSON and oversized upstream replies", async () => {
  provider.mockResolvedValueOnce(Response.json({ error: "RAW_PROVIDER_SECRET" }, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ error: "RAW_PROVIDER_SECRET" }, { status: 429 }))
    .mockResolvedValueOnce(new Response("RAW_PROVIDER_SECRET"))
    .mockResolvedValueOnce(new Response(" ".repeat(200_000)));
  for (const [status, code] of [[503, "maps_unavailable"], [503, "maps_quota"], [502, "maps_provider_error"], [502, "maps_provider_error"]]) {
    const response = await send(search);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data).toMatchObject({ code });
    expect(JSON.stringify(data)).not.toContain("RAW_PROVIDER_SECRET");
  }
});

it("times out a stalled provider and aborts the request", async () => {
  vi.useFakeTimers();
  provider.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  const pending = send(search);
  await vi.advanceTimersByTimeAsync(5000);
  const response = await pending;
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ code: "maps_timeout" });
  expect(call().init?.signal?.aborted).toBe(true);
});

it("limits paid calls across conversations by account and allows a fresh window", async () => {
  vi.useFakeTimers();
  provider.mockImplementation(async () => Response.json({}));
  for (let i = 0; i < 12; i++) expect((await send(search)).status).toBe(200);
  const response = await send({ ...search, roomId: "other-room", conversationId: "initial-other-room" });
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({ code: "maps_rate_limited" });
  expect(response.headers.get("retry-after")).toBe("60");
  expect(provider).toHaveBeenCalledTimes(12);
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await send(search)).status).toBe(200);
});
