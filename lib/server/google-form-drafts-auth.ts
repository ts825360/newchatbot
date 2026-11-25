import { createHash, randomBytes } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { requirePermission, type Actor } from "./auth";
import { getDatabase, transaction } from "./database";
import { googleOAuthClient, openGoogleData, sealGoogleData } from "./google-calendar";
import { ApiError } from "./http";

export const googleFormsCreateScope = "https://www.googleapis.com/auth/drive.file";
const fileScope = googleFormsCreateScope;
const scopes = [fileScope, "openid"];
const context = "church-google-form-drafts-v1";
const reconnectMessage = "구글폼 초안 작성 권한을 다시 연결해 주세요.";
const changedMessage = "구글폼 초안 연결이 변경되었습니다. 다시 시도해 주세요.";
const random = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const scopeSet = (scope: string) => new Set(scope.trim().split(/\s+/));

function allowedScopes(scope: unknown, requireOpenId: boolean, allowed = scopes) {
  if (typeof scope !== "string") return false;
  const granted = scopeSet(scope);
  return granted.has(fileScope) && (!requireOpenId || granted.has("openid")) && [...granted].every(value => allowed.includes(value));
}

type DraftCredentials = { subjectHash: string; refreshToken: string; grantedScopes?: string[] };

function readCredentials(value: unknown): DraftCredentials {
  const saved = openGoogleData(String(value), context) as Partial<DraftCredentials> | null;
  if (!saved || typeof saved.subjectHash !== "string" || !/^[a-f0-9]{64}$/.test(saved.subjectHash) ||
      typeof saved.refreshToken !== "string" || !saved.refreshToken) throw new ApiError(409, reconnectMessage);
  return { subjectHash: saved.subjectHash, refreshToken: saved.refreshToken, grantedScopes: saved.grantedScopes };
}

export function saveGoogleFormDraftCredentials(userId: string, credentials: DraftCredentials, db: ReturnType<typeof getDatabase>) {
  db.prepare(`INSERT INTO google_form_draft_auth(user_id,generation,credentials) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,credentials=excluded.credentials,revoked=0,
    state_hash=NULL,session_hash=NULL,attempt=NULL,expires_at=NULL`)
    .run(userId, random(), sealGoogleData(credentials, context));
}

export function isGoogleFormDraftState(state: string) {
  return /^forms-draft\.[A-Za-z0-9_-]{43}$/.test(state);
}

export function assertGoogleFormDraftPermission(actor: Actor) {
  requirePermission(actor, "viewRoom");
}

export function startGoogleFormDraftAuth(actor: Actor, session: string, db = getDatabase()) {
  assertGoogleFormDraftPermission(actor);
  const client = googleOAuthClient();
  const state = "forms-draft." + random(), verifier = random(), nonce = random();
  const url = client.generateAuthUrl({
    state, nonce, scope: scopes, access_type: "offline", prompt: "consent select_account", include_granted_scopes: false,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: CodeChallengeMethod.S256,
  });
  db.prepare(`INSERT INTO google_form_draft_auth(user_id,generation,state_hash,session_hash,attempt,expires_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,state_hash=excluded.state_hash,
    session_hash=excluded.session_hash,attempt=excluded.attempt,expires_at=excluded.expires_at`)
    .run(actor.id, random(), digest(state), session, sealGoogleData({ verifier, nonce }, context), Date.now() + 600_000);
  return url;
}

export async function finishGoogleFormDraftAuth(actor: Actor, session: string, state: string, code: string, recheck: () => void, db = getDatabase()) {
  assertGoogleFormDraftPermission(actor);
  if (!isGoogleFormDraftState(state) || !code || code.length > 4096) throw new ApiError(400, "구글폼 초안 인증 요청을 확인해 주세요.");
  const row = transaction(db, () => {
    const attempt = db.prepare("SELECT attempt,generation FROM google_form_draft_auth WHERE user_id=? AND state_hash=? AND session_hash=? AND expires_at>?")
      .get(actor.id, digest(state), session, Date.now());
    if (!attempt) throw new ApiError(400, "구글폼 초안 인증 요청이 만료되었거나 다른 세션입니다.");
    db.prepare("UPDATE google_form_draft_auth SET state_hash=NULL,session_hash=NULL,attempt=NULL,expires_at=NULL WHERE user_id=?").run(actor.id);
    return attempt;
  });
  const { verifier, nonce } = openGoogleData(String(row.attempt), context) as { verifier: string; nonce: string };
  const client = googleOAuthClient();
  const { tokens } = await client.getToken({ code, codeVerifier: verifier });
  if (!tokens.refresh_token || !tokens.id_token || !allowedScopes(tokens.scope, true)) throw new ApiError(403, reconnectMessage);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
  const identity = ticket.getPayload();
  if (!identity?.sub || identity.nonce !== nonce) throw new ApiError(403, "구글폼 초안을 작성할 구글 계정을 확인하지 못했습니다.");
  recheck();
  const credentials = sealGoogleData({ subjectHash: digest(identity.sub), refreshToken: tokens.refresh_token }, context);
  if (!db.prepare("UPDATE google_form_draft_auth SET generation=?,credentials=?,revoked=0 WHERE user_id=? AND generation=?")
    .run(random(), credentials, actor.id, row.generation!).changes) throw new ApiError(409, changedMessage);
}

export function googleFormDraftStatus(actor: Actor, db = getDatabase()) {
  assertGoogleFormDraftPermission(actor);
  let configured = true, connected = false;
  try { googleOAuthClient(); } catch { configured = false; }
  const row = db.prepare("SELECT credentials,revoked FROM google_form_draft_auth WHERE user_id=?").get(actor.id);
  if (configured && row?.credentials && !row.revoked) {
    try { readCredentials(row.credentials); connected = true; } catch { /* Authorization needs reconnecting. */ }
  }
  return { configured, connected, needsReconnect: !!row?.credentials && !connected };
}

export function disconnectGoogleFormDraftAuth(actor: Actor, db = getDatabase()) {
  assertGoogleFormDraftPermission(actor);
  // A Google-wide revoke could affect other grants under the shared OAuth client.
  db.prepare("DELETE FROM google_form_draft_auth WHERE user_id=?").run(actor.id);
}

export function getGoogleFormDraftConnection(actor: Actor, db: ReturnType<typeof getDatabase>) {
  assertGoogleFormDraftPermission(actor);
  const row = db.prepare("SELECT generation,credentials,revoked FROM google_form_draft_auth WHERE user_id=?").get(actor.id);
  if (!row?.credentials) throw new ApiError(409, "먼저 구글폼 초안 작성 권한을 연결해 주세요.");
  if (row.revoked) throw new ApiError(409, reconnectMessage);
  const { subjectHash, refreshToken, grantedScopes } = readCredentials(row.credentials);
  const generation = String(row.generation);
  const assertCurrent = () => {
    if (!db.prepare("SELECT 1 FROM google_form_draft_auth WHERE user_id=? AND generation=? AND revoked=0").get(actor.id, generation)) {
      throw new ApiError(409, changedMessage);
    }
  };
  const requireReconnect = () => {
    db.prepare("UPDATE google_form_draft_auth SET revoked=1 WHERE user_id=? AND generation=?").run(actor.id, generation);
    return new ApiError(409, reconnectMessage);
  };
  const accessToken = async () => {
    const client = googleOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });
    let token, returnedScope;
    try {
      const access = await client.getAccessToken();
      token = access.token;
      returnedScope = (access.res?.data as { scope?: unknown } | undefined)?.scope;
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: { error?: string } } })?.response;
      if (response?.status === 401 || response?.data?.error === "invalid_grant") throw requireReconnect();
      throw new ApiError(502, "구글 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (!token || (returnedScope !== undefined && !allowedScopes(returnedScope, false, grantedScopes))) throw requireReconnect();
    return token;
  };
  return { subjectHash, assertCurrent, requireReconnect, accessToken };
}
