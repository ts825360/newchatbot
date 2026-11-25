import { handleAssistantPreferences } from "@/lib/server/assistant-preferences";

export const runtime = "nodejs";
export const GET = (request: Request) => handleAssistantPreferences(request);
export const PUT = (request: Request) => handleAssistantPreferences(request);
