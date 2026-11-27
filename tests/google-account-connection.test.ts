// @vitest-environment node
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/integrations/google/callback/route";
import { GET, POST } from "@/app/api/integrations/google/[action]/route";
import { createDatabase, getDatabase } from "@/lib/server/database";
import type { Actor } from "@/lib/server/auth";
import { disconnectGoogleAccount, finishGoogleAccount, googleAccountStatus, startGoogleAccount } from "@/lib/server/google-account";
import { getGoogleFormDraftConnection } from "@/lib/server/google-form-drafts-auth";

const provider = vi.hoisted(() => ({ consent: vi.fn(), exchange: vi.fn(), identity: vi.fn(), refresh: vi.fn(), tokenInfo: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/server/database", async (original) => ({ ...await original<typeof import("@/lib/server/database")>(), getDatabase: vi.fn() }));
vi.mock("google-auth-library", () => ({
  CodeChallengeMethod: { S256: "S256" },
  OAuth2Client: class {
    async generateCodeVerifierAsync() { return { codeVerifier: "verifier", codeChallenge: "challenge" }; }
    generateAuthUrl = (options: { state: string }) => {
      provider.consent(options);
      return "https://accounts.google.com/o/oauth2/v2/auth?state=" + options.state;
    };
    getToken = provider.exchange;
    verifyIdToken = provider.identity;
    setCredentials() {}
    getAccessToken = provider.refresh;
    getTokenInfo = provider.tokenInfo;
  },
}));

const features = ["calendar", "formsRead", "formsCreate"] as const;
const allScopes = ["openid", "https://www.googleapis.com/auth/calendar.app.created", "https://www.googleapis.com/auth/forms.body.readonly", "https://www.googleapis.com/auth/forms.responses.readonly", "https://www.googleapis.com/auth/drive.file"];
const actor = { id: "alice", permissions: ["viewCalendar", "viewRoom"] } as Actor;
const other = { ...actor, id: "bob" };
let db: DatabaseSync;

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3012");
  vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:3012/api/integrations/google/callback");
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
  db = createDatabase(":memory:");
  vi.mocked(getDatabase).mockReturnValue(db);
  for (const { id, permissions } of [actor, other]) db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,3,'',?,'unused','unused',?)").run(id, id, id, JSON.stringify(permissions), new Date().toISOString());
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

async function start(account = actor, requested = [...features]) {
  const state = new URL(await startGoogleAccount(account, "session-a", requested, db)).searchParams.get("state")!;
  const options = provider.consent.mock.lastCall![0];
  provider.identity.mockResolvedValue({ getPayload: () => ({ sub: account.id, nonce: options.nonce }) });
  return { state, options };
}
const finish = (state: string, account = actor, session = "session-a") => finishGoogleAccount(account, session, state, "fake-code", () => account, db);
const grant = (scope = allScopes) => ({ tokens: { access_token: "access", refresh_token: "refresh", id_token: "id", scope: scope.join(" ") } });
const statuses = (account = actor) => {
  const status = googleAccountStatus(account, db);
  return Object.fromEntries(features.flatMap(feature => status[feature] ? [[feature, status[feature].connected && !status[feature].needsReconnect]] : []));
};

function accountRequest(action: string, account = actor, method = "GET", origin = "http://localhost:3012") {
  const session = createHash("sha256").update(`test-session-${account.id}`).digest("base64url");
  db.prepare("INSERT OR IGNORE INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,0,?,?)")
    .run(createHash("sha256").update(session).digest("hex"), account.id, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
  return [new Request(`http://localhost:3012/api/integrations/google/${action}`, { method, headers: { cookie: `church_session=${session}`, origin } }),
    { params: Promise.resolve({ action }) }] as const;
}

it("shows configuration field names only to administrators and never returns their values", async () => {
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "");
  const regular = await GET(...accountRequest("account-status"));
  expect(await regular.json()).not.toHaveProperty("setup");
  db.prepare("UPDATE users SET grade=2 WHERE id=?").run(actor.id);
  const admin = await GET(...accountRequest("account-status"));
  const body = await admin.json();
  expect(body.setup).toEqual({ missing: ["GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"], invalidRedirect: false });
  expect(JSON.stringify(body)).not.toMatch(/fixture-client|localhost:3012/);
});

it("probes only the signed-in account, deduplicates grants and distinguishes verified and missing Google scopes", async () => {
  const { state } = await start();
  provider.exchange.mockResolvedValue(grant());
  await finish(state);
  expect((await POST(...accountRequest("account-test", other, "POST"))).status).toBe(200);
  expect(provider.refresh).not.toHaveBeenCalled();
  provider.refresh.mockResolvedValue({ token: "synthetic-access-token" });
  provider.tokenInfo.mockResolvedValue({ scopes: [allScopes[1], allScopes[2], allScopes[3]] });
  const result = await POST(...accountRequest("account-test", actor, "POST"));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ calendar: "verified", formsRead: "verified", formsCreate: "insufficient_scope" });
  expect(provider.refresh).toHaveBeenCalledOnce();
  expect(provider.tokenInfo).toHaveBeenCalledOnce();
  expect(statuses()).toEqual({ calendar: true, formsRead: true, formsCreate: true });
});

it.each([["invalid_grant", "expired"], ["temporarily_unavailable", "error"], ["invalid_client", "server_setup"]])("does not expose the provider error when a diagnostic gets %s", async (error, expected) => {
  const { state } = await start(actor, ["calendar"]);
  provider.exchange.mockResolvedValue(grant(["openid", allScopes[1]]));
  await finish(state);
  provider.refresh.mockRejectedValue({ response: { status: error === "invalid_client" ? 401 : 400, data: { error, description: "PRIVATE_PROVIDER_DETAILS" } } });
  const result = await POST(...accountRequest("account-test", actor, "POST"));
  expect(await result.json()).toEqual({ calendar: expected, formsRead: "unconnected", formsCreate: "unconnected" });
  expect((await POST(...accountRequest("account-test", actor, "POST", "https://elsewhere.example"))).status).toBe(403);
});

it("rejects stale results when the account disconnects during a diagnostic", async () => {
  const { state } = await start(actor, ["calendar"]);
  provider.exchange.mockResolvedValue(grant(["openid", allScopes[1]]));
  await finish(state);
  provider.refresh.mockImplementationOnce(async () => { disconnectGoogleAccount(actor, db); return { token: "synthetic-access-token" }; });
  provider.tokenInfo.mockResolvedValue({ scopes: [allScopes[1]] });
  expect((await POST(...accountRequest("account-test", actor, "POST"))).status).toBe(409);
  expect(provider.tokenInfo).not.toHaveBeenCalled();
});

it("rejects stale verification when draft authorization is marked revoked without a new generation", async () => {
  const { state } = await start();
  provider.exchange.mockResolvedValue(grant());
  await finish(state);
  provider.refresh.mockResolvedValue({ token: "synthetic-access-token" });
  provider.tokenInfo.mockImplementationOnce(async () => {
    db.prepare("UPDATE google_form_draft_auth SET revoked=1 WHERE user_id=?").run(actor.id);
    return { scopes: allScopes };
  });
  expect((await POST(...accountRequest("account-test", actor, "POST"))).status).toBe(409);
});

it("uses one consent and one exchange to connect all three features for just the current account", async () => {
  const { state, options } = await start();
  expect(options.scope).toEqual(allScopes);
  expect(options).toMatchObject({ include_granted_scopes: false, code_challenge_method: "S256", nonce: expect.any(String) });
  provider.exchange.mockResolvedValue(grant());
  expect(await finish(state)).toMatchObject({ outcome: "connected", calendarConnected: true });
  expect(provider.exchange).toHaveBeenCalledOnce();
  expect(statuses()).toEqual({ calendar: true, formsRead: true, formsCreate: true });
  expect(statuses(other)).toEqual({ calendar: false, formsRead: false, formsCreate: false });
  provider.refresh.mockResolvedValue({ token: "access", res: { data: { scope: allScopes.join(" ") } } });
  expect(await getGoogleFormDraftConnection(actor, db).accessToken()).toBe("access");
  await expect(finish(state)).rejects.toMatchObject({ status: 400 });
});

it("does not replace a working connection when it was not granted in a new consent", async () => {
  const original = await start(actor, ["calendar"]);
  provider.exchange.mockResolvedValueOnce(grant(["openid", allScopes[1]]));
  await finish(original.state);
  const before = db.prepare("SELECT credentials FROM google_connections WHERE user_id=?").get(actor.id);
  const { state } = await start();
  provider.exchange.mockResolvedValueOnce(grant(["openid", allScopes[2], allScopes[3]]));
  expect(await finish(state)).toMatchObject({ outcome: "partial", calendarConnected: false });
  expect(statuses()).toEqual({ calendar: true, formsRead: true, formsCreate: false });
  expect(db.prepare("SELECT credentials FROM google_connections WHERE user_id=?").get(actor.id)).toEqual(before);
});

it("rejects unavailable scopes, another session, and reconnecting after disconnect during the exchange", async () => {
  await expect(start({ ...actor, permissions: ["viewRoom"] })).rejects.toMatchObject({ status: 403 });
  const { state } = await start();
  await expect(finish(state, actor, "session-b")).rejects.toMatchObject({ status: 400 });
  provider.exchange.mockImplementationOnce(() => { disconnectGoogleAccount(actor, db); return grant(); });
  await expect(finish(state)).rejects.toMatchObject({ status: 409 });
  expect(statuses()).toEqual({ calendar: false, formsRead: false, formsCreate: false });
});

it("does not connect with a mismatched identity nonce or a grant wider than requested", async () => {
  const first = await start();
  provider.identity.mockResolvedValueOnce({ getPayload: () => ({ sub: actor.id, nonce: "not-the-request-nonce" }) });
  provider.exchange.mockResolvedValueOnce(grant());
  await expect(finish(first.state)).rejects.toMatchObject({ status: 403 });
  const second = await start(actor, ["calendar"]);
  provider.exchange.mockResolvedValueOnce(grant());
  await expect(finish(second.state)).rejects.toMatchObject({ status: 403 });
  expect(statuses()).toEqual({ calendar: false, formsRead: false, formsCreate: false });
});

it("redirects the unified callback to settings and reports feature statuses through the authenticated route", async () => {
  const session = "A".repeat(43), now = new Date().toISOString();
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,0,?,?)")
    .run(createHash("sha256").update(session).digest("hex"), actor.id, new Date(Date.now() + 3_600_000).toISOString(), now);
  const base = "http://localhost:3012/api/integrations/google/";
  const cookie = { cookie: `church_session=${session}` };
  const context = (action: string) => ({ params: Promise.resolve({ action }) });
  const response = await POST(new Request(base + "account-connect", { method: "POST", headers: { ...cookie, "content-type": "application/json" }, body: JSON.stringify({ features }) }), context("account-connect"));
  expect(response.status).toBe(200);
  const state = new URL((await response.json()).url).searchParams.get("state");
  const nonce = provider.consent.mock.lastCall![0].nonce;
  provider.identity.mockResolvedValueOnce({ getPayload: () => ({ sub: actor.id, nonce }) });
  provider.exchange.mockResolvedValueOnce(grant());
  const result = await callback(new Request(`${base}callback?state=${state}&code=fixture`, { headers: cookie }));
  expect(result.status).toBe(303);
  expect(result.headers.get("Location")).toBe("/settings?section=connections&connection=account&result=connected");
  const status = await GET(new Request(base + "account-status", { headers: cookie }), context("account-status"));
  expect(await status.json()).toMatchObject({ calendar: { connected: true }, formsRead: { connected: true }, formsCreate: { connected: true } });
  expect((await GET(new Request(base + "account-status"), context("account-status"))).status).toBe(401);
});
