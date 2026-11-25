"use client";

import { ScanSearch } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { backendFetch, flushBackendWrites } from "@/lib/backend-client";
import { privateToolKey, scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { preparationProgressConsent, type PreparationProgress } from "@/lib/preparation-progress";
import { retreatReviewAccountHeader } from "@/lib/retreat-preparation";
import { RoomDialog } from "./room-dialog";

type ReviewState = { busy: boolean; report: PreparationProgress | null; error: string };
const notReviewed: ReviewState = { busy: false, report: null, error: "" };

export function usePreparationProgressReview(scope: ConversationScope | null) {
  const identity = scope ? scopeId(scope) : null;
  const [result, setResult] = useState<(ReviewState & { identity: string }) | null>(null);
  const fetchController = useRef<AbortController | null>(null);
  const state = result && result.identity === identity ? result : notReviewed;

  useEffect(() => {
    if (!scope) return;
    const { accountId, roomId } = scope;
    const keys = new Set([
      privateToolKey(scope, "checklist"), privateToolKey(scope, "risks"), privateToolKey(scope, "decisions"),
      privateToolKey(scope, "location"), privateToolKey(scope, "transport"), `church-preparation-v1:${encodeURIComponent(roomId)}:events`,
      `church-planner-room-catalog-v1:${accountId}`,
    ]);
    const invalidate = (event: StorageEvent) => {
      if (!event.key || keys.has(event.key)) setResult(previous => previous?.report ? null : previous);
    };
    window.addEventListener("storage", invalidate);
    return () => {
      fetchController.current?.abort();
      fetchController.current = null;
      setResult(null);
      window.removeEventListener("storage", invalidate);
    };
  }, [scope]);

  const review = async () => {
    if (!scope || !identity || fetchController.current) return;
    const { accountId, roomId, conversationId } = scope;
    const controller = new AbortController();
    fetchController.current = controller;
    setResult({ ...notReviewed, identity, busy: true });
    try {
      await flushBackendWrites();
      if (controller.signal.aborted) return;
      const result: PreparationProgress = await backendFetch("/api/preparation-progress", {
        method: "POST", headers: { "Content-Type": "application/json", [retreatReviewAccountHeader]: accountId },
        body: JSON.stringify({ roomId, conversationId, consent: preparationProgressConsent }), signal: controller.signal,
      });
      if (!controller.signal.aborted) setResult({ ...notReviewed, identity, report: result });
    } catch (cause) {
      if (!controller.signal.aborted) setResult({ ...notReviewed, identity, error: cause instanceof Error ? cause.message : "준비 상태를 판단하지 못했습니다." });
    } finally {
      if (fetchController.current === controller) fetchController.current = null;
    }
  };
  return { ...state, review };
}

function reportLabel(report: PreparationProgress) {
  if (report.percent !== null) return `${report.percent}%`;
  return report.state === "remaining" ? "남은 준비 있음" : "판단 보류";
}

export function PreparationProgressShortcut({ busy, report, error, onOpen }: ReviewState & { onOpen: () => void }) {
  return <button type="button" className="workspace-chat-progress" aria-controls="workspace-progress-review" onClick={onOpen}>
    <ScanSearch size={16} aria-hidden="true" /><span>준비 진행도 <strong aria-live="polite">· {busy ? "검토 중" : error ? "검토 실패" : report ? reportLabel(report) : "미검토"}</strong></span>
  </button>;
}

export function PreparationProgressReview({ busy, report, error, review, children }: ReturnType<typeof usePreparationProgressReview> & { children?: ReactNode }) {
  const [confirm, setConfirm] = useState(false);
  return <section id="workspace-progress-review" className="workspace-progress-review" tabIndex={-1} aria-label="준비 진행도 검토">
    <header><h3><ScanSearch size={18} aria-hidden="true" />준비 진행도</h3>{report?.percent != null && <strong className="overview-progress-number">{report.percent}%</strong>}</header>
    {error && <p role="alert" className="overview-empty">{error}</p>}
    {report ? <div aria-live="polite">
      {report.percent !== null ? <div className="overview-progress"><progress value={report.percent} max={100} aria-label="준비 진행도" /></div> : <p className="overview-empty"><strong>{reportLabel(report)}</strong></p>}
    </div> : !error && <p className="overview-empty" role="status">{busy ? "저장된 준비 기록을 확인하고 있어요." : "아직 검토하지 않았어요."}</p>}
    {children}
    <div className="overview-review-actions">
      {report && <details><summary>판단 근거</summary>{report.percent !== null && report.state === "remaining" && <p className="overview-empty">저장된 준비 항목의 완료 비율입니다.</p>}<ul className="workspace-progress-notes">{report.notes.map(note => <li key={note}>{note}</li>)}</ul></details>}
      <button type="button" className="overview-link" disabled={busy} onClick={() => setConfirm(true)}>{busy ? "검토 중…" : report ? "다시 검토" : "모델로 검토"}</button>
    </div>
    {confirm && <RoomDialog title="준비 진행도 검토" className="workspace-theme" onClose={() => setConfirm(false)}>
      <div className="room-dialog-body"><p className="room-delete-copy">OpenAI에는 완료 항목 수, 확정 일정 수, 최종 검토 여부와 같은 요약 수치만 전송합니다. 이름, 일정 제목, 대화와 첨부파일은 보내지 않습니다.</p></div>
      <footer className="room-dialog-footer"><button type="button" className="lobby-secondary" onClick={() => setConfirm(false)} autoFocus>취소</button><button type="button" className="lobby-primary" onClick={() => { setConfirm(false); void review(); }}>확인하고 검토</button></footer>
    </RoomDialog>}
  </section>;
}
