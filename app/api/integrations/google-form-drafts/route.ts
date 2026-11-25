import { requireUser } from "@/lib/server/auth";
import { googleSession } from "@/lib/server/google-calendar";
import { assertGoogleFormDraftPermission, disconnectGoogleFormDraftAuth, googleFormDraftStatus, startGoogleFormDraftAuth } from "@/lib/server/google-form-drafts-auth";
import { createGoogleFormDraft, GoogleFormDraftEditorError } from "@/lib/server/google-form-drafts";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

export function GET(request: Request) {
  try { return json(googleFormDraftStatus(requireUser(request))); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = requireUser(request);
    assertGoogleFormDraftPermission(actor);
    const input = await readJson(request, 4096);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "구글폼 초안 요청을 확인해 주세요.");
    const { action, title, roomId, conversationId } = input as Record<string, unknown>;
    const keys = Object.keys(input);
    const recheck = () => {
      const current = requireUser(request);
      if (current.id !== actor.id) throw new ApiError(401, "로그인 계정이 변경되었습니다.");
      assertGoogleFormDraftPermission(current);
      return current;
    };
    const current = recheck();
    if (action === "connect" && keys.length === 1) return json({ url: startGoogleFormDraftAuth(current, googleSession(request)) });
    if (action === "disconnect" && keys.length === 1) {
      disconnectGoogleFormDraftAuth(current);
      return json({ ok: true });
    }
    if (action === "create") {
      if (keys.length === 2 && keys.includes("title")) return json(await createGoogleFormDraft(current, title, undefined, recheck));
      if (keys.length === 4 && keys.includes("title") && typeof roomId === "string" && typeof conversationId === "string") {
        return json(await createGoogleFormDraft(current, title, { roomId, conversationId }, recheck));
      }
    }
    throw new ApiError(400, "구글폼 초안 요청을 확인해 주세요.");
  } catch (error) {
    if (error instanceof GoogleFormDraftEditorError) return json({ editorUrl: error.editorUrl, warning: error.message });
    return errorResponse(error);
  }
}
