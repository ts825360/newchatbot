import { handleTransportComparison } from "@/lib/server/transport-comparison";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handleTransportComparison(request);
}
