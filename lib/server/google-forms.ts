import { createHash, randomBytes } from "node:crypto";
import { CodeChallengeMethod, type Credentials } from "google-auth-library";
import { formIdFromEditorUrl, formResponseSurvey } from "../google-forms-import";
import { googleFormRespondentUrl, type GoogleFormsPreview } from "../google-forms-preview";
import { requirePermission, type Actor } from "./auth";
import { requireOwnedConversation } from "./conversation-scope";
import { getDatabase, transaction } from "./database";
import { googleOAuthClient, openGoogleData, sealGoogleData } from "./google-calendar";
import { ApiError } from "./http";

export const googleFormsReadScopes = [
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
];
const context = "church-google-forms-v1";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const hasScopes = (tokens: Credentials) => googleFormsReadScopes.every(scope => tokens.scope?.split(" ").includes(scope));

export function saveGoogleFormsCredentials(userId: string, tokens: Credentials, db: ReturnType<typeof getDatabase>) {
  db.prepare(`INSERT INTO google_forms_auth(user_id,generation,credentials) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,credentials=excluded.credentials,
    state_hash=NULL,session_hash=NULL,verifier=NULL,expires_at=NULL`)
    .run(userId, randomBytes(16).toString("hex"), sealGoogleData(tokens, context));
}

export function assertFormsPermission(actor: Actor) {
  requirePermission(actor, "viewRoom");
}

export function assertConversationFormsPermission(actor: Actor) {
  assertFormsPermission(actor);
  requirePermission(actor, "chat");
  requirePermission(actor, "editChecklist");
}

export async function startGoogleForms(actor: Actor, session: string, db = getDatabase()) {
  assertFormsPermission(actor);
  const client = googleOAuthClient();
  const pkce = await client.generateCodeVerifierAsync();
  const state = "forms." + randomBytes(32).toString("base64url");
  const generation = randomBytes(16).toString("hex");
  db.prepare(`INSERT INTO google_forms_auth(user_id,generation,state_hash,session_hash,verifier,expires_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
    generation=excluded.generation,state_hash=excluded.state_hash,session_hash=excluded.session_hash,verifier=excluded.verifier,expires_at=excluded.expires_at`)
    .run(actor.id, generation, digest(state), session, sealGoogleData(pkce.codeVerifier, context), Date.now() + 600_000);
  return client.generateAuthUrl({ scope: googleFormsReadScopes, state, access_type: "offline", prompt: "consent", include_granted_scopes: false,
    code_challenge: pkce.codeChallenge, code_challenge_method: CodeChallengeMethod.S256 });
}

export async function finishGoogleForms(actor: Actor, session: string, state: string, code: string, recheck: () => void, db = getDatabase()) {
  assertFormsPermission(actor);
  if (!/^forms\.[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096) throw new ApiError(400, "구글폼 인증 요청을 확인해 주세요.");
  const row = transaction(db, () => {
    const attempt = db.prepare("SELECT verifier,generation FROM google_forms_auth WHERE user_id=? AND state_hash=? AND session_hash=? AND expires_at>?").get(actor.id, digest(state), session, Date.now());
    if (!attempt) throw new ApiError(400, "구글폼 인증 요청이 만료되었거나 다른 세션입니다. 다시 연결해 주세요.");
    db.prepare("UPDATE google_forms_auth SET state_hash=NULL,session_hash=NULL,verifier=NULL,expires_at=NULL WHERE user_id=?").run(actor.id);
    return attempt;
  });
  const verifier = openGoogleData(String(row.verifier), context);
  if (typeof verifier !== "string") throw new ApiError(400, "구글폼 인증을 다시 시작해 주세요.");
  let tokens: Credentials;
  try { ({ tokens } = await googleOAuthClient().getToken({ code, codeVerifier: verifier })); }
  catch { throw new ApiError(502, "구글폼 인증을 완료하지 못했습니다. 동의 설정을 확인해 주세요."); }
  if (!tokens.refresh_token || !hasScopes(tokens)) throw new ApiError(403, "구글폼 문항·응답 읽기 권한을 모두 허용해 주세요.");
  recheck();
  const updated = db.prepare("UPDATE google_forms_auth SET credentials=? WHERE user_id=? AND generation=?")
    .run(sealGoogleData(tokens, context), actor.id, row.generation);
  if (!updated.changes) throw new ApiError(409, "구글폼 연결 상태가 변경되었습니다. 다시 시도해 주세요.");
}

export function googleFormsStatus(actor: Actor, db = getDatabase()) {
  assertFormsPermission(actor);
  let configured = true;
  try { googleOAuthClient(); } catch { configured = false; }
  const row = db.prepare("SELECT credentials FROM google_forms_auth WHERE user_id=?").get(actor.id);
  let connected = false;
  if (configured && row?.credentials) {
    try { connected = hasScopes(openGoogleData(String(row.credentials), context)); } catch { /* Reconnect to refresh authorization. */ }
  }
  return { configured, connected, needsReconnect: !!row?.credentials && !connected };
}

export function disconnectGoogleForms(actor: Actor, db = getDatabase()) {
  assertFormsPermission(actor);
  db.prepare("DELETE FROM google_forms_auth WHERE user_id=?").run(actor.id);
}

type FormPayload = Parameters<typeof formResponseSurvey>[1] & { responderUri?: string };
type ResponsePage = { responses?: Parameters<typeof formResponseSurvey>[2]; nextPageToken?: string };
type ScopedForm = { url: string; roomId: string; conversationId: string };

export async function previewConversationGoogleForm(actor: Actor, input: ScopedForm, recheck: () => void, db = getDatabase()) {
  assertConversationFormsPermission(actor);
  const scope = { accountId: actor.id, roomId: input.roomId, conversationId: input.conversationId };
  requireOwnedConversation(db, scope);
  return previewOwnGoogleForm(actor, input.url, () => { recheck(); requireOwnedConversation(db, scope); }, db);
}

export async function previewOwnGoogleForm(actor: Actor, url: string, recheck: () => void, db = getDatabase()): Promise<GoogleFormsPreview> {
  assertFormsPermission(actor);
  const formId = formIdFromEditorUrl(url);
  const row = db.prepare("SELECT generation,credentials FROM google_forms_auth WHERE user_id=?").get(actor.id);
  if (!row?.credentials) throw new ApiError(409, "먼저 구글폼 읽기 권한을 연결해 주세요.");
  const tokens = openGoogleData(String(row.credentials), context) as Credentials;
  if (!hasScopes(tokens)) throw new ApiError(403, "구글폼 읽기 권한으로 다시 연결해 주세요.");
  const client = googleOAuthClient();
  client.setCredentials(tokens);
  const base = "https://forms.googleapis.com/v1/forms/" + encodeURIComponent(formId);
  try {
    const { data: form } = await client.request<FormPayload>({ url: base, method: "GET", retry: false });
    const respondentUrl = googleFormRespondentUrl(form.responderUri);
    const responses: NonNullable<ResponsePage["responses"]> = [];
    let pageToken = "";
    for (let i = 0; i < 6; i++) {
      const { data } = await client.request<ResponsePage>({ url: base + "/responses", method: "GET", params: { pageSize: 100, ...(pageToken ? { pageToken } : {}) }, retry: false });
      responses.push(...(data.responses ?? []));
      pageToken = data.nextPageToken ?? "";
      if (!pageToken || responses.length > 500) break;
    }
    recheck();
    if (db.prepare("SELECT generation FROM google_forms_auth WHERE user_id=?").get(actor.id)?.generation !== row.generation) {
      throw new ApiError(409, "구글폼 연결이 변경되었습니다. 다시 시도해 주세요.");
    }
    const link = respondentUrl ? { respondentUrl } : {};
    if (pageToken || responses.length > 500) return { ...link, notice: "한 번에 응답 500건까지 가져올 수 있습니다. CSV로 나눠 확인해 주세요." };
    try { return { ...link, survey: formResponseSurvey(formId, form, responses) }; }
    catch (error) {
      if (error instanceof ApiError && error.status === 422) return { ...link, notice: error.message };
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 403 || status === 404) throw new ApiError(403, "이 폼을 읽을 수 없습니다. 폼 편집 권한과 Google Forms API 사용 설정을 확인해 주세요.");
    if (status === 400 || status === 401) throw new ApiError(409, "구글 인증이 만료되었습니다. 구글폼을 다시 연결해 주세요.");
    throw new ApiError(502, "구글폼 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
