import type { DatabaseSync } from "node:sqlite";
import type { ConversationScope } from "../conversation-scope";
import type { RoomDocument } from "../room-materials";
import type { RetreatReference, RetreatTask } from "../retreat-preparation";
import type { Actor } from "./auth";
import { canonicalPrivateTool } from "./conversation-scope";
import { getFile } from "./files";
import { validateRecord } from "./record-schema";

const maxBytes = 256 * 1024;
const referenceName = /요람|과거|작년|전년도|이전|인수인계|운영\s*기록/;
const terms: Record<string, readonly string[]> = {
  "confirm-date": ["날짜", "기간", "일정 확정"],
  "draft-survey": ["설문", "참석 여부", "참가 여부", "참가자 조사"],
  "compare-venues": ["장소", "숙소", "행사장", "예약"],
  "draft-confirmed-notice": ["공지", "안내", "준비물"],
  "check-water-safety": ["물놀이", "안전 담당", "안전교육"],
  "review-minutes": ["점검", "확인", "기록", "인수인계"],
};
const compact = (value: string) => value.normalize("NFKC").replace(/\s+/g, "");

export function readRetreatReferences(db: DatabaseSync, actor: Actor, scope: ConversationScope, tasks: RetreatTask[]): RetreatReference[] {
  if (actor.id !== scope.accountId || !tasks.length) return [];
  const row = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND room_id=? AND kind='documents'")
    .get(canonicalPrivateTool(scope, "documents"), actor.id, scope.roomId);
  if (!row) return [];
  let documents: RoomDocument[];
  try {
    const record = JSON.parse(String(row.data_json));
    validateRecord("documents", record); documents = record.items;
  } catch { return []; }

  const passages = documents.filter(doc => doc.pinned && doc.kind === "file" && doc.file &&
      /\.(txt|md)$/i.test(doc.file.name) && referenceName.test(doc.title + " " + doc.file.name) && doc.file.size <= maxBytes)
    .slice(0, 10).flatMap(doc => {
      try {
        const stored = getFile(actor, scope, doc.id, db);
        if (!stored || stored.cleanup || stored.name !== doc.file!.name || stored.bytes.length > maxBytes) return [];
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes);
        return raw.split(/\r?\n/).slice(0, 2000).filter(line => !line.includes("\u0000"))
          .map(line => line.trim().slice(0, 240)).filter(line => line.length >= 5)
          .map(excerpt => ({ documentId: doc.id, sourceTitle: doc.title, excerpt, searchable: compact(excerpt) }));
      } catch { return []; }
    });
  const used = new Set<string>();
  return tasks.flatMap(task => {
    const keywords = (terms[task.id] ?? []).map(compact);
    const ranked = passages.map(passage => ({ passage, score: keywords.filter(term => passage.searchable.includes(term)).length }))
      .filter(item => item.score > 0 && !used.has(item.passage.documentId + item.passage.excerpt)).sort((a, b) => b.score - a.score);
    const match = ranked[0]?.passage;
    if (!match) return [];
    used.add(match.documentId + match.excerpt);
    return [{ taskId: task.id, documentId: match.documentId, sourceTitle: match.sourceTitle, excerpt: match.excerpt }];
  }).slice(0, 4);
}
