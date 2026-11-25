import type { DatabaseSync } from "node:sqlite";
import { compareRetreatVenues, extractReportVenue, reportPlaceName, type RetreatVisit } from "../retreat-venue-history";
import { hasObviousPrivateData } from "../assistant-privacy";
import type { ConversationScope } from "../conversation-scope";
import { requirePermission, requireUser, type Actor } from "./auth";
import { canonicalPrivateTool, requireOwnedConversation } from "./conversation-scope";
import { bumpRevision, getDatabase, transaction } from "./database";
import { getFile, isFileReferenced } from "./files";
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from "./http";
import { id, object } from "./record-schema";

const isReport = /리포트|보고서|결과\s*보고/;
const notFinal = /초안|후보|계획서/;
const maxReportBytes = 256 * 1024;
const sourceKey = "owner_id=? AND room_id=? AND conversation_id=? AND document_id=?";

export function isRetreatRoom(db: DatabaseSync, roomId: string) {
  const row = db.prepare("SELECT data_json FROM rooms WHERE id=?").get(roomId);
  return !!row && JSON.parse(String(row.data_json)).category === "retreat";
}

function requireRetreatScope(db: DatabaseSync, actor: Actor, scope: ConversationScope) {
  requirePermission(actor, "viewRoom");
  requirePermission(actor, "chat");
  requireOwnedConversation(db, scope);
  if (!isRetreatRoom(db, scope.roomId)) throw new ApiError(404, "수련회 행사방에서만 장소 이력을 확인할 수 있습니다.");
}

export function loadRetreatVenueReview(db: DatabaseSync, actor: Actor, scope: ConversationScope, query = "") {
  requireRetreatScope(db, actor, scope);
  const rows = db.prepare(`SELECT v.name, v.year, v.features_json, v.owner_id, v.room_id, v.conversation_id, v.document_id FROM retreat_report_venues v
    JOIN conversation_files f USING(owner_id,room_id,conversation_id,document_id)
    WHERE f.cleanup=0 ORDER BY v.year DESC,v.name LIMIT 100`).all();
  const reference = db.prepare(`SELECT 1 FROM records r,json_each(r.data_json, '$.items') item
    WHERE r.key=? AND r.kind='documents' AND r.owner_id=? AND r.room_id=?
      AND json_extract(item.value,'$.kind')='file' AND json_extract(item.value,'$.id')=? LIMIT 1`);
  const history = [...new Map(rows.flatMap(({ name, year, features_json, owner_id, room_id, conversation_id, document_id }) => {
    const source = { accountId: String(owner_id), roomId: String(room_id), conversationId: String(conversation_id) };
    if (!reference.get(canonicalPrivateTool(source, "documents"), owner_id, room_id, document_id)) return [];
    const visit = { name: String(name), year: Number(year), features: JSON.parse(String(features_json)) } as RetreatVisit;
    return [[JSON.stringify([visit.name, visit.year]), visit] as const];
  })).values()];
  return { history, candidates: compareRetreatVenues(history, query) };
}

export async function handleRetreatVenueHistory(request: Request, database = getDatabase()): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = requireUser(request, database);
    const url = new URL(request.url);
    const input = request.method === "GET" ? Object.fromEntries(url.searchParams) : await readJson(request, 4096);
    if (!object(input) || !id(input.roomId) || !id(input.conversationId)) throw new ApiError(400, "행사방과 대화를 확인해 주세요.");
    const scope = { accountId: actor.id, roomId: input.roomId, conversationId: input.conversationId };
    requireRetreatScope(database, actor, scope);
    const canPublish = actor.permissions.includes("editRoom");
    if (request.method === "GET") {
      const reports = canPublish && input.manage === "1" ? database.prepare(`SELECT f.document_id AS id, f.name, v.year, v.name AS venue
        FROM conversation_files f LEFT JOIN retreat_report_venues v USING(owner_id,room_id,conversation_id,document_id)
        WHERE f.owner_id=? AND f.room_id=? AND f.conversation_id=? AND f.cleanup=0 AND f.size<=?
        ORDER BY f.created_at DESC`).all(actor.id, scope.roomId, scope.conversationId, maxReportBytes).filter(item =>
        /\.(txt|md)$/i.test(String(item.name))) : [];
      return json({ ...loadRetreatVenueReview(database, actor, scope, input.bbq === "1" ? "바비큐" : ""), reports, canPublish });
    }
    requirePermission(actor, "editRoom");
    const current = requireUser(request, database);
    if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion) throw new ApiError(401, "다시 로그인해 주세요.");
    if (!id(input.documentId) || Object.keys(input).some(key => !["roomId", "conversationId", "documentId", "name", "year"].includes(key))) {
      throw new ApiError(400, "결과 보고서를 선택해 주세요.");
    }
    const keys = [actor.id, scope.roomId, scope.conversationId, input.documentId] as const;
    if (request.method === "DELETE") {
      transaction(database, () => { if (database.prepare(`DELETE FROM retreat_report_venues WHERE ${sourceKey}`).run(...keys).changes) bumpRevision(database); });
      return json({ ok: true });
    }
    if (request.method !== "POST") return json({ error: "지원하지 않는 장소 이력 요청입니다." }, 405);
    const name = typeof input.name === "string" ? reportPlaceName(input.name) : null;
    const year = input.year;
    const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Seoul" }).format());
    if (!name || hasObviousPrivateData(name) || !Number.isInteger(year) || year < 1900 || year > currentYear) throw new ApiError(400, "실제로 이용한 장소명과 연도를 확인해 주세요.");
    const file = getFile(actor, scope, input.documentId, database);
    if (!file || file.cleanup || file.size > maxReportBytes || !/\.(txt|md)$/i.test(file.name) || !isFileReferenced(actor, scope, input.documentId, database))
      throw new ApiError(422, "이 대화에 첨부된 TXT 또는 MD 결과 보고서를 선택해 주세요.");
    let contents: string;
    try { contents = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes); }
    catch { throw new ApiError(422, "UTF-8 결과 보고서만 등록할 수 있습니다."); }
    const heading = contents.split(/\r?\n/).find(line => line.trim()) ?? "";
    if (!(isReport.test(file.name) || isReport.test(heading)) || notFinal.test(file.name) || notFinal.test(heading))
      throw new ApiError(422, "결과 보고서만 등록할 수 있습니다. 초안이나 후보 목록은 이용 이력에서 제외합니다.");
    const features = extractReportVenue(contents, name, year);
    if (!features) throw new ApiError(422, "보고서의 일시와 장소 항목이 입력한 장소명·연도와 일치해야 합니다.");
    transaction(database, () => {
      database.prepare(`INSERT INTO retreat_report_venues(owner_id,room_id,conversation_id,document_id,year,name,features_json)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,room_id,conversation_id,document_id)
        DO UPDATE SET year=excluded.year,name=excluded.name,features_json=excluded.features_json`).run(...keys, year, name, JSON.stringify(features));
      bumpRevision(database);
    });
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
