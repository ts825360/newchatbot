"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, List, ListChecks, MessageSquare, Pencil, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildCalendarMonth, fromMonthInputValue, shiftCalendarMonth, toMonthInputValue } from "@/lib/calendar-month";
import { calendarStatusDisplay, normalizeCalendarStatus } from "@/lib/calendar-status";
import { normalizeCalendarTime, storedCalendarHours } from "@/lib/calendar-time";
import type { CalendarEvent, ChecklistItem, EventRoom, RiskAlert } from "@/lib/types";
import { Badge, Button, cn } from "./ui";
import { RoomDialog } from "./room-dialog";
import { WorkspacePreparationRecords, type PreparationReadState, type PreparationRecordTarget } from "./workspace-preparation-records";
import type { ConversationScope } from "@/lib/conversation-scope";
import { roomTiming, validDate } from "@/lib/room-timing";
import "./workspace-preparation.css";

const checklistStatusCopy: Record<ChecklistItem["status"], { label: string; tone: "green" | "amber" | "blue" | "red" }> = {
  done: { label: "완료", tone: "green" },
  inProgress: { label: "진행 중", tone: "blue" },
  needsReview: { label: "확인 필요", tone: "amber" },
  risk: { label: "누락 위험", tone: "red" }
};

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const currentMonth = () => {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
};

export function SharedPanel({
  mode = "all",
  scope,
  onOpenTimetable,
  onOpenPreparationRecord,
  preparationState,
  room,
  events,
  checklist,
  risks,
  onOpenEvent,
  onAddEvent,
  canEditEvents = true,
  onRefreshCalendar,
  canEditChecklist = true,
  onToggleChecklist,
  onOpenChecklist,
  onAddChecklist,
  onAskChecklist,
  onResolveRisk
}: {
  mode?: "all" | "calendar" | "prepare";
  scope?: ConversationScope;
  onOpenTimetable?: () => void;
  onOpenPreparationRecord?: (target: PreparationRecordTarget) => void;
  preparationState?: { active: boolean; calendarState: PreparationReadState; documentsState: PreparationReadState; documentCount: number; canOpenProposals: boolean; canReadChecklist: boolean; riskError: boolean; riskReviewed: boolean };
  room: EventRoom;
  events: CalendarEvent[];
  checklist: ChecklistItem[];
  risks: RiskAlert[];
  onOpenEvent: (eventId: string) => void;
  onAddEvent?: (date?: string) => void;
  canEditEvents?: boolean;
  onRefreshCalendar?: () => Promise<void>;
  canEditChecklist?: boolean;
  onToggleChecklist: (itemId: string) => void;
  onOpenChecklist: (itemId: string) => void;
  onAddChecklist?: () => void;
  onAskChecklist?: (item: ChecklistItem) => void;
  onResolveRisk: (riskId: string) => void;
}) {
  const visibleRisks = risks.filter((risk) => !risk.resolved);
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const timing = roomTiming({ date: room.date ?? null, endDate: room.endDate }).key;
  const actionable = mode === "prepare" && preparationState?.canReadChecklist !== false && timing !== "past"
    ? checklist.filter(item => item.status === "risk" || (item.status !== "done" && validDate(item.due) && item.due < today)) : [];
  const outstanding = visibleRisks.length > 0 || actionable.length > 0;
  const riskLabel = outstanding ? "확인 필요" : preparationState?.riskError ? "읽기 실패"
    : preparationState?.canReadChecklist === false ? "권한 없음" : preparationState?.riskReviewed || risks.length > 0 ? "기록된 경고 없음" : "미검토";
  const [showEventList, setShowEventList] = useState(false);
  const listedEvents = useMemo(() => [...events].sort((a, b) => b.date.localeCompare(a.date) || (normalizeCalendarTime(a.time) ?? "").localeCompare(normalizeCalendarTime(b.time) ?? "")), [events]);
  const [calendarPointer, setCalendarPointer] = useState(() => {
    const firstEvent = room.date || events[0]?.date;
    if (!firstEvent) {
      return currentMonth();
    }
    return {
      year: Number(firstEvent.slice(0, 4)),
      month: Number(firstEvent.slice(5, 7))
    };
  });
  useEffect(() => {
    if (room.date) setCalendarPointer({ year: Number(room.date.slice(0, 4)), month: Number(room.date.slice(5, 7)) });
  }, [room.id, room.date]);
  const calendarMonth = useMemo(
    () => buildCalendarMonth(calendarPointer.year, calendarPointer.month),
    [calendarPointer.month, calendarPointer.year]
  );
  const monthEvents = useMemo(() => {
    const first = calendarMonth.cells[0].date;
    const last = calendarMonth.cells[calendarMonth.cells.length - 1].date;
    return events.filter(event => event.date >= first && event.date <= last);
  }, [calendarMonth, events]);

  return (
    <div className={mode === "calendar" ? "workspace-calendar-surface" : "flex h-full min-h-0 flex-col bg-panel"}>
      {mode === "all" ? (
      <header className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">공동 행사 상태</p>
            <h2 className="mt-1 text-lg font-semibold">{room.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              예정일 {room.dateLabel} · {room.dDay}
            </p>
          </div>
          {onAddEvent && <Button className="h-9 w-9 px-0" type="button" variant="outline" onClick={() => onAddEvent()} aria-label="일정 추가">
            <Plus size={18} />
          </Button>}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md bg-muted p-2">
            <p className="font-semibold text-foreground">{events.length}</p>
            <p className="mt-1 text-muted-foreground">일정</p>
          </div>
          <div className="rounded-md bg-muted p-2">
            <p className="font-semibold text-foreground">{checklist.filter((item) => item.status !== "done").length}</p>
            <p className="mt-1 text-muted-foreground">남은 준비</p>
          </div>
          <div className="rounded-md bg-muted p-2">
            <p className="font-semibold text-foreground">{visibleRisks.length}</p>
            <p className="mt-1 text-muted-foreground">주의</p>
          </div>
        </div>
      </header>
      ) : null}

      {mode === "calendar" && <div className="workspace-calendar-actions">
        <p className="text-xs text-muted-foreground">행사 기간 {room.dateLabel}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setShowEventList(true)}><List size={16} aria-hidden="true" />일정 목록</Button>
          {onAddEvent && <Button type="button" variant="outline" onClick={() => onAddEvent()}><Plus size={16} aria-hidden="true" />일정 추가</Button>}
        </div>
      </div>}
      {mode === "calendar" && showEventList && <RoomDialog title="일정 목록" onClose={() => setShowEventList(false)}>
        <div className="room-dialog-body !gap-0">
          {listedEvents.map(event => <CalendarEventRow key={event.id} event={event} withDate canEdit={canEditEvents} onOpen={() => { setShowEventList(false); onOpenEvent(event.id); }} />)}
          {!listedEvents.length && <p className="text-sm text-muted-foreground">등록된 일정이 없습니다.</p>}
        </div>
      </RoomDialog>}

      <div className={mode === "calendar" ? "workspace-calendar-body" : mode === "prepare" ? "workspace-preparation-scroll" : "min-h-0 flex-1 overflow-auto p-4"}>
        <div className={mode === "prepare" ? "workspace-preparation-layout" : undefined}>
        {mode === "prepare" && scope && <WorkspacePreparationRecords scope={scope} room={room} events={events} {...preparationState}
          transportState={preparationState?.canReadChecklist === false ? "restricted" : "ready"}
          onOpen={onOpenPreparationRecord ?? (onOpenTimetable ? target => { if (target === "timetable") onOpenTimetable(); } : undefined)} />}
        {mode !== "calendar" && <section className={mode === "prepare" ? "workspace-preparation-risks" : undefined} aria-label="주의할 항목">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={17} className="text-amber-500" />
              주의할 항목
            </h3>
            <Badge tone={outstanding ? "red" : preparationState?.riskError ? "amber" : "neutral"}>{riskLabel}</Badge>
          </div>
          <div className="grid gap-2">
            {visibleRisks.length > 0 && (
              visibleRisks.map((risk) => (
                <div key={risk.id} className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-500/25 dark:bg-rose-500/10">
                  <p className="font-semibold text-rose-800 dark:text-rose-200">{risk.title}</p>
                  <p className="mt-1 text-rose-700/80 dark:text-rose-100/80">{risk.detail}</p>
                  {canEditChecklist && <div className="mt-3 flex gap-2">
                    <Button className="h-8" type="button" variant="ghost" onClick={() => onResolveRisk(risk.id)}>
                      완료 처리
                    </Button>
                  </div>}
                </div>
              ))
            )}
            {actionable.map(item => <div key={item.id} className="preparation-risk-item"><strong>{item.title}</strong><span>{item.status === "risk" ? "누락 위험으로 표시된 준비 업무" : `마감일 ${item.due} 경과`}</span></div>)}
            {!outstanding && <p className="workspace-preparation-caption">{riskLabel === "미검토" ? "아직 준비 위험 검토 기록이 없습니다." : riskLabel === "기록된 경고 없음" ? "현재 미해결로 기록된 경고가 없습니다." : riskLabel === "읽기 실패" ? "저장된 검토 기록을 불러오지 못했습니다." : "주의할 항목을 볼 권한이 없습니다."}</p>}
          </div>
        </section>}

        {mode !== "prepare" && <section className={mode === "all" ? "mt-6" : ""}>
          <MonthlyCalendar
            calendarMonth={calendarMonth}
            monthEvents={monthEvents}
            monthInputValue={toMonthInputValue(calendarPointer)}
            onPreviousMonth={() => setCalendarPointer((current) => shiftCalendarMonth(current, -1))}
            onNextMonth={() => setCalendarPointer((current) => shiftCalendarMonth(current, 1))}
            onMonthInputChange={(value) => setCalendarPointer(fromMonthInputValue(value))}
            onToday={() => setCalendarPointer(currentMonth())}
            onRefresh={onRefreshCalendar}
            roomPeriod={room.date ? { start: room.date, end: room.endDate || room.date } : undefined}
            onOpenEvent={onOpenEvent}
            canEditEvents={canEditEvents}
            onAddEvent={onAddEvent}
          />
        </section>}

        {mode !== "calendar" && <section className={mode === "prepare" ? "workspace-preparation-tasks" : "mt-6"} aria-label="준비 체크리스트">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ListChecks size={17} className="text-primary" />
              준비 체크리스트
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              <Badge>{checklist.filter((item) => item.status !== "done").length}개 남음</Badge>
              {canEditChecklist && onAddChecklist && <button type="button" className="workspace-icon-button" aria-label="준비 항목 추가" title="준비 항목 추가" onClick={onAddChecklist}><Plus size={17} /></button>}
            </div>
          </div>
          <div className="workspace-checklist-rows">
            {checklist.map((item) => {
              const status = checklistStatusCopy[item.status];
              const details = <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-semibold">{item.title}</p>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">담당 {item.owner || "미지정"} · 마감 {item.due || "미정"}</p>
              </>;
              return (
                <div key={item.id} className="workspace-checklist-row">
                  <div className="flex items-start gap-3">
                    {canEditChecklist && <button
                      className={cn(
                        "workspace-checklist-toggle mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border transition",
                        item.status === "done" ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"
                      )}
                      type="button"
                      onClick={() => onToggleChecklist(item.id)}
                      aria-label={`${item.title} 상태 변경`}
                      aria-pressed={item.status === "done"}
                    >
                      {item.status === "done" ? <CheckCircle2 size={15} /> : null}
                    </button>}
                    {canEditChecklist
                      ? <button className="min-w-0 flex-1 text-left" type="button" aria-label={`${item.title} 수정`} onClick={() => onOpenChecklist(item.id)}>{details}</button>
                      : <div className="min-w-0 flex-1">{details}{item.memo && <p className="mt-1 whitespace-pre-wrap break-words text-xs">{item.memo}</p>}</div>}
                    {onAskChecklist && <button type="button" className="workspace-icon-button shrink-0" aria-label={`${item.title} AI 작업 요청`} title="AI 작업 요청을 채팅에 작성" onClick={() => onAskChecklist(item)}><MessageSquare size={16} aria-hidden="true" /></button>}
                  </div>
                </div>
              );
            })}
            {!checklist.length && <p className="text-sm text-muted-foreground">{preparationState?.canReadChecklist === false ? "준비 항목을 볼 권한이 없습니다." : "준비 항목이 없습니다."}</p>}
          </div>
        </section>}

        {mode === "all" && <section className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock3 size={17} className="text-primary" />
            최근 공동 변경
          </h3>
          <div className="grid gap-2">
            {events.slice(0, 4).map((event) => {
              const badge = calendarStatusDisplay[normalizeCalendarStatus(event.status)];
              return (
              <button
                key={event.id}
                className="rounded-md border border-border bg-background p-3 text-left text-sm transition hover:border-primary"
                type="button"
                onClick={() => onOpenEvent(event.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{event.title}</p>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{event.changeLog}</p>
                {event.linkLabel ? (
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    {event.linkLabel}
                    <ExternalLink size={12} />
                  </span>
                ) : null}
              </button>
            );})}
          </div>
        </section>}
        </div>
      </div>
    </div>
  );
}

function CalendarEventRow({ event, withDate, canEdit, onOpen }: { event: CalendarEvent; withDate?: boolean; canEdit: boolean; onOpen: () => void }) {
  const badge = calendarStatusDisplay[normalizeCalendarStatus(event.status)];
  return (
    <button type="button" className="flex items-center justify-between gap-2 border-b border-border px-2 py-3 text-left text-sm last:border-b-0 hover:bg-muted/50" onClick={onOpen} aria-label={`${event.title} ${canEdit ? "확인 및 수정" : "상세 보기"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><strong className="break-words">{event.title}</strong><Badge tone={badge.tone}>{badge.label}</Badge></div>
        <span className="mt-1 block text-xs text-muted-foreground">{withDate && `${event.date} · `}{storedCalendarHours(event)}</span>
      </div>
      {canEdit ? <Pencil size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
    </button>
  );
}

function MonthlyCalendar({
  calendarMonth,
  monthEvents,
  monthInputValue,
  onPreviousMonth,
  onNextMonth,
  onMonthInputChange,
  onToday,
  onRefresh,
  roomPeriod,
  onOpenEvent,
  onAddEvent,
  canEditEvents
}: {
  calendarMonth: ReturnType<typeof buildCalendarMonth>;
  monthEvents: CalendarEvent[];
  monthInputValue: string;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onMonthInputChange: (value: string) => void;
  onToday: () => void;
  onRefresh?: () => Promise<void>;
  roomPeriod?: { start: string; end: string };
  onOpenEvent: (eventId: string) => void;
  onAddEvent?: (date?: string) => void;
  canEditEvents: boolean;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<"" | "loading" | "done" | "failed">("");
  useEffect(() => {
    if (refreshState !== "done") return;
    const timer = window.setTimeout(() => setRefreshState(""), 2500);
    return () => window.clearTimeout(timer);
  }, [refreshState]);
  const refresh = async () => {
    if (!onRefresh || refreshState === "loading") return;
    setRefreshState("loading");
    try { await onRefresh(); setRefreshState("done"); }
    catch { setRefreshState("failed"); }
  };
  const selectedEvents = monthEvents.filter(event => event.date === selectedDate);
  return (
    <div className="workspace-calendar-month">
      <div className="workspace-calendar-month-toolbar" role="group" aria-label="달력 이동">
          <Button className="h-8 w-8 px-0" type="button" variant="ghost" onClick={onPreviousMonth} aria-label="이전 달">
            <ChevronLeft size={17} />
          </Button>
          <input
            aria-label="년도와 달 선택"
            className="h-8 w-[122px] rounded-md border border-[hsl(var(--control-border))] bg-panel px-2 text-xs focus:border-primary"
            type="month"
            value={monthInputValue}
            onChange={(event) => onMonthInputChange(event.target.value)}
            onInput={(event) => onMonthInputChange(event.currentTarget.value)}
          />
          <Button className="h-8 w-8 px-0" type="button" variant="ghost" onClick={onNextMonth} aria-label="다음 달">
            <ChevronRight size={17} />
          </Button>
          <Button className="h-8 shrink-0 whitespace-nowrap px-2" type="button" variant="ghost" onClick={onToday} title="오늘이 있는 달로 이동">
            오늘
          </Button>
          {onRefresh && <Button className="h-8 w-8 shrink-0 px-0" type="button" variant="ghost" onClick={() => void refresh()} disabled={refreshState === "loading"} aria-label="캘린더 새로고침" title="캘린더 새로고침">
            <RefreshCw size={15} className={refreshState === "loading" ? "motion-safe:animate-spin" : ""} aria-hidden="true" />
          </Button>}
      </div>
      {onRefresh && <p className={cn("workspace-calendar-refresh-state text-xs", refreshState === "failed" ? "text-danger" : "text-muted-foreground")} role="status">
        {refreshState === "loading" ? "새로고침 중" : refreshState === "done" ? "새로고침됨" : refreshState === "failed" ? "새로고침 실패. 다시 시도해 주세요." : ""}
      </p>}

      <div className="grid grid-cols-7 border-l border-t border-border text-center text-xs font-semibold text-muted-foreground">
        {weekdays.map((weekday) => (
          <div key={weekday} className="border-b border-r border-border bg-muted/50 py-2">
            {weekday}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 border-l border-border">
        {calendarMonth.cells.map((cell) => {
          const dayEvents = monthEvents.filter((event) => event.date === cell.date);
          const inPeriod = !!roomPeriod && cell.date >= roomPeriod.start && cell.date <= roomPeriod.end;
          return (
            <button
              key={cell.date}
              className={cn(
                "workspace-calendar-day border-b border-r border-border text-left text-xs transition hover:bg-muted",
                cell.inCurrentMonth ? "bg-panel" : "bg-muted/30 text-muted-foreground",
                (dayEvents.length > 0 || inPeriod) && "bg-primary/5"
              )}
              type="button"
              onClick={() => {
                if (dayEvents.length > 1) {
                  setSelectedDate(cell.date);
                } else if (dayEvents[0]) {
                  onOpenEvent(dayEvents[0].id);
                } else {
                  onAddEvent?.(cell.date);
                }
              }}
              aria-label={`${cell.date} 일정 보기`}
              aria-description={dayEvents.length ? `${dayEvents.length}건: ${dayEvents.map(item => item.title).join(", ")}` : undefined}
              disabled={!dayEvents.length && !onAddEvent}
            >
              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full", dayEvents.length > 0 && "bg-primary text-primary-foreground")}>
                {cell.day}
              </span>
              <span className="mt-1 grid gap-1">
                {inPeriod && <span className="workspace-calendar-period rounded border-l-2 border-primary bg-primary/10 px-1 py-0.5 text-[10px] text-primary">행사일</span>}
                {dayEvents.slice(0, 2).map((event) => {
                  const status = normalizeCalendarStatus(event.status);
                  return <span key={event.id} title={`${event.title} · ${calendarStatusDisplay[status].label}`} className={cn("workspace-calendar-event truncate rounded px-1 py-0.5 font-medium", status === "confirmed" ? "bg-primary/10 text-primary" : status === "pending" ? "workspace-calendar-pending" : "bg-muted text-muted-foreground")}>{event.title}</span>;
                })}
                {dayEvents.length > 2 ? <span className="text-muted-foreground">+{dayEvents.length - 2}개 더</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDate && <RoomDialog title={`${selectedDate} 일정`} onClose={() => setSelectedDate(null)}><div className="room-dialog-body">
        {selectedEvents.map(event => <CalendarEventRow key={event.id} event={event} canEdit={canEditEvents} onOpen={() => { setSelectedDate(null); onOpenEvent(event.id); }} />)}
        {!selectedEvents.length && <p className="text-sm text-muted-foreground">등록된 일정이 없습니다.</p>}
      </div><footer className="room-dialog-footer"><Button type="button" variant="outline" onClick={() => setSelectedDate(null)}>닫기</Button>{onAddEvent && <Button type="button" variant="primary" onClick={() => { const date = selectedDate; setSelectedDate(null); onAddEvent(date); }}><Plus size={16} />일정 추가</Button>}</footer></RoomDialog>}
    </div>
  );
}
