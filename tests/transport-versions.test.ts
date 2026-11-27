import { describe, expect, it } from "vitest";
import { createTransportDraft, validateTransportResult, type TransportInput, type TransportResult } from "@/lib/transport";
import { buildTransportDraft, appendTransportVersion, isTransportVersionLedger, preservesTransportVersions } from "@/lib/transport-versions";
import { parseTransportSnapshot } from "@/lib/transport-snapshot";

function fixture(): TransportInput {
  const base = createTransportDraft();
  const first = { id: "p1", name: "가상 운전자", department: "검증", familyId: "", companionGroup: "", outboundTripId: "main", returnTripId: "normal" };
  return { ...base, people: [first, { ...first, id: "p2", name: "가상 참가자", returnTripId: null }],
    vehicles: [{ id: "v1", label: "검증 차량", capacity: 4, driverId: "p1", rental: false, rentalCost: 0, enabled: true, tripIds: ["main", "normal"] }] };
}

describe("transport versions", () => {
  it("records known driving assignments but leaves unplaced demands untouched before calculation", () => {
    const plan = buildTransportDraft(fixture());
    expect(plan.assignments).toEqual([
      { personId: "p1", tripId: "main", vehicleId: "v1" }, { personId: "p1", tripId: "normal", vehicleId: "v1" },
      { personId: "p2", tripId: "main", vehicleId: null },
    ]);
    expect(plan.unassignedCount).toBe(1);
  });

  it("does not permit changing, dropping or reordering already committed versions", () => {
    const input = fixture(), result = buildTransportDraft(input);
    const first = appendTransportVersion(undefined, "drafts", input, result, "2026-11-27T00:00:00.000Z");
    input.people[0].name = "수정된 가상 이름";
    const optimised: TransportResult = { ...result, message: "작업 중" };
    const next = appendTransportVersion(first, "saved", input, optimised, "2026-11-27T00:01:00.000Z");
    expect(first.drafts[0].input.people[0].name).toBe("가상 운전자");
    expect(isTransportVersionLedger(next)).toBe(true);
    expect(preservesTransportVersions(first, next)).toBe(true);
    expect(preservesTransportVersions(first, undefined)).toBe(false);
    expect(preservesTransportVersions(first, { ...next, drafts: [{ ...next.drafts[0], result: optimised }] })).toBe(false);
    const loaded = parseTransportSnapshot(JSON.stringify({ input, result, approved: false, versions: next }));
    expect(loaded.versions?.drafts[0].input.people[0].name).toBe("가상 운전자");
  });

  it("does not approve vehicle reuse between two incompatible locations or invent a mandatory time", () => {
    const input = fixture(); input.people.pop();
    const out = input.trips.find(t => t.id === "main")!, home = input.trips.find(t => t.id === "normal")!;
    Object.assign(out, { destination: "가상 숙소 A" }); Object.assign(home, { origin: "가상 집결 B" });
    const result = buildTransportDraft(input);
    expect(validateTransportResult(input, result)).toContain("검증 차량: 이전 도착 장소와 다음 출발 장소가 다릅니다.");
    Object.assign(home, { origin: out.destination, startUnknown: true, mandatoryTime: true });
    expect(validateTransportResult(input, result)).toContain("정상 귀가: 필수 운행 시각을 확인해 주세요.");
  });
});
