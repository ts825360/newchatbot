"use client";

import { BedDouble, BusFront, CalendarDays, ChevronRight, MapPin, UsersRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { dataStorage } from "@/lib/backend-client";
import { readConversationPlaces } from "@/lib/conversation-places";
import { privateToolKey, scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { parseTransportSnapshot, type TransportSnapshot } from "@/lib/transport-snapshot";
import { initialLodgingPlan, roomKindLabel, rosterFingerprint, summarizeLodging } from "@/lib/lodging-plan";
import { normalizeCalendarStatus } from "@/lib/calendar-status";
import { validateTransportResult } from "@/lib/transport";
import type { CalendarEvent, EventRoom } from "@/lib/types";
import { readTimetable } from "@/lib/timetable";
import { Badge } from "./ui";

export function WorkspacePreparationRecords({ scope, room, events, onOpenTimetable }: { scope: ConversationScope; room: EventRoom; events: CalendarEvent[]; onOpenTimetable?: () => void }) {
  return <PreparationRecords key={scopeId(scope)} locationKey={privateToolKey(scope, "location")} transportKey={privateToolKey(scope, "transport")}
    timetableKey={privateToolKey(scope, "timetable")} room={room} events={events} onOpenTimetable={onOpenTimetable} />;
}

function PreparationRecords({ locationKey, transportKey, timetableKey, room, events, onOpenTimetable }: {
  locationKey: string; transportKey: string; timetableKey: string; room: EventRoom; events: CalendarEvent[]; onOpenTimetable?: () => void;
}) {
  const [places, setPlaces] = useState<string[] | null>([]);
  const [transport, setTransport] = useState<TransportSnapshot | "error" | null>(null);
  const [timetableCount, setTimetableCount] = useState<number | null>(null);
  useEffect(() => {
    const load = () => {
      try {
        const location = dataStorage(localStorage).getItem(locationKey);
        setPlaces(location ? readConversationPlaces(JSON.parse(location)) : []);
      } catch { setPlaces(null); }
      try {
        const raw = dataStorage(sessionStorage).getItem(transportKey);
        const value = raw ? parseTransportSnapshot(raw) : null;
        setTransport(value?.demo ? null : value);
      } catch { setTransport("error"); }
      try {
        setTimetableCount(readTimetable(dataStorage(localStorage).getItem(timetableKey)).entries.length);
      } catch { setTimetableCount(null); }
    };
    load();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === locationKey || event.key === transportKey || event.key === timetableKey) load();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [locationKey, transportKey, timetableKey]);
  const vehicles = transport && transport !== "error" ? transport.input.vehicles : [];
  const result = transport && transport !== "error" ? transport.result : null;
  const approved = !!transport && transport !== "error" && transport.approved;
  const outdated = !!transport && transport !== "error" && !!result && result.revision !== transport.input.revision;
  const issues = transport && transport !== "error" && result && !approved && !outdated ? validateTransportResult(transport.input, result) : [];
  const selected = approved && result ? vehicles.filter(vehicle => result.usedVehicleIds.includes(vehicle.id)) : vehicles;
  const vehicleStatus = transport === "error" ? "읽기 실패" : approved ? "확정" : outdated ? "재계산 필요" : issues.length ? "승인 전 확인" : result ? "검토 중" : vehicles.length ? "차량 등록" : "미정";
  const people = transport && transport !== "error" ? transport.input.people : [];
  const checked = !!people.length && transport && transport !== "error" && transport.rosterConfirmation === rosterFingerprint(people);
  const lodging = transport && transport !== "error" ? summarizeLodging(people, transport.lodgingPlan ?? initialLodgingPlan(people)) : undefined;
  const lodgingKinds = lodging?.active.length ? (["personal", "family", "group", "existing"] as const).flatMap(kind => {
    const count = lodging.active.filter(r => r.kind === kind).length;
    return count ? [`${roomKindLabel[kind]} ${count}실`] : [];
  }).join(" · ") : "";
  const confirmedEvents = events.filter(item => normalizeCalendarStatus(item.status) === "confirmed").length;
  const period = room.date && room.endDate && room.endDate !== room.date ? `${room.date} ~ ${room.endDate}` : room.date;
  const missing = result && !outdated && !approved ? [
    ...(result.unassignedCount ? [`미배정 ${result.unassignedCount}건`] : []),
    ...(result.unreservedCount ? [`예상 추가 좌석 ${result.unreservedCount}석 부족`] : []),
  ].join(" · ") : "";
  return <section className="mb-5" aria-label="이 대화의 준비 기록">
    <h3 className="mb-2 text-sm font-semibold">이 대화의 준비 기록</h3>
    <div className="workspace-checklist-rows">
      <RecordRow icon={CalendarDays} title="행사 일정" status={period ? "기간 지정" : confirmedEvents ? "확정 일정 있음" : "미정"} positive={!!period || !!confirmedEvents}
        detail={[period, confirmedEvents ? `공동 캘린더 확정 ${confirmedEvents}건` : "", onOpenTimetable && timetableCount !== null ? `내 타임테이블 ${timetableCount}개` : ""].filter(Boolean).join(" · ")}
        onClick={onOpenTimetable} />
      <div className="workspace-checklist-row"><div className="flex flex-wrap items-center gap-2">
        <MapPin size={16} className="text-primary" aria-hidden="true" /><strong className="text-sm">행사 장소</strong><Badge tone={places?.length ? "green" : places === null ? "amber" : "neutral"}>{places?.length ? "등록됨" : places === null ? "읽기 실패" : "미정"}</Badge>
      </div>{!!places?.length && <p className="mt-1 break-words text-xs text-muted-foreground">{places.join(" · ")}</p>}</div>
      <RecordRow icon={UsersRound} title="참가자 명단" status={transport === "error" ? "읽기 실패" : checked ? "확정" : people.length ? "등록됨" : "미정"} positive={!!checked}
        detail={people.length ? `${people.length}명${checked ? "" : " · 참가자 탭에서 확정 가능"}` : ""} />
      <div className="workspace-checklist-row"><div className="flex flex-wrap items-center gap-2">
        <BusFront size={16} className="text-primary" aria-hidden="true" /><strong className="text-sm">차량 배정</strong><Badge tone={approved ? "green" : vehicles.length || transport === "error" ? "amber" : "neutral"}>{vehicleStatus}</Badge>
      </div>{!!vehicles.length && <p className="mt-1 break-words text-xs text-muted-foreground">{approved ? "확정 " : "등록 "}{selected.length}대{selected.length > 0 && ` · ${selected.map(vehicle => vehicle.label).join(", ")}`}</p>}
        {(missing || issues[0]) && <p className="mt-1 text-xs text-danger">{missing || issues[0]}</p>}</div>
      <RecordRow icon={BedDouble} title="숙소 배정" status={transport === "error" ? "읽기 실패" : !lodging?.assigned ? "미정" : lodging.pending === 0 && lodging.numbered === lodging.active.length ? "호수 지정됨" : "배정 중"}
        positive={!!lodging?.assigned && lodging.pending === 0 && lodging.numbered === lodging.active.length}
        detail={lodging && people.length ? [`배정 ${lodging.assigned}/${people.length}명`, lodgingKinds, lodging.active.length ? `호수 지정 ${lodging.numbered}실` : ""].filter(Boolean).join(" · ") : ""} />
    </div>
  </section>;
}

function RecordRow({ icon: Icon, title, status, positive, detail, onClick }: { icon: LucideIcon; title: string; status: string; positive: boolean; detail: string; onClick?: () => void }) {
  const content = <><span className="flex flex-wrap items-center gap-2">
    <Icon size={16} className="text-primary" aria-hidden="true" /><strong className="text-sm">{title}</strong><Badge tone={positive ? "green" : status === "미정" ? "neutral" : "amber"}>{status}</Badge>
    {onClick && <ChevronRight size={16} className="ml-auto text-muted-foreground" aria-hidden="true" />}
  </span>{detail && <span className="mt-1 block break-words text-xs text-muted-foreground">{detail}</span>}</>;
  return onClick ? <button type="button" className="workspace-checklist-row timetable-preparation-link" aria-label="행사 일정 타임테이블 열기" onClick={onClick}>{content}</button>
    : <div className="workspace-checklist-row">{content}</div>;
}
