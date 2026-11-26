"use client";
import { isBackendConnected } from "@/lib/backend-client";
import { internalChatAction } from "@/lib/assistant-privacy";

import { CalendarDays, CalendarPlus, ChevronDown, ClipboardCheck, ListPlus, LoaderCircle, LockKeyhole, Paperclip, RefreshCw, Send, UserRound, UsersRound } from "lucide-react";
import { chatProposalCandidates, type ChatRosterSource } from "@/lib/chat-tool-candidates";
import { isAdvisorPresentation } from "@/lib/chat-advisor";
import { venueHistoryReplyAction } from "@/lib/retreat-venue-history";
import type { ConversationScope } from "@/lib/conversation-scope";
import { RetreatVenueHistory } from "./retreat-venue-history";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Conversation } from "@/lib/conversation-store";
import type { ChatMessage } from "@/lib/types";
import { WorkspaceBrandMark } from "./workspace-brand-mark";
import { BlankGoogleFormLink } from "./google-forms-sharing";

type TurnActions = {
  onReviewProposals?: (replyId?: string) => void;
  onAddCalendarEvent?: (message: ChatMessage) => void;
  canAddCalendarEvent?: (message: ChatMessage) => boolean;
  onAddChecklist?: (message: ChatMessage) => void;
  onImportRoster?: (source: ChatRosterSource) => void;
  retreatVenueScope?: ConversationScope;
};

type ComposerProps = {
  conversation: Conversation | null;
  onDraftChange: (text: string) => void; onSendMessage: (text: string) => void;
  replyStartedAt?: number | null; onRetryReply?: () => void;
  onManageConsent?: () => void;
  onOpenDocuments: () => void;
  onImportRoster?: (source: ChatRosterSource) => void;
};

export function ChatPanel({ conversation, visible = true, onDraftChange, onSendMessage, replyStartedAt, onRetryReply, onManageConsent, onNewConversation, onOpenDocuments, shortcuts, progress, ...actions }:
  ComposerProps & TurnActions & { visible?: boolean; onNewConversation: () => void; shortcuts?: ReactNode; progress?: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const lastScrolled = useRef<{ id?: string; count?: number }>({});
  const id = conversation?.id, count = conversation?.messages.length;
  const server = isBackendConnected();
  const showHeading = Boolean(count || conversation && conversation.title !== "새 대화");
  useLayoutEffect(() => {
    if (!visible || !scroll.current || lastScrolled.current.id === id && lastScrolled.current.count === count) return;
    scroll.current.scrollTop = scroll.current.scrollHeight;
    lastScrolled.current = { id, count };
  }, [id, count, visible]);
  return <section className="workspace-chat" aria-label="개인 대화">
    {(showHeading || progress) && <header className={`workspace-chat-heading${showHeading ? "" : " is-untitled"}`}><div className="workspace-reading-width">
      {showHeading && <h2>{conversation?.title ?? "대화 선택"}</h2>}
      <div className="workspace-chat-heading-actions">{progress}{!!count && <BlankGoogleFormLink className="workspace-icon-button" iconOnly />}{showHeading && <span><LockKeyhole size={13} aria-hidden="true" />개인 대화</span>}</div>
    </div></header>}
    <div className="workspace-messages" ref={scroll} role="log" aria-label="대화 내용" aria-live="polite">
      {conversation?.messages.length ? <div className="workspace-message-list">{conversation.messages.map((message, index) => (
        <MessageTurn key={message.id} message={message} previous={conversation.messages[index - 1]} server={server} actions={actions} />
      ))}</div> : <div className="workspace-chat-empty"><div className="workspace-empty-symbol" role="img" aria-label="행사비서 로고"><WorkspaceBrandMark size={42} /></div>
        {showHeading ? <h3>무엇을 도와드릴까요?</h3> : <h2>{conversation ? "무엇을 도와드릴까요?" : "대화를 시작하세요"}</h2>}
        {conversation ? shortcuts : <button type="button" className="workspace-start-button" onClick={onNewConversation}>새 대화 만들기</button>}
      </div>}
    </div>
    <Composer conversation={conversation} onDraftChange={onDraftChange} onSendMessage={onSendMessage} replyStartedAt={replyStartedAt} onRetryReply={onRetryReply} onManageConsent={onManageConsent} onOpenDocuments={onOpenDocuments} onImportRoster={actions.onImportRoster} server={server} />
  </section>;
}

function MessageTurn({ message, previous, server, actions }: { message: ChatMessage; previous?: ChatMessage; server: boolean; actions: TurnActions }) {
  const { onReviewProposals, onAddCalendarEvent, canAddCalendarEvent, onAddChecklist, onImportRoster, retreatVenueScope } = actions;
  const assistant = message.sender === "assistant";
  const count = server && assistant && onReviewProposals ? chatProposalCandidates(previous ? [previous, message] : [message]).length : 0;
  const review = assistant && onReviewProposals && (!server || count > 0)
    ? <button type="button" className="workspace-review-link" aria-controls="workspace-tools" onClick={() => onReviewProposals(server ? message.id : undefined)}><ClipboardCheck size={15} aria-hidden="true" />{server ? `제안 검토 ${count}건` : "샘플 제안 검토"}</button>
    : null;
  return <article className={`workspace-message ${assistant ? "from-assistant" : "from-user"}`}>
    <span className="workspace-message-avatar" aria-hidden="true">{assistant ? <WorkspaceBrandMark size={19} /> : <UserRound size={17} />}</span>
    <div className="workspace-message-content">
      <div className="workspace-message-meta"><strong>{assistant ? "행사비서" : "나"}</strong>
        {assistant && !server && <span className="workspace-sample-label">샘플 응답</span>}
        {message.actions?.includes(internalChatAction) && <span className="workspace-sample-label">내부 기록</span>}
      </div>
      <MessageBody message={message} review={review} />
      {retreatVenueScope && assistant && message.actions?.includes(venueHistoryReplyAction) &&
        <RetreatVenueHistory scope={retreatVenueScope} question={previous?.sender === "user" ? previous.text : ""} />}
      {!assistant && <div className="workspace-message-actions">
        {onAddCalendarEvent && canAddCalendarEvent?.(message) && <button type="button" className="workspace-icon-button" aria-label="일정으로 추가" title="일정으로 추가" onClick={() => onAddCalendarEvent(message)}><CalendarPlus size={16} aria-hidden="true" /></button>}
        {onAddChecklist && <button type="button" className="workspace-icon-button" aria-label="준비 항목으로 추가" title="준비 항목으로 추가" onClick={() => onAddChecklist(message)}><ListPlus size={16} aria-hidden="true" /></button>}
        {onImportRoster && <button type="button" className="workspace-icon-button" aria-label="참가자 명단으로 가져오기" title="참가자 명단으로 가져오기" onClick={() => onImportRoster(message)}><UsersRound size={16} aria-hidden="true" /></button>}
      </div>}
    </div>
  </article>;
}

function ReplyActivity({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  const seconds = Math.floor(Math.max(0, now - startedAt) / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <span className="workspace-reply-activity" role="status"><LoaderCircle size={14} aria-hidden="true" /><span>답변 작성 중</span>
    <span aria-hidden="true">·</span><span className="workspace-reply-elapsed" aria-hidden="true">{seconds}초</span></span>;
}

function Composer({ conversation, onDraftChange, onSendMessage, replyStartedAt, onRetryReply, onManageConsent, onOpenDocuments, onImportRoster, server }: ComposerProps & { server: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = replyStartedAt != null;
  const send = () => {
    const value = conversation?.draft.trim();
    if (!value || busy) return;
    onSendMessage(value);
    input.current?.focus();
  };
  return <footer className="workspace-composer-area">
        <form className="workspace-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <div className="workspace-composer-tools"><button type="button" className="workspace-icon-button" aria-label="자료 열기" title="자료 열기" onClick={onOpenDocuments}><Paperclip size={18} aria-hidden="true" /></button>
            {onImportRoster && conversation?.draft.trim() && !busy && <button type="button" className="workspace-icon-button" aria-label="전송 없이 참가자 가져오기" title="전송 없이 참가자 가져오기" onClick={() => onImportRoster({ id: `draft:${conversation.draft}`, text: conversation.draft, fromDraft: true })}><UsersRound size={17} aria-hidden="true" /></button>}
          </div>
          <textarea ref={input} aria-label="메시지" placeholder="메시지를 입력하세요" value={conversation?.draft ?? ""} onChange={(event) => onDraftChange(event.target.value)} disabled={!conversation || busy} maxLength={8000} rows={1} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); }
          }} />
          <button type="submit" className="workspace-send" aria-label="전송" title="전송" disabled={busy || !conversation?.draft.trim()}><Send size={17} aria-hidden="true" /></button>
        </form>
        <div className="workspace-composer-caption">{replyStartedAt != null ? <ReplyActivity key={replyStartedAt} startedAt={replyStartedAt} /> : onManageConsent
          ? <button type="button" className="workspace-consent-link" aria-label="OpenAI 전송 동의 관리" onClick={onManageConsent}><LockKeyhole size={12} aria-hidden="true" />외부 전송 동의됨</button>
          : <span role="status">{server && <LockKeyhole size={12} aria-hidden="true" />}{server ? "첫 외부 전송 전 동의" : "화면 체험용 · 샘플 응답"}</span>}
          {!busy && onRetryReply && <div><button type="button" className="workspace-start-button gap-2" onClick={onRetryReply}><RefreshCw size={14} aria-hidden="true" />답변 다시 요청</button></div>}
        </div>
      </footer>;
}

function MessageBody({ message, review }: { message: ChatMessage; review: ReactNode }) {
  const plan = message.advisor;
  if (message.sender !== "assistant" || !isAdvisorPresentation(plan) || plan.kind !== "plan") {
    return <><p className="workspace-message-text">{message.text}</p>{review}</>;
  }
  return <div className="workspace-plan">
    <div className="workspace-plan-heading"><span className="workspace-plan-icon"><CalendarDays size={18} aria-hidden="true" /></span><h3>{plan.title}</h3><span className="workspace-plan-state">검토용</span></div>
    <p className="workspace-message-text">{message.text}</p>
    {plan.rows.length > 0 && <dl className="workspace-plan-rows">{plan.rows.map((row, index) => <div key={index}>
      <dt>{row.label}</dt><dd>{row.detail}</dd>
    </div>)}</dl>}
    {(plan.rationale || review) && <div className="workspace-plan-footer">{plan.rationale && <details className="workspace-plan-rationale">
      <summary><ChevronDown size={14} aria-hidden="true" />추천 근거</summary>
      <p>{plan.rationale}</p>
    </details>}{review}</div>}
  </div>;
}
