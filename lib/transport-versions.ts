import { isTransportResult, tripFor, validateTransportInput, validateTransportResult, type TransportInput, type TransportResult } from "./transport";

export type TransportVersion = { version: number; at: string; input: TransportInput; result: TransportResult };
const collections = ["drafts", "saved", "confirmed"] as const;
export type TransportVersionKind = typeof collections[number];
export type TransportVersionLedger = Record<TransportVersionKind, TransportVersion[]>;
const versionLimit = 20;
const blank = (): TransportVersionLedger => ({ drafts: [], saved: [], confirmed: [] });
const signature = (value: unknown) => JSON.stringify(value);

export function buildTransportDraft(input: TransportInput): TransportResult {
  const assignments = input.people.flatMap(person => (["outbound", "return"] as const).flatMap(direction => {
    const tripId = tripFor(person, direction);
    if (!tripId) return [];
    const locked = input.locks.find(item => item.personId === person.id && item.tripId === tripId);
    const drivers = input.vehicles.filter(vehicle => vehicle.enabled && vehicle.driverId === person.id && vehicle.tripIds.includes(tripId));
    return [{ personId: person.id, tripId, vehicleId: locked ? locked.vehicleId : drivers.length === 1 ? drivers[0].id : null }];
  }));
  const usedVehicleIds = [...new Set(assignments.flatMap(row => row.vehicleId ?? []))];
  return { revision: input.revision, status: "manual", assignments, reservations: [], usedVehicleIds,
    unassignedCount: assignments.filter(row => row.vehicleId === null).length,
    unreservedCount: input.extraCount * 2, cost: input.vehicles.filter(vehicle => vehicle.rental && usedVehicleIds.includes(vehicle.id)).reduce((sum, vehicle) => sum + vehicle.rentalCost, 0),
    message: "계산 전 저장된 운전자와 고정 배정만 포함한 초안입니다." };
}

const versionInput = (input: TransportInput): TransportInput => structuredClone({ ...input,
  people: input.people.map(({ notes, roomAssignment, lodging, ...person }) => person), previousAssignments: [],
});

export function appendTransportVersion(existing: TransportVersionLedger | undefined, kind: TransportVersionKind, input: TransportInput, result: TransportResult, at = new Date().toISOString()): TransportVersionLedger {
  const ledger = existing ?? blank();
  const version = ledger[kind].length + 1;
  if (version > versionLimit) throw new Error("저장할 수 있는 배정 버전 한도에 도달했습니다. 기존 기록은 유지됩니다.");
  if (result.revision !== input.revision) throw new Error("현재 이동 조건으로 다시 계산해 주세요.");
  return { ...ledger, [kind]: [...ledger[kind], { version, at, input: versionInput(input), result: structuredClone(result) }] };
}

export function isTransportVersionLedger(value: unknown): value is TransportVersionLedger {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== collections.length) return false;
  const ledger = value as TransportVersionLedger;
  return collections.every(kind => Array.isArray(ledger[kind]) && ledger[kind].length <= versionLimit && ledger[kind].every((entry, index) =>
    !!entry && entry.version === index + 1 && typeof entry.at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.at) && Number.isFinite(Date.parse(entry.at))
    && validateTransportInput(entry.input, { draft: true }).length === 0 && isTransportResult(entry.result) && entry.result.revision === entry.input.revision
    && (kind !== "drafts" || signature(entry.result) === signature(buildTransportDraft(entry.input)))
    && (kind !== "confirmed" || validateTransportResult(entry.input, entry.result).length === 0)));
}

export function preservesTransportVersions(previous: TransportVersionLedger | undefined, next: TransportVersionLedger | undefined) {
  return !previous || !!next && collections.every(kind => previous[kind].every((entry, index) => signature(entry) === signature(next[kind][index])));
}

export function checkTransportVersionWrite(previous: TransportVersionLedger | undefined, next: TransportVersionLedger | undefined,
  input: TransportInput, result: TransportResult | null, approved: boolean) {
  if (!preservesTransportVersions(previous, next)) return false;
  if (!next) return true;
  // Each write appends at most one entry per collection against the same saved inputs.
  return collections.every(kind => {
    const appended = next[kind].slice(previous?.[kind].length ?? 0);
    if (!appended.length) return true;
    const entry = appended[0];
    const expected = kind === "drafts" ? buildTransportDraft(input) : result;
    return appended.length === 1 && signature(entry.input) === signature(versionInput(input)) && signature(entry.result) === signature(expected)
      && (kind !== "confirmed" || approved);
  });
}
