export function usableLocation(location: string) {
  const value = location.trim();
  return !!value && !/^(장소\s*)?(미정|미지정|협의\s*중|추후\s*공지|선택)$/.test(value);
}

export function googleMapsUrl(location: string, mode: "search" | "directions", placeId?: string) {
  if (!usableLocation(location)) return null;
  const url = new URL(mode === "search" ? "https://www.google.com/maps/search/" : "https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set(mode === "search" ? "query" : "destination", location.trim());
  if (placeId) url.searchParams.set(mode === "search" ? "query_place_id" : "destination_place_id", placeId);
  return url.toString();
}

export function googleEmbedUrl(location: string, apiKey: string, placeId?: string) {
  if (!usableLocation(location) || !apiKey.trim()) return null;
  const url = new URL("https://www.google.com/maps/embed/v1/place");
  url.searchParams.set("key", apiKey.trim());
  url.searchParams.set("q", placeId ? `place_id:${placeId}` : location.trim());
  url.searchParams.set("language", "ko");
  return url.toString();
}
