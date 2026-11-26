// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabase } from "@/lib/server/database";
import { handlePreparationProgress, readPreparationProgress } from "@/lib/server/preparation-progress";

const provider = vi.fn<typeof fetch>();
const date = "2027-04-15";
const token = "x".repeat(43);
const body = { roomId: "room", conversationId: "initial-room", consent: "preparation-summary-v1" };
const request = (value: object = body, cookie = `church_session=${token}`) => new Request("http://localhost/api/preparation-progress", {
  method: "POST", headers: { cookie, origin: "http://localhost", "content-type": "application/json", "x-preparation-account": "alice" }, body: JSON.stringify(value),
});
let db: ReturnType<typeof createDatabase>;
const write = (key: string, kind: string, owner: string | null, items: object[]) => db.prepare(
  "INSERT INTO records(key,room_id,owner_id,kind,data_json,updated_at) VALUES(?,'room',?,?,?,?) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1",
).run(key, owner, kind, JSON.stringify({ version: 1, items }), date);
const task = (id: string, title: string, status = "done") => ({ id, title, owner: "PRIVATE_OWNER", due: "", memo: "PRIVATE_MEMO", status });
const checklist = (...items: object[]) => write("room-work-v1:alice:room:checklist", "checklist", "alice", items);
const result = async (value = body) => (await handlePreparationProgress(request(value), db)).json();
const saved = (conversationId = body.conversationId, accountId = "alice", credential = token) =>
  readPreparationProgress(new Request(`http://localhost/api/preparation-progress?roomId=room&conversationId=${conversationId}`, {
    headers: { cookie: `church_session=${credential}`, "x-preparation-account": accountId },
  }), db);
const model = (verdict: string) => Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ verdict }) }] }] });

beforeEach(() => {
  db = createDatabase(":memory:");
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES('alice','PRIVATE_NAME','alice',3,'test',?,'unused','unused',?)")
    .run(JSON.stringify(["viewRoom", "viewCalendar", "viewChecklist", "chat"]), date);
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,'alice',0,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 600_000).toISOString(), date);
  db.prepare("INSERT INTO rooms(id,data_json) VALUES ('room',?)").run(JSON.stringify({ name: "PRIVATE_ROOM_TITLE", category: "worship", date, endDate: date }));
  checklist(task("1", "PRIVATE_TASK"), task("2", "최종 준비 검토"));
  write("preparation:room:events", "events", null, [{ id: "e", title: "PRIVATE_EVENT", date, time: "", location: "PRIVATE_PLACE", memo: "", status: "confirmed", author: "", lastEditor: "", changeLog: "" }]);
  vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("OPENAI_API_KEY", "synthetic"); vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
  provider.mockReset().mockImplementation(async () => model("ready"));
  vi.stubGlobal("fetch", provider);
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("allows 100 percent only on sufficient scoped evidence and sends no private content", async () => {
  expect(await result()).toMatchObject({ state: "ready", percent: 100 });
  const payload = JSON.parse(String(provider.mock.calls[0][1]?.body));
  expect(payload.store).toBe(false);
  expect(JSON.stringify(payload.input)).not.toMatch(/PRIVATE_|alice|initial-room|2027-04-15/);
});

it("does not call the model for missing signoff or unresolved work", async () => {
  checklist(task("1", "PRIVATE_TASK"));
  expect(await result()).toMatchObject({ state: "pending", percent: null });
  checklist(task("1", "PRIVATE_TASK", "inProgress"), task("2", "최종 준비 검토"));
  const score = await result();
  expect(score.state).toBe("remaining");
  expect(score.percent).toBeLessThan(100);
  expect(provider).not.toHaveBeenCalled();
});

it("does not report near-completion just because work items are checked when risks remain", async () => {
  write("room-work-v1:alice:room:risks", "risks", "alice", [{ id: "r", title: "격리된 위험", detail: "detail", action: "action", resolved: false }]);
  expect(await result()).toMatchObject({ state: "remaining", percent: null });
  expect(provider).not.toHaveBeenCalled();
});

it("requires consent and conversation ownership; unconfigured or equivocal models cannot certify completion", async () => {
  expect((await handlePreparationProgress(request({ ...body, consent: "" }), db)).status).toBe(423);
  expect((await handlePreparationProgress(request({ ...body, conversationId: "not-owned" }), db)).status).toBe(404);
  expect(provider).not.toHaveBeenCalled();
  provider.mockImplementationOnce(async () => model("uncertain"));
  expect(await result()).toMatchObject({ state: "pending", percent: null });
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(await result()).toMatchObject({ state: "pending", percent: null });
});

it("discards a model result when the evidence changes during evaluation", async () => {
  provider.mockImplementationOnce(async () => {
    checklist(task("1", "PRIVATE_TASK", "needsReview"), task("2", "최종 준비 검토"));
    return model("ready");
  });
  expect((await handlePreparationProgress(request(), db)).status).toBe(409);
});

it("restores a server-validated score without calling the model again", async () => {
  expect(await (await saved()).json()).toEqual({ report: null, stale: false });
  const review = await result();
  expect(review.percent).toBe(100);
  expect(await (await saved()).json()).toEqual({ report: review, stale: false });
  expect(provider).toHaveBeenCalledTimes(1);
});

it("hides stale completion and restores a fresh partial score even without a provider", async () => {
  await result();
  checklist(task("1", "PRIVATE_TASK"), task("2", "최종 준비 검토"), task("3", "New work", "inProgress"));
  expect(await (await saved()).json()).toEqual({ report: null, stale: true });
  const review = await result();
  expect(review).toMatchObject({ state: "remaining", percent: 50 });
  expect(await (await saved()).json()).toEqual({ report: review, stale: false });
  expect(provider).toHaveBeenCalledTimes(1);
});

it("shares the current review across owned conversations only", async () => {
  db.prepare("INSERT INTO records(key,room_id,owner_id,kind,data_json,updated_at) VALUES('conversations:alice:room','room','alice','conversations',?,?)")
    .run(JSON.stringify({ conversations: [{ id: body.conversationId }, { id: "second" }] }), date);
  const bobToken = "y".repeat(43);
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) SELECT 'bob','Bob','bob',grade,role,permissions_json,salt,password_hash,created_at FROM users WHERE id='alice'").run();
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) SELECT ?,'bob',session_version,expires_at,created_at FROM sessions WHERE user_id='alice'")
    .run(createHash("sha256").update(bobToken).digest("hex"));
  const report = await result();
  expect(await (await saved("second")).json()).toEqual({ report, stale: false });
  expect(await (await saved(body.conversationId, "bob", bobToken)).json()).toEqual({ report: null, stale: false });
  expect((await saved("second", "bob", bobToken)).status).toBe(404);
  expect((await saved(body.conversationId, "alice", bobToken)).status).toBe(409);
  expect(provider).toHaveBeenCalledTimes(1);
});
