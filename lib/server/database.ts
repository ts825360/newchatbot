import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const schema = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;
INSERT OR IGNORE INTO meta(key,value) VALUES ('change_revision',0);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 grade INTEGER NOT NULL CHECK(grade IN (1,2,3)), role TEXT NOT NULL,
 permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json)), salt TEXT NOT NULL,
 password_hash TEXT NOT NULL, access_expires_at TEXT, suspended INTEGER NOT NULL DEFAULT 0 CHECK(suspended IN (0,1)),
 session_version INTEGER NOT NULL DEFAULT 0, invite_id TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS invitations(
 id TEXT PRIMARY KEY, label TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade IN (2,3)), role TEXT NOT NULL,
 permissions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(permissions_json)), digest TEXT NOT NULL UNIQUE,
 signup_expires_at TEXT, access_expires_at TEXT, issuer_id TEXT NOT NULL, created_at TEXT NOT NULL,
 used_by TEXT, used_at TEXT, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
) STRICT;
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_version INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, data_json TEXT NOT NULL CHECK(json_valid(data_json)), revision INTEGER NOT NULL DEFAULT 1) STRICT;
CREATE TABLE IF NOT EXISTS room_visits(
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, last_seen_at TEXT NOT NULL,
 PRIMARY KEY(room_id,user_id)
) STRICT;
CREATE TABLE IF NOT EXISTS records(
 key TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE, kind TEXT NOT NULL,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)), revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS records_by_owner_room ON records(owner_id,room_id);
CREATE TABLE IF NOT EXISTS issue_reports(
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 request_id TEXT NOT NULL, reporter TEXT NOT NULL, category TEXT NOT NULL,
 description TEXT NOT NULL, context_json TEXT, created_at TEXT NOT NULL,
 mail_status TEXT NOT NULL CHECK(mail_status IN ('queued','sent','failed','unconfigured')),
 mail_attempts INTEGER NOT NULL DEFAULT 0, mail_first_at INTEGER, mail_next_at INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id,request_id)
) STRICT;
CREATE INDEX IF NOT EXISTS issue_reports_mail ON issue_reports(mail_status,mail_next_at);
CREATE INDEX IF NOT EXISTS issue_reports_user_time ON issue_reports(user_id,created_at);
CREATE TABLE IF NOT EXISTS google_oauth_attempts(
 state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS google_connections(
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 credentials TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS google_forms_auth(
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 generation TEXT NOT NULL, state_hash TEXT, session_hash TEXT,
 verifier TEXT, expires_at INTEGER, credentials TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS google_form_draft_auth(
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 generation TEXT NOT NULL, state_hash TEXT, session_hash TEXT,
 attempt TEXT, expires_at INTEGER, credentials TEXT,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
) STRICT;
CREATE TABLE IF NOT EXISTS google_form_drafts(
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 google_subject_hash TEXT NOT NULL, scope_key TEXT NOT NULL, title_hash TEXT NOT NULL,
 form_id TEXT, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1) AND (completed=0 OR form_id IS NOT NULL)),
 PRIMARY KEY(user_id,google_subject_hash,scope_key,title_hash)
) STRICT;
CREATE TABLE IF NOT EXISTS google_connection_generations(
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, generation INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS google_export_targets(
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_hash TEXT NOT NULL,
 calendar_id TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id,account_hash)
) STRICT;
CREATE TABLE IF NOT EXISTS google_exports(
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_hash TEXT NOT NULL,
 room_id TEXT NOT NULL, event_id TEXT NOT NULL, remote_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(user_id,account_hash,room_id,event_id)
) STRICT;
CREATE TABLE IF NOT EXISTS files(
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, document_id TEXT NOT NULL,
 uploader_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, mime TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 5242880), bytes BLOB NOT NULL,
 cleanup INTEGER NOT NULL DEFAULT 1 CHECK(cleanup IN (0,1)), created_at TEXT NOT NULL,
 PRIMARY KEY(room_id,document_id)
) STRICT;
CREATE TABLE IF NOT EXISTS conversation_files(
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL, document_id TEXT NOT NULL,
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 5242880),
 bytes BLOB NOT NULL, cleanup INTEGER NOT NULL DEFAULT 1 CHECK(cleanup IN (0,1)), created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,room_id,conversation_id,document_id)
) STRICT;
CREATE TABLE IF NOT EXISTS retreat_report_venues(
 owner_id TEXT NOT NULL, room_id TEXT NOT NULL, conversation_id TEXT NOT NULL, document_id TEXT NOT NULL,
 year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2099), name TEXT NOT NULL,
 features_json TEXT NOT NULL CHECK(json_valid(features_json)),
 PRIMARY KEY(owner_id,room_id,conversation_id,document_id),
 FOREIGN KEY(owner_id,room_id,conversation_id,document_id)
  REFERENCES conversation_files(owner_id,room_id,conversation_id,document_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS daily_devotions(
 day TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
 revision INTEGER NOT NULL, updated_at TEXT NOT NULL
) STRICT;
`;

export function createDatabase(filename: string): DatabaseSync {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 5000, enableForeignKeyConstraints: true, allowExtension: false });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA trusted_schema=OFF;");
  db.exec(schema);
  return db;
}

const connections = globalThis as typeof globalThis & { __churchDatabases?: Map<string, DatabaseSync> };
const checkedSchema = new WeakSet<DatabaseSync>();
export function getDatabase(): DatabaseSync {
  const directory = process.env.CHURCH_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".local", "server");
  const filename = path.join(/* turbopackIgnore: true */ directory, "church.sqlite");
  const cache = connections.__churchDatabases ??= new Map();
  let db = cache.get(filename);
  if (!db) { db = createDatabase(filename); cache.set(filename, db); checkedSchema.add(db); }
  else if (!checkedSchema.has(db)) {
    // Development reloads can reuse a connection that predates the new table.
    if (Number(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name IN ('conversation_files','google_forms_auth','google_form_draft_auth','google_form_drafts','retreat_report_venues','daily_devotions')").get()?.n) !== 6) db.exec(schema);
    checkedSchema.add(db);
  }
  return db;
}

export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    if (value && typeof value === "object" && "then" in value) throw new Error("Database transactions must be synchronous.");
    db.exec("COMMIT"); return value;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function bumpRevision(db: DatabaseSync): number {
  db.prepare("UPDATE meta SET value=value+1 WHERE key='change_revision'").run();
  return Number(db.prepare("SELECT value FROM meta WHERE key='change_revision'").get()!.value);
}
