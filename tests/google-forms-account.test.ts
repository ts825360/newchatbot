// @vitest-environment node
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/integrations/google-forms/route";
import { requireUser } from "@/lib/server/auth";
import { createDatabase, getDatabase } from "@/lib/server/database";
import { finishGoogleForms } from "@/lib/server/google-forms";
import { googleSession } from "@/lib/server/google-calendar";

const provider = vi.hoisted(() => ({ consent: vi.fn(), exchange: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/server/database", async (original) => ({
  ...await original<typeof import("@/lib/server/database")>(), getDatabase: vi.fn(),
}));
vi.mock("google-auth-library", () => ({
  CodeChallengeMethod: { S256: "S256" },
  OAuth2Client: class {
    credentials: Record<string, unknown> = {};
    async generateCodeVerifierAsync() { return { codeVerifier: "verifier", codeChallenge: "challenge" }; }
    generateAuthUrl = (options: { state: string }) => {
      provider.consent(options);
      return "https://accounts.google.com/o/oauth2/v2/auth?state=" + options.state;
    };
    getToken = provider.exchange;
    setCredentials(value: Record<string, unknown>) { this.credentials = value; }
    request(input: unknown) { return provider.request(this.credentials, input); }
  },
}));

const endpoint = "http://127.0.0.1:3001/api/integrations/google-forms";
const editUrl = "https://docs.google.com/forms/d/mock_form01/edit";
const respondentUrl = "https://docs.google.com/forms/d/e/public_mock_form01/viewform";
const scopes = ["https://www.googleapis.com/auth/forms.body.readonly", "https://www.googleapis.com/auth/forms.responses.readonly"];
const items = [
  { title: "참석 여부", questionItem: { question: { questionId: "attendance" } } },
  { title: "이름", questionItem: { question: { questionId: "name" } } },
];
let db: DatabaseSync;
const tokens = { viewer: "V".repeat(43), editor: "E".repeat(43), other: "A".repeat(43) };
type Account = keyof typeof tokens;
function request(account?: Account, data?: object) {
  const headers = new Headers(account ? { cookie: `church_session=${tokens[account]}` } : undefined);
  if (data) headers.set("Content-Type", "application/json");
  return new Request(endpoint, data ? { headers, method: "POST", body: JSON.stringify(data) } : { headers });
}
async function connect(account: Account) {
  const proof = request(account);
  const response = await POST(request(account, { action: "connect" }));
  expect(response.status).toBe(200);
  const state = new URL((await response.json()).url).searchParams.get("state")!;
  const actor = requireUser(proof, db);
  provider.exchange.mockResolvedValueOnce({ tokens: { refresh_token: account + "-refresh", scope: scopes.join(" ") } });
  await finishGoogleForms(actor, googleSession(proof), state, "mock-code", () => { requireUser(proof, db); }, db);
}

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3001");
  vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "http://127.0.0.1:3001/api/integrations/google/callback");
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
  db = createDatabase(":memory:");
  vi.mocked(getDatabase).mockReturnValue(db);
  const now = new Date().toISOString();
  for (const account of Object.keys(tokens) as Account[]) {
    const permissions = account === "viewer" ? ["viewRoom"] : ["viewRoom", "chat", "editChecklist"];
    db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(account, account, account, account === "editor" ? 2 : 3, "", JSON.stringify(permissions), "unused", "unused", now);
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,?,?,?)")
      .run(createHash("sha256").update(tokens[account]).digest("hex"), account, 0, new Date(Date.now() + 3600_000).toISOString(), now);
  }
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("account-scoped Google Forms", () => {
  it("lets a view-only grade 3 user connect with only read scopes and preview with their own token", async () => {
    await connect("viewer");
    await connect("editor");
    expect(provider.consent).toHaveBeenLastCalledWith(expect.objectContaining({ scope: scopes }));
    expect(await GET(request("viewer")).json()).toEqual({ configured: true, connected: true, needsReconnect: false });
    provider.request.mockResolvedValueOnce({ data: { items, responderUri: respondentUrl + "?usp=send_form" } })
      .mockResolvedValueOnce({ data: { responses: [{ responseId: "private-answer", answers: { name: { textAnswers: { answers: [{ value: "테스트 응답" }] } } } }] } });
    const response = await POST(request("viewer", { action: "account-preview", url: editUrl }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ respondentUrl, data: { rows: [["", "테스트 응답"]] } });
    expect(provider.request.mock.calls.map(([token, options]) => [token.refresh_token, options.method, options.url])).toEqual([
      ["viewer-refresh", "GET", "https://forms.googleapis.com/v1/forms/mock_form01"],
      ["viewer-refresh", "GET", "https://forms.googleapis.com/v1/forms/mock_form01/responses"],
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM records").get()?.n).toBe(0);
    expect((await POST(request("viewer", { action: "disconnect" }))).status).toBe(200);
    expect((await GET(request("editor")).json()).connected).toBe(true);
  });

  it("rejects anonymous, suspended, insufficient, and unconnected requests or account overrides", async () => {
    await connect("viewer");
    const data = { action: "account-preview", url: editUrl };
    expect((await POST(request(undefined, data))).status).toBe(401);
    expect((await POST(request("other", { ...data, accountId: "viewer" }))).status).toBe(400);
    expect((await POST(request("other", data))).status).toBe(409);
    db.prepare("UPDATE users SET permissions_json='[]' WHERE id='editor'").run();
    expect(GET(request("editor")).status).toBe(403);
    expect((await POST(request("editor", { action: "connect" }))).status).toBe(403);
    db.prepare("UPDATE users SET suspended=1 WHERE id='viewer'").run();
    expect((await POST(request("viewer", data))).status).toBe(401);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("still requires chat/edit permissions and a conversation owned by the caller for workspace preview", async () => {
    db.prepare("INSERT INTO rooms(id,data_json) VALUES('room','{}')").run();
    db.prepare("INSERT INTO records(key,room_id,owner_id,kind,data_json,updated_at) VALUES(?,?,?,?,?,?)")
      .run("conversations:other:room", "room", "other", "conversations", '{"conversations":[{"id":"private-other"}]}', new Date().toISOString());
    const input = { action: "preview", roomId: "room", url: editUrl };
    await connect("viewer");
    await connect("editor");
    expect((await POST(request("viewer", { ...input, accountId: "viewer", conversationId: "initial-room" }))).status).toBe(403);
    expect((await POST(request("editor", { ...input, accountId: "other", conversationId: "private-other" }))).status).toBe(400);
    expect((await POST(request("editor", { ...input, accountId: "editor", conversationId: "private-other" }))).status).toBe(404);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("can return a response link before the first response without persisting anything", async () => {
    await connect("viewer");
    provider.request.mockResolvedValueOnce({ data: { items: [], responderUri: respondentUrl } }).mockResolvedValueOnce({ data: {} });
    const response = await POST(request("viewer", { action: "account-preview", url: editUrl }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ respondentUrl, notice: "아직 접수된 설문 응답이 없습니다." });
    expect(db.prepare("SELECT COUNT(*) AS n FROM records").get()?.n).toBe(0);
  });

  it.each([
    editUrl, "https://docs.google.com.attacker.example/forms/d/e/public_mock_form01/viewform",
    "http://docs.google.com/forms/d/e/public_mock_form01/viewform", "https://docs.google.com:444/forms/d/e/public_mock_form01/viewform",
  ])("does not return an editor or invalid respondent URL: %s", async (invalid) => {
    await connect("viewer");
    provider.request.mockResolvedValueOnce({ data: { items, responderUri: invalid } })
      .mockResolvedValueOnce({ data: { responses: [{ responseId: "valid" }] } });
    const response = await POST(request("viewer", { action: "account-preview", url: editUrl }));
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("respondentUrl");
  });

  it("does not return responses if the account is suspended during a provider request", async () => {
    await connect("viewer");
    provider.request.mockResolvedValueOnce({ data: { items, responderUri: respondentUrl } })
      .mockImplementationOnce(async () => {
        db.prepare("UPDATE users SET suspended=1 WHERE id='viewer'").run();
        return { data: { responses: [{ responseId: "private-answer" }] } };
      });
    const response = await POST(request("viewer", { action: "account-preview", url: editUrl }));
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("data");
  });
});
