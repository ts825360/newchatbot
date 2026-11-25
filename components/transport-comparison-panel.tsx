"use client";

import { ArrowDownWideNarrow, Columns2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushBackendWrites } from "@/lib/backend-client";
import type { ConversationScope } from "@/lib/conversation-scope";
import { comparisonSlots, comparisonTitle, createTransportComparisonFacts, lowestQuotedPlan, quoteLabel, type ComparisonSlot, type TransportComparison, type TransportPlan } from "@/lib/transport-comparison";

const stateLabel = { ready: "배정 가능", blocked: "배정 불가", review: "확인 필요" } as const;

function LegDetails({ leg, extra }: { leg: TransportPlan["outbound"]; extra: number }) {
  return <>{leg.demand}명 대상 · {leg.missing === null ? "미배정 확인 불가" : `미배정 ${leg.missing}명`}
    {extra > 0 && ` · 가상 부족 ${leg.extraMissing === null ? "확인 불가" : `${leg.extraMissing}석`}`}</>;
}

export function TransportComparisonPanel({ comparison, canCapture, capturing, scope, onCapture, onRemove, onAssembly }: {
  comparison: TransportComparison; canCapture: boolean; capturing: ComparisonSlot | null; scope?: ConversationScope;
  onCapture: (slot: ComparisonSlot) => void; onRemove: (slot: ComparisonSlot) => void; onAssembly: (slot: ComparisonSlot, count: number | null) => void;
}) {
  const [mode, setMode] = useState<"operations" | "cost">("operations");
  const [explanation, setExplanation] = useState<{ key: string; text: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const { a, b } = comparison;
  const expected = a && b ? JSON.stringify(createTransportComparisonFacts({ a, b })) : null;
  const key = JSON.stringify(comparison);
  useEffect(() => () => request.current?.abort(), [key]);
  const best = lowestQuotedPlan(comparison);
  let costStatus = "비교안 두 개가 필요합니다.";
  if (a && b) {
    if (a.demand !== b.demand) costStatus = "명단·이동 조건이 달라 비용 순위를 매기지 않았습니다.";
    else if (a.state !== "ready" || b.state !== "ready") costStatus = "배정 상태를 먼저 확인해 주세요.";
    else if (a.quote === null || b.quote === null) costStatus = "견적 미확인으로 비용 순위를 매기지 않았습니다.";
    else costStatus = best ? `확인된 견적이 낮은 안: ${comparisonTitle(best)}` : "두 안의 확인된 대여 견적이 같습니다.";
  }

  async function explain() {
    if (!scope || !expected || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setExplanation(null);
    setLoading(true);
    try {
      await flushBackendWrites();
      if (controller.signal.aborted) return;
      const response = await fetch("/api/transport/compare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, expected }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || typeof data?.text !== "string" || data.text.length > 800) throw new Error("Explanation unavailable");
      if (!controller.signal.aborted) setExplanation({ key, text: data.text });
    } catch {
      if (!controller.signal.aborted) setExplanation({ key, text: "차이 설명을 일시적으로 사용할 수 없습니다.", error: true });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  const order = mode === "cost" && best === "b" ? ["b", "a"] as const : comparisonSlots;
  return <section className="transport-compare" aria-label="배정안 비교">
    <header className="transport-compare-header">
      <h3>배정안 비교</h3>
      <div className="transport-compare-actions">
        <div className="transport-segment" role="group" aria-label="비교 기준">
          <button type="button" aria-pressed={mode === "operations"} onClick={() => setMode("operations")}><Columns2 size={14} />운영 편의</button>
          <button type="button" aria-pressed={mode === "cost"} onClick={() => setMode("cost")}><ArrowDownWideNarrow size={14} />비용 우선</button>
        </div>
        {scope && <button type="button" disabled={!expected || loading} onClick={explain}><Sparkles size={14} />{loading ? "설명 확인 중" : "차이 설명"}</button>}
      </div>
    </header>
    {(mode === "cost" || a && b && a.demand !== b.demand) && <p className="transport-compare-status" role="status">{costStatus}</p>}
    {explanation?.key === key && <p className="transport-compare-status" role={explanation.error ? "alert" : "status"}>{explanation.text}</p>}
    <div className="transport-compare-grid">
      {order.map(slot => {
        const plan = comparison[slot];
        const title = comparisonTitle(slot);
        return <article className="transport-compare-plan" key={slot} aria-label={title}>
          <header><h4>{title}</h4>{plan && <span className={plan.state !== "ready" ? "transport-warning" : ""}>{stateLabel[plan.state]} · v{plan.revision}</span>}</header>
          {plan ? <><dl>
            <dt>출발 배정</dt><dd><LegDetails leg={plan.outbound} extra={plan.extra} /></dd>
            <dt>귀가 배정</dt><dd><LegDetails leg={plan.return} extra={plan.extra} /></dd>
            <dt>대여 견적</dt><dd>{plan.state === "ready" ? quoteLabel(plan.quote) : "비교 제외"}</dd>
            <dt>사용 차량</dt><dd>{plan.vehicleLabels.length ? `${plan.vehicleLabels.length}대 · ${plan.vehicleLabels.slice(0, 4).join(", ")}${plan.vehicleLabels.length > 4 ? " 외" : ""}` : "—"}</dd>
          </dl><label>출발 집합 지점 수<input type="number" min={1} max={80} step={1} inputMode="numeric" placeholder="미확인"
            aria-label={`${title} 집합 지점 수`} value={plan.assemblyPoints ?? ""} onChange={event => {
              const count = event.target.valueAsNumber;
              if (!event.target.value && !event.target.validity.badInput) onAssembly(slot, null);
              else if (Number.isInteger(count) && count >= 1 && count <= 80) onAssembly(slot, count);
            }} /></label></> : <p className="transport-compare-empty">저장된 비교안 없음</p>}
          <footer>
            <button type="button" disabled={!canCapture || !!capturing} onClick={() => onCapture(slot)}>
              {capturing === slot ? "담는 중" : plan ? `${title} 교체` : `${title}에 담기`}
            </button>
            {plan && <button type="button" title={`${title} 제거`} aria-label={`${title} 제거`} onClick={() => onRemove(slot)}><Trash2 size={15} /></button>}
          </footer>
        </article>;
      })}
    </div>
  </section>;
}
