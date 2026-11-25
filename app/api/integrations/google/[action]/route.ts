import { requireUser } from "@/lib/server/auth";
import { disconnectGoogle, googleSession, googleStatus, readGoogleEvents, startGoogle } from "@/lib/server/google-calendar";
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { disconnectGoogleAccount, googleAccountStatus, startGoogleAccount } from "@/lib/server/google-account";
import { eventExportStatus, exportStatus, syncGoogleExports } from "@/lib/server/google-export";
import { id } from "@/lib/server/record-schema";

export const runtime="nodejs";
type Context={params:Promise<{action:string}>};
export async function GET(request:Request,context:Context) {
  try {
    const {action}=await context.params; const actor=requireUser(request);
    if(action==="account-status") return json(googleAccountStatus(actor));
    if(action==="event-status") {
      const query=new URL(request.url).searchParams;
      const roomId=query.get("roomId"),eventId=query.get("eventId");
      if(!id(roomId)||!id(eventId))throw new ApiError(400,"일정 식별자를 확인해 주세요.");
      return json(eventExportStatus(actor,roomId,eventId));
    }
    if(action==="status") {const status=googleStatus(actor);return json({...status,...(status.connected&&!status.needsReconnect?exportStatus(actor):{pending:0,synced:0,error:"",canSync:false})});}
    if(action==="events") return json(await readGoogleEvents(actor,undefined,()=>{requireUser(request);}));
    throw new ApiError(404,"지원하지 않는 구글 연결 요청입니다.");
  } catch(error) {return errorResponse(error);}
}
export async function POST(request:Request,context:Context) {
  try {
    assertSameOrigin(request); const {action}=await context.params; const actor=requireUser(request);
    if(action==="account-connect") {
      const body=await readJson(request,1024) as { features?: unknown } | null;
      const url=await startGoogleAccount(requireUser(request),googleSession(request),body?.features); requireUser(request); return json({url});
    }
    if(action==="account-disconnect") return json(disconnectGoogleAccount(actor));
    if(action==="connect") {
      const url=await startGoogle(actor,googleSession(request)); requireUser(request); return json({url});
    }
    if(action==="disconnect") { disconnectGoogle(actor); return json({ok:true}); }
    if(action==="sync") return json(await syncGoogleExports(actor));
    throw new ApiError(404,"지원하지 않는 구글 연결 요청입니다.");
  } catch(error) {return errorResponse(error);}
}
