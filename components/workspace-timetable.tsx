"use client";

import { CalendarClock, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { dataStorage, flushBackendWrites, isBackendConnected } from "@/lib/backend-client";
import { privateToolKey, type ConversationScope } from "@/lib/conversation-scope";
import { writeBrowserRecord } from "@/lib/storage-status";
import {
  isTimetable, placeTimetableEntries, readTimetable, timetableDate, timetableKinds, timetableMaxDays,
  timetableMaxEntries, timetableMidnight, timetableMinDuration, timetableMorning, timetableTime,
  type Timetable, type TimetableEntry, type TimetableKind,
} from "@/lib/timetable";
import { RoomDialog } from "./room-dialog";
import { Button, Field, inputClass } from "./ui";

const kindLabel: Record<TimetableKind, string> = { program: "프로그램", meal: "식사", travel: "이동" };
const hours = Array.from({ length: (timetableMidnight - timetableMorning) / 60 }, (_, i) => timetableMorning + 60 * i);
const minutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
const dayIndexes = (days: number) => Array.from({ length: days }, (_, i) => i + 1);
const slotLabel = (entry: TimetableEntry) => `${timetableTime(entry.start)}–${timetableTime(entry.end)}`;
const span = timetableMidnight - timetableMorning;
const dayLabel = (start: string, day: number) => {
  const date = timetableDate(start, day);
  return date ? date.slice(5).replace("-", ".") : "";
};

export function WorkspaceTimetable({ scope, canEdit }: { scope: ConversationScope; canEdit: boolean }) {
  const key = privateToolKey(scope, "timetable");
  const [plan, setPlan] = useState<Timetable | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [day, setDay] = useState(1);
  const [editing, setEditing] = useState<TimetableEntry | null>(null);
  const [pending, setPending] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function load() {
      try {
        setPlan(readTimetable(dataStorage(localStorage).getItem(key)));
        setLoadFailed(false);
      } catch {
        setPlan(null);
        setLoadFailed(true);
        setEditing(null);
      }
    }
    function refresh(event: StorageEvent) { if (event.key === null || event.key === key) load(); }
    load();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [key]);

  async function finishWrite() {
    if (!isBackendConnected()) return;
    setPending(true);
    try {
      await flushBackendWrites();
      setWriteFailed(false);
      setError("");
    } catch (cause) {
      setWriteFailed(true);
      setError(cause instanceof Error ? cause.message : "타임테이블을 저장하지 못했습니다.");
    } finally { setPending(false); }
  }

  function save(next: Timetable): boolean {
    if (!canEdit || !plan || pending || writeFailed) return false;
    if (!isTimetable(next)) {
      setError("행사 날짜 또는 일정의 입력 범위를 확인해 주세요.");
      return false;
    }
    try {
      const storage = dataStorage(localStorage);
      const latest = readTimetable(storage.getItem(key));
      if (JSON.stringify(latest) !== JSON.stringify(plan)) {
        setPlan(latest);
        setError("타임테이블이 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.");
        setEditing(null);
        return false;
      }
      writeBrowserRecord(storage, key, next, "browser");
      setPlan(next);
      setError("");
      window.dispatchEvent(new StorageEvent("storage", { key }));
      void finishWrite();
      return true;
    } catch { setError("타임테이블을 저장하지 못했습니다. 다시 시도해 주세요."); return false; }
  }

  if (!plan) return <p className="timetable-feedback" role={loadFailed ? "alert" : "status"}>{loadFailed ? "저장된 타임테이블을 읽을 수 없습니다." : "타임테이블을 불러오는 중…"}</p>;
  const activeDay = Math.min(day, plan.days);
  const days = dayIndexes(plan.days);
  const editable = canEdit && !pending && !writeFailed;
  const canAdd = editable && plan.entries.length < timetableMaxEntries;

  function add(target: number, start = 9 * 60) {
    if (!canAdd) return;
    setError("");
    setEditing({ id: crypto.randomUUID(), day: target, start, end: start + 60, title: "", kind: "program" });
  }

  const edit = (entry: TimetableEntry) => { if (editable) { setError(""); setEditing(entry); } };
  const early = plan.entries.filter(entry => entry.start < timetableMorning).sort((a, b) => a.day - b.day || a.start - b.start);

  return <section className="timetable" aria-label="이 대화의 타임테이블">
    <header className="timetable-heading">
      <div className="timetable-identity">
        <CalendarClock aria-hidden="true" size={22} />
        <div><h3>타임테이블</h3><p>이 대화에만 저장 · 일정 {plan.entries.length}개</p></div>
      </div>
      <div className="timetable-actions">
        <label className="timetable-control">기간
          <select aria-label="기간" className={inputClass} value={plan.days} disabled={!editable} onChange={event => {
            const value = Number(event.target.value);
            if (plan.entries.some(entry => entry.day > value)) {
              setError("줄이려는 날짜에 일정이 있습니다. 해당 일정을 먼저 옮기거나 삭제해 주세요.");
              return;
            }
            if (save({ ...plan, days: value })) setDay(Math.min(activeDay, value));
          }}>
            {dayIndexes(timetableMaxDays).map(value => <option key={value} value={value}>{value === 1 ? "당일" : `${value - 1}박 ${value}일`}</option>)}
          </select>
        </label>
        <label className="timetable-control">시작일
          <input aria-label="시작일" className={inputClass} type="date" value={plan.startDate} disabled={!editable} onChange={event => save({ ...plan, startDate: event.target.value })} />
        </label>
      </div>
      <Button type="button" variant="primary" className="timetable-add" disabled={!canAdd} onClick={() => add(activeDay)}><Plus size={16} aria-hidden="true" />일정 추가</Button>
    </header>
    {pending && <p className="timetable-feedback" role="status">저장 중…</p>}
    {error && !editing && <div className="timetable-feedback">
      <p role="alert">{error}</p>
      {writeFailed && <Button type="button" variant="outline" disabled={pending} onClick={() => void finishWrite()}>다시 저장</Button>}
    </div>}
    <div className="timetable-mobile-nav">
      <Button type="button" variant="outline" aria-label="이전 날짜" disabled={activeDay === 1} onClick={() => setDay(activeDay - 1)}><ChevronLeft size={18} /></Button>
      <select aria-label="표시할 날짜" className={inputClass} value={activeDay} onChange={event => setDay(Number(event.target.value))}>
        {days.map(value => <option key={value} value={value}>{value}일차 {dayLabel(plan.startDate, value)}</option>)}
      </select>
      <Button type="button" variant="outline" aria-label="다음 날짜" disabled={activeDay === plan.days} onClick={() => setDay(activeDay + 1)}><ChevronRight size={18} /></Button>
    </div>
    {!!early.length && <details className="timetable-early">
      <summary>07:00 이전 일정 <span>{early.length}개</span></summary>
      <ul>{early.map(entry => <li key={entry.id}>
        <button type="button" disabled={!editable} onClick={() => edit(entry)}><span>{entry.day}일차 · {slotLabel(entry)}</span><strong>{entry.title}</strong></button>
      </li>)}</ul>
    </details>}
    <div className="timetable-scroll" role="region" aria-label="시간표 그리드" tabIndex={0}>
      <div className="timetable-board" style={{ "--timetable-days": plan.days } as React.CSSProperties}>
        <div className="timetable-axis" aria-hidden="true">
          <div className="timetable-day-heading">시간</div>
          <div className="timetable-track">{hours.map(hour => <span key={hour}>{timetableTime(hour)}</span>)}</div>
          <div className="timetable-end">00:00</div>
        </div>
        {days.map(value => <section key={value} aria-label={`${value}일차`} className={`timetable-day ${activeDay === value ? "is-current" : ""}`}>
          <div className="timetable-day-heading">
            <strong>{value}일차</strong><span>{dayLabel(plan.startDate, value)}</span>
            {canEdit && <button type="button" className="workspace-icon-button" aria-label={`${value}일차 일정 추가`} title={`${value}일차 일정 추가`} disabled={!canAdd} onClick={() => add(value)}><Plus size={15} /></button>}
          </div>
          <div className="timetable-track">
            {hours.map(hour => <button key={hour} type="button" className="timetable-hour" tabIndex={-1} disabled={!canAdd}
              aria-label={`${value}일차 ${timetableTime(hour)} 일정 추가`} onClick={() => add(value, hour)}><Plus size={16} aria-hidden="true" /></button>)}
            {placeTimetableEntries(plan.entries.filter(entry => entry.day === value)).filter(({ duration }) => duration >= timetableMinDuration).map(({ entry, top, duration, lane, lanes }) =>
              <button key={entry.id} type="button" className="timetable-block" data-kind={entry.kind} data-short={duration < 60}
                style={{ top: `${100 * top / span}%`, height: `${100 * duration / span}%`, insetInlineStart: `${100 * lane / lanes}%`, width: `${100 / lanes}%` }}
                disabled={!editable} title={`${slotLabel(entry)} · ${kindLabel[entry.kind]} · ${entry.title}`}
                aria-label={`${value}일차 ${slotLabel(entry)} ${entry.title}`} onClick={() => edit(entry)}>
                <strong>{entry.title}</strong><span>{slotLabel(entry)}</span>
              </button>)}
          </div>
        </section>)}
      </div>
    </div>
    {editing && <EntryDialog entry={editing} days={plan.days} existing={plan.entries.some(item => item.id === editing.id)} error={error}
      onClose={() => { setEditing(null); setError(""); }}
      onSave={entry => {
        if (save({ ...plan, entries: [...plan.entries.filter(item => item.id !== entry.id), entry] })) { setDay(entry.day); setEditing(null); }
      }}
      onDelete={() => { if (save({ ...plan, entries: plan.entries.filter(item => item.id !== editing.id) })) setEditing(null); }} />}
  </section>;
}

function EntryDialog({ entry, days, existing, error, onClose, onSave, onDelete }: {
  entry: TimetableEntry; days: number; existing: boolean; error: string; onClose: () => void;
  onSave: (entry: TimetableEntry) => void; onDelete: () => void;
}) {
  const [validation, setValidation] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = minutes(String(form.get("start")));
    const clockEnd = minutes(String(form.get("end")));
    const end = clockEnd === 0 ? timetableMidnight : clockEnd;
    const title = String(form.get("title")).trim();
    if (!title || !Number.isFinite(start) || !Number.isFinite(end) || end - start < timetableMinDuration) {
      setValidation("일정명과 시간을 확인해 주세요. 일정은 같은 일차에서 최소 15분이어야 합니다.");
      return;
    }
    setValidation("");
    onSave({ ...entry, title, start, end, day: Number(form.get("day")), kind: form.get("kind") as TimetableKind });
  }
  return <RoomDialog title={existing ? "타임테이블 일정 수정" : "타임테이블 일정 추가"} onClose={onClose} className="timetable-dialog">
    <form className="timetable-form" onSubmit={submit}>
      <Field label="일정명"><input name="title" className={inputClass} defaultValue={entry.title} maxLength={120} required autoFocus /></Field>
      <div className="timetable-form-pair">
        <Field label="일차"><select aria-label="일차" name="day" className={inputClass} defaultValue={entry.day}>{dayIndexes(days).map(value => <option key={value} value={value}>{value}일차</option>)}</select></Field>
        <Field label="유형"><select aria-label="유형" name="kind" className={inputClass} defaultValue={entry.kind}>{timetableKinds.map(kind => <option key={kind} value={kind}>{kindLabel[kind]}</option>)}</select></Field>
        <Field label="시작 시간"><input name="start" type="time" className={inputClass} defaultValue={timetableTime(entry.start)} required /></Field>
        <Field label="종료 시간" hint="00:00은 이 일차의 끝입니다."><input name="end" type="time" className={inputClass} defaultValue={timetableTime(entry.end)} required /></Field>
      </div>
      {(validation || error) && <p className="text-sm text-danger" role="alert">{validation || error}</p>}
      {deleteConfirm && <p className="text-sm" role="alert">이 일정을 삭제할까요?</p>}
      <footer className="timetable-form-actions">
        {existing && <Button type="button" variant={deleteConfirm ? "danger" : "ghost"} onClick={() => deleteConfirm ? onDelete() : setDeleteConfirm(true)}><Trash2 size={15} aria-hidden="true" />{deleteConfirm ? "일정 삭제 확인" : "삭제"}</Button>}
        <Button type="button" variant="outline" onClick={deleteConfirm ? () => setDeleteConfirm(false) : onClose}>취소</Button>
        {!deleteConfirm && <Button type="submit" variant="primary">저장</Button>}
      </footer>
    </form>
  </RoomDialog>;
}
