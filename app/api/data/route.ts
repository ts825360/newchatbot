import { requireUser } from "@/lib/server/auth";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { readSnapshot, seedDevelopmentRooms, writeBatch } from "@/lib/server/records";
import type { ServerWrite } from "@/lib/backend-contract";
import { after } from "next/server";
import { syncAllGoogleExports } from "@/lib/server/google-export";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const actor = requireUser(request);
    seedDevelopmentRooms();
    const query = new URL(request.url).searchParams;
    return json(readSnapshot(actor, query.get("roomId") || undefined, undefined, query.get("conversationId") || undefined));
  }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = requireUser(request); const data = await readJson(request, 4 * 1024 * 1024) as { writes: ServerWrite[]; roomId?: string };
    const output=writeBatch(requireUser(request), data?.writes, typeof data?.roomId === "string" ? data.roomId : undefined);
    if(data.writes.some(w=>w.key.startsWith("church-preparation-v1:")&&w.key.endsWith(":events")||w.key.startsWith("church-planner-room-catalog-v1:"))) after(async()=>{try{await syncAllGoogleExports();}catch{/* Website persistence already succeeded; export stays pending. */}});
    return json(output);
  } catch (error) { return errorResponse(error); }
}
