import { handleRetreatPreparation } from "@/lib/server/retreat-preparation";

export const runtime = "nodejs";

export function GET(request: Request) {
  return handleRetreatPreparation(request);
}
