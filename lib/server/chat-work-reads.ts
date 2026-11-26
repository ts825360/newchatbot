import type { DatabaseSync } from "node:sqlite";
import type { ConversationScope } from "../conversation-scope";
import type { WorkCondition } from "../chat-work-state";
import type { Actor } from "./auth";
import { canonicalWorkspaceTool, requireOwnedConversation } from "./conversation-scope";

export function readParticipantCount(db: DatabaseSync, actor: Actor, scope: ConversationScope): WorkCondition<number> | undefined {
  if (actor.id !== scope.accountId || !actor.permissions.includes("viewChecklist")) return;
  requireOwnedConversation(db, scope);
  const canonical = canonicalWorkspaceTool(scope, "transport");
  const legacyPrefix = `private-v1:${encodeURIComponent(scope.accountId)}:${encodeURIComponent(scope.roomId)}:`;
  const row = db.prepare(`SELECT json_array_length(data_json, '$.input.people') AS count, revision FROM records
    WHERE owner_id=? AND room_id=? AND kind='transport' AND json_valid(data_json)
    AND (key=? OR (substr(key,1,?)=? AND NOT EXISTS (SELECT 1 FROM records WHERE key=?)))
    AND json_type(data_json, '$.input.people')='array' AND (json_extract(data_json, '$.demo')=0
      OR json_extract(data_json, '$.demo') IS NULL AND NOT EXISTS (
        SELECT 1 FROM json_each(data_json, '$.input.people') person WHERE json_extract(person.value, '$.name') LIKE '가상참가자 %'))
    ORDER BY updated_at DESC, revision DESC, key LIMIT 1`)
    .get(actor.id, scope.roomId, canonical, legacyPrefix.length, legacyPrefix, canonical);
  if (typeof row?.count === "number" && row.count > 0 && row.count <= 999) {
    return { value: row.count, source: "event", scope: "task", status: "unconfirmed", revision: String(row.revision) };
  }
}
