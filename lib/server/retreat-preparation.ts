import type { DatabaseSync } from "node:sqlite";
import { validDate } from "../room-timing";
import { meetingOptions, retreatReviewAccountHeader, retreatReviewPermissions, type MeetingAvailability, type RetreatFieldKey, type RetreatReview, type RetreatTask } from "../retreat-preparation";
import { evaluateRetreatPreparation, type RetreatRuleFact } from "../retreat-preparation-rules.mjs";
import type { CalendarEvent, ChecklistItem } from "../types";
import type { ConversationScope } from "../conversation-scope";
import { readConversationPlaces } from "../conversation-places";
import { requirePermission, requireUser, type Actor } from "./auth";
import { canonicalPrivateTool, requireOwnedConversation } from "./conversation-scope";
import { getDatabase } from "./database";
import { ApiError, assertSameOrigin, errorResponse, json } from "./http";
import { id, object, validateRecord } from "./record-schema";
import { readRetreatReferences } from "./retreat-references";

const currentEdition = "selected-retreat";
const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, "").toLowerCase();
const mainEventTitles = new Set(["수련회본행사", "수련회본일정", "본행사"]);
const placeholder = new Set(["미정", "장소미정", "협의중", "장소협의중", "미확정", "장소미확정", "확인필요", "없음", "-", "tbd",
  "미지정", "담당미지정", "담당자미지정", "미배정", "담당자없음"]);
const isKnown = (value: string) => Boolean(value.trim()) && !placeholder.has(normalize(value));

const checklistAliases = new Map<string, RetreatFieldKey>(Object.entries({
  차량배정: "transport", 차량계획: "transport", 차량배정확정: "transport",
  숙소배정: "lodging", 방배정: "lodging", 숙소배정확정: "lodging",
  식사: "meals", 식사계획: "meals", 식사확정: "meals",
  행사일정: "agenda", 수련회일정표: "agenda", 행사시간표: "agenda",
  행사날짜: "date", 수련회날짜확정: "date", 행사장소: "venue", 수련회장소확정: "venue",
  물놀이계획: "water-activity", 물놀이안전담당: "water-safety", 물놀이안전담당자배정: "water-safety",
}));
const labelTask = <T extends RetreatTask>(task: T): T => {
  if (task.id === "check-water-safety") return { ...task, label: "물놀이 안전 담당 확인" };
  if (task.id === "confirm-date") return { ...task, label: "행사방에 수련회 날짜 확정" };
  return task;
};

type Saved = Record<"data_json", unknown> | undefined;
function readItems<T>(row: Saved, kind: "events" | "checklist"): T[] {
  if (!row) return [];
  try {
    const record: unknown = JSON.parse(String(row.data_json));
    validateRecord(kind, record);
    return (record as { items: T[] }).items;
  } catch {
    throw new ApiError(409, "저장된 일정 또는 체크리스트 형식을 확인해 주세요.");
  }
}

function buildReview(room: { date?: unknown; name: string }, events: CalendarEvent[], checklist: ChecklistItem[], location: string, approvedTransport: boolean, meeting: MeetingAvailability, now: Date) {
  const roomYear = typeof room.date === "string" && validDate(room.date) ? Number(room.date.slice(0, 4)) : 0;
  const year = roomYear >= 1900 ? roomYear : Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Seoul" }).format(now));
  const facts: RetreatRuleFact[] = [];
  const completedTaskIds = new Set<string>();
  const add = (key: RetreatFieldKey, ref: string, value?: string | boolean) => facts.push({
    key, editionId: currentEdition, ref, source: "confirmed_record",
    status: value === undefined ? "unverified" : "confirmed", value,
  });

  const primary = events.filter(event => event.status === "confirmed" && Number(event.date.slice(0, 4)) === year
    && (mainEventTitles.has(normalize(event.title)) || normalize(event.title) === normalize(room.name)));
  if (roomYear >= 1900) add("date", "room-date", String(room.date));
  if (isKnown(location)) add("venue", "saved-location", location);
  if (approvedTransport) add("transport", "approved-transport", "배정안 승인 완료");
  const settledDate = new Set([...primary.map(event => event.date), ...(roomYear >= 1900 ? [room.date] : [])]).size === 1;
  const locations = primary.map(event => isKnown(event.location) ? event.location.normalize("NFC").trim().replace(/\s+/g, " ") : "");
  const distinctVenues = new Map([...new Set(locations.filter(Boolean))].map((venue, index) => [venue, index]));
  for (const [index, event] of primary.entries()) {
    add("date", `calendar-${index}`, event.date);
    const value = locations[index];
    if (!value || isKnown(location)) continue;
    // Distinct placeholders preserve conflicts even when a location exceeds the rule's text limit.
    const venue = !settledDate ? undefined : distinctVenues.size > 1 ? `venue-${distinctVenues.get(value)}` : value.length <= 240 ? value : undefined;
    add("venue", `calendar-${index}`, venue);
  }
  for (const [index, item] of checklist.entries()) {
    const title = normalize(item.title);
    const done = item.status === "done";
    const ref = `checklist-${index}`;
    if (done && title === "참석설문초안작성") completedTaskIds.add("draft-survey");
    if (title === "물놀이진행확정" || title === "물놀이미진행확정") {
      add("water-activity", ref, done ? title === "물놀이진행확정" : undefined);
      continue;
    }
    const key = checklistAliases.get(title);
    if (!key || key === "meals" || key === "transport") continue;
    // Checkbox completion is not a date, venue, or water-activity decision.
    if (key === "date" || key === "venue" || key === "water-activity") add(key, ref);
    else if (key === "water-safety") add(key, ref, done && isKnown(item.owner) ? "담당 지정 · 항목 완료" : undefined);
    else add(key, ref, done ? "체크리스트 완료" : undefined);
  }

  const result = evaluateRetreatPreparation({ editionId: currentEdition, year, meeting, facts, completedTaskIds: [...completedTaskIds] });
  const hasWater = facts.some(fact => fact.key === "water-activity");
  const waterEnabled = result.fields.some(field => field.key === "water-activity" && field.status === "confirmed" && field.value === true);
  return {
    year, next: result.next.map(labelTask),
    deferred: result.deferred.filter(task => task.id !== "check-water-safety" || waterEnabled).map(labelTask),
    fields: result.fields.filter(field => field.key !== "meals" && (field.key !== "water-activity" || hasWater) && (field.key !== "water-safety" || waterEnabled)).map(({ refs, ...field }) => ({
      ...field, evidence: refs.includes("saved-location") ? "location" as const : refs.includes("approved-transport") ? "transport" as const
        : refs.some(ref => ref.startsWith("calendar-")) ? "calendar" as const : refs.includes("room-date") ? "room" as const : refs.length ? "checklist" as const : null,
    })),
  };
}

export function handleRetreatPreparation(request: Request, database?: DatabaseSync, now = new Date()): Response {
  try {
    assertSameOrigin(request);
    const db = database ?? getDatabase();
    const actor = requireUser(request, db);
    if (request.headers.get(retreatReviewAccountHeader) !== actor.id) {
      throw new ApiError(409, "접속 계정이 변경되었습니다. 행사방에서 다시 열어 주세요.");
    }
    const query = new URL(request.url).searchParams;
    const roomId = query.get("roomId"), conversationId = query.get("conversationId");
    const meeting = query.get("meeting") ?? "available";
    if ([...new Set(query.keys())].some(key => !["roomId", "conversationId", "meeting"].includes(key) || query.getAll(key).length !== 1) ||
        !id(roomId) || !id(conversationId) || !Object.hasOwn(meetingOptions, meeting)) {
      throw new ApiError(400, "수련회와 대화, 회의 가능 여부를 확인해 주세요.");
    }
    return json(loadRetreatReview(db, actor, { accountId: actor.id, roomId, conversationId }, meeting as MeetingAvailability, now));
  } catch (error) { return errorResponse(error); }
}

export function loadRetreatReview(db: DatabaseSync, actor: Actor, scope: ConversationScope, meeting: MeetingAvailability = "available", now = new Date()): RetreatReview {
    if (actor.id !== scope.accountId) throw new ApiError(404, "이 대화를 확인할 수 없습니다.");
    for (const permission of retreatReviewPermissions) requirePermission(actor, permission);
    const { roomId, conversationId } = scope;
    requireOwnedConversation(db, scope);
    const roomRow = db.prepare("SELECT data_json FROM rooms WHERE id=?").get(roomId);
    const room: unknown = roomRow && JSON.parse(String(roomRow.data_json));
    if (!object(room) || room.category !== "retreat" || typeof room.name !== "string") {
      throw new ApiError(404, "준비 점검은 수련회 행사방에서만 사용할 수 있습니다.");
    }
    const eventRow = db.prepare("SELECT data_json FROM records WHERE key=? AND room_id=? AND owner_id IS NULL AND kind='events'")
      .get(`preparation:${roomId}:events`, roomId) as Saved;
    const privateRecord = (kind: "checklist" | "location" | "transport"): Saved =>
      db.prepare("SELECT data_json FROM records WHERE key=? AND room_id=? AND owner_id=? AND kind=?")
        .get(canonicalPrivateTool(scope, kind), roomId, actor.id, kind) as Saved;
    const locationRecord = privateRecord("location");
    let location = "";
    if (locationRecord) {
      try { location = readConversationPlaces(JSON.parse(String(locationRecord.data_json)))[0] ?? ""; }
      catch { /* An unreadable location cannot confirm the venue. */ }
    }
    const transportRecord = privateRecord("transport");
    let approvedTransport = false;
    if (transportRecord) {
      try {
        const value: unknown = JSON.parse(String(transportRecord.data_json));
        validateRecord("transport", value);
        approvedTransport = object(value) && value.approved === true && value.demo !== true && value.input.people.length > 0;
      } catch { /* An unreadable or stale draft is not an approved allocation. */ }
    }
    const review = buildReview(
      { date: room.date, name: room.name }, readItems<CalendarEvent>(eventRow, "events"),
      readItems<ChecklistItem>(privateRecord("checklist"), "checklist"), location, approvedTransport, meeting, now,
    );
    return { roomId, conversationId, ...review, references: readRetreatReferences(db, actor, scope, review.next) };
}

export function summarizeRetreatReview(review: RetreatReview): string {
  const singleLine = (text: string) => text.replace(/[\x00-\x1F\x7F\u2028\u2029]/g, " ").trim();
  const fields = review.fields.map(field => {
    const state = field.status === "confirmed" ? "확정" : field.status === "deferred" ? "보류" : field.status === "not_applicable" ? "해당 없음" : "미정";
    const value = typeof field.value === "string" && field.status === "confirmed" ? ` (${singleLine(field.value)})` : "";
    return `- ${field.label}: ${state}${value}`;
  });
  const references = review.references?.map(ref => `- ${singleLine(ref.sourceTitle)}: ${singleLine(ref.excerpt)}`) ?? [];
  return [`${review.year}년 준비 점검 · 저장된 기록 기준`, ...fields,
    ...(references.length ? ["", "참고 자료 (올해 확정 정보 아님)", ...references] : []),
    "", ...(review.next.length ? review.next.map(task => `[준비 제안] ${task.label}`) : ["지금 제안할 준비 항목이 없습니다."]),
  ].join("\n");
}
