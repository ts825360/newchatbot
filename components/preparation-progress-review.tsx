"use client";

import { ScanSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { backendFetch, flushBackendWrites, hasPendingBackendWrites, subscribeBackend } from "@/lib/backend-client";
import { privateToolKey, scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { preparationProgressConsent, type PreparationProgress, type SavedPreparationProgress } from "@/lib/preparation-progress";
import { retreatReviewAccountHeader } from "@/lib/retreat-preparation";
import { RoomDialog } from "./room-dialog";

type ReviewState = SavedPreparationProgress & { loading: boolean; saving: boolean; error: string };
const notReviewed: ReviewState = { report: null, stale: false, loading: false, saving: false, error: "" };

export function usePreparationProgressReview(scope: ConversationScope | null) {
  const identity = scope ? scopeId(scope) : null;
  const [result, setResult] = useState<(ReviewState & { identity: string }) | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const reviewController = useRef<AbortController | null>(null);
  const refresh = useRef<(() => void) | null>(null);
  const revision = useRef(0);
  const state = result && result.identity === identity ? result : notReviewed;

  useEffect(() => {
    if (!scope || !identity) return;
    const { accountId, roomId, conversationId } = scope;
    const keys = new Set([
      privateToolKey(scope, "checklist"), privateToolKey(scope, "risks"), privateToolKey(scope, "decisions"),
      privateToolKey(scope, "location"), privateToolKey(scope, "transport"), `church-preparation-v1:${encodeURIComponent(roomId)}:events`,
      `church-planner-room-catalog-v1:${accountId}`,
    ]);
    const query = new URLSearchParams({ roomId, conversationId });
    const headers = { [retreatReviewAccountHeader]: accountId };
    let reader: AbortController | null = null;
    let pendingWrites = hasPendingBackendWrites(keys);
    const load = () => {
      const version = ++revision.current;
      reader?.abort();
      pendingWrites = hasPendingBackendWrites(keys);
      setResult({ ...notReviewed, identity, loading: !pendingWrites, saving: pendingWrites });
      if (pendingWrites || reviewController.current) return;
      const controller = new AbortController();
      reader = controller;
      void backendFetch(`/api/preparation-progress?${query}`, { headers, signal: controller.signal }).then((saved: SavedPreparationProgress) => {
        if (!controller.signal.aborted && revision.current === version) setResult({ ...notReviewed, identity, ...saved });
      }, (cause: unknown) => {
        if (!controller.signal.aborted && revision.current === version) setResult({ ...notReviewed, identity, error: cause instanceof Error ? cause.message : "준비 진행도를 불러오지 못했습니다." });
      });
    };
    refresh.current = load;
    const invalidate = (event: StorageEvent) => {
      if (!event.key || keys.has(event.key)) load();
    };
    const unsubscribe = subscribeBackend(() => {
      if (hasPendingBackendWrites(keys) !== pendingWrites) load();
    });
    window.addEventListener("storage", invalidate);
    load();
    return () => {
      reader?.abort();
      reviewController.current?.abort();
      reviewController.current = null;
      refresh.current = null;
      setResult(null);
      setReviewing(null);
      unsubscribe();
      window.removeEventListener("storage", invalidate);
    };
  }, [scope, identity]);

  const review = async () => {
    if (!scope || !identity || reviewController.current) return;
    const { accountId, roomId, conversationId } = scope;
    const controller = new AbortController();
    reviewController.current = controller;
    setReviewing(identity);
    refresh.current?.();
    let version = revision.current;
    try {
      await flushBackendWrites();
      if (controller.signal.aborted) return;
      version = revision.current;
      const report: PreparationProgress = await backendFetch("/api/preparation-progress", {
        method: "POST", headers: { "Content-Type": "application/json", [retreatReviewAccountHeader]: accountId },
        body: JSON.stringify({ roomId, conversationId, consent: preparationProgressConsent }), signal: controller.signal,
      });
      if (!controller.signal.aborted && revision.current === version) setResult({ ...notReviewed, identity, report });
    } catch (cause) {
      if (!controller.signal.aborted && revision.current === version) setResult({ ...notReviewed, identity, error: cause instanceof Error ? cause.message : "준비 상태를 판단하지 못했습니다." });
    } finally {
      if (reviewController.current === controller) {
        reviewController.current = null;
        setReviewing(null);
        if (revision.current !== version) refresh.current?.();
      }
    }
  };
  return { ...state, busy: !!identity && reviewing === identity, review };
}

export function PreparationProgressShortcut({ busy, loading, saving, report, stale, error, onOpen }: ReviewState & { busy: boolean; onOpen: () => void }) {
  const detail = busy ? "점검 중" : loading || saving ? "확인 중" : error ? "확인 실패" : report ? `${report.percent ?? 0}%` : stale ? "재점검 필요" : "미검토";
  return <button type="button" className="workspace-chat-progress" aria-controls="workspace-tools" title={`준비 진행도: ${detail}`} onClick={onOpen}>
    <ScanSearch size={16} aria-hidden="true" />행사 요약
  </button>;
}

export function PreparationProgressReview({ busy, loading, saving, report, stale, error, review }: ReturnType<typeof usePreparationProgressReview>) {
  const [confirm, setConfirm] = useState(false);
  const unchecked = !report && !stale && !error && !busy && !loading && !saving;
  const percent = report || unchecked ? report?.percent ?? 0 : null;
  const basis = unchecked ? "아직 점검하지 않았어요." : report?.percent == null ? null
    : report.state === "ready" ? "저장된 기록 및 모델 검토 완료" : "체크리스트 완료 비율 · 최종 검토 제외";
  return <section id="workspace-progress-review" className="workspace-progress-review" tabIndex={-1} aria-label="준비 진행도 검토">
    <header><h3><ScanSearch size={18} aria-hidden="true" />준비 진행도</h3>{percent !== null && <strong className="overview-progress-number">{percent}%</strong>}</header>
    {error && <p role="alert" className="overview-empty">{error}</p>}
    {percent !== null ? <div className="overview-progress" aria-live="polite">
      <progress value={percent} max={100} aria-label="준비 진행도" aria-describedby={basis ? "workspace-progress-basis" : undefined}
        aria-valuetext={report?.percent === null ? "0%, 산정된 점수 없음" : undefined} />
      {basis && <p id="workspace-progress-basis" className="overview-progress-basis">{basis}</p>}
    </div> : !error && <p className="overview-empty" role="status">{busy ? "준비 기록을 점검하고 있어요." : saving ? "준비 기록을 저장한 뒤 진행도를 다시 확인합니다." : loading ? "저장된 진행도를 불러오고 있어요." : "준비 기록이 바뀌었어요. 중간점검을 다시 해 주세요."}</p>}
    <div className="overview-review-actions">
      {report && <details><summary>판단 근거</summary><ul className="workspace-progress-notes">{report.notes.map(note => <li key={note}>{note}</li>)}</ul></details>}
      <button type="button" className="overview-link" disabled={busy || loading || saving} onClick={() => setConfirm(true)}>{busy ? "점검 중…" : "중간점검"}</button>
    </div>
    {confirm && <RoomDialog title="준비 진행도 중간점검" className="workspace-theme" onClose={() => setConfirm(false)}>
      <div className="room-dialog-body"><p className="room-delete-copy">OpenAI에는 완료 항목 수, 확정 일정 수, 최종 검토 여부와 같은 요약 수치만 전송합니다. 이름, 일정 제목, 대화와 첨부파일은 보내지 않습니다.</p></div>
      <footer className="room-dialog-footer"><button type="button" className="lobby-secondary" onClick={() => setConfirm(false)} autoFocus>취소</button><button type="button" className="lobby-primary" onClick={() => { setConfirm(false); void review(); }}>확인하고 점검</button></footer>
    </RoomDialog>}
  </section>;
}
