import type { DatabaseSync } from "node:sqlite";
import { initialConversationId, scopeId, type ConversationScope, type PrivateToolKind } from "../conversation-scope";
import { ApiError } from "./http";
import { id } from "./record-schema";

export const canonicalConversationHistory = (accountId: string, roomId: string) => `conversations:${accountId}:${roomId}`;
export const canonicalPrivateTool = (scope: ConversationScope, kind: PrivateToolKind) => `private-v1:${scopeId(scope)}:${kind}`;

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
