import { requireUser } from "@/lib/server/auth";
import { googleSession } from "@/lib/server/google-calendar";
import { assertConversationFormsPermission, assertFormsPermission, disconnectGoogleForms, googleFormsStatus, previewConversationGoogleForm, previewOwnGoogleForm, startGoogleForms } from "@/lib/server/google-forms";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

export function GET(request: Request) {
  try { return json(googleFormsStatus(requireUser(request))); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = requireUser(request);
    const input = await readJson(request, 4096) as Record<string, unknown> | null;
    const recheck = () => {
      const current = requireUser(request);
      if (current.id !== actor.id) throw new ApiError(401, "로그인 계정이 변경되었습니다.");
      assertFormsPermission(current);
      return current;
    };
    recheck();
    if (input?.action === "connect") {
      const url = await startGoogleForms(actor, googleSession(request));
      recheck();
      return json({ url });
    }
    if (input?.action === "disconnect") {
      disconnectGoogleForms(actor);
      return json({ ok: true });
    }
    if (input?.action === "preview") {
      const { accountId, roomId, conversationId, url } = input;
      if (accountId !== actor.id || typeof roomId !== "string" || typeof conversationId !== "string" || typeof url !== "string" || url.length > 1024) {
        throw new ApiError(400, "현재 대화와 구글폼 편집 주소를 확인해 주세요.");
      }
      const { survey, ...metadata } = await previewConversationGoogleForm(actor, { roomId, conversationId, url }, () => assertConversationFormsPermission(recheck()));
      return json({ ...survey, ...metadata });
    }
    if (input?.action === "account-preview") {
      const { url } = input;
      if (Object.keys(input).length !== 2 || typeof url !== "string" || url.length > 1024) {
        throw new ApiError(400, "구글폼 편집 주소를 확인해 주세요.");
      }
      const { survey, ...metadata } = await previewOwnGoogleForm(actor, url, recheck);
      return json({ ...survey, ...metadata });
    }
    throw new ApiError(400, "지원하지 않는 구글폼 요청입니다.");
  } catch (error) { return errorResponse(error); }
}
