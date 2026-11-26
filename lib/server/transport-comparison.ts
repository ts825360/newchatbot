import type { DatabaseSync } from "node:sqlite";
import type { ConversationScope } from "../conversation-scope";
import { comparisonPoints, createTransportComparisonFacts, isTransportComparison, type TransportComparison } from "../transport-comparison";
import { requirePermission, requireUser } from "./auth";
import { canonicalWorkspaceTool, inheritWorkspaceRecords, requireOwnedConversation } from "./conversation-scope";
import { getDatabase } from "./database";
import { ApiError, errorResponse, json, readJson } from "./http";
import { id, object, text } from "./record-schema";

function readPair(db: DatabaseSync, scope: ConversationScope): Required<TransportComparison> {
  requireOwnedConversation(db, scope);
  inheritWorkspaceRecords(db, scope);
  const row = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND room_id=? AND kind='transport'")
    .get(canonicalWorkspaceTool(scope, "transport"), scope.accountId, scope.roomId);
  const value: unknown = row && JSON.parse(String(row.data_json));
  const pair: unknown = object(value) ? value.comparison : null;
  if (!isTransportComparison(pair) || !pair.a || !pair.b) throw new ApiError(409, "비교안 두 개를 먼저 저장해 주세요.");
  return { a: pair.a, b: pair.b };
}

export async function handleTransportComparison(request: Request, database?: DatabaseSync): Promise<Response> {
  try {
    const input = await readJson(request, 4096);
    const db = database ?? getDatabase();
    const actor = requireUser(request, db);
    for (const permission of ["viewRoom", "chat", "editChecklist"] as const) requirePermission(actor, permission);
    if (!object(input) || Object.keys(input).some(k => !["roomId", "conversationId", "accountId", "expected"].includes(k)) ||
        !id(input.roomId) || !id(input.conversationId) || !text(input.expected, 1400)) throw new ApiError(400, "배정안 비교 요청을 확인해 주세요.");
    if (input.accountId !== actor.id) throw new ApiError(409, "접속 계정이 변경되었습니다.");
    const scope = { accountId: actor.id, roomId: input.roomId, conversationId: input.conversationId };
    const pair = readPair(db, scope);
    const facts = createTransportComparisonFacts(pair);
    if (JSON.stringify(facts) !== input.expected) throw new ApiError(409, "저장된 비교안이 변경되었습니다.");
    return json({ text: Object.values(comparisonPoints(pair)).join(" ") || "현재 비교표의 항목에는 차이가 없습니다." });
  } catch (error) { return errorResponse(error); }
}
