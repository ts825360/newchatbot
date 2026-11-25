"use client";

import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { calendarStatusDisplay, isCalendarStatus, normalizeCalendarStatus } from "@/lib/calendar-status";
import { formatCalendarHours, normalizeCalendarTime, resolveCalendarHours, storedCalendarHours } from "@/lib/calendar-time";
import type { CalendarEvent } from "@/lib/types";
import { RoomDialog } from "./room-dialog";
import { Button, Field, inputClass } from "./ui";

export function CalendarEventEditor({ value, editing, readOnly = false, wasConfirmed = false, error, onChange, onSave, onDelete, onClose }: {
  value: CalendarEvent; editing: boolean; readOnly?: boolean; wasConfirmed?: boolean; error: string;
  onChange: (event: CalendarEvent) => void; onSave: () => void;
  onDelete?: () => void; onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const start = normalizeCalendarTime(value.time) ?? "";
  const end = normalizeCalendarTime(value.endTime ?? "") ?? "";
  const automatic = !end ? resolveCalendarHours(value.time, value.endTime ?? "") : null;
  const title = deleting ? "일정 삭제" : editing ? readOnly ? "일정 상세" : "일정 상세 및 수정" : "일정 추가";
  return <RoomDialog title={title} onClose={() => deleting ? setDeleting(false) : onClose()}>
    <form noValidate onSubmit={event => { event.preventDefault(); if (!deleting && !readOnly) onSave(); }}>
      <div className="room-dialog-body">
        {error && <p role="alert" className="documents-error">{error}</p>}
        {deleting ? <p className="room-delete-copy">{value.title} 일정을 삭제할까요?</p> : <>
          <Field label="일정 제목"><input className={inputClass} readOnly={readOnly} value={value.title} maxLength={120} onChange={event => onChange({ ...value, title: event.target.value })} /></Field>
          <Field label="날짜"><input className={`${inputClass} min-w-0`} readOnly={readOnly} type="date" value={value.date} onChange={event => onChange({ ...value, date: event.target.value })} /></Field>
          {readOnly ? <p className="text-sm">{storedCalendarHours(value)}</p> : <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-3">
              <Field label="시작 시간"><input className={`${inputClass} min-w-0`} type="time" step={60} value={start} onChange={event => onChange({ ...value, time: event.target.value })} /></Field>
              <Field label="종료 시간"><input className={`${inputClass} min-w-0`} type="time" step={60} value={end} onChange={event => onChange({ ...value, endTime: event.target.value })} /></Field>
            </div>
            {automatic && <p className="text-xs text-muted-foreground">자동 적용: {formatCalendarHours(automatic)}</p>}
          </div>}
          <Field label="장소"><input className={inputClass} readOnly={readOnly} value={value.location} onChange={event => onChange({ ...value, location: event.target.value })} /></Field>
          <Field label="일정 상태"><select className={inputClass} aria-label="일정 상태" disabled={readOnly} value={normalizeCalendarStatus(value.status)} onChange={event => { const status = event.target.value; if (isCalendarStatus(status)) onChange({ ...value, status }); }}>
            {Object.entries(calendarStatusDisplay).map(([status, entry]) => <option key={status} value={status}>{entry.label}</option>)}
          </select></Field>
          {!readOnly && wasConfirmed && value.status !== "confirmed" && <p className="text-xs text-danger">저장하면 Google에 전송된 이 일정도 삭제됩니다.</p>}
          <Field label="설명"><textarea className={inputClass} readOnly={readOnly} rows={3} value={value.memo} onChange={event => onChange({ ...value, memo: event.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">작성자 {value.author} · 마지막 수정자 {value.lastEditor}</p>
        </>}
      </div>
      <footer className="room-dialog-footer flex-wrap">
        {deleting ? <><Button type="button" variant="outline" onClick={() => setDeleting(false)}>취소</Button><Button type="button" variant="danger" onClick={onDelete}>삭제하기</Button></> : readOnly ? <Button type="button" variant="outline" onClick={onClose}>확인</Button> : <>
          {editing && onDelete && <Button type="button" variant="ghost" className="mr-auto" onClick={() => setDeleting(true)}><Trash2 size={16} />일정 삭제</Button>}
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary"><Save size={16} />저장</Button>
        </>}
      </footer>
    </form>
  </RoomDialog>;
}
