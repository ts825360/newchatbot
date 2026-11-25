import { handleDevotions } from "@/lib/server/devotions";

export const runtime = "nodejs";
export const GET = (request: Request) => handleDevotions(request);
export const PUT = GET;
export const DELETE = GET;
