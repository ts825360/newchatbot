// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createDatabase } from "@/lib/server/database";
import { handleDevotions } from "@/lib/server/devotions";

const clock = new Date("2026-11-20T15:10:00.000Z");
const today = "2026-11-21";
const yesterday = "2026-11-20";
const body = " 첫 줄\n\n둘째 줄\n";
let db: ReturnType<typeof createDatabase>, manager: string, reader: string;

function session(id: string, grade: number, permissions = ["viewRoom"]) {
  const token = createHash("sha256").update(id).digest("base64url");
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,'unused','unused',?)")
    .run(id, id, id, grade, "가상 계정", JSON.stringify(permissions), clock.toISOString());
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,0,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), id, new Date(Date.now() + 60000).toISOString(), clock.toISOString());
  return `church_session=${token}`;
}
const request = (cookie: string, query = "", method = "GET", data?: unknown, headers: Record<string, string> = {}) =>
  handleDevotions(new Request(`http://localhost/api/devotions${query}`, {
    method, headers: { cookie, "content-type": "application/json", ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), db, clock);
const write = (cookie: string, date = today, revision = 0) => request(cookie, "", "PUT", { date, revision, title: "", body });

beforeEach(() => {
  db = createDatabase(":memory:");
  manager = session("manager", 2, ["viewRoom", "editRoom"]);
  reader = session("reader", 3);
});
afterEach(() => db.close());

it("keeps reads private and limits posting to active managers", async () => {
  expect((await request("")).status).toBe(401);
  expect((await request(session("limited", 3, []))).status).toBe(403);
  expect((await write(reader)).status).toBe(403);
  expect((await write(manager)).status).toBe(200);
  const opened = await request(reader);
  expect(opened.headers.get("cache-control")).toBe("no-store");
  expect(await opened.json()).toMatchObject({ today, canPublish: false, entry: { date: today, title: "", body } });
  expect((await request(reader, "", "DELETE", { date: today, revision: 1 })).status).toBe(403);
  db.prepare("UPDATE users SET suspended=1 WHERE id='reader'").run();
  expect((await request(reader)).status).toBe(401);
});

it("defaults to the latest date without labelling a previous entry as today's", async () => {
  await write(manager, yesterday);
  expect(await (await request(reader)).json()).toMatchObject({ today, entry: { date: yesterday } });
  const preview = await (await request(reader, "?view=preview")).json();
  expect(preview).toEqual({ today, latest: { date: yesterday, title: "", excerpt: "첫 줄 둘째 줄" } });
  expect(await (await request(reader, `?date=${today}`)).json()).toMatchObject({ entry: null });
});

it("serves one authenticated meditation, shared for a Korean day, without saving it", async () => {
  await write(manager, yesterday);
  const query = "?view=meditation";
  expect((await request("", query)).status).toBe(401);
  expect((await request(session("limited", 3, []), query)).status).toBe(403);
  expect((await request(reader, `${query}&date=${yesterday}`)).status).toBe(400);
  const response = await request(reader, query);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const meditation = await response.json();
  expect(meditation).toEqual({ date: today, reference: expect.any(String), verse: expect.any(String), url: expect.stringMatching(/^https:\/\/www\.bible\.com\//) });
  expect(meditation.verse).not.toContain("첫 줄");
  expect(await (await request(manager, query)).json()).toEqual(meditation);
  const previous = await handleDevotions(new Request(`http://localhost/api/devotions${query}`, { headers: { cookie: reader } }),
    db, new Date("2026-11-20T14:59:59.999Z"));
  const earlier = await previous.json();
  expect(earlier.date).toBe(yesterday);
  expect(earlier.reference).not.toBe(meditation.reference);
  expect(db.prepare("SELECT day FROM daily_devotions ORDER BY day").all()).toEqual([{ day: yesterday }]);
});

it("rejects duplicate dates, stale edits/deletes, future dates, and untrusted origins", async () => {
  expect((await write(manager, "2026-11-22")).status).toBe(400);
  expect((await write(manager, "2026-02-31")).status).toBe(400);
  expect((await write(manager)).status).toBe(200);
  expect((await write(manager)).status).toBe(409);
  expect((await request(manager, "", "PUT", { date: today, revision: 1, title: "", body }, { origin: "https://unrelated.invalid" })).status).toBe(403);
  expect(await (await write(manager, today, 1)).json()).toMatchObject({ entry: { body, revision: 2 } });
  expect((await request(manager, "", "DELETE", { date: today, revision: 1 })).status).toBe(409);
  expect((await request(manager, "", "DELETE", { date: today, revision: 2 })).status).toBe(200);
  expect(await (await request(reader)).json()).toMatchObject({ entry: null, archive: [] });
});
