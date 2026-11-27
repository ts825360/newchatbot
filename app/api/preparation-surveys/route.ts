import { handlePreparationSurveys } from "@/lib/server/preparation-surveys";

export const runtime = "nodejs";

export function GET(request: Request) {
  return handlePreparationSurveys(request);
}
