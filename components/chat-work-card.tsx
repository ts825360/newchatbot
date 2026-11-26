"use client";

import { CalendarClock, Check, CircleCheck, ClipboardList, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { flushBackendWrites, hasPendingBackendWrites, isBackendConnected } from "@/lib/backend-client";
import { chatWorkDraft } from "@/lib/chat-work-proposal";
import { privateCalendarSourceId } from "@/lib/chat-calendar";
import type { ConversationScope } from "@/lib/conversation-scope";
import { createPreparationStore, PREPARATION_CHANGED_EVENT, type ProposalApplyResult, type ProposalDecision, type ProposalDraft } from "@/lib/preparation-store";
import { validDate } from "@/lib/room-timing";
import { timetableDate, timetableTime, type Timetable } from "@/lib/timetable";
import type { ChatMessage } from "@/lib/types";
import { Button, Field, inputClass } from "./ui";
import { ChatSurveyProposal } from "./chat-survey-proposal";
import "./chat-work-card.css";

const calendarLabels = new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", weekday: "long" });
const statusLabels = { pending: "승인 대기", accepted: "반영됨", excluded: "거절됨", deferred: "보류됨" } as const;
const calendarDayLabel = (date: string) => {
  if (!validDate(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day, weekday: calendarLabels.format(new Date(`${date}T00:00:00Z`)) };
};

export function ChatWorkCard({ message, scope, onApply, canApprove = true, remember = true }: {
  message: ChatMessage; scope: ConversationScope; onApply: (draft: ProposalDraft) => ProposalApplyResult | Promise<ProposalApplyResult>;
  canApprove?: boolean; remember?: boolean;
}) {
  const draft = useMemo(() => chatWorkDraft(message), [message]);
  const work = message.workProposal;
  if (work?.kind === "survey") return <div className="chat-work-card"><ChatSurveyProposal scope={scope} title={work.title} /></div>;
  if (!work || !draft) return null;
  return <ApprovalCard work={work} initial={draft} scope={scope} onApply={onApply} canApprove={canApprove} remember={remember} />;
}

function ApprovalCard({ work, initial, scope, onApply, canApprove, remember }: {
  work: Exclude<NonNullable<ChatMessage["workProposal"]>, { kind: "survey" }>;
  initial: ProposalDraft; scope: ConversationScope; canApprove: boolean; remember: boolean;
  onApply: (draft: ProposalDraft) => ProposalApplyResult | Promise<ProposalApplyResult>;
}) {
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<ProposalDecision["status"] | null>(null);
  const [selected, setSelected] = useState(() => new Set(initial.checklistItems?.map(item => item.id)));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { accountId, roomId, conversationId } = scope;
  useEffect(() => {
    const scoped = { accountId, roomId, conversationId };
    const store = createPreparationStore(localStorage, roomId, [], scoped);
    const reload = (event?: Event) => {
      const key = event instanceof StorageEvent ? event.key : (event as CustomEvent<{ key?: string }> | undefined)?.detail?.key;
      if (key && key !== store.decisionsKey && (initial.kind !== "calendar" || key !== store.eventsKey)) return;
      try {
        const saved = !hasPendingBackendWrites(new Set([store.decisionsKey])) ? store.loadDecisions().find(item => item.id === initial.id) : undefined;
        const eventId = privateCalendarSourceId("proposal", accountId, conversationId, initial.id);
        const calendar = initial.kind === "calendar" && !hasPendingBackendWrites(new Set([store.eventsKey])) ? store.loadEvents().find(item => item.id === eventId) : undefined;
        setStatus(calendar ? "accepted" : saved?.status ?? "pending");
        if (calendar || saved?.status === "accepted") setDraft({ ...initial, title: calendar?.title ?? saved?.title ?? initial.title, date: calendar?.date ?? saved?.date ?? initial.date,
          time: calendar?.time ?? initial.time });
      } catch (cause) { setError(cause instanceof Error ? cause.message : "제안 상태를 읽지 못했습니다."); }
    };
    reload();
    window.addEventListener(PREPARATION_CHANGED_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => { window.removeEventListener(PREPARATION_CHANGED_EVENT, reload); window.removeEventListener("storage", reload); };
  }, [accountId, roomId, conversationId, initial]);
  const currentItems = draft.checklistItems ?? [];
  const editable = status === "pending" && canApprove && !busy;
  const day = calendarDayLabel(draft.date);
  const heading = work.kind === "calendar" ? "공동 캘린더 추가 제안" : work.kind === "checklist" ? "준비 체크리스트 추가 제안" : "타임테이블 추가 제안";
  const persistDecision = async (next: ProposalDecision["status"], value: ProposalDraft) => {
    if (!remember) return;
    createPreparationStore(localStorage, scope.roomId, [], scope).decide(initial.id, next, next === "excluded" ? "검토자가 반영하지 않음" : "", value.title.trim(), value.date);
    if (isBackendConnected()) await flushBackendWrites();
  };

  async function approve() {
    if (!editable) return;
    const next = { ...draft, title: draft.title.trim(), ...(work.kind === "checklist" && { checklistItems: currentItems.filter(item => selected.has(item.id)) }) };
    if (work.kind === "calendar" && (!day || !next.title)) { setError("일정 제목과 날짜를 확인해 주세요."); return; }
    if (work.kind === "checklist" && (!next.checklistItems?.length || next.checklistItems.some(item => !item.title.trim()))) { setError("반영할 항목을 선택하고 제목을 확인해 주세요."); return; }
    setBusy(true); setError("");
    try {
      const result = await onApply(next);
      if (!(typeof result === "boolean" ? result : result.ok)) { setError(typeof result !== "boolean" && result.error || "제안을 반영하지 못했습니다."); return; }
      const applied = typeof result === "boolean" ? next : result.applied ?? next;
      setStatus("accepted"); setEditing(false); setDraft(applied);
      if (typeof result !== "boolean" && result.recovered) setNotice("이미 저장된 정보를 유지했습니다.");
      try { await persistDecision("accepted", applied); } catch { setNotice("항목은 저장했지만 제안 검토 상태를 저장하지 못했습니다."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "제안을 반영하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function changeDecision(next: "excluded" | "pending") {
    setBusy(true); setError("");
    try { await persistDecision(next, initial); setStatus(next); setEditing(false); } catch (cause) {
      setError(cause instanceof Error ? cause.message : "제안 상태를 저장하지 못했습니다.");
    } finally { setBusy(false); }
  }

  return <section className={`chat-work-card work-${work.kind}`} aria-label={heading}>
    {work.kind === "calendar" ? <div className="chat-work-calendar">
      <div className="chat-work-date" aria-hidden="true">{day ? <><span>{day.month}월</span><strong>{day.day}</strong><span>{day.weekday}</span></> : <CalendarClock size={26} />}</div>
      <div className="chat-work-calendar-main"><h3>{draft.title || "일정 제목 미정"}</h3><p>{day ? `${day.year}년 ${day.month}월 ${day.day}일` : "날짜 미정"} · {draft.time || "시간 미정"}</p><p>공동 캘린더 · 일정 추가 제안</p></div>
      <span className="chat-work-status" data-status={status ?? undefined}>{status ? statusLabels[status] : "상태 확인 중"}</span>
    </div> : <header className="chat-work-heading">
      {work.kind === "checklist" ? <ClipboardList size={22} aria-hidden="true" /> : <CalendarClock size={22} aria-hidden="true" />}
      <h3>{heading}</h3><span className="chat-work-status" data-status={status ?? undefined}>{status ? statusLabels[status] : "상태 확인 중"}</span>
    </header>}
    {editing && work.kind === "calendar" && <div className="chat-work-edit">
      <Field label="일정 제목"><input className={inputClass} maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
      <Field label="날짜"><input className={inputClass} type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></Field>
      <Field label="시간"><input className={inputClass} type="time" value={draft.time ?? ""} onChange={event => setDraft({ ...draft, time: event.target.value })} /></Field>
    </div>}
    {work.kind === "checklist" && <>
      <p className="chat-work-muted">현재 행사 준비 상태를 바탕으로 작성한 초안</p>
      <div className="chat-work-group">
        <h4 className="chat-work-done">확인 완료 <span>{work.confirmed.length}건</span></h4>
        {work.confirmed.length ? <ul>{work.confirmed.map(label => <li key={label}><CircleCheck size={17} aria-hidden="true" /><span>{label}</span></li>)}</ul> : <p className="chat-work-muted">확인된 준비 기록이 없습니다.</p>}
      </div>
      {status !== "accepted" && <div className="chat-work-group">
        <h4>추가 확인 필요 <span>{currentItems.length}건</span></h4>
        {currentItems.length ? <ul>{currentItems.map(item => <li key={item.id}>
          <label className="chat-work-choice"><input type="checkbox" checked={selected.has(item.id)} disabled={!editable} aria-label={item.title || "항목 선택"} onChange={event => {
            const checked = event.target.checked;
            setSelected(current => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next; });
          }} />{!editing && <span>{item.title}</span>}</label>
          {editing && <input className={inputClass} aria-label="항목 제목" maxLength={120} value={item.title} onChange={event => setDraft({ ...draft, checklistItems: currentItems.map(other => other.id === item.id ? { ...item, title: event.target.value } : other) })} />}
        </li>)}</ul> : <p className="chat-work-muted">새로 추가할 항목이 없습니다.</p>}
      </div>}
    </>}
    {work.kind === "timetable" && <TimetablePreview plan={work.plan} />}
    {error && <p className="documents-error" role="alert">{error}</p>}
    {notice && <p className="chat-work-muted" role="status">{notice}</p>}
    {(status === "pending" || status === null) && <footer>
      {work.kind === "checklist" && <p className="chat-work-muted">선택한 {selected.size}개 항목만 체크리스트에 추가합니다.</p>}
      {!canApprove ? <p className="chat-work-muted">이 제안을 반영할 권한이 없습니다.</p> : <div className="chat-work-actions">
        {work.kind !== "calendar" && <Button type="button" variant="outline" disabled={!editable} onClick={() => void changeDecision("excluded")}><X size={15} aria-hidden="true" />거절</Button>}
        {work.kind !== "timetable" && <Button type="button" variant="outline" disabled={!editable} onClick={() => setEditing(!editing)}><Pencil size={15} aria-hidden="true" />{editing ? "수정 닫기" : "수정"}</Button>}
        <Button type="button" variant="primary" disabled={!editable || work.kind === "checklist" && selected.size === 0} onClick={() => void approve()}><Check size={16} aria-hidden="true" />{busy ? "저장 중" : work.kind === "calendar" ? "승인 및 등록" : "승인 및 반영"}</Button>
      </div>}
    </footer>}
    {status === "excluded" && canApprove && <footer><Button type="button" variant="outline" disabled={busy} onClick={() => void changeDecision("pending")}>다시 검토</Button></footer>}
    {status === "accepted" && work.kind === "checklist" && <p className="chat-work-muted">선택한 항목의 반영을 마쳤습니다.</p>}
  </section>;
}

function TimetablePreview({ plan }: { plan: Timetable }) {
  return <div className="chat-work-timetable">
    {Array.from({ length: plan.days }, (_, i) => {
      const day = i + 1, date = plan.startDate ? timetableDate(plan.startDate, day) : "";
      const entries = plan.entries.filter(entry => entry.day === day).sort((a, b) => a.start - b.start);
      return <details open={plan.days <= 2 || day === 1} key={day}><summary>{day}일차{date && ` · ${date}`}<span>{entries.length}개</span></summary>
        <ol>{entries.map(entry => <li key={entry.id}><time>{timetableTime(entry.start)}~{timetableTime(entry.end)}</time><span>{entry.title.replace(/^\[초안\]\s*/, "")}</span></li>)}</ol>
      </details>;
    })}
  </div>;
}
