import { companionFor, hasRentalQuote, isTransportResult, transportVehiclePresets, tripFor, validateTransportInput, validateTransportResult, type Direction, type TransportAssignment, type TransportInput, type TransportResult, type TransportVehicle, type TransportVehicleType } from "./transport";

type Leg = { demand: number; missing: number | null; extraMissing: number | null };
type PlanState = "ready" | "blocked" | "review";
type VehicleMetrics = {
  total: number; outbound: number; return: number;
  private: number; church: number; rental: number; unspecified: number;
  byType: Partial<Record<TransportVehicleType | "unspecified", number>>;
  availableSeats: Record<Direction, number>;
};
type CostMetrics = {
  rentalCost: number | null; pendingRentalVehicles: number;
  otherCost: number | null; unenteredOtherCostVehicles: number; estimatedTotal: number | null;
};
type PlanMetrics = {
  vehicles: VehicleMetrics | null;
  people: { total: number; secured: number | null; unassigned: number | null; changed: number | null };
  cost: CostMetrics | null;
  allCanTravel: boolean | null;
  requiredConditionsMet: boolean | null;
};
export type TransportPlan = {
  revision: number; demand: string; state: PlanState; extra: number; quote: number | null;
  vehicleLabels: string[]; assemblyPoints: number | null; outbound: Leg; return: Leg;
  metrics?: PlanMetrics;
};
export type SavedTransportComparisonPlan = { id: string; title: string; plan: TransportPlan };
type PlanSource = { input: TransportInput; result: TransportResult | null };
type SavedPlanSource = Omit<SavedTransportComparisonPlan, "plan"> & PlanSource;
export type ComparisonSlot = "a" | "b";
export type TransportComparison = Partial<Record<ComparisonSlot, TransportPlan>>;
export const comparisonSlots = ["a", "b"] as const;
export const comparisonTitle = (slot: ComparisonSlot) => `배정안 ${slot.toUpperCase()}`;
export const quoteLabel = (quote: number | null) => quote === null ? "견적 미확인" : `${quote.toLocaleString("ko-KR")}원`;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const maxVehicles = 80;
const maxVehicleCost = 10_000_000;
const maxRentalDays = 30;
const maxRentalTotal = maxVehicles * maxVehicleCost * maxRentalDays;
const maxOtherCost = maxVehicles * maxVehicleCost;
const amount = (value: unknown, max: number) => value === null || integer(value, 0, max);
const directions = ["outbound", "return"] as const;
const sourceKeys = ["private", "church", "rental", "unspecified"] as const;
const planKeys = ["revision", "demand", "state", "extra", "quote", "assemblyPoints", "vehicleLabels", "outbound", "return"] as const;

function isPlanMetrics(value: unknown, total: number) {
  if (!object(value) || !exactKeys(value, ["vehicles", "people", "cost", "allCanTravel", "requiredConditionsMet"])) return false;
  const { vehicles, people, cost, allCanTravel, requiredConditionsMet } = value;
  if (![allCanTravel, requiredConditionsMet].every(flag => flag === null || typeof flag === "boolean")
    || !object(people) || !exactKeys(people, ["total", "secured", "unassigned", "changed"]) || !integer(people.total, 0, 250)
    || ![people.secured, people.unassigned, people.changed].every(count => amount(count, people.total as number))) return false;
  if (vehicles === null) return total === 0 && cost === null && allCanTravel === null
    && [people.secured, people.unassigned, people.changed].every(count => count === null);
  if (!object(vehicles) || !exactKeys(vehicles, ["total", ...directions, ...sourceKeys, "byType", "availableSeats"])
    || vehicles.total !== total || ![...directions, ...sourceKeys].every(key => integer(vehicles[key], 0, total))
    || sourceKeys.reduce((sum, key) => sum + (vehicles[key] as number), 0) !== total
    || !object(vehicles.byType) || !Object.entries(vehicles.byType).every(([key, count]) =>
      (key === "unspecified" || Object.hasOwn(transportVehiclePresets, key)) && integer(count, 1, total))
    || Object.values(vehicles.byType).reduce<number>((sum, count) => sum + (count as number), 0) !== total
    || !object(vehicles.availableSeats) || !exactKeys(vehicles.availableSeats, directions)
    || !Object.values(vehicles.availableSeats).every(count => integer(count, 0, maxVehicles * 60))) return false;
  return integer(people.secured, 0, people.total) && integer(people.unassigned, 0, people.total)
    && people.secured + people.unassigned === people.total && typeof allCanTravel === "boolean" && requiredConditionsMet === true
    && object(cost) && exactKeys(cost, ["rentalCost", "pendingRentalVehicles", "otherCost", "unenteredOtherCostVehicles", "estimatedTotal"])
    && amount(cost.rentalCost, maxRentalTotal) && integer(cost.pendingRentalVehicles, 0, vehicles.rental as number)
    && amount(cost.otherCost, maxOtherCost) && integer(cost.unenteredOtherCostVehicles, 0, total)
    && cost.estimatedTotal === (cost.pendingRentalVehicles === 0 && cost.unenteredOtherCostVehicles === 0
      && typeof cost.rentalCost === "number" && typeof cost.otherCost === "number" ? cost.rentalCost + cost.otherCost : null);
}

export function isTransportComparison(value: unknown): value is TransportComparison {
  if (!object(value) || Object.keys(value).some(key => key !== "a" && key !== "b")) return false;
  const leg = (v: unknown) => object(v) && integer(v.demand, 0, 250)
    && (v.missing === null || integer(v.missing, 0, v.demand as number))
    && (v.extraMissing === null || integer(v.extraMissing, 0, 50));
  return Object.values(value).every(plan => object(plan)
    && exactKeys(plan, Object.hasOwn(plan, "metrics") ? [...planKeys, "metrics"] : planKeys)
    && integer(plan.revision, 1, 1_000_000) && typeof plan.demand === "string" && /^[a-f0-9]{64}$/.test(plan.demand)
    && ["ready", "blocked", "review"].includes(plan.state as string)
    && integer(plan.extra, 0, 50) && amount(plan.quote, Object.hasOwn(plan, "metrics") ? maxRentalTotal : maxOtherCost)
    && (plan.assemblyPoints === null || integer(plan.assemblyPoints, 1, 80))
    && Array.isArray(plan.vehicleLabels) && plan.vehicleLabels.length <= maxVehicles
    && plan.vehicleLabels.every(label => typeof label === "string" && label.trim() && label.length <= 80)
    && (!Object.hasOwn(plan, "metrics") || isPlanMetrics(plan.metrics, plan.vehicleLabels.length))
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

function occupiedVehicleTrips(result: TransportResult) {
  const byVehicle = new Map<string, Map<string, number>>();
  const add = (vehicleId: string, tripId: string, count: number) => {
    const trips = byVehicle.get(vehicleId) ?? new Map<string, number>();
    trips.set(tripId, (trips.get(tripId) ?? 0) + count);
    byVehicle.set(vehicleId, trips);
  };
  for (const assignment of result.assignments) if (assignment.vehicleId) add(assignment.vehicleId, assignment.tripId, 1);
  for (const reservation of result.reservations) add(reservation.vehicleId, reservation.tripId, reservation.count);
  return byVehicle;
}

function vehicleSource(vehicle: TransportVehicle): typeof sourceKeys[number] {
  return vehicle.source ?? (vehicle.rental ? "rental" : "unspecified");
}

function rentalCharge(vehicle: TransportVehicle, legs: number): number | null {
  if (!hasRentalQuote(vehicle)) return null;
  switch (vehicle.rentalCostUnit) {
    case undefined:
    case "round-trip": return vehicle.rentalCost;
    case "one-way": return integer(legs, 1, 2) ? vehicle.rentalCost * legs : null;
    case "day": return integer(vehicle.rentalDays, 1, maxRentalDays) ? vehicle.rentalCost * vehicle.rentalDays : null;
    default: return null;
  }
}

function costMetrics(input: TransportInput, result: TransportResult, occupied: ReturnType<typeof occupiedVehicleTrips>): CostMetrics | null {
  const vehicles = new Map(input.vehicles.map(v => [v.id, v]));
  let rentalCost: number | null = null;
  let otherCost: number | null = null;
  let pendingRentalVehicles = 0;
  let unenteredOtherCostVehicles = 0;
  for (const id of new Set(result.usedVehicleIds)) {
    const vehicle = vehicles.get(id);
    if (!vehicle) return null;
    if (vehicleSource(vehicle) === "rental") {
      const charge = rentalCharge(vehicle, occupied.get(id)?.size ?? 0);
      if (charge === null) pendingRentalVehicles++;
      else rentalCost = (rentalCost ?? 0) + charge;
    }
    if (integer(vehicle.otherCost, 0, maxVehicleCost)) otherCost = (otherCost ?? 0) + vehicle.otherCost;
    else unenteredOtherCostVehicles++;
  }
  if (pendingRentalVehicles === 0) rentalCost ??= 0;
  const estimatedTotal = pendingRentalVehicles === 0 && unenteredOtherCostVehicles === 0 && rentalCost !== null && otherCost !== null
    ? rentalCost + otherCost : null;
  return { rentalCost, pendingRentalVehicles, otherCost, unenteredOtherCostVehicles, estimatedTotal };
}

export function recordedTransportQuote(input: TransportInput, result: TransportResult): number | null {
  const cost = costMetrics(input, result, occupiedVehicleTrips(result));
  return cost?.pendingRentalVehicles === 0 ? cost.rentalCost : null;
}

function vehicleMetrics(input: TransportInput, occupied: ReturnType<typeof occupiedVehicleTrips>): VehicleMetrics {
  const metrics: VehicleMetrics = {
    total: occupied.size, outbound: 0, return: 0, private: 0, church: 0, rental: 0, unspecified: 0,
    byType: {}, availableSeats: { outbound: 0, return: 0 },
  };
  const tripDirections = new Map(input.trips.map(trip => [trip.id, trip.direction]));
  for (const vehicle of input.vehicles) {
    const trips = occupied.get(vehicle.id);
    if (!trips) continue;
    metrics[vehicleSource(vehicle)]++;
    const type = vehicle.vehicleType ?? "unspecified";
    metrics.byType[type] = (metrics.byType[type] ?? 0) + 1;
    for (const [id, count] of trips) {
      const direction = tripDirections.get(id)!;
      metrics[direction]++;
      metrics.availableSeats[direction] += vehicle.capacity - count;
    }
  }
  return metrics;
}

const passengerLegKey = (personId: string, tripId: string) => `${personId}|${tripId}`;

function changedPeople(previous: readonly TransportAssignment[], current: Map<string, string | null>, input: TransportInput): number | null {
  const knownPeople = new Set(input.people.map(person => person.id));
  const previousRows = previous.filter(assignment => knownPeople.has(assignment.personId));
  if (!previousRows.length) return null;
  const previousByLeg = new Map(previousRows.map(a => [passengerLegKey(a.personId, a.tripId), a.vehicleId]));
  const baselinePeople = new Set(previousRows.map(a => a.personId));
  const changed = new Set(previousRows.filter(a => current.get(passengerLegKey(a.personId, a.tripId)) !== a.vehicleId).map(a => a.personId));
  for (const person of input.people) {
    if (baselinePeople.has(person.id) && directions.some(direction => {
      const tripId = tripFor(person, direction);
      return tripId !== null && current.get(passengerLegKey(person.id, tripId)) !== previousByLeg.get(passengerLegKey(person.id, tripId));
    })) changed.add(person.id);
  }
  return changed.size;
}

function hasCurrentResult(input: TransportInput, result: TransportResult | null): result is TransportResult {
  return isTransportResult(result) && result.revision === input.revision && validateTransportInput(input).length === 0;
}

export async function buildTransportPlan(input: TransportInput, result: TransportResult,
  { baselineAssignments }: { baselineAssignments?: readonly TransportAssignment[] } = {}): Promise<TransportPlan> {
  if (!hasCurrentResult(input, result)) {
    throw new Error("현재 배정 결과를 다시 계산해 주세요.");
  }
  return summarizePlan(input, result, baselineAssignments);
}

async function summarizePlan(input: TransportInput, result: TransportResult, baselineAssignments: readonly TransportAssignment[] = input.previousAssignments): Promise<TransportPlan> {
  const errors = validateTransportResult(input, result);
  const coverageErrors = new Set(["미배정 인원이 있습니다.", "가상 추가 인원의 좌석이 부족하거나 중복됩니다."]);
  const extraTripIds = [input.extraOutboundTripId, input.extraReturnTripId];
  const reservedSeats = (tripId: string) => result.reservations.filter(r => r.tripId === tripId).reduce((sum, r) => sum + r.count, 0);
  const hasAssignments = ["optimal", "feasible", "manual"].includes(result.status);
  const hasResult = hasAssignments && errors.every(error => coverageErrors.has(error))
    && extraTripIds.every(id => reservedSeats(id) <= input.extraCount);
  const state: PlanState = result.status === "infeasible" || hasResult && errors.length ? "blocked" : hasResult ? "ready" : "review";
  const assigned = new Map(result.assignments.map(a => [passengerLegKey(a.personId, a.tripId), a.vehicleId]));
  const missingTrip = (personId: string, tripId: string | null) => tripId !== null && !assigned.get(passengerLegKey(personId, tripId));
  const leg = (direction: Direction, extraTripId: string): Leg => {
    const travelers = input.people.filter(p => tripFor(p, direction) !== null);
    const missing = travelers.filter(p => missingTrip(p.id, tripFor(p, direction))).length;
    return { demand: travelers.length, missing: hasResult ? missing : null,
      extraMissing: hasResult ? input.extraCount - reservedSeats(extraTripId) : null };
  };
  const occupied = hasResult ? occupiedVehicleTrips(result) : null;
  const cost = occupied ? costMetrics(input, result, occupied) : null;
  const peopleTotal = input.people.length;
  const unassigned = hasResult ? input.people.filter(p => directions.some(direction => missingTrip(p.id, tripFor(p, direction)))).length : null;
  return {
    revision: input.revision, demand: await transportDemandFingerprint(input), state, extra: input.extraCount,
    quote: state === "ready" && cost?.pendingRentalVehicles === 0 ? cost.rentalCost : null, assemblyPoints: null,
    vehicleLabels: hasResult ? input.vehicles.filter(v => result.usedVehicleIds.includes(v.id)).map(v => v.label) : [],
    outbound: leg("outbound", input.extraOutboundTripId), return: leg("return", input.extraReturnTripId),
    metrics: {
      vehicles: occupied ? vehicleMetrics(input, occupied) : null,
      people: { total: peopleTotal, secured: unassigned === null ? null : peopleTotal - unassigned, unassigned,
        changed: hasResult ? changedPeople(baselineAssignments, assigned, input) : null },
      cost, allCanTravel: unassigned === null ? null : unassigned === 0 && state === "ready",
      requiredConditionsMet: hasAssignments ? hasResult : null,
    },
  };
}

export async function buildTransportComparisonSummaries({ current, draft, saved = [] }: {
  current?: PlanSource | null;
  draft?: PlanSource | null;
  saved?: readonly SavedPlanSource[];
}) {
  const summarize = (source: PlanSource | null | undefined, baseline?: readonly TransportAssignment[]) =>
    source && hasCurrentResult(source.input, source.result) ? summarizePlan(source.input, source.result, baseline) : null;
  const draftPlan = draft === undefined ? undefined : await summarize(draft, draft?.result?.assignments);
  const baseline = draftPlan?.metrics?.requiredConditionsMet ? draft?.result?.assignments : undefined;
  const [currentPlan, savedPlans] = await Promise.all([
    current === undefined ? undefined : summarize(current, baseline),
    Promise.all(saved.map(async ({ input, result, id, title }): Promise<SavedTransportComparisonPlan | null> => {
      const plan = await summarize({ input, result }, baseline);
      return plan ? { id, title, plan } : null;
    })),
  ]);
  return { currentPlan, draftPlan, savedPlans: savedPlans.filter(plan => plan !== null) };
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
