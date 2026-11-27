import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CodeChallengeMethod, type Credentials } from "google-auth-library";
import { googleConnectionFeatures, type GoogleAccountStatus, type GoogleConnectionFeature, type GoogleDiagnostics } from "../google-settings";
import type { Actor } from "./auth";
import { getDatabase, transaction } from "./database";
import { clearGoogleExportCredentials, getGoogleExportConnection, GOOGLE_EXPORT_SCOPE, googleOAuthClient, googleOAuthSetup, googleStatus, openGoogleData, saveGoogleExportCredentials, sealGoogleData } from "./google-calendar";
import { disconnectGoogleForms, googleFormsReadScopes, googleFormsStatus, readGoogleFormsGrant, saveGoogleFormsCredentials } from "./google-forms";
import { disconnectGoogleFormDraftAuth, getGoogleFormDraftConnection, googleFormDraftStatus, googleFormsCreateScope, saveGoogleFormDraftCredentials } from "./google-form-drafts-auth";
import { ApiError } from "./http";

const context = "church-google-account-v1";
const random = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const featureScopes: Record<GoogleConnectionFeature, readonly string[]> = {
  calendar: [GOOGLE_EXPORT_SCOPE], formsRead: googleFormsReadScopes, formsCreate: [googleFormsCreateScope],
};
const canConnect = (actor: Actor, feature: GoogleConnectionFeature) => actor.permissions.includes(feature === "calendar" ? "viewCalendar" : "viewRoom");
const allowedFeatures = (actor: Actor) => googleConnectionFeatures.filter(feature => canConnect(actor, feature));
const requestedScopes = (features: readonly GoogleConnectionFeature[]) => ["openid", ...features.flatMap(feature => featureScopes[feature])];
const changed = () => new ApiError(409, "구글 연결 상태가 변경되었습니다. 다시 시도해 주세요.");
type Db = ReturnType<typeof getDatabase>;

function generations(userId: string, db: Db) {
  return {
    calendar: db.prepare("SELECT generation FROM google_connection_generations WHERE user_id=?").get(userId)?.generation ?? null,
    formsRead: db.prepare("SELECT generation FROM google_forms_auth WHERE user_id=?").get(userId)?.generation ?? null,
    formsCreate: db.prepare("SELECT generation FROM google_form_draft_auth WHERE user_id=?").get(userId)?.generation ?? null,
  };
}

export function isGoogleAccountState(state: string) { return /^account\.[A-Za-z0-9_-]{43}$/.test(state); }

export function googleAccountStatus(actor: Actor, db = getDatabase()): GoogleAccountStatus {
  const statuses: GoogleAccountStatus = {};
  if (canConnect(actor, "calendar")) statuses.calendar = googleStatus(actor, db);
  if (canConnect(actor, "formsRead")) {
    statuses.formsRead = googleFormsStatus(actor, db);
    statuses.formsCreate = googleFormDraftStatus(actor, db);
  }
  if ((actor.grade === 1 || actor.grade === 2) && allowedFeatures(actor).length) {
    const setup = googleOAuthSetup();
    if (setup.missing.length || setup.invalidRedirect) statuses.setup = setup;
  }
  return statuses;
}

type ScopeProbe = string[] | "expired" | "error" | "server_setup";
const checking = new WeakMap<Db, Set<string>>();
let checksInFlight = 0;
const diagnosticRows: Record<GoogleConnectionFeature, string> = {
  calendar: "SELECT g.generation, c.credentials FROM google_connections c LEFT JOIN google_connection_generations g ON c.user_id=g.user_id WHERE c.user_id=?",
  formsRead: "SELECT generation, credentials FROM google_forms_auth WHERE user_id=?",
  formsCreate: "SELECT generation, credentials, revoked FROM google_form_draft_auth WHERE user_id=?",
};

function diagnosticRefreshToken(actor: Actor, feature: GoogleConnectionFeature, db: Db) {
  if (feature === "calendar") return getGoogleExportConnection(actor, db).refreshToken;
  if (feature === "formsRead") return readGoogleFormsGrant(actor, db).tokens.refresh_token;
  return getGoogleFormDraftConnection(actor, db).refreshToken;
}

const probeFailure = (error: unknown): ScopeProbe => {
  const response = (error as { response?: { status?: number; data?: { error?: string } } } | undefined)?.response;
  const code = response?.data?.error;
  if (code === "invalid_client" || code === "unauthorized_client") return "server_setup";
  return response?.status === 401 || code === "invalid_grant" || code === "invalid_token" ? "expired" : "error";
};

async function probeScopes(refreshToken: string, assertCurrent: () => void): Promise<ScopeProbe> {
  const client = googleOAuthClient(true);
  client.setCredentials({ refresh_token: refreshToken });
  let token: string | null | undefined;
  try { token = (await client.getAccessToken()).token; } catch (error) { return probeFailure(error); }
  if (!token) return "error";
  assertCurrent();
  try { return (await client.getTokenInfo(token)).scopes; } catch (error) { return probeFailure(error); }
}

export async function testGoogleAccount(actor: Actor, recheck: () => Actor, db = getDatabase()): Promise<GoogleDiagnostics> {
  const features = allowedFeatures(actor);
  if (!features.length) throw new ApiError(403, "Google 연동 권한이 없습니다.");
  const inFlight = checking.get(db) ?? new Set<string>();
  if (inFlight.has(actor.id) || checksInFlight >= 4) throw new ApiError(429, "다른 Google 연결 테스트가 실행 중입니다. 잠시 후 다시 시도해 주세요.");
  checking.set(db, inFlight); inFlight.add(actor.id); checksInFlight++;
  try {
    // Older callbacks and revocation can change a grant without changing its generation.
    const grants = () => features.map(feature => db.prepare(diagnosticRows[feature]).get(actor.id));
    const before = grants();
    const assertCurrent = () => {
      const current = recheck();
      if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion || !isDeepStrictEqual(features, allowedFeatures(current)) || !isDeepStrictEqual(before, grants())) throw changed();
    };
    const status = googleAccountStatus(actor, db);
    const probes = new Map<string, Promise<ScopeProbe>>();
    const results: GoogleDiagnostics = {};
    const settled = await Promise.allSettled(features.map(async feature => {
      const item = status[feature];
      if (!item?.configured) { results[feature] = "server_setup"; return; }
      if (item.needsReconnect) { results[feature] = "reconnect"; return; }
      if (!item.connected) { results[feature] = "unconnected"; return; }
      const token = diagnosticRefreshToken(actor, feature, db);
      if (!token) { results[feature] = "reconnect"; return; }
      let probe = probes.get(token);
      if (!probe) { probe = probeScopes(token, assertCurrent); probes.set(token, probe); }
      const scopes = await probe;
      results[feature] = Array.isArray(scopes) ? featureScopes[feature].every(scope => scopes.includes(scope)) ? "verified" : "insufficient_scope" : scopes;
    }));
    assertCurrent();
    const failure = settled.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    return results;
  } finally { inFlight.delete(actor.id); checksInFlight--; }
}

export async function startGoogleAccount(actor: Actor, session: string, requested: unknown, db = getDatabase()) {
  if (!Array.isArray(requested) || !requested.length || requested.length > googleConnectionFeatures.length ||
      new Set(requested).size !== requested.length || requested.some(feature => !googleConnectionFeatures.includes(feature))) {
    throw new ApiError(400, "연결할 Google 기능을 선택해 주세요.");
  }
  const features = requested as GoogleConnectionFeature[];
  if (!features.every(feature => canConnect(actor, feature))) throw new ApiError(403, "Google 연동 권한이 없습니다.");
  const client = googleOAuthClient();
  const { codeVerifier: verifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = "account." + random(), nonce = random();
  transaction(db, () => {
    const attempt = sealGoogleData({ verifier, nonce, features, generations: generations(actor.id, db) }, context);
    db.prepare("DELETE FROM google_oauth_attempts WHERE expires_at<=? OR user_id=?").run(Date.now(), actor.id);
    db.prepare("INSERT INTO google_oauth_attempts(state_hash,user_id,session_hash,verifier,expires_at) VALUES(?,?,?,?,?)")
      .run(digest(state), actor.id, session, attempt, Date.now() + 600_000);
  });
  return client.generateAuthUrl({ state, nonce, scope: requestedScopes(features), access_type: "offline", prompt: "consent select_account",
    include_granted_scopes: false, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 });
}

export async function finishGoogleAccount(actor: Actor, session: string, state: string, code: string, recheck: () => Actor, db = getDatabase()) {
  if (!isGoogleAccountState(state) || !code || code.length > 4096) throw new ApiError(400, "구글 인증 요청을 확인해 주세요.");
  const stateHash = digest(state);
  const attempt = transaction(db, () => {
    const row = db.prepare("SELECT verifier FROM google_oauth_attempts WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>? AND verifier<>''")
      .get(stateHash, actor.id, session, Date.now());
    if (!row) throw new ApiError(400, "구글 인증 요청이 만료되었거나 다른 세션입니다.");
    db.prepare("UPDATE google_oauth_attempts SET verifier='' WHERE state_hash=?").run(stateHash);
    return openGoogleData(String(row.verifier), context) as {
      verifier: string; nonce: string; features: GoogleConnectionFeature[]; generations: ReturnType<typeof generations>;
    };
  });
  try {
    if (!attempt.features.every(feature => canConnect(actor, feature))) throw changed();
    const client = googleOAuthClient();
    let tokens: Credentials;
    try { ({ tokens } = await client.getToken({ code, codeVerifier: attempt.verifier })); }
    catch { throw new ApiError(502, "구글 인증을 완료하지 못했습니다. 동의 설정을 확인해 주세요."); }
    const granted = new Set(tokens.scope?.trim().split(/\s+/));
    const allowed = requestedScopes(attempt.features);
    if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !granted.has("openid") || [...granted].some(scope => !allowed.includes(scope))) {
      throw new ApiError(403, "허용된 Google 권한을 확인하지 못했습니다.");
    }
    const accepted = attempt.features.filter(feature => featureScopes[feature].every(scope => granted.has(scope)));
    if (!accepted.length) return { outcome: "partial", calendarConnected: false } as const;
    const identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID })).getPayload();
    if (!identity?.sub || identity.nonce !== attempt.nonce) throw new ApiError(403, "연결할 Google 계정을 확인하지 못했습니다.");
    const subjectHash = digest(identity.sub);
    const current = recheck();
    if (current.id !== actor.id || !accepted.every(feature => canConnect(current, feature))) throw changed();
    const calendarConnected = accepted.includes("calendar");
    const grantedScopes = [...granted];
    const credentials = { ...tokens, scope: grantedScopes.join(" ") };
    transaction(db, () => {
      const live = db.prepare("SELECT 1 FROM google_oauth_attempts WHERE state_hash=? AND verifier='' AND expires_at>?").get(stateHash, Date.now());
      const currentGenerations = generations(actor.id, db);
      if (!live || accepted.some(feature => currentGenerations[feature] !== attempt.generations[feature])) throw changed();
      if (calendarConnected) saveGoogleExportCredentials(actor.id, credentials, subjectHash, db);
      if (accepted.includes("formsRead")) saveGoogleFormsCredentials(actor.id, credentials, db);
      if (accepted.includes("formsCreate")) saveGoogleFormDraftCredentials(actor.id, { subjectHash, refreshToken: tokens.refresh_token!, grantedScopes }, db);
    });
    return { outcome: accepted.length === attempt.features.length ? "connected" : "partial", calendarConnected } as const;
  } finally {
    db.prepare("DELETE FROM google_oauth_attempts WHERE state_hash=?").run(stateHash);
  }
}

export function disconnectGoogleAccount(actor: Actor, db = getDatabase()) {
  if (!allowedFeatures(actor).length) throw new ApiError(403, "Google 연동 권한이 없습니다.");
  transaction(db, () => {
    db.prepare("DELETE FROM google_oauth_attempts WHERE user_id=?").run(actor.id);
    if (canConnect(actor, "calendar")) clearGoogleExportCredentials(actor.id, db);
    if (canConnect(actor, "formsRead")) {
      disconnectGoogleForms(actor, db);
      disconnectGoogleFormDraftAuth(actor, db);
    }
  });
  return googleAccountStatus(actor, db);
}
