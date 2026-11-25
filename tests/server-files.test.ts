// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "@/lib/server/database";
import type { Actor } from "@/lib/server/auth";
import {
  deleteFile, getFile, isFileReferenced, listFileCleanup, putFile, queueFileCleanup, retireFileCleanup,
  MAX_ROOM_FILE_BYTES, MAX_ROOM_FILE_COUNT, fileContentDisposition
} from "@/lib/server/files";

let db: DatabaseSync;
const directories: string[] = [];
const editor: Actor = { id: "editor", name: "Editor", username: "editor", grade: 2, role: "editor", permissions: ["viewRoom", "chat", "uploadDocument"], accessExpiresAt: null, sessionVersion: 0 };
const viewer: Actor = { ...editor, id: "viewer", username: "viewer", grade: 3, permissions: ["viewRoom", "chat"] };
const folder = (roomId: string, conversationId = `initial-${roomId}`) => ({ roomId, conversationId });
const bytes = new TextEncoder().encode("<script>not executed</script>");
function seed(database: DatabaseSync) {
  for (const actor of [editor, viewer]) database.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(actor.id, actor.name, actor.username, actor.grade, actor.role, JSON.stringify(actor.permissions), "fixture", "fixture", "2026-11-17");
  for (const id of ["room-a", "room-b"]) database.prepare("INSERT INTO rooms(id,data_json) VALUES (?,?)").run(id, JSON.stringify({ id }));
}
function reference(id: string, room = "room-a") {
  const file = getFile(editor, folder(room), id, db)!;
  db.prepare("INSERT INTO records(key,room_id,owner_id,kind,data_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json")
    .run(`private-v1:${editor.id}:${room}:initial-${room}:documents`, room, editor.id, "documents", JSON.stringify({ version: 1, items: [{ id, title: file.name, kind: "file", pinned: false, file: { name: file.name, type: file.mime, size: file.size } }] }), "2026-11-17");
}
beforeEach(() => { db = createDatabase(":memory:"); seed(db); });
afterEach(() => { db.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("authenticated SQLite files", () => {
  it("stages bytes and cleanup intent together with canonical MIME and composite room keys", () => {
    putFile(editor, folder("room-a"), "same", "notes.MD", bytes, db);
    putFile(editor, folder("room-b"), "same", "other.txt", new Uint8Array([1]), db);
    expect(listFileCleanup(editor, folder("room-a"), db)).toEqual(["same"]);
    expect(getFile(editor, folder("room-a"), "same", db)).toMatchObject({ name: "notes.MD", mime: "text/plain", size: bytes.length, cleanup: 1 });
    expect([...getFile(editor, folder("room-a"), "same", db)!.bytes]).toEqual([...bytes]);
    expect(getFile(viewer, folder("room-a"), "same", db)).toBeUndefined();
    expect(getFile(editor, folder("room-b"), "same", db)!.size).toBe(1);
  });

  it("requires view/write permissions and existing rooms", () => {
    expect(() => putFile(viewer, folder("room-a"), "id", "x.txt", bytes, db)).toThrow();
    expect(() => putFile(editor, folder("missing"), "id", "x.txt", bytes, db)).toThrow();
    putFile(editor, folder("room-a"), "id", "x.txt", bytes, db);
    for (const action of [queueFileCleanup, retireFileCleanup, deleteFile]) expect(() => action(viewer, folder("room-a"), "id", db)).toThrow();
    expect(() => getFile({ ...viewer, permissions: [] }, folder("room-a"), "id", db)).toThrow();
    expect(listFileCleanup(viewer, folder("room-a"), db)).toEqual([]);
    expect(isFileReferenced(viewer, folder("room-b"), "id", db)).toBe(false);
    expect(getFile(viewer, folder("room-b"), "id", db)).toBeUndefined();
  });

  it("refuses overwrites, including staged uploads and live files with queued cleanup", () => {
    putFile(editor, folder("room-a"), "id", "first.txt", bytes, db);
    expect(() => putFile(editor, folder("room-a"), "id", "second.txt", new Uint8Array([2]), db)).toThrow();
    reference("id");
    retireFileCleanup(editor, folder("room-a"), "id", db);
    queueFileCleanup(editor, folder("room-a"), "id", db);
    expect(() => putFile(editor, folder("room-a"), "id", "second.txt", bytes, db)).toThrow();
    expect(getFile(editor, folder("room-a"), "id", db)!.name).toBe("first.txt");
    expect(listFileCleanup(editor, folder("room-a"), db)).toEqual(["id"]);
  });

  it("checks current canonical references inside the deletion transaction, not a prior result", () => {
    putFile(editor, folder("room-a"), "id", "live.txt", bytes, db);
    expect(isFileReferenced(editor, folder("room-a"), "id", db)).toBe(false);
    reference("id");
    expect(() => deleteFile(editor, folder("room-a"), "id", db)).toThrow();
    expect(getFile(editor, folder("room-a"), "id", db)).toBeDefined();
    expect(listFileCleanup(editor, folder("room-a"), db)).toEqual(["id"]);
    expect(isFileReferenced(editor, folder("room-a"), "id", db)).toBe(true);
  });

  it("keeps pending cleanup after a failed metadata edit and retires only a live file", () => {
    putFile(editor, folder("room-a"), "id", "live.txt", bytes, db);
    expect(() => retireFileCleanup(editor, folder("room-a"), "id", db)).toThrow();
    reference("id");
    retireFileCleanup(editor, folder("room-a"), "id", db);
    queueFileCleanup(editor, folder("room-a"), "id", db);
    queueFileCleanup(editor, folder("room-a"), "id", db);
    expect(() => deleteFile(editor, folder("room-a"), "id", db)).toThrow();
    expect(listFileCleanup(editor, folder("room-a"), db)).toEqual(["id"]);
    db.prepare("UPDATE records SET data_json=? WHERE key=?").run('{"version":1,"items":[]}', "private-v1:editor:room-a:initial-room-a:documents");
    deleteFile(editor, folder("room-a"), "id", db);
    deleteFile(editor, folder("room-a"), "id", db);
    queueFileCleanup(editor, folder("room-a"), "id", db);
    retireFileCleanup(editor, folder("room-a"), "id", db);
    expect(listFileCleanup(editor, folder("room-a"), db)).toEqual([]);
    expect(getFile(editor, folder("room-a"), "id", db)).toBeUndefined();
  });

  it("fails closed when canonical document metadata is malformed or has the wrong scope", () => {
    putFile(editor, folder("room-a"), "id", "live.txt", bytes, db);
    reference("id");
    db.prepare("UPDATE records SET data_json=? WHERE key=?").run('{"version":1,"items":{}}', "private-v1:editor:room-a:initial-room-a:documents");
    expect(() => deleteFile(editor, folder("room-a"), "id", db)).toThrow();
    db.prepare("UPDATE records SET room_id=? WHERE key=?").run("room-b", "private-v1:editor:room-a:initial-room-a:documents");
    expect(() => isFileReferenced(editor, folder("room-a"), "id", db)).toThrow();
    expect(getFile(editor, folder("room-a"), "id", db)).toBeDefined();
  });

  it("allows idempotent cleanup after a room was deleted without recreating it", () => {
    putFile(editor, folder("room-a"), "id", "live.txt", bytes, db);
    db.prepare("DELETE FROM rooms WHERE id=?").run("room-a");
    deleteFile(editor, folder("room-a"), "id", db);
    queueFileCleanup(editor, folder("room-a"), "id", db);
    retireFileCleanup(editor, folder("room-a"), "id", db);
    expect(listFileCleanup(editor, folder("room-a"), db)).toEqual([]);
    expect(isFileReferenced(editor, folder("room-a"), "id", db)).toBe(false);
    expect(() => getFile(editor, folder("room-a"), "id", db)).toThrow();
  });

  it.each(["../bad", "bad/part", "bad\\part", "", "x".repeat(129), "_journal"])("rejects invalid document ID %s", (id) => {
    expect(() => putFile(editor, folder("room-a"), id, "x.txt", bytes, db)).toThrow();
  });

  it.each(["evil.html", "bad\r\n.txt", "../x.txt", "a".repeat(256) + ".txt"])("rejects unsafe name %s", (name) => {
    expect(() => putFile(editor, folder("room-a"), "id", name, bytes, db)).toThrow();
  });

  it("enforces the 5 MiB limit and SQL room byte/count quotas including pending cleanup", () => {
    expect(() => putFile(editor, folder("room-a"), "too-big", "x.txt", new Uint8Array(5 * 1024 * 1024 + 1), db)).toThrow();
    const insert = db.prepare("INSERT INTO conversation_files(owner_id,room_id,conversation_id,document_id,name,mime,size,bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    for (let i = 0; i < MAX_ROOM_FILE_BYTES / (5 * 1024 * 1024); i++) insert.run(editor.id, "room-a", "initial-room-a", `fill-${i}`, "x.txt", "text/plain", 5 * 1024 * 1024, new Uint8Array(0), "fixture");
    expect(() => putFile(editor, folder("room-a"), "over-quota", "x.txt", new Uint8Array([1]), db)).toThrow();
    for (let i = 0; i < MAX_ROOM_FILE_COUNT; i++) insert.run(editor.id, "room-b", "initial-room-b", `empty-${i}`, "x.txt", "text/plain", 0, new Uint8Array(0), "fixture");
    expect(() => putFile(editor, folder("room-b"), "over-count", "x.txt", new Uint8Array(0), db)).toThrow();
  });

  it("persists staged bytes and cleanup state across a database restart in a dedicated fixture", () => {
    db.close();
    const directory = mkdtempSync(path.join(tmpdir(), "nowchatbot-files-")); directories.push(directory);
    const filename = path.join(directory, "fixture.sqlite");
    db = createDatabase(filename); seed(db);
    putFile(editor, folder("room-a"), "id", "notes.txt", bytes, db);
    db.close(); db = createDatabase(filename);
    expect(listFileCleanup(editor, folder("room-a"), db)).toEqual(["id"]);
    expect([...getFile(editor, folder("room-a"), "id", db)!.bytes]).toEqual([...bytes]);
  });

  it("encodes Unicode and quotes safely in attachment disposition", () => {
    const header = fileContentDisposition('주일 "일정".pdf');
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(header).toContain(encodeURIComponent('주일 "일정".pdf'));
    expect(header).not.toMatch(/[\r\n]/);
  });
});
