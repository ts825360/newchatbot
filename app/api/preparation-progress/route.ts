import { handlePreparationProgress } from "@/lib/server/preparation-progress";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handlePreparationProgress(request);
}
