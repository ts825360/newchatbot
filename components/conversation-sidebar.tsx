"use client";

import { MessageSquare, MoreHorizontal, Pencil, Search, SquarePen, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Conversation } from "@/lib/conversation-store";
import { RoomDialog } from "./room-dialog";
import { Button } from "./ui";

export function ConversationSidebar({ conversations, activeId, disabled, onCreate, onSelect, onRename, onDelete }: {
  conversations: Conversation[]; activeId: string | null; disabled: boolean;
  onCreate: () => void; onSelect: (id: string) => void;
  onRename: (id: string, title: string) => string | null; onDelete: (id: string) => string | null;
}) {
  const [search, setSearch] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const sidebar = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; conversation: Conversation } | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-conversation-menu]")) setMenuId(null);
    };
    const closeMenu = () => setMenuId(null);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, []);
  const visible = conversations.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const close = () => { setDialog(null); setError(""); };
  const confirm = () => {
    if (!dialog) return;
    const result = dialog.kind === "rename" ? onRename(dialog.conversation.id, title) : onDelete(dialog.conversation.id);
    if (result) setError(result); else close();
  };
  return <>
    <div ref={sidebar} className="conversation-sidebar-content" onKeyDown={(event) => { if (event.key === "Escape") setMenuId(null); }}>
      <div className="conversation-heading"><h2 tabIndex={-1}>대화 기록</h2><span>{conversations.length}</span></div>
      <Button className="workspace-new-conversation" variant="outline" type="button" aria-label="새 대화 만들기" disabled={disabled} onClick={() => { setSearch(""); onCreate(); }}><SquarePen size={16} />새 대화</Button>
      <div className="conversation-search"><Search size={14} aria-hidden="true" /><input aria-label="대화 검색" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="대화 검색" /></div>
      <div className="conversation-list">{visible.map((conversation) => <div key={conversation.id} className={`conversation-row ${activeId === conversation.id ? "is-active" : ""}`}>
        <button className="conversation-select" type="button" aria-label={`${conversation.title} 선택`} aria-current={activeId === conversation.id ? "true" : undefined} onClick={() => { setMenuId(null); onSelect(conversation.id); }}><MessageSquare size={15} aria-hidden="true" /><span><strong title={conversation.title}>{conversation.title}</strong><small>{conversation.draft ? "작성 중" : conversation.messages.length ? `${conversation.messages.length}개의 메시지` : "메시지 없음"}</small></span></button>
        <div className="conversation-menu-anchor" data-conversation-menu><button className="workspace-icon-button" type="button" aria-label={`${conversation.title} 작업`} title="대화 작업" aria-expanded={menuId === conversation.id} onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuPosition({ left: Math.max(8, rect.right - 160), top: Math.min(rect.bottom + 6, window.innerHeight - 94) });
          setMenuId(menuId === conversation.id ? null : conversation.id);
        }}><MoreHorizontal size={16} /></button>
          {menuId === conversation.id && createPortal(<div className="conversation-menu" style={menuPosition} data-conversation-menu role="group" aria-label="대화 작업" onKeyDown={(event) => { if (event.key === "Escape") setMenuId(null); }}><button type="button" onClick={() => { setTitle(conversation.title); setError(""); setDialog({ kind: "rename", conversation }); setMenuId(null); }}><Pencil size={14} aria-hidden="true" />이름 변경</button><button type="button" onClick={() => { setError(""); setDialog({ kind: "delete", conversation }); setMenuId(null); }}><Trash2 size={14} aria-hidden="true" />대화 삭제</button></div>, sidebar.current?.closest(".workspace-shell") ?? document.body)}
        </div>
      </div>)}{!visible.length && <div className="conversation-empty"><p>{search ? "검색 결과가 없습니다" : "대화가 없습니다"}</p>{search && <button type="button" onClick={() => setSearch("")}>검색 지우기</button>}</div>}</div>
    </div>
    {dialog && <RoomDialog title={dialog.kind === "rename" ? "대화 이름 변경" : "대화 삭제"} onClose={close}><form onSubmit={(event) => { event.preventDefault(); confirm(); }}>
      <div className="room-dialog-body">{dialog.kind === "rename" ? <div className="auth-field"><label htmlFor="conversation-title">대화 이름</label><input id="conversation-title" className="auth-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} autoFocus /></div> : <><p className="room-delete-name">{dialog.conversation.title}</p><p className="room-delete-copy">이 대화와 여기에 저장한 자료를 삭제합니다. 공동 캘린더에 저장한 일정은 남습니다.</p></>}{error && <p className="auth-error-summary" role="alert">{error}</p>}</div>
      <footer className="room-dialog-footer"><Button type="button" variant="outline" onClick={close} autoFocus={dialog.kind === "delete"}>취소</Button><Button type="submit" variant={dialog.kind === "delete" ? "danger" : "primary"}>{dialog.kind === "rename" ? "저장" : "삭제하기"}</Button></footer>
    </form></RoomDialog>}
  </>;
}
