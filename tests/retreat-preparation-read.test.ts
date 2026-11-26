// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarEvent, ChecklistItem } from "@/lib/types";
import { createDatabase } from "@/lib/server/database";
import { canonicalPrivateTool, canonicalWorkspaceTool } from "@/lib/server/conversation-scope";
import { handleRetreatPreparation } from "@/lib/server/retreat-preparation";
import { handleChat } from "@/lib/server/chat";
import { createTransportDraft, createTransportVehicle } from "@/lib/transport";

const permissions = ["viewRoom", "chat", "viewChecklist", "viewCalendar"];
const now = new Date("2026-11-19T00:00:00Z");
const upstream = vi.fn();
let db: ReturnType<typeof createDatabase>;

function session(account: string, allowed = permissions) {
  const token = createHash("sha256").update(account).digest("base64url");
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,3,'test',?,'x','x',?)")
    .run(account, account, account, JSON.stringify(allowed), now.toISOString());
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,0,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), account, new Date(Date.now() + 300_000).toISOString(), now.toISOString());
  return `church_session=${token}`;
}

let alice: string, bob: string;
beforeEach(() => {
  db = createDatabase(":memory:");
  upstream.mockClear();
  vi.stubGlobal("fetch", upstream);
  alice = session("alice");
  bob = session("bob");
  for (const [id, category] of [["retreat", "retreat"], ["other", "worship"]]) {
    db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)")
      .run(id, JSON.stringify({ id, category, name: "가상 여름 수련회", date: "2027-08-15", location: "PRIVATE_ROOM_LOCATION" }));
  }
  db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,?,'conversations',?,?)")
    .run("conversations:alice:retreat", "alice", "retreat", JSON.stringify({ conversations: [{ id: "initial-retreat" }, { id: "second" }] }), now.toISOString());
});

afterEach(() => { db.close(); vi.unstubAllGlobals(); });

const endpoint = (query = "roomId=retreat&conversationId=initial-retreat", cookie = alice, extra = {}) =>
  handleRetreatPreparation(new Request(`http://localhost/api/retreat-preparation?${query}`, {
    headers: { cookie, "x-preparation-account": cookie === bob ? "bob" : "alice", ...extra },
  }), db, now);

function calendar(items: Partial<CalendarEvent>[]) {
  const rows = items.map((value, index) => ({
    id: `event-${index}`, title: "수련회 본행사", date: "2027-08-15", time: "", location: "",
    memo: "PRIVATE_CALENDAR_MEMO", author: "PRIVATE_AUTHOR", lastEditor: "PRIVATE_EDITOR", changeLog: "", status: "confirmed", ...value,
  }));
  db.prepare("INSERT INTO records(key,room_id,kind,data_json,updated_at) VALUES('preparation:retreat:events','retreat','events',?,?)")
    .run(JSON.stringify({ version: 1, items: rows }), now.toISOString());
}

function checklist(accountId: string, conversationId: string, items: Partial<ChecklistItem>[]) {
  const rows = items.map((value, index) => ({
    id: `check-${index}`, title: "차량 배정", status: "done", due: "", owner: "", memo: "PRIVATE_CHECKLIST_MEMO", ...value,
  }));
  db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,'retreat','checklist',?,?) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json")
    .run(canonicalWorkspaceTool({ accountId, conversationId, roomId: "retreat" }, "checklist"), accountId, JSON.stringify({ version: 1, items: rows }), now.toISOString());
}

const byKey = (body: any, key: string) => body.fields.find((item: { key: string }) => item.key === key);

it("keeps pinned references in the preparation tool and out of AI chat history and provider input", async () => {
  function reference(conversationId: string, filename: string, excerpt: string, pinned: boolean) {
    const bytes = Buffer.from(excerpt);
    db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,'alice','retreat','documents',?,?)")
      .run(canonicalPrivateTool({ accountId: "alice", conversationId, roomId: "retreat" }, "documents"), JSON.stringify({ version: 1, items: [
        { id: "reference", title: filename, kind: "file", pinned, file: { name: filename, type: "text/plain", size: bytes.length } },
      ] }), now.toISOString());
    db.prepare("INSERT INTO conversation_files(owner_id,room_id,conversation_id,document_id,name,mime,size,bytes,cleanup,created_at) VALUES('alice','retreat',?,'reference',?,'text/plain',?,?,0,?)")
      .run(conversationId, filename, bytes.length, bytes, now.toISOString());
  }
  reference("initial-retreat", "2025 요람.txt", "참석 설문에는 참가 가능 여부를 먼저 확인했다.\n행사 장소는 지난 해 가상 장소였다.", true);
  reference("second", "과거 수련회.txt", "참석 설문 PRIVATE_OTHER_THREAD", true);
  const response = await endpoint();
  const report = await response.json();
  expect(report.references).toEqual(expect.arrayContaining([expect.objectContaining({ sourceTitle: "2025 요람.txt", excerpt: expect.stringContaining("참석 설문") })]));
  expect(JSON.stringify(report)).not.toContain("PRIVATE_OTHER_THREAD");
  expect(byKey(report, "venue").status).not.toBe("confirmed");

  const stamp = now.toISOString(), message = { id: "prepare", sender: "user", text: "준비 점검 요약", time: stamp };
  db.prepare("UPDATE records SET data_json=? WHERE key='conversations:alice:retreat'").run(JSON.stringify({ activeId: "initial-retreat", conversations: [{ id: "initial-retreat", title: "대화", draft: "", createdAt: stamp, updatedAt: stamp, messages: [message] }] }));
  const reply = await handleChat(new Request("http://localhost/api/chat", { method: "POST", headers: { cookie: alice, "content-type": "application/json" },
    body: JSON.stringify({ roomId: "retreat", conversationId: "initial-retreat", userMessageId: message.id, userMessageText: message.text }) }), db);
  expect(reply.status).toBe(200);
  const chat = String(db.prepare("SELECT data_json FROM records WHERE key='conversations:alice:retreat'").get()?.data_json);
  expect(chat).toContain("저장된 기록 기준");
  expect(chat).not.toMatch(/2025 요람\.txt|참가 가능 여부를 먼저 확인했다|PRIVATE_OTHER_THREAD/);
  expect(upstream).not.toHaveBeenCalled();
});

it("reads the selected account's room work, without private text or upstream requests", async () => {
  checklist("alice", "initial-retreat", [{ title: " 숙소 배정 ", owner: "PRIVATE_OWNER" }]);
  checklist("bob", "initial-retreat", [{ title: "식사 계획" }]);
  calendar([{ location: "가상 장소 A" }]);
  const before = db.prepare("SELECT total_changes() AS count").get()?.count;
  const response = await endpoint();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const raw = await response.text();
  const result = JSON.parse(raw);
  expect(result.year).toBe(2027);
  expect(byKey(result, "date")).toMatchObject({ status: "confirmed", value: "2027-08-15", evidence: "calendar" });
  expect(byKey(result, "venue")).toMatchObject({ status: "confirmed", value: "가상 장소 A" });
  expect(byKey(result, "lodging")).toMatchObject({ status: "confirmed", evidence: "checklist" });
  expect(byKey(result, "transport").status).toBe("needs_review");
  expect(byKey(await (await endpoint("roomId=retreat&conversationId=second")).json(), "lodging")).toMatchObject({ status: "confirmed" });
  expect(byKey(result, "meals")).toBeUndefined();
  expect(byKey(await (await endpoint(undefined, bob)).json(), "meals")).toBeUndefined();
  expect(raw).not.toMatch(/PRIVATE_/);
  expect(db.prepare("SELECT total_changes() AS count").get()?.count).toBe(before);
  expect(upstream).not.toHaveBeenCalled();
});

it("does not promote planned room dates, preparation meetings, draft calendar entries or last year's event", async () => {
  const room = db.prepare("SELECT data_json FROM rooms WHERE id='retreat'").get()!;
  db.prepare("UPDATE rooms SET data_json=? WHERE id='retreat'")
    .run(JSON.stringify({ ...JSON.parse(String(room.data_json)), date: null }));
  calendar([
    { title: "수련회 준비 회의", location: "가상 회의실" },
    { status: "candidate", date: "2026-08-15", location: "가상 후보 장소" },
    { date: "2025-08-15", location: "가상 작년 장소" },
  ]);
  checklist("alice", "initial-retreat", [{ title: "행사 날짜", due: "2027-08-15" }]);
  const result = await (await endpoint()).json();
  expect(byKey(result, "date").status).toBe("needs_review");
  expect(byKey(result, "venue").status).toBe("needs_review");
  expect(result.next.map(({ id }: { id: string }) => id)).toEqual(["confirm-date", "draft-survey"]);
});

it("uses the room date and the current account's primary saved location", async () => {
  for (const [accountId, conversationId, location] of [["alice", "initial-retreat", "대표 장소"], ["bob", "initial-retreat", "BOB_PRIVATE"]]) {
    db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,'retreat','location',?,?)")
      .run(canonicalWorkspaceTool({ accountId, conversationId, roomId: "retreat" }, "location"), accountId, JSON.stringify({ location, places: [location, "예비 장소"] }), now.toISOString());
  }
  const result = await (await endpoint("roomId=retreat&conversationId=second")).json();
  expect(byKey(result, "date")).toMatchObject({ status: "confirmed", value: "2027-08-15", evidence: "room" });
  expect(byKey(result, "venue")).toMatchObject({ status: "confirmed", value: "대표 장소", evidence: "location" });
  expect(byKey(result, "meals")).toBeUndefined();
  expect(byKey(result, "water-activity")).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(/BOB_PRIVATE|예비 장소/);
});

it("only counts the account's real approved vehicle allocation, regardless of conversation", async () => {
  const input = createTransportDraft();
  input.people = [{ id: "participant", name: "PRIVATE_PARTICIPANT", department: "운영", familyId: "", companionGroup: "", outboundTripId: "main", returnTripId: null }];
  input.vehicles = [{ ...createTransportVehicle("vehicle"), totalSeats: 5, capacity: 4, externalDriverConfirmed: true, tripIds: ["main"] }];
  const result = { status: "optimal", revision: input.revision, assignments: [{ personId: "participant", vehicleId: "vehicle", tripId: "main" }], reservations: [], unassignedCount: 0, unreservedCount: 0, usedVehicleIds: ["vehicle"], cost: 0, message: "완료" };
  const store = (conversationId: string, approved: boolean, demo = false) => db.prepare(
    "INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,'alice','retreat','transport',?,?) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json",
  ).run(canonicalWorkspaceTool({ accountId: "alice", roomId: "retreat", conversationId }, "transport"), JSON.stringify({ input, result, approved, demo }), now.toISOString());
  store("second", true);
  store("initial-retreat", false);
  expect(byKey(await (await endpoint()).json(), "transport").status).toBe("needs_review");
  store("initial-retreat", true, true);
  expect(byKey(await (await endpoint()).json(), "transport").status).toBe("needs_review");
  store("initial-retreat", true);
  const output = await (await endpoint("roomId=retreat&conversationId=second")).json();
  expect(byKey(output, "transport")).toMatchObject({ status: "confirmed", evidence: "transport" });
  expect(JSON.stringify(output)).not.toContain("PRIVATE_PARTICIPANT");
});

it("blocks a notice when saved main-event dates conflict or location is a placeholder", async () => {
  calendar([{ location: "가상 장소 A" }, { date: "2027-08-22", location: "장소 협의 중" }]);
  const result = await (await endpoint()).json();
  expect(byKey(result, "date")).toMatchObject({ status: "needs_review", reason: "conflicting_records" });
  expect(byKey(result, "venue").status).toBe("needs_review");
  expect(result.deferred.map(({ id }: { id: string }) => id)).toContain("draft-confirmed-notice");
});

it("handles a long saved location conservatively without failing the whole review", async () => {
  calendar([{ location: "가".repeat(300) }]);
  const response = await endpoint();
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(byKey(result, "date").status).toBe("confirmed");
  expect(byKey(result, "venue")).toMatchObject({ status: "needs_review", evidence: "calendar" });
});

it("does not ignore a conflicting overlong venue when another venue is short", async () => {
  calendar([{ location: "가상 장소 A" }, { location: "가".repeat(300) }]);
  const result = await (await endpoint()).json();
  expect(byKey(result, "venue")).toMatchObject({ status: "needs_review", reason: "conflicting_records" });
  expect(result.deferred.map(({ id }: { id: string }) => id)).toContain("draft-confirmed-notice");
});

it("blocks an old notice completion if its calendar prerequisites disappeared", async () => {
  checklist("alice", "initial-retreat", [{ title: "확정 공지문 초안 작성" }]);
  const result = await (await endpoint()).json();
  expect(result.deferred.map(({ id }: { id: string }) => id)).toContain("draft-confirmed-notice");
});

it("does not infer water activity from a topic alone or confirm a responsibility from a completion marker", async () => {
  checklist("alice", "initial-retreat", [{ title: "물놀이 계획" }]);
  const first = await (await endpoint()).json();
  expect(byKey(first, "water-activity").status).toBe("needs_review");
  expect(byKey(first, "water-safety")).toBeUndefined();
  checklist("alice", "second", [{ title: "물놀이 진행 확정" }, { title: "물놀이 안전 담당", owner: "미지정" }]);
  const second = await (await endpoint("roomId=retreat&conversationId=second")).json();
  expect(byKey(second, "water-activity").value).toBe(true);
  expect(byKey(second, "water-safety").status).toBe("needs_review");
  expect(second.next[0].id).toBe("check-water-safety");
});

it("refuses an old tab's review when its cookie changed to another account with the same initial conversation", async () => {
  checklist("bob", "initial-retreat", [{ title: "식사 계획" }]);
  const response = await endpoint(undefined, bob, { "x-preparation-account": "alice" });
  expect(response.status).toBe(409);
  expect(await response.json()).not.toHaveProperty("fields");
});

it("denies missing permissions, other users' conversations, other event types and malformed input", async () => {
  expect((await endpoint(undefined, "")).status).toBe(401);
  expect((await endpoint(undefined, session("no-calendar", permissions.filter(item => item !== "viewCalendar")), { "x-preparation-account": "no-calendar" })).status).toBe(403);
  expect((await endpoint(undefined, session("no-checklist", permissions.filter(item => item !== "viewChecklist")), { "x-preparation-account": "no-checklist" })).status).toBe(403);
  expect((await endpoint("roomId=retreat&conversationId=second", bob)).status).toBe(404);
  expect((await endpoint("roomId=other&conversationId=initial-other")).status).toBe(404);
  for (const extra of ["&accountId=bob", "&meeting=yes", "&roomId=other"]) {
    expect((await endpoint("roomId=retreat&conversationId=initial-retreat" + extra)).status).toBe(400);
  }
  expect((await endpoint(undefined, alice, { "sec-fetch-site": "cross-site" })).status).toBe(403);
});
