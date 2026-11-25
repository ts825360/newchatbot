// @vitest-environment node
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/integrations/google/callback/route";
import { GET, POST } from "@/app/api/integrations/google-form-drafts/route";
import { createDatabase, getDatabase } from "@/lib/server/database";
import { analyzeSurvey, defaultSurveyMapping } from "@/lib/transport-survey";

const provider = vi.hoisted(() => ({ consent: vi.fn(), exchange: vi.fn(), verify: vi.fn(), access: vi.fn(), fetch: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/server/database", async (original) => ({
  ...await original<typeof import("@/lib/server/database")>(), getDatabase: vi.fn(),
}));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: provider.after }));
vi.mock("google-auth-library", () => ({
  CodeChallengeMethod: { S256: "S256" },
  OAuth2Client: class {
    async generateCodeVerifierAsync() { return { codeVerifier: "fixture-verifier", codeChallenge: "fixture-challenge" }; }
    generateAuthUrl(options: { state: string }) {
      provider.consent(options);
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${options.state}`;
    }
    getToken = provider.exchange;
    verifyIdToken = provider.verify;
    setCredentials(value: { refresh_token: string }) { this.credentials = value; }
    credentials?: { refresh_token: string };
    getAccessToken() { return provider.access(this.credentials); }
  },
}));

const origin = "http://127.0.0.1:3001";
const callbackUrl = `${origin}/api/integrations/google/callback`;
const endpoint = `${origin}/api/integrations/google-form-drafts`;
const forms = "https://forms.googleapis.com/v1/forms";
const fileScope = "https://www.googleapis.com/auth/drive.file";
const readScope = "https://www.googleapis.com/auth/forms.body.readonly https://www.googleapis.com/auth/forms.responses.readonly";
const draft = { action: "create", title: "여름 행사" };
const sessionSecrets = { viewer: "V".repeat(43), viewerOtherSession: "W".repeat(43), chatter: "C".repeat(43), other: "O".repeat(43) };
type Session = keyof typeof sessionSecrets;
const conversation = { roomId: "room-one", conversationId: "private-one" };
let db: DatabaseSync;

function request(session?: Session, body?: object, url = endpoint) {
  const headers = new Headers(session ? { cookie: `church_session=${sessionSecrets[session]}` } : undefined);
  if (body) headers.set("Content-Type", "application/json");
  return new Request(url, body ? { headers, method: "POST", body: JSON.stringify(body) } : { headers });
}

async function start(session: Session) {
  const response = await POST(request(session, { action: "connect" }));
  expect(response.status).toBe(200);
  return new URL((await response.json()).url).searchParams.get("state")!;
}

function finish(session: Session, state: string, query = "code=fixture-code") {
  return callback(request(session, undefined, `${callbackUrl}?state=${state}&${query}`));
}

function mockGrant(subject: string, scope = `openid ${fileScope}`, nonce = provider.consent.mock.lastCall?.[0].nonce) {
  provider.exchange.mockResolvedValueOnce({ tokens: { access_token: "initial-access", refresh_token: `${subject}-refresh`, id_token: "fixture-id-token", scope } });
  provider.verify.mockResolvedValueOnce({ getPayload: () => ({ sub: subject, nonce }) });
}

async function connect(session: Session, subject: string) {
  const state = await start(session);
  mockGrant(subject);
  const response = await finish(session, state);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/settings?section=connections&connection=forms&result=connected");
}

const editorUrl = (formId: string) => `https://docs.google.com/forms/d/${formId}/edit`;
const created = (formId: string) => Response.json({ formId, revisionId: "created-revision", publishSettings: { publishState: { isPublished: false, isAcceptingResponses: false } } });
const formReady = (formId: string) => provider.fetch.mockResolvedValueOnce(created(formId)).mockResolvedValueOnce(Response.json({}));

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", origin);
  vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", callbackUrl);
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
  vi.stubGlobal("fetch", provider.fetch.mockRejectedValue(new Error("Unexpected provider call")));
  provider.access.mockImplementation(async ({ refresh_token }) => ({ token: `${refresh_token}-access` }));
  db = createDatabase(":memory:");
  vi.mocked(getDatabase).mockReturnValue(db);
  const now = new Date().toISOString();
  for (const user of ["viewer", "chatter", "other"]) {
    const permissions = user === "viewer" ? ["viewRoom"] : ["viewRoom", "chat"];
    db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(user, user, user, 3, "", JSON.stringify(permissions), "unused", "unused", now);
  }
  for (const [name, secret] of Object.entries(sessionSecrets)) {
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,?,?,?)")
      .run(createHash("sha256").update(secret).digest("hex"), name === "viewerOtherSession" ? "viewer" : name, 0, new Date(Date.now() + 3_600_000).toISOString(), now);
  }
  db.prepare("INSERT INTO rooms(id,data_json) VALUES('room-one','{}'),('room-two','{}')").run();
  const saveHistory = db.prepare("INSERT INTO records(key,room_id,owner_id,kind,data_json,updated_at) VALUES(?,?,?,?,?,?)");
  saveHistory.run("conversations:chatter:room-one", "room-one", "chatter", "conversations", '{"conversations":[{"id":"private-one"},{"id":"private-two"}]}', now);
  saveHistory.run("conversations:chatter:room-two", "room-two", "chatter", "conversations", '{"conversations":[{"id":"private-one"}]}', now);
});

afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("Google Forms draft authorization", () => {
  it("requests only drive.file and openid and binds the single-use callback to the app session", async () => {
    expect(await GET(request("viewer")).json()).toEqual({ configured: true, connected: false, needsReconnect: false });
    const state = await start("viewer");
    expect(state).toMatch(/^forms-draft\.[A-Za-z0-9_-]{43}$/);
    expect(provider.consent).toHaveBeenCalledWith(expect.objectContaining({
      state, scope: [fileScope, "openid"], code_challenge_method: "S256", code_challenge: expect.any(String),
      include_granted_scopes: false, access_type: "offline", nonce: expect.any(String),
    }));
    expect((await finish("viewerOtherSession", state)).headers.get("location")).toContain("result=failed");
    expect(provider.exchange).not.toHaveBeenCalled();
    mockGrant("google-one");
    expect((await finish("viewer", state)).headers.get("location")).toContain("result=connected");
    expect(provider.exchange).toHaveBeenCalledWith({ code: "fixture-code", codeVerifier: expect.any(String) });
    const verifier = provider.exchange.mock.lastCall?.[0].codeVerifier;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(provider.consent.mock.lastCall?.[0].code_challenge);
    expect(provider.verify).toHaveBeenCalledWith({ idToken: "fixture-id-token", audience: "fixture-client" });
    expect((await finish("viewer", state)).headers.get("location")).toContain("result=failed");
    expect(provider.exchange).toHaveBeenCalledTimes(1);
    expect(provider.after).not.toHaveBeenCalled();
    expect(await GET(request("viewer")).json()).toEqual({ configured: true, connected: true, needsReconnect: false });
    expect(await GET(request("other")).json()).toEqual({ configured: true, connected: false, needsReconnect: false });
  });

  it.each([
    { scope: readScope, wrongNonce: false },
    { scope: `openid ${fileScope} https://www.googleapis.com/auth/drive`, wrongNonce: false },
    { scope: `openid ${fileScope}`, wrongNonce: true },
  ])("rejects a grant with the wrong scopes or identity nonce: %j", async ({ scope, wrongNonce }) => {
    const state = await start("viewer");
    mockGrant("fixture-subject", scope, wrongNonce ? "wrong-nonce" : undefined);
    expect((await finish("viewer", state)).headers.get("location")).toContain("result=failed");
    expect(await GET(request("viewer")).json()).toMatchObject({ connected: false });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("keeps connection and disconnection independent from Forms reading and Calendar", async () => {
    const readRoute = await import("@/app/api/integrations/google-forms/route");
    const readStart = await readRoute.POST(request("viewer", { action: "connect" }));
    const readState = new URL((await readStart.json()).url).searchParams.get("state")!;
    provider.exchange.mockResolvedValueOnce({ tokens: { refresh_token: "read-refresh", scope: readScope } });
    expect((await finish("viewer", readState)).headers.get("location")).toContain("result=connected");
    expect((await GET(request("viewer")).json()).connected).toBe(false);
    await connect("viewer", "google-one");
    const outstanding = await start("viewer");
    expect(await (await POST(request("viewer", { action: "disconnect" }))).json()).toEqual({ ok: true });
    expect((await finish("viewer", outstanding)).headers.get("location")).toContain("result=failed");
    expect(await GET(request("viewer")).json()).toEqual({ configured: true, connected: false, needsReconnect: false });
    expect((await readRoute.GET(request("viewer")).json()).connected).toBe(true);
    expect(provider.after).not.toHaveBeenCalled();
  });

  it("reports configuration and rejects anonymous, inactive, unauthorized, and spoofed requests", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect(await GET(request("viewer")).json()).toEqual({ configured: false, connected: false, needsReconnect: false });
    expect((await POST(request("viewer", { action: "connect" }))).status).toBe(503);
    expect(GET(request()).status).toBe(401);
    db.prepare("UPDATE users SET permissions_json='[]' WHERE id='other'").run();
    expect(GET(request("other")).status).toBe(403);
    expect((await POST(request("viewer", { ...draft, accountId: "viewer" }))).status).toBe(400);
    expect((await POST(request("viewer", { ...draft, roomId: "room-one" }))).status).toBe(400);
    expect((await POST(request("viewer", { ...draft, ...conversation }))).status).toBe(403);
    expect((await POST(request("chatter", { ...draft, ...conversation, conversationId: "missing" }))).status).toBe(404);
    expect((await POST(request("other", { ...draft, ...conversation }))).status).toBe(403);
    db.prepare("UPDATE users SET suspended=1 WHERE id='viewer'").run();
    expect((await POST(request("viewer", draft))).status).toBe(401);
    expect(provider.fetch).not.toHaveBeenCalled();
  });
});

describe("Google Forms draft creation", () => {
  it("creates an unpublished form for a view-only user with the fixed, attendance-first branching template", async () => {
    await connect("viewer", "google-one");
    formReady("draft_sample1");
    const response = await POST(request("viewer", { ...draft, title: "  여름\t  행사  " }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ editorUrl: editorUrl("draft_sample1") });
    expect(provider.fetch.mock.calls.map(([url, init]) => [String(url), init.method])).toEqual([
      [`${forms}?unpublished=true`, "POST"], [`${forms}/draft_sample1:batchUpdate`, "POST"],
    ]);
    const [, createInit] = provider.fetch.mock.calls[0];
    expect(new Headers(createInit.headers).get("Authorization")).toBe("Bearer google-one-refresh-access");
    expect(createInit.redirect).toBe("error");
    expect(JSON.parse(createInit.body)).toEqual({ info: { title: "여름 행사", documentTitle: "여름 행사" } });
    const batch = JSON.parse(provider.fetch.mock.calls[1][1].body);
    expect(batch.writeControl).toEqual({ requiredRevisionId: "created-revision" });
    const items = batch.requests.map((op: { createItem: { item: Record<string, unknown> } }) => op.createItem.item);
    expect(items.map((item: { title: string }) => item.title)).toEqual(["참석 여부", "참석자 정보", "소속", "이름", "숙소 배정", "이동수단", "기타 특이사항", "가족 ID"]);
    const question = (i: number) => items[i].questionItem.question;
    expect(items[1].pageBreakItem).toEqual({});
    expect(question(0)).toMatchObject({ required: true, choiceQuestion: { type: "RADIO", options: [
      { value: "참석", goToAction: "NEXT_SECTION" }, { value: "불참", goToAction: "SUBMIT_FORM" },
    ] } });
    expect(question(2).choiceQuestion.options.map(({ value }: { value: string }) => value)).toEqual(["유초등부", "아동부", "청소년부", "청년부", "장년부", "명단 확인 필요"]);
    expect(question(3)).toMatchObject({ required: true, textQuestion: {} });
    expect(question(4).choiceQuestion.options).toEqual([{ value: "가족방" }, { value: "단체방" }]);
    const movements: string[] = question(5).choiceQuestion.options.map(({ value }: { value: string }) => value);
    expect(movements).toEqual(["단체 이동", "왕복 자차", "왕복 개별 이동", "편도 개별 이동", "가족 차량 동승", "다른 차량 동승", "미정", "기타"]);
    const headers = ["참석 여부", "이름", "이동수단"];
    const survey = analyzeSurvey({ headers, rows: movements.map((value, i) => ["참석", `fixture-${i}`, value]) }, defaultSurveyMapping(headers));
    expect(survey.entries.map(({ independent, movementReview }) => [independent, movementReview])).toEqual([
      [false, false], [true, false], [true, false], ...movements.slice(3).map(() => [false, true]),
    ]);
    expect([4, 5, 6, 7].map(i => question(i).required)).toEqual([true, false, false, false]);
  });

  it("rejects invalid titles before provider activity and allows 100 UTF-16 code units after normalization", async () => {
    await connect("viewer", "google-one");
    for (const title of ["  ", "🎉".repeat(50) + "x", "hi\u0000there", "bad\uD800", 123]) {
      expect((await POST(request("viewer", { ...draft, title }))).status).toBe(400);
    }
    expect(provider.access).not.toHaveBeenCalled();
    formReady("draft_sample1");
    expect((await POST(request("viewer", { ...draft, title: ` ${"🎉".repeat(50)} ` }))).status).toBe(200);
  });

  it("reuses the normalized title only for the same app, verified Google account, and scope", async () => {
    await connect("chatter", "same-google");
    await connect("other", "same-google");
    const cases = [
      ["chatter", draft, "draft_settings"], ["chatter", { ...draft, ...conversation }, "draft_one"],
      ["chatter", { ...draft, ...conversation, conversationId: "private-two" }, "draft_two"],
      ["chatter", { ...draft, ...conversation, roomId: "room-two" }, "draft_room_two"],
      ["other", draft, "draft_other_app"],
    ] as const;
    expect((await POST(request("other", { ...draft, ...conversation }))).status).toBe(404);
    for (const [session, body, id] of cases) {
      formReady(id);
      expect(await (await POST(request(session, body))).json()).toEqual({ editorUrl: editorUrl(id) });
      expect(await (await POST(request(session, { ...body, title: "  여름   행사 " }))).json()).toEqual({ editorUrl: editorUrl(id) });
    }
    await POST(request("chatter", { action: "disconnect" }));
    await connect("chatter", "different-google");
    formReady("draft_other_google");
    expect(await (await POST(request("chatter", draft))).json()).toEqual({ editorUrl: editorUrl("draft_other_google") });
    await connect("chatter", "same-google");
    expect(await (await POST(request("chatter", draft))).json()).toEqual({ editorUrl: editorUrl("draft_settings") });
    expect(await GET(request("chatter")).json()).toEqual({ configured: true, connected: true, needsReconnect: false });
    expect(provider.fetch).toHaveBeenCalledTimes(12);
  });

  it("allows each account's virtual initial conversation without sharing its draft with another account or settings", async () => {
    await connect("other", "same-google");
    await connect("chatter", "same-google");
    db.prepare("INSERT INTO rooms(id,data_json) VALUES('room-virtual','{}')").run();
    const input = { ...draft, roomId: "room-virtual", conversationId: "initial-room-virtual" };
    formReady("draft_implicit_other");
    formReady("draft_implicit_chatter");
    formReady("draft_implicit_settings");
    expect(await (await POST(request("other", input))).json()).toEqual({ editorUrl: editorUrl("draft_implicit_other") });
    expect(await (await POST(request("chatter", input))).json()).toEqual({ editorUrl: editorUrl("draft_implicit_chatter") });
    expect(await (await POST(request("other", draft))).json()).toEqual({ editorUrl: editorUrl("draft_implicit_settings") });
    expect(await (await POST(request("other", input))).json()).toEqual({ editorUrl: editorUrl("draft_implicit_other") });
    expect(db.prepare("SELECT 1 FROM records WHERE room_id='room-virtual'").get()).toBeUndefined();
    expect(provider.fetch).toHaveBeenCalledTimes(6);
  });

  it("never sends a second create while the first is in flight or its result is uncertain", async () => {
    await connect("viewer", "google-one");
    let fail!: (error: Error) => void;
    provider.fetch.mockImplementationOnce(() => new Promise<Response>((_, reject) => { fail = reject; }));
    const first = POST(request("viewer", draft));
    await vi.waitFor(() => expect(provider.fetch).toHaveBeenCalledTimes(1));
    expect((await POST(request("viewer", draft))).status).toBe(409);
    fail(new Error("private upstream detail"));
    const response = await first;
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining("확인") });
    await POST(request("viewer", { action: "disconnect" }));
    await connect("viewer", "google-one");
    expect((await POST(request("viewer", draft))).status).toBe(409);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("claims a normalized draft only once when both requests start before token refresh completes", async () => {
    await connect("viewer", "google-one");
    const resumes: Array<() => void> = [];
    provider.access.mockImplementation(() => new Promise(resolve => { resumes.push(() => resolve({ token: "fixture-access" })); }));
    let complete!: () => void;
    provider.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = () => resolve(created("draft_race")); }))
      .mockResolvedValueOnce(Response.json({}));
    const first = POST(request("viewer", draft));
    const second = POST(request("viewer", { ...draft, title: "여름  행사" }));
    await vi.waitFor(() => expect(resumes).toHaveLength(2));
    resumes[0]();
    await vi.waitFor(() => expect(provider.fetch).toHaveBeenCalledTimes(1));
    resumes[1]();
    const conflicted = await Promise.race([first, second]);
    expect(conflicted.status).toBe(409);
    complete();
    expect((await Promise.all([first, second])).map(response => response.status).sort()).toEqual([200, 409]);
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a malformed success, but permits retry after an explicit Google rejection", async () => {
    await connect("viewer", "google-one");
    provider.fetch.mockResolvedValueOnce(Response.json({ error: { code: 403 } }, { status: 403 }));
    expect((await POST(request("viewer", draft))).status).toBe(502);
    provider.fetch.mockResolvedValueOnce(Response.json({ formId: "../not-a-form" }));
    expect((await POST(request("viewer", draft))).status).toBe(502);
    expect((await POST(request("viewer", draft))).status).toBe(409);
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns a manual editor link on a failed template write without replaying either write", async () => {
    await connect("viewer", "google-one");
    provider.fetch.mockResolvedValueOnce(created("draft_manual")).mockRejectedValueOnce(new Error("Lost batch response"));
    const response = await POST(request("viewer", draft));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ warning: expect.stringContaining("편집"), editorUrl: editorUrl("draft_manual") });
    const retry = await POST(request("viewer", draft));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ warning: expect.stringContaining("편집"), editorUrl: editorUrl("draft_manual") });
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("gets only revision and safety metadata for a known created form when create omits the revision", async () => {
    await connect("viewer", "google-one");
    provider.fetch.mockResolvedValueOnce(Response.json({ formId: "draft_revision" }))
      .mockResolvedValueOnce(Response.json({ formId: "draft_revision", revisionId: "metadata-revision", items: [], publishSettings: { publishState: { isPublished: false } } }))
      .mockResolvedValueOnce(Response.json({}));
    const response = await POST(request("viewer", draft));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ editorUrl: editorUrl("draft_revision") });
    const [, [getUrl, get], [batchUrl, batch]] = provider.fetch.mock.calls;
    expect(new URL(getUrl).pathname).toBe("/v1/forms/draft_revision");
    expect(new URL(getUrl).searchParams.get("fields")).toBe("formId,revisionId,items(itemId),publishSettings");
    expect(get).toMatchObject({ method: "GET", redirect: "error" });
    expect(get.body).toBeUndefined();
    expect(batchUrl).toBe(`${forms}/draft_revision:batchUpdate`);
    expect(JSON.parse(batch.body).writeControl).toEqual({ requiredRevisionId: "metadata-revision" });
  });

  it.each([
    { formId: "draft_manual" },
    { formId: "different_form", revisionId: "revision" },
    { formId: "draft_manual", revisionId: "revision", items: [{ itemId: "manual-item" }] },
    { formId: "draft_manual", revisionId: "revision", publishSettings: { publishState: { isPublished: true } } },
  ])("only returns a warning and the known editor if metadata does not permit a write: %j", async metadata => {
    await connect("viewer", "google-one");
    provider.fetch.mockResolvedValueOnce(Response.json({ formId: "draft_manual" })).mockResolvedValueOnce(Response.json(metadata));
    const response = await POST(request("viewer", draft));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ editorUrl: editorUrl("draft_manual"), warning: expect.stringContaining("편집") });
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not send a create if ownership changes while fetching the access token", async () => {
    await connect("chatter", "google-one");
    provider.access.mockImplementationOnce(async () => {
      db.prepare("UPDATE records SET data_json=? WHERE owner_id='chatter'").run('{"conversations":[]}');
      return { token: "expired-scope-access" };
    });
    expect((await POST(request("chatter", { ...draft, ...conversation }))).status).toBe(404);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it.each(["create", "get", "batchUpdate"])("does not write or reveal a link after ownership is lost during %s", async (phase) => {
    await connect("chatter", "google-one");
    const loseOwnership = () => db.prepare("UPDATE records SET data_json=? WHERE owner_id='chatter'").run('{"conversations":[]}');
    provider.fetch.mockImplementationOnce(async () => {
      if (phase === "create") loseOwnership();
      return phase === "get" ? Response.json({ formId: "draft_private" }) : created("draft_private");
    }).mockImplementationOnce(async () => { loseOwnership(); return Response.json({}); });
    const response = await POST(request("chatter", { ...draft, ...conversation }));
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("editorUrl");
    expect(provider.fetch).toHaveBeenCalledTimes(phase === "create" ? 1 : 2);
  });

  it("marks revoked credentials for reconnect without consuming the title", async () => {
    await connect("viewer", "google-one");
    provider.access.mockRejectedValueOnce({ response: { data: { error: "invalid_grant" } } });
    expect((await POST(request("viewer", draft))).status).toBe(409);
    expect(await GET(request("viewer")).json()).toEqual({ configured: true, connected: false, needsReconnect: true });
    expect(provider.fetch).not.toHaveBeenCalled();
    await connect("viewer", "google-one");
    formReady("draft_after_reconnect");
    expect((await POST(request("viewer", draft))).status).toBe(200);
  });
});
