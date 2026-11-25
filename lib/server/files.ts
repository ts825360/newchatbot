import type { DatabaseSync } from "node:sqlite";
import { documentFileMetadata, isDocumentFileMetadata, MAX_DOCUMENT_FILE_SIZE, MAX_ROOM_FILE_BYTES, MAX_ROOM_FILE_COUNT } from "../document-files";
import type { ConversationScope } from "../conversation-scope";
import type { Permission } from "../types";
import { requirePermission, type Actor } from "./auth";
import { canonicalPrivateTool, requireOwnedConversation } from "./conversation-scope";
import { bumpRevision, getDatabase, transaction } from "./database";
import { ApiError } from "./http";
import { id } from "./record-schema";

export { MAX_ROOM_FILE_BYTES, MAX_ROOM_FILE_COUNT } from "../document-files";
export type StoredFile = { name: string; mime: string; size: number; bytes: Uint8Array; cleanup: number };
export type FileScope = Pick<ConversationScope, "roomId" | "conversationId">;
const whereFolder = "owner_id=? AND room_id=? AND conversation_id=?";
const whereFile = whereFolder + " AND document_id=?";
const args = (actor: Actor, scope: FileScope) => [actor.id, scope.roomId, scope.conversationId] as const;

function validateDocumentId(value: string) {
  if (!id(value) || [".", "..", "_journal"].includes(value)) throw new ApiError(400, "자료 식별자가 올바르지 않습니다.");
}

export function requireFileScope(actor: Actor, scope: FileScope, permission: Permission, db = getDatabase(), allowDeleted = false) {
  requirePermission(actor, "viewRoom");
  requirePermission(actor, "chat");
  requirePermission(actor, permission);
  try { requireOwnedConversation(db, { ...scope, accountId: actor.id }); }
  catch (error) { if (allowDeleted && error instanceof ApiError && error.status === 404) return false; throw error; }
  return true;
}

function referenced(db: DatabaseSync, actor: Actor, scope: FileScope, documentId: string): boolean {
  const row = db.prepare("SELECT room_id,owner_id,data_json FROM records WHERE key=?").get(canonicalPrivateTool({ ...scope, accountId: actor.id }, "documents"));
  if (!row) return false;
  try {
    if (row.room_id !== scope.roomId || row.owner_id !== actor.id || typeof row.data_json !== "string") throw Error();
    const record = JSON.parse(row.data_json) as { version?: unknown; items?: unknown } | null;
    if (!record || record.version !== 1 || !Array.isArray(record.items)) throw Error();
    const ids = new Set<string>();
    for (const item of record.items) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id)
        || typeof item.title !== "string" || !item.title.trim() || typeof item.pinned !== "boolean"
        || !["minutes", "sample", "file"].includes(item.kind)
        || (item.file !== undefined && !isDocumentFileMetadata(item.file))
        || (item.kind === "file" && !isDocumentFileMetadata(item.file))) throw Error();
      ids.add(item.id);
    }
    return ids.has(documentId);
  } catch { throw new ApiError(409, "자료 참조 정보를 확인하지 못했습니다. 파일을 보존했습니다."); }
}

export function putFile(actor: Actor, scope: FileScope, documentId: string, name: string, bytes: Uint8Array, db = getDatabase()) {
  validateDocumentId(documentId);
  if (bytes.byteLength > MAX_DOCUMENT_FILE_SIZE) throw new ApiError(413, "파일은 5 MiB 이하여야 합니다.");
  let metadata;
  try { metadata = documentFileMetadata({ name, size: bytes.byteLength }); }
  catch { throw new ApiError(400, "파일 이름 또는 형식을 확인해 주세요."); }
  return transaction(db, () => {
    requireFileScope(actor, scope, "uploadDocument", db);
    if (db.prepare(`SELECT 1 FROM conversation_files WHERE ${whereFile}`).get(...args(actor, scope), documentId)) throw new ApiError(409, "이미 저장된 파일은 덮어쓸 수 없습니다.");
    const usage = db.prepare("SELECT COALESCE(SUM(size),0) AS bytes,COUNT(*) AS count FROM conversation_files WHERE owner_id=? AND room_id=?").get(actor.id, scope.roomId)!;
    if (Number(usage.bytes) + metadata.size > MAX_ROOM_FILE_BYTES || Number(usage.count) >= MAX_ROOM_FILE_COUNT) throw new ApiError(413, "이 행사의 내 파일 저장 한도를 초과했습니다.");
    db.prepare("INSERT INTO conversation_files(owner_id,room_id,conversation_id,document_id,name,mime,size,bytes,cleanup,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)")
      .run(...args(actor, scope), documentId, metadata.name, metadata.type, metadata.size, bytes, new Date().toISOString());
    bumpRevision(db);
  });
}

export function getFile(actor: Actor, scope: FileScope, documentId: string, db = getDatabase()): StoredFile | undefined {
  validateDocumentId(documentId);
  requireFileScope(actor, scope, "viewRoom", db);
  return db.prepare(`SELECT name,mime,size,bytes,cleanup FROM conversation_files WHERE ${whereFile}`).get(...args(actor, scope), documentId) as StoredFile | undefined;
}

export function isFileReferenced(actor: Actor, scope: FileScope, documentId: string, db = getDatabase()) {
  validateDocumentId(documentId);
  return requireFileScope(actor, scope, "viewRoom", db, true) && referenced(db, actor, scope, documentId);
}

export function listFileCleanup(actor: Actor, scope: FileScope, db = getDatabase()): string[] {
  if (!requireFileScope(actor, scope, "viewRoom", db, true)) return [];
  return db.prepare(`SELECT document_id FROM conversation_files WHERE ${whereFolder} AND cleanup=1 ORDER BY created_at,document_id`).all(...args(actor, scope)).map((row) => String(row.document_id));
}

export function queueFileCleanup(actor: Actor, scope: FileScope, documentId: string, db = getDatabase()) {
  validateDocumentId(documentId);
  return transaction(db, () => {
    if (!requireFileScope(actor, scope, "uploadDocument", db, true)) return;
    if (db.prepare(`UPDATE conversation_files SET cleanup=1 WHERE ${whereFile} AND cleanup<>1`).run(...args(actor, scope), documentId).changes) bumpRevision(db);
  });
}

export function retireFileCleanup(actor: Actor, scope: FileScope, documentId: string, db = getDatabase()) {
  validateDocumentId(documentId);
  return transaction(db, () => {
    if (!requireFileScope(actor, scope, "uploadDocument", db, true)) return;
    if (!db.prepare(`SELECT 1 FROM conversation_files WHERE ${whereFile}`).get(...args(actor, scope), documentId)) return;
    if (!referenced(db, actor, scope, documentId)) throw new ApiError(409, "아직 참조되지 않은 파일의 정리 기록은 유지됩니다.");
    if (db.prepare(`UPDATE conversation_files SET cleanup=0 WHERE ${whereFile} AND cleanup<>0`).run(...args(actor, scope), documentId).changes) bumpRevision(db);
  });
}

export function deleteFile(actor: Actor, scope: FileScope, documentId: string, db = getDatabase()) {
  validateDocumentId(documentId);
  return transaction(db, () => {
    if (!requireFileScope(actor, scope, "uploadDocument", db, true)) return;
    if (referenced(db, actor, scope, documentId)) throw new ApiError(409, "사용 중인 자료의 파일은 삭제할 수 없습니다.");
    if (db.prepare(`DELETE FROM conversation_files WHERE ${whereFile}`).run(...args(actor, scope), documentId).changes) bumpRevision(db);
  });
}

export function fileContentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\;%]/g, "_");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
