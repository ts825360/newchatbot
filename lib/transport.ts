import { isDirectionalTransportMovement, type DirectionalTransportMovement } from "./transport-movement";

export type Direction = "outbound" | "return";
export const transportGenderLabels = { male: "남성", female: "여성" } as const;
export type TransportGender = keyof typeof transportGenderLabels;
export const isTransportGender = (value: unknown): value is TransportGender => value === "male" || value === "female";
export type TransportPerson = { id: string; name: string; department: string; gender?: TransportGender; team?: string; familyId: string; companionGroup: string; outboundCompanionGroup?: string; returnCompanionGroup?: string; outboundTripId: string | null; returnTripId: string | null; outboundEntry?: string; returnEntry?: string; movement?: string; movementPlan?: DirectionalTransportMovement; lodging?: string; roomAssignment?: string; notes?: string };
export const transportUnnamedParticipant = "이름 미입력";
export const surveyTripPending = "설문 이동수단 확인 필요";
export type TransportTrip = { id: string; label: string; direction: Direction; start: number; end: number; startUnknown?: boolean; endUnknown?: boolean;
  purpose?: string; origin?: string; destination?: string; pickup?: string; mandatoryTime?: boolean };
export type TransportVehicle = { id: string; label: string; capacity: number; totalSeats?: number; vehicleType?: TransportVehicleType; driverId: string | null; driverName?: string; externalDriverConfirmed?: boolean; rental: boolean; rentalCost: number; rentalQuoteKnown?: boolean; enabled: boolean; tripIds: string[];
  source?: "private" | "church" | "rental"; rentalCostUnit?: "round-trip" | "one-way" | "day"; rentalDays?: number | null; otherCost?: number | null };
export type TransportAssignment = { personId: string; tripId: string; vehicleId: string | null };
export type TransportInput = {
  revision: number; objective: "cost" | "institution"; extraCount: number; extraOutboundTripId: string; extraReturnTripId: string;
  people: TransportPerson[]; trips: TransportTrip[]; vehicles: TransportVehicle[]; locks: TransportAssignment[]; previousAssignments: TransportAssignment[];
};
export type TransportResult = {
  revision: number; status: "optimal" | "feasible" | "infeasible" | "unknown" | "manual";
  assignments: TransportAssignment[]; reservations: { tripId: string; vehicleId: string; count: number }[];
  unassignedCount: number; unreservedCount: number; usedVehicleIds: string[]; cost: number; message: string;
};

export const tripFor = (person: TransportPerson, direction: Direction) => direction === "outbound" ? person.outboundTripId : person.returnTripId;
export const companionFor = (person: TransportPerson, direction: Direction) => (direction === "outbound" ? person.outboundCompanionGroup : person.returnCompanionGroup) ?? person.companionGroup;
export const entryFor = (person: TransportPerson, direction: Direction) => direction === "outbound" ? person.outboundEntry : person.returnEntry;
const comparable = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, "").toLowerCase();
export function resolveTripEntry(trips: TransportTrip[], direction: Direction, value: string): string | null | undefined {
  const normalized = comparable(value);
  if (normalized === comparable(surveyTripPending)) return undefined;
  if (!normalized || ["개별이동", "왕복개별이동", "자차", "왕복자차"].includes(normalized)) return null;
  const matches = trips.filter((trip) => trip.direction === direction && [trip.label, trip.id].some((name) => comparable(name) === normalized));
  return matches.length === 1 ? matches[0].id : undefined;
}
export function personTripPatch(trips: TransportTrip[], direction: Direction, value: string): Partial<TransportPerson> {
  const resolved = resolveTripEntry(trips, direction, value);
  return { [direction + "TripId"]: resolved ?? null, [direction + "Entry"]: resolved === undefined ? value.trim() : undefined };
}
export const tripLabel = (trips: TransportTrip[], id: string | null) => id === null ? "개별 이동" : trips.find((trip) => trip.id === id)?.label ?? id;
export const personTripLabel = (trips: TransportTrip[], person: TransportPerson, direction: Direction) => entryFor(person, direction) || tripLabel(trips, tripFor(person, direction));
export const driverOption = (person: TransportPerson) => `${person.name} · ${person.id}`;
export function driverIdFor(people: TransportPerson[], value: string): string | null {
  if (!value.trim()) return null;
  const direct = people.find((person) => driverOption(person) === value.trim());
  if (direct) return direct.id;
  const matches = people.filter((person) => comparable(person.name) === comparable(value));
  return matches.length === 1 ? matches[0].id : null;
}
export function resolveTransportEntries(input: TransportInput): TransportInput {
  const people = input.people.map((person) => {
    if (!person.outboundEntry && !person.returnEntry) return person;
    return { ...person, ...(person.outboundEntry ? personTripPatch(input.trips, "outbound", person.outboundEntry) : {}),
      ...(person.returnEntry ? personTripPatch(input.trips, "return", person.returnEntry) : {}) };
  });
  const vehicles = input.vehicles.map((vehicle) => vehicle.driverName === undefined ? vehicle : {
    ...vehicle, driverId: vehicle.externalDriverConfirmed ? null : driverIdFor(people, vehicle.driverName),
  });
  return { ...input, people, vehicles };
}
const rosterOrder = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
export const sortTransportRoster = (people: TransportPerson[]) => [...people].sort((a, b) =>
  rosterOrder.compare(a.department, b.department) || rosterOrder.compare(b.familyId, a.familyId) || rosterOrder.compare(a.name, b.name));
const key = (personId: string, tripId: string) => `${personId}|${tripId}`;
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,50}$/.test(value);
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const label = (value: unknown, length = 80) => typeof value === "string" && value.trim().length > 0 && value.length <= length;
const optionalText = (value: unknown, length: number) => value === undefined || typeof value === "string" && value.length <= length && !value.includes("\u0000");
const optionalBool = (value: unknown) => value === undefined || typeof value === "boolean";

const participantOverlap = (out: TransportTrip, home: TransportTrip) => !out.endUnknown && !home.startUnknown && out.end > home.start;
function tripReuseConflict(a: TransportTrip, b: TransportTrip, sameVehicle: boolean) {
  // Unknown times cannot establish that a driver or vehicle can serve both trips.
  if (a.startUnknown || a.endUnknown || b.startUnknown || b.endUnknown) return "time-unknown";
  if (a.start < b.end && b.start < a.end) return "overlap";
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  if (sameVehicle && first.destination?.trim() && second.origin?.trim() && comparable(first.destination) !== comparable(second.origin)) return "location";
  return null;
}

export const transportVehiclePresets = {
  "small-bus": { label: "소형 버스", totalSeats: 25 },
  "mid-bus": { label: "중형 버스", totalSeats: 35 },
  "large-bus": { label: "대형 버스", totalSeats: 45 },
  "starex-9": { label: "스타렉스 9인승", totalSeats: 9 },
  "starex-11": { label: "스타렉스 11인승", totalSeats: 11 },
  "starex-12": { label: "스타렉스 12인승", totalSeats: 12 },
  "car-5": { label: "승용차", totalSeats: 5 },
  custom: { label: "", totalSeats: undefined },
} as const;
export type TransportVehicleType = keyof typeof transportVehiclePresets;
export const defaultTransportVehicleName = "추가 차량";
export const hasRentalQuote = (vehicle: TransportVehicle) => vehicle.rentalQuoteKnown ?? vehicle.rentalCost > 0;

export function createTransportVehicle(id: string): TransportVehicle {
  return { id, label: defaultTransportVehicleName, totalSeats: 0, capacity: 0, driverId: null, externalDriverConfirmed: false, rental: false, rentalCost: 0, enabled: true, tripIds: [] };
}

export function transportVehicleSeatError(vehicle: TransportVehicle, draft = false): string | undefined {
  const min = draft ? 0 : 1;
  if (!integer(vehicle.capacity, min, 60)) return "배정 가능 좌석을 1~60석으로 입력해 주세요.";
  // A legacy capacity-only row has no recorded total. Keep its original allocation limit.
  const total = vehicle.totalSeats;
  if (total === undefined && vehicle.vehicleType === undefined) return;
  if (total === undefined || !integer(total, min, 60)) return "총 좌석을 1~60석으로 입력해 주세요.";
  if (!draft && vehicle.capacity > total) return "배정 가능 좌석이 총 좌석을 초과합니다.";
}

export function isTransportResult(value: unknown): value is TransportResult {
  if (!value || typeof value !== "object") return false;
  const r = value as TransportResult;
  return integer(r.revision, 0, 1_000_000) && ["optimal", "feasible", "infeasible", "unknown", "manual"].includes(r.status)
    && typeof r.message === "string" && r.message.length < 1000 && [r.cost, r.unassignedCount, r.unreservedCount].every((n) => typeof n === "number" && Number.isFinite(n))
    && Array.isArray(r.assignments) && r.assignments.length <= 500 && r.assignments.every((a) => a && identifier(a.personId) && identifier(a.tripId) && (a.vehicleId === null || identifier(a.vehicleId)))
    && Array.isArray(r.reservations) && r.reservations.length <= 160 && r.reservations.every((a) => a && identifier(a.tripId) && identifier(a.vehicleId) && integer(a.count, 1, 50))
    && Array.isArray(r.usedVehicleIds) && r.usedVehicleIds.length <= 80 && r.usedVehicleIds.every(identifier);
}

export function validateTransportInput(value: unknown, { draft = false }: { draft?: boolean } = {}): string[] {
  if (!value || typeof value !== "object") return ["배정 입력을 확인해 주세요."];
  const d = value as TransportInput;
  if (![d.people, d.vehicles, d.trips, d.locks, d.previousAssignments].every(Array.isArray)) return ["명단과 차량 목록 형식이 올바르지 않습니다."];
  if ((!draft && (d.people.length < 1 || d.vehicles.length < 1)) || d.people.length > 250 || d.vehicles.length > 80 || d.trips.length < 2 || d.trips.length > 8 || d.locks.length > 500 || d.previousAssignments.length > 500) return ["인원 1~250명, 차량 1~80대, 이동편 2~8개 범위로 입력해 주세요."];
  const errors: string[] = [];
  if (!integer(d.revision, 1, 1_000_000) || !integer(d.extraCount, 0, 50) || !["cost", "institution"].includes(d.objective)) errors.push("입력 버전·추가 인원·우선순위를 확인해 주세요.");
  for (const [list, name] of [[d.people, "참가자"], [d.vehicles, "차량"], [d.trips, "이동편"]] as const) {
    if (list.some((x) => !x || !identifier(x.id)) || new Set(list.map((x) => x?.id)).size !== list.length) errors.push(`${name} ID가 잘못되었거나 중복됩니다.`);
  }
  if (errors.length) return errors;
  const trips = new Map(d.trips.map((t) => [t.id, t]));
  const people = new Map(d.people.map((p) => [p.id, p]));
  const vehicles = new Map(d.vehicles.map((v) => [v.id, v]));
  for (const direction of ["outbound", "return"] as const) {
    const labels = d.trips.filter((trip) => trip.direction === direction && typeof trip.label === "string").map((trip) => comparable(trip.label));
    if (!draft && new Set(labels).size !== labels.length) errors.push("같은 방향에 팀 이름이 중복됩니다.");
  }
  for (const t of d.trips) {
    if (!label(t.label) || !["outbound", "return"].includes(t.direction) || !integer(t.start, 0, 10080) || !integer(t.end, 1, 10080) || (!t.startUnknown && !t.endUnknown && t.start >= t.end)) errors.push("이동편 이름·시간 범위를 확인해 주세요.");
    if (![t.startUnknown, t.endUnknown, t.mandatoryTime].every(optionalBool) || ![t.purpose, t.origin, t.destination, t.pickup].every(value => optionalText(value, 160))) errors.push("이동 목적·장소·운행 조건을 확인해 주세요.");
    if (!draft && t.mandatoryTime && (t.startUnknown || t.endUnknown) && (d.people.some(p => tripFor(p, t.direction) === t.id) || d.extraCount && [d.extraOutboundTripId, d.extraReturnTripId].includes(t.id))) errors.push(`${t.label}: 필수 운행 시각을 확인해 주세요.`);
  }
  for (const p of d.people) {
    if (!label(p.name) || !label(p.department, 40) || (p.team !== undefined && p.team !== "" && !label(p.team, 40)) || typeof p.familyId !== "string" || p.familyId.length > 40 || typeof p.companionGroup !== "string" || p.companionGroup.length > 40) errors.push("참가자 이름·소속·팀·동반 묶음을 확인해 주세요.");
    if ([p.outboundCompanionGroup, p.returnCompanionGroup].some((g) => g !== undefined && (typeof g !== "string" || g.length > 40))) errors.push("출발·귀가 동반 묶음을 확인해 주세요.");
    if (p.gender !== undefined && !isTransportGender(p.gender)) errors.push("참가자 성별 값을 확인해 주세요.");
    for (const dir of ["outbound", "return"] as const) {
      const id = tripFor(p, dir);
      if (id !== null && trips.get(id)?.direction !== dir) errors.push(`${p.name}: 이동편 방향이 올바르지 않습니다.`);
      const entry = entryFor(p, dir);
      if (!optionalText(entry, 120)) errors.push(`${p.name}: 이동 입력은 120자 이하로 작성해 주세요.`);
      else if (!draft && entry) errors.push(`${p.name}: ${dir === "outbound" ? "출발 팀" : "귀가편"} ‘${entry}’을 확인해 주세요.`);
    }
    if (!optionalText(p.movement, 200) || !optionalText(p.lodging, 200) || !optionalText(p.notes, 4000)) errors.push(`${p.name}: 설문 입력 길이를 확인해 주세요.`);
    if (p.movementPlan !== undefined && !isDirectionalTransportMovement(p.movementPlan)) errors.push(`${p.name}: 방향별 설문 이동 응답을 확인해 주세요.`);
    if (!optionalText(p.roomAssignment, 80)) errors.push(`${p.name}: 방 이름은 80자까지 입력할 수 있습니다.`);
    if (!draft && p.name === transportUnnamedParticipant) errors.push("명단에 이름이 비어 있는 참가자가 있습니다.");
    if (p.outboundTripId && p.returnTripId && trips.has(p.outboundTripId) && trips.has(p.returnTripId) && participantOverlap(trips.get(p.outboundTripId)!, trips.get(p.returnTripId)!)) errors.push(`${p.name}: 출발과 귀가 시간이 겹칩니다.`);
  }
  for (const v of d.vehicles) {
    if (!label(v.label)) errors.push("차량 이름을 확인해 주세요.");
    if (v.vehicleType !== undefined && (typeof v.vehicleType !== "string" || !Object.hasOwn(transportVehiclePresets, v.vehicleType))) errors.push(`${v.label}: 차종을 확인해 주세요.`);
    const seatError = transportVehicleSeatError(v, draft);
    if (seatError) errors.push(`${v.label}: ${seatError}`);
    if (typeof v.enabled !== "boolean" || typeof v.rental !== "boolean" || !integer(v.rentalCost, 0, 10_000_000) || (v.rentalQuoteKnown !== undefined && typeof v.rentalQuoteKnown !== "boolean")) errors.push("차량 사용 여부와 대여 견적을 확인해 주세요.");
    if (v.source !== undefined && (!["private", "church", "rental"].includes(v.source) || (v.source === "rental") !== v.rental)
      || v.rentalCostUnit !== undefined && !["round-trip", "one-way", "day"].includes(v.rentalCostUnit)
      || v.rentalDays != null && !integer(v.rentalDays, 1, 30) || v.otherCost != null && !integer(v.otherCost, 0, 10_000_000)) errors.push("차량 출처와 비용 범위를 확인해 주세요.");
    if (!Array.isArray(v.tripIds) || new Set(v.tripIds).size !== v.tripIds.length || v.tripIds.some((id) => !trips.has(id))) errors.push(`${v.label}: 가용 이동편을 확인해 주세요.`);
    if (v.driverId !== null && !people.has(v.driverId)) errors.push(`${v.label}: 운전자 ID를 확인해 주세요.`);
    if (!optionalText(v.driverName, 140)) errors.push(`${v.label}: 운전자 이름을 확인해 주세요.`);
    else if (!draft && v.enabled && v.driverName?.trim() && v.driverId === null && !v.externalDriverConfirmed) errors.push(`${v.label}: 운전자 ‘${v.driverName}’을 확인해 주세요.`);
    if (v.externalDriverConfirmed !== undefined && typeof v.externalDriverConfirmed !== "boolean") errors.push(`${v.label}: 외부 운전자 확인 상태가 올바르지 않습니다.`);
  }
  if (trips.get(d.extraOutboundTripId)?.direction !== "outbound" || trips.get(d.extraReturnTripId)?.direction !== "return") errors.push("가상 인원의 출발·귀가 이동편을 선택해 주세요.");
  if (d.extraCount > 0 && trips.get(d.extraOutboundTripId) && trips.get(d.extraReturnTripId) && participantOverlap(trips.get(d.extraOutboundTripId)!, trips.get(d.extraReturnTripId)!)) errors.push("가상 인원의 출발·귀가 시간이 겹칩니다.");
  for (const direction of ["outbound", "return"] as const) for (const group of new Set(d.people.map((p) => companionFor(p, direction)).filter(Boolean))) {
    const members = d.people.filter((p) => companionFor(p, direction) === group);
    if (new Set(members.map((p) => tripFor(p, direction))).size > 1) errors.push(`동반 묶음 ${group}: 같은 방향의 이동편이 서로 다릅니다.`);
  }
  for (const [items, name] of [[d.locks, "잠금"], [d.previousAssignments, "이전 배정"]] as const) {
    const seen = new Set<string>();
    for (const a of items) {
      if (!a || !people.has(a.personId) || !trips.has(a.tripId) || (a.vehicleId !== null && !vehicles.has(a.vehicleId))) { errors.push(`${name} 참조를 확인해 주세요.`); continue; }
      if (seen.has(key(a.personId, a.tripId))) errors.push(`${name}이 중복됩니다.`);
      seen.add(key(a.personId, a.tripId));
      if (tripFor(people.get(a.personId)!, trips.get(a.tripId)!.direction) !== a.tripId) errors.push(`${name} 이동편이 참가자 설정과 다릅니다.`);
    }
  }
  return [...new Set(errors)];
}

export function validateTransportResult(input: TransportInput, result: TransportResult): string[] {
  const errors = validateTransportInput(input);
  if (errors.length) return errors;
  if (!isTransportResult(result)) return ["계산 결과 형식이 올바르지 않습니다."];
  if (result.revision !== input.revision) errors.push("입력 변경 후 다시 계산해 주세요.");
  if (!["optimal", "feasible", "manual"].includes(result.status)) errors.push(result.message || "확정 가능한 계산 결과가 없습니다.");
  const people = new Map(input.people.map((p) => [p.id, p]));
  const trips = new Map(input.trips.map((t) => [t.id, t]));
  const vehicles = new Map(input.vehicles.map((v) => [v.id, v]));
  const seen = new Map<string, TransportAssignment>();
  const occupancy = new Map<string, number>();
  const usage = new Map<string, Set<string>>();
  const addSeat = (vehicleId: string, tripId: string, count: number) => {
    const v = vehicles.get(vehicleId);
    if (!v || !trips.has(tripId)) { errors.push("존재하지 않는 차량·이동편입니다."); return; }
    if (!v.enabled || !v.tripIds.includes(tripId)) errors.push(`${v.label}: 가용하지 않은 이동편입니다.`);
    const k = key(vehicleId, tripId);
    occupancy.set(k, (occupancy.get(k) ?? 0) + count);
    const set = usage.get(vehicleId) ?? new Set<string>(); set.add(tripId); usage.set(vehicleId, set);
  };
  for (const a of result.assignments) {
    if (!a || !people.has(a.personId) || !trips.has(a.tripId) || tripFor(people.get(a.personId)!, trips.get(a.tripId)!.direction) !== a.tripId) { errors.push("배정 명단의 참가자·이동편을 확인해 주세요."); continue; }
    const k = key(a.personId, a.tripId);
    if (seen.has(k)) errors.push("배정 명단에 중복이 있습니다.");
    seen.set(k, a);
    if (a.vehicleId === null) errors.push("미배정 인원이 있습니다.");
    else addSeat(a.vehicleId, a.tripId, 1);
  }
  for (const p of input.people) for (const dir of ["outbound", "return"] as const) {
    const trip = tripFor(p, dir);
    if (trip && !seen.has(key(p.id, trip))) errors.push("배정 명단에 누락이 있습니다.");
  }
  for (const a of input.locks) if (seen.get(key(a.personId, a.tripId))?.vehicleId !== a.vehicleId) errors.push("담당자 잠금 배정이 변경되었습니다.");
  for (const t of input.trips) {
    const grouped = new Map<string, Set<string | null>>();
    for (const p of input.people.filter((p) => companionFor(p, t.direction) && tripFor(p, t.direction) === t.id)) {
      const group = companionFor(p, t.direction);
      const set = grouped.get(group) ?? new Set<string | null>();
      set.add(seen.get(key(p.id, t.id))?.vehicleId ?? null); grouped.set(group, set);
    }
    if ([...grouped.values()].some((g) => g.size > 1)) errors.push("필수 동반 묶음이 분리되었습니다.");
  }
  const reserveCounts = new Map<string, number>();
  const reserveKeys = new Set<string>();
  for (const r of result.reservations) {
    if (!r || typeof r.vehicleId !== "string" || typeof r.tripId !== "string") { errors.push("가상 좌석 확보표가 올바르지 않습니다."); continue; }
    const k = key(r.vehicleId, r.tripId);
    if (!integer(r.count, 1, 50) || ![input.extraOutboundTripId, input.extraReturnTripId].includes(r.tripId) || reserveKeys.has(k)) { errors.push("가상 좌석 확보표가 올바르지 않습니다."); continue; }
    reserveKeys.add(k); reserveCounts.set(r.tripId, (reserveCounts.get(r.tripId) ?? 0) + r.count); addSeat(r.vehicleId, r.tripId, r.count);
  }
  for (const id of [input.extraOutboundTripId, input.extraReturnTripId]) if ((reserveCounts.get(id) ?? 0) !== input.extraCount) errors.push("가상 추가 인원의 좌석이 부족하거나 중복됩니다.");
  for (const [vehicleId, tripIds] of usage) {
    const v = vehicles.get(vehicleId)!;
    for (const t of tripIds) {
      if ((occupancy.get(key(vehicleId, t)) ?? 0) > v.capacity) errors.push(`${v.label}: 정원 초과입니다.`);
      if (v.driverId && seen.get(key(v.driverId, t))?.vehicleId !== vehicleId) errors.push(`${v.label}: 운전자가 해당 차량에 배정되지 않았습니다.`);
      if (v.driverId === null && !v.externalDriverConfirmed) errors.push(`${v.label}: 외부 운전자가 미확정입니다.`);
    }
    for (const dir of ["outbound", "return"] as const) if ([...tripIds].filter((id) => trips.get(id)?.direction === dir).length > 1) errors.push(`${v.label}: 같은 방향의 여러 이동편에 중복 운행됩니다.`);
    const intervals = [...tripIds].map((id) => trips.get(id)!);
    for (const [index, a] of intervals.entries()) for (const b of intervals.slice(index + 1)) {
      const conflict = tripReuseConflict(a, b, true);
      if (conflict === "overlap") errors.push(`${v.label}: 운행 시간이 겹칩니다.`);
      if (conflict === "time-unknown") errors.push(`${v.label}: 여러 이동편의 운행 시각을 확인해 주세요.`);
      if (conflict === "location") errors.push(`${v.label}: 이전 도착 장소와 다음 출발 장소가 다릅니다.`);
    }
  }
  const drivers = input.vehicles.filter((v) => v.driverId && usage.has(v.id));
  for (const a of drivers) for (const b of drivers) if (a.id < b.id && a.driverId === b.driverId) {
    for (const ta of usage.get(a.id)!) for (const tb of usage.get(b.id)!) {
      const x = trips.get(ta)!; const y = trips.get(tb)!;
      const conflict = tripReuseConflict(x, y, false);
      if (conflict === "overlap") errors.push("운전자가 동시 운행 차량에 중복 배정되었습니다.");
      if (conflict === "time-unknown") errors.push("같은 운전자의 여러 운행 시각을 확인해 주세요.");
    }
  }
  const actualMissing = input.people.reduce((n, p) => n + (["outbound", "return"] as const).filter((d) => { const tid = tripFor(p, d); return tid && !seen.get(key(p.id, tid))?.vehicleId; }).length, 0);
  const reserveMissing = [input.extraOutboundTripId, input.extraReturnTripId].reduce((n, tid) => n + Math.max(0, input.extraCount - (reserveCounts.get(tid) ?? 0)), 0);
  const cost = input.vehicles.filter((v) => v.rental && usage.has(v.id)).reduce((n, v) => n + v.rentalCost, 0);
  if (result.unassignedCount !== actualMissing || result.unreservedCount !== reserveMissing || result.cost !== cost || [...usage.keys()].sort().join("|") !== [...result.usedVehicleIds].sort().join("|")) errors.push("계산 결과의 인원·차량·비용 요약이 명단과 다릅니다.");
  return [...new Set(errors)];
}

function csvRows(rows: unknown[][]): string {
  const cell = (raw: unknown) => {
    let text = String(raw ?? "");
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(",")).join("\r\n")}`;
}

export function transportRosterCsv(input: TransportInput): string {
  return csvRows([["참석 여부", "이름", "소속", "가족ID", "출발", "귀가", "출발 필수 동반", "귀가 필수 동반", "이동수단", "숙소 배정", "기타 특이사항"],
    ...sortTransportRoster(input.people).map((person) => ["O", person.name, person.department, person.familyId,
      personTripLabel(input.trips, person, "outbound"), personTripLabel(input.trips, person, "return"),
      companionFor(person, "outbound"), companionFor(person, "return"), person.movement, person.lodging, person.notes])]);
}

export function transportCsv(input: TransportInput, result: TransportResult, direction: Direction, approved: boolean, filter = "all"): string {
  if (!approved) throw new Error("담당자 승인이 필요합니다.");
  const errors = validateTransportResult(input, result);
  if (errors.length) throw new Error(errors.join(" "));
  return transportWorkingCsv(input, result, direction, "확정", input.revision, filter);
}

export function transportWorkingCsv(input: TransportInput, result: TransportResult, direction: Direction, plan: "초안" | "최적화안" | "확정", version: number, filter = "all"): string {
  if (result.revision !== input.revision) throw new Error("조회 중인 배정안과 이동 조건의 버전이 다릅니다.");
  const rows: unknown[][] = [["배정버전", "구간", "이동편ID", "이동편", "차량ID", "차량", "참가자ID", "이름", "소속", "가족ID", "상태", "인원 상태"]];
  for (const p of input.people) {
    const tripId = tripFor(p, direction);
    const a = result.assignments.find((a) => a.personId === p.id && a.tripId === tripId);
    if (filter !== "all" && (filter === "independent" ? tripId !== null : a?.vehicleId !== filter)) continue;
    const state = entryFor(p, direction) ? "확인 필요" : !tripId ? "개별 이동" : a?.vehicleId ? "탑승" : "미배정";
    rows.push([version, direction === "outbound" ? "출발" : "귀가", tripId ?? "", input.trips.find((t) => t.id === tripId)?.label ?? state,
      a?.vehicleId ?? "", input.vehicles.find((v) => v.id === a?.vehicleId)?.label ?? state, p.id, p.name, p.department, p.familyId, plan, state]);
  }
  if (rows.length === 1) throw new Error("선택한 범위에 탑승자가 없습니다.");
  return csvRows(rows);
}

export function transportReservationCsv(input: TransportInput, result: TransportResult, approved: boolean): string {
  if (!approved) throw new Error("담당자 승인이 필요합니다.");
  const errors = validateTransportResult(input, result);
  if (errors.length) throw new Error(errors.join(" "));
  return csvRows([["배정버전", "구간", "이동편ID", "이동편", "차량ID", "차량", "가상좌석수"], ...result.reservations.map((r) => {
    const t = input.trips.find((t) => t.id === r.tripId)!;
    return [input.revision, t.direction === "outbound" ? "출발" : "귀가", t.id, t.label, r.vehicleId, input.vehicles.find((v) => v.id === r.vehicleId)!.label, r.count];
  })]);
}

export function moveTransportAssignment(input: TransportInput, result: TransportResult, assignment: TransportAssignment) {
  if (result.revision !== input.revision) throw new Error("입력 변경 후 다시 계산해 주세요.");
  if (input.locks.some((a) => key(a.personId, a.tripId) === key(assignment.personId, assignment.tripId) && a.vehicleId !== assignment.vehicleId)) throw new Error("잠금을 먼저 해제해 주세요.");
  const nextInput = { ...input, revision: input.revision + 1, locks: [...input.locks.filter((a) => key(a.personId, a.tripId) !== key(assignment.personId, assignment.tripId)), assignment] };
  const assignments = result.assignments.map((a) => key(a.personId, a.tripId) === key(assignment.personId, assignment.tripId) ? assignment : a);
  const usedVehicleIds = [...new Set([...assignments.flatMap((a) => a.vehicleId ? [a.vehicleId] : []), ...result.reservations.map((r) => r.vehicleId)])];
  const nextResult: TransportResult = { ...result, revision: nextInput.revision, status: "manual", assignments, usedVehicleIds, unassignedCount: assignments.filter((a) => a.vehicleId === null).length, cost: input.vehicles.filter((v) => v.rental && usedVehicleIds.includes(v.id)).reduce((n, v) => n + v.rentalCost, 0), message: "담당자 변경안" };
  return { input: nextInput, result: nextResult };
}

const defaultTransportTrips = (): TransportTrip[] => [
    { id: "advance", label: "선발대", direction: "outbound", start: 480, end: 600 },
    { id: "main", label: "본대", direction: "outbound", start: 600, end: 720 },
    { id: "late", label: "후발대", direction: "outbound", start: 750, end: 870 },
    { id: "other", label: "기타", direction: "outbound", start: 900, end: 1020 },
    { id: "early", label: "사전 귀가", direction: "return", start: 1800, end: 1920 },
    { id: "normal", label: "정상 귀가", direction: "return", start: 1980, end: 2100 },
];

export function createTransportDraft(): TransportInput {
  return { revision: 1, objective: "institution", extraCount: 0, extraOutboundTripId: "main", extraReturnTripId: "normal", people: [], vehicles: [], trips: defaultTransportTrips(), locks: [], previousAssignments: [] };
}

export function createTransportDemo(): TransportInput {
  const pid = (n: number) => `P${String(n).padStart(3, "0")}`;
  const people: TransportPerson[] = Array.from({ length: 150 }, (_, i) => ({ id: pid(i + 1), name: `가상참가자 ${String(i + 1).padStart(3, "0")}`, department: i < 80 ? (i % 4 < 2 ? "장년부" : i % 4 === 2 ? "청소년부" : "유초등부") : i < 115 ? "청년부" : "장년부", familyId: i < 80 ? `F${Math.floor(i / 4) + 1}` : "", companionGroup: "", outboundTripId: i >= 145 ? null : ((i < 16 && i % 4 >= 2) || i === 1 || (i >= 80 && i < 85)) ? "advance" : "main", returnTripId: i >= 85 && i < 95 ? "early" : "normal" }));
  const vehicles: TransportVehicle[] = [
    { id: "church-van", label: "교회 스타렉스", capacity: 12, driverId: pid(2), rental: false, rentalCost: 0, enabled: true, tripIds: ["advance", "normal"] },
    { id: "church-carnival", label: "교회 카니발", capacity: 9, driverId: pid(1), rental: false, rentalCost: 0, enabled: true, tripIds: ["main", "normal"] },
    ...Array.from({ length: 15 }, (_, i): TransportVehicle => ({ id: `car-${i + 1}`, label: `승용차 ${i + 1}`, capacity: 4, driverId: pid(81 + i), rental: false, rentalCost: 0, enabled: true, tripIds: [i < 5 ? "advance" : "main", i >= 5 ? "early" : "normal"] })),
    ...[18, 28, 44, 44].map((capacity, i): TransportVehicle => ({ id: `bus-${i + 1}`, label: `대여 후보 ${capacity}석${i === 3 ? " B" : ""}`, capacity, driverId: null, externalDriverConfirmed: true, rental: true, rentalCost: [300000, 450000, 650000, 650000][i], enabled: true, tripIds: ["main", "normal"] })),
  ];
  return { ...createTransportDraft(), people, vehicles };
}
