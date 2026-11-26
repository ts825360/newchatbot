import { handleChat, handleChatConsent } from "@/lib/server/chat";

export const runtime = "nodejs";

export const GET = (request: Request) => handleChatConsent(request);
export const PUT = (request: Request) => handleChatConsent(request);
export const DELETE = (request: Request) => handleChatConsent(request);

export async function POST(request: Request) {
  return handleChat(request);
}
