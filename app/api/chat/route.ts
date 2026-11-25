import { handleChat } from "@/lib/server/chat";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleChat(request);
}
