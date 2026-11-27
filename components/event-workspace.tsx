"use client";

import { ArrowLeft, CalendarClock, CalendarDays, LockKeyhole, LogOut, Maximize2, Minimize2, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { externalAISettingsHref, hasObviousPrivateData, internalChatAction, openAIPrivacyWarning } from "@/lib/assistant-privacy";
import { createConversationStore, type ConversationHistory } from "@/lib/conversation-store";
import type { ChatMessage, ChatMessageReference, ChecklistItem, EventRoom, UserProfile } from "@/lib/types";
import { ChatPanel } from "./chat-panel";
import { ConversationSidebar } from "./conversation-sidebar";
import { DocumentsPanel } from "./documents-panel";
import { ConversationLocation } from "./conversation-location";
import { SaveStatus } from "./save-status";
import { SupportButton } from "./support-dialog";
import { SettingsEntry } from "./settings-entry";
import { TransportPanel } from "./transport-panel";
import { BackendError, backendFetch, followBackendConversation, flushBackendWrites, getBackendProfile, getBackendState, isBackendConnected, refreshBackendData } from "@/lib/backend-client";
import { conversationHistoryKey, privateToolKey, scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { appendConversationPlace } from "@/lib/conversation-places";
import type { ServerSnapshot } from "@/lib/backend-contract";
import { classifyContinuation } from "@/lib/chat-continuity";
import { isEventVenueRouteQuestion, venueRouteArrivalMatch, venueTravelAnchor } from "@/lib/chat-venue-route";
import { localWorkIntent } from "@/lib/chat-work-proposal";
import { GoogleCalendarConnection } from "./google-calendar-connection";
import { BlankGoogleFormLink } from "./google-forms-sharing";
import { useToolsResize } from "./workspace-tools-resize";
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
import { buildChecklistChatDraft } from "@/lib/checklist-chat-draft";
import type { PreparationRecordTarget } from "./workspace-preparation-records";

const isTransportTool = (tool: Tool) => tool === "transport" || tool === "lodging";
const narrowWorkspace = 760;
type PanelContent = Tool | "summary";
type ChatPrivacyNotice = { identity: string; reason: "consent" | "private"; save?: { text: string; reference?: ChatMessageReference } };
const scheduleViews = [{ id: "calendar", label: "공동 캘린더", icon: CalendarDays }, { id: "timetable", label: "타임테이블", icon: CalendarClock }] as const;

export function EventWorkspace({ room, profile, seedMessages, notice, noticeError, darkMode, onToggleTheme, onSignOut, onBackToRooms, onOpenSettings, onOpenPrivacySettings, onAddExtractedEvent, onAddExtractedChecklist, onAddChatEvent, canAddChatEvent, onAddChatChecklist, onScopeChange, renderTools, renderProposals, renderWorkProposal, overview }: {
  room: EventRoom; profile: UserProfile; seedMessages: ChatMessage[]; notice: string; noticeError?: boolean;
  darkMode: boolean; onToggleTheme: () => void; onSignOut: () => void; onBackToRooms: () => void;
  onOpenSettings?: () => void;
  onOpenPrivacySettings?: () => void;
  onAddExtractedEvent: () => void; onAddExtractedChecklist: () => void;
  onAddChatEvent?: (conversationId: string, message: ChatMessage) => void;
  canAddChatEvent?: (conversationId: string, message: ChatMessage) => boolean;
  onAddChatChecklist?: (scope: ConversationScope, message: ChatMessage) => void;
  onScopeChange?: (scope: ConversationScope | null) => void;
  renderTools: (mode: "calendar" | "prepare", scope?: ConversationScope, onOpenTimetable?: () => void, onAskChecklist?: (item: ChecklistItem) => void,
    records?: { open: (target: PreparationRecordTarget) => void; active: boolean }) => ReactNode;
  renderProposals?: (scope: ConversationScope, messages: readonly ChatMessage[]) => ReactNode;
  renderWorkProposal?: (scope: ConversationScope, message: ChatMessage) => ReactNode;
  overview?: () => WorkspaceOverviewData;
}) {
  const [history, setHistory] = useState<ConversationHistory | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [mobileHistory, setMobileHistory] = useState(false);
  const [composerFocus, setComposerFocus] = useState(0);
  const [pane, setPane] = useState<{ open: boolean; content: PanelContent; expanded: boolean }>({ open: Boolean(overview), content: "summary", expanded: false });
  const [visitedTools, setVisitedTools] = useState<ReadonlySet<Tool>>(() => new Set());
  const [scheduleView, setScheduleView] = useState<"calendar" | "timetable">("calendar");
  const [timetableOpened, setTimetableOpened] = useState(false);
  const [peopleShortcut, setPeopleShortcut] = useState(0);
  const scheduleId = useId();
  const toolNav = useRef<HTMLElement>(null);
  const overviewTrigger = useRef<HTMLButtonElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const focusHistory = useRef(false);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const focusInspector = useRef(false);
  const focusProgress = useRef(false);
  const [narrow, setNarrow] = useState(false);
  const [proposalReply, setProposalReply] = useState<{ identity: string; id: string } | null>(null);
  const [error, setError] = useState("");
  const [unsavedDraft, setUnsavedDraft] = useState(false);
  const [replyStartedAt, setReplyStartedAt] = useState<number | null>(null);
  const chatBusy = replyStartedAt !== null;
  const chatRequest = useRef<AbortController | null>(null);
  const [privacyNotice, setPrivacyNotice] = useState<ChatPrivacyNotice | null>(null);
  const [externalAI, setExternalAI] = useState<{ account: string; approved: boolean } | null>(null);
  const [roster, setRoster] = useState<{ identity: string; source: ChatRosterSource } | null>(null);
  const [transportUnsaved, setTransportUnsaved] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [toolsError, setToolsError] = useState<{ key: string; message: string } | null>(null);
  const [retryTools, setRetryTools] = useState(0);
  const tools = { open: pane.open && pane.content !== "summary", mode: pane.content === "summary" ? "calendar" as const : pane.content };
  const timetableView = tools.mode === "calendar" && scheduleView === "timetable";
  const showOverview = Boolean(overview) && pane.open && pane.content === "summary";
  const panelVisible = tools.open || showOverview;
  const panelExpanded = panelVisible && pane.expanded && !narrow;
  const historyVisible = narrow ? mobileHistory && !panelVisible : historyOpen;
  const resize = useToolsResize(!narrow && panelVisible && !panelExpanded, historyVisible);
  useLayoutEffect(() => {
    if (!historyVisible || !focusHistory.current) return;
    focusHistory.current = false;
    resize.history.current?.querySelector<HTMLElement>(".conversation-heading h2")?.focus();
  }, [historyVisible, resize.history]);
  useLayoutEffect(() => {
    if (showOverview && focusProgress.current) {
      focusProgress.current = false;
      (resize.panel.current?.querySelector<HTMLElement>("#workspace-progress-review") ?? inspectorHeading.current)?.focus();
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
  const isLocalQuestion = (text: string, reference?: ChatMessageReference, beforeId?: string) => {
    if (localWorkIntent(text) || isEventVenueRouteQuestion(text) || classifyContinuation(text) === "cancel" || isPreparationChat(text) || isPreparationStatusChat(text) || isRetreat && isVenueHistoryChat(text)) return true;
    if (!active || !venueRouteArrivalMatch(text)) return false;
    const index = beforeId ? active.messages.findIndex(item => item.id === beforeId) : -1;
    return Boolean(venueTravelAnchor(index < 0 ? active.messages : active.messages.slice(0, index), reference));
  };
  const consentApproved = externalAI?.account === accountId ? externalAI.approved : undefined;
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
      if (!controller.signal.aborted && getBackendProfile()?.accountId === accountId) setExternalAI({ account: accountId, approved: status.approved === true });
    }).catch(() => { /* The server still verifies consent when a reply is requested. */ });
    return () => controller.abort();
  }, [server, canChat, accountId]);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= narrowWorkspace);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
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
    setPrivacyNotice(null);
    try { setHistory(store.setDraft(active.id, draft)); setUnsavedDraft(false); setError(""); }
    catch (cause) { setHistory({ ...history, conversations: history.conversations.map((item) => item.id === active.id ? { ...item, draft } : item) }); setUnsavedDraft(true); setError(message(cause)); }
  };
  const requestReply = async (conversationId: string, userMessageId: string, userMessageText: string, reference?: ChatMessageReference) => {
    const controller = new AbortController();
    const stillCurrent = () => !controller.signal.aborted && getBackendProfile()?.accountId === accountId;
    chatRequest.current = controller;
    setReplyStartedAt(performance.now()); setError("");
    try {
      await flushBackendWrites();
      if (!stillCurrent()) return;
      await backendFetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ roomId: room.id, conversationId, userMessageId, userMessageText }),
      });
      if (stillCurrent()) await refreshBackendData(room.id, null);
    } catch (cause) {
      if (stillCurrent() && cause instanceof BackendError && cause.status === 423 && !isLocalQuestion(userMessageText, reference, userMessageId)) {
        setExternalAI({ account: accountId, approved: false });
        setPrivacyNotice({ identity, reason: "consent" });
        return;
      }
      if (stillCurrent() && cause instanceof BackendError && [404, 409].includes(cause.status) && !getBackendState().pending) {
        try { await refreshBackendData(room.id, null); } catch { /* Keep the original failure visible. */ }
      }
      if (stillCurrent()) setError(message(cause));
    } finally {
      chatRequest.current = null;
      if (!controller.signal.aborted) setReplyStartedAt(null);
    }
  };
  const sendChat = (text: string, localOnly = false, reference?: ChatMessageReference) => {
    if (!active || !store || chatRequest.current) return;
    let userMessageId: string | undefined;
    const failure = mutate(() => {
      const next = store.send(active.id, text, { localOnly, reference });
      const last = next.conversations.find(({ id }) => id === active.id)?.messages.at(-1);
      if (last?.sender === "user") userMessageId = last.id;
      return next;
    });
    if (!failure && server && userMessageId && !localOnly) void requestReply(active.id, userMessageId, text.trim(), reference);
  };
  const unanswered = active?.messages.at(-1);
  const retry = (messageId: string, text: string) => {
    if (!active || !store || chatRequest.current || (unsavedDraft && mutate(() => store.load()))) return;
    void requestReply(active.id, messageId, text, unanswered?.reference);
  };
  const blockedBy = (text: string, reference?: ChatMessageReference, beforeId?: string) => isLocalQuestion(text, reference, beforeId) ? null : hasObviousPrivateData(text) ? "private" : consentApproved === false ? "consent" : null;
  const submitChat = (text: string, reference?: ChatMessageReference) => {
    if (server && !identity) return;
    const reason = server ? blockedBy(text, reference) : null;
    if (reason) setPrivacyNotice({ identity, reason, save: reference?.kind === "edit" ? undefined : { text, reference } });
    else { setPrivacyNotice(null); sendChat(text, false, reference); }
  };
  const retryReply = server && active && store && unanswered?.sender === "user" && !unanswered.actions?.includes(internalChatAction) ? () => {
    const reason = blockedBy(unanswered.text, unanswered.reference, unanswered.id);
    if (reason) setPrivacyNotice({ identity, reason });
    else { setPrivacyNotice(null); retry(unanswered.id, unanswered.text); }
  } : undefined;
  const openTool = (mode: Tool, replyId?: string) => {
    setVisitedTools(current => current.has(mode) ? current : new Set([...current, mode]));
    setMobileHistory(false);
    if (mode === "proposals" && replyId) setProposalReply({ identity, id: replyId });
    if (window.innerWidth <= narrowWorkspace || document.activeElement?.closest(".workspace-center")) {
      if (tools.open && tools.mode === mode) inspectorHeading.current?.focus();
      else focusInspector.current = true;
    }
    setPane(current => ({ ...current, content: mode, open: true }));
  };
  const openCalendar = () => { setScheduleView("calendar"); openTool("calendar"); };
  const openTimetable = () => {
    focusInspector.current = true;
    openTool("calendar");
    setScheduleView("timetable");
    setTimetableOpened(true);
  };
  const toggleExpanded = () => {
    if (!narrow && panelVisible) setPane(current => ({ ...current, expanded: !current.expanded }));
  };
  const selectSchedule = (next: typeof scheduleView, activate = false) => {
    if (next === scheduleView && activate) toggleExpanded();
    else setScheduleView(next);
    if (next === "timetable") setTimetableOpened(true);
  };
  const toggleTool = (mode: Tool) => {
    if (tools.open && tools.mode === mode) toggleExpanded();
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
    setPane(current => ({ ...current, open: false }));
    toolNav.current?.querySelector<HTMLButtonElement>(workspaceToolTrigger(tools.mode))?.focus();
  };
  const togglePanel = () => {
    const opening = !panelVisible;
    if (opening) setMobileHistory(false);
    setPane(current => ({ ...current, open: opening }));
    const focusInside = resize.panel.current?.contains(document.activeElement);
    if (!opening && focusInside) overviewTrigger.current?.focus();
    if (opening && narrow) focusInspector.current = true;
  };
  const toggleHistory = () => {
    focusHistory.current = !historyVisible;
    if (narrow) {
      if (!historyVisible) setPane(current => ({ ...current, open: false }));
      setMobileHistory(!historyVisible);
    } else setHistoryOpen(!historyVisible);
  };
  const goToConversation = () => {
    setMobileHistory(false);
    if (tools.open || (showOverview && (narrow || panelExpanded))) setPane(current => ({ ...current, open: false }));
  };
  const queueChatDraft = (prompt: string) => {
    if (!readyScope || !active || !canChat || chatBusy) return;
    const next = active.draft.trim() ? `${active.draft}\n\n${prompt}` : prompt;
    if (next.length > 8000) { setError("기존 메시지를 유지했습니다. 요청을 추가하려면 입력 내용을 조금 줄여 주세요."); return; }
    changeDraft(next);
    goToConversation();
    setComposerFocus(value => value + 1);
  };
  const askChecklist = (item: ChecklistItem) => {
    const prompt = buildChecklistChatDraft(item, room);
    if (prompt) queueChatDraft(prompt);
  };
  const openPreparationRecord = (target: PreparationRecordTarget) => {
    focusInspector.current = true;
    if (target === "timetable") return openTimetable();
    if (target === "people") { setPeopleShortcut(value => value + 1); return openTool("transport"); }
    openTool(target);
  };
  const returnToSummary = () => {
    focusInspector.current = true;
    setMobileHistory(false);
    setPane(current => ({ ...current, open: true, content: "summary" }));
  };
  const openProgress = () => {
    if (showOverview) (resize.panel.current?.querySelector<HTMLElement>("#workspace-progress-review") ?? inspectorHeading.current)?.focus();
    else {
      focusProgress.current = true;
      setMobileHistory(false);
      setPane({ open: true, content: "summary", expanded: false });
    }
  };
  const openFromSummary = () => {
    focusInspector.current = true;
    openCalendar();
  };
  const leaveMobileHistory = () => {
    if (!narrow) return;
    historyTrigger.current?.focus();
    setMobileHistory(false);
  };
  const summary = overview?.();
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
      {canChat && <span className="workspace-private-label" title="개인 대화"><LockKeyhole size={14} aria-hidden="true" /><span>개인 대화</span></span>}
      <SupportButton screenName="작업 화면" roomName={room.name} />
      {(!historyVisible || narrow) && onOpenSettings && <SettingsEntry placement="toolbar" onOpen={() => navigate(onOpenSettings)} />}
      <span className="workspace-toolbar-divider" /><button type="button" className="workspace-icon-button" aria-label={darkMode ? "라이트 모드" : "다크 모드"} title={darkMode ? "라이트 모드" : "다크 모드"} onClick={onToggleTheme}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
      <button type="button" className="workspace-icon-button" aria-label="로그아웃" title="로그아웃" onClick={() => navigate(onSignOut)}><LogOut size={17} /></button>
    </div></header>;
  const canShowTool = (mode: Tool) => mode === "lodging" ? canChat : mode === "retreatReview" ? canReviewRetreat : mode === "proposals" ? Boolean(renderProposals) : true;
  const chatVisible = !panelExpanded && !(narrow && (panelVisible || historyVisible));
  const navigation = <WorkspaceToolNavigation navRef={toolNav} panelRef={overviewTrigger} active={tools.open ? tools.mode : null}
    showChat={chatVisible && !tools.open} panelOpen={panelVisible} hasPanel={!!overview || pane.content !== "summary"} canExpand={!narrow} expanded={panelExpanded}
    canShow={canShowTool} isDisabled={mode => (mode === "lodging" || mode === "retreatReview") && !scope}
    onChat={goToConversation} onTool={toggleTool}
    onPanel={togglePanel} />;
  const shortcuts = <div className="workspace-chat-shortcuts" role="group" aria-label="빠른 작업">{(["calendar", "transport"] as const).filter(canShowTool).map(mode => {
    const { Icon, name } = workspaceTools[mode];
    return <button key={mode} type="button" className="workspace-start-button" onClick={() => openTool(mode)}><Icon size={17} aria-hidden="true" />{name} 보기</button>;
  })}<BlankGoogleFormLink className="workspace-start-button" /></div>;
  const activePrivacyNotice = privacyNotice?.identity === identity ? privacyNotice : null;
  const saveNearbyPlace = async (current: ConversationScope, name: string) => {
    if (!canChat || hasObviousPrivateData(name)) throw new Error("이 장소를 저장할 수 없습니다.");
    await flushBackendWrites();
    const snapshot: ServerSnapshot = await backendFetch(`/api/data?roomId=${encodeURIComponent(current.roomId)}&conversationId=${encodeURIComponent(current.conversationId)}`);
    if (snapshot.profile.accountId !== current.accountId || getBackendProfile()?.accountId !== current.accountId) throw new Error("접속 계정이 변경됐습니다.");
    const key = privateToolKey(current, "location");
    const record = snapshot.records.find(item => item.key === key);
    if (!record) throw new Error("현재 행사방의 장소 목록을 확인하지 못했습니다.");
    const next = appendConversationPlace(record.value === null ? { location: "" } : JSON.parse(record.value), name);
    if (!next) return "already-saved" as const;
    await backendFetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: current.roomId, writes: [{ key, version: record.version, value: JSON.stringify(next) }] }) });
    await refreshBackendData(current.roomId, current.conversationId).catch(() => { /* The confirmed write already succeeded. */ });
    return "added" as const;
  };
  const chat = <>{(error || notice) && <div className={`workspace-notice ${error || noticeError ? "is-error" : ""}`} role={error || noticeError ? "alert" : "status"}>{error || notice}</div>}{canChat ? <ChatPanel conversation={active} visible={chatVisible} shortcuts={shortcuts} onDraftChange={changeDraft} onSendMessage={submitChat} replyStartedAt={replyStartedAt} onRetryReply={retryReply} onNewConversation={() => create()} onOpenDocuments={() => openTool("documents")} onReviewProposals={renderProposals ? replyId => openTool("proposals", replyId) : undefined}
    renderWorkProposal={readyScope && renderWorkProposal ? message => renderWorkProposal(readyScope, message) : undefined}
    focusRequest={composerFocus}
    renderPreparationShortcuts={readyScope && (message => message.actions?.includes("preparation-facts-used") && <div className="workspace-place-approval">
      <button type="button" className="workspace-start-button" disabled={chatBusy} onClick={() => queueChatDraft("현재 행사의 참가 설문 초안을 만들어 줘.")}>설문 초안</button>
      {canEditPrivateTools && <button type="button" className="workspace-start-button" onClick={openTimetable}>타임테이블 열기</button>}
      {profile.permissions.includes("viewChecklist") && <button type="button" className="workspace-start-button" onClick={() => openTool("prepare")}>체크리스트 열기</button>}
    </div>) || undefined}
        externalAIApproved={consentApproved}
        onSaveNearbyPlace={server && readyScope && canChat ? name => saveNearbyPlace(readyScope, name) : undefined}
        privacyNotice={activePrivacyNotice && <div className="workspace-notice workspace-ai-notice" role="alert">
          <span>{activePrivacyNotice.reason === "private" ? openAIPrivacyWarning : "외부 AI 이용이 꺼져 있어 전송하지 않았습니다."}</span>
          {activePrivacyNotice.reason === "consent" && <a href={externalAISettingsHref} onClick={event => {
            if (onOpenPrivacySettings && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
              event.preventDefault(); navigate(onOpenPrivacySettings);
            }
          }}>보안 및 개인정보 설정</a>}
          {activePrivacyNotice.save && <button type="button" className="workspace-start-button" onClick={() => {
            const entry = activePrivacyNotice.save!;
            setPrivacyNotice(null); sendChat(entry.text, true, entry.reference);
          }}>내부에만 저장</button>}
        </div>}
        progress={overview && <PreparationProgressShortcut {...progress} onOpen={openProgress} />}
        retreatVenueScope={isRetreat ? readyScope ?? undefined : undefined}
        canAddCalendarEvent={message => !!active && (profile.permissions.includes("createEvent") || profile.permissions.includes("editEvent")) && (canAddChatEvent?.(active.id, message) ?? true)}
        onAddCalendarEvent={onAddChatEvent ? message => { if (!active) return; onAddChatEvent(active.id, message); openCalendar(); } : undefined}
        onAddChecklist={readyScope && canEditPrivateTools && onAddChatChecklist ? message => { onAddChatChecklist(readyScope, message); openTool("prepare"); } : undefined}
        onImportRoster={readyScope && canEditPrivateTools ? source => { setRoster({ identity, source }); openTool("transport"); } : undefined}
      /> : <p className="p-4 text-sm text-muted-foreground">대화 권한이 없습니다.</p>}</>;
  const showScheduleTabs = tools.open && tools.mode === "calendar" && canChat;
  const expandLabel = panelExpanded ? "작업 영역 축소" : "작업 영역 확대";
  const SizeIcon = panelExpanded ? Minimize2 : Maximize2;
  const inspector = <aside ref={resize.panel} id="workspace-tools" className="workspace-tools workspace-theme" data-view={showOverview ? "summary" : "tool"}
    data-size={panelExpanded ? "expanded" : "docked"} aria-label={showOverview ? "행사 요약" : "부가기능"} hidden={!panelVisible}>
        {resize.handle}
        <header className="workspace-tools-heading workspace-theme">
          {overview && tools.open && <button type="button" className="workspace-icon-button workspace-summary-back" aria-label="행사 요약으로 돌아가기" title="행사 요약으로 돌아가기" onClick={returnToSummary}><ArrowLeft size={17} aria-hidden="true" /></button>}
          <h2 ref={inspectorHeading} className={showScheduleTabs ? "sr-only" : undefined} tabIndex={-1}>{showOverview ? "행사 요약" : toolName}</h2>
          {showScheduleTabs && <div className="workspace-schedule-tabs" role="tablist" aria-label="일정 보기">
            {scheduleViews.map(({ id, label, icon: Icon }) => <button type="button" key={id} id={`${scheduleId}-${id}-tab`} role="tab"
              aria-selected={scheduleView === id} aria-controls={`${scheduleId}-${id}-panel`} tabIndex={scheduleView === id ? 0 : -1}
              title={!narrow && scheduleView === id ? expandLabel : undefined}
              onClick={() => selectSchedule(id, true)} onKeyDown={event => {
                const next = event.key === "Home" ? "calendar" : event.key === "End" ? "timetable"
                  : event.key === "ArrowRight" || event.key === "ArrowLeft" ? (id === "calendar" ? "timetable" : "calendar") : null;
                if (!next) return;
                event.preventDefault();
                selectSchedule(next);
                document.getElementById(`${scheduleId}-${next}-tab`)?.focus();
              }}><Icon size={16} aria-hidden="true" />{label}</button>)}
          </div>}
          {tools.open && tools.mode === "proposals" && replyIndex >= 0 && <button type="button" className="workspace-start-button workspace-proposals-all" onClick={() => setProposalReply(null)}>전체 제안</button>}
          {!narrow && <button type="button" className="workspace-icon-button workspace-inspector-size" aria-label={expandLabel} aria-controls="workspace-tools" title={expandLabel} onClick={toggleExpanded}><SizeIcon size={17} aria-hidden="true" /></button>}
          <button type="button" className="workspace-icon-button workspace-inspector-close" aria-label={showOverview ? "요약 패널 닫기" : "부가기능 닫기"} title={showOverview ? "요약 패널 닫기" : "부가기능 닫기"} onClick={showOverview ? () => { setPane(current => ({ ...current, open: false })); overviewTrigger.current?.focus(); } : closeTool}><X size={18} aria-hidden="true" /></button>
        </header>
        {summary && <WorkspaceOverview key={identity} hidden={!showOverview} {...summary} event={{ name: room.name, period: timing.key !== "undated" ? room.dateLabel : "", status: roomStatus.label }} scope={readyScope} onCalendar={openFromSummary} progress={progressScope ? <PreparationProgressReview key={identity} {...progress} /> : undefined} />}
        <div className="workspace-inspector-content" hidden={!tools.open}>
        <div className="workspace-shared-content flex min-h-0 flex-col" hidden={tools.mode !== "calendar"}>
          <div className="workspace-calendar-panel" id={`${scheduleId}-calendar-panel`}
            role={canChat ? "tabpanel" : undefined} aria-labelledby={canChat ? `${scheduleId}-calendar-tab` : undefined} hidden={timetableView}>
            {tools.open && tools.mode === "calendar" && !timetableView && server && profile.permissions.includes("viewCalendar") && <GoogleCalendarConnection />}
            {renderTools("calendar")}
          </div>
          {canChat && <div className="workspace-timetable-panel" id={`${scheduleId}-timetable-panel`} role="tabpanel"
            aria-labelledby={`${scheduleId}-timetable-tab`} hidden={!timetableView} tabIndex={0}>
            {timetableOpened && (readyScope ? <WorkspaceTimetable key={identity} scope={readyScope} canEdit={canEditPrivateTools} />
              : <div className="p-4 text-sm text-muted-foreground">{!scope ? "대화를 선택해 주세요."
                : toolsError?.key === identity ? <><p role="alert">{toolsError.message}</p><button type="button" onClick={() => setRetryTools(value => value + 1)}>다시 불러오기</button></>
                : <p role="status">이 대화의 자료를 불러오는 중…</p>}</div>)}
          </div>}
        </div>
        {tools.open && tools.mode !== "calendar" && !readyScope && <div className="p-4 text-sm text-muted-foreground">
          {!scope ? "대화를 선택해 주세요." : toolsError?.key === identity ? <><p role="alert">{toolsError.message}</p><button type="button" onClick={() => setRetryTools((value) => value + 1)}>다시 불러오기</button></> : <p role="status">이 대화의 자료를 불러오는 중...</p>}
        </div>}
        {canReviewRetreat && visitedTools.has("retreatReview") && readyScope && <div className="workspace-location" hidden={!retreatReviewOpen}><RetreatPreparationPanel scope={readyScope}
          onSummarize={() => submitChat(preparationChatQuery)} summaryDisabled={chatBusy || !!active?.draft.trim()} /></div>}
        {readyScope && <PrivateConversationTools key={identity} scope={readyScope} formTargetLabel={`${room.name} / ${active?.title ?? "대화"}`} tools={tools} expanded={panelExpanded} visitedTools={visitedTools} isRetreat={isRetreat} peopleShortcut={peopleShortcut} renderPrepare={() => renderTools("prepare", readyScope, openTimetable, canChat && !chatBusy ? askChecklist : undefined, { open: openPreparationRecord, active: tools.open && tools.mode === "prepare" })}
          renderProposals={renderProposals && (current => renderProposals(current, proposalMessages))} onReviewProposals={() => openTool("proposals")}
          roster={canEditPrivateTools && roster?.identity === identity ? roster.source : undefined} onCloseRoster={applied => {
            if (applied && roster?.identity === identity && roster.source.fromDraft && roster.source.text === active?.draft) changeDraft("");
            setRoster(null);
          }}
          onAddEvent={() => { onAddExtractedEvent(); openCalendar(); }} onAddChecklist={() => { onAddExtractedChecklist(); openTool("prepare"); }}
          onTransportUnsaved={setTransportUnsaved} onOpenTransport={() => openTool("transport")} />}
        </div>
      </aside>;

  return <WorkspaceShell layoutRef={resize.layout} historyRef={resize.history} historyVisible={historyVisible} chatVisible={chatVisible} style={resize.style}
    columns={`${historyVisible ? "has-history" : ""} ${tools.open ? "has-tools" : ""} ${showOverview ? "has-overview" : ""} ${panelExpanded ? "is-tool-expanded" : ""} ${narrow && historyVisible ? "is-history-view" : ""} ${resize.dragging ? "is-resizing-tools" : ""}`}
    onBackToRooms={() => navigate(onBackToRooms)} onOpenSettings={!narrow && onOpenSettings ? () => navigate(onOpenSettings) : undefined} header={header} navigation={navigation} chat={chat} inspector={inspector}
    history={<ConversationSidebar conversations={canChat ? history?.conversations ?? [] : []} activeId={active?.id ?? null} disabled={!history || !store || chatBusy}
      onCreate={() => create(leaveMobileHistory)} onSelect={id => {
        if (id === active?.id) leaveMobileHistory();
        else navigate(() => { if (store && !mutate(() => store.select(id))) leaveMobileHistory(); });
      }}
      onRename={(id, title) => store ? mutate(() => store.rename(id, title)) : "저장소를 사용할 수 없습니다."} onDelete={(id) => store ? mutate(() => store.delete(id), active?.id === id) : "저장소를 사용할 수 없습니다."} />}>
  </WorkspaceShell>;
}

function PrivateConversationTools({ scope, formTargetLabel, tools, expanded, visitedTools, isRetreat, peopleShortcut, renderPrepare, renderProposals, onReviewProposals, onAddEvent, onAddChecklist, onTransportUnsaved, onOpenTransport, roster, onCloseRoster }: {
  scope: ConversationScope; tools: { open: boolean; mode: Tool }; visitedTools: ReadonlySet<Tool>;
  isRetreat: boolean; peopleShortcut: number; expanded: boolean;
  renderPrepare: () => ReactNode; renderProposals?: (scope: ConversationScope) => ReactNode;
  onReviewProposals: () => void; onAddEvent: () => void; onAddChecklist: () => void; onTransportUnsaved: (value: boolean) => void; onOpenTransport: () => void; formTargetLabel: string;
  roster?: ChatRosterSource; onCloseRoster: (applied?: boolean) => void;
}) {
  return <>
    <div className="workspace-shared-content flex min-h-0 flex-col" hidden={tools.mode !== "prepare"}>{visitedTools.has("prepare") && <div className="min-h-0 flex-1">{renderPrepare()}</div>}</div>
    <div className="workspace-documents" hidden={tools.mode !== "documents"}>
      <DocumentsPanel roomId={scope.roomId} scope={scope} onReviewProposals={renderProposals ? onReviewProposals : undefined} onAddExtractedEvent={onAddEvent} onAddExtractedChecklist={onAddChecklist} />
    </div>
    <div className="workspace-location" hidden={tools.mode !== "location"}>{visitedTools.has("location") && <>
      <ConversationLocation scope={scope} expanded={expanded} />
      {isRetreat && <RetreatVenueHistory scope={scope} canRegister />}
    </>}</div>
    <div className="workspace-proposals" hidden={tools.mode !== "proposals"}>{visitedTools.has("proposals") && renderProposals?.(scope)}</div>
    <div className="workspace-transport" hidden={!isTransportTool(tools.mode)}>{(visitedTools.has("transport") || visitedTools.has("lodging")) && <TransportPanel key={scopeId(scope)} roomId={scope.roomId} scope={scope} visible={tools.open && isTransportTool(tools.mode)} expanded={expanded} lodgingView={tools.mode === "lodging"} peopleShortcut={peopleShortcut} formTargetLabel={formTargetLabel} onOpenTransport={onOpenTransport} onUnsavedChange={onTransportUnsaved}
      chatRoster={roster} onCloseChatRoster={onCloseRoster} />}</div>
  </>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : "작업을 완료하지 못했습니다. 다시 시도해 주세요."; }
