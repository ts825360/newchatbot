import { handleGoogleMaps } from "@/lib/server/google-maps-request";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handleGoogleMaps(request);
}
