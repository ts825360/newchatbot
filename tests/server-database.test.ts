// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, transaction, bumpRevision } from "@/lib/server/database";
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });
describe("server SQLite foundation", () => {
  it("creates typed durable resource tables and rolls back an atomic batch", () => {
    const db = createDatabase(":memory:"); databases.push(db);
    expect(() => transaction(db, () => { db.prepare("INSERT INTO meta(key,value) VALUES (?,?)").run("test", 1); throw new Error("rollback"); })).toThrow("rollback");
    expect(db.prepare("SELECT value FROM meta WHERE key=?").get("test")).toBeUndefined();
    expect(bumpRevision(db)).toBe(1); expect(bumpRevision(db)).toBe(2);
  });
  it("rejects invalid role escalation in invitations at the database layer", () => {
    const db = createDatabase(":memory:"); databases.push(db);
    expect(() => db.prepare("INSERT INTO invitations(id,label,grade,role,permissions_json,digest,issuer_id,created_at) VALUES (?,?,?,?,?,?,?,?)").run("i", "bad", 1, "owner", "[]", "hash", "issuer", "2026-11-17")).toThrow();
  });
});
