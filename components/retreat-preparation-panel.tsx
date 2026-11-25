"use client";

import { MessageSquareText, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { backendFetch } from "@/lib/backend-client";
import { scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { retreatReviewAccountHeader, type RetreatFieldStatus, type RetreatReason, type RetreatReview } from "@/lib/retreat-preparation";
import { Badge, Button } from "./ui";

const statuses: Record<RetreatFieldStatus, { label: string; tone: "green" | "amber" | "blue" | "neutral" }> = {
  confirmed: { label: "확정", tone: "green" }, needs_review: { label: "확인 필요", tone: "amber" },
  deferred: { label: "보류", tone: "blue" }, not_applicable: { label: "해당 없음", tone: "neutral" },
};
const reasons: Record<RetreatReason, string> = {
  confirmed: "확정 기록 있음",
  missing: "저장된 근거 없음",
  unverified: "저장된 항목은 있으나 확정 근거 부족",
  invalid_date: "기준 연도 또는 날짜 확인 필요",
  conflicting_records: "확정 기록이 서로 다름",
  administrative_hold: "담당자가 보류함",
  required_field: "필수 항목의 확정 근거 없음",
  no_water_activity: "물놀이 미진행 확정",
  water_plan_unconfirmed: "물놀이 계획 미확정",
  meeting_unknown: "회의 가능 여부 미정",
  meeting_unavailable: "현재 회의 어려움",
};
const valueLabel = (value: string | boolean | undefined) => typeof value === "boolean" ? value ? "진행" : "미진행" : value;
const evidenceLabels = { room: "행사방 기간", calendar: "공동 캘린더", location: "이 대화의 대표 장소", transport: "이 대화의 차량 배정", checklist: "이 대화의 체크리스트" };

export function RetreatPreparationPanel({ scope, onSummarize, summaryDisabled }: { scope: ConversationScope; onSummarize?: () => void; summaryDisabled?: boolean }) {
  return <Review key={scopeId(scope)} {...scope} onSummarize={onSummarize} summaryDisabled={summaryDisabled} />;
}

function Review({ accountId, roomId, conversationId, onSummarize, summaryDisabled }: ConversationScope & { onSummarize?: () => void; summaryDisabled?: boolean }) {
  const [refresh, setRefresh] = useState(0);
  const [load, setLoad] = useState<{ report: RetreatReview } | { error: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ roomId, conversationId });
    void backendFetch(`/api/retreat-preparation?${query}`, {
      signal: controller.signal, headers: { [retreatReviewAccountHeader]: accountId },
    }).then((report: RetreatReview) => {
      if (controller.signal.aborted) return;
      if (report?.roomId !== roomId || report.conversationId !== conversationId || !Number.isInteger(report.year) ||
          !Array.isArray(report.fields) || !Array.isArray(report.next) || !Array.isArray(report.deferred)) {
        throw new Error("점검 결과를 현재 대화와 연결하지 못했습니다.");
      }
      setLoad({ report });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setLoad({ error: cause instanceof Error ? cause.message : "준비 점검을 불러오지 못했습니다." });
    });
    return () => controller.abort();
  }, [accountId, roomId, conversationId, refresh]);

  const report = load && "report" in load ? load.report : null;
  const labels = new Map(report?.fields.map(field => [field.key, field.label]));
  return <div className="retreat-review" aria-busy={!load}>
    <div className="retreat-review-controls">
      {report && <div className="min-w-0 flex-1"><p className="font-semibold">확정 {report.fields.filter(field => field.status === "confirmed").length} / {report.fields.length}</p><p className="retreat-review-muted">{report.year}년 · 저장된 기록 기준</p></div>}
      <Button type="button" variant="outline" aria-label="다시 점검" title="다시 점검" disabled={!load}
        className="w-9 shrink-0 px-0" onClick={() => { setLoad(null); setRefresh(value => value + 1); }}><RotateCw size={16} aria-hidden="true" /></Button>
    </div>
    {!load && <p className="retreat-review-muted" role="status">저장된 준비 자료를 확인하는 중...</p>}
    {load && "error" in load && <p className="text-sm text-danger" role="alert">{load.error}</p>}
    {report && <div className="retreat-review-report">
      <section aria-label="준비 상태">
        <h3>준비 상태</h3>
        <ul className="retreat-review-rows">{report.fields.map(field => {
          const status = statuses[field.status];
          const checked = field.status === "confirmed" && field.value === "체크리스트 완료";
          const transportMissing = field.key === "transport" && field.status !== "confirmed";
          return <li key={field.key}>
            <div className="retreat-review-field"><span>{field.label}</span><Badge tone={transportMissing ? "red" : status.tone}>{transportMissing ? "미정" : checked ? "체크리스트 완료" : status.label}</Badge></div>
            {!checked && field.value !== undefined && <p>{valueLabel(field.value)}</p>}
            {field.status !== "confirmed" && <p className="retreat-review-muted">{reasons[field.reason]}</p>}
            {field.evidence && <p className="retreat-review-muted">{evidenceLabels[field.evidence]}</p>}
          </li>;
        })}</ul>
      </section>
      <section aria-label="지금 할 일">
        <h3>지금 할 일</h3>
        {report.next.length ? <ol className="retreat-review-next">{report.next.map(task => <li key={task.id}>{task.label}</li>)}</ol>
          : <p className="retreat-review-muted">지금 제안할 수 있는 일이 없습니다.</p>}
      </section>
      <section aria-label="참고 자료">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3>참고 자료</h3>{onSummarize && <Button type="button" variant="outline" onClick={onSummarize} disabled={summaryDisabled}
            title={summaryDisabled ? "채팅 입력 또는 답변을 마친 뒤 요약할 수 있습니다." : "준비 점검을 이 대화에 추가"}><MessageSquareText size={15} aria-hidden="true" />채팅으로 요약</Button>}
        </div>
        {report.references?.length ? <ul className="retreat-review-rows">{report.references.map(ref => <li key={`${ref.taskId}:${ref.documentId}`}>
          <div className="retreat-review-field"><strong className="break-all">{ref.sourceTitle}</strong><Badge>참고 기록</Badge></div>
          <p>{ref.excerpt}</p>
        </li>)}</ul> : <p className="retreat-review-muted">현재 추천에 해당하는 고정 참고 자료가 없습니다.</p>}
      </section>
      {report.deferred.length > 0 && <section aria-label="보류된 일">
        <h3>보류된 일</h3>
        <ul className="retreat-review-rows">{report.deferred.map(task => <li key={task.id}>
          <p className="font-medium">{task.label}</p>
          {task.blockedBy.map(({ key, reason }) => <p key={key} className="retreat-review-muted">
            {(key === "meeting" ? "회의" : labels.get(key) ?? key) + ": " + reasons[reason]}
          </p>)}
        </li>)}</ul>
      </section>}
    </div>}
  </div>;
}
