"use client";
import { isBackendConnected } from "@/lib/backend-client";
import { internalChatAction, replyPrivacyNotice } from "@/lib/assistant-privacy";

import { CalendarDays, CalendarPlus, ChevronDown, ClipboardCheck, Copy, Ellipsis, ExternalLink, ListPlus, LoaderCircle, LockKeyhole, MapPin, Paperclip, Pencil, RefreshCw, Reply, Send, UserRound, UsersRound, Utensils, X } from "lucide-react";
import { chatProposalCandidates, type ChatRosterSource } from "@/lib/chat-tool-candidates";
import { isAdvisorPresentation } from "@/lib/chat-advisor";
import { diningMapUrl, isDiningRecommendations, nearbyDirectionsUrl } from "@/lib/chat-dining";
import { venueDirectionsUrl } from "@/lib/chat-venue-route";
import { venueHistoryReplyAction } from "@/lib/retreat-venue-history";
import { eventPublicVenueUsedAction } from "@/lib/assistant-privacy";
import type { ConversationScope } from "@/lib/conversation-scope";
import { RetreatVenueHistory } from "./retreat-venue-history";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Conversation } from "@/lib/conversation-store";
import type { ChatMessage, ChatMessageReference } from "@/lib/types";
import { WorkspaceBrandMark } from "./workspace-brand-mark";
import { BlankGoogleFormLink } from "./google-forms-sharing";

type TurnActions = {
  onReviewProposals?: (replyId?: string) => void;
  onAddCalendarEvent?: (message: ChatMessage) => void;
  canAddCalendarEvent?: (message: ChatMessage) => boolean;
  onAddChecklist?: (message: ChatMessage) => void;
  onImportRoster?: (source: ChatRosterSource) => void;
  onSaveNearbyPlace?: (name: string) => Promise<"added" | "already-saved">;
  retreatVenueScope?: ConversationScope;
};

type ComposerProps = {
  conversation: Conversation | null;
  onDraftChange: (text: string) => void; onSendMessage: (text: string, reference?: ChatMessageReference) => void;
  replyStartedAt?: number | null; onRetryReply?: () => void;
  externalAIApproved?: boolean; privacyNotice?: ReactNode;
  onOpenDocuments: () => void;
  onImportRoster?: (source: ChatRosterSource) => void;
};

type DraftReference = { kind: ChatMessageReference["kind"]; source: ChatMessage; text: string; conversationId: string; count: number };

export function ChatPanel({ conversation, visible = true, onDraftChange, onSendMessage, replyStartedAt, onRetryReply, externalAIApproved, privacyNotice, onNewConversation, onOpenDocuments, shortcuts, progress, ...actions }:
  ComposerProps & TurnActions & { visible?: boolean; onNewConversation: () => void; shortcuts?: ReactNode; progress?: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const lastScrolled = useRef<{ id?: string; count?: number; pending?: boolean }>({});
  const [reference, setReference] = useState<DraftReference | null>(null);
  const id = conversation?.id, count = conversation?.messages.length;
  const activeReference = reference && reference.conversationId === id && reference.count === count ? reference : null;
  const byId = new Map(conversation?.messages.map(item => [item.id, item]));
  const pending = replyStartedAt != null && conversation?.messages.at(-1)?.sender === "user";
  const server = isBackendConnected();
  const showHeading = Boolean(count || conversation && conversation.title !== "새 대화");
  useLayoutEffect(() => {
    if (!visible || !scroll.current || lastScrolled.current.id === id && lastScrolled.current.count === count && lastScrolled.current.pending === pending) return;
    scroll.current.scrollTop = scroll.current.scrollHeight;
    lastScrolled.current = { id, count, pending };
  }, [id, count, pending, visible]);
  return <section className="workspace-chat" aria-label="개인 대화">
    {(showHeading || progress) && <header className={`workspace-chat-heading${showHeading ? "" : " is-untitled"}`}><div className="workspace-reading-width">
      {showHeading && <h2>{conversation?.title ?? "대화 선택"}</h2>}
      <div className="workspace-chat-heading-actions">{progress}{!!count && <BlankGoogleFormLink className="workspace-icon-button" iconOnly />}{showHeading && <span><LockKeyhole size={13} aria-hidden="true" />개인 대화</span>}</div>
    </div></header>}
    <div className="workspace-messages" ref={scroll} role="log" aria-label="대화 내용" aria-live="polite">
      {conversation?.messages.length ? <div className="workspace-message-list">{conversation.messages.map((message, index) => (
        <MessageTurn key={message.id} message={message} previous={conversation.messages[index - 1]} source={message.reference && byId.get(message.reference.messageId)} server={server} actions={actions}
          busy={replyStartedAt != null} onReference={(kind, source) => setReference({ kind, source, text: source.text, conversationId: conversation.id, count: conversation.messages.length })} />
      ))}{pending && <div className="workspace-message from-assistant">
        <span className="workspace-message-avatar" aria-hidden="true"><WorkspaceBrandMark size={19} /></span>
        <ReplyActivity key={replyStartedAt} startedAt={replyStartedAt} />
      </div>}</div> : <div className="workspace-chat-empty"><div className="workspace-empty-symbol" role="img" aria-label="행사비서 로고"><WorkspaceBrandMark size={42} /></div>
        {showHeading ? <h3>무엇을 도와드릴까요?</h3> : <h2>{conversation ? "무엇을 도와드릴까요?" : "대화를 시작하세요"}</h2>}
        {conversation ? shortcuts : <button type="button" className="workspace-start-button" onClick={onNewConversation}>새 대화 만들기</button>}
      </div>}
    </div>
    <Composer conversation={conversation} reference={activeReference} onClearReference={() => setReference(null)} onEditReference={text => setReference(current => current && { ...current, text })} onDraftChange={onDraftChange} onSendMessage={onSendMessage} replyStartedAt={replyStartedAt} onRetryReply={onRetryReply} externalAIApproved={externalAIApproved} privacyNotice={privacyNotice} onOpenDocuments={onOpenDocuments} onImportRoster={actions.onImportRoster} server={server} />
  </section>;
}

function MessageTurn({ message, previous, source, server, actions, busy, onReference }: { message: ChatMessage; previous?: ChatMessage; source?: ChatMessage; server: boolean; actions: TurnActions; busy: boolean; onReference: (kind: ChatMessageReference["kind"], message: ChatMessage) => void }) {
  const { onReviewProposals, retreatVenueScope } = actions;
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
        <MessageActions message={message} actions={actions} busy={busy} onReference={onReference} />
      </div>
      {source && <div className="workspace-message-quote"><strong>{message.reference?.kind === "edit" ? "수정본" : `${source.sender === "assistant" ? "행사비서" : "내 메시지"}에 답장`}</strong><span>{source.text}</span></div>}
      {assistant && message.replyElapsedMs != null && <p className="workspace-reply-elapsed workspace-reply-completed">
        {message.replyElapsedMs < 1000 ? "1초 미만" : `${Math.floor(message.replyElapsedMs / 1000)}초`} 소요
      </p>}
      <MessageBody message={message} review={review} saveNearbyPlace={actions.onSaveNearbyPlace} busy={busy} />
      {assistant && message.actions?.includes(eventPublicVenueUsedAction) && <p className="workspace-reply-elapsed workspace-reply-completed">행사방 대표 장소 참고</p>}
      {retreatVenueScope && assistant && message.actions?.includes(venueHistoryReplyAction) &&
        <RetreatVenueHistory scope={retreatVenueScope} question={previous?.sender === "user" ? previous.text : ""} />}
    </div>
  </article>;
}

function MessageActions({ message, actions, busy, onReference }: { message: ChatMessage; actions: TurnActions; busy: boolean; onReference: (kind: ChatMessageReference["kind"], message: ChatMessage) => void }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [copied, setCopied] = useState("");
  const { onAddCalendarEvent, canAddCalendarEvent, onAddChecklist, onImportRoster } = actions;
  const own = message.sender === "user";
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const actOn = (action: () => void) => { setOpen(false); action(); };
  return <div className="workspace-message-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button type="button" ref={trigger} className="workspace-icon-button" aria-label="메시지 작업" title="메시지 작업" aria-expanded={open} aria-controls={open ? id : undefined} onClick={event => {
      const button = event.currentTarget.getBoundingClientRect();
      const list = event.currentTarget.closest(".workspace-messages")?.getBoundingClientRect();
      setAbove(!!list && list.bottom - button.bottom < 230 && button.top - list.top > list.bottom - button.bottom);
      setCopied(""); setOpen(value => !value);
    }}><Ellipsis size={16} aria-hidden="true" /></button>
    {open && <div id={id} className="workspace-message-options" data-above={above} role="group" aria-label="메시지 작업 선택">
      <button type="button" onClick={() => actOn(() => {
        trigger.current?.focus();
        const plan = message.advisor;
        const text = plan?.kind === "plan" ? [plan.title, message.text, ...plan.rows.map(row => `${row.label}: ${row.detail}`), plan.rationale].filter(Boolean).join("\n") : message.text;
        void (async () => { try { await navigator.clipboard.writeText(text); setCopied("복사됨"); } catch { setCopied("복사 실패"); } })();
      })}><Copy size={15} aria-hidden="true" />복사</button>
      <button type="button" disabled={busy} onClick={() => actOn(() => onReference("reply", message))}><Reply size={15} aria-hidden="true" />답장</button>
      {own && <button type="button" disabled={busy} onClick={() => actOn(() => onReference("edit", message))}><Pencil size={15} aria-hidden="true" />수정</button>}
      {own && onAddCalendarEvent && canAddCalendarEvent?.(message) && <button type="button" disabled={busy} onClick={() => actOn(() => onAddCalendarEvent(message))}><CalendarPlus size={15} aria-hidden="true" />일정으로 추가</button>}
      {own && onAddChecklist && <button type="button" disabled={busy} onClick={() => actOn(() => onAddChecklist(message))}><ListPlus size={15} aria-hidden="true" />준비 항목으로 추가</button>}
      {own && onImportRoster && <button type="button" disabled={busy} onClick={() => actOn(() => onImportRoster(message))}><UsersRound size={15} aria-hidden="true" />참가자 명단으로 가져오기</button>}
    </div>}
    {copied && <span className="workspace-message-copy-status" role="status">{copied}</span>}
  </div>;
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

function Composer({ conversation, reference, onClearReference, onEditReference, onDraftChange, onSendMessage, replyStartedAt, onRetryReply, externalAIApproved, privacyNotice, onOpenDocuments, onImportRoster, server }: ComposerProps & { server: boolean; reference: DraftReference | null; onClearReference: () => void; onEditReference: (text: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = replyStartedAt != null;
  const editing = reference?.kind === "edit";
  const draft = editing ? reference.text : conversation?.draft ?? "";
  const referenceId = reference?.source.id;
  useEffect(() => { if (referenceId) input.current?.focus(); }, [referenceId, reference?.kind]);
  const send = () => {
    const value = draft.trim();
    if (!value || busy) return;
    onSendMessage(value, reference ? { kind: reference.kind, messageId: reference.source.id } : undefined);
    input.current?.focus();
  };
  return <footer className="workspace-composer-area">
        {privacyNotice}
        {reference && <div className="workspace-composer-reference">
          <div className="workspace-message-quote"><strong>{editing ? "내 메시지 수정" : reference.source.sender === "assistant" ? "행사비서에게 답장" : "내 메시지에 답장"}</strong><span>{reference.source.text}</span></div>
          <button type="button" className="workspace-icon-button" aria-label={editing ? "수정 취소" : "답장 취소"} onClick={() => { onClearReference(); input.current?.focus(); }}><X size={16} aria-hidden="true" /></button>
        </div>}
        {reference?.kind === "reply" && server && externalAIApproved && <p className="workspace-composer-caption">{replyPrivacyNotice}</p>}
        <form className="workspace-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <div className="workspace-composer-tools"><button type="button" className="workspace-icon-button" aria-label="자료 열기" title="자료 열기" onClick={onOpenDocuments}><Paperclip size={18} aria-hidden="true" /></button>
            {onImportRoster && !reference && conversation?.draft.trim() && !busy && <button type="button" className="workspace-icon-button" aria-label="전송 없이 참가자 가져오기" title="전송 없이 참가자 가져오기" onClick={() => onImportRoster({ id: `draft:${conversation.draft}`, text: conversation.draft, fromDraft: true })}><UsersRound size={17} aria-hidden="true" /></button>}
          </div>
          <textarea ref={input} aria-label="메시지" placeholder="메시지를 입력하세요" value={draft} onChange={(event) => (editing ? onEditReference : onDraftChange)(event.target.value)} disabled={!conversation || busy} maxLength={8000} rows={1} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); }
          }} />
          <button type="submit" className="workspace-send" aria-label={editing ? "수정하고 다시 보내기" : "전송"} title={editing ? "수정하고 다시 보내기" : "전송"} disabled={busy || !draft.trim()}><Send size={17} aria-hidden="true" /></button>
        </form>
        <div className="workspace-composer-caption">{!busy && (!server || externalAIApproved !== undefined) && <span role="status">{server && <LockKeyhole size={12} aria-hidden="true" />}{!server ? "화면 체험용 · 샘플 응답" : externalAIApproved ? "외부 AI 허용됨" : "외부 AI 꺼짐"}</span>}
          {!busy && onRetryReply && <div><button type="button" className="workspace-start-button gap-2" onClick={onRetryReply}><RefreshCw size={14} aria-hidden="true" />답변 다시 요청</button></div>}
        </div>
      </footer>;
}

function NearbyPlaceApproval({ name, save, disabled }: { name: string; save: NonNullable<TurnActions["onSaveNearbyPlace"]>; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "saving" | "added" | "already-saved">("idle");
  const [error, setError] = useState("");
  async function approve() {
    setState("saving"); setError("");
    try { setState(await save(name)); }
    catch (cause) { setState("idle"); setError(cause instanceof Error ? cause.message : "장소를 저장하지 못했습니다."); }
  }
  return <div className="workspace-place-approval">
    {state === "added" || state === "already-saved" ? <span role="status">{state === "added" ? "장소에 저장했습니다." : "이미 장소 목록에 있습니다."}</span> :
      <button type="button" className="workspace-start-button" disabled={disabled || state === "saving"} onClick={() => void approve()}><MapPin size={15} aria-hidden="true" />{state === "saving" ? "저장 중" : "장소에 저장"}</button>}
    {error && <span role="alert">{error}</span>}
  </div>;
}

function MessageBody({ message, review, saveNearbyPlace, busy }: { message: ChatMessage; review: ReactNode; saveNearbyPlace?: TurnActions["onSaveNearbyPlace"]; busy: boolean }) {
  if (message.sender === "assistant" && isDiningRecommendations(message.dining)) {
    const { kind, venue, checkedAt, restaurants, transportMode, selectedRank } = message.dining;
    const attraction = kind === "attraction";
    const title = attraction ? "주변 관광지 추천" : "주변 식당 추천";
    const modes = { walking: "도보", driving: "차량", transit: "대중교통" } as const;
    const notation = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
    const checked = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(checkedAt));
    return <section className="workspace-plan workspace-dining" aria-label={title}>
      <div className="workspace-plan-heading"><span className="workspace-plan-icon">{attraction ? <MapPin size={17} aria-hidden="true" /> : <Utensils size={17} aria-hidden="true" />}</span><h3>{title}</h3><span className="workspace-plan-state">검색 후보 · 확인 필요</span></div>
      <p className="workspace-message-text">{message.text}</p>
      {message.dining.placeSaveRequested && saveNearbyPlace && <NearbyPlaceApproval name={restaurants[0].name} save={saveNearbyPlace} disabled={busy} />}
      <ol className="workspace-dining-list">{restaurants.map((restaurant, index) => <li key={restaurant.name}>
        <h4><span>{selectedRank ?? index + 1}순위</span>{restaurant.name}</h4>
        <p>{restaurant.reason}</p>
        {restaurant.address && <p className="workspace-dining-facts"><strong>주소</strong> {restaurant.address}</p>}
        <p className="workspace-dining-facts"><strong>{attraction ? "운영시간 (검색 정보)" : "영업시간 (검색 정보)"}</strong> {restaurant.hours}</p>
        {kind && <>
          <p className="workspace-dining-facts"><strong>휴무</strong> {restaurant.closures ?? "미확인"}</p>
          <p className="workspace-dining-facts"><strong>{attraction ? "볼거리·체험" : "추천 메뉴"}</strong> {restaurant.feature ? <>{restaurant.feature.text} <a href={restaurant.feature.source.url} target="_blank" rel="noopener noreferrer">출처</a></> : "미확인"}</p>
          <p className="workspace-dining-facts"><strong>숙소에서 이동 (검색 정보)</strong> {restaurant.route ? <>
            {modes[restaurant.route.mode]} · {restaurant.route.distanceKm === null ? "거리 미확인" : `${notation.format(restaurant.route.distanceKm)}km`} · {restaurant.route.durationMinutes === null ? "시간 미확인" : `약 ${restaurant.route.durationMinutes}분`} <a href={restaurant.route.source.url} target="_blank" rel="noopener noreferrer">경로 출처</a>
          </> : "거리·소요 시간 미확인"}</p>
        </>}
        <p className="workspace-dining-facts"><strong>평점 (검색 정보)</strong>{restaurant.rating ? <> {restaurant.rating.value}/5 · {restaurant.rating.count ? `리뷰 ${restaurant.rating.count.toLocaleString("ko-KR")}개` : "리뷰 수 미확인"} <a href={restaurant.rating.source.url} target="_blank" rel="noopener noreferrer">평점 출처</a></> : " 확인되지 않음"}</p>
        <div className="workspace-dining-links">
          <a href={diningMapUrl(restaurant.name, venue, restaurant.address)} target="_blank" rel="noopener noreferrer"><MapPin size={14} aria-hidden="true" /> 지도에서 찾기</a>
          <a href={nearbyDirectionsUrl(venue, restaurant.name, restaurant.address, restaurant.route?.mode ?? transportMode)} target="_blank" rel="noopener noreferrer"><MapPin size={14} aria-hidden="true" />숙소에서 길찾기</a>
          {restaurant.sources.map((source, index) => <a key={source.url} href={source.url} title={source.label} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />{index === 0 ? attraction ? "운영 출처" : "영업 출처" : `추가 출처 ${index}`}</a>)}
        </div>
      </li>)}</ol>
      <p className="workspace-dining-checked">검색 {checked} (한국 시각) · 출처 링크가 개별 정보의 정확성을 보장하지 않습니다. 실제 영업, 가격과 예약 가능 여부는 방문 전에 확인하세요.</p>
    </section>;
  }
  const plan = message.advisor;
  if (message.sender !== "assistant" || !isAdvisorPresentation(plan) || plan.kind !== "plan") {
    const route = message.sender === "assistant" ? message.venueRoute : undefined;
    const href = route ? venueDirectionsUrl(route) : null;
    return <><p className="workspace-message-text workspace-message-bubble">{message.text}</p>
      {href && <div className="workspace-place-approval">
        <a className="workspace-start-button" href={href} target="_blank" rel="noopener noreferrer"><MapPin size={15} aria-hidden="true" />{route?.origin ? `${route.origin}에서 숙소까지 길찾기` : "Google Maps에서 숙소까지 길찾기"}</a>
        {route?.sources?.map((url, index, sources) => <a className="workspace-start-button" key={url} href={url} target="_blank" rel="noopener noreferrer">경로 참고 출처{sources.length > 1 ? ` ${index + 1}` : ""}</a>)}
      </div>}{review}</>;
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
