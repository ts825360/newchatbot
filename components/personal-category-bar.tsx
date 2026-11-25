"use client";

import { FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { createPersonalCategories, type PersonalCategory } from "@/lib/personal-categories";
import { RoomDialog } from "./room-dialog";

export function PersonalCategoryBar({ accountId, rooms, onFilter }: { accountId: string; rooms: { id: string; name: string }[]; onFilter: (ids: string[] | null) => void }) {
  const [groups, setGroups] = useState<PersonalCategory[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ id: string | null; name: string; roomIds: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => {
      try { const data = createPersonalCategories(localStorage, accountId).list(); setGroups(data); setActive(id => data.some(g => g.id === id) ? id : null); }
      catch (cause) { setError(message(cause)); }
    };
    refresh(); window.addEventListener("storage", refresh); window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("focus", refresh); };
  }, [accountId]);
  useEffect(() => { onFilter(groups.find(g => g.id === active)?.roomIds ?? null); }, [groups, active, onFilter]);
  const close = () => { setEditor(null); setDeleting(false); setError(""); };
  const save = (event: FormEvent) => {
    event.preventDefault(); if (!editor) return;
    try {
      const store = createPersonalCategories(localStorage, accountId);
      if (editor.id) store.update(editor.id, editor.name, editor.roomIds);
      else { const group = store.create(editor.name, editor.roomIds); setActive(group.id); }
      setGroups(store.list()); close();
    } catch (cause) { setError(message(cause)); }
  };
  const remove = () => {
    if (!editor?.id) return;
    try { setGroups(createPersonalCategories(localStorage, accountId).remove(editor.id)); setActive(null); close(); }
    catch (cause) { setError(message(cause)); }
  };
  const selected = groups.find(g => g.id === active);
  return <div className="personal-category-area">
    <div className="personal-category-row"><span className="personal-category-label"><FolderOpen size={14} aria-hidden="true" />내 분류</span>
      <div className="personal-category-tabs" role="tablist" aria-label="개인 카테고리" onKeyDown={event => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; const index = tabs.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}><button role="tab" type="button" aria-selected={!active} tabIndex={!active ? 0 : -1} onClick={() => setActive(null)}>모든 방</button>{groups.map(g => <button key={g.id} role="tab" type="button" aria-selected={active === g.id} tabIndex={active === g.id ? 0 : -1} onClick={() => setActive(g.id)}>{g.name}<span aria-hidden="true">{g.roomIds.filter(id => rooms.some(r => r.id === id)).length}</span></button>)}</div>
      <button className="lobby-icon-button" type="button" title="카테고리 추가" aria-label="카테고리 추가" onClick={() => { setError(""); setEditor({ id: null, name: "", roomIds: [] }); }}><Plus size={16} /></button>
      <button className="lobby-icon-button" type="button" title="카테고리 편집" aria-label="카테고리 편집" disabled={!selected} onClick={() => selected && setEditor({ ...selected, roomIds: [...selected.roomIds] })}><Pencil size={14} /></button>
    </div>
    {error && !editor && <p className="auth-field-error" role="alert">{error}</p>}
    {editor && <RoomDialog title={deleting ? "카테고리 삭제" : editor.id ? "카테고리 편집" : "카테고리 추가"} onClose={close}>{deleting ? <><div className="room-dialog-body"><p className="room-delete-name">{editor.name}</p><p className="room-delete-copy">이 개인 분류만 삭제합니다. 행사방은 삭제되지 않습니다.</p>{error && <p role="alert" className="auth-error-summary">{error}</p>}</div><footer className="room-dialog-footer"><button className="lobby-secondary" type="button" onClick={() => setDeleting(false)}>취소</button><button className="lobby-danger" type="button" onClick={remove}>삭제하기</button></footer></> : <form onSubmit={save} noValidate><div className="room-dialog-body"><div className="auth-field"><label htmlFor="personal-category-name">카테고리 이름</label><input id="personal-category-name" className="auth-input" maxLength={20} value={editor.name} autoFocus onChange={event => setEditor({ ...editor, name: event.target.value })} /></div><fieldset className="category-room-choices"><legend>포함할 행사방</legend>{rooms.map(room => <label key={room.id}><input type="checkbox" checked={editor.roomIds.includes(room.id)} onChange={event => setEditor({ ...editor, roomIds: event.target.checked ? [...editor.roomIds, room.id] : editor.roomIds.filter(id => id !== room.id) })} /><span>{room.name}</span></label>)}{!rooms.length && <p className="room-delete-copy">등록된 행사방이 없습니다.</p>}</fieldset>{error && <p role="alert" className="auth-error-summary">{error}</p>}</div><footer className="room-dialog-footer">{editor.id && <button className="lobby-icon-button category-delete" type="button" title="카테고리 삭제" aria-label="카테고리 삭제" onClick={() => setDeleting(true)}><Trash2 size={16} /></button>}<button className="lobby-secondary" type="button" onClick={close}>취소</button><button className="lobby-primary" type="submit">저장</button></footer></form>}</RoomDialog>}
  </div>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : "카테고리를 처리하지 못했습니다."; }
