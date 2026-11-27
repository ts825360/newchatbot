import { CalendarDays, ChevronRight, MapPin } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { dataStorage } from "@/lib/backend-client";
import { readConversationPlaces } from "@/lib/conversation-places";
import { privateToolKey, type ConversationScope } from "@/lib/conversation-scope";
import { calendarStatusDisplay, normalizeCalendarStatus } from "@/lib/calendar-status";
import { normalizeCalendarTime, resolveCalendarHours, storedCalendarHours } from "@/lib/calendar-time";
import { koreaDate } from "@/lib/devotions";
import type { CalendarEvent } from "@/lib/types";
import { Badge } from "./ui";
import { WorkspaceBrandMark } from "./workspace-brand-mark";

type CalendarPreview = { state: "ready"; items: readonly CalendarEvent[] } | { state: "loading" | "error" };
export type WorkspaceOverviewData = { calendar?: CalendarPreview; onEvent: (id: string) => void };
const byDate = (left: string, right: string) => left.localeCompare(right);
const dateLabel = (value: string) => value.replaceAll("-", ".");
function stillUpcoming(event: CalendarEvent, today: string, now: Date) {
  if (event.date !== today) return event.date > today;
  if (!normalizeCalendarTime(event.time)) return true;
  const hours = resolveCalendarHours(event.time, event.endTime ?? "");
  return !hours || hours.nextDay || Date.parse(`${event.date}T${hours.end}:00+09:00`) > now.getTime();
}

export function WorkspaceOverview({ event, scope, calendar, onCalendar, onEvent, progress, hidden }: WorkspaceOverviewData & {
  event: { name: string; period: string; status: string };
  scope: ConversationScope | null;
  onCalendar: () => void;
  progress?: ReactNode;
  hidden?: boolean;
}) {
  const now = new Date();
  const today = koreaDate(now);
  const upcoming = calendar?.state === "ready"
    ? calendar.items.filter(item => stillUpcoming(item, today, now))
      .sort((a, b) => byDate(a.date, b.date) || byDate(normalizeCalendarTime(a.time) || "24:00", normalizeCalendarTime(b.time) || "24:00"))
    : [];
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

  return <div className="workspace-overview-content" hidden={hidden}>
      <section className="workspace-overview-event" aria-label="행사 정보">
        <header><h3><WorkspaceBrandMark size={18} />{event.name}</h3></header>
        <p><CalendarDays size={15} aria-hidden="true" />{event.period || "일정 미정"}{event.period && <Badge tone="neutral">{event.status}</Badge>}</p>
        {scope && <OverviewLocation key={privateToolKey(scope, "location")} recordKey={privateToolKey(scope, "location")} />}
      </section>
      {progress}
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
