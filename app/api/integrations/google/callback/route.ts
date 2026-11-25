import { requireUser } from "@/lib/server/auth";
import { finishGoogle, googleSession } from "@/lib/server/google-calendar";
import { finishGoogleAccount, isGoogleAccountState } from "@/lib/server/google-account";
import { assertFormsPermission, finishGoogleForms } from "@/lib/server/google-forms";
import { assertGoogleFormDraftPermission, finishGoogleFormDraftAuth, isGoogleFormDraftState } from "@/lib/server/google-form-drafts-auth";
import { errorResponse, ApiError } from "@/lib/server/http";
import { after } from "next/server";
import { syncAllGoogleExports } from "@/lib/server/google-export";
import { googleConnectionResultHref, type GoogleConnectionService, type GoogleConnectionOutcome } from "@/lib/google-settings";

export const runtime = "nodejs";
function redirectSettings(service: GoogleConnectionService, result: GoogleConnectionOutcome) {
  return new Response(null, { status: 303, headers: {
    Location: googleConnectionResultHref(service, result),
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
}

export async function GET(request: Request) {
  let service: GoogleConnectionService | undefined;
  try {
    const actor = requireUser(request);
    const query = new URL(request.url).searchParams;
    const state = query.get("state") ?? "", code = query.get("code") ?? "";
    const formDraft = isGoogleFormDraftState(state);
    if (isGoogleAccountState(state)) service = "account";
    else if (formDraft || /^forms\.[A-Za-z0-9_-]{43}$/.test(state)) service = "forms";
    else if (/^[A-Za-z0-9_-]{43}$/.test(state)) service = "calendar";
    else throw new ApiError(400, "구글 인증 요청이 올바르지 않습니다.");
    if (query.has("error")) return redirectSettings(service, query.get("error") === "access_denied" ? "cancelled" : "failed");
    if (service === "account") {
      const result = await finishGoogleAccount(actor, googleSession(request), state, code, () => requireUser(request));
      if (result.calendarConnected) after(async () => { try { await syncAllGoogleExports(); } catch { /* Export status remains pending until retry. */ } });
      return redirectSettings(service, result.outcome);
    }
    if (formDraft) {
      await finishGoogleFormDraftAuth(actor, googleSession(request), state, code, () => {
        const current = requireUser(request);
        if (current.id !== actor.id) throw new ApiError(401, "로그인 계정이 변경되었습니다.");
        assertGoogleFormDraftPermission(current);
      });
    } else if (service === "forms") {
      await finishGoogleForms(actor, googleSession(request), state, code, () => assertFormsPermission(requireUser(request)));
    } else {
      await finishGoogle(actor, googleSession(request), state, code, undefined, () => { requireUser(request); });
      after(async () => { try { await syncAllGoogleExports(); } catch { /* Export status remains pending until retry. */ } });
    }
    return redirectSettings(service, "connected");
  } catch(error) {
    if (service) return redirectSettings(service, "failed");
    const response = errorResponse(error);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
}
