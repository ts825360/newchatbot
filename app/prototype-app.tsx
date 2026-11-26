"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EventWorkspace } from "@/components/event-workspace";
import { externalAISettingsHref } from "@/lib/assistant-privacy";
import type { WorkspaceOverviewData } from "@/components/workspace-overview";
import { AUTH_CHANGED_EVENT, createBrowserAuth } from "@/lib/prototype-auth";
import { backendFetch, flushBackendWrites, isBackendConnected, refreshBackendData } from "@/lib/backend-client";
import { normalizeCalendarTime } from "@/lib/calendar-time";
import { normalizeCalendarStatus } from "@/lib/calendar-status";
import type { GoogleEventExportStatus } from "@/lib/server/google-export";
import { usePrototypeTheme } from "@/lib/use-theme";
import { createRoomCatalog } from "@/lib/room-catalog";
import { SharedPanel } from "@/components/shared-panel";
import { RoomDialog } from "@/components/room-dialog";
import { Trash2 } from "lucide-react";
import { useRoomMaterials, validateChecklistItem } from "@/lib/room-materials";
import { Button, Field, inputClass } from "@/components/ui";
import { CalendarEventEditor } from "@/components/calendar-event-editor";
import { ProposalPanel } from "@/components/proposal-panel";
import { ChatWorkCard } from "@/components/chat-work-card";
import { usePreparationEvents, validateCalendarEvent, type ProposalApplyResult, type ProposalDraft } from "@/lib/preparation-store";
import { useRoomRisks } from "@/lib/risk-store";
import { applyReviewedProposal } from "@/lib/proposal-application";
import { chatCalendarSourceId, createChatCalendarEvent, extractChatCalendarFields } from "@/lib/chat-calendar";
import { buildChatChecklist } from "@/lib/chat-tool-candidates";
import {
  createInitialState
} from "@/lib/prototype-state";
import type { CalendarEvent, ChatMessage, ChecklistItem, PrototypeState } from "@/lib/types";
import { scopeId, type ConversationScope } from "@/lib/conversation-scope";

const checklistExamples = ["차량 배정", "숙소 배정", "식사 준비", "행사 일정", "참석 설문 초안 작성", "준비물 확인", "물놀이 계획", "물놀이 진행 확정", "물놀이 미진행 확정", "물놀이 안전 담당"];

export function PrototypeApp() {
  const [state, setState] = useState<PrototypeState>(() => createInitialState());
  const [signedIn, setSignedIn] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const router = useRouter();
  const { darkMode, toggleTheme } = usePrototypeTheme();
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [calendarNotice, setCalendarNotice] = useState({ text: "", failed: false });
  const [savedCalendarEvent, setSavedCalendarEvent] = useState<{ roomId: string; eventId: string } | null>(null);
  const [eventEditor, setEventEditor] = useState<CalendarEvent | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventError, setEventError] = useState("");
  const [checklistEditor, setChecklistEditor] = useState<ChecklistItem | null>(null);
  const [checklistEditorScope, setChecklistEditorScope] = useState("");
  const [checklistIsNew, setChecklistIsNew] = useState(false);
  const [checklistError, setChecklistError] = useState("");
  const [confirmChecklistDelete, setConfirmChecklistDelete] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [saving, setSaving] = useState(false);
  const writePending = useRef(false);
  const logoutPending = useRef(false);
  const workspaceVersion = useRef(0);
  const [selectedScope, setSelectedScope] = useState<ConversationScope | null>(null);
  const privateScope = selectedScope?.accountId === (state.profile.accountId ?? state.profile.nickname) && selectedScope?.roomId === state.activeRoomId ? selectedScope : null;
  const privateIdentity = privateScope ? scopeId(privateScope) : "";

  const activeRoom = useMemo(
    () => state.rooms.find((room) => room.id === state.activeRoomId),
    [state.activeRoomId, state.rooms]
  );
  const { loaded: calendarLoaded, events: activeEvents, error: calendarError, saveEvent: persistEvent, deleteEvent: removeEvent } = usePreparationEvents(state.activeRoomId, state.events[state.activeRoomId] ?? []);
  const { loaded: checklistLoaded, checklist: activeChecklist, error: materialsError, updateChecklist } = useRoomMaterials(state.activeRoomId, [], privateScope);
  const { risks: activeRisks, error: riskError, resolve: persistRiskResolution } = useRoomRisks(state.activeRoomId, [], privateScope);
  const activeMessages = useMemo(() => isBackendConnected() ? [] : state.chatByRoom[state.activeRoomId] ?? [], [state.chatByRoom, state.activeRoomId]);
  const canCreateEvents = state.profile.permissions.includes("createEvent");
  const canEditEvents = state.profile.permissions.includes("editEvent");
  const canDeleteEvents = canEditEvents && state.profile.permissions.includes("deleteEvent");
  const canEditChecklist = state.profile.permissions.includes("editChecklist");
  const savedEventWasConfirmed = activeEvents.some(event => event.id === editingEventId && event.status === "confirmed");

  useEffect(() => {
    workspaceVersion.current++;
    setChecklistEditor(null); setChecklistError(""); setConfirmChecklistDelete(false); setEventEditor(null); setEventError(""); setEditingEventId(null); setWorkspaceError("");
    setSavedCalendarEvent(null); setCalendarNotice({ text: "", failed: false });
    return () => { workspaceVersion.current++; };
  }, [state.activeRoomId, state.profile.accountId]);
  useEffect(() => {
    setChecklistEditor(null); setChecklistError(""); setConfirmChecklistDelete(false); setWorkspaceNotice("");
  }, [privateIdentity]);

  useEffect(() => {
    if (!savedCalendarEvent || savedCalendarEvent.roomId !== state.activeRoomId) return;
    const controller = new AbortController();
    const deadline = Date.now() + 75_000;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let nextDelay = 1000;
      try {
        const query = new URLSearchParams(savedCalendarEvent);
        const result: GoogleEventExportStatus = await backendFetch(`/api/integrations/google/event-status?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.state === "synced") {
          setCalendarNotice({ text: "일정 저장 및 Google 전송 완료", failed: false });
          return;
        }
        if (result.state === "unavailable") {
          setCalendarNotice({ text: `일정 저장 완료 · Google 미전송: ${result.error}`, failed: false });
          return;
        }
        if (result.state === "notScheduled") {
          setCalendarNotice({ text: "일정 저장 완료 · Google 전송 대상 아님", failed: false });
          return;
        }
        if (result.state === "failed") {
          setCalendarNotice({ text: `일정은 저장됐지만 Google 전송 실패: ${result.error}`, failed: true });
          nextDelay = 5000;
        }
      } catch {
        if (controller.signal.aborted) return;
        setCalendarNotice({ text: "일정 저장 완료 · Google 전송 상태를 확인하지 못했습니다.", failed: false });
        nextDelay = 5000;
      }
      if (Date.now() < deadline) timer = setTimeout(() => void poll(), nextDelay);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [savedCalendarEvent, state.activeRoomId, state.profile.accountId]);

  useEffect(() => {
    const checkSession = () => {
      try {
        const profile = createBrowserAuth().currentProfile();
        if (!profile) {
          setSignedIn(false);
          router.replace("/login");
          return;
        }
        const catalog = createRoomCatalog(sessionStorage, profile).load();
        if (!catalog.selectedRoomId) {
          setSignedIn(false);
          router.replace("/rooms");
          return;
        }
        setState((current) => ({
          ...current,
          profile: { ...profile, roomIds: catalog.rooms.map((room) => room.id) },
          rooms: catalog.rooms,
          activeRoomId: catalog.selectedRoomId!
        }));
        setSignedIn(true);
      } catch {
        setSignedIn(false);
        router.replace("/rooms");
      }
    };
    checkSession();
    window.addEventListener("focus", checkSession);
    window.addEventListener("storage", checkSession);
    window.addEventListener(AUTH_CHANGED_EVENT, checkSession);
    const timer = window.setInterval(checkSession, 60_000);
    return () => {
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("storage", checkSession);
      window.removeEventListener(AUTH_CHANGED_EVENT, checkSession);
      window.clearInterval(timer);
    };
  }, [router]);

  const signOut = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    try {
      if (isBackendConnected()) await flushBackendWrites();
      const pending: unknown = createBrowserAuth().logout();
      if (pending) await pending;
      setSignOutError("");
      setSignedIn(false);
      router.replace("/login");
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요.");
    }
    finally { logoutPending.current = false; }
  };

  const commitWrite = async (write: () => boolean, onSaved: () => void, onError = setWorkspaceError) => {
    if (writePending.current || logoutPending.current) return;
    const version = workspaceVersion.current;
    writePending.current = true; setSaving(true); onError("");
    try {
      if (!write()) return;
      if (isBackendConnected()) await flushBackendWrites();
      if (version === workspaceVersion.current) onSaved();
    } catch (cause) {
      if (version === workspaceVersion.current) onError(cause instanceof Error ? cause.message : "서버에 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally { writePending.current = false; setSaving(false); }
  };

  const addDocumentEventCandidate = () => commitWrite(
    () => persistEvent({ id: "doc-water-safety-candidate", title: "샘플: 물놀이 안전 점검", date: activeRoom?.date || "2026-08-16", time: "10:00", endTime: "", location: "", memo: "회의록 예시에서 구성한 샘플입니다.", status: "pending", author: "행사비서", lastEditor: "행사비서", changeLog: "샘플 일정 후보가 추가되었습니다." }),
    () => setWorkspaceNotice("샘플 일정 후보가 추가되었습니다.")
  );

  const addDocumentChecklistCandidate = () => commitWrite(
    () => updateChecklist((existing) => existing.some((item) => item.id === "doc-vehicle-checklist") ? existing : [...existing, {
      id: "doc-vehicle-checklist", title: "문서 추출: 차량 배정표 작성", status: "needsReview", owner: "미지정", due: "2026-08-08", memo: "회의록에서 발견된 준비 항목 후보"
    }]),
    () => setWorkspaceNotice("샘플 준비 항목이 추가되었습니다.")
  );

  const openAddEvent = (date?: string) => {
    if (writePending.current || !canCreateEvents) return;
    const fallbackDate = date ?? activeRoom?.date ?? new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setEventError("");
    setEditingEventId(null);
    setEventEditor({
      id: `event-${crypto.randomUUID()}`,
      title: "새 일정",
      date: fallbackDate,
      time: "",
      endTime: "",
      location: "",
      memo: "",
      status: "confirmed",
      author: state.profile.nickname,
      lastEditor: state.profile.nickname,
      changeLog: `${state.profile.nickname}님이 새 일정을 추가했습니다.`
    });
  };

  const openExistingEvent = (eventId: string) => {
    if (writePending.current) return;
    const event = activeEvents.find((item) => item.id === eventId);
    if (!event) {
      return;
    }
    setEditingEventId(eventId);
    setEventError("");
    setEventEditor({ ...event });
  };

  const canAddChatEvent = (conversationId: string, message: ChatMessage) => {
    if (message.sender !== "user") return false;
    const id = chatCalendarSourceId(state.profile.accountId ?? state.profile.nickname, conversationId, message.id);
    return state.profile.permissions.includes(activeEvents.some(event => event.id === id) ? "editEvent" : "createEvent");
  };

  const openChatEvent = (conversationId: string, message: ChatMessage) => {
    if (writePending.current || !canAddChatEvent(conversationId, message)) return;
    const event = createChatCalendarEvent({ accountId: state.profile.accountId ?? state.profile.nickname, conversationId, messageId: message.id, text: message.text, author: state.profile.nickname });
    if (activeEvents.some(item => item.id === event.id)) { openExistingEvent(event.id); return; }
    setEditingEventId(null);
    setEventEditor(event);
    const issue = extractChatCalendarFields(message.text).dateIssue;
    setEventError(issue === "multiple" || issue === "ambiguous" ? "날짜가 여러 개이거나 모호합니다. 날짜를 직접 선택해 주세요." : issue ? "연도를 포함한 올바른 날짜를 직접 입력해 주세요." : "");
  };

  const saveEvent = () => {
    if (!eventEditor) return;
    if (!(editingEventId ? canEditEvents : canCreateEvents)) {
      setEventError("일정을 저장할 권한이 없습니다."); return;
    }
    const time = normalizeCalendarTime(eventEditor.time);
    const endTime = normalizeCalendarTime(eventEditor.endTime ?? "");
    const status = normalizeCalendarStatus(eventEditor.status);
    const next = { ...eventEditor, time: time ?? "", endTime: endTime ?? "", status };
    const error = time === null || endTime === null ? "일정 시간을 다시 선택해 주세요." : validateCalendarEvent(next);
    setEventError(error);
    if (error) return;
    return commitWrite(
      () => persistEvent({ ...next, lastEditor: state.profile.nickname, changeLog: `${state.profile.nickname}님이 ${eventEditor.title} 일정을 ${editingEventId ? "수정" : "추가"}했습니다.` }, !!editingEventId),
      () => {
        setEventEditor(null); setEditingEventId(null); setWorkspaceNotice("");
        const willExport = status === "confirmed" && isBackendConnected();
        setCalendarNotice({ text: willExport ? "일정 저장 완료 · Google 전송 대기 중" : "일정 저장 완료", failed: false });
        setSavedCalendarEvent(willExport ? { roomId: state.activeRoomId, eventId: eventEditor.id } : null);
      }, setEventError
    );
  };

  const canApproveProposal = (kind: ProposalDraft["kind"]) => kind === "calendar"
    ? state.profile.permissions.includes("createEvent") && state.profile.permissions.includes("editEvent")
    : state.profile.permissions.includes("editChecklist");
  const applyProposal = (scope: ConversationScope, draft: ProposalDraft): ProposalApplyResult | Promise<ProposalApplyResult> => {
    if (!activeRoom || scopeId(scope) !== privateIdentity) return false;
    if (!canApproveProposal(draft.kind)) return { ok: false, error: "이 제안을 반영할 권한이 없습니다." };
    const result = applyReviewedProposal(localStorage, activeRoom, state.profile.nickname, draft, { events: state.events[activeRoom.id] ?? [] }, scope);
    if (!isBackendConnected() || !(typeof result === "boolean" ? result : result.ok)) return result;
    return flushBackendWrites().then(() => result).catch(cause => ({ ok: false, error: cause instanceof Error ? cause.message : "서버에 저장하지 못했습니다." }));
  };

  const openChatChecklist = (scope: ConversationScope, message: ChatMessage) => {
    if (writePending.current || scopeId(scope) !== privateIdentity || message.sender !== "user" || !state.profile.permissions.includes("editChecklist")) return;
    const draft = buildChatChecklist(scope, message);
    const existing = activeChecklist.find(item => item.id === draft.id);
    setChecklistEditorScope(privateIdentity); setChecklistIsNew(!existing); setChecklistError(""); setConfirmChecklistDelete(false);
    setChecklistEditor(existing ?? draft);
  };

  const saveChecklist = () => {
    if (!checklistEditor || checklistEditorScope !== privateIdentity || !state.profile.permissions.includes("editChecklist")) return;
    const error = validateChecklistItem(checklistEditor);
    setChecklistError(error);
    if (error) return;
    const next = { ...checklistEditor, title: checklistEditor.title.trim(), owner: checklistEditor.owner.trim() };
    return commitWrite(() => updateChecklist((items) => {
      if (!checklistIsNew && !items.some((item) => item.id === next.id)) throw new Error("이미 삭제된 항목입니다. 편집을 닫고 다시 확인해 주세요.");
      if (checklistIsNew && items.some(item => item.id === next.id)) return items;
      return checklistIsNew ? [...items, next] : items.map((item) => item.id === next.id ? next : item);
    }), () => setChecklistEditor(null), setChecklistError);
  };

  const resolveRisk = (riskId: string) => { if (canEditChecklist) commitWrite(() => persistRiskResolution(riskId), () => {}); };
  const leaveWorkspace = async (href: "/rooms" | "/settings?from=workspace" | typeof externalAISettingsHref) => {
    try {
      if (isBackendConnected()) await flushBackendWrites();
      if (href === "/rooms") router.replace(href);
      else router.push(href);
    } catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : "서버에 저장하지 못했습니다."); }
  };
  const backToRooms = () => leaveWorkspace("/rooms");

  if (!signedIn) {
    return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground" role="status">접속 확인 중...</main>;
  }

  if (signOutError) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <section className="w-full max-w-md rounded-lg border border-border bg-panel p-6">
          <div role="alert">
            <h1 className="text-lg font-semibold">로그아웃하지 못했습니다</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{signOutError}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{isBackendConnected() ? "미저장 변경사항과 연결 상태를 확인한 뒤 다시 시도해 주세요." : "아직 로그인된 상태입니다. 문제가 계속되면 브라우저 설정에서 이 사이트의 데이터를 삭제해 주세요."}</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={signOut}>다시 시도</Button>
            <Button type="button" variant="outline" onClick={() => setSignOutError("")}>작업 화면으로 돌아가기</Button>
          </div>
        </section>
      </main>
    );
  }

  if (!activeRoom) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
        <section className="rounded-lg border border-border bg-panel p-6 text-center">
          <h1 className="text-lg font-semibold">접근 가능한 행사방이 없습니다.</h1>
          <p className="mt-2 text-sm text-muted-foreground">새 초대키로 다시 입장해 주세요.</p>
          <Button className="mt-4" type="button" variant="primary" onClick={signOut}>
            로그인 화면으로
          </Button>
        </section>
      </main>
    );
  }

  const renderTools = (mode: "calendar" | "prepare", scope?: ConversationScope, onOpenTimetable?: () => void) => {
    if (mode === "prepare" && (!scope || scopeId(scope) !== privateIdentity)) return null;
    const error = mode === "calendar" ? calendarError : materialsError || riskError;
    return (
    <div className="flex h-full min-h-0 flex-col">
    {error && <p role="alert" className="documents-error px-4">{error}</p>}
    <SharedPanel
      mode={mode}
      scope={mode === "prepare" ? scope : undefined}
      onOpenTimetable={onOpenTimetable}
      room={activeRoom}
      events={activeEvents}
      checklist={mode === "prepare" ? activeChecklist : []}
      risks={mode === "prepare" ? activeRisks : []}
      onOpenEvent={openExistingEvent}
      onAddEvent={canCreateEvents ? openAddEvent : undefined}
      canEditEvents={canEditEvents}
      canEditChecklist={canEditChecklist}
      onRefreshCalendar={mode === "calendar" && isBackendConnected() ? () => refreshBackendData(activeRoom.id, null) : undefined}
      onToggleChecklist={(itemId) => {
        if (canEditChecklist) commitWrite(() => updateChecklist((items) => items.map((item) => item.id === itemId ? { ...item, status: item.status === "done" ? "inProgress" : "done" } : item)), () => {});
      }}
      onAddChecklist={() => {
        if (!canEditChecklist || writePending.current) return;
        setChecklistEditorScope(privateIdentity);
        setChecklistIsNew(true); setChecklistError(""); setConfirmChecklistDelete(false);
        setChecklistEditor({ id: crypto.randomUUID(), title: "", owner: "", due: "", status: "needsReview", memo: "" });
      }}
      onOpenChecklist={(itemId) => {
        if (!canEditChecklist || writePending.current) return;
        const item = activeChecklist.find((entry) => entry.id === itemId);
        if (item) {
          setChecklistEditorScope(privateIdentity);
          setChecklistIsNew(false); setChecklistError(""); setConfirmChecklistDelete(false);
          setChecklistEditor({ ...item });
        }
      }}
      onResolveRisk={resolveRisk}
    />
    </div>
  ); };

  const canPreviewCalendar = state.profile.permissions.includes("viewCalendar");
  const canOpenOverview = canPreviewCalendar || (state.profile.permissions.includes("chat") && state.profile.permissions.includes("viewChecklist"));
  const overview = (): WorkspaceOverviewData => ({
    calendar: !canPreviewCalendar ? undefined : calendarError ? { state: "error" } : calendarLoaded ? { state: "ready", items: activeEvents } : { state: "loading" },
    onEvent: openExistingEvent,
  });

  return (
    <main className="workspace-page h-dvh overflow-hidden bg-background text-foreground" aria-busy={saving}>
      <EventWorkspace key={`${state.profile.accountId}:${activeRoom.id}`} room={activeRoom} profile={state.profile} seedMessages={activeMessages} notice={workspaceNotice || calendarNotice.text} noticeError={!workspaceNotice && calendarNotice.failed} darkMode={darkMode} onToggleTheme={toggleTheme} onSignOut={signOut} onBackToRooms={backToRooms} onOpenSettings={() => leaveWorkspace("/settings?from=workspace")} onOpenPrivacySettings={() => leaveWorkspace(externalAISettingsHref)} onAddExtractedEvent={addDocumentEventCandidate} onAddExtractedChecklist={addDocumentChecklistCandidate} onAddChatEvent={openChatEvent} canAddChatEvent={canAddChatEvent} onAddChatChecklist={openChatChecklist} onScopeChange={setSelectedScope}
        overview={canOpenOverview ? overview : undefined}
        renderTools={renderTools} renderProposals={(scope, messages) => <ProposalPanel room={activeRoom} scope={scope} messages={messages} onApply={(draft) => applyProposal(scope, draft)}
          canApprove={canApproveProposal} remember={state.profile.permissions.includes("editChecklist")} />}
        renderWorkProposal={(scope, message) => <ChatWorkCard key={`${scopeId(scope)}:${message.id}`} scope={scope} message={message} onApply={draft => applyProposal(scope, draft)}
          canApprove={!message.workProposal || message.workProposal.kind === "survey" || canApproveProposal(message.workProposal.kind)} remember={state.profile.permissions.includes("editChecklist")} />} />

      {workspaceError && <RoomDialog title="저장 확인" onClose={() => setWorkspaceError("")}><div className="room-dialog-body"><p role="alert" className="documents-error">{workspaceError}</p></div><footer className="room-dialog-footer"><Button type="button" variant="outline" onClick={() => setWorkspaceError("")}>닫기</Button></footer></RoomDialog>}

      {eventEditor && <CalendarEventEditor value={eventEditor} editing={!!editingEventId} readOnly={editingEventId ? !canEditEvents : !canCreateEvents} wasConfirmed={savedEventWasConfirmed} error={eventError || calendarError || (!editingEventId && !canCreateEvents ? "일정을 저장할 권한이 없습니다." : "")} onChange={value => { if (!writePending.current) { setEventEditor(value); setEventError(""); } }} onSave={saveEvent} onClose={() => { if (!writePending.current) { setEventEditor(null); setEditingEventId(null); } }} onDelete={canDeleteEvents ? () => commitWrite(() => removeEvent(eventEditor.id), () => { setEventEditor(null); setEditingEventId(null); }, setEventError) : undefined} />}

      {checklistEditor && checklistEditorScope === privateIdentity ? (
        <RoomDialog title={confirmChecklistDelete ? "준비 항목 삭제" : checklistIsNew ? "준비 항목 추가" : "준비 항목 수정"} onClose={() => { if (writePending.current) return; if (confirmChecklistDelete) setConfirmChecklistDelete(false); else setChecklistEditor(null); }}>
        <form className="checklist-editor" noValidate onSubmit={(event) => { event.preventDefault(); if (!confirmChecklistDelete) saveChecklist(); }}>
          {(checklistError || materialsError) && <p role="alert" className="documents-error">{checklistError || materialsError}</p>}
          {confirmChecklistDelete ? <><p className="checklist-delete-copy">{checklistEditor.title} 항목을 삭제할까요?</p><div className="checklist-editor-actions"><Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmChecklistDelete(false)}>취소</Button><Button type="button" variant="danger" disabled={saving} onClick={() => commitWrite(() => updateChecklist((items) => items.filter((item) => item.id !== checklistEditor.id)), () => { setChecklistEditor(null); setConfirmChecklistDelete(false); }, setChecklistError)}>삭제하기</Button></div></> : <>
          <div className="grid gap-4">
            <Field label="항목">
              <input className={inputClass} required value={checklistEditor.title} onChange={(event) => setChecklistEditor({ ...checklistEditor, title: event.target.value })} />
            </Field>
            {checklistIsNew && <Field label="항목 예시">
              <select aria-label="항목 예시" className={inputClass} value="" onChange={event => {
                if (event.target.value) setChecklistEditor({ ...checklistEditor, title: event.target.value });
              }}><option value="">예시 선택</option>{checklistExamples.filter(title => "category" in activeRoom && activeRoom.category === "retreat" || !title.startsWith("물놀이")).map(title => <option key={title}>{title}</option>)}</select>
            </Field>}
            <div className="checklist-editor-fields">
              <Field label="담당자">
                <input className={inputClass} value={checklistEditor.owner} onChange={(event) => setChecklistEditor({ ...checklistEditor, owner: event.target.value })} />
              </Field>
              <Field label="마감일">
                <input className={inputClass} type="date" value={checklistEditor.due} onChange={(event) => setChecklistEditor({ ...checklistEditor, due: event.target.value })} />
              </Field>
            </div>
            <Field label="상태">
              <select
                aria-label="상태"
                className={inputClass}
                value={checklistEditor.status}
                onChange={(event) => setChecklistEditor({ ...checklistEditor, status: event.target.value as ChecklistItem["status"] })}
              >
                <option value="done">완료</option>
                <option value="inProgress">진행 중</option>
                <option value="needsReview">확인 필요</option>
                <option value="risk">누락 위험</option>
              </select>
            </Field>
            <Field label="메모">
              <textarea className={inputClass} value={checklistEditor.memo} onChange={(event) => setChecklistEditor({ ...checklistEditor, memo: event.target.value })} rows={3} />
            </Field>
          </div>
          <div className="checklist-editor-actions">{!checklistIsNew && <Button type="button" variant="danger" disabled={saving} onClick={() => { setChecklistError(""); setConfirmChecklistDelete(true); }}><Trash2 size={16} aria-hidden="true" />항목 삭제</Button>}<Button type="button" variant="outline" disabled={saving} onClick={() => setChecklistEditor(null)}>취소</Button><Button type="submit" variant="primary" disabled={saving}>저장</Button></div>
          </>}
        </form>
        </RoomDialog>
      ) : null}
    </main>
  );
}
