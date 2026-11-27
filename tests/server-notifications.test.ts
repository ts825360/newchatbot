// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createDatabase } from "@/lib/server/database";
import { requireUser } from "@/lib/server/auth";
import { readSnapshot, writeBatch } from "@/lib/server/records";
import { handleNotifications } from "@/lib/server/notifications";

let db: ReturnType<typeof createDatabase>;
const key = "church-preparation-v1:room:events";
const catalog = "church-planner-room-catalog-v1:alice";
const room = { id: "room", name: "가상 행사", category: "retreat", location: "", description: "", otherDetail: "", pinned: false, date: null, endDate: null };
const future = "2099-01-01T00:00:00.000Z";
const permissions = ["viewRoom", "viewCalendar", "createRoom", "editRoom", "editEvent", "deleteEvent"];
const api = (id?: string, body?: unknown) => new Request("http://localhost/api/notifications", {
  method: body === undefined ? "GET" : "PUT",
  headers: { ...(id && { cookie: `church_session=${id.padEnd(43, "A")}` }), "content-type": "application/json" },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});
const actor = () => requireUser(api("alice"), db);
const write = (target: string, value: unknown) => {
  const base = readSnapshot(actor(), "room", db).records.find(item => item.key === target)!;
  return writeBatch(actor(), [{ key: target, value: JSON.stringify(value), version: base.version }], "room", db);
};
const event = (title: string) => ({ id: "item", title, date: "2027-01-20", time: "", location: "", memo: "DO_NOT_DUPLICATE", author: "", lastEditor: "", changeLog: "", status: "confirmed" });
const calendar = (title: string) => write(key, { version: 1, items: [event(title)] });
const get = async (id: string) => (await handleNotifications(api(id), db)).json();
beforeEach(() => {
  db = createDatabase(":memory:");
  for (const id of ["alice", "bob", "other", "restricted"]) {
    const allowed = id === "restricted" ? ["viewRoom"] : permissions;
    db.prepare("INSERT INTO users(id,username,name,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, id, id, id === "alice" ? 1 : 3, "tester", JSON.stringify(allowed), "", "", "2026-01-01");
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,?,?,?)")
      .run(createHash("sha256").update(id.padEnd(43, "A")).digest("hex"), id, 0, future, "2026-01-01");
  }
  db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run("room", JSON.stringify(room));
  for (const id of ["alice", "bob", "restricted"]) db.prepare("INSERT INTO room_visits VALUES(?,?,?)").run("room", id, "2026-01-01");
});
afterEach(() => db.close());

it("creates only real changes, gates creation by both switches, and preserves older notifications", async () => {
  calendar("시작 일정");
  calendar("시작 일정");
  expect((await get("bob")).items).toMatchObject([{ kind: "calendar", roomName: "가상 행사" }]);
  expect((await get("alice")).items).toEqual([]);
  expect((await get("other")).items).toEqual([]);
  expect((await get("restricted")).items).toEqual([]);
  const settings = { enabled: false, calendar: false, room: true };
  expect((await handleNotifications(api("bob", settings), db)).status).toBe(200);
  calendar("알림이 꺼졌는지 확인");
  write(catalog, { rooms: [{ ...room, name: "이름 변경" }], selectedRoomId: "room" });
  expect(db.prepare("SELECT count(*) AS count FROM user_notifications WHERE user_id='bob'").get()?.count).toBe(1);
  expect((await get("bob")).settings).toEqual(settings);
  expect((await get("other")).settings).toEqual({ enabled: true, calendar: true, room: true });
  await handleNotifications(api("bob", { ...settings, enabled: true }), db);
  write(catalog, { rooms: [{ ...room, name: "이름 변경 2" }], selectedRoomId: "room" });
  calendar("개별 설정이 유지되는지 확인");
  const alerts = await get("bob");
  expect(alerts.settings.calendar).toBe(false);
  expect(alerts.items.map(({ kind }: { kind: string }) => kind).sort()).toEqual(["calendar", "room"]);
  expect(JSON.stringify(alerts)).not.toContain("DO_NOT_DUPLICATE");
});

it("keeps alert settings bound to the signed-in account and rechecks permission before reading history", async () => {
  expect((await handleNotifications(api(), db)).status).toBe(401);
  const response = await handleNotifications(api("other", { accountId: "bob", enabled: false, calendar: false, room: false }), db);
  expect(response.status).toBe(400);
  calendar("일정");
  db.prepare("UPDATE users SET permissions_json='[\"viewRoom\"]' WHERE id='bob'").run();
  expect((await get("bob")).items).toEqual([]);
  expect(db.prepare("SELECT count(*) AS count FROM user_notifications WHERE user_id='bob'").get()?.count).toBe(1);
});
