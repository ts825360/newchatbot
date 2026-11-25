import { createHash } from "node:crypto";
import { surveyFields } from "../transport-survey";
import { requirePermission, type Actor } from "./auth";
import { requireOwnedConversation } from "./conversation-scope";
import { getDatabase } from "./database";
import { assertGoogleFormDraftPermission, getGoogleFormDraftConnection } from "./google-form-drafts-auth";
import { ApiError } from "./http";

const formsUrl = "https://forms.googleapis.com/v1/forms";
const editorUrl = (id: string) => `https://docs.google.com/forms/d/${id}/edit`;
const unknownDraft = "초안을 작성 중이거나 생성 결과를 확인할 수 없습니다. 중복 방지를 위해 다시 만들지 않습니다. 구글폼에서 같은 제목의 초안을 확인해 주세요.";

export class GoogleFormDraftEditorError extends Error {
  readonly editorUrl: string;
  constructor(formId: string) {
    super("초안은 생성했지만 설문 문항 설정을 완료했는지 확인하지 못했습니다. 편집기에서 문항과 게시 상태를 확인해 주세요.");
    this.editorUrl = editorUrl(formId);
  }
}

type WorkspaceScope = { roomId: string; conversationId: string };
type FormMetadata = {
  formId?: unknown;
  revisionId?: unknown;
  items?: unknown[];
  publishSettings?: { publishState?: { isPublished?: boolean; isAcceptingResponses?: boolean } };
};

function normalizeTitle(value: unknown) {
  if (typeof value !== "string" || !value.isWellFormed()) throw new ApiError(400, "구글폼 제목을 입력해 주세요.");
  const title = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!title || title.length > 100 || /\p{Cc}/u.test(title)) throw new ApiError(400, "구글폼 제목은 1~100자로 입력해 주세요.");
  return title;
}

function templateRequests() {
  type Option = { value: string; goToAction?: "NEXT_SECTION" | "SUBMIT_FORM" };
  const choice = (title: string, required: boolean, options: (string | Option)[]) => ({
    title, questionItem: { question: { required, choiceQuestion: {
      type: "RADIO", options: options.map(option => typeof option === "string" ? { value: option } : option),
    } } },
  });
  const text = (title: string, required: boolean, paragraph: boolean) => ({
    title, questionItem: { question: { required, textQuestion: { paragraph } } },
  });
  return [
    choice(surveyFields.attendance, true, [{ value: "참석", goToAction: "NEXT_SECTION" }, { value: "불참", goToAction: "SUBMIT_FORM" }]),
    { title: "참석자 정보", pageBreakItem: {} },
    choice(surveyFields.department, true, ["유초등부", "아동부", "청소년부", "청년부", "장년부", "명단 확인 필요"]),
    text(surveyFields.name, true, false),
    choice(surveyFields.lodging, true, ["가족방", "단체방"]),
    choice(surveyFields.movement, false, ["단체 이동", "왕복 자차", "왕복 개별 이동", "편도 개별 이동", "가족 차량 동승", "다른 차량 동승", "미정", "기타"]),
    text(surveyFields.notes, false, true),
    { ...text(surveyFields.family, false, false), description: "가족방을 선택한 경우, 함께 묵는 가족이 같은 코드를 입력해 주세요." },
  ].map((item, index) => ({ createItem: { item, location: { index } } }));
}

function formsRequest(url: string, token: string, body?: object) {
  // OAuth2Client.request can refresh and replay a POST even with transport retries disabled.
  return fetch(url, {
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function parseFormResponse(response: Response) {
  return await response.json().catch(() => null) as (FormMetadata & { error?: { code?: number } }) | null;
}

function allowsTemplate(form: FormMetadata) {
  const state = form.publishSettings?.publishState;
  return (form.items === undefined || Array.isArray(form.items) && !form.items.length) && !state?.isPublished && !state?.isAcceptingResponses;
}

async function readDraftMetadata(formId: string, token: string) {
  const url = new URL(`${formsUrl}/${formId}`);
  url.searchParams.set("fields", "formId,revisionId,items(itemId),publishSettings");
  try {
    const response = await formsRequest(url.toString(), token);
    const data = await parseFormResponse(response);
    return response.ok && data?.formId === formId ? data : null;
  } catch { return null; }
}

export async function createGoogleFormDraft(actor: Actor, value: unknown, scope: WorkspaceScope | undefined, recheck: () => Actor, db = getDatabase()) {
  const assertScope = () => {
    const current = recheck();
    if (current.id !== actor.id) throw new ApiError(401, "로그인 계정이 변경되었습니다.");
    assertGoogleFormDraftPermission(current);
    if (scope) {
      requirePermission(current, "chat");
      requireOwnedConversation(db, { ...scope, accountId: current.id });
    }
  };
  assertScope();
  const title = normalizeTitle(value);
  const connection = getGoogleFormDraftConnection(actor, db);
  const assertCurrent = () => { assertScope(); connection.assertCurrent(); };
  const key = [actor.id, connection.subjectHash, scope ? JSON.stringify([scope.roomId, scope.conversationId]) : "",
    createHash("sha256").update(title).digest("hex")] as const;
  const where = "user_id=? AND google_subject_hash=? AND scope_key=? AND title_hash=?";
  const existingDraft = () => {
    const row = db.prepare(`SELECT form_id,completed FROM google_form_drafts WHERE ${where}`).get(...key);
    if (!row) return null;
    if (!row.form_id) throw new ApiError(409, unknownDraft);
    if (!row.completed) throw new GoogleFormDraftEditorError(String(row.form_id));
    return { editorUrl: editorUrl(String(row.form_id)) };
  };
  const existing = existingDraft();
  if (existing) return existing;

  const token = await connection.accessToken().catch(error => { assertScope(); throw error; });
  assertCurrent();
  // The durable claim stays in place if the Google create outcome is unknown, including after a restart.
  const claim = db.prepare(`INSERT INTO google_form_drafts(user_id,google_subject_hash,scope_key,title_hash)
    VALUES(?,?,?,?) ON CONFLICT DO NOTHING`).run(...key);
  if (!claim.changes) {
    const concurrent = existingDraft();
    if (concurrent) return concurrent;
    throw new ApiError(409, unknownDraft);
  }

  let response: Response, data: Awaited<ReturnType<typeof parseFormResponse>>;
  try {
    response = await formsRequest(formsUrl + "?unpublished=true", token, { info: { title, documentTitle: title } });
    data = await parseFormResponse(response);
  } catch {
    assertCurrent();
    throw new ApiError(502, unknownDraft);
  }
  if (!response.ok) {
    const rejected = [400, 401, 403, 404].includes(response.status) && data?.error?.code === response.status;
    if (rejected) db.prepare(`DELETE FROM google_form_drafts WHERE ${where}`).run(...key);
    assertCurrent();
    if (rejected && response.status === 401) throw connection.requireReconnect();
    if (rejected) throw new ApiError(502, "구글에서 초안 생성을 거절했습니다. Google Forms API 설정과 연결 권한을 확인해 주세요.");
    throw new ApiError(502, unknownDraft);
  }
  if (typeof data?.formId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(data.formId)) {
    assertCurrent();
    throw new ApiError(502, unknownDraft);
  }

  const formId = data.formId;
  db.prepare(`UPDATE google_form_drafts SET form_id=? WHERE ${where}`).run(formId, ...key);
  assertCurrent();
  if (!allowsTemplate(data)) throw new GoogleFormDraftEditorError(formId);
  let { revisionId } = data;
  if (typeof revisionId !== "string" || !revisionId) {
    const metadata = await readDraftMetadata(formId, token);
    assertCurrent();
    if (!metadata || !allowsTemplate(metadata)) throw new GoogleFormDraftEditorError(formId);
    revisionId = metadata.revisionId;
  }
  if (typeof revisionId !== "string" || !revisionId) throw new GoogleFormDraftEditorError(formId);
  let updated = false;
  try {
    const batch = await formsRequest(`${formsUrl}/${formId}:batchUpdate`, token, {
      writeControl: { requiredRevisionId: revisionId }, requests: templateRequests(),
    });
    updated = batch.ok;
    await batch.body?.cancel();
  } catch { /* A batch with an unknown outcome is never replayed. */ }
  if (updated) db.prepare(`UPDATE google_form_drafts SET completed=1 WHERE ${where}`).run(...key);
  assertCurrent();
  if (!updated) throw new GoogleFormDraftEditorError(formId);
  return { editorUrl: editorUrl(formId) };
}
