import { handleNotifications } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleNotifications(request);
export const PUT = (request: Request) => handleNotifications(request);
