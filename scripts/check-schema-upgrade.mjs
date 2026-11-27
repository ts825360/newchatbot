import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../lib/server/database.ts";

// Reviewed main baseline. Read the DDL as text; do not execute historical JS.
const baseline = "7873305046286590d3fedf8913152b672afd9dcf";
const src = execFileSync("git", ["show", `${baseline}:lib/server/database.ts`], { encoding: "utf8" });
const schema = src.match(/^const schema = `([\s\S]*?)^`;/m)?.[1];
assert(schema);

const temp = realpathSync(tmpdir());
const dir = mkdtempSync(path.join(temp, "event-assistant-schema-"));
const file = path.join(dir, "synthetic.sqlite");
const time = "2026-01-01T00:00:00.000Z";
try {
  const before = new DatabaseSync(file);
  try {
    before.exec(schema);
    before.prepare("INSERT INTO users (id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("u1", "Synthetic admin", "synthetic-admin", 1, "Owner", "[]", "fixture-salt", "fixture-hash", time);
    before.prepare("INSERT INTO rooms (id,data_json) VALUES (?,?)").run("r1", JSON.stringify({ id: "r1", name: "Synthetic event" }));
    before.prepare("INSERT INTO records (key,owner_id,room_id,kind,data_json,updated_at) VALUES (?,?,?,?,?,?)")
      .run("synthetic-private", "u1", "r1", "transport", JSON.stringify({ approved: false }), time);
    assert.equal(before.prepare("SELECT name FROM sqlite_schema WHERE name='chat_work_versions'").get(), undefined);
  } finally { before.close(); }

  for (let pass = 0; pass < 2; pass++) {
    const db = createDatabase(file);
    try {
      const result = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('chat_work_versions','user_notifications') ORDER BY name").all();
      assert.deepEqual(result.map(row => row.name), ["chat_work_versions", "user_notifications"]);
      assert.equal(db.prepare("SELECT username FROM users WHERE id=?").get("u1").username, "synthetic-admin");
      const record = db.prepare("SELECT owner_id,room_id,revision,data_json FROM records WHERE key=?").get("synthetic-private");
      assert.deepEqual({ ...record }, { owner_id: "u1", room_id: "r1", revision: 1, data_json: '{"approved":false}' });
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally { db.close(); }
  }
  console.log("rc.14 -> current schema: additive tables, preserved synthetic records, idempotent startup, integrity and foreign keys OK.");
} finally {
  const resolved = realpathSync(dir);
  assert.equal(path.dirname(resolved), temp);
  assert(path.basename(resolved).startsWith("event-assistant-schema-"));
  rmSync(resolved, { recursive: true });
}
