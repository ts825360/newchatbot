import { handleRetreatVenueHistory } from "@/lib/server/retreat-venue-history";

export const runtime = "nodejs";
export const GET = (request: Request) => handleRetreatVenueHistory(request);
export const POST = GET;
export const DELETE = GET;
