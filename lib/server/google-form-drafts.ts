import { createHash } from "node:crypto";
import { retreatSurveyTemplateV2, type SurveyItem } from "../retreat-survey-template";
import { requirePermission, type Actor } from "./auth";
import { requireOwnedConversation } from "./conversation-scope";
import { getDatabase, transaction } from "./database";
import { assertGoogleFormDraftPermission, getGoogleFormDraftConnection } from "./google-form-drafts-auth";
import { ApiError } from "./http";
import { readSurveyWorkVersion, requireSurveyWorkVersion } from "./chat-work-store";
import { surveyVersionKey, surveyWorkspaceKey } from "./chat-survey-work-state";

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

type WorkspaceScope = { roomId: string; conversationId: string; review?: { workId: unknown; version: unknown } };
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

function templateRequests(template: readonly SurveyItem[], description = "") {
  const branches = template.some(item => item.kind === "choice" && item.options.some(option => option.goToSection));
  const sectionIds = new Map(branches ? template.flatMap((item, index) => item.kind === "section"
    ? [[item.id, (0x71000000 + index).toString(16)] as const] : []) : []);
  const requests = template.map((entry, index) => {
    const { title } = entry;
    const location = { index: branches ? 0 : index };
    if (entry.kind === "section") return { createItem: { item: { title, pageBreakItem: {}, ...(branches && { itemId: sectionIds.get(entry.id) }) }, location } };
    const { required, description } = entry;
    const question = entry.kind === "choice"
      ? { required, choiceQuestion: { type: "RADIO", options: entry.options.map(({ goToSection, ...option }) => {
        if (!goToSection) return option;
        const goToSectionId = sectionIds.get(goToSection);
        if (!goToSectionId) throw new Error("Missing Forms branch destination");
        return { ...option, goToSectionId };
      }) } }
      : { required, textQuestion: { paragraph: entry.paragraph } };
    const item = { title, questionItem: { question }, ...(description && { description }) };
    return { createItem: { item, location } };
  });
  // Insert from the end so every forward jump already has a section in this single revision-guarded batch.
  if (branches) requests.reverse();
  return description ? [{ updateFormInfo: { info: { description }, updateMask: "description" } }, ...requests] : requests;
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
  const workScope = scope && { roomId: scope.roomId, conversationId: scope.conversationId, accountId: actor.id };
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
  const work = scope?.review && workScope ? readSurveyWorkVersion(db, workScope, scope.review.workId, scope.review.version) : undefined;
  const title = work?.title ?? normalizeTitle(value);
  const connection = getGoogleFormDraftConnection(actor, db);
  const assertCurrent = () => { assertScope(); connection.assertCurrent(); };
  const assertLatest = () => { if (work && workScope) requireSurveyWorkVersion(db, workScope, work.id, work.version); };
  const key = [actor.id, connection.subjectHash, scope ? surveyWorkspaceKey(scope) : "",
    work ? surveyVersionKey(work) : createHash("sha256").update(title).digest("hex")] as const;
  const where = "user_id=? AND google_subject_hash=? AND scope_key=? AND title_hash=?";
  const existingDraft = () => {
    const row = db.prepare(`SELECT form_id,completed FROM google_form_drafts WHERE ${where}`).get(...key);
    if (!row) return null;
    if (!row.form_id) throw new ApiError(409, unknownDraft);
    if (!row.completed) throw new GoogleFormDraftEditorError(String(row.form_id));
    return { editorUrl: editorUrl(String(row.form_id)) };
  };
  assertCurrent();
  const existing = existingDraft();
  if (existing) return existing;
  assertLatest();

  const token = await connection.accessToken().catch(error => { assertScope(); throw error; });
  assertCurrent();
  // Approve this immutable snapshot at claim time. Later edits require their own claim.
  const claim = transaction(db, () => {
    if (existingDraft()) return false;
    assertLatest();
    return db.prepare(`INSERT INTO google_form_drafts(user_id,google_subject_hash,scope_key,title_hash)
      VALUES(?,?,?,?) ON CONFLICT DO NOTHING`).run(...key).changes === 1;
  });
  if (!claim) {
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
      writeControl: { requiredRevisionId: revisionId }, requests: templateRequests(work?.items ?? retreatSurveyTemplateV2, work?.description),
    });
    updated = batch.ok;
    await batch.body?.cancel();
  } catch { /* A batch with an unknown outcome is never replayed. */ }
  if (updated) db.prepare(`UPDATE google_form_drafts SET completed=1 WHERE ${where}`).run(...key);
  assertCurrent();
  if (!updated) throw new GoogleFormDraftEditorError(formId);
  return { editorUrl: editorUrl(formId) };
}
