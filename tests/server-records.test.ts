// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/server/database";
import { readSnapshot, writeBatch } from "@/lib/server/records";
import { createRoomCatalog } from "@/lib/room-catalog";
import { defaultProfile } from "@/lib/mock-data";
import type { Actor } from "@/lib/server/auth";
import type { DatabaseSync } from "node:sqlite";
import { privateToolKey, privateToolKinds } from "@/lib/conversation-scope";
import { createTransportDraft } from "@/lib/transport";
import { putFile, getFile } from "@/lib/server/files";
import { canonicalPrivateTool } from "@/lib/server/conversation-scope";
import { loadPreparationStatus } from "@/lib/server/preparation-status";
import { readPublicEventVenue } from "@/lib/server/chat-venue-tool";
import { readPreparationFacts } from "@/lib/server/chat-preparation-tool";
import { readPreparationSurveyCounts } from "@/lib/server/preparation-surveys";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup() {
  const db = createDatabase(":memory:"); databases.push(db);
  const actor: Actor = { id: "manager", name: "가상 관리자", username: "manager", grade: 2, role: "행사 운영", permissions: [...defaultProfile.permissions, "createRoom", "editRoom", "uploadDocument"], accessExpiresAt: null, sessionVersion: 0 };
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(actor.id, actor.name, actor.username, 2, actor.role, JSON.stringify(actor.permissions), "unused", "unused", new Date().toISOString());
  const initial = readSnapshot(actor, undefined, db);
  const key = `church-planner-room-catalog-v1:${actor.id}`;
  const base = initial.records.find((r) => r.key === key)!;
  const room = { ...createRoomCatalog({ getItem: () => null, setItem() {} }, defaultProfile).load().rooms[0], id: "room-1", name: "가상 행사" };
  writeBatch(actor, [{ key, version: base.version, value: JSON.stringify({ rooms: [room], selectedRoomId: room.id }) }], room.id, db);
  return { db, actor, key, room };
}
describe("authoritative shared/private records", () => {
  it("limits survey counts and AI place facts to authorized scope without sending private notes or aliases", () => {
    const { db, actor, room } = setup();
    const scope = { accountId: actor.id, roomId: room.id, conversationId: `initial-${room.id}` };
    const key = privateToolKey(scope, "location");
    readSnapshot(actor, room.id, db, scope.conversationId);
    writeBatch(actor, [{ key, version: "0", value: JSON.stringify({ location: "PRIVATE_ALIAS", places: ["PRIVATE_ALIAS"],
      placeMetadata: [{ name: "PRIVATE_ALIAS", category: "lodging", googlePlaceId: "ChIJ_TEST_MAPS_ID", privateMemo: { text: "PRIVATE_COMMENT", authorId: actor.id, updatedAt: "2026-11-27T00:00:00.000Z" } }] }) }], room.id, db);
    const forms = db.prepare("INSERT INTO google_form_drafts(user_id,google_subject_hash,scope_key,title_hash,form_id,completed) VALUES(?,?,?,?,?,?)");
    forms.run(actor.id, "hash", JSON.stringify([room.id, scope.conversationId]), "own", "form", 1);
    forms.run(actor.id, "hash", JSON.stringify([room.id, scope.conversationId]), "unfinished", "form2", 0);
    forms.run(actor.id, "hash", JSON.stringify([room.id, "other"]), "other", "form3", 1);
    expect(readPreparationSurveyCounts(db, actor, scope)).toEqual({ drafts: 0, forms: 1 });
    expect(() => readPreparationSurveyCounts(db, { ...actor, permissions: ["viewRoom"] }, scope)).toThrow();
    const facts = readPreparationFacts(db, actor, scope);
    expect(facts.venue).toMatchObject({ state: "saved", count: 1, categories: { lodging: 1 }, privateNotesIncluded: false });
    expect(facts.survey).toMatchObject({ forms: 1, drafts: 0 });
    expect(JSON.stringify(facts)).not.toMatch(/PRIVATE_ALIAS|PRIVATE_COMMENT|ChIJ_TEST_MAPS_ID/);
  });
  it("projects only the viewer's primary venue and the assigned owner's live display name into the catalog", () => {
    const { db, actor, room } = setup();
    const peer: Actor = { ...actor, id: "peer", name: "다른 담당자", username: "another-login", grade: 2 };
    db.prepare("INSERT INTO users SELECT ?,?,?,grade,role,permissions_json,salt,password_hash,access_expires_at,suspended,session_version,invite_id,created_at FROM users WHERE id=?").run(peer.id, peer.name, peer.username, actor.id);
    const other = { ...room, id: "other-room", name: "별도 행사", ownerId: peer.id, owner: "이전 이름" };
    db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run(other.id, JSON.stringify(other));
    db.prepare("UPDATE users SET name=? WHERE id=?").run("새 담당자 이름", actor.id);
    const scope = { accountId: actor.id, roomId: room.id, conversationId: "initial-room-1" };
    const location = privateToolKey(scope, "location");
    const venue = "한화리조트 대천 파로스";
    const catalog = (who: Actor) => JSON.parse(readSnapshot(who, undefined, db).records[0].value!).rooms;
    const placeWrite = (value: unknown, version: string) => writeBatch(actor, [{ key: location, value: JSON.stringify(value), version }], room.id, db);
    db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,?,?,?,?)").run(
      "private-v1:manager:room-1:legacy:location", actor.id, room.id, "location", JSON.stringify({ location: venue }), "2026-11-18");
    expect(catalog(actor).find(({ id }: { id: string }) => id === room.id)).toMatchObject({ location: venue, ownerId: actor.id, owner: "새 담당자 이름" });
    expect(catalog(peer).find(({ id }: { id: string }) => id === room.id)).toMatchObject({ location: "" });
    expect(catalog(actor).find(({ id }: { id: string }) => id === other.id)).toMatchObject({ location: "", ownerId: peer.id, owner: peer.name });
    expect(readPublicEventVenue(db, scope)?.name).toBe(venue);
    readSnapshot(actor, room.id, db, scope.conversationId);
    placeWrite({ location: "가상 새 장소", details: [{ name: "가상 새 장소", address: "PRIVATE_ADDRESS", notes: "PRIVATE_NOTE" }] }, "1");
    const next = catalog(actor);
    expect(next.find(({ id }: { id: string }) => id === room.id).location).toBe("가상 새 장소");
    expect(JSON.stringify(next)).not.toMatch(/PRIVATE_ADDRESS|PRIVATE_NOTE/);
    expect(readPublicEventVenue(db, scope)).toBeNull();
    expect(loadPreparationStatus(db, actor, scope).advisor?.rows[0].detail).toContain("장소 등록됨");
    placeWrite({ location: "" }, "2");
    expect(catalog(actor).find(({ id }: { id: string }) => id === room.id).location).toBe("");
    expect(readPublicEventVenue(db, scope)).toBeNull();
  });

  it("counts unique participating accounts with current access, not roster or other-room rows", () => {
    const { db, actor, key, room } = setup();
    const otherRoom = { ...room, id: "elsewhere", name: "다른 방" };
    db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run(otherRoom.id, JSON.stringify(otherRoom));
    const add = db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,access_expires_at,suspended,created_at) VALUES(?,?,?,3,'',?,'x','x',?,?,?)");
    const visit = db.prepare("INSERT INTO room_visits VALUES(?,?,?)");
    for (const [id, access, expires, suspended, rid] of [
      ["peer", '["viewRoom"]', null, 0, room.id],
      ["blocked", '["viewRoom"]', null, 1, room.id],
      ["expired", '["viewRoom"]', "2000-11-18", 0, room.id],
      ["restricted", '[]', null, 0, room.id],
      ["wrong-shape", '"viewRoom"', null, 0, room.id],
      ["outside", '["viewRoom"]', null, 0, otherRoom.id],
      ["unjoined", '["viewRoom"]', null, 0, null],
    ] as const) {
      add.run(id, id, id, access, expires, suspended, "2026-01-01");
      if (rid) visit.run(rid, id, "2026-01-01");
    }
    const current = () => readSnapshot(actor, undefined, db).records[0];
    const count = () => JSON.parse(current().value!).rooms.find(({ id }: { id: string }) => id === room.id).memberCount;
    expect(count()).toBe(2);
    writeBatch(actor, [{ key, version: current().version, value: current().value! }], room.id, db);
    expect(count()).toBe(2);
    db.prepare("UPDATE users SET permissions_json='[]' WHERE id='peer'").run();
    expect(count()).toBe(1);
    db.prepare("UPDATE users SET permissions_json='[\"viewRoom\"]' WHERE id='peer'").run();
    expect(count()).toBe(2);
    db.prepare("DELETE FROM room_visits WHERE room_id=? AND user_id=?").run(room.id, "peer");
    expect(count()).toBe(1);
  });
  it("restores favorite order only for the account that pinned the rooms", () => {
    const { db, actor, key, room } = setup();
    const other = { ...room, id: "room-2", name: "두 번째 방" };
    db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run(other.id, JSON.stringify(other));
    const current = readSnapshot(actor, undefined, db).records[0];
    writeBatch(actor, [{ key, version: current.version, value: JSON.stringify({ selectedRoomId: null, rooms: [room, other].map(r => ({ ...r, pinned: true })) }) }], undefined, db);
    expect(JSON.parse(readSnapshot(actor, undefined, db).records[0].value!).rooms.map((r: { id: string }) => r.id)).toEqual([room.id, other.id]);
    expect(JSON.parse(readSnapshot({ ...actor, id: "peer", grade: 3 }, undefined, db).records[0].value!).rooms.every((r: { pinned: boolean }) => !r.pinned)).toBe(true);
  });
  it("shares planning work across an account's conversations but not other rooms or accounts", () => {
    const { db, actor, room } = setup();
    const peer = { ...actor, id: "peer", username: "peer" };
    db.prepare("INSERT INTO users SELECT ?,name,?,grade,role,permissions_json,salt,password_hash,access_expires_at,suspended,session_version,invite_id,created_at FROM users WHERE id=?").run(peer.id, peer.username, actor.id);
    const conv = "initial-room-1";
    const now = new Date().toISOString();
    const conversations = [conv, "second"].map((id) => ({ id, title: id, draft: "", createdAt: now, updatedAt: now, messages: id === conv ? [{ id: "m", sender: "user", text: "PRIVATE_MESSAGE", time: "now" }] : [] }));
    const historyKey = `church-planner-conversations-v1:${actor.id}:${room.id}`;
    const scope = { accountId: actor.id, roomId: room.id, conversationId: conv };
    writeBatch(actor, [{ key: historyKey, version: "0", value: JSON.stringify({ conversations, activeId: conv }) }], room.id, db);
    putFile(actor, scope, "doc", "PRIVATE_FILE.txt", new Uint8Array([1]), db);
    const values = {
      location: { location: "PRIVATE_LOCATION" },
      transport: { input: { ...createTransportDraft(), extraCount: 7 }, result: null, baseline: null, approved: false },
      documents: { version: 1, items: [{ id: "doc", title: "PRIVATE_FILE.txt", kind: "file", pinned: false, file: { name: "PRIVATE_FILE.txt", type: "text/plain", size: 1 } }] },
      checklist: { version: 1, items: [{ id: "item", title: "PRIVATE_ITEM", owner: "", due: "", memo: "", status: "needsReview" }] },
      risks: { version: 1, items: [{ id: "r", title: "PRIVATE_RISK", detail: "detail", action: "action", resolved: false }] },
      decisions: { version: 1, items: [{ id: "d", status: "excluded", reason: "PRIVATE_DECISION" }] },
      timetable: { version: 1, days: 2, startDate: "", entries: [{ id: "t", title: "PRIVATE_TIMETABLE", day: 1, start: 540, end: 720, kind: "program" }] },
    };
    const calendarKey = "church-preparation-v1:room-1:events";
    const event = { id: "e", title: "SHARED_EVENT", date: "2026-11-19", time: "", location: "", memo: "", status: "confirmed", author: "Manager", lastEditor: "Manager", changeLog: "" };
    const writes = privateToolKinds.map((kind) => ({ key: privateToolKey(scope, kind), value: JSON.stringify(values[kind]), version: "0" }));
    writeBatch(actor, [...writes, { key: calendarKey, value: JSON.stringify({ version: 1, items: [event] }), version: "0" }], room.id, db);
    const own = readSnapshot(actor, room.id, db, conv);
    for (const write of writes) expect(own.records.find((record) => record.key === write.key)?.value).toBe(write.value);
    const other = readSnapshot(peer, room.id, db, conv);
    const second = readSnapshot(actor, room.id, db, "second");
    expect(other.records.filter((record) => record.key.startsWith("church-private-v1:")).every((record) => record.value === null)).toBe(true);
    const secondScope = { ...scope, conversationId: "second" };
    for (const kind of privateToolKinds) {
      const record = second.records.find(({ key }) => key === privateToolKey(secondScope, kind));
      expect(record?.value).toBe(kind === "documents" ? null : JSON.stringify(values[kind]));
    }
    const placeSummary = loadPreparationStatus(db, actor, secondScope).advisor?.rows[0].detail;
    expect(placeSummary).toContain("장소 등록됨");
    expect(placeSummary).not.toContain("PRIVATE_LOCATION");
    const anotherRoom = { ...room, id: "another-room" };
    db.prepare("INSERT INTO rooms(id,data_json) VALUES(?,?)").run(anotherRoom.id, JSON.stringify(anotherRoom));
    const elsewhere = readSnapshot(actor, anotherRoom.id, db, "initial-another-room");
    expect(elsewhere.records.filter(({ key }) => key.startsWith("church-private-v1:")).every(({ value }) => value === null)).toBe(true);
    expect(JSON.stringify(other)).not.toContain("PRIVATE_MESSAGE");
    expect(JSON.stringify(readSnapshot(actor, room.id, db))).not.toContain("PRIVATE_LOCATION");
    expect(other.records.find((record) => record.key === calendarKey)?.value).toContain("SHARED_EVENT");
    expect(own.records.find((record) => record.key === calendarKey)?.value).not.toContain("PRIVATE_TIMETABLE");
    expect(JSON.stringify(readSnapshot(actor, room.id, db))).not.toContain("PRIVATE_TIMETABLE");
    expect(second.records.find((record) => record.key === calendarKey)?.value).toContain("SHARED_EVENT");
    expect(getFile(peer, scope, "doc", db)).toBeUndefined();
    expect(getFile(actor, { ...scope, conversationId: "second" }, "doc", db)).toBeUndefined();
    expect(() => writeBatch(peer, [{ ...writes[0], version: "1" }], room.id, db)).toThrow();
    const timetable = writes.find((record) => record.key.endsWith(":timetable"))!;
    expect(() => writeBatch(peer, [{ ...timetable, version: "1" }], room.id, db)).toThrow();
    expect(() => writeBatch({ ...actor, permissions: actor.permissions.filter(p => p !== "editChecklist") }, [{ ...timetable, version: "1" }], room.id, db)).toThrow(/권한/);
    expect(() => readSnapshot(peer, room.id, db, "second")).toThrow();
    writeBatch(actor, [{ key: historyKey, version: "1", value: JSON.stringify({ conversations: conversations.slice(1), activeId: "second" }) }], room.id, db);
    expect(() => readSnapshot(actor, room.id, db, conv)).toThrow();
    expect(readSnapshot(actor, room.id, db, "second").records.find(({ key }) => key === privateToolKey(secondScope, "location"))?.value).toBe(JSON.stringify(values.location));
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversation_files").get()?.n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM records WHERE key LIKE 'private-v1:%'").get()?.n).toBe(0);
  });
  it("recovers an older nonempty planning record without reviving it after clearing", () => {
    const { db, actor, room } = setup();
    const active = { accountId: actor.id, roomId: room.id, conversationId: "initial-room-1" };
    const legacy = { ...active, conversationId: "older" };
    const revision = 2;
    const query = db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,revision,updated_at) VALUES(?,?,?,?,?,?,?)");
    query.run(canonicalPrivateTool(legacy, "location"), actor.id, room.id, "location", '{"location":"OLD_LOCATION"}', revision, "2026-11-01");
    query.run(canonicalPrivateTool(active, "location"), actor.id, room.id, "location", '{"location":""}', revision, "2026-11-02");
    const key = privateToolKey(active, "location");
    const current = () => readSnapshot(actor, room.id, db, active.conversationId).records.find(record => record.key === key)!;
    expect(current().value).toBe('{"location":"OLD_LOCATION"}');
    writeBatch(actor, [{ key, version: current().version, value: '{"location":""}' }], room.id, db);
    expect(current().value).toBe('{"location":""}');
    expect(db.prepare("SELECT data_json FROM records WHERE key=?").get(canonicalPrivateTool(legacy, "location"))?.data_json).toBe('{"location":"OLD_LOCATION"}');
  });
  it("preserves legacy room data without returning it in room snapshots", () => {
    const { db, actor, room } = setup();
    db.prepare("UPDATE rooms SET data_json=json_set(data_json,'$.location','OLD_LOCATION','$.placeId','OLD_PLACE_ID') WHERE id=?").run(room.id);
    db.prepare("INSERT INTO records(key,room_id,kind,data_json,updated_at) VALUES(?,?,?,?,?)").run("materials:room-1:checklist", room.id, "checklist", '{"legacy":"OLD_CHECKLIST"}', "2026-11-18");
    expect(JSON.stringify(readSnapshot(actor, room.id, db, "initial-room-1"))).not.toMatch(/OLD_/);
    expect(db.prepare("SELECT data_json FROM records WHERE key=?").get("materials:room-1:checklist")?.data_json).toContain("OLD_CHECKLIST");
    expect(() => writeBatch(actor, [{ key: "church-planner-room-materials-v1:room-1:checklist", version: "1", value: "{}" }], room.id, db)).toThrow();
  });
  it("persists private checklists with optimistic concurrency", () => {
    const { db, actor } = setup();
    const key = "church-private-v1:manager:room-1:initial-room-1:checklist";
    const value = JSON.stringify({ version: 1, items: [{ id: "item", title: "차량 확인", owner: "", due: "", memo: "", status: "needsReview" }] });
    writeBatch(actor, [{ key, version: "0", value }], "room-1", db);
    const next = readSnapshot(actor, "room-1", db, "initial-room-1").records.find((r) => r.key === key)!;
    expect(JSON.parse(next.value!).items[0].title).toBe("차량 확인");
    expect(() => writeBatch(actor, [{ key, version: "0", value }], "room-1", db)).toThrow(/다른|변경|충돌/);
  });
  it("counts real active accounts that have entered the room", () => {
    const { db, actor } = setup();
    const snapshot = readSnapshot(actor, "room-1", db);
    const catalog = JSON.parse(snapshot.records.find((r) => r.key.startsWith("church-planner-room-catalog-v1:"))!.value!);
    expect(catalog.rooms[0].memberCount).toBe(1);
    db.prepare("UPDATE users SET suspended=1 WHERE id=?").run(actor.id);
    expect(JSON.parse(readSnapshot(actor, "room-1", db).records[0]!.value!).rooms[0].memberCount).toBe(0);
  });
  it("rejects another account's private conversation key", () => {
    const { db, actor } = setup();
    expect(() => writeBatch(actor, [{ key: "church-planner-conversations-v1:someone-else:room-1", version: "0", value: JSON.stringify({ conversations: [], activeId: null }) }], "room-1", db)).toThrow();
  });
  it("rolls back all writes if one record is invalid", () => {
    const { db, actor } = setup();
    const good = { key: "church-private-v1:manager:room-1:initial-room-1:checklist", version: "0", value: JSON.stringify({ version: 1, items: [] }) };
    const bad = { key: "church-preparation-v1:room-1:events", version: "0", value: JSON.stringify({ version: 1, items: [{ id: "bad", title: "" }] }) };
    expect(() => writeBatch(actor, [good, bad], "room-1", db)).toThrow();
    expect(db.prepare("SELECT key FROM records WHERE kind='checklist'").all()).toHaveLength(0);
  });
  it("keeps non-calendar records outside a limited member's editing permissions", () => {
    const { db, actor } = setup();
    const viewer = { ...actor, grade: 3 as const, permissions: ["viewRoom", "viewCalendar", "viewChecklist"] as Actor["permissions"] };
    expect(readSnapshot(viewer, "room-1", db).records.length).toBeGreaterThan(0);
    expect(() => writeBatch(viewer, [{ key: "church-private-v1:manager:room-1:initial-room-1:checklist", version: "0", value: JSON.stringify({ version: 1, items: [] }) }], "room-1", db)).toThrow(/권한/);
  });
  it("lets members with baseline calendar access add and edit shared events, without allowing them to remove one", () => {
    const { db, actor, room } = setup();
    const member: Actor = { ...actor, id: "calendar-member", grade: 3, permissions: ["viewRoom", "viewCalendar", "createEvent", "editEvent"] };
    const key = `church-preparation-v1:${room.id}:events`;
    const event = { id: "meeting", title: "준비 회의", date: "2026-11-20", time: "", endTime: "", location: "", memo: "", status: "confirmed", author: "Manager", lastEditor: "Manager", changeLog: "" };
    const snapshot = (user: Actor) => readSnapshot(user, room.id, db).records.find(record => record.key === key)!;
    const write = (user: Actor, items: object[]) => writeBatch(user, [{ key, version: snapshot(user).version, value: JSON.stringify({ version: 1, items }) }], room.id, db);
    write(actor, [event]);
    const edited = { ...event, title: "다른 구성원이 수정한 회의" };
    const added = { ...event, id: "new", title: "추가 일정" };
    write(member, [edited, added]);
    expect(JSON.parse(snapshot(actor).value!).items).toEqual([edited, added]);
    expect(() => write(member, [added])).toThrow(/권한/);
    expect(() => write(member, [{ ...edited, id: "replacement" }, added])).toThrow(/권한/);
    expect(JSON.parse(snapshot(actor).value!).items).toEqual([edited, added]);
    write({ ...actor, permissions: [...actor.permissions, "deleteEvent"] }, [added]);
    expect(JSON.parse(snapshot(member).value!).items).toEqual([added]);
  });
  it("rejects aliases that target the same canonical resource in a single batch", () => {
    const { db, actor } = setup();
    const value = JSON.stringify({ version: 1, items: [] });
    expect(() => writeBatch(actor, [
      { key: "church-private-v1:manager:room-1:initial-room-1:checklist", version: "0", value },
      { key: "church-private-v1:manager:room%2D1:initial-room-1:checklist", version: "0", value },
    ], "room-1", db)).toThrow(/중복/);
  });
  it("does not persist a forged assistant answer while models are disabled", () => {
    const { db, actor } = setup();
    const now = new Date().toISOString();
    expect(() => writeBatch(actor, [{ key: `church-planner-conversations-v1:${actor.id}:room-1`, version: "0", value: JSON.stringify({ conversations: [{ id: "c", title: "질문", draft: "", createdAt: now, updatedAt: now, messages: [{ id: "m", sender: "assistant", text: "위조 답변", time: "방금 전" }] }], activeId: "c" }) }], "room-1", db)).toThrow(/AI/);
  });
  it("deletes room-owned records and blobs together", () => {
    const { db, actor, key } = setup();
    db.prepare("INSERT INTO files(room_id,document_id,uploader_id,name,mime,size,bytes,created_at) VALUES(?,?,?,?,?,?,?,?)").run("room-1", "file-1", actor.id, "a.txt", "text/plain", 1, new Uint8Array([65]), new Date().toISOString());
    const current = readSnapshot(actor, "room-1", db).records.find((r) => r.key === key)!;
    writeBatch(actor, [{ key, version: current.version, value: JSON.stringify({ rooms: [], selectedRoomId: null }) }], undefined, db);
    expect(db.prepare("SELECT * FROM files").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM rooms").all()).toHaveLength(0);
  });
});
