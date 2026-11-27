import type { Direction, TransportAssignment, TransportInput } from "./transport";

const directions = ["outbound", "return"] as const;

const directionSurveyFields = (label: string) => ({
  method: label + " 이동수단",
  providesVehicle: label + " 차량 제공 여부",
  riderNames: label + " 기존 동승자 이름",
  providerName: label + " 차량 제공자 이름",
  extraSeats: label + " 추가 탑승 가능 인원",
  other: label + " 기타 이동 방법",
});

export const directionalSurveyFields = {
  outbound: directionSurveyFields("출발"),
  return: directionSurveyFields("귀가"),
} as const;

export const directionalSurveyChoices = {
  self: "자차 이동",
  group: "단체 이동",
  family: "가족 차량 동승",
  participant: "다른 참가자와 차량 동승",
  other: "기타",
  sameAsOutbound: "출발할 때와 동일",
  undecided: "미정",
  providerYes: "예, 제가 차량을 제공합니다.",
  providerNo: "아니요, 다른 사람의 차량에 탑승합니다.",
} as const;

type SurveyField = keyof ReturnType<typeof directionSurveyFields>;
type LegSurveyAnswers = Partial<Record<SurveyField, string>>;
export type DirectionalSurveyAnswers = Partial<Record<Direction, LegSurveyAnswers>>;
type DirectionalColumns = Record<Direction, Partial<Record<SurveyField, number[]>>>;
export type DirectionalSurveyMapping = Record<Direction, Record<SurveyField, number>> & { branchColumns: DirectionalColumns };

export function mapDirectionalSurveyHeaders(headers: readonly string[]): DirectionalSurveyMapping {
  const branchColumns: DirectionalColumns = { outbound: {}, return: {} };
  const map = (direction: Direction) => Object.fromEntries(Object.entries(directionalSurveyFields[direction]).map(([key, title]) => {
    const matches = headers.flatMap((header, index) => header === title ? [index] : []);
    if (matches.length > 1) branchColumns[direction][key as SurveyField] = matches;
    return [key, matches.length === 1 ? matches[0] : -1];
  })) as Record<SurveyField, number>;
  return { outbound: map("outbound"), return: map("return"), branchColumns };
}

type SharedMethod = "family" | "participant";
type ExtraSeatReport =
  | { kind: "reported"; seats: number }
  | { kind: "missing" }
  | { kind: "invalid"; answer: string };

export type TransportMovement =
  | { kind: "provider"; method: "self" | SharedMethod; riderNames: readonly string[]; extraSeats: ExtraSeatReport }
  | { kind: "rider"; method: SharedMethod; providerName: string }
  | { kind: "group" }
  | { kind: "independent"; method: "train" | "separate" }
  | { kind: "pickup"; method: "train" | "unspecified" }
  | { kind: "undecided" }
  | { kind: "unknown"; reason: "missing_method" | "unrecognized_method" | "missing_provider_choice" | "missing_provider_name" | "unclassified_other" | "conflicting_survey_answers"; answer: string };

export type DirectionalTransportMovement = Readonly<Record<Direction, TransportMovement>>;

export function isDirectionalTransportMovement(value: unknown): value is DirectionalTransportMovement {
  const text = (v: unknown) => typeof v === "string" && v.length <= 4_000 && !v.includes("\0");
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as DirectionalTransportMovement;
  return directions.every(direction => {
    const leg = plan[direction];
    if (!leg || typeof leg !== "object") return false;
    switch (leg.kind) {
      case "provider": return ["family", "participant", "self"].includes(leg.method)
        && Array.isArray(leg.riderNames) && leg.riderNames.length <= 250 && leg.riderNames.every(text)
        && Boolean(leg.extraSeats && (leg.extraSeats.kind === "missing" || (leg.extraSeats.kind === "reported" ? Number.isSafeInteger(leg.extraSeats.seats) && leg.extraSeats.seats >= 0 : leg.extraSeats.kind === "invalid" && text(leg.extraSeats.answer))));
      case "rider": return ["family", "participant"].includes(leg.method) && text(leg.providerName);
      case "independent": return ["train", "separate"].includes(leg.method);
      case "pickup": return ["train", "unspecified"].includes(leg.method);
      case "unknown": return ["missing_method", "unrecognized_method", "missing_provider_choice", "missing_provider_name", "unclassified_other", "conflicting_survey_answers"].includes(leg.reason) && text(leg.answer);
      case "group": case "undecided": return true;
      default: return false;
    }
  });
}

const exactText = (value = "") => value.normalize("NFC").trim();

function extraSeatReport(value?: string): ExtraSeatReport {
  const answer = exactText(value);
  if (!answer) return { kind: "missing" };
  const seats = Number(answer);
  return /^[0-9]+$/.test(answer) && Number.isSafeInteger(seats)
    ? { kind: "reported", seats }
    : { kind: "invalid", answer };
}

function parseLeg(answers: LegSurveyAnswers = {}): TransportMovement {
  const method = exactText(answers.method);
  const choices = directionalSurveyChoices;
  const provider = (method: "self" | SharedMethod): TransportMovement => ({
    kind: "provider", method, extraSeats: extraSeatReport(answers.extraSeats),
    riderNames: [...new Set((answers.riderNames ?? "").split(/[,\r\n]/).map(exactText).filter(Boolean))],
  });
  switch (method) {
    case choices.self: return provider("self");
    case choices.family:
    case choices.participant: {
      const sharedMethod = method === choices.family ? "family" : "participant";
      const choice = exactText(answers.providesVehicle);
      const providerName = exactText(answers.providerName);
      if (choice === choices.providerYes) return provider(sharedMethod);
      if (choice !== choices.providerNo) return { kind: "unknown", reason: "missing_provider_choice", answer: choice };
      if (!providerName) return { kind: "unknown", reason: "missing_provider_name", answer: providerName };
      return { kind: "rider", method: sharedMethod, providerName };
    }
    case choices.group: return { kind: "group" };
    case choices.undecided: return { kind: "undecided" };
    case choices.other: {
      const answer = exactText(answers.other);
      // Free text outside these explicit descriptions requires review, not keyword inference.
      switch (answer) {
        case "기차":
        case "기차 이동": return { kind: "independent", method: "train" };
        case "개별 이동": return { kind: "independent", method: "separate" };
        case "역 픽업": return { kind: "pickup", method: "unspecified" };
        case "기차 후 역 픽업":
        case "기차 + 역 픽업": return { kind: "pickup", method: "train" };
        case "미정":
        case "이동수단 미정": return { kind: "undecided" };
        default: return { kind: "unknown", reason: "unclassified_other", answer };
      }
    }
    default: return { kind: "unknown", reason: method ? "unrecognized_method" : "missing_method", answer: method };
  }
}

export function parseDirectionalSurveyMovement(answers: DirectionalSurveyAnswers): DirectionalTransportMovement {
  const returnAnswers = exactText(answers.return?.method) === directionalSurveyChoices.sameAsOutbound
    ? answers.outbound : answers.return;
  return { outbound: parseLeg(answers.outbound), return: parseLeg(returnAnswers) };
}

export function readDirectionalSurveyMovement(cells: readonly string[], mapping: DirectionalSurveyMapping): DirectionalTransportMovement {
  const read = (direction: Direction) => {
    const answers: LegSurveyAnswers = {};
    const conflicts = new Set<SurveyField>();
    for (const field of Object.keys(directionalSurveyFields[direction]) as SurveyField[]) {
      const columns = mapping.branchColumns[direction][field] ?? [mapping[direction][field]];
      const values = [...new Set(columns.map((index) => exactText(cells[index])).filter(Boolean))];
      if (values.length > 1) conflicts.add(field);
      else answers[field] = values[0];
    }
    const { method, providesVehicle } = answers;
    const { self, family, participant, other, providerYes, providerNo } = directionalSurveyChoices;
    const activeFields: SurveyField[] = ["method"];
    if (method === self) activeFields.push("extraSeats", "riderNames");
    if (method === family || method === participant) {
      activeFields.push("providesVehicle");
      if (providesVehicle === providerYes) activeFields.push("extraSeats", "riderNames");
      if (providesVehicle === providerNo) activeFields.push("providerName");
    }
    if (method === other) activeFields.push("other");
    return { answers, conflict: activeFields.find((field) => conflicts.has(field)) };
  };
  const outbound = read("outbound");
  const returning = read("return");
  const parse = (direction: Direction, { answers, conflict }: ReturnType<typeof read>): TransportMovement => conflict
    ? { kind: "unknown", reason: "conflicting_survey_answers", answer: directionalSurveyFields[direction][conflict] }
    : parseLeg(answers);
  return {
    outbound: parse("outbound", outbound),
    return: returning.answers.method === directionalSurveyChoices.sameAsOutbound && !returning.conflict
      ? parse("outbound", outbound) : parse("return", returning),
  };
}

type CapacityConflict = "invalid_total_seats" | "invalid_reported_seats" | "occupancy_exceeds_capacity" | "reported_seats_exceed_capacity" | "added_riders_exceed_report";

const distinct = (values: readonly string[]) => [...new Set(values)].sort();
const validSeatCount = (count: number, minimum: number) => Number.isSafeInteger(count) && count >= minimum;

export function projectMovementCapacity(input: {
  totalSeats: number | null;
  existingPersonIds: readonly string[];
  reportedExtraSeats: number | null;
  addedPersonIds?: readonly string[];
}) {
  const conflicts: CapacityConflict[] = [];
  let { totalSeats, reportedExtraSeats } = input;
  if (totalSeats !== null && !validSeatCount(totalSeats, 1)) {
    conflicts.push("invalid_total_seats");
    totalSeats = null;
  }
  if (reportedExtraSeats !== null && !validSeatCount(reportedExtraSeats, 0)) {
    conflicts.push("invalid_reported_seats");
    reportedExtraSeats = null;
  }
  const existingPersonIds = distinct(input.existingPersonIds);
  const existing = new Set(existingPersonIds);
  const addedPersonIds = distinct(input.addedPersonIds ?? []).filter((id) => !existing.has(id));
  const physicalBefore = totalSeats === null ? null : totalSeats - existing.size;
  const physicalAfter = physicalBefore === null ? null : physicalBefore - addedPersonIds.length;
  const reportedAfter = reportedExtraSeats === null ? null : reportedExtraSeats - addedPersonIds.length;
  if (physicalAfter !== null && physicalAfter < 0) conflicts.push("occupancy_exceeds_capacity");
  if (reportedExtraSeats !== null && physicalBefore !== null && reportedExtraSeats > physicalBefore) conflicts.push("reported_seats_exceed_capacity");
  if (reportedAfter !== null && reportedAfter < 0) conflicts.push("added_riders_exceed_report");
  return {
    totalSeats, existingPersonIds, addedPersonIds, reportedExtraSeats,
    physicalFreeSeats: physicalAfter === null ? null : Math.max(0, physicalAfter),
    remainingExtraSeats: reportedAfter === null ? null : Math.max(0, reportedAfter),
    allocatableExtraSeats: !conflicts.length && physicalAfter !== null ? reportedAfter : null,
    conflicts,
  };
}

export type MovementParticipant = {
  id: string;
  name: string;
  attendance: "attending" | "absent" | "unresolved";
  familyId?: string | null;
  movement?: DirectionalTransportMovement;
};

type MovementCondition = "joint" | "individual" | "partial" | "unknown";
type AssignmentNeed = "none" | "group" | "pickup" | "undecided" | "review";
type ParticipantLeg = { movement: TransportMovement; condition: MovementCondition; assignmentNeed: AssignmentNeed; vehicleId: string | null };
type VehicleLeg = ReturnType<typeof projectMovementCapacity>;
type SurveyVehicle = { id: string; providerId: string; legs: Partial<Record<Direction, VehicleLeg>> };
type VehicleFacts = { totalSeats?: number; operates?: Partial<Record<Direction, boolean>> };

export type TransportMovementConflict =
  | { kind: "duplicate_participant"; personId: string }
  | { kind: "ambiguous_provider" | "missing_provider" | "provider_not_operating"; direction: Direction; personId: string; providerName: string; candidatePersonIds: string[] }
  | { kind: "unacknowledged_rider"; direction: Direction; personId: string; vehicleId: string }
  | { kind: "unknown_rider" | "ambiguous_rider"; direction: Direction; vehicleId: string; riderName: string; candidatePersonIds: string[] }
  | { kind: "conflicting_rider_claim"; direction: Direction; personId: string; vehicleIds: string[] }
  | { kind: CapacityConflict | "vehicle_not_operating" | "missing_extra_seats" | "invalid_extra_seats"; direction: Direction; vehicleId: string };

type Offer = { vehicleId: string; extraSeats: ExtraSeatReport; riderNames: readonly string[]; existing: Set<string>; blocked: boolean };
type ProjectedParticipant = { id: string; name: string; familyId: string | null; legs: Record<Direction, ParticipantLeg> };
type Roster = ReadonlyMap<string, MovementParticipant>;

function movementKey(movement: TransportMovement | undefined): readonly unknown[] | null {
  if (!movement) return null;
  switch (movement.kind) {
    case "provider": {
      const { extraSeats, method, riderNames } = movement;
      const report = extraSeats.kind === "reported" ? extraSeats.seats : extraSeats.kind === "invalid" ? extraSeats.answer : null;
      return [movement.kind, method, riderNames, extraSeats.kind, report];
    }
    case "rider": return [movement.kind, movement.method, movement.providerName];
    case "pickup":
    case "independent": return [movement.kind, movement.method];
    case "unknown": return [movement.kind, movement.reason, movement.answer];
    default: return [movement.kind];
  }
}

function personSnapshot({ name, attendance, familyId, movement }: MovementParticipant): string {
  return JSON.stringify([name, attendance, familyId ?? null, ...directions.map((direction) => movementKey(movement?.[direction]))]);
}

function participantLeg(movement: TransportMovement): ParticipantLeg {
  const base = { movement, vehicleId: null };
  switch (movement.kind) {
    case "provider": return { ...base, condition: movement.method === "self" && !movement.riderNames.length ? "individual" : "joint", assignmentNeed: "none" };
    case "rider": return { ...base, condition: "joint", assignmentNeed: "review" };
    case "group": return { ...base, condition: "joint", assignmentNeed: "group" };
    case "independent": return { ...base, condition: "individual", assignmentNeed: "none" };
    case "pickup": return { ...base, condition: "partial", assignmentNeed: "pickup" };
    case "undecided": return { ...base, condition: "unknown", assignmentNeed: "undecided" };
    case "unknown": return { ...base, condition: "unknown", assignmentNeed: "review" };
  }
}

function namedRiderClaims(
  direction: Direction,
  roster: Roster,
  offers: Map<string, Offer>,
  names: ReadonlyMap<string, string[]>,
  conflicts: TransportMovementConflict[],
) {
  const claims = new Map<string, Offer[]>();
  for (const [providerId, offer] of offers) {
    for (const riderName of distinct(offer.riderNames.map(exactText).filter(Boolean))) {
      const candidatePersonIds = names.get(riderName) ?? [];
      if (candidatePersonIds.length !== 1 || !roster.has(candidatePersonIds[0])) {
        offer.blocked = true;
        conflicts.push({
          kind: candidatePersonIds.length > 1 ? "ambiguous_rider" : "unknown_rider",
          direction, vehicleId: offer.vehicleId, riderName, candidatePersonIds,
        });
      } else {
        const [riderId] = candidatePersonIds;
        if (riderId !== providerId) claims.set(riderId, [...(claims.get(riderId) ?? []), offer]);
      }
    }
  }
  return claims;
}

function projectDirectionalLinks(
  direction: Direction,
  roster: Roster,
  participants: readonly ProjectedParticipant[],
  names: ReadonlyMap<string, string[]>,
  offers: Map<string, Offer>,
  conflicts: TransportMovementConflict[],
) {
  const claims = namedRiderClaims(direction, roster, offers, names, conflicts);
  for (const person of participants) {
    const { id, legs } = person;
    const leg = legs[direction];
    const { movement } = leg;
    const namedBy = claims.get(id) ?? [];
    const own = offers.get(id);
    let riderOffer: Offer | undefined;
    if (movement.kind === "rider") {
      const { providerName } = movement;
      const candidatePersonIds = names.get(exactText(providerName)) ?? [];
      const [candidate] = candidatePersonIds;
      riderOffer = candidatePersonIds.length === 1 ? offers.get(candidate) : undefined;
      if (!riderOffer) {
        for (const candidateId of candidatePersonIds) {
          const offer = offers.get(candidateId);
          if (offer) offer.blocked = true;
        }
        const otherDirection = direction === "outbound" ? "return" : "outbound";
        const kind = candidatePersonIds.length > 1 ? "ambiguous_provider"
          : roster.get(candidate)?.movement?.[otherDirection].kind === "provider" ? "provider_not_operating"
          : "missing_provider";
        conflicts.push({ kind, direction, personId: id, providerName, candidatePersonIds });
      } else if (!namedBy.includes(riderOffer)) {
        riderOffer.blocked = true;
        conflicts.push({ kind: "unacknowledged_rider", direction, personId: id, vehicleId: riderOffer.vehicleId });
      }
    }

    const [namedOffer] = namedBy;
    if (namedBy.length > 1 || (namedOffer && movement.kind !== "unknown" && namedOffer !== riderOffer)) {
      const affectedOffers = [...namedBy, ...(own ? [own] : []), ...(riderOffer ? [riderOffer] : [])];
      for (const offer of affectedOffers) offer.blocked = true;
      leg.assignmentNeed = "review";
      conflicts.push({ kind: "conflicting_rider_claim", direction, personId: id, vehicleIds: distinct(affectedOffers.map(({ vehicleId }) => vehicleId)) });
      continue;
    }

    const linked = own ?? namedOffer;
    if (linked) {
      linked.existing.add(id);
      leg.vehicleId = linked.vehicleId;
      leg.assignmentNeed = "none";
      if (!own) leg.condition = "joint";
    }
  }
}

function projectVehicleLeg(direction: Direction, offer: Offer, facts: VehicleFacts | undefined, conflicts: TransportMovementConflict[]): VehicleLeg {
  const { vehicleId, existing, extraSeats } = offer;
  const capacity = projectMovementCapacity({
    totalSeats: facts?.totalSeats ?? null,
    existingPersonIds: [...existing],
    reportedExtraSeats: extraSeats.kind === "reported" ? extraSeats.seats : null,
  });
  const operating = facts?.operates?.[direction] !== false;
  if (!operating) conflicts.push({ kind: "vehicle_not_operating", direction, vehicleId });
  if (extraSeats.kind !== "reported") conflicts.push({ kind: extraSeats.kind === "missing" ? "missing_extra_seats" : "invalid_extra_seats", direction, vehicleId });
  for (const kind of capacity.conflicts) conflicts.push({ kind, direction, vehicleId });
  return { ...capacity, allocatableExtraSeats: offer.blocked || !operating ? null : capacity.allocatableExtraSeats };
}

export function projectTransportMovement(
  people: readonly MovementParticipant[],
  { vehicleFacts }: { vehicleFacts?: ReadonlyMap<string, VehicleFacts> } = {},
) {
  const conflicts: TransportMovementConflict[] = [];
  const excludedPersonIds: string[] = [];
  const submissions = new Map<string, MovementParticipant[]>();
  for (const person of people) submissions.set(person.id, [...(submissions.get(person.id) ?? []), person]);
  const roster = new Map<string, MovementParticipant>();
  const names = new Map<string, string[]>();
  for (const id of [...submissions.keys()].sort()) {
    const versions = submissions.get(id)!;
    const [person] = versions;
    const conflicting = versions.length > 1 && new Set(versions.map(personSnapshot)).size > 1;
    // Quarantined attendees still make a name ambiguous; they cannot receive a link.
    for (const name of distinct(versions.filter((row) => row.attendance === "attending").map((row) => exactText(row.name)).filter(Boolean))) {
      names.set(name, [...(names.get(name) ?? []), id]);
    }
    if (conflicting || person.attendance !== "attending") {
      if (conflicting) conflicts.push({ kind: "duplicate_participant", personId: id });
      excludedPersonIds.push(id);
      continue;
    }
    roster.set(id, person);
  }

  const noSurveyMovement = parseDirectionalSurveyMovement({});
  const participants: ProjectedParticipant[] = [...roster.values()].map(({ id, name, familyId, movement = noSurveyMovement }) => ({
    id, name, familyId: familyId ?? null,
    legs: { outbound: participantLeg(movement.outbound), return: participantLeg(movement.return) },
  }));
  const vehicles = new Map<string, SurveyVehicle>();
  for (const direction of directions) {
    const offers = new Map<string, Offer>();
    for (const { id, legs } of participants) {
      const { movement } = legs[direction];
      if (movement.kind !== "provider") continue;
      // An event-scoped projection key, not a legacy solver or persistence ID.
      const vehicle = vehicles.get(id) ?? { id: "survey-car:" + id, providerId: id, legs: {} };
      vehicles.set(id, vehicle);
      offers.set(id, { vehicleId: vehicle.id, riderNames: movement.riderNames, extraSeats: movement.extraSeats, existing: new Set([id]), blocked: false });
    }
    projectDirectionalLinks(direction, roster, participants, names, offers, conflicts);
    for (const [id, offer] of offers) {
      vehicles.get(id)!.legs[direction] = projectVehicleLeg(direction, offer, vehicleFacts?.get(id), conflicts);
    }
  }
  return { participants, excludedPersonIds, vehicles: [...vehicles.keys()].sort().map((id) => vehicles.get(id)!), conflicts };
}

export function reviewTransportOffers(input: TransportInput) {
  const roster = input.people.map(person => ({ id: person.id, name: person.name, attendance: "attending" as const, movement: person.movementPlan }));
  const vehiclesFor = (providerId: string) => input.vehicles.filter(v => v.driverId === providerId && v.enabled && !v.rental && v.source !== "church");
  const facts = new Map(input.people.flatMap(person => {
    const matches = vehiclesFor(person.id);
    if (matches.length !== 1) return [];
    const [vehicle] = matches;
    return [[person.id, { totalSeats: vehicle.totalSeats || undefined, operates: Object.fromEntries(directions.map(direction => [direction, input.trips.some(trip => trip.direction === direction && vehicle.tripIds.includes(trip.id))])) }] as const];
  }));
  const projected = projectTransportMovement(roster, { vehicleFacts: facts });
  return projected.vehicles.map(offer => {
    const [vehicle] = vehiclesFor(offer.providerId);
    let reason = !vehicle || vehiclesFor(offer.providerId).length !== 1 ? "이 제공자를 운전자로 지정한 개인 차량 1대가 필요합니다." : "";
    const fixed: TransportAssignment[] = [];
    const caps: number[] = [];
    for (const direction of directions) {
      const leg = offer.legs[direction];
      if (!leg) continue;
      const groups = input.trips.filter(trip => trip.direction === direction && vehicle?.tripIds.includes(trip.id));
      if (!leg || !vehicle || groups.length !== 1 || leg.allocatableExtraSeats === null) {
        reason ||= "이동편, 동승 관계, 총 좌석 및 신고한 추가 좌석을 확인해 주세요."; continue;
      }
      const tripId = groups[0].id;
      const smallestCap = leg.existingPersonIds.length;
      caps.push(smallestCap + leg.allocatableExtraSeats);
      for (const personId of leg.existingPersonIds) {
        const person = input.people.find(person => person.id === personId)!;
        const preferred = direction === "outbound" ? person.outboundTripId : person.returnTripId;
        if ((preferred && preferred !== tripId) || input.locks.some(lock => lock.personId === personId && lock.tripId === tripId && lock.vehicleId !== vehicle.id)) {
          reason ||= "이미 지정한 참가자 이동편 또는 잠금이 동승 약속과 다릅니다.";
        }
        fixed.push({ personId, tripId, vehicleId: vehicle.id });
      }
    }
    if (vehicle && input.trips.some(trip => vehicle.tripIds.includes(trip.id) && !offer.legs[trip.direction])) reason ||= "설문에서 제공하지 않은 방향의 운행 설정은 따로 확인해 주세요.";
    const capacity = Math.min(...caps, vehicle?.capacity || Infinity);
    if (offer.legs.outbound && capacity < offer.legs.outbound.existingPersonIds.length || offer.legs.return && capacity < offer.legs.return.existingPersonIds.length) reason ||= "이미 약속한 동승 인원보다 배정 가능 좌석이 부족합니다.";
    const alreadyApplied = fixed.length > 0 && fixed.every(row => input.locks.some(lock => lock.personId === row.personId && lock.tripId === row.tripId && lock.vehicleId === row.vehicleId));
    return { ...offer, vehicle, reason, fixed, capacity, alreadyApplied, providerName: input.people.find(person => person.id === offer.providerId)?.name ?? "제공자 미확인",
      conflictCount: projected.conflicts.filter(conflict => "vehicleId" in conflict ? conflict.vehicleId === offer.id : "vehicleIds" in conflict && conflict.vehicleIds.includes(offer.id)).length };
  });
}

export function applyTransportOffer(input: TransportInput, providerId: string): TransportInput {
  const offer = reviewTransportOffers(input).find(item => item.providerId === providerId);
  if (!offer || offer.reason || !offer.vehicle || !offer.fixed.length || offer.alreadyApplied) return input;
  const vehicleId = offer.vehicle.id;
  return { ...input, vehicles: input.vehicles.map(vehicle => vehicle.id === vehicleId ? { ...vehicle, capacity: offer.capacity } : vehicle),
    locks: [...input.locks, ...offer.fixed.filter(row => !input.locks.some(lock => lock.personId === row.personId && lock.tripId === row.tripId))],
    people: input.people.map(person => {
      const outbound = offer.fixed.find(row => row.personId === person.id && input.trips.some(trip => trip.id === row.tripId && trip.direction === "outbound"));
      const home = offer.fixed.find(row => row.personId === person.id && input.trips.some(trip => trip.id === row.tripId && trip.direction === "return"));
      return outbound || home ? { ...person, ...(outbound && { outboundTripId: outbound.tripId, outboundEntry: undefined }), ...(home && { returnTripId: home.tripId, returnEntry: undefined }) } : person;
    }), previousAssignments: [],
  };
}
