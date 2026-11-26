import { handlePreparationProgress, readPreparationProgress } from "@/lib/server/preparation-progress";

export const runtime = "nodejs";

export function GET(request: Request) {
  return readPreparationProgress(request);
}

export function POST(request: Request) {
  return handlePreparationProgress(request);
}
