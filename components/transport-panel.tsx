"use client";

import { Check, Download, FileUp, LoaderCircle, Play, Plus, Undo2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createTransportDemo, createTransportDraft, isTransportResult, moveTransportAssignment, resolveTransportEntries, transportCsv, transportReservationCsv, transportRosterCsv, transportUnnamedParticipant, transportVehicleSeatError, tripFor, validateTransportInput, validateTransportResult, type Direction, type TransportAssignment, type TransportInput, type TransportResult } from "@/lib/transport";
import { analyzeSurvey, mergeGoogleSurvey, surveyTransportInput, type TransportSurvey } from "@/lib/transport-survey";
import { parseTransportSnapshot as loadSnapshot, type TransportSnapshot as Snapshot } from "@/lib/transport-snapshot";
import { TransportBoard } from "./transport-board";
import { TransportComparisonPanel } from "./transport-comparison-panel";
import { TransportConfig } from "./transport-config";
import { TransportLodging } from "./transport-lodging";
import { rosterFingerprint } from "@/lib/lodging-plan";
import { SurveyPreview, TransportSurveyForm } from "./transport-survey-form";
import type { ChatRosterSource } from "@/lib/chat-tool-candidates";
import { ChatRosterDialog } from "./chat-roster-dialog";
import { setGoogleFormsRosterTarget } from "@/lib/google-forms-roster-target";
import { writeBrowserRecord } from "@/lib/storage-status";
import { dataStorage, flushBackendWrites, isBackendConnected } from "@/lib/backend-client";
import { privateToolKey, type ConversationScope } from "@/lib/conversation-scope";
import { buildTransportPlan, quoteLabel, recordedTransportQuote, type ComparisonSlot, type TransportComparison } from "@/lib/transport-comparison";
import "./transport-panel.css";

const tabs = [
  { id: "teams", label: "팀 구성" }, { id: "vehicles", label: "차량" }, { id: "people", label: "참가자" },
  { id: "board", label: "배치" }, { id: "compare", label: "배정안 비교" },
] as const;
type TransportTab = typeof tabs[number]["id"];
const seed = (demo = false, revision = 1): Snapshot => ({ input: { ...(demo ? { ...createTransportDemo(), extraCount: 3 } : createTransportDraft()), revision }, result: null, baseline: null, approved: false, demo });

export function TransportPanel({ roomId, scope, onUnsavedChange, surveyShortcut = 0, surveyView, lodgingView = false, formTargetLabel, onOpenTransport, chatRoster, onCloseChatRoster }: {
  roomId: string; scope?: ConversationScope; onUnsavedChange?: (unsaved: boolean) => void;
  surveyShortcut?: number; surveyView?: boolean; lodgingView?: boolean; formTargetLabel?: string; onOpenTransport?: () => void;
  chatRoster?: ChatRosterSource; onCloseChatRoster?: (applied?: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => seed());
  const [tab, setTab] = useState<TransportTab>("teams");
  const [newParticipantId, setNewParticipantId] = useState<string>();
  const tabPrefix = useId();
  const [capturing, setCapturing] = useState<ComparisonSlot | null>(null);
  const latestSnapshot = useRef(snapshot); latestSnapshot.current = snapshot;
  const [importOpen, setImportOpen] = useState(false);
  const [preferGoogle, setPreferGoogle] = useState(false);
  const [importBlocked, setImportBlocked] = useState(false);
  const [direction, setDirection] = useState<Direction>("outbound");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saveError, setSaveError] = useState("");
  const [replanAll, setReplanAll] = useState(false); const [undo, setUndo] = useState<Snapshot[]>([]);
  const [unsaved, setUnsaved] = useState(false);
  const [exportFilter, setExportFilter] = useState("all");
  const [vehicleSelection, setVehicleSelection] = useState<string[]>([]);
  const [vehicleDeleteOpen, setVehicleDeleteOpen] = useState(false);
  const [pending, setPending] = useState<TransportAssignment | "approve" | "reset" | "start" | null>(null);
  const controller = useRef<AbortController | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const showingSurvey = !lodgingView && (surveyView ?? (importOpen && tab === "people"));
  const pauseAssignment = showingSurvey;
  const storageKey = scope ? privateToolKey(scope, "transport") : `church:transport:v1:${roomId}`;
  const activeStorageKey = useRef(storageKey); activeStorageKey.current = storageKey;
  const { input, result, baseline, approved, demo, survey } = snapshot;
  const stale = Boolean(result && result.revision !== input.revision);
  const errors = useMemo(() => result ? validateTransportResult(input, result) : [], [input, result]);
  const shortage = result && !stale && result.unreservedCount ? [input.extraOutboundTripId, input.extraReturnTripId].flatMap(id => {
    const trip = input.trips.find(t => t.id === id);
    const holds = result.reservations.filter(r => r.tripId === id).reduce((count, r) => count + r.count, 0);
    return trip && holds < input.extraCount ? [`${trip.label} ${input.extraCount - holds}석`] : [];
  }) : [];
  const inputErrors = useMemo(() => validateTransportInput(input, { draft: true }), [input]);
  const hasRegisteredVehicle = input.vehicles.length > 0;
  const hasCalculableVehicle = input.vehicles.some((v) => v.enabled && v.tripIds.length > 0 && !transportVehicleSeatError(v));
  const selectedVehicles = input.vehicles.filter((v) => vehicleSelection.includes(v.id));
  const selectedVehicleIds = selectedVehicles.map((v) => v.id);
  const lockedVehicles = selectedVehicles.filter((v) => input.locks.some((a) => a.vehicleId === v.id));
  const selectTab = (next: TransportTab) => { setTab(next); setImportBlocked(false); setNewParticipantId(undefined); if (surface.current) surface.current.scrollTop = 0; };
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((entry) => entry.id === tab);
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + direction + tabs.length) % tabs.length;
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    selectTab(tabs[next].id);
  };
  useEffect(() => {
    setSnapshot(seed()); setUndo([]); setPending(null); setError(""); setSaveError(""); setUnsaved(false); setBusy(false); setTab("teams"); setDirection("outbound"); setImportOpen(false); setImportBlocked(false);
    setVehicleSelection([]); setVehicleDeleteOpen(false); setExportFilter("all"); setCapturing(null);
    setNewParticipantId(undefined);
    try {
      const raw = dataStorage(sessionStorage).getItem(storageKey);
      if (raw) {
        const value = loadSnapshot(raw);
        setSnapshot(value);
        if (value.result) setTab("board");
      }
    } catch { setSaveError("저장된 배정을 읽지 못했습니다. 현재 자료를 확인한 뒤 다시 저장해 주세요."); }
    return () => controller.current?.abort();
  }, [storageKey]);
  useEffect(() => {
    if (!surveyView && !surveyShortcut) return;
    if (surveyView === undefined) setTab("people");
    setImportBlocked(false); setPreferGoogle(true); setImportOpen(true);
  }, [surveyView, surveyShortcut, storageKey]);
  useEffect(() => {
    if (surface.current) surface.current.scrollTop = 0;
  }, [showingSurvey, surveyShortcut, lodgingView]);
  useEffect(() => {
    if (!isBackendConnected()) return;
    const reload = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      try {
        const raw = dataStorage(sessionStorage).getItem(storageKey);
        if (raw) setSnapshot(loadSnapshot(raw));
      } catch { setSaveError("서버 배정 정보를 읽지 못했습니다."); }
    };
    window.addEventListener("storage", reload); return () => window.removeEventListener("storage", reload);
  }, [storageKey]);
  useEffect(() => { onUnsavedChange?.(unsaved); return () => onUnsavedChange?.(false); }, [unsaved, onUnsavedChange]);
  useEffect(() => {
    if (!unsaved) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect);
  }, [unsaved]);
  const persist = (next: Snapshot, remember = true) => {
    if (remember) setUndo((items) => [...items.slice(-4), snapshot]);
    setSnapshot(next);
    try {
      writeBrowserRecord(dataStorage(sessionStorage), storageKey, next, "tab"); setSaveError(""); setUnsaved(false);
      if (!isBackendConnected()) window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
      if (isBackendConnected()) return flushBackendWrites().then(() => { if (activeStorageKey.current === storageKey) { setSaveError(""); setUnsaved(false); } return true; }).catch((e) => { if (activeStorageKey.current === storageKey) { setSaveError(e.message); setUnsaved(true); } return false; });
      return Promise.resolve(true);
    }
    catch { setSaveError("현재 변경을 저장하지 못했습니다. 이 화면에서 다시 저장해 주세요."); setUnsaved(true); return Promise.resolve(false); }
  };
  const change = (next: TransportInput) => {
    persist({ ...snapshot, input: resolveTransportEntries({ ...next, revision: input.revision + 1, previousAssignments: [] }), approved: false });
    setError("");
  };
  const addParticipant = () => {
    if (input.people.length >= 250) return;
    const defaultTrip = (direction: Direction, preferred: string) => input.trips.find(t => t.id === preferred)?.id ?? input.trips.find(t => t.direction === direction)?.id ?? null;
    const id = crypto.randomUUID();
    change({ ...input, people: [{ id, name: transportUnnamedParticipant, department: "미분류", familyId: "", companionGroup: "", outboundTripId: defaultTrip("outbound", "main"), returnTripId: defaultTrip("return", "normal") }, ...input.people] });
    surface.current?.scrollTo?.({ top: 0 });
    setNewParticipantId(id);
  };
  const setComparison = (comparison: TransportComparison) => persist({ ...snapshot, comparison }, false);
  const undoAllocation = () => {
    const previous = undo.at(-1);
    if (!previous) return;
    const revision = input.revision + 1;
    const fresh = previous.result?.revision === previous.input.revision;
    const comparison = Boolean(previous.demo) === Boolean(snapshot.demo) ? snapshot.comparison : previous.comparison;
    const roomByPerson = new Map(input.people.map(person => [person.id, person.roomAssignment]));
    const people = previous.input.people.map(person => roomByPerson.has(person.id) ? { ...person, roomAssignment: roomByPerson.get(person.id) } : person);
    const sameMode = Boolean(previous.demo) === Boolean(snapshot.demo);
    persist({ ...previous, comparison, ...(sameMode ? { lodgingPlan: snapshot.lodgingPlan, rosterConfirmation: snapshot.rosterConfirmation } : {}), input: { ...previous.input, people, revision },
      result: previous.result ? { ...previous.result, revision: fresh ? revision : previous.result.revision } : null,
      approved: false }, false);
    setUndo(undo.slice(0, -1));
  };
  const captureComparison = async (slot: ComparisonSlot) => {
    if (!result || stale || capturing || busy) return;
    setCapturing(slot); setError("");
    try {
      const plan = await buildTransportPlan(input, result);
      if (activeStorageKey.current !== storageKey || latestSnapshot.current !== snapshot) return;
      setComparison({ ...snapshot.comparison, [slot]: plan });
    } catch (cause) {
      if (activeStorageKey.current === storageKey) setError(cause instanceof Error ? cause.message : "비교안을 담지 못했습니다.");
    } finally {
      if (activeStorageKey.current === storageKey) setCapturing(null);
    }
  };
  const deleteVehicles = () => {
    if (!selectedVehicleIds.length || lockedVehicles.length) return;
    const vehicles = input.vehicles.filter((v) => !selectedVehicleIds.includes(v.id));
    const previousAssignments = input.previousAssignments.filter((a) => a.vehicleId === null || !selectedVehicleIds.includes(a.vehicleId));
    persist({ ...snapshot, input: { ...input, vehicles, previousAssignments, revision: input.revision + 1 }, approved: false });
    if (selectedVehicleIds.includes(exportFilter)) setExportFilter("all");
    setVehicleSelection([]); setVehicleDeleteOpen(false); setError("");
  };
  const openImport = () => {
    if ((!hasRegisteredVehicle || demo) && !importOpen) { setImportBlocked(true); return; }
    setImportBlocked(false);
    setError("");
    setTab("people");
    if (!importOpen) setPreferGoogle(false);
    setImportOpen(true);
  };
  const openFormsSettings = async () => {
    if (!scope || !formTargetLabel) return;
    try {
      await flushBackendWrites();
      if (activeStorageKey.current !== storageKey) return;
      setGoogleFormsRosterTarget(scope, formTargetLabel);
      window.location.assign("/settings?section=connections&from=workspace#google-forms");
    } catch { setError("저장 상태를 확인한 뒤 환경설정을 다시 열어 주세요."); }
  };
  const importSurvey = (value: TransportSurvey) => {
    if (!hasRegisteredVehicle || demo) { setImportBlocked(true); return; }
    let next: TransportInput;
    try {
      next = value.source ? mergeGoogleSurvey(input, value) : surveyTransportInput(input, analyzeSurvey(value.data, value.mapping));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설문 응답을 반영하지 못했습니다.");
      return;
    }
    const problems = validateTransportInput(next, { draft: true });
    if (problems.length) { setError(problems.join(" ")); return; }
    if (value.source) {
      if (next === input) persist({ ...snapshot, input: next, survey: value });
      else persist({ ...snapshot, input: next, survey: value, approved: false });
    } else {
      persist({ input: next, result: null, baseline: null, approved: false, demo: false, survey: value, comparison: snapshot.comparison });
      setExportFilter("all");
    }
    setImportOpen(false);
    setTab("people");
    onOpenTransport?.();
    setError("");
  };
  const calculate = async () => {
    const problems = validateTransportInput(input);
    if (problems.length) { setError(problems.join(" ")); return; }
    setBusy(true); setError("");
    const nextInput: TransportInput = { ...input, previousAssignments: replanAll ? [] : (result?.assignments ?? []).filter((a) => input.people.some((p) => p.id === a.personId && input.trips.some((t) => t.id === a.tripId && tripFor(p, t.direction) === t.id)) && (a.vehicleId === null || input.vehicles.some((v) => v.id === a.vehicleId))) };
    const solverInput = { ...nextInput, people: nextInput.people.map(({ movement, lodging, roomAssignment, notes, ...person }) => person) };
    controller.current = new AbortController();
    try {
      const response = await fetch("/api/transport", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...solverInput, roomId, conversationId: scope?.conversationId, accountId: scope?.accountId }), signal: controller.current.signal });
      const data = await response.json();
      if (controller.current?.signal.aborted || activeStorageKey.current !== storageKey) return;
      if (!response.ok) throw new Error(data.error || "계산에 실패했습니다.");
      if (!isTransportResult(data) || data.revision !== nextInput.revision) throw new Error("계산 결과 형식이 올바르지 않습니다.");
      validateTransportResult(nextInput, data);
      persist({ ...snapshot, input: nextInput, result: data, approved: false }); setTab("board");
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "계산에 실패했습니다.");
    } finally { setBusy(false); }
  };
  const toggleLock = (a: TransportAssignment) => {
    if (!result || stale) return;
    const locked = input.locks.some((x) => x.personId === a.personId && x.tripId === a.tripId);
    const locks = locked ? input.locks.filter((x) => x.personId !== a.personId || x.tripId !== a.tripId) : [...input.locks, a];
    persist({ ...snapshot, input: { ...input, revision: input.revision + 1, locks }, result: { ...result, revision: input.revision + 1, status: "manual", message: "담당자 잠금 변경" }, approved: false });
  };
  const releaseLock = (a: TransportAssignment) => persist({ ...snapshot, input: { ...input, revision: input.revision + 1, locks: input.locks.filter((x) => x.personId !== a.personId || x.tripId !== a.tripId) }, approved: false });
  let candidate: { input: TransportInput; result: TransportResult } | null = null;
  let moveErrors: string[] = [];
  if (pending && typeof pending === "object" && result) {
    try {
      candidate = moveTransportAssignment(input, result, pending);
      moveErrors = validateTransportResult(candidate.input, candidate.result).filter((e) => e !== "미배정 인원이 있습니다." && e !== "가상 추가 인원의 좌석이 부족하거나 중복됩니다.");
    } catch (cause) { moveErrors = [cause instanceof Error ? cause.message : "변경할 수 없습니다."]; }
  }
  const splitGroups = result ? input.trips.flatMap((t) => [...new Set(input.people.filter((p) => tripFor(p, t.direction) === t.id).map((p) => p.department))].flatMap((department) => {
    const ids = new Set(input.people.filter((p) => p.department === department).map((p) => p.id));
    const count = new Set(result.assignments.filter((a) => a.tripId === t.id && ids.has(a.personId) && a.vehicleId).map((a) => a.vehicleId)).size;
    return count > 1 ? [`${t.label} · ${department}: ${count}대 분산`] : [];
  })) : [];
  const changedRows = result && baseline ? result.assignments.filter((a) => baseline.assignments.find((b) => b.personId === a.personId && b.tripId === a.tripId)?.vehicleId !== a.vehicleId).length : 0;
  const downloadCsv = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const download = async () => {
    try {
      if (!result) return;
      if (isBackendConnected()) await flushBackendWrites();
      const content = exportFilter === "reserve" ? transportReservationCsv(input, result, approved) : transportCsv(input, result, direction, approved, exportFilter);
      downloadCsv(`차량배정-${exportFilter}-${direction === "outbound" ? "출발" : "귀가"}-v${input.revision}.csv`, content);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "파일을 만들지 못했습니다."); }
  };
  return <section className="transport-panel" aria-label={lodgingView ? "숙소 배정" : "차량 배정"} data-view={lodgingView ? "lodging" : showingSurvey ? "survey" : tab}>
    <header className="transport-heading"><div><h3>배정 설정</h3>{(demo || !scope) && <span>{demo ? "가상 예시" : ""}{!scope ? `${demo ? " · " : ""}현재 탭 저장` : ""}</span>}</div><div>{surveyView === undefined && !formTargetLabel && <button type="button" className="transport-primary" disabled={busy} onClick={openImport}><FileUp size={16} />폼 불러오기</button>}
      {demo ? <button type="button" disabled={busy} onClick={() => setPending("start")}>실제 배정 시작</button> : !input.people.length && !input.vehicles.length && <button type="button" disabled={busy} onClick={() => setPending("reset")}>가상 예시 불러오기</button>}
      <button type="button" title="이전 변경 되돌리기" aria-label="이전 변경 되돌리기" disabled={!undo.length || busy} onClick={undoAllocation}><Undo2 size={16} /></button></div></header>
    {importBlocked && <div className="transport-alert" role="alert">{demo ? "가상 예시에는 실제 설문을 가져올 수 없습니다." : "폼을 불러오기 전에 차량을 먼저 입력해 주세요."}<button type="button" onClick={() => { setImportBlocked(false); if (demo) setPending("start"); else setTab("vehicles"); }}>{demo ? "실제 배정으로 전환" : "차량 입력"}</button></div>}
    {saveError && <div className="transport-alert" role="alert">{saveError}<button type="button" onClick={() => persist(snapshot, false)}>다시 저장</button></div>}
    {error && <div className="transport-alert" role="alert">{error}</div>}
    <fieldset className="transport-controls" disabled={busy}><label>예상 추가 인원<input aria-label="추가 인원" type="number" min={0} max={50} value={input.extraCount} onChange={(e) => {
      const count = Number(e.target.value);
      if (Number.isInteger(count) && count >= 0 && count <= 50 && count !== input.extraCount) change({ ...input, extraCount: count });
    }} /></label>
      {input.extraCount > 0 && (["outbound", "return"] as const).map(direction => {
        const key = direction === "outbound" ? "extraOutboundTripId" : "extraReturnTripId";
        return <label key={direction}>{direction === "outbound" ? "추가 좌석 · 출발 팀" : "추가 좌석 · 귀가편"}<select value={input[key]} onChange={e => change({ ...input, [key]: e.target.value })}>
          {input.trips.filter(t => t.direction === direction).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select></label>;
      })}
      <details className="transport-calculate-options"><summary>계산 기준</summary><div>
        <label>배정 기준<select aria-label="배정 우선순위" value={input.objective} onChange={(e) => change({ ...input, objective: e.target.value as TransportInput["objective"] })}><option value="institution">같은 소속끼리 우선</option><option value="cost">대여 비용을 줄이는 쪽 우선</option></select></label>
        <label>기존 배정 처리<select aria-label="재배정 범위" value={replanAll ? "all" : "changes"} onChange={(e) => setReplanAll(e.target.value === "all")}><option value="changes">기존 배정 최대한 유지</option><option value="all">잠금만 유지하고 다시 배정</option></select></label>
      </div></details>
      <button type="button" className="transport-primary" disabled={!input.people.length || !hasCalculableVehicle || pauseAssignment} onClick={calculate}>{busy ? <LoaderCircle size={16} className="transport-spinning" /> : <Play size={16} />}{busy ? "계산 중" : "배정 계산"}</button></fieldset>
    <div className="transport-summary"><div><span>{demo ? "가상 참가" : "참가자"}</span><strong>{input.people.length}명</strong></div><div><span>예상 추가</span><strong>{input.extraCount}명</strong></div><div><span>대여 견적 합계</span><strong>{result && !stale && !["unknown", "infeasible"].includes(result.status) ? quoteLabel(recordedTransportQuote(input, result)) : "—"}</strong></div><div><span>미배정 / 추가 좌석 부족</span><strong>{result && !stale ? `${result.unassignedCount}건 / ${result.unreservedCount}석` : "—"}</strong></div><div><span>상태 · v{input.revision}</span><strong className={stale || errors.length ? "transport-warning" : ""}>{stale ? "재계산 필요" : approved ? "담당자 확정" : result ? errors.length ? "승인 전 확인" : "검토 대기" : "계산 전"}</strong></div></div>
    {result && <div className={`transport-result-state ${errors.length ? "has-errors" : ""}`}>
      {stale ? <strong>입력이 변경되었습니다. 다시 계산해 주세요.</strong> : approved ? <strong>담당자가 배정안을 확정했습니다.</strong> : !errors.length ? <strong>검토 가능 · 명단을 확인하고 배정안 승인</strong> : <strong>승인 전 확인 · {shortage.length ? `예상 추가 좌석 부족: ${shortage.join(" / ")}` : errors[0]}</strong>}
      {shortage.length > 0 && <span>차량의 배정 가능 좌석이나 예상 추가 인원을 확인한 뒤 다시 계산해 주세요.</span>}
      {errors.length > 0 && <details><summary>검증 결과 {errors.length}건</summary><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></details>}
    </div>}
    {inputErrors.length > 0 && <div className="transport-alert" role="alert">{inputErrors.join(" ")}</div>}
    {input.locks.length > 0 && <details className="transport-locks" open><summary>담당자 잠금 {input.locks.length}건</summary><ul>{input.locks.map((a) => <li key={`${a.personId}-${a.tripId}`}><span>{input.people.find((p) => p.id === a.personId)?.name ?? a.personId} · {input.trips.find((t) => t.id === a.tripId)?.label ?? a.tripId} · {input.vehicles.find((v) => v.id === a.vehicleId)?.label ?? "미배정"}</span><button type="button" disabled={busy} aria-label={`${a.personId} ${a.tripId} 잠금 해제`} onClick={() => releaseLock(a)}>잠금 해제</button></li>)}</ul></details>}
    {!surveyView && !lodgingView && <div className="transport-tabbar"><div className="transport-tabs" role="tablist" aria-label="차량 배정 보기" onKeyDown={navigateTabs}>{tabs.map((item) => <button type="button" role="tab" key={item.id} id={`${tabPrefix}-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} aria-controls={`${tabPrefix}-panel`} onClick={() => selectTab(item.id)}>{item.label}</button>)}</div>
      {tab === "people" && !showingSurvey && <div className="transport-roster-actions">
        {!demo && input.people.length > 0 && <button type="button" disabled={busy || input.people.some(person => person.name === transportUnnamedParticipant) || snapshot.rosterConfirmation === rosterFingerprint(input.people)}
          onClick={() => void persist({ ...snapshot, rosterConfirmation: rosterFingerprint(input.people) }, false)}>{snapshot.rosterConfirmation === rosterFingerprint(input.people) ? "명단 확정됨" : "명단 확정"}</button>}
        {input.people.some(p => p.name === transportUnnamedParticipant) && <button type="button" disabled={busy} onClick={() => {
          const empty = input.people.filter(p => p.name === transportUnnamedParticipant);
          if (!empty.length || !window.confirm(`이름을 입력하지 않은 행 ${empty.length}개를 삭제할까요?`)) return;
          change({ ...input, people: input.people.filter(p => p.name !== transportUnnamedParticipant) });
          setNewParticipantId(undefined);
        }}>빈 행 지우기</button>}
        {formTargetLabel && scope && isBackendConnected() && <button type="button" disabled={busy} onClick={() => void openFormsSettings()}>환경설정에서 설문 가져오기</button>}
        {formTargetLabel && <button type="button" disabled={busy} onClick={openImport}><FileUp size={15} />CSV 가져오기</button>}
        <button type="button" className="transport-primary" disabled={busy || input.people.length >= 250} onClick={addParticipant}><Plus size={16} />참가자 추가</button>
      </div>}
    </div>}
    <div className="transport-body" ref={surface} id={surveyView || lodgingView ? undefined : `${tabPrefix}-panel`} role={surveyView || lodgingView ? undefined : "tabpanel"} aria-labelledby={surveyView || lodgingView ? undefined : `${tabPrefix}-${tab}`}><fieldset disabled={busy}>
      {lodgingView ? <TransportLodging people={input.people} demo={demo} saved={snapshot.lodgingPlan} onPeople={() => { selectTab("people"); onOpenTransport?.(); }} onChange={lodgingPlan => {
        const numbers = new Map(lodgingPlan.rooms.flatMap(room => room.people.map(id => [id, room.number] as const)));
        void persist({ ...snapshot, lodgingPlan, input: { ...input, people: input.people.map(p => ({ ...p, roomAssignment: numbers.get(p.id) || undefined })) } }, false);
      }} /> : <>
      {(importOpen || surveyView) && <div hidden={!showingSurvey}><TransportSurveyForm key={storageKey} scope={scope} people={input.people} previous={survey} hasPeople={input.people.length > 0}
        csvOnly={!!formTargetLabel} initialMode={preferGoogle || surveyView ? "google" : undefined} onRegisterVehicle={!hasRegisteredVehicle || demo ? () => {
          onOpenTransport?.();
          if (demo) setPending("start"); else setTab("vehicles");
        } : undefined} onCancel={surveyView === undefined ? () => setImportOpen(false) : undefined} onImport={importSurvey} /></div>}
      {tab === "people" && !showingSurvey && survey && <details className="transport-survey"><summary>가져온 설문 응답 · {survey.data.rows.length}건</summary><SurveyPreview survey={survey} /></details>}
      {!showingSurvey && (tab === "compare" ? <TransportComparisonPanel key={storageKey}
        comparison={snapshot.comparison ?? {}} scope={scope} canCapture={!!result && !stale && !busy} capturing={capturing}
        onCapture={captureComparison} onRemove={(slot) => { const next = { ...snapshot.comparison }; delete next[slot]; setComparison(next); }}
        onAssembly={(slot, count) => {
          const plan = snapshot.comparison?.[slot];
          if (plan) setComparison({ ...snapshot.comparison, [slot]: { ...plan, assemblyPoints: count } });
        }} />
        : tab === "board" ? <TransportBoard input={input} result={result} stale={stale} direction={direction} onDirection={setDirection} onMove={setPending} onLock={toggleLock} /> : <TransportConfig key={tab} input={input} tab={tab} onChange={change} newParticipantId={newParticipantId} onRosterExport={() => downloadCsv(`참가자명단-v${input.revision}.csv`, transportRosterCsv(input))}
        selectedVehicleIds={selectedVehicleIds} onVehicleSelect={(id, selected) => setVehicleSelection((ids) => selected ? [...ids, id] : ids.filter((value) => value !== id))}
        onVehicleDelete={() => setVehicleDeleteOpen(true)} />)}
    </>}</fieldset></div>
    <footer className="transport-footer"><span>{input.locks.length}건 잠금 · 소속 분산은 담당자 확인</span><select aria-label="CSV 구분" value={exportFilter} onChange={(e) => setExportFilter(e.target.value)}><option value="all">전체 실제 명단</option><option value="independent">개별 이동 명단</option><option value="reserve">가상 좌석 확보표</option>{input.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select><button type="button" className="transport-primary" title={stale ? "입력 변경 후 다시 계산해 주세요." : errors.length ? "승인 전 확인 항목을 먼저 해결해 주세요." : !result ? "먼저 배정 계산을 실행해 주세요." : undefined} disabled={!result || busy || stale || errors.length > 0 || approved || pauseAssignment} onClick={() => setPending("approve")}><Check size={16} />배정안 승인</button><button type="button" disabled={!approved || !result || errors.length > 0 || busy || pauseAssignment} onClick={download}><Download size={16} />확정 CSV 다운로드</button></footer>
    {chatRoster && scope && onCloseChatRoster && <ChatRosterDialog scope={scope} source={chatRoster} input={input} onClose={onCloseChatRoster} onApply={async next => {
      if (busy || latestSnapshot.current !== snapshot) throw new Error("배정이 변경되었습니다. 현재 명단을 다시 확인해 주세요.");
      if (demo) throw new Error("가상 예시를 종료하고 실제 배정으로 전환한 뒤 추가해 주세요.");
      if (!await persist({ ...snapshot, input: next, approved: false })) throw new Error("서버에 저장하지 못했습니다. 배정 화면에서 다시 저장해 주세요.");
      setTab("people"); setImportOpen(false); setError(""); onCloseChatRoster(true);
    }} />}
    {vehicleDeleteOpen && <TransportConfirmation title="선택 차량 삭제" onClose={() => setVehicleDeleteOpen(false)}>
      <p>차량 {selectedVehicles.length}대를 삭제할까요?</p>
      <ul className="transport-approval-splits">{selectedVehicles.map((v) => <li key={v.id}>{v.label}</li>)}</ul>
      {!!lockedVehicles.length && <p className="transport-alert">{lockedVehicles.map((v) => v.label).join(", ")}: 담당자 잠금을 먼저 해제해 주세요.</p>}
      <button type="button" className="transport-vehicle-delete" disabled={!selectedVehicles.length || !!lockedVehicles.length} onClick={deleteVehicles}>삭제 확정</button>
    </TransportConfirmation>}
    {pending && <TransportConfirmation title={pending === "reset" ? "가상 예시 불러오기" : pending === "start" ? "실제 배정 시작" : pending === "approve" ? "배정안 승인" : "배정 변경 검토"} onClose={() => setPending(null)}>
      {pending === "reset" || pending === "start" ? <><p>{pending === "reset" ? "가상 참가자 150명과 차량, 추가 좌석 3명분을 불러옵니다." : "가상 명단과 차량을 비우고 실제 배정을 시작합니다."}</p><button type="button" className="transport-primary" onClick={() => { persist(seed(pending === "reset", input.revision + 1)); setTab(pending === "reset" ? "teams" : "vehicles"); setPending(null); setImportBlocked(false); setError(""); }}>{pending === "reset" ? "예시 불러오기" : "실제 배정으로 전환"}</button></> : pending === "approve" ? <><dl>
        <dt>참가 / 가상</dt><dd>{input.people.length}명 / {input.extraCount}명</dd>
        <dt>대여 견적</dt><dd>{quoteLabel(result ? recordedTransportQuote(input, result) : null)}</dd>
        <dt>기존 확정 대비 변경</dt><dd>{changedRows}건</dd>
      </dl><ul className="transport-approval-splits">{splitGroups.map((s) => <li key={s}>{s}</li>)}</ul><button type="button" className="transport-primary" onClick={() => { if (result && validateTransportResult(input, result).length === 0) { persist({ ...snapshot, baseline: result, approved: true }); setPending(null); } }}>배정안 확정</button></> : <><p><strong>{input.people.find((p) => p.id === pending.personId)?.name}</strong></p><p>{input.trips.find((t) => t.id === pending.tripId)?.label} → {input.vehicles.find((v) => v.id === pending.vehicleId)?.label ?? "미배정"}</p><p>승인한 변경은 잠금으로 유지됩니다. 전체 명단은 별도 확정 전까지 초안입니다.</p>{moveErrors.length > 0 && <ul className="transport-alert">{moveErrors.map((e) => <li key={e}>{e}</li>)}</ul>}<button type="button" className="transport-primary" disabled={!candidate || moveErrors.length > 0} onClick={() => { if (candidate) { persist({ ...snapshot, ...candidate, approved: false }); setPending(null); } }}>변경 승인</button></>}
    </TransportConfirmation>}
  </section>;
}

function TransportConfirmation({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { const before = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>("button")?.focus(); return () => before?.focus(); }, []);
  return <div className="transport-dialog-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="transport-dialog" onKeyDown={(e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") { const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); e.preventDefault(); buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
  }}><header><h3>{title}</h3><button type="button" aria-label="검토 창 닫기" title="닫기" onClick={onClose}><X size={18} /></button></header>{children}</section></div>;
}
