import { CalendarDays, ChevronRight, Circle, CircleCheck, ListChecks, MapPin } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { dataStorage } from "@/lib/backend-client";
import { readConversationPlaces } from "@/lib/conversation-places";
import { privateToolKey, type ConversationScope } from "@/lib/conversation-scope";
import { calendarStatusDisplay, normalizeCalendarStatus } from "@/lib/calendar-status";
import { normalizeCalendarTime, resolveCalendarHours, storedCalendarHours } from "@/lib/calendar-time";
import { koreaDate } from "@/lib/devotions";
import type { CalendarEvent, ChecklistItem } from "@/lib/types";
import { Badge } from "./ui";
import { WorkspaceBrandMark } from "./workspace-brand-mark";

type Preview<T> = { state: "ready"; items: readonly T[] } | { state: "loading" | "error" | "noConversation" };
export type WorkspaceOverviewData = { calendar?: Preview<CalendarEvent>; checklist?: Preview<ChecklistItem>; onEvent: (id: string) => void };
const statusCopy = {
  risk: { label: "누락 위험", tone: "red", order: 0 },
  needsReview: { label: "확인 필요", tone: "amber", order: 1 },
  inProgress: { label: "진행 중", tone: "blue", order: 2 },
  done: { label: "완료", tone: "green", order: 3 },
} as const;
const byDate = (left: string, right: string) => left.localeCompare(right);
const dateLabel = (value: string) => value.replaceAll("-", ".");
function stillUpcoming(event: CalendarEvent, today: string, now: Date) {
  if (event.date !== today) return event.date > today;
  if (!normalizeCalendarTime(event.time)) return true;
  const hours = resolveCalendarHours(event.time, event.endTime ?? "");
  return !hours || hours.nextDay || Date.parse(`${event.date}T${hours.end}:00+09:00`) > now.getTime();
}

export function WorkspaceOverview({ event, scope, calendar, checklist, onCalendar, onChecklist, onEvent, renderProgress }: WorkspaceOverviewData & {
  event: { name: string; period: string; status: string };
  scope: ConversationScope | null;
  onCalendar: () => void;
  onChecklist: () => void;
  renderProgress?: (checklist: ReactNode) => ReactNode;
}) {
  const now = new Date();
  const today = koreaDate(now);
  const upcoming = calendar?.state === "ready"
    ? calendar.items.filter(item => stillUpcoming(item, today, now))
      .sort((a, b) => byDate(a.date, b.date) || byDate(normalizeCalendarTime(a.time) || "24:00", normalizeCalendarTime(b.time) || "24:00"))
    : [];
  const unfinished = checklist?.state === "ready" ? checklist.items.filter(item => item.status !== "done")
    .sort((a, b) => statusCopy[a.status].order - statusCopy[b.status].order || byDate(a.due || "9999", b.due || "9999")) : [];
  const taskCount = checklist?.state === "ready" ? checklist.items.length : 0;
  const done = checklist?.state === "ready" ? checklist.items.filter(item => item.status === "done") : [];
  const visibleTasks = [...done.slice(0, unfinished.length ? 2 : 5), ...unfinished].slice(0, 5);

  const checklistPreview = checklist && <section className="overview-checklist" aria-label="이 대화의 준비">
    <header><h3>{!renderProgress && <ListChecks size={18} aria-hidden="true" />}이 대화의 준비{taskCount > 0 && <small>{done.length} / {taskCount} 완료</small>}</h3>
      <button type="button" className="overview-link" onClick={onChecklist}>체크리스트 보기<ChevronRight size={14} aria-hidden="true" /></button></header>
    {checklist.state !== "ready" ? <p className="overview-empty" role="status">{checklist.state === "loading" ? "준비 항목을 불러오는 중…" : checklist.state === "noConversation" ? "대화를 선택하면 준비 항목을 볼 수 있어요." : "준비 항목을 불러오지 못했습니다."}</p>
      : visibleTasks.length ? <ul className="overview-records overview-checklist-rows">{visibleTasks.map(item => <li className="overview-task" key={item.id} data-next={item.id === unfinished[0]?.id} data-done={item.status === "done"}>
        {item.status === "done" ? <CircleCheck size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
        <span className="overview-record-label"><strong>{item.title}</strong>{item.due && <small>마감 <time dateTime={item.due}>{dateLabel(item.due)}</time></small>}</span>
        <Badge tone={statusCopy[item.status].tone}>{statusCopy[item.status].label}</Badge>
      </li>)}</ul> : <p className="overview-empty">등록된 준비 항목이 없어요.</p>}
  </section>;

  const calendarSection = calendar && <section aria-label="공동 캘린더">
        <header><h3><CalendarDays size={18} aria-hidden="true" />다가오는 일정</h3>
          <button type="button" className="overview-link" onClick={onCalendar}>전체 일정 보기<ChevronRight size={14} aria-hidden="true" /></button></header>
        {calendar.state !== "ready" ? <p className="overview-empty" role="status">{calendar.state === "loading" ? "일정을 불러오는 중…" : "일정을 불러오지 못했습니다."}</p>
          : upcoming.length ? <ul className="overview-records">{upcoming.slice(0, 2).map(event => {
            const status = calendarStatusDisplay[normalizeCalendarStatus(event.status)];
            return <li key={event.id}><button type="button" className="overview-event" onClick={() => onEvent(event.id)}>
              <time className="overview-day" dateTime={event.date} title={dateLabel(event.date)}><span>{Number(event.date.slice(5, 7))}월</span><b>{Number(event.date.slice(8, 10))}</b></time>
              <span className="overview-record-label"><strong>{event.title}</strong><small>{storedCalendarHours(event)}</small></span>
              <Badge tone={status.tone}>{status.label}</Badge>
            </button></li>;
          })}</ul> : <p className="overview-empty">다가오는 일정이 없어요.</p>}
      </section>;

  return <div className="workspace-overview-content">
      <section className="workspace-overview-event" aria-label="행사 정보">
        <header><h3><WorkspaceBrandMark size={18} />{event.name}</h3></header>
        <p><CalendarDays size={15} aria-hidden="true" />{event.period || "일정 미정"}{event.period && <Badge tone="neutral">{event.status}</Badge>}</p>
        {scope && <OverviewLocation key={privateToolKey(scope, "location")} recordKey={privateToolKey(scope, "location")} />}
      </section>
      {renderProgress ? renderProgress(checklistPreview) : checklistPreview}
      {calendarSection}
  </div>;
}

function OverviewLocation({ recordKey }: { recordKey: string }) {
  const [name, setName] = useState("");
  useEffect(() => {
    const load = () => {
      try {
        const raw = dataStorage(localStorage).getItem(recordKey);
        setName(raw ? readConversationPlaces(JSON.parse(raw))[0] ?? "" : "");
      } catch { setName(""); }
    };
    const handleStorage = (event: StorageEvent) => { if (event.key === recordKey || event.key === null) load(); };
    load();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [recordKey]);
  return name ? <p><MapPin size={15} aria-hidden="true" />{name}</p> : null;
}
