import type { DatabaseSync } from "node:sqlite";
import { normalizeCalendarStatus } from "../calendar-status";
import type { ConversationScope, PrivateToolKind } from "../conversation-scope";
import { initialLodgingPlan, rosterFingerprint, summarizeLodging } from "../lodging-plan";
import { ROOM_CATEGORIES, type RoomCategory } from "../room-catalog";
import { validDate } from "../room-timing";
import { readTimetable } from "../timetable";
import { parseTransportSnapshot } from "../transport-snapshot";
import type { CalendarEvent, ChecklistItem } from "../types";
import type { Actor } from "./auth";
import { canonicalWorkspaceTool, requireOwnedConversation } from "./conversation-scope";
import { ApiError } from "./http";
import { object, validateRecord } from "./record-schema";
import { readWorkspacePlaces } from "./workspace-primary-place";
import { readPreparationSurveyCounts } from "./preparation-surveys";
import type { ConversationPlaceCategory } from "../conversation-places";
import { readCurrentSurveyTask } from "./chat-work-store";
import { publicSurveyWorkState } from "./chat-survey-work-state";

type Evidence<T> = { state: "saved"; facts: T } | { state: "not_recorded" | "unreadable" | "not_authorized" };
const denied = { state: "not_authorized" } as const;
const read = <T>(raw: unknown, project: (value: string) => T): Evidence<T> => {
  if (typeof raw !== "string") return { state: "not_recorded" };
  try { return { state: "saved", facts: project(raw) }; }
  catch { return { state: "unreadable" }; }
};
const stateOnly = <T>(evidence: Evidence<T>) => ({ state: evidence.state });

export const preparationFactsAction = "preparation-facts-used";
export const preparationFactsTool = {
  type: "function", name: "get_preparation_status", strict: true,
  description: "Read safe preparation evidence: shared calendar, your current workspace's aggregates, and the private survey work status in this conversation. Indicators are not confirmations of publication or completion. Does not expose notes or search external services, historical records or documents.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} as const;

export function readPreparationFacts(db: DatabaseSync, actor: Actor, scope: ConversationScope) {
  if (actor.id !== scope.accountId) throw new ApiError(404, "이 대화를 확인할 수 없습니다.");
  requireOwnedConversation(db, scope);
  const room: unknown = JSON.parse(String(db.prepare("SELECT data_json FROM rooms WHERE id=?").get(scope.roomId)?.data_json ?? "null"));
  if (!object(room)) throw new ApiError(404, "행사방을 확인할 수 없습니다.");
  const source = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id IS ? AND room_id=? AND kind=?");
  const local = (kind: PrivateToolKind) => source.get(canonicalWorkspaceTool(scope, kind), actor.id, scope.roomId, kind)?.data_json;
  const canPlan = actor.permissions.includes("viewChecklist");
  const transport = canPlan ? read(local("transport"), raw => {
    const record = parseTransportSnapshot(raw);
    if (record.demo) return null;
    const { people, vehicles } = record.input;
    const lodging = summarizeLodging(people, record.lodgingPlan ?? initialLodgingPlan(people));
    return {
      participants: { registered: people.length, confirmed: !!people.length && record.rosterConfirmation === rosterFingerprint(people) },
      vehicles: { registered: vehicles.length, allocation: record.approved ? "approved" : record.result ? record.result.revision === record.input.revision ? "draft" : "outdated" : "not_recorded" },
      lodging: { rooms: lodging.active.length, assigned: lodging.assigned, pending: lodging.pending, numbered: lodging.numbered },
    };
  }) : denied;
  const places = readWorkspacePlaces(db, scope);
  const categories: Partial<Record<ConversationPlaceCategory, number>> = {};
  if (places.state === "saved") for (const entry of places.record.placeMetadata ?? []) {
    if (entry.category) categories[entry.category] = (categories[entry.category] ?? 0) + 1;
  }
  const venue = places.state === "saved" ? { state: "saved", count: places.names.length, categories, privateNotesIncluded: false }
    : { state: places.state === "absent" ? "not_recorded" : places.state };
  const survey = readPreparationSurveyCounts(db, actor, scope);
  const surveyTask = readCurrentSurveyTask(db, scope);
  const timetable = read(local("timetable"), raw => {
    const { days, entries } = readTimetable(raw);
    return { days, program: entries.filter(entry => entry.kind === "program").length,
      meals: entries.filter(entry => entry.kind === "meal").length, travel: entries.filter(entry => entry.kind === "travel").length };
  });
  const calendar = actor.permissions.includes("viewCalendar") ? read(source.get(`preparation:${scope.roomId}:events`, null, scope.roomId, "events")?.data_json, raw => {
    const parsed = JSON.parse(raw) as { items: CalendarEvent[] };
    validateRecord("events", parsed);
    return { count: parsed.items.length, confirmed: parsed.items.filter(item => normalizeCalendarStatus(item.status) === "confirmed").length };
  }) : denied;
  const checklist = canPlan ? read(local("checklist"), raw => {
    const parsed = JSON.parse(raw) as { items: ChecklistItem[] };
    validateRecord("checklist", parsed);
    return { count: parsed.items.length, done: parsed.items.filter(item => item.status === "done").length };
  }) : denied;
  const documents = db.prepare("SELECT count(*) AS count FROM conversation_files WHERE owner_id=? AND room_id=? AND conversation_id=?")
    .get(actor.id, scope.roomId, scope.conversationId);
  const snapshot = transport.state === "saved" ? transport.facts : null;
  return {
    event: { category: typeof room.category === "string" && Object.hasOwn(ROOM_CATEGORIES, room.category) ? ROOM_CATEGORIES[room.category as RoomCategory] : null,
      startDate: validDate(room.date) ? room.date : null, endDate: validDate(room.endDate) ? room.endDate : null },
    venue, survey, surveyWork: surveyTask ? publicSurveyWorkState(surveyTask) : { found: false },
    participants: snapshot?.participants ?? stateOnly(transport), vehicles: snapshot?.vehicles ?? stateOnly(transport),
    lodging: snapshot?.lodging ?? stateOnly(transport), timetable, calendar, checklist,
    documents: { available: Number(documents?.count ?? 0), contentsRead: false },
    pastRecords: "not_searched", mealReservations: "not_checked", budget: "not_checked",
  };
}
