"use client";

import { ArrowLeft, CalendarClock, CalendarDays, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hasObviousPrivateData, internalChatAction, openAIChatConsentVersion, openAIPrivacyWarning } from "@/lib/assistant-privacy";
import { createConversationStore, type ConversationHistory } from "@/lib/conversation-store";
import type { ChatMessage, ChatMessageReference, EventRoom, UserProfile } from "@/lib/types";
import { ChatPanel } from "./chat-panel";
import { ConversationSidebar } from "./conversation-sidebar";
import { DocumentsPanel } from "./documents-panel";
import { ConversationLocation } from "./conversation-location";
import { SaveStatus } from "./save-status";
import { SupportButton } from "./support-dialog";
import { SettingsEntry } from "./settings-entry";
import { TransportPanel } from "./transport-panel";
import { BackendError, backendFetch, followBackendConversation, flushBackendWrites, getBackendProfile, getBackendState, isBackendConnected, refreshBackendData } from "@/lib/backend-client";
import { conversationHistoryKey, scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { GoogleCalendarConnection } from "./google-calendar-connection";
import { BlankGoogleFormLink } from "./google-forms-sharing";
import { useToolsResize } from "./workspace-tools-resize";
import { RoomDialog } from "./room-dialog";
import { retreatReviewPermissions } from "@/lib/retreat-preparation";
import { isPreparationChat, isPreparationStatusChat, preparationChatQuery, type ChatRosterSource } from "@/lib/chat-tool-candidates";
import { RetreatPreparationPanel } from "./retreat-preparation-panel";
import { isVenueHistoryChat } from "@/lib/retreat-venue-history";
import { RetreatVenueHistory } from "./retreat-venue-history";
import { roomStage, roomStages, roomTiming } from "@/lib/room-timing";
import { WorkspaceOverview, type WorkspaceOverviewData } from "./workspace-overview";
import { WorkspaceShell } from "./workspace-shell";
import { WorkspaceTimetable } from "./workspace-timetable";
import { PreparationProgressReview, PreparationProgressShortcut, usePreparationProgressReview } from "./preparation-progress-review";
import { WorkspaceToolNavigation, workspaceTools, workspaceToolTrigger, type WorkspaceTool as Tool } from "./workspace-tool-navigation";

const isTransportTool = (tool: Tool) => tool === "transport" || tool === "lodging";
const narrowWorkspace = 760;
const overviewDesktop = 1100;
type ChatConfirmation = { identity: string; text: string } & ({ kind: "send"; reference?: ChatMessageReference } | { kind: "retry"; messageId: string });
const scheduleViews = [{ id: "calendar", label: "공동 캘린더", icon: CalendarDays }, { id: "timetable", label: "타임테이블", icon: CalendarClock }] as const;

export function EventWorkspace({ room, profile, seedMessages, notice, noticeError, darkMode, onToggleTheme, onSignOut, onBackToRooms, onOpenSettings, onAddExtractedEvent, onAddExtractedChecklist, onAddChatEvent, canAddChatEvent, onAddChatChecklist, onScopeChange, renderTools, renderProposals, overview }: {
  room: EventRoom; profile: UserProfile; seedMessages: ChatMessage[]; notice: string; noticeError?: boolean;
  darkMode: boolean; onToggleTheme: () => void; onSignOut: () => void; onBackToRooms: () => void;
  onOpenSettings?: () => void;
  onAddExtractedEvent: () => void; onAddExtractedChecklist: () => void;
  onAddChatEvent?: (conversationId: string, message: ChatMessage) => void;
  canAddChatEvent?: (conversationId: string, message: ChatMessage) => boolean;
  onAddChatChecklist?: (scope: ConversationScope, message: ChatMessage) => void;
  onScopeChange?: (scope: ConversationScope | null) => void;
  renderTools: (mode: "calendar" | "prepare", scope?: ConversationScope, onOpenTimetable?: () => void) => ReactNode;
  renderProposals?: (scope: ConversationScope, messages: readonly ChatMessage[]) => ReactNode;
  overview?: () => WorkspaceOverviewData;
}) {
  const [history, setHistory] = useState<ConversationHistory | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [tools, setTools] = useState<{ open: boolean; mode: Tool }>({ open: false, mode: "calendar" });
  const [scheduleView, setScheduleView] = useState<"calendar" | "timetable">("calendar");
  const scheduleId = useId();
  const toolNav = useRef<HTMLElement>(null);
  const overviewTrigger = useRef<HTMLButtonElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const focusHistory = useRef(false);
  const wasNarrow = useRef(false);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const focusInspector = useRef(false);
  const focusProgress = useRef(false);
  const [overviewOpen, setOverviewOpen] = useState<boolean | null>(null);
  const [viewport, setViewport] = useState({ wide: false, narrow: false });
  const [proposalReply, setProposalReply] = useState<{ identity: string; id: string } | null>(null);
  const [error, setError] = useState("");
  const [unsavedDraft, setUnsavedDraft] = useState(false);
  const [replyStartedAt, setReplyStartedAt] = useState<number | null>(null);
  const chatBusy = replyStartedAt !== null;
  const chatRequest = useRef<AbortController | null>(null);
  const [confirmation, setConfirmation] = useState<ChatConfirmation | null>(null);
  const [approvedAccount, setApprovedAccount] = useState<string | null>(null);
  const [manageConsent, setManageConsent] = useState(false);
  const [revokingConsent, setRevokingConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [transportOpened, setTransportOpened] = useState(false);
  const [roster, setRoster] = useState<{ identity: string; source: ChatRosterSource } | null>(null);
  const [transportUnsaved, setTransportUnsaved] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [toolsError, setToolsError] = useState<{ key: string; message: string } | null>(null);
  const [retryTools, setRetryTools] = useState(0);
  const transportMode = isTransportTool(tools.mode);
  const timetableView = tools.mode === "calendar" && scheduleView === "timetable";
  const fullWidthTool = tools.open && (transportMode || timetableView);
  const showOverview = Boolean(overview) && !tools.open && (overviewOpen ?? viewport.wide);
  const historyVisible = historyOpen && !fullWidthTool && !(viewport.narrow && (showOverview || tools.open));
  const resize = useToolsResize(!viewport.narrow && (showOverview || tools.open && !fullWidthTool), historyVisible);
  useLayoutEffect(() => {
    if (!historyVisible || !focusHistory.current) return;
    focusHistory.current = false;
    resize.history.current?.querySelector<HTMLElement>(".conversation-heading h2")?.focus();
  }, [historyVisible, resize.history]);
  useLayoutEffect(() => {
    if (showOverview && focusProgress.current) {
      focusProgress.current = false;
      resize.panel.current?.querySelector<HTMLElement>("#workspace-progress-review")?.focus();
      return;
    }
    if (!focusInspector.current) return;
    focusInspector.current = false;
    inspectorHeading.current?.focus();
  }, [showOverview, tools.mode, tools.open, resize.panel]);
  const active = history?.conversations.find((item) => item.id === history.activeId) ?? null;
  const accountId = profile.accountId ?? profile.nickname;
  const canChat = profile.permissions.includes("chat");
  const canEditPrivateTools = profile.permissions.includes("editChecklist");
  const server = isBackendConnected();
  const isRetreat = server && "category" in room && room.category === "retreat";
  const canReviewRetreat = isRetreat &&
    retreatReviewPermissions.every(permission => profile.permissions.includes(permission));
  const isLocalQuestion = (text: string) => isPreparationChat(text) || isPreparationStatusChat(text) || isRetreat && isVenueHistoryChat(text);
  const consentApproved = approvedAccount === accountId;
  const scope = useMemo<ConversationScope | null>(() => canChat && active ? { accountId, roomId: room.id, conversationId: active.id } : null, [canChat, accountId, room.id, active?.id]);
  const identity = scope ? scopeId(scope) : "";
  const ready = scope && (!server || loadedScope === identity);
  const readyScope = ready ? scope : null;
  const progressScope = server && overview && retreatReviewPermissions.every(permission => profile.permissions.includes(permission)) ? readyScope : null;
  const progress = usePreparationProgressReview(progressScope);
  const store = useMemo(() => typeof window === "undefined" || !canChat ? null : createConversationStore(sessionStorage, accountId, room.id, seedMessages), [canChat, accountId, room.id, seedMessages]);
  useEffect(() => () => { chatRequest.current?.abort(); }, []);
  useEffect(() => {
    if (!server || !canChat) return;
    const controller = new AbortController();
    void backendFetch("/api/chat", { signal: controller.signal }).then(status => {
      if (!controller.signal.aborted && getBackendProfile()?.accountId === accountId) setApprovedAccount(status.approved === true ? accountId : null);
    }).catch(() => { /* Fall back to asking before sending. */ });
    return () => controller.abort();
  }, [server, canChat, accountId]);
  useEffect(() => {
    const resize = () => {
      const wide = window.innerWidth >= overviewDesktop, narrow = window.innerWidth <= narrowWorkspace;
      if (narrow && !wasNarrow.current) {
        if (document.getElementById("conversation-history")?.contains(document.activeElement)) historyTrigger.current?.focus();
        setHistoryOpen(false);
      }
      wasNarrow.current = narrow;
      if (!wide && overviewOpen === null && document.querySelector('.workspace-tools[data-view="summary"]')?.contains(document.activeElement)) {
        overviewTrigger.current?.focus();
      }
      setViewport(previous => previous.wide === wide && previous.narrow === narrow ? previous : { wide, narrow });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [overviewOpen]);
  useEffect(() => {
    try { if (store) setHistory(store.load()); }
    catch (cause) { setError(message(cause)); }
  }, [store]);
  useEffect(() => {
    if (!store || !isBackendConnected()) return;
    const changed = (event: StorageEvent) => {
      if (event.key === conversationHistoryKey(accountId, room.id)) {
        try { setHistory(store.load()); } catch (e) { setError(message(e)); }
      }
    };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [store, accountId, room.id]);
  useEffect(() => {
    if (!scope || !server) return;
    const stop = followBackendConversation(scope);
    let current = true;
    setLoadedScope(null); setToolsError(null);
    void (async () => {
      try {
        if (getBackendState().pending) await flushBackendWrites();
        if (!current) return;
        await refreshBackendData(scope.roomId, scope.conversationId);
        if (current) setLoadedScope(identity);
      } catch (cause) { if (current) setToolsError({ key: identity, message: message(cause) }); }
    })();
    return () => { current = false; stop(); };
  }, [scope, server, identity, retryTools]);
  useEffect(() => { onScopeChange?.(readyScope); }, [readyScope, onScopeChange]);
  const mutate = (operation: () => ConversationHistory, discardCurrentDraft = false) => {
    if (chatRequest.current) return "답변 요청을 처리하고 있습니다. 잠시 기다려 주세요.";
    try {
      if (unsavedDraft && active && !discardCurrentDraft) store?.setDraft(active.id, active.draft);
      setHistory(operation()); setUnsavedDraft(false); setError(""); return null;
    } catch (cause) { const text = message(cause); setError(text); return text; }
  };
  const create = (onCreated?: () => void) => navigate(() => { if (store && !mutate(() => store.create())) onCreated?.(); });
  const changeDraft = (draft: string) => {
    if (!active || !history || !store || chatRequest.current) return;
    try { setHistory(store.setDraft(active.id, draft)); setUnsavedDraft(false); setError(""); }
    catch (cause) { setHistory({ ...history, conversations: history.conversations.map((item) => item.id === active.id ? { ...item, draft } : item) }); setUnsavedDraft(true); setError(message(cause)); }
  };
  const requestReply = async (conversationId: string, userMessageId: string, userMessageText: string, approve = false) => {
    const controller = new AbortController();
    const stillCurrent = () => !controller.signal.aborted && getBackendProfile()?.accountId === accountId;
    chatRequest.current = controller;
    setReplyStartedAt(performance.now()); setError("");
    try {
      await flushBackendWrites();
      if (!stillCurrent()) return;
      await backendFetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ roomId: room.id, conversationId, userMessageId, userMessageText, ...(approve && !isLocalQuestion(userMessageText) && { consent: openAIChatConsentVersion }) }),
      });
      if (stillCurrent()) await refreshBackendData(room.id, null);
    } catch (cause) {
      if (stillCurrent() && cause instanceof BackendError && cause.status === 423 && !isLocalQuestion(userMessageText)) {
        setApprovedAccount(null);
        setConfirmation({ identity, kind: "retry", messageId: userMessageId, text: userMessageText });
        return;
      }
      if (stillCurrent() && cause instanceof BackendError && [404, 409].includes(cause.status) && !getBackendState().pending) {
        try { await refreshBackendData(room.id, null); } catch { /* Keep the original failure visible. */ }
      }
      if (stillCurrent()) setError(message(cause));
    } finally {
      if (approve && stillCurrent()) {
        try {
          const status = await backendFetch("/api/chat", { signal: controller.signal });
          if (stillCurrent()) setApprovedAccount(status.approved === true ? accountId : null);
        } catch { /* The next turn can still use the approval dialog. */ }
      }
      chatRequest.current = null;
      if (!controller.signal.aborted) setReplyStartedAt(null);
    }
  };
  const sendChat = (text: string, localOnly = false, approve = false, reference?: ChatMessageReference) => {
    if (!active || !store || chatRequest.current) return;
    let userMessageId: string | undefined;
    const failure = mutate(() => {
      const next = store.send(active.id, text, { localOnly, reference });
      const last = next.conversations.find(({ id }) => id === active.id)?.messages.at(-1);
      if (last?.sender === "user") userMessageId = last.id;
      return next;
    });
    if (!failure && server && userMessageId && !localOnly) void requestReply(active.id, userMessageId, text.trim(), approve);
  };
  const unanswered = active?.messages.at(-1);
  const retry = (messageId: string, text: string, approve = false) => {
    if (!active || !store || chatRequest.current || (unsavedDraft && mutate(() => store.load()))) return;
    void requestReply(active.id, messageId, text, approve);
  };
  const needsConfirmation = (text: string) => !isLocalQuestion(text) && (!consentApproved || hasObviousPrivateData(text));
  const submitChat = (text: string, reference?: ChatMessageReference) => {
    if (server && identity && needsConfirmation(text)) setConfirmation({ identity, kind: "send", text, reference });
    else if (!server || identity) sendChat(text, false, false, reference);
  };
  const retryReply = server && active && store && unanswered?.sender === "user" && !unanswered.actions?.includes(internalChatAction) ? () => {
    if (needsConfirmation(unanswered.text)) setConfirmation({ identity, kind: "retry", messageId: unanswered.id, text: unanswered.text });
    else retry(unanswered.id, unanswered.text);
  } : undefined;
  const privateText = !!confirmation && hasObviousPrivateData(confirmation.text);
  const confirmChat = (localOnly = false) => {
    if (!server || !identity || confirmation?.identity !== identity || !active || chatRequest.current ||
        !confirmation.text.trim() || (!localOnly && privateText)) return;
    setConfirmation(null);
    if (confirmation.kind === "send") sendChat(confirmation.text, localOnly, !localOnly && !consentApproved, confirmation.reference);
    else if (!localOnly && unanswered?.id === confirmation.messageId && unanswered.text === confirmation.text && !unanswered.actions?.includes(internalChatAction)) retry(confirmation.messageId, confirmation.text, !consentApproved);
  };
  const revokeChatConsent = async () => {
    if (revokingConsent) return;
    setRevokingConsent(true);
    setConsentError("");
    try {
      await backendFetch("/api/chat", { method: "DELETE" });
      if (getBackendProfile()?.accountId !== accountId) return;
      setApprovedAccount(null);
      setManageConsent(false);
    } catch (cause) { setConsentError(message(cause)); }
    finally { setRevokingConsent(false); }
  };
  const openTool = (mode: Tool, replyId?: string) => {
    if (isTransportTool(mode)) setTransportOpened(true);
    if (mode === "calendar") setScheduleView("calendar");
    if (mode === "proposals") setProposalReply(replyId ? { identity, id: replyId } : null);
    if (window.innerWidth <= narrowWorkspace || document.activeElement?.closest(".workspace-center")) {
      if (tools.open && tools.mode === mode) inspectorHeading.current?.focus();
      else focusInspector.current = true;
    }
    setTools({ mode, open: true });
  };
  const openTimetable = () => {
    focusInspector.current = true;
    openTool("calendar");
    setScheduleView("timetable");
  };
  const toggleTool = (mode: Tool) => {
    if (tools.open && tools.mode === mode) setTools({ mode, open: false });
    else openTool(mode);
  };
  const navigate = (action: () => void) => {
    if (transportUnsaved && !window.confirm("저장하지 못한 차량 배정 변경이 있습니다. 변경을 버리고 이동할까요?")) return;
    if (unsavedDraft && store && mutate(() => store.load())) return;
    action();
  };
  const toolName = workspaceTools[tools.mode].name;
  const retreatReviewOpen = tools.open && tools.mode === "retreatReview";
  const closeTool = () => {
    setTools((current) => ({ ...current, open: false }));
    toolNav.current?.querySelector<HTMLButtonElement>(workspaceToolTrigger(tools.mode))?.focus();
  };
  const toggleHistory = () => {
    focusHistory.current = !historyVisible;
    if (!historyVisible && tools.open && (fullWidthTool || window.innerWidth <= narrowWorkspace)) {
      setTools((current) => ({ ...current, open: false }));
    }
    if (showOverview && viewport.narrow) setOverviewOpen(false);
    setHistoryOpen(!historyVisible);
  };
  const goToConversation = () => {
    if (viewport.narrow && showOverview) setOverviewOpen(false);
    if (viewport.narrow) setHistoryOpen(false);
    if (tools.open) setTools((current) => ({ ...current, open: false }));
  };
  const returnToSummary = () => {
    focusInspector.current = true;
    setOverviewOpen(true);
    setTools(current => ({ ...current, open: false }));
  };
  const openProgress = () => {
    if (showOverview) resize.panel.current?.querySelector<HTMLElement>("#workspace-progress-review")?.focus();
    else {
      focusProgress.current = true;
      setOverviewOpen(true);
      if (tools.open) setTools(current => ({ ...current, open: false }));
    }
  };
  const openFromSummary = (mode: Tool) => {
    focusInspector.current = true;
    openTool(mode);
  };
  const leaveMobileHistory = () => {
    if (!viewport.narrow) return;
    historyTrigger.current?.focus();
    setHistoryOpen(false);
  };
  const summary = showOverview ? overview?.() : undefined;
  const timing = roomTiming({ date: room.date ?? null, endDate: room.endDate });
  const roomStatus = roomStages.find(entry => entry.id === roomStage(timing.key))!;
  const messages = active?.messages ?? [];
  const replyIndex = proposalReply?.identity === identity ? messages.findIndex(item => item.id === proposalReply.id) : -1;
  const proposalMessages = replyIndex < 0 ? messages : messages.slice(Math.max(0, replyIndex - 1), replyIndex + 1);
  const header = <header className="workspace-topbar workspace-theme"><div className="workspace-room-heading">
      <button type="button" className="workspace-icon-button workspace-rooms-back" aria-label="행사방 목록으로 돌아가기" title="행사방 목록으로 돌아가기" onClick={() => navigate(onBackToRooms)}><ArrowLeft size={18} aria-hidden="true" /></button>
      <button ref={historyTrigger} type="button" className="workspace-icon-button workspace-history-toggle" aria-label={`대화 목록 ${historyVisible ? "닫기" : "열기"}`} title={`대화 목록 ${historyVisible ? "닫기" : "열기"}`} aria-expanded={historyVisible} aria-controls="conversation-history" onClick={toggleHistory}>{historyVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
      <div className="workspace-event-title"><span>행사방</span><h1 title={room.name}>{room.name}</h1></div>
    </div><div className="workspace-event-meta">
        {timing.key !== "undated" && <span className="workspace-event-date"><CalendarDays size={14} aria-hidden="true" />{room.dateLabel}</span>}
        <span className={`workspace-event-state timing-${roomStatus.id}`} title={timing.reason}>{roomStatus.label}</span>
    </div><div className="workspace-topbar-actions"><SaveStatus />
      <SupportButton screenName="작업 화면" roomName={room.name} />
      {(!historyVisible || viewport.narrow) && onOpenSettings && <SettingsEntry placement="toolbar" onOpen={() => navigate(onOpenSettings)} />}
      <span className="workspace-toolbar-divider" /><button type="button" className="workspace-icon-button" aria-label={darkMode ? "라이트 모드" : "다크 모드"} title={darkMode ? "라이트 모드" : "다크 모드"} onClick={onToggleTheme}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
      <button type="button" className="workspace-icon-button" aria-label="로그아웃" title="로그아웃" onClick={() => navigate(onSignOut)}><LogOut size={17} /></button>
    </div></header>;
  const canShowTool = (mode: Tool) => mode === "lodging" ? canChat : mode === "retreatReview" ? canReviewRetreat : mode === "proposals" ? Boolean(renderProposals) : true;
  const navigation = <WorkspaceToolNavigation navRef={toolNav} summaryRef={overviewTrigger} active={tools.open ? tools.mode : null}
    showChat={!tools.open && !(viewport.narrow && (showOverview || historyVisible))} showSummary={showOverview} hasSummary={!!overview}
    canShow={canShowTool} isDisabled={mode => (mode === "lodging" || mode === "retreatReview") && !scope}
    onChat={goToConversation} onTool={toggleTool}
    onSummary={() => { if (tools.open) setTools(current => ({ ...current, open: false })); setOverviewOpen(!showOverview); }} />;
  const chatVisible = !fullWidthTool && !(viewport.narrow && (tools.open || showOverview || historyVisible));
  const shortcuts = <div className="workspace-chat-shortcuts" role="group" aria-label="빠른 작업">{(["calendar", "transport"] as const).filter(canShowTool).map(mode => {
    const { Icon, name } = workspaceTools[mode];
    return <button key={mode} type="button" className="workspace-start-button" onClick={() => openTool(mode)}><Icon size={17} aria-hidden="true" />{name} 보기</button>;
  })}<BlankGoogleFormLink className="workspace-start-button" /></div>;
  const chat = <>{(error || notice) && <div className={`workspace-notice ${error || noticeError ? "is-error" : ""}`} role={error || noticeError ? "alert" : "status"}>{error || notice}</div>}{canChat ? <ChatPanel conversation={active} visible={chatVisible} shortcuts={shortcuts} onDraftChange={changeDraft} onSendMessage={submitChat} replyStartedAt={replyStartedAt} onRetryReply={retryReply} onNewConversation={() => create()} onOpenDocuments={() => openTool("documents")} onReviewProposals={renderProposals ? replyId => openTool("proposals", replyId) : undefined}
        onManageConsent={server && consentApproved ? () => { setConsentError(""); setManageConsent(true); } : undefined}
        progress={progressScope && <PreparationProgressShortcut {...progress} onOpen={openProgress} />}
        retreatVenueScope={isRetreat ? readyScope ?? undefined : undefined}
        canAddCalendarEvent={message => !!active && (profile.permissions.includes("createEvent") || profile.permissions.includes("editEvent")) && (canAddChatEvent?.(active.id, message) ?? true)}
        onAddCalendarEvent={onAddChatEvent ? message => { if (!active) return; onAddChatEvent(active.id, message); openTool("calendar"); } : undefined}
        onAddChecklist={readyScope && canEditPrivateTools && onAddChatChecklist ? message => { onAddChatChecklist(readyScope, message); openTool("prepare"); } : undefined}
        onImportRoster={readyScope && canEditPrivateTools ? source => { setRoster({ identity, source }); openTool("transport"); } : undefined}
      /> : <p className="p-4 text-sm text-muted-foreground">대화 권한이 없습니다.</p>}</>;
  const inspector = <aside ref={resize.panel} id="workspace-tools" className="workspace-tools workspace-theme" data-view={summary ? "summary" : "tool"}
    aria-label={summary ? "행사 요약" : "부가기능"} hidden={!tools.open && !summary}>
        {resize.handle}
        <header className="workspace-tools-heading workspace-theme">
          {overview && tools.open && <button type="button" className="workspace-icon-button workspace-summary-back" aria-label="행사 요약으로 돌아가기" title="행사 요약으로 돌아가기" onClick={returnToSummary}><ArrowLeft size={17} aria-hidden="true" /></button>}
          <h2 ref={inspectorHeading} tabIndex={-1}>{summary ? "행사 요약" : tools.mode === "calendar" && canChat ? "일정" : toolName}</h2>
          {tools.open && tools.mode === "proposals" && replyIndex >= 0 && <button type="button" className="workspace-start-button workspace-proposals-all" onClick={() => setProposalReply(null)}>전체 제안</button>}
          <button type="button" className="workspace-icon-button workspace-inspector-close" aria-label={summary ? "요약 패널 닫기" : "부가기능 닫기"} title={summary ? "요약 패널 닫기" : "부가기능 닫기"} onClick={summary ? () => { setOverviewOpen(false); overviewTrigger.current?.focus(); } : closeTool}><X size={18} /></button>
        </header>
        {summary && <WorkspaceOverview {...summary} event={{ name: room.name, period: timing.key !== "undated" ? room.dateLabel : "", status: roomStatus.label }} scope={readyScope} onCalendar={() => openFromSummary("calendar")} progress={progressScope ? <PreparationProgressReview key={identity} {...progress} /> : undefined} />}
        <div className="workspace-inspector-content" hidden={!tools.open}>
        <div className="workspace-shared-content flex min-h-0 flex-col" hidden={tools.mode !== "calendar"}>
          {canChat && <div className="workspace-schedule-tabs" role="tablist" aria-label="일정 보기">
            {scheduleViews.map(({ id, label, icon: Icon }) => <button type="button" key={id} id={`${scheduleId}-${id}-tab`} role="tab"
              aria-selected={scheduleView === id} aria-controls={`${scheduleId}-${id}-panel`} tabIndex={scheduleView === id ? 0 : -1}
              onClick={() => setScheduleView(id)} onKeyDown={event => {
                const next = event.key === "Home" ? "calendar" : event.key === "End" ? "timetable"
                  : event.key === "ArrowRight" || event.key === "ArrowLeft" ? (id === "calendar" ? "timetable" : "calendar") : null;
                if (!next) return;
                event.preventDefault();
                setScheduleView(next);
                document.getElementById(`${scheduleId}-${next}-tab`)?.focus();
              }}><Icon size={16} aria-hidden="true" />{label}</button>)}
          </div>}
          <div className="workspace-shared-content flex min-h-0 flex-col" id={`${scheduleId}-calendar-panel`}
            role={canChat ? "tabpanel" : undefined} aria-labelledby={canChat ? `${scheduleId}-calendar-tab` : undefined} hidden={timetableView}>
            {tools.open && tools.mode === "calendar" && !timetableView && server && profile.permissions.includes("viewCalendar") && <GoogleCalendarConnection />}
            <div className="min-h-0 flex-1">{renderTools("calendar")}</div>
          </div>
          {canChat && <div className="workspace-timetable-panel" id={`${scheduleId}-timetable-panel`} role="tabpanel"
            aria-labelledby={`${scheduleId}-timetable-tab`} hidden={!timetableView} tabIndex={0}>
            {tools.open && timetableView && (readyScope ? <WorkspaceTimetable key={identity} scope={readyScope} canEdit={canEditPrivateTools} />
              : <div className="p-4 text-sm text-muted-foreground">{!scope ? "대화를 선택해 주세요."
                : toolsError?.key === identity ? <><p role="alert">{toolsError.message}</p><button type="button" onClick={() => setRetryTools(value => value + 1)}>다시 불러오기</button></>
                : <p role="status">이 대화의 자료를 불러오는 중…</p>}</div>)}
          </div>}
        </div>
        {tools.open && tools.mode !== "calendar" && !readyScope && <div className="p-4 text-sm text-muted-foreground">
          {!scope ? "대화를 선택해 주세요." : toolsError?.key === identity ? <><p role="alert">{toolsError.message}</p><button type="button" onClick={() => setRetryTools((value) => value + 1)}>다시 불러오기</button></> : <p role="status">이 대화의 자료를 불러오는 중...</p>}
        </div>}
        {canReviewRetreat && retreatReviewOpen && readyScope && <RetreatPreparationPanel scope={readyScope}
          onSummarize={() => submitChat(preparationChatQuery)} summaryDisabled={chatBusy || !!active?.draft.trim()} />}
        {readyScope && <PrivateConversationTools key={identity} scope={readyScope} formTargetLabel={`${room.name} / ${active?.title ?? "대화"}`} tools={tools} transportOpened={transportOpened} isRetreat={isRetreat} renderPrepare={() => renderTools("prepare", readyScope, openTimetable)}
          renderProposals={renderProposals && (current => renderProposals(current, proposalMessages))} onReviewProposals={() => openTool("proposals")}
          roster={canEditPrivateTools && roster?.identity === identity ? roster.source : undefined} onCloseRoster={applied => {
            if (applied && roster?.identity === identity && roster.source.fromDraft && roster.source.text === active?.draft) changeDraft("");
            setRoster(null);
          }}
          onAddEvent={() => { onAddExtractedEvent(); openTool("calendar"); }} onAddChecklist={() => { onAddExtractedChecklist(); openTool("prepare"); }}
          onTransportUnsaved={setTransportUnsaved} onOpenTransport={() => openTool("transport")} />}
        </div>
      </aside>;

  return <WorkspaceShell layoutRef={resize.layout} historyRef={resize.history} historyVisible={historyVisible} chatVisible={chatVisible} style={resize.style}
    columns={`${historyVisible ? "has-history" : ""} ${tools.open ? "has-tools" : ""} ${summary ? "has-overview" : ""} ${fullWidthTool ? (transportMode ? "is-transport" : "is-timetable") : ""} ${viewport.narrow && historyVisible ? "is-history-view" : ""} ${resize.dragging ? "is-resizing-tools" : ""}`}
    onBackToRooms={() => navigate(onBackToRooms)} onOpenSettings={!viewport.narrow && onOpenSettings ? () => navigate(onOpenSettings) : undefined} header={header} navigation={navigation} chat={chat} inspector={inspector}
    history={<ConversationSidebar conversations={canChat ? history?.conversations ?? [] : []} activeId={active?.id ?? null} disabled={!history || !store || chatBusy}
      onCreate={() => create(leaveMobileHistory)} onSelect={id => {
        if (id === active?.id) leaveMobileHistory();
        else navigate(() => { if (store && !mutate(() => store.select(id))) leaveMobileHistory(); });
      }}
      onRename={(id, title) => store ? mutate(() => store.rename(id, title)) : "저장소를 사용할 수 없습니다."} onDelete={(id) => store ? mutate(() => store.delete(id), active?.id === id) : "저장소를 사용할 수 없습니다."} />}>
    {confirmation?.identity === identity && <RoomDialog className="workspace-theme" title="OpenAI에 메시지 보내기" onClose={() => setConfirmation(null)}>
      <div className="room-dialog-body">
        <p>{consentApproved ? "이 메시지는 전송 전에 확인이 필요합니다." : "동의하면 앞으로 일반 질문을 보낼 때마다 확인창을 띄우지 않습니다. 전송 동의는 언제든 철회할 수 있습니다."}</p>
        <p>일반 질문에는 이번 메시지와 이 대화에서 이전에 OpenAI로 보낸 내 메시지 최대 3개, 또는 답장으로 지정한 일부를 사용할 수 있습니다. 장소가 필요한 질문에는 확인된 대표 장소의 공개 이름·주소·출처를 사용할 수 있습니다. 식당 웹 검색에는 메시지 원문 대신 공개 장소명·주소와 방문 시간대, 음식 등 검색 조건만 사용합니다. 다른 대화, 첨부자료, 개인 지침은 보내지 않습니다.</p>
        <label className="grid gap-2 text-sm">외부로 보낼 메시지
          <textarea className="w-full rounded-md border border-border bg-background p-3" rows={5} maxLength={8000}
            value={confirmation.text} readOnly={confirmation.kind === "retry"} onChange={(event) => setConfirmation({ ...confirmation, text: event.target.value })} />
        </label>
        {privateText ? <p role="alert" className="text-destructive">{openAIPrivacyWarning}</p> : <p>이름, 명단, 회의 내용 등 외부에 공개할 수 없는 정보가 없는지 확인해 주세요.</p>}
      </div>
      <footer className="room-dialog-footer flex-wrap">
        <button type="button" className="lobby-secondary" autoFocus onClick={() => setConfirmation(null)}>취소</button>
        {confirmation.kind === "send" && confirmation.reference?.kind !== "edit" && <button type="button" className="lobby-secondary" disabled={!confirmation.text.trim()} onClick={() => confirmChat(true)}>내부에만 저장</button>}
        <button type="button" className="lobby-primary" disabled={!confirmation.text.trim() || privateText} onClick={() => confirmChat()}>
          {isLocalQuestion(confirmation.text.trim()) ? "내부에서 확인" : consentApproved ? "보내기" : "동의하고 보내기"}
        </button>
      </footer>
    </RoomDialog>}
    {manageConsent && consentApproved && <RoomDialog className="workspace-theme" title="OpenAI 전송 동의 관리" onClose={() => { if (!revokingConsent) setManageConsent(false); }}>
      <div className="room-dialog-body">
        <p>동의를 철회하면 다음 외부 전송 전에 다시 확인합니다. 이전에 보낸 메시지와 저장된 대화는 삭제하지 않습니다.</p>
        {consentError && <p role="alert" className="text-destructive">{consentError}</p>}
      </div>
      <footer className="room-dialog-footer">
        <button type="button" className="lobby-secondary" autoFocus disabled={revokingConsent} onClick={() => setManageConsent(false)}>취소</button>
        {!!active?.draft.trim() && <button type="button" className="lobby-secondary" disabled={revokingConsent} onClick={() => {
          setManageConsent(false);
          sendChat(active.draft, true);
        }}>초안 내부에만 저장</button>}
        <button type="button" className="lobby-primary" disabled={revokingConsent} onClick={() => void revokeChatConsent()}>전송 동의 철회</button>
      </footer>
    </RoomDialog>}
  </WorkspaceShell>;
}

function PrivateConversationTools({ scope, formTargetLabel, tools, transportOpened, isRetreat, renderPrepare, renderProposals, onReviewProposals, onAddEvent, onAddChecklist, onTransportUnsaved, onOpenTransport, roster, onCloseRoster }: {
  scope: ConversationScope; tools: { open: boolean; mode: Tool }; transportOpened: boolean;
  isRetreat: boolean;
  renderPrepare: () => ReactNode; renderProposals?: (scope: ConversationScope) => ReactNode;
  onReviewProposals: () => void; onAddEvent: () => void; onAddChecklist: () => void; onTransportUnsaved: (value: boolean) => void; onOpenTransport: () => void; formTargetLabel: string;
  roster?: ChatRosterSource; onCloseRoster: (applied?: boolean) => void;
}) {
  return <>
    <div className="workspace-shared-content flex min-h-0 flex-col" hidden={tools.mode !== "prepare"}>{tools.mode === "prepare" && <div className="min-h-0 flex-1">{renderPrepare()}</div>}</div>
    <div className="workspace-documents" hidden={tools.mode !== "documents"}>
      <DocumentsPanel roomId={scope.roomId} scope={scope} onReviewProposals={renderProposals ? onReviewProposals : undefined} onAddExtractedEvent={onAddEvent} onAddExtractedChecklist={onAddChecklist} />
    </div>
    <div className="workspace-location" hidden={tools.mode !== "location"}>{tools.open && tools.mode === "location" && <>
      <ConversationLocation scope={scope} />
      {isRetreat && <RetreatVenueHistory scope={scope} canRegister />}
    </>}</div>
    <div className="workspace-proposals" hidden={tools.mode !== "proposals"}>{tools.open && tools.mode === "proposals" && renderProposals?.(scope)}</div>
    <div className="workspace-transport" hidden={!isTransportTool(tools.mode)}>{transportOpened && <TransportPanel key={scopeId(scope)} roomId={scope.roomId} scope={scope} lodgingView={tools.mode === "lodging"} formTargetLabel={formTargetLabel} onOpenTransport={onOpenTransport} onUnsavedChange={onTransportUnsaved}
      chatRoster={roster} onCloseChatRoster={onCloseRoster} />}</div>
  </>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : "작업을 완료하지 못했습니다. 다시 시도해 주세요."; }
