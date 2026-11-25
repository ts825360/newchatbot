import { companionFor, hasRentalQuote, isTransportResult, tripFor, validateTransportInput, validateTransportResult, type Direction, type TransportInput, type TransportResult } from "./transport";

type Leg = { demand: number; missing: number | null; extraMissing: number | null };
type PlanState = "ready" | "blocked" | "review";
export type TransportPlan = {
  revision: number; demand: string; state: PlanState; extra: number; quote: number | null;
  vehicleLabels: string[]; assemblyPoints: number | null; outbound: Leg; return: Leg;
};
export type ComparisonSlot = "a" | "b";
export type TransportComparison = Partial<Record<ComparisonSlot, TransportPlan>>;
export const comparisonSlots = ["a", "b"] as const;
export const comparisonTitle = (slot: ComparisonSlot) => `배정안 ${slot.toUpperCase()}`;
export const quoteLabel = (quote: number | null) => quote === null ? "견적 미확인" : `${quote.toLocaleString("ko-KR")}원`;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

export function isTransportComparison(value: unknown): value is TransportComparison {
  if (!object(value) || Object.keys(value).some(key => key !== "a" && key !== "b")) return false;
  const leg = (v: unknown) => object(v) && integer(v.demand, 0, 250)
    && (v.missing === null || integer(v.missing, 0, v.demand as number))
    && (v.extraMissing === null || integer(v.extraMissing, 0, 50));
  return Object.values(value).every(plan => object(plan)
    && Object.keys(plan).length === 9
    && integer(plan.revision, 1, 1_000_000) && typeof plan.demand === "string" && /^[a-f0-9]{64}$/.test(plan.demand)
    && ["ready", "blocked", "review"].includes(plan.state as string)
    && integer(plan.extra, 0, 50) && (plan.quote === null || integer(plan.quote, 0, 800_000_000))
    && (plan.assemblyPoints === null || integer(plan.assemblyPoints, 1, 80))
    && Array.isArray(plan.vehicleLabels) && plan.vehicleLabels.length <= 80
    && plan.vehicleLabels.every(label => typeof label === "string" && label.trim() && label.length <= 80)
    && leg(plan.outbound) && leg(plan.return)
    && [plan.outbound, plan.return].every(v => {
      const leg = v as Leg;
      return Object.keys(leg).length === 3 && (leg.extraMissing === null || leg.extraMissing <= (plan.extra as number))
        && (plan.state !== "ready" || leg.missing === 0 && leg.extraMissing === 0);
    })
    && (plan.state === "ready" || plan.quote === null));
}

export async function transportDemandFingerprint(input: TransportInput) {
  const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Snapshot compatibility is based on roster and trip conditions, not quotes or vehicle choices.
  const canonical = [
    byId(input.people).map(p => [p.id, p.department, tripFor(p, "outbound"), tripFor(p, "return"), companionFor(p, "outbound"), companionFor(p, "return")]),
    byId(input.trips).map(t => [t.id, t.direction, t.start, t.end]),
    input.extraCount, input.extraCount ? input.extraOutboundTripId : null, input.extraCount ? input.extraReturnTripId : null,
    [...input.locks].map(a => JSON.stringify([a.personId, a.tripId, a.vehicleId])).sort(),
  ];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function recordedTransportQuote(input: TransportInput, result: TransportResult): number | null {
  const vehicles = new Map(input.vehicles.map(v => [v.id, v]));
  let total = 0;
  for (const id of new Set(result.usedVehicleIds)) {
    const vehicle = vehicles.get(id);
    if (!vehicle || vehicle.rental && !hasRentalQuote(vehicle)) return null;
    if (vehicle.rental) total += vehicle.rentalCost;
  }
  return total;
}

export async function buildTransportPlan(input: TransportInput, result: TransportResult): Promise<TransportPlan> {
  if (!isTransportResult(result) || result.revision !== input.revision || validateTransportInput(input).length) {
    throw new Error("현재 배정 결과를 다시 계산해 주세요.");
  }
  const errors = validateTransportResult(input, result);
  const coverageErrors = new Set(["미배정 인원이 있습니다.", "가상 추가 인원의 좌석이 부족하거나 중복됩니다."]);
  const hasResult = ["optimal", "feasible", "manual"].includes(result.status) && errors.every(error => coverageErrors.has(error));
  const state: PlanState = result.status === "infeasible" || hasResult && errors.length ? "blocked" : hasResult ? "ready" : "review";
  const leg = (direction: Direction, extraTripId: string): Leg => {
    const travelers = input.people.filter(p => tripFor(p, direction) !== null);
    const missing = travelers.filter(p => !result.assignments.some(a => a.personId === p.id && a.tripId === tripFor(p, direction) && a.vehicleId)).length;
    const reserved = result.reservations.filter(r => r.tripId === extraTripId).reduce((sum, r) => sum + r.count, 0);
    return { demand: travelers.length, missing: hasResult ? missing : null,
      extraMissing: hasResult ? Math.max(0, input.extraCount - reserved) : null };
  };
  return {
    revision: input.revision, demand: await transportDemandFingerprint(input), state, extra: input.extraCount,
    quote: state === "ready" ? recordedTransportQuote(input, result) : null, assemblyPoints: null,
    vehicleLabels: hasResult ? input.vehicles.filter(v => result.usedVehicleIds.includes(v.id)).map(v => v.label) : [],
    outbound: leg("outbound", input.extraOutboundTripId), return: leg("return", input.extraReturnTripId),
  };
}

export function lowestQuotedPlan({ a, b }: TransportComparison): ComparisonSlot | null {
  if (!a || !b || a.demand !== b.demand || a.state !== "ready" || b.state !== "ready" || a.quote === null || b.quote === null || a.quote === b.quote) return null;
  return a.quote < b.quote ? "a" : "b";
}

export function createTransportComparisonFacts({ a, b }: Required<TransportComparison>) {
  const safe = ({ state, extra, quote, assemblyPoints, vehicleLabels, outbound, return: home }: TransportPlan) => ({
    state, extra, quote, assemblyPoints, vehicleCount: vehicleLabels.length,
    outbound: { demand: outbound.demand, missing: outbound.missing, extraMissing: outbound.extraMissing },
    return: { demand: home.demand, missing: home.missing, extraMissing: home.extraMissing },
  });
  const labels = (plan: TransportPlan) => JSON.stringify([...plan.vehicleLabels].sort());
  return { comparable: a.demand === b.demand, differentVehicles: labels(a) !== labels(b), a: safe(a), b: safe(b) };
}

export function comparisonPoints(pair: Required<TransportComparison>) {
  const { a, b, comparable, differentVehicles } = createTransportComparisonFacts(pair);
  if (!comparable) return { coverage: "두 안의 명단·이동 조건이 달라 비용 순위를 매기지 않았습니다." };
  if (a.state !== "ready" || b.state !== "ready") {
    const remaining = (leg: Leg) => leg.missing === null || leg.extraMissing === null ? "확인 불가" : `미배정 ${leg.missing}명 / 가상 부족 ${leg.extraMissing}석`;
    return { coverage: `배정 상태를 먼저 확인해 주세요. A 출발: ${remaining(a.outbound)}, 귀가: ${remaining(a.return)}. B 출발: ${remaining(b.outbound)}, 귀가: ${remaining(b.return)}.` };
  }
  const points: Record<string, string> = {};
  if (a.quote !== b.quote) points.quote = `대여 견적은 A ${quoteLabel(a.quote)}, B ${quoteLabel(b.quote)}입니다.`;
  if (a.assemblyPoints !== b.assemblyPoints) {
    const assembly = (count: number | null) => count === null ? "미확인" : `${count}곳`;
    points.assembly = `출발 집합 지점은 A ${assembly(a.assemblyPoints)}, B ${assembly(b.assemblyPoints)}입니다.`;
  }
  if (differentVehicles) points.vehicles = `A ${a.vehicleCount}대, B ${b.vehicleCount}대로 사용 차량 구성이 다릅니다.`;
  return points;
}
