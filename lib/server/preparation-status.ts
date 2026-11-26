import type { DatabaseSync } from "node:sqlite";
import type { AdvisorPresentation } from "../chat-advisor";
import { normalizeCalendarStatus } from "../calendar-status";
import { readConversationPlaces } from "../conversation-places";
import type { ConversationScope, PrivateToolKind } from "../conversation-scope";
import { initialLodgingPlan, rosterFingerprint, summarizeLodging } from "../lodging-plan";
import { validDate } from "../room-timing";
import { readTimetable } from "../timetable";
import { parseTransportSnapshot } from "../transport-snapshot";
import type { CalendarEvent, ChatMessage, ChecklistItem } from "../types";
import type { Actor } from "./auth";
import { canonicalWorkspaceTool, inheritWorkspaceRecords, requireOwnedConversation } from "./conversation-scope";
import { ApiError } from "./http";
import { object, validateRecord } from "./record-schema";

type RecordRead<T> = { status: "saved"; value: T } | { status: "absent" | "unreadable" };
const unreadable = "기록을 읽지 못함";
const read = <T>(row: { data_json: unknown } | undefined, parse: (value: string) => T): RecordRead<T> => {
  if (!row) return { status: "absent" };
  try { return { status: "saved", value: parse(String(row.data_json)) }; }
  catch { return { status: "unreadable" }; }
};
const savedItems = <T>(kind: "events" | "checklist", raw: string) => {
  const value: unknown = JSON.parse(raw);
  validateRecord(kind, value);
  return (value as { items: T[] }).items;
};
const shortLine = (text: string) => text.replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, " ").slice(0, 180).trim();

export function loadPreparationStatus(db: DatabaseSync, actor: Actor, scope: ConversationScope): Pick<ChatMessage, "text" | "advisor"> {
  if (actor.id !== scope.accountId) throw new ApiError(404, "이 대화를 확인할 수 없습니다.");
  requireOwnedConversation(db, scope);
  inheritWorkspaceRecords(db, scope);
  const source = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id IS ? AND room_id=? AND kind=?");
  const onRoom = (kind: "events") => source.get(`preparation:${scope.roomId}:events`, null, scope.roomId, kind) as { data_json: unknown } | undefined;
  const onWorkspace = (kind: PrivateToolKind) => source.get(canonicalWorkspaceTool(scope, kind), actor.id, scope.roomId, kind) as { data_json: unknown } | undefined;
  const data: unknown = JSON.parse(String(db.prepare("SELECT data_json FROM rooms WHERE id=?").get(scope.roomId)?.data_json ?? "null"));
  if (!object(data)) throw new ApiError(404, "행사방을 확인할 수 없습니다.");

  const date = typeof data.date === "string" && validDate(data.date) ? data.date : "";
  const end = typeof data.endDate === "string" && validDate(data.endDate) && data.endDate !== date ? data.endDate : "";
  const places = read(onWorkspace("location"), raw => readConversationPlaces(JSON.parse(raw)));
  const timetable = read(onWorkspace("timetable"), readTimetable);
  const calendar = actor.permissions.includes("viewCalendar") ? read(onRoom("events"), raw => savedItems<CalendarEvent>("events", raw)) : null;
  const sharedCount = calendar?.status === "saved" ? calendar.value.filter(event => normalizeCalendarStatus(event.status) === "confirmed").length : 0;
  const place = places.status === "saved" ? places.value[0] : "";
  const timelineDetail = timetable.status === "saved" && timetable.value.entries.length ? `개인 타임테이블 ${timetable.value.entries.length}개`
    : timetable.status === "unreadable" ? `타임테이블 ${unreadable}` : "";
  const schedule = [date ? `행사 기간 ${date}${end ? ` ~ ${end}` : ""}` : "행사 기간 미정",
    calendar?.status === "unreadable" ? `공동 일정 ${unreadable}` : sharedCount ? `공동 일정 확정 ${sharedCount}건` : "",
    timelineDetail, place ? `장소 ${place.slice(0, 64)}` : places.status === "unreadable" ? `장소 ${unreadable}` : "장소 미등록"];

  const canView = actor.permissions.includes("viewChecklist");
  const transport = canView ? read(onWorkspace("transport"), parseTransportSnapshot) : null;
  const real = transport?.status === "saved" && !transport.value.demo ? transport.value : null;
  const people = real?.input.people ?? [];
  const rosterConfirmed = !!people.length && real?.rosterConfirmation === rosterFingerprint(people);
  const transportNote = !transport ? "조회 권한 없음" : transport.status === "unreadable" ? unreadable : "";
  const roster = transportNote || (people.length ? `${people.length}명 등록 · 명단 ${rosterConfirmed ? "확정" : "미확정"}` : "등록된 참가자 없음");
  const lodging = real && summarizeLodging(people, real.lodgingPlan ?? initialLodgingPlan(people));
  const vehicles = real?.input.vehicles.length ?? 0;
  const vehicleState = real?.approved ? "배정 확정"
    : real?.result ? real.result.revision === real.input.revision ? "배정 검토 중" : "재계산 필요" : "배정 미확정";
  const vehicle = vehicles ? `차량 ${vehicles}대 · ${vehicleState}` : "차량 미등록";
  const lodgingDetails = lodging?.active.length
    ? `숙소 ${lodging.active.length}실 · 배정 ${lodging.assigned}/${people.length}명 · 호수 지정 ${lodging.numbered}/${lodging.active.length}실`
    : "숙소 배정 기록 없음";
  const checklist = canView ? read(onWorkspace("checklist"), raw => savedItems<ChecklistItem>("checklist", raw)) : null;
  const items = checklist?.status === "saved" ? checklist.value : [];
  const done = items.filter(item => item.status === "done").length;
  const checklistDetail = !checklist ? "조회 권한 없음" : checklist.status === "unreadable" ? unreadable
    : items.length ? `전체 ${items.length}개 중 ${done}개 완료 · ${items.length - done}개 남음. 전체 행사 완료율과는 별개입니다.` : "등록된 준비 항목 없음";
  const next = !date ? "행사 기간을 먼저 확인해 주세요."
    : people.length && !rosterConfirmed ? "등록된 참가자 명단을 먼저 확정해 주세요."
    : vehicles && !real?.approved ? "차량 배정안을 검토해 주세요."
    : lodging?.active.length && (lodging.pending || lodging.numbered < lodging.active.length) ? "숙소 미배정 인원과 미정 호수를 확인해 주세요."
    : items.length > done ? "남은 체크리스트부터 확인해 주세요." : "아래는 저장된 사실이며 전체 준비가 완료됐다는 뜻은 아닙니다.";
  const rows: AdvisorPresentation["rows"] = [
    { label: "일정·장소", detail: shortLine(schedule.filter(Boolean).join(" · ")) },
    { label: "참가자", detail: roster },
    { label: "차량·숙소", detail: transportNote || `${vehicle} / ${lodgingDetails}` },
    { label: "준비 체크리스트", detail: checklistDetail },
  ];
  return { text: `이 행사방의 공동 일정과 내 준비 기록입니다. ${next}`, advisor: { kind: "plan", title: "저장된 준비 현황", rows, rationale: "", proposals: [] } };
}
