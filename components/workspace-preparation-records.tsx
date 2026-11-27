"use client";

import { BedDouble, BusFront, CalendarDays, CalendarRange, ChevronRight, ClipboardList, Clock3, Folder, MapPin, UsersRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { backendFetch, dataStorage, isBackendConnected } from "@/lib/backend-client";
import { normalizeCalendarStatus } from "@/lib/calendar-status";
import { readConversationPlaces } from "@/lib/conversation-places";
import { privateToolKey, scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { initialLodgingPlan, summarizeLodging } from "@/lib/lodging-plan";
import { roomDateLabel, validDate } from "@/lib/room-timing";
import { readTimetable } from "@/lib/timetable";
import { parseTransportSnapshot, type TransportSnapshot } from "@/lib/transport-snapshot";
import type { CalendarEvent, EventRoom } from "@/lib/types";
import { Badge } from "./ui";

export type PreparationRecordTarget = "calendar" | "timetable" | "location" | "people" | "transport" | "lodging" | "documents" | "proposals";
export type PreparationReadState = "ready" | "loading" | "error" | "restricted" | "notApplicable";
type Surveys = { drafts: number; forms: number };
type Read<T> = { state: "ready"; value: T } | { state: Exclude<PreparationReadState, "ready">; value?: undefined };
type Props = {
  scope: ConversationScope; room: EventRoom; events: CalendarEvent[]; calendarState?: PreparationReadState;
  documentsState?: PreparationReadState; documentCount?: number; surveyState?: PreparationReadState; surveys?: Surveys;
  active?: boolean; canOpenProposals?: boolean; transportState?: "ready" | "restricted"; onOpen?: (target: PreparationRecordTarget) => void;
};
type ScopedRecords = { places: Read<string[]>; transport: Read<TransportSnapshot | null>; timetable: Read<number> };
const waiting: ScopedRecords = { places: { state: "loading" }, transport: { state: "loading" }, timetable: { state: "loading" } };
const read = <T,>(factory: () => T): Read<T> => {
  try { return { state: "ready", value: factory() }; }
  catch { return { state: "error" }; }
};

export function WorkspacePreparationRecords(props: Props) {
  return <PreparationRecords key={scopeId(props.scope)} {...props} />;
}

function PreparationRecords({ scope, room, events, active = true, calendarState = "ready", documentsState = "ready", documentCount = 0,
  surveys, surveyState, canOpenProposals = true, transportState = "ready", onOpen }: Props) {
  const [records, setRecords] = useState<ScopedRecords>(waiting);
  const server = isBackendConnected();
  const [storedSurveys, setStoredSurveys] = useState<Read<Surveys>>(server ? { state: "loading" } : { state: "ready", value: { drafts: 0, forms: 0 } });
  const locationKey = privateToolKey(scope, "location"), transportKey = privateToolKey(scope, "transport"), timetableKey = privateToolKey(scope, "timetable");
  useEffect(() => {
    const load = () => setRecords({
      places: read(() => { const raw = dataStorage(localStorage).getItem(locationKey); return raw ? readConversationPlaces(JSON.parse(raw)) : []; }),
      transport: transportState === "restricted" ? { state: "restricted" } : read(() => {
        const raw = dataStorage(sessionStorage).getItem(transportKey);
        const parsed = raw ? parseTransportSnapshot(raw) : null;
        return parsed?.demo ? null : parsed;
      }),
      timetable: read(() => readTimetable(dataStorage(localStorage).getItem(timetableKey)).entries.length),
    });
    load();
    const handleStorage = (event: StorageEvent) => { if (!event.key || [locationKey, transportKey, timetableKey].includes(event.key)) load(); };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [locationKey, transportKey, timetableKey, transportState, active]);
  useEffect(() => {
    if (!active || !server || surveyState) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ roomId: scope.roomId, conversationId: scope.conversationId });
    void backendFetch(`/api/preparation-surveys?${query}`, { signal: controller.signal, headers: { "x-preparation-account": scope.accountId } }).then((value: Surveys) => {
      if (![value?.drafts, value?.forms].every(count => Number.isSafeInteger(count) && count >= 0)) throw new Error("Invalid counts");
      if (!controller.signal.aborted) setStoredSurveys({ state: "ready", value });
    }).catch(() => { if (!controller.signal.aborted) setStoredSurveys({ state: "error" }); });
    return () => controller.abort();
  }, [active, server, surveyState, scope.accountId, scope.roomId, scope.conversationId]);

  const transport = records.transport.value;
  const people = transport?.input.people ?? [];
  const vehicles = transport?.input.vehicles.length ?? 0;
  const storedRooms = transport?.lodgingPlan ?? initialLodgingPlan(people);
  const rooms = transport && storedRooms.rooms.length ? summarizeLodging(people, storedRooms) : null;
  const imported = transport?.survey;
  const { drafts, forms } = surveys ?? storedSurveys.value ?? { drafts: 0, forms: 0 };
  const formState = surveyState ?? storedSurveys.state;
  const brokenSurvey = formState !== "ready" ? formState : records.transport.state !== "ready" && records.transport.state !== "restricted" ? records.transport.state : "ready";
  const confirmedEvents = events.filter(item => normalizeCalendarStatus(item.status) === "confirmed").length;
  const periodValid = !room.date || validDate(room.date) && (!room.endDate || validDate(room.endDate) && room.endDate >= room.date);
  const places = records.places.value ?? [];
  const assigned = rooms?.assigned ?? 0;
  const roomCount = rooms?.active.length ?? 0;
  const hasRooms = storedRooms.rooms.length > 0;
  const row = (icon: LucideIcon, title: string, target: PreparationRecordTarget, state: PreparationReadState, registered: boolean, detail?: string) =>
    <RecordRow icon={icon} title={title} state={state} registered={registered} detail={detail} onOpen={onOpen && (target !== "proposals" || canOpenProposals) ? () => onOpen(target) : undefined} />;
  return <section className="workspace-preparation-records" aria-label="준비 기록">
    <h3>준비 기록</h3>
    <p className="workspace-preparation-caption">행사 기능의 데이터 등록 상태</p>
    <ul className="workspace-preparation-record-list">
      {row(CalendarRange, "행사 기간", "calendar", periodValid ? "ready" : "error", !!room.date, room.date && periodValid ? roomDateLabel(room.date, room.endDate) : undefined)}
      {row(CalendarDays, "공동 캘린더", "calendar", calendarState, events.length > 0, events.length ? `${events.length}건 · 확정 ${confirmedEvents}건` : undefined)}
      {row(Clock3, "타임테이블", "timetable", records.timetable.state, !!records.timetable.value, records.timetable.value ? `${records.timetable.value}개 일정` : undefined)}
      {row(MapPin, "행사 장소", "location", records.places.state, places.length > 0, places.length ? `${places.length}곳 · 대표 ${places[0]}` : undefined)}
      {row(ClipboardList, "참가 설문", imported ? "people" : "proposals", drafts || forms || imported ? "ready" : brokenSurvey, !!(drafts || forms || imported),
        [drafts ? `현재 대화 초안 ${drafts}건` : "", forms ? `Google 생성 ${forms}건` : "", imported ? `가져온 응답 ${imported.data.rows.length}건` : "", brokenSurvey === "error" && (drafts || forms || imported) ? "일부 기록 읽기 실패" : ""].filter(Boolean).join(" · "))}
      {row(UsersRound, "참가자 명단", "people", records.transport.state, people.length > 0, people.length ? `${people.length}명` : undefined)}
      {row(BusFront, "차량 배정", "transport", records.transport.state, !!(vehicles || transport?.result), vehicles ? `등록 차량 ${vehicles}대${transport?.result ? " · 배정안 있음" : ""}` : undefined)}
      {row(BedDouble, "숙소 배정", "lodging", records.transport.state, hasRooms, hasRooms ? `${roomCount}실 · 배정 ${assigned}/${people.length}명` : undefined)}
      {row(Folder, "행사 자료", "documents", documentsState, documentCount > 0, documentCount ? `${documentCount}건` : undefined)}
    </ul>
  </section>;
}

const statusLabels = { loading: "조회 중", error: "읽기 실패", restricted: "권한 없음", notApplicable: "해당 없음" } as const;
function RecordRow({ icon: Icon, title, state, registered, detail, onOpen }: { icon: LucideIcon; title: string; state: PreparationReadState; registered: boolean; detail?: string; onOpen?: () => void }) {
  const enabled = onOpen && state !== "restricted" && state !== "notApplicable";
  const content = <><Icon size={17} className="text-primary" aria-hidden="true" /><span className="preparation-record-copy">
    <strong>{title}</strong>{state === "ready" && detail && <span>{detail}</span>}
  </span><Badge tone={state === "error" ? "amber" : state === "ready" && registered ? "blue" : "neutral"}>
    {state === "ready" ? registered ? "등록됨" : "미등록" : statusLabels[state]}
  </Badge>{enabled && <ChevronRight size={15} aria-hidden="true" />}</>;
  return <li aria-label={title}>{enabled ? <button className="preparation-record-row" type="button" aria-label={`${title} 열기`} onClick={onOpen}>{content}</button>
    : <div className="preparation-record-row">{content}</div>}</li>;
}
