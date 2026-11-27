import type { DatabaseSync } from "node:sqlite";
import type { ConversationScope } from "../conversation-scope";
import { requirePermission, requireUser, type Actor } from "./auth";
import { requireOwnedConversation } from "./conversation-scope";
import { getDatabase } from "./database";
import { ApiError, assertSameOrigin, errorResponse, json } from "./http";
import { id } from "./record-schema";

export function readPreparationSurveyCounts(db: DatabaseSync, actor: Actor, scope: Omit<ConversationScope, "accountId">) {
  requirePermission(actor, "viewRoom");
  requirePermission(actor, "chat");
  requireOwnedConversation(db, { ...scope, accountId: actor.id });
  const drafts = db.prepare("SELECT COUNT(DISTINCT work_id) AS n FROM chat_work_versions WHERE owner_id=? AND room_id=? AND conversation_id=? AND kind='survey'")
    .get(actor.id, scope.roomId, scope.conversationId);
  const forms = db.prepare("SELECT COUNT(*) AS n FROM google_form_drafts WHERE user_id=? AND scope_key=? AND completed=1 AND form_id IS NOT NULL")
    .get(actor.id, JSON.stringify([scope.roomId, scope.conversationId]));
  return { drafts: Number(drafts?.n ?? 0), forms: Number(forms?.n ?? 0) };
}

export function handlePreparationSurveys(request: Request, db = getDatabase()): Response {
  try {
    assertSameOrigin(request);
    const actor = requireUser(request, db);
    if (request.headers.get("x-preparation-account") !== actor.id) throw new ApiError(409, "접속 계정이 변경되었습니다.");
    const query = new URL(request.url).searchParams;
    const roomId = query.get("roomId"), conversationId = query.get("conversationId");
    if (!id(roomId) || !id(conversationId) || [...query.keys()].length !== 2) throw new ApiError(400, "행사방과 대화를 확인해 주세요.");
    return json(readPreparationSurveyCounts(db, actor, { roomId, conversationId }));
  } catch (cause) { return errorResponse(cause); }
}
