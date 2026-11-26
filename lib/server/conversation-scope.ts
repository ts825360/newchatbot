import type { DatabaseSync } from "node:sqlite";
import { readConversationPlaces } from "../conversation-places";
import { initialConversationId, scopeId, type ConversationScope, type PrivateToolKind } from "../conversation-scope";
import { emptyTimetable, readTimetable } from "../timetable";
import { createTransportDraft } from "../transport";
import { parseTransportSnapshot } from "../transport-snapshot";
import { ApiError } from "./http";
import { id, validateRecord } from "./record-schema";

export const canonicalConversationHistory = (accountId: string, roomId: string) => `conversations:${accountId}:${roomId}`;
export const canonicalPrivateTool = (scope: ConversationScope, kind: PrivateToolKind) => `private-v1:${scopeId(scope)}:${kind}`;
const roomScopeId = ({ accountId, roomId }: Pick<ConversationScope, "accountId" | "roomId">) => `${encodeURIComponent(accountId)}:${encodeURIComponent(roomId)}`;
export const workspaceToolPrefix = (scope: Pick<ConversationScope, "accountId" | "roomId">) => `room-work-v1:${roomScopeId(scope)}:`;
export const canonicalWorkspaceTool = (scope: ConversationScope, kind: PrivateToolKind) => kind === "documents"
  ? canonicalPrivateTool(scope, kind) : workspaceToolPrefix(scope) + kind;
export const preparationProgressKey = (scope: ConversationScope) => `preparation-progress-room-v1:${roomScopeId(scope)}`;
export const legacyProgressPrefix = (scope: ConversationScope) => `preparation-progress:${roomScopeId(scope)}:`;

function hasPlanningData(kind: string, raw: string) {
  try {
    if (kind === "timetable") {
      const timetable = readTimetable(raw);
      return !!(timetable.entries.length || timetable.startDate || timetable.days !== emptyTimetable().days);
    }
    if (kind === "transport") {
      const record = parseTransportSnapshot(raw);
      const { revision: _revision, ...input } = record.input;
      const { revision: _defaultRevision, ...defaults } = createTransportDraft();
      return !record.demo && !!(record.result || record.baseline || record.comparison || record.lodgingPlan || record.survey ||
        (Object.keys(defaults) as (keyof typeof defaults)[]).some(key => JSON.stringify(input[key]) !== JSON.stringify(defaults[key])));
    }
    const value = JSON.parse(raw);
    validateRecord(kind, value);
    return kind === "location" ? readConversationPlaces(value).length > 0 : value.items.length > 0;
  } catch { return false; }
}

export function inheritWorkspaceRecords(db: DatabaseSync, scope: Pick<ConversationScope, "accountId" | "roomId">) {
  const nextPrefix = workspaceToolPrefix(scope);
  const oldPrefix = `private-v1:${roomScopeId(scope)}:`;
  const rows = db.prepare(`SELECT kind,data_json,revision,updated_at FROM records AS legacy
    WHERE owner_id=? AND room_id=? AND substr(key,1,?)=? AND kind IN ('checklist','risks','decisions','transport','location','timetable')
    AND NOT EXISTS (SELECT 1 FROM records WHERE key=? || legacy.kind)
    ORDER BY updated_at DESC, revision DESC, key`).all(scope.accountId, scope.roomId, oldPrefix.length, oldPrefix, nextPrefix);
  if (!rows.length) return;
  const inserted = new Set<string>();
  const save = db.prepare("INSERT OR IGNORE INTO records(key,owner_id,room_id,kind,data_json,revision,updated_at) VALUES(?,?,?,?,?,?,?)");
  // Pick one intact snapshot per tool. An existing canonical row, even an empty one, is authoritative.
  for (const row of rows) {
    const kind = String(row.kind);
    if (inserted.has(kind) || !hasPlanningData(kind, String(row.data_json))) continue;
    save.run(nextPrefix + kind, scope.accountId, scope.roomId, kind, row.data_json, row.revision, row.updated_at);
    inserted.add(kind);
  }
}

export function conversationIds(db: DatabaseSync, accountId: string, roomId: string): string[] {
  const row = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND room_id=?").get(canonicalConversationHistory(accountId, roomId), accountId, roomId);
  if (!row) return [initialConversationId(roomId)];
  const history = JSON.parse(String(row.data_json)) as { conversations: { id: string }[] };
  return history.conversations.map((item) => item.id);
}

export function requireOwnedConversation(db: DatabaseSync, scope: ConversationScope) {
  if (!id(scope.roomId) || !id(scope.conversationId)) throw new ApiError(400, "대화 식별자를 확인해 주세요.");
  if (!db.prepare("SELECT 1 FROM rooms WHERE id=?").get(scope.roomId) || !conversationIds(db, scope.accountId, scope.roomId).includes(scope.conversationId)) {
    throw new ApiError(404, "대화를 찾을 수 없습니다.");
  }
}
