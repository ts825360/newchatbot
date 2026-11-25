"use client";

import { useMemo, useState } from "react";
import { chatRosterPersonId, mergeChatRoster, parseChatRoster, sameRosterName, type ChatRosterSource } from "@/lib/chat-tool-candidates";
import type { ConversationScope } from "@/lib/conversation-scope";
import { resolveTripEntry, validateTransportInput, type TransportInput } from "@/lib/transport";
import { RoomDialog } from "./room-dialog";
import { Badge, Button, Field, inputClass } from "./ui";

export function ChatRosterDialog({ scope, source, input, onApply, onClose }: {
  scope: ConversationScope; source: ChatRosterSource; input: TransportInput; onApply: (next: TransportInput) => Promise<void>; onClose: () => void;
}) {
  const [text, setText] = useState(source.text);
  const [selection, setSelection] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    try { return { rows: parseChatRoster(text), error: "" }; }
    catch (cause) { return { rows: [], error: cause instanceof Error ? cause.message : "명단 형식을 확인해 주세요." }; }
  }, [text]);
  const rows = preview.rows.map(row => {
    const already = input.people.some(person => person.id === chatRosterPersonId(scope, source.id, row.row));
    const duplicate = !already && (input.people.some(person => sameRosterName(person.name, row.name)) ||
      preview.rows.some(other => other.row !== row.row && sameRosterName(other.name, row.name)));
    const unresolved = !row.outbound || !row.return || resolveTripEntry(input.trips, "outbound", row.outbound) === undefined || resolveTripEntry(input.trips, "return", row.return) === undefined;
    return { row, already, duplicate, unresolved, selected: !already && (selection[row.row] ?? !duplicate) };
  });
  const selected = rows.filter(item => item.selected).map(item => item.row);
  const close = () => { if (!busy) onClose(); };
  const save = async () => {
    if (!selected.length || busy) return;
    const next = mergeChatRoster(input, scope, source.id, selected);
    const issues = validateTransportInput(next, { draft: true });
    if (issues.length) { setError(issues.join(" ")); return; }
    setBusy(true); setError("");
    try { await onApply(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "참가자를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <RoomDialog title="채팅 명단 가져오기" onClose={close}>
    <div className="room-dialog-body grid min-w-0 gap-4">
      <Field label="참가자 원문"><textarea className={inputClass} rows={4} value={text} maxLength={24_000} disabled={busy}
        placeholder="이름,소속,출발 팀,귀가편" onChange={event => { setText(event.target.value); setSelection({}); setError(""); }} /></Field>
      {(error || preview.error) && <p role="alert" className="documents-error">{error || preview.error}</p>}
      {!!rows.length && <div className="min-w-0 overflow-x-auto"><table aria-label="추가할 참가자 미리보기" className="w-full border-collapse text-left text-sm">
        <thead className="bg-muted text-muted-foreground"><tr>{["추가", "이름", "소속", "출발 팀", "귀가편", "확인"].map(title => <th key={title} scope="col" className="p-2">{title}</th>)}</tr></thead>
        <tbody>{rows.map(({ row, already, duplicate, unresolved, selected }) => <tr key={row.row} className="border-b border-border">
          <td className="p-2"><input type="checkbox" checked={selected} disabled={busy || already} aria-label={`${row.name} (${row.row + 1}행) 추가`}
            onChange={event => { const checked = event.target.checked; setSelection(current => ({ ...current, [row.row]: checked })); setError(""); }} /></td>
          <td className="p-2" title={row.familyId ? `가족 ID: ${row.familyId}` : undefined}>{row.name}</td><td className="p-2">{row.department || "미분류"}</td>
          <td className="p-2">{row.outbound || "미정"}</td><td className="p-2">{row.return || "미정"}</td>
          <td className="p-2">{already ? <Badge tone="green">이미 추가됨</Badge> : <div className="flex flex-wrap gap-1">{duplicate && <Badge tone="amber">동명이인 확인</Badge>}{unresolved && <Badge tone="amber">이동편 확인</Badge>}</div>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
    <footer className="room-dialog-footer"><Button type="button" variant="outline" disabled={busy} onClick={close}>취소</Button>
      <Button type="button" variant="primary" disabled={busy || !selected.length} onClick={() => void save()}>{busy ? "저장 중" : `${selected.length}명 추가`}</Button></footer>
  </RoomDialog>;
}
