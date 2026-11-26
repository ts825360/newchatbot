import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeCalendarStatus } from "../calendar-status";
import type { ConversationScope, PrivateToolKind } from "../conversation-scope";
import { preparationProgressConsent, type PreparationProgress, type SavedPreparationProgress } from "../preparation-progress";
import { retreatReviewAccountHeader, retreatReviewPermissions } from "../retreat-preparation";
import { validDate } from "../room-timing";
import type { CalendarEvent, ChecklistItem } from "../types";
import { requirePermission, requireUser, type Actor } from "./auth";
import { generateOpenAIText } from "./chat-openai";
import { canonicalWorkspaceTool, inheritWorkspaceRecords, legacyProgressPrefix, preparationProgressKey, requireOwnedConversation } from "./conversation-scope";
import { getDatabase } from "./database";
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from "./http";
import { id, object, validateRecord } from "./record-schema";
import { loadRetreatReview } from "./retreat-preparation";

let evaluating = false;
const instructions = "Review anonymous event preparation evidence conservatively. Answer only ready, remaining, or uncertain. Return ready only if the evidence is substantial and shows no unresolved preparation. A final signoff alone is insufficient. Do not infer unrecorded approvals; return uncertain if the event scope or evidence coverage cannot be trusted. The percentage is decided by the server.";
const modelFormat = { type: "json_schema", name: "preparation_verdict_v1", strict: true, schema: { type: "object", additionalProperties: false, required: ["verdict"], properties: { verdict: { type: "string", enum: ["ready", "remaining", "uncertain"] } } } };
const pending = (...notes: string[]): PreparationProgress => ({ state: "pending", percent: null, notes });

function requireReviewer(request: Request, db: DatabaseSync) {
  assertSameOrigin(request);
  const actor = requireUser(request, db);
  if (request.headers.get(retreatReviewAccountHeader) !== actor.id) throw new ApiError(409, "접속 계정이 변경되었습니다. 다시 확인해 주세요.");
  for (const permission of retreatReviewPermissions) requirePermission(actor, permission);
  return actor;
}

function collect(db: DatabaseSync, actor: Actor, scope: ConversationScope) {
  requireOwnedConversation(db, scope);
  inheritWorkspaceRecords(db, scope);
  const source = (key: string, kind: string, owner: string | null) => db.prepare("SELECT data_json,revision FROM records WHERE key=? AND kind=? AND room_id=? AND owner_id IS ?").get(key, kind, scope.roomId, owner);
  const privateSource = (kind: PrivateToolKind) => source(canonicalWorkspaceTool(scope, kind), kind, actor.id);
  const room = db.prepare("SELECT data_json,revision FROM rooms WHERE id=?").get(scope.roomId)!;
  const events = source(`preparation:${scope.roomId}:events`, "events", null);
  const checklist = privateSource("checklist"), risks = privateSource("risks"), decisions = privateSource("decisions");
  const read = <T>(row: typeof events, kind: string): T[] => {
    if (!row) return [];
    const value = JSON.parse(String(row.data_json));
    validateRecord(kind, value);
    return value.items;
  };
  const items = read<ChecklistItem>(checklist, "checklist");
  const schedule = read<CalendarEvent>(events, "events");
  const data = JSON.parse(String(room.data_json));
  const dated = typeof data.date === "string" && validDate(data.date);
  const inPeriod = dated ? schedule.filter(event => event.date >= data.date && event.date <= (data.endDate || data.date)) : [];
  const confirmed = inPeriod.filter(event => normalizeCalendarStatus(event.status) === "confirmed").length;
  const signoffs = items.filter(item => item.title.normalize("NFKC").replace(/\s+/g, "") === "최종준비검토");
  const work = items.filter(item => !signoffs.includes(item));
  const workDone = work.filter(item => item.status === "done").length;
  const signoff = signoffs.length === 1 && signoffs[0].status === "done" && !!signoffs[0].owner.trim();
  const unresolvedRisks = read<{ resolved: boolean }>(risks, "risks").filter(item => !item.resolved).length;
  const unresolvedDecisions = read<{ status: string }>(decisions, "decisions").filter(item => item.status === "pending" || item.status === "deferred").length;
  const retreat = data.category === "retreat" ? loadRetreatReview(db, actor, scope) : null;
  const unconfirmedRetreatFields = retreat?.fields.filter(field => field.status !== "confirmed" && field.status !== "not_applicable").length ?? 0;
  const missing: string[] = [], remaining: string[] = [];
  if (!dated || !confirmed) missing.push("행사 기간 안에 확정된 캘린더 일정이 필요합니다.");
  if (!work.length) missing.push("완료 여부를 검토할 준비 항목이 없습니다.");
  if (!signoff) missing.push("체크리스트에서 ‘최종 준비 검토’를 담당자와 함께 완료로 기록해 주세요.");
  if (workDone < work.length) remaining.push(`완료하지 않은 준비 항목 ${work.length - workDone}개`);
  if (inPeriod.length > confirmed) remaining.push(`확정하지 않은 일정 ${inPeriod.length - confirmed}개`);
  if (unresolvedRisks) remaining.push(`해결하지 않은 위험 ${unresolvedRisks}개`);
  if (unresolvedDecisions) remaining.push(`결정하지 않은 제안 ${unresolvedDecisions}개`);
  if (unconfirmedRetreatFields) remaining.push(`확인이 필요한 수련회 준비 사항 ${unconfirmedRetreatFields}개`);
  const signature = createHash("sha256").update(JSON.stringify(["preparation-progress-v1", room, events, checklist, risks, decisions, ...(retreat ? [privateSource("location"), privateSource("transport")] : [])])).digest("hex");
  const evidence = { retreat: !!retreat, tasks: work.length, done: workDone, confirmedSchedules: confirmed, finalHumanReviewRecorded: signoff, unresolvedRisks, unresolvedDecisions, unconfirmedRetreatFields };
  return { remaining, missing, signature, evidence };
}

function saveReview(db: DatabaseSync, scope: ConversationScope, signature: string, report: PreparationProgress) {
  db.prepare(`INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,?,'preparation-progress',?,?)
    ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1,updated_at=excluded.updated_at`)
    .run(preparationProgressKey(scope), scope.accountId, scope.roomId, JSON.stringify({ signature, report }), new Date().toISOString());
  return json(report);
}

export function readPreparationProgress(request: Request, database?: DatabaseSync): Response {
  try {
    const db = database ?? getDatabase();
    const actor = requireReviewer(request, db);
    const params = new URL(request.url).searchParams;
    const roomId = params.get("roomId"), conversationId = params.get("conversationId");
    if (!id(roomId) || !id(conversationId)) throw new ApiError(400, "검토할 대화를 확인해 주세요.");
    const scope = { accountId: actor.id, roomId, conversationId };
    requireOwnedConversation(db, scope);
    const row = db.prepare("SELECT data_json FROM records WHERE key=? AND kind='preparation-progress' AND owner_id=? AND room_id=?")
      .get(preparationProgressKey(scope), actor.id, roomId);
    const prefix = legacyProgressPrefix(scope);
    const candidates = row ? [row] : db.prepare(`SELECT data_json FROM records WHERE kind='preparation-progress' AND owner_id=? AND room_id=? AND substr(key,1,?)=?
      ORDER BY updated_at DESC,revision DESC,key`).all(actor.id, roomId, prefix.length, prefix);
    const signature = candidates.length ? collect(db, actor, scope).signature : null;
    const saved = candidates.map(r => JSON.parse(String(r.data_json)) as { signature: string; report: PreparationProgress })
      .find(review => review.signature === signature);
    return json({ report: saved?.report ?? null, stale: !saved && candidates.length > 0 } satisfies SavedPreparationProgress);
  } catch (cause) { return errorResponse(cause); }
}

export async function handlePreparationProgress(request: Request, database?: DatabaseSync): Promise<Response> {
  try {
    const db = database ?? getDatabase();
    const actor = requireReviewer(request, db);
    const body = await readJson(request, 4096);
    if (!object(body) || Object.keys(body).some(key => !["roomId", "conversationId", "consent"].includes(key)) || !id(body.roomId) || !id(body.conversationId)) throw new ApiError(400, "검토할 대화를 확인해 주세요.");
    if (body.consent !== preparationProgressConsent) throw new ApiError(423, "모델에 보낼 항목을 먼저 확인해 주세요.");
    const scope = { accountId: actor.id, roomId: body.roomId, conversationId: body.conversationId };
    const { remaining, missing, signature, evidence } = collect(db, actor, scope);
    const save = (report: PreparationProgress) => saveReview(db, scope, signature, report);
    if (remaining.length) {
      const percent = evidence.done < evidence.tasks ? Math.floor(evidence.done * 100 / evidence.tasks) : null;
      return save({ state: "remaining", percent, notes: [...remaining, ...missing] });
    }
    if (missing.length) return save(pending(...missing));
    if (evaluating) throw new ApiError(429, "다른 준비 검토가 진행 중입니다. 잠시 후 다시 시도해 주세요.");
    evaluating = true;
    try {
      let verdict: unknown;
      try {
        const reply: unknown = JSON.parse(await generateOpenAIText(JSON.stringify(evidence), request.signal, instructions, modelFormat));
        if (object(reply) && Object.keys(reply).length === 1) verdict = reply.verdict;
      } catch {
        return json(pending("모델 검토를 완료하지 못했습니다. 연결 상태를 확인해 주세요."));
      }
      const current = requireUser(request, db);
      if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion) throw new ApiError(401, "다시 로그인해 주세요.");
      for (const permission of retreatReviewPermissions) requirePermission(current, permission);
      if (request.signal.aborted || collect(db, current, scope).signature !== signature) throw new ApiError(409, "검토 중 자료가 변경되었습니다. 다시 확인해 주세요.");
      if (verdict === "ready") return save({ state: "ready", percent: 100, notes: ["저장된 준비 기록과 모델 검토에서 남은 항목을 찾지 못했습니다."] });
      if (verdict !== "remaining" && verdict !== "uncertain") return json(pending("모델 검토 결과를 확인하지 못했습니다. 다시 시도해 주세요."));
      return save(pending(verdict === "remaining" ? "모델이 추가 확인을 권장했습니다." : "모델이 완료를 판단할 만큼 충분한 근거를 확인하지 못했습니다."));
    } finally { evaluating = false; }
  } catch (cause) { return errorResponse(cause); }
}
