import type { DatabaseSync } from "node:sqlite";
import { openAIChatConsentVersion } from "../assistant-privacy";

const kind = "chat-external-consent";
const key = (accountId: string) => `${kind}:${accountId}`;

export function hasChatConsent(db: DatabaseSync, accountId: string) {
  return db.prepare("SELECT 1 FROM records WHERE key=? AND owner_id=? AND kind=? AND data_json=?")
    .get(key(accountId), accountId, kind, JSON.stringify(openAIChatConsentVersion)) !== undefined;
}

export function saveChatConsent(db: DatabaseSync, accountId: string, approved: boolean, at = new Date().toISOString()) {
  if (!approved) {
    db.prepare("DELETE FROM records WHERE key=? AND owner_id=? AND kind=?").run(key(accountId), accountId, kind);
    return;
  }
  db.prepare(`INSERT INTO records(key,owner_id,kind,data_json,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1,updated_at=excluded.updated_at`)
    .run(key(accountId), accountId, kind, JSON.stringify(openAIChatConsentVersion), at);
}
