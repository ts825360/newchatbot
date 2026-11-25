import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ServerRecord, ServerSnapshot, ServerWrite } from "../backend-contract";
import type { LobbyRoom } from "../room-catalog";
import type { CalendarEvent, Permission, UserProfile } from "../types";
import { roomDateLabel, validDate } from "../room-timing";
import { getDatabase, transaction, bumpRevision } from "./database";
import { profileFor, requirePermission, type Actor } from "./auth";
import { ApiError } from "./http";
import { id, object, text, validateRecord } from "./record-schema";
import { conversationHistoryKey, privateToolKey, privateToolKinds, type ConversationScope, type PrivateToolKind } from "../conversation-scope";
import { canonicalConversationHistory, canonicalPrivateTool, conversationIds, requireOwnedConversation } from "./conversation-scope";

type Location = { canonical: string; kind: string; ownerId: string | null; roomId: string | null; scope?: ConversationScope };
const catalogKey = (actor: Actor) => `church-planner-room-catalog-v1:${actor.id}`;
const enc = encodeURIComponent;
const noData = (key: string): ServerRecord => ({ key, value: null, version: "0" });
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { throw new ApiError(400, "자료 식별자를 확인해 주세요."); } };

export function locateRecord(actor: Actor, key: string): Location {
  if (!text(key, 500)) throw new ApiError(400, "자료 키를 확인해 주세요.");
  if (key === catalogKey(actor)) return { canonical: `catalog:${actor.id}`, kind: "catalog", ownerId: actor.id, roomId: null };
  if (key === `church-personal-categories-v1:${actor.id}`) return { canonical: `categories:${actor.id}`, kind: "categories", ownerId: actor.id, roomId: null };
  const calendar = key.match(/^church-preparation-v1:([^:]+):events$/);
  if (calendar) {
    const roomId = decode(calendar[1]);
    if (id(roomId)) return { canonical: `preparation:${roomId}:events`, kind: "events", ownerId: null, roomId };
  }
  const history = key.match(/^church-planner-conversations-v1:([^:]+):([^:]+)$/);
  if (history) {
    const roomId = decode(history[2]);
    if (id(roomId) && decode(history[1]) === actor.id) return { canonical: canonicalConversationHistory(actor.id, roomId), kind: "conversations", ownerId: actor.id, roomId };
  }
  const privateKey = key.match(/^church-private-v1:([^:]+):([^:]+):([^:]+):([^:]+)$/);
  if (privateKey && decode(privateKey[1]) === actor.id && privateToolKinds.includes(privateKey[4] as PrivateToolKind)) {
    const roomId = decode(privateKey[2]), conversationId = decode(privateKey[3]), kind = privateKey[4] as PrivateToolKind;
    if (id(roomId) && id(conversationId)) {
      const scope = { accountId: actor.id, roomId, conversationId };
      return { canonical: canonicalPrivateTool(scope, kind), kind, ownerId: actor.id, roomId, scope };
    }
  }
  throw new ApiError(403, "자료에 접근할 권한이 없습니다.");
}

function rooms(db: DatabaseSync): LobbyRoom[] { return db.prepare("SELECT data_json FROM rooms ORDER BY rowid DESC").all().map((r) => JSON.parse(String(r.data_json))); }
function readCatalog(actor: Actor, db: DatabaseSync): ServerRecord {
  const row = db.prepare("SELECT data_json,revision FROM records WHERE key=?").get(`catalog:${actor.id}`);
  const preferences = row ? JSON.parse(String(row.data_json)) : { selectedRoomId: null, pinnedIds: [] };
  const pinned = new Map<string, number>((preferences.pinnedIds as string[] | undefined ?? []).map((id, index) => [id, index]));
  const list = rooms(db).map(({ location: _location, placeId: _placeId, ...r }) => ({ ...r, location: "", pinned: pinned.has(r.id),
    memberCount: Number(db.prepare("SELECT COUNT(*) n FROM room_visits v JOIN users u ON u.id=v.user_id WHERE v.room_id=? AND u.suspended=0 AND (u.access_expires_at IS NULL OR u.access_expires_at>?)").get(r.id, new Date().toISOString())!.n) }));
  list.sort((a, b) => (pinned.get(a.id) ?? pinned.size) - (pinned.get(b.id) ?? pinned.size));
  const rv = db.prepare("SELECT value FROM meta WHERE key='rooms_revision'").get()?.value ?? 0;
  return { key: catalogKey(actor), version: `${rv}:${row?.revision ?? 0}`, value: JSON.stringify({ rooms: list, selectedRoomId: list.some((r) => r.id === preferences.selectedRoomId) ? preferences.selectedRoomId : null }) };
}

export function readSnapshot(actor: Actor, roomId?: string, db = getDatabase(), conversationId?: string): ServerSnapshot {
  requirePermission(actor, "viewRoom");
  const catalog = readCatalog(actor, db);
  const list: LobbyRoom[] = JSON.parse(catalog.value!).rooms;
  if (roomId && !list.some((r) => r.id === roomId)) throw new ApiError(404, "행사방이 삭제되었거나 존재하지 않습니다.");
  const profile: UserProfile = { ...profileFor(actor), roomIds: list.map((r) => r.id) };
  const keys = [catalog.key, `church-personal-categories-v1:${actor.id}`];
  if (roomId) {
    keys.push(`church-preparation-v1:${enc(roomId)}:events`);
    if (actor.permissions.includes("chat")) {
      keys.push(conversationHistoryKey(actor.id, roomId));
      if (conversationId) {
        const scope = { accountId: actor.id, roomId, conversationId };
        requireOwnedConversation(db, scope);
        keys.push(...privateToolKinds.map((kind) => privateToolKey(scope, kind)));
      }
    }
  }
  const records = keys.map((key) => {
    if (key === catalog.key) return catalog;
    const location = locateRecord(actor, key);
    const row = db.prepare("SELECT data_json,revision FROM records WHERE key=? AND owner_id IS ?").get(location.canonical, location.ownerId);
    return row ? { key, value: String(row.data_json), version: String(row.revision) } : noData(key);
  });
  return { records, profile, activeRoomId: JSON.parse(catalog.value!).selectedRoomId };
}

const categories = ["retreat", "revival", "sports", "worship", "celebration", "other"];
function validateRoom(room: unknown): asserts room is LobbyRoom {
  if (!object(room) || !id(room.id) || !text(room.name, 60) || !categories.includes(room.category) || !text(room.location, 100, true) || !text(room.description, 300, true) || !text(room.otherDetail, 40, true) || room.category === "other" && !room.otherDetail.trim() || !(room.date === null || validDate(room.date)) || !(room.endDate === null || validDate(room.endDate) && room.date && room.endDate >= room.date) || room.endDate && !room.date) throw new ApiError(400, "행사 이름·종류·기간·장소를 확인해 주세요.");
  if (typeof room.pinned !== "boolean") throw new ApiError(400, "행사 고정 상태를 확인해 주세요.");
}
function saveRow(db: DatabaseSync, location: Location, value: unknown) {
  db.prepare(`INSERT INTO records(key,owner_id,room_id,kind,data_json,revision,updated_at) VALUES(?,?,?,?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1,updated_at=excluded.updated_at`).run(location.canonical, location.ownerId, location.roomId, location.kind, JSON.stringify(value), new Date().toISOString());
}
function saveCatalog(actor: Actor, value: unknown, db: DatabaseSync) {
  if (!object(value) || !Array.isArray(value.rooms) || value.rooms.length > 500 || !(value.selectedRoomId === null || typeof value.selectedRoomId === "string")) throw new ApiError(400, "행사방 목록을 확인해 주세요.");
  value.rooms.forEach(validateRoom);
  const next = value.rooms as LobbyRoom[];
  if (new Set(next.map((r) => r.id)).size !== next.length || new Set(next.map((r) => r.name.trim().toLowerCase())).size !== next.length || value.selectedRoomId && !next.some((r) => r.id === value.selectedRoomId)) throw new ApiError(400, "중복 행사방이나 선택한 행사를 확인해 주세요.");
  const existing = rooms(db); const byId = new Map(existing.map((r) => [r.id, r]));
  let roomChanged = false;
  for (const previous of existing) if (!next.some((r) => r.id === previous.id)) { requirePermission(actor, "createRoom"); db.prepare("DELETE FROM rooms WHERE id=?").run(previous.id); roomChanged = true; }
  for (const submitted of next) {
    const previous = byId.get(submitted.id);
    const fields = (r: LobbyRoom) => ({ name: r.name.trim(), category: r.category, date: r.date, endDate: r.endDate ?? r.date, description: r.description.trim(), otherDetail: r.otherDetail.trim() });
    const changed = !previous || JSON.stringify(fields(previous)) !== JSON.stringify(fields(submitted));
    if (!changed) continue;
    requirePermission(actor, previous ? "editRoom" : "createRoom");
    const room: LobbyRoom = { ...(previous ?? submitted), ...fields(submitted), location: previous?.location ?? "", placeId: previous?.placeId, dateLabel: roomDateLabel(submitted.date, submitted.endDate), owner: previous?.owner ?? actor.name, ownerId: previous?.ownerId ?? actor.id, createdAt: previous?.createdAt ?? new Date().toISOString(), memberCount: previous?.memberCount ?? 1, pinned: false, unreadChanges: 0, riskCount: previous?.riskCount ?? 0, icon: submitted.name.slice(0, 1), dDay: "", status: submitted.date ? "needsPreparation" : "needsDate", lastChange: `${actor.name}님이 행사 정보를 수정했습니다.` };
    db.prepare("INSERT INTO rooms(id,data_json,revision) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,revision=revision+1").run(room.id, JSON.stringify(room)); roomChanged = true;
  }
  if (roomChanged) db.prepare("INSERT INTO meta(key,value) VALUES('rooms_revision',1) ON CONFLICT(key) DO UPDATE SET value=value+1").run();
  saveRow(db, { canonical: `catalog:${actor.id}`, kind: "catalog", ownerId: actor.id, roomId: null }, { selectedRoomId: value.selectedRoomId, pinnedIds: next.filter((r) => r.pinned).map((r) => r.id) });
  if (value.selectedRoomId) db.prepare("INSERT INTO room_visits(room_id,user_id,last_seen_at) VALUES(?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at").run(value.selectedRoomId, actor.id, new Date().toISOString());
}

function permissionFor(kind: string): Permission | null {
  return ({ documents: "uploadDocument", checklist: "editChecklist", events: "editEvent", decisions: "editChecklist", risks: "editChecklist", transport: "editChecklist", conversations: "chat", location: "chat" } as Record<string, Permission>)[kind] ?? null;
}
function sameFile(row: any, file: any) { return row && row.name === file.name && Number(row.size) === file.size && row.mime === file.type; }
function saveRecord(actor: Actor, location: Location, value: any, db: DatabaseSync) {
  const permission = permissionFor(location.kind);
  if (permission) requirePermission(actor, permission);
  if (location.scope) {
    requirePermission(actor, "chat");
    requireOwnedConversation(db, location.scope);
  }
  if (location.roomId && !db.prepare("SELECT id FROM rooms WHERE id=?").get(location.roomId)) throw new ApiError(404, "행사방이 삭제되었습니다.");
  validateRecord(location.kind, value);
  if (location.kind === "events" && !actor.permissions.includes("deleteEvent")) {
    const previous = db.prepare("SELECT data_json FROM records WHERE key=?").get(location.canonical);
    if (previous) {
      const nextIds = new Set((value.items as CalendarEvent[]).map(item => item.id));
      const previousItems = JSON.parse(String(previous.data_json)).items as CalendarEvent[];
      if (previousItems.some(item => !nextIds.has(item.id))) requirePermission(actor, "deleteEvent");
    }
  }
  if (location.kind === "categories" && value.some((c: any) => c.roomIds.some((rid: string) => !db.prepare("SELECT 1 FROM rooms WHERE id=?").get(rid)))) throw new ApiError(409, "분류에 포함한 행사방이 변경되었습니다.");
  if (location.kind === "documents") for (const document of value.items) if (document.kind === "file") {
    const scope = location.scope!;
    const row = db.prepare("SELECT name,mime,size FROM conversation_files WHERE owner_id=? AND room_id=? AND conversation_id=? AND document_id=?").get(scope.accountId, scope.roomId, scope.conversationId, document.id);
    if (!sameFile(row, document.file)) throw new ApiError(409, "파일 저장 정보가 자료 목록과 일치하지 않습니다.");
  }
  if (location.kind === "conversations") {
    const previous = db.prepare("SELECT data_json FROM records WHERE key=?").get(location.canonical);
    const originals = new Map<string, any>();
    if (previous) for (const c of JSON.parse(String(previous.data_json)).conversations) for (const m of c.messages) if (m.sender === "assistant") originals.set(`${c.id}:${m.id}`, m);
    for (const c of value.conversations) for (const m of c.messages) if (m.sender === "assistant" && JSON.stringify(originals.get(`${c.id}:${m.id}`)) !== JSON.stringify(m)) throw new ApiError(400, "모델 미연결 상태에서 AI 답변을 생성할 수 없습니다.");
    const remaining = new Set(value.conversations.map((c: { id: string }) => c.id));
    for (const conversationId of conversationIds(db, actor.id, location.roomId!)) {
      if (remaining.has(conversationId)) continue;
      const scope = { accountId: actor.id, roomId: location.roomId!, conversationId };
      for (const kind of privateToolKinds) db.prepare("DELETE FROM records WHERE key=? AND owner_id=?").run(canonicalPrivateTool(scope, kind), actor.id);
      db.prepare("DELETE FROM conversation_files WHERE owner_id=? AND room_id=? AND conversation_id=?").run(actor.id, scope.roomId, conversationId);
    }
  }
  saveRow(db, location, value);
}

export function writeBatch(actor: Actor, writes: ServerWrite[], roomId?: string, db = getDatabase()): ServerSnapshot {
  requirePermission(actor, "viewRoom");
  if (!Array.isArray(writes) || writes.length < 1 || writes.length > 30 || new Set(writes.map((w) => w?.key)).size !== writes.length) throw new ApiError(400, "저장할 자료 목록을 확인해 주세요.");
  const payload = writes.map((w) => {
    if (!object(w) || !text(w.key, 500) || typeof w.value !== "string" || w.value.length > 2_000_000 || !text(w.version, 80)) throw new ApiError(400, "자료 크기·버전을 확인해 주세요.");
    let value: unknown; try { value = JSON.parse(w.value); } catch { throw new ApiError(400, "자료 JSON 형식을 확인해 주세요."); }
    return { ...w, location: locateRecord(actor, w.key), value };
  });
  if (new Set(payload.map((w) => w.location.canonical)).size !== payload.length) throw new ApiError(400, "같은 자료를 가리키는 중복 요청입니다.");
  return transaction(db, () => {
    for (const w of payload) {
      const version = w.location.kind === "catalog" ? readCatalog(actor, db).version : String(db.prepare("SELECT revision FROM records WHERE key=?").get(w.location.canonical)?.revision ?? 0);
      if (version !== w.version) throw new ApiError(409, "다른 기기에서 자료가 변경되었습니다. 내 변경을 보관하고 최신 자료를 확인해 주세요.");
    }
    for (const w of payload.filter((p) => p.location.kind === "catalog")) saveCatalog(actor, w.value, db);
    for (const w of payload.filter((p) => p.location.kind !== "catalog" && p.location.kind !== "conversations")) saveRecord(actor, w.location, w.value, db);
    for (const w of payload.filter((p) => p.location.kind === "conversations")) saveRecord(actor, w.location, w.value, db);
    bumpRevision(db);
    const shared = payload.filter((w) => !w.location.ownerId || w.location.kind === "catalog");
    if (shared.length) db.prepare("INSERT INTO activities(id,actor_id,action,target,at) VALUES(?,?,?,?,?)").run(randomUUID(), actor.id, "자료 저장", shared.map((w) => `${w.location.kind}${w.location.roomId ? `:${w.location.roomId}` : ""}`).join(","), new Date().toISOString());
    const output = readSnapshot(actor, roomId && db.prepare("SELECT id FROM rooms WHERE id=?").get(roomId) ? roomId : undefined, db);
    output.written = payload.map((w) => {
      if (w.location.kind === "catalog") return readCatalog(actor, db);
      const row = db.prepare("SELECT data_json,revision FROM records WHERE key=?").get(w.location.canonical)!;
      return row ? { key: w.key, value: String(row.data_json), version: String(row.revision) } : noData(w.key);
    });
    return output;
  });
}

export function seedDevelopmentRooms(db = getDatabase()) {
  if (process.env.NODE_ENV !== "development" || db.prepare("SELECT 1 FROM meta WHERE key='rooms_initialized'").get()) return;
  transaction(db, () => {
    if (!db.prepare("SELECT 1 FROM rooms LIMIT 1").get()) {
      const seed: LobbyRoom = { id: "development-retreat", name: "가상 수련회", category: "retreat", date: null, endDate: null, otherDetail: "", location: "", description: "", memberCount: 0, owner: "운영팀", ownerId: "development-manager", createdAt: new Date().toISOString(), icon: "수", dateLabel: "날짜 미정", dDay: "", status: "needsDate", pinned: false, unreadChanges: 0, riskCount: 0, lastChange: "가상 행사" };
      db.prepare("INSERT INTO rooms(id,data_json,revision) VALUES(?,?,1)").run(seed.id, JSON.stringify(seed));
    }
    db.prepare("INSERT INTO meta(key,value) VALUES('rooms_initialized',1) ON CONFLICT(key) DO NOTHING").run();
    db.prepare("INSERT INTO meta(key,value) VALUES('rooms_revision',1) ON CONFLICT(key) DO NOTHING").run();
  });
}
