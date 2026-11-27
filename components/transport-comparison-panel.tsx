"use client";

import { ArrowDownWideNarrow, ArrowRight, Columns2, LayoutGrid, Sparkles, Table2, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { flushBackendWrites } from "@/lib/backend-client";
import type { ConversationScope } from "@/lib/conversation-scope";
import { comparisonSlots, comparisonTitle, createTransportComparisonFacts, lowestQuotedPlan, quoteLabel, type ComparisonSlot, type SavedTransportComparisonPlan, type TransportComparison, type TransportPlan } from "@/lib/transport-comparison";
import { transportVehiclePresets, type TransportVehicleType } from "@/lib/transport";
import "./transport-comparison-panel.css";

const stateLabel = { ready: "배정 가능", blocked: "배정 불가", review: "확인 필요" } as const;
const unknown = "확인 불가";
const countLabel = (count: number | null | undefined, unit: string) => count == null ? unknown : `${count}${unit}`;
const flagLabel = (flag?: boolean | null) => flag == null ? unknown : flag ? "예" : "아니요";

function LegDetails({ leg, extra }: { leg: TransportPlan["outbound"]; extra: number }) {
  return <>{leg.demand}명 대상 · {leg.missing === null ? "미배정 확인 불가" : `미배정 ${leg.missing}명`}
    {extra > 0 && ` · 가상 부족 ${leg.extraMissing === null ? "확인 불가" : `${leg.extraMissing}석`}`}</>;
}

export type TransportComparisonSelection = { kind: "current" | "draft" } | { kind: "slot"; slot: ComparisonSlot } | { kind: "saved"; id: string };
type ComparisonEntry = { key: string; title: string; plan: TransportPlan | null; selection: TransportComparisonSelection };

const metricLabels = {
  totalVehicles: "전체 이동 차량", outboundVehicles: "출발 차량", returnVehicles: "귀가 차량",
  privateVehicles: "자차", churchVehicles: "교회 차량", rentalVehicles: "대여 차량",
  vehicleTypes: "차종별 대수", vehicleLabels: "사용 차량", allPeople: "전체 참가자", securedPeople: "이동수단 확보",
  unassignedPeople: "미배정 인원", changedPeople: "배정 변경 인원", outbound: "출발 배정", return: "귀가 배정",
  availableSeats: "추가 가용 좌석", rentalCost: "대여 견적", otherCost: "기타 이동 비용", totalCost: "전체 예상 비용",
  allCanTravel: "전원 이동 가능", requiredConditions: "필수 조건 충족",
} as const;
const allMetrics = Object.keys(metricLabels) as (keyof typeof metricLabels)[];
const compactMetrics = ["totalVehicles", "unassignedPeople", "availableSeats", "rentalCost", "otherCost", "totalCost", "allCanTravel"] as const;
const legacyMetrics = ["outbound", "return", "rentalCost", "vehicleLabels"] as const;
const compactDetails = allMetrics.filter(key => !(compactMetrics as readonly string[]).includes(key));

function metricValues(plan: TransportPlan): Record<keyof typeof metricLabels, ReactNode> {
  const { vehicles, people, cost, allCanTravel, requiredConditionsMet } = plan.metrics ?? {};
  const labels = plan.vehicleLabels.slice(0, 4).join(", ");
  const types = vehicles && Object.entries(vehicles.byType).map(([id, count]) =>
    `${id === "custom" ? "직접 입력" : id === "unspecified" ? "미분류" : transportVehiclePresets[id as TransportVehicleType].label} ${count}대`);
  return {
    totalVehicles: countLabel(vehicles?.total ?? (!plan.metrics && plan.state === "ready" ? plan.vehicleLabels.length : null), "대"),
    outboundVehicles: countLabel(vehicles?.outbound, "대"),
    returnVehicles: countLabel(vehicles?.return, "대"),
    privateVehicles: countLabel(vehicles?.private, "대"),
    churchVehicles: countLabel(vehicles?.church, "대"),
    rentalVehicles: countLabel(vehicles?.rental, "대"),
    vehicleTypes: types ? [...types, ...(vehicles?.unspecified ? [`출처 미분류 ${vehicles.unspecified}대`] : [])].join(" · ") || "—" : unknown,
    vehicleLabels: labels ? `${plan.vehicleLabels.length}대 · ${labels}${plan.vehicleLabels.length > 4 ? " 외" : ""}` : "—",
    allPeople: countLabel(people?.total, "명"),
    securedPeople: countLabel(people?.secured, "명"),
    unassignedPeople: countLabel(people?.unassigned, "명"),
    changedPeople: countLabel(people?.changed, "명"),
    outbound: <LegDetails leg={plan.outbound} extra={plan.extra} />,
    return: <LegDetails leg={plan.return} extra={plan.extra} />,
    availableSeats: vehicles ? `출발 ${vehicles.availableSeats.outbound}석 · 귀가 ${vehicles.availableSeats.return}석` : unknown,
    rentalCost: cost ? <>{cost.rentalCost === null ? "견적 미확인" : quoteLabel(cost.rentalCost)}
      {cost.pendingRentalVehicles > 0 && ` · 미확정 ${cost.pendingRentalVehicles}대`}</> : plan.state === "ready" ? quoteLabel(plan.quote) : "비교 제외",
    otherCost: cost?.otherCost != null ? <>{quoteLabel(cost.otherCost)}
      {cost.unenteredOtherCostVehicles > 0 && ` · 미입력 ${cost.unenteredOtherCostVehicles}대`}</> : cost ? "기타 비용 미입력" : unknown,
    totalCost: cost?.estimatedTotal != null ? quoteLabel(cost.estimatedTotal) : unknown,
    allCanTravel: flagLabel(allCanTravel),
    requiredConditions: flagLabel(requiredConditionsMet),
  };
}

export function TransportComparisonPanel({ comparison, canCapture, capturing, scope, onCapture, onRemove, onAssembly,
  currentPlan, draftPlan, savedPlans = [], onSelectPlan, expanded }: {
  comparison: TransportComparison; canCapture: boolean; capturing: ComparisonSlot | null; scope?: ConversationScope;
  onCapture: (slot: ComparisonSlot) => void; onRemove: (slot: ComparisonSlot) => void; onAssembly: (slot: ComparisonSlot, count: number | null) => void;
  currentPlan?: TransportPlan | null; draftPlan?: TransportPlan | null; savedPlans?: readonly SavedTransportComparisonPlan[];
  onSelectPlan?: (selection: TransportComparisonSelection) => void; expanded?: boolean;
}) {
  const [mode, setMode] = useState<"operations" | "cost">("operations");
  const [tableView, setTableView] = useState(false);
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
  const entries: ComparisonEntry[] = [
    ...(currentPlan === undefined ? [] : [{ key: "current", title: "현재 작업안", plan: currentPlan, selection: { kind: "current" } as const }]),
    ...(draftPlan === undefined ? [] : [{ key: "draft", title: "최초 초안", plan: draftPlan, selection: { kind: "draft" } as const }]),
    ...order.map(slot => ({ key: slot, title: comparisonTitle(slot), plan: comparison[slot] ?? null, selection: { kind: "slot", slot } as const })),
    ...savedPlans.map(({ id, title, plan }) => ({ key: `saved:${id}`, title, plan, selection: { kind: "saved", id } as const })),
  ];
  const showTable = expanded ?? tableView;
  const columns = entries.map(entry => ({ ...entry, values: entry.plan ? metricValues(entry.plan) : null }));
  const note = ({ selection }: ComparisonEntry) => selection.kind === "current" ? "계산된 작업안 없음" : selection.kind === "draft" ? "최초 초안 없음" : "저장된 비교안 없음";
  const state = (plan: TransportPlan) => <span className={plan.state !== "ready" ? "transport-warning" : ""}>{stateLabel[plan.state]} · v{plan.revision}</span>;

  function planActions({ selection, plan, title }: ComparisonEntry) {
    const choose = plan && onSelectPlan && selection.kind !== "slot" && <button type="button" onClick={() => onSelectPlan(selection)} aria-label={`${title} 배치 보기`}>
      <ArrowRight size={14} aria-hidden="true" />배치 보기
    </button>;
    if (selection.kind !== "slot") return choose;
    const { slot } = selection;
    return <>
      {choose}
      <button type="button" disabled={!canCapture || !!capturing} onClick={() => onCapture(slot)}>
        {capturing === slot ? "담는 중" : plan ? `${title} 교체` : `${title}에 담기`}
      </button>
      {plan && <button type="button" title={`${title} 제거`} aria-label={`${title} 제거`} onClick={() => onRemove(slot)}><Trash2 size={15} /></button>}
    </>;
  }

  function assemblyInput({ title, plan, selection }: ComparisonEntry) {
    if (!plan || selection.kind !== "slot") return plan?.assemblyPoints == null ? "—" : `${plan.assemblyPoints}곳`;
    const { slot } = selection;
    return <input type="number" min={1} max={80} step={1} inputMode="numeric" placeholder="미확인"
      aria-label={`${title} 집합 지점 수`} value={plan.assemblyPoints ?? ""} onChange={event => {
        const count = event.target.valueAsNumber;
        if (!event.target.value && !event.target.validity.badInput) onAssembly(slot, null);
        else if (Number.isInteger(count) && count >= 1 && count <= 80) onAssembly(slot, count);
      }} />;
  }

  return <section className="transport-compare" aria-label="배정안 비교">
    <header className="transport-compare-header">
      <h3>배정안 비교</h3>
      <div className="transport-compare-actions">
        <div className="transport-segment" role="group" aria-label="비교 기준">
          <button type="button" aria-pressed={mode === "operations"} onClick={() => setMode("operations")}><Columns2 size={14} />운영 편의</button>
          <button type="button" aria-pressed={mode === "cost"} onClick={() => setMode("cost")}><ArrowDownWideNarrow size={14} />비용 우선</button>
        </div>
        {expanded === undefined && <button type="button" aria-pressed={showTable} onClick={() => setTableView(value => !value)}>
          {showTable ? <LayoutGrid size={14} /> : <Table2 size={14} />}{showTable ? "카드 보기" : "표 보기"}
        </button>}
        {scope && <button type="button" disabled={!expected || loading} onClick={explain}><Sparkles size={14} />{loading ? "설명 확인 중" : "차이 설명"}</button>}
      </div>
    </header>
    {(mode === "cost" || a && b && a.demand !== b.demand) && <p className="transport-compare-status" role="status">{costStatus}</p>}
    {explanation?.key === key && <p className="transport-compare-status" role={explanation.error ? "alert" : "status"}>{explanation.text}</p>}
    {showTable ? <div className="transport-compare-table-wrap" role="region" aria-label="배정안 비교표" tabIndex={0}>
      <table className="transport-compare-table">
        <thead><tr><th scope="col">비교 지표</th>{columns.map(entry => <th scope="col" key={entry.key}>
          {entry.title}<small>{entry.plan ? state(entry.plan) : note(entry)}</small>
        </th>)}</tr></thead>
        <tbody>
          {allMetrics.map(key => <tr key={key}><th scope="row">{metricLabels[key]}</th>
            {columns.map(entry => <td key={entry.key}>{entry.values?.[key] ?? "—"}</td>)}
          </tr>)}
          <tr><th scope="row">출발 집합 지점 수</th>{columns.map(entry => <td key={entry.key}>{assemblyInput(entry)}</td>)}</tr>
        </tbody>
        <tfoot><tr><th scope="row">배정안 관리</th>{columns.map(entry => <td key={entry.key}><div className="transport-compare-actions">{planActions(entry)}</div></td>)}</tr></tfoot>
      </table>
    </div> : <div className="transport-compare-grid">
      {columns.map(entry => {
        const { values } = entry;
        return <article className="transport-compare-plan" key={entry.key} aria-label={entry.title}>
          <header><h4>{entry.title}</h4>{entry.plan && state(entry.plan)}</header>
          {values ? <>
            <dl>{(entry.plan?.metrics ? compactMetrics : legacyMetrics).map(key => <Fragment key={key}>
              <dt>{metricLabels[key]}</dt><dd>{values[key]}</dd>
            </Fragment>)}</dl>
            {entry.plan?.metrics && <details className="transport-compare-details"><summary>세부 지표</summary>
              <dl>{compactDetails.map(key => <Fragment key={key}><dt>{metricLabels[key]}</dt><dd>{values[key]}</dd></Fragment>)}</dl>
            </details>}
            {entry.selection.kind === "slot" && <label>출발 집합 지점 수{assemblyInput(entry)}</label>}
          </> : <p className="transport-compare-empty">{note(entry)}</p>}
          <footer>{planActions(entry)}</footer>
        </article>;
      })}
    </div>}
  </section>;
}
