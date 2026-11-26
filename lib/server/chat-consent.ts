import type { DatabaseSync } from "node:sqlite";
import { openAIChatConsentVersion, openAIReplyContextConsentVersion } from "../assistant-privacy";

const kind = "chat-external-consent";
const contextKind = "chat-reply-context-consent";
const key = (recordKind: string, accountId: string) => `${recordKind}:${accountId}`;

export function hasChatConsent(db: DatabaseSync, accountId: string) {
  return db.prepare("SELECT 1 FROM records WHERE key=? AND owner_id=? AND kind=? AND data_json=?")
    .get(key(kind, accountId), accountId, kind, JSON.stringify(openAIChatConsentVersion)) !== undefined;
}

export function saveChatConsent(db: DatabaseSync, accountId: string, approved: boolean, at = new Date().toISOString()) {
  if (!approved) {
    db.prepare("DELETE FROM records WHERE owner_id=? AND ((key=? AND kind=?) OR (key=? AND kind=?))")
      .run(accountId, key(kind, accountId), kind, key(contextKind, accountId), contextKind);
    return;
  }
  saveApproval(db, accountId, kind, openAIChatConsentVersion, at);
}

function saveApproval(db: DatabaseSync, accountId: string, recordKind: string, version: string, at: string) {
  db.prepare(`INSERT INTO records(key,owner_id,kind,data_json,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1,updated_at=excluded.updated_at`)
    .run(key(recordKind, accountId), accountId, recordKind, JSON.stringify(version), at);
}

export function hasReplyContextConsent(db: DatabaseSync, accountId: string) {
  return hasChatConsent(db, accountId) && db.prepare("SELECT 1 FROM records WHERE key=? AND owner_id=? AND kind=? AND data_json=?")
    .get(key(contextKind, accountId), accountId, contextKind, JSON.stringify(openAIReplyContextConsentVersion)) !== undefined;
}

export function saveReplyContextConsent(db: DatabaseSync, accountId: string, approved: boolean) {
  if (!approved) {
    db.prepare("DELETE FROM records WHERE key=? AND owner_id=? AND kind=?").run(key(contextKind, accountId), accountId, contextKind);
  } else {
    saveApproval(db, accountId, contextKind, openAIReplyContextConsentVersion, new Date().toISOString());
  }
}
