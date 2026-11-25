import { describe, expect, it } from "vitest";
import { createTransportDemo, moveTransportAssignment, transportCsv, transportReservationCsv, validateTransportInput, validateTransportResult, type TransportInput, type TransportResult } from "@/lib/transport";

function fixture(): { input: TransportInput; result: TransportResult } {
  const input: TransportInput = {
    revision: 1, objective: "cost", extraCount: 0, extraOutboundTripId: "out", extraReturnTripId: "back", locks: [], previousAssignments: [],
    trips: [{ id: "out", label: "본대", direction: "outbound", start: 600, end: 720 }, { id: "back", label: "정상 귀가", direction: "return", start: 1980, end: 2100 }],
    people: [{ id: "P1", name: "가상1", department: "장년부", familyId: "", companionGroup: "", outboundTripId: "out", returnTripId: "back" }],
    vehicles: [{ id: "V1", label: "교회 차량", capacity: 2, driverId: "P1", rental: false, rentalCost: 0, enabled: true, tripIds: ["out", "back"] }],
  };
  const result: TransportResult = { revision: 1, status: "optimal", assignments: [{ personId: "P1", tripId: "out", vehicleId: "V1" }, { personId: "P1", tripId: "back", vehicleId: "V1" }], reservations: [], unassignedCount: 0, unreservedCount: 0, usedVehicleIds: ["V1"], cost: 0, message: "" };
  return { input, result };
}

describe("transport contract", () => {
  it("creates a fictional 150-person fixture with stable IDs and valid vehicle inputs", () => {
    const input = createTransportDemo();
    expect(input.people).toHaveLength(150);
    expect(new Set(input.people.map((p) => p.id)).size).toBe(150);
    expect(validateTransportInput(input)).toEqual([]);
  });
  it("validates an ordinary complete allocation", () => {
    const { input, result } = fixture();
    expect(validateTransportResult(input, result)).toEqual([]);
  });
  it("preserves legacy vehicle capacities without requiring a recorded total", () => {
    const { input } = fixture();
    expect(validateTransportInput(input, { draft: true })).toEqual([]);
    expect(validateTransportInput(input)).toEqual([]);
    expect(input.vehicles[0].capacity).toBe(2);
  });
  it.each([
    ["unset allocatable seats", { capacity: 0, totalSeats: 5 }],
    ["unset total seats", { capacity: 4, totalSeats: 0 }],
    ["allocatable seats over the total", { capacity: 6, totalSeats: 5 }],
  ])("saves a draft with %s but refuses exact calculation", (_, seats) => {
    const { input, result } = fixture();
    Object.assign(input.vehicles[0], seats);
    expect(validateTransportInput(input, { draft: true })).toEqual([]);
    expect(validateTransportInput(input).join(" ")).toContain("좌석");
    expect(validateTransportResult(input, result).join(" ")).toContain("좌석");
  });
  it("accepts configured allocatable seats below the recorded total", () => {
    const { input, result } = fixture();
    Object.assign(input.vehicles[0], { totalSeats: 5, vehicleType: "car-5" });
    expect(validateTransportResult(input, result)).toEqual([]);
  });
  it("rejects duplicated people and invalid capacities", () => {
    const { input } = fixture(); input.people.push(input.people[0]); input.vehicles[0].capacity = -1;
    expect(validateTransportInput(input).join(" ")).toMatch(/중복/);
    input.people.pop();
    expect(validateTransportInput(input).join(" ")).toMatch(/좌석/);
  });
  it("blocks stale input revisions", () => {
    const { input, result } = fixture(); result.revision = 0;
    expect(validateTransportResult(input, result)).toContain("입력 변경 후 다시 계산해 주세요.");
  });
  it("rejects mandatory companions on different trips", () => {
    const { input } = fixture(); input.people[0].companionGroup = "G1";
    input.trips.push({ id: "advance", label: "선발", direction: "outbound", start: 400, end: 500 });
    input.people.push({ ...input.people[0], id: "P2", outboundTripId: "advance" });
    expect(validateTransportInput(input).join(" ")).toMatch(/동반/);
  });
  it("allows different mandatory companions for outbound and return", () => {
    const { input } = fixture();
    input.people[0] = { ...input.people[0], outboundCompanionGroup: "G1", returnCompanionGroup: "" };
    input.trips.push({ id: "early", label: "사전 귀가", direction: "return", start: 1600, end: 1700 });
    input.people.push({ ...input.people[0], id: "P2", returnTripId: "early" });
    expect(validateTransportInput(input)).toEqual([]);
    input.people[1].outboundTripId = null;
    expect(validateTransportInput(input).join(" ")).toMatch(/동반/);
  });
  it("rejects overlapping virtual roundtrips", () => {
    const { input } = fixture(); input.people[0].returnTripId = null; input.extraCount = 1;
    input.trips[1].start = 650; input.trips[1].end = 800;
    expect(validateTransportInput(input).join(" ")).toMatch(/가상.*시간/);
  });
  it("reconstructs cost, vehicle IDs and missing counters instead of trusting summaries", () => {
    const { input, result } = fixture(); result.cost = -100; result.usedVehicleIds = ["MISSING", "V1", "V1"]; result.unassignedCount = 99;
    expect(validateTransportResult(input, result).join(" ")).toMatch(/요약/);
  });
  it("returns errors rather than throwing on malformed reservation rows", () => {
    const { input, result } = fixture(); result.reservations = [null as never];
    expect(() => validateTransportResult(input, result)).not.toThrow();
    expect(validateTransportResult(input, result).length).toBeGreaterThan(0);
  });
  it("detects missing and duplicate IDs even if row totals match", () => {
    const { input, result } = fixture(); result.assignments[1] = { ...result.assignments[0] };
    expect(validateTransportResult(input, result).join(" ")).toMatch(/누락/);
    expect(validateTransportResult(input, result).join(" ")).toMatch(/중복/);
  });
  it("counts virtual reservations against capacity but never as attendees", () => {
    const { input, result } = fixture(); input.extraCount = 2;
    result.reservations = [{ tripId: "out", vehicleId: "V1", count: 2 }, { tripId: "back", vehicleId: "V1", count: 2 }];
    expect(validateTransportResult(input, result).join(" ")).toMatch(/정원/);
    expect(input.people).toHaveLength(1);
  });
  it("requires the declared driver and rejects unavailable trips", () => {
    const { input, result } = fixture(); input.vehicles[0].tripIds = ["out"];
    expect(validateTransportResult(input, result).join(" ")).toMatch(/가용/);
    input.vehicles[0].tripIds = ["out", "back"]; input.people[0].returnTripId = null;
    input.people.push({ ...input.people[0], id: "P2", returnTripId: "back" });
    result.assignments[1].personId = "P2";
    result.assignments.push({ personId: "P2", tripId: "out", vehicleId: "V1" });
    expect(validateTransportResult(input, result).join(" ")).toMatch(/운전자/);
  });
  it("does not approve an occupied vehicle without a confirmed driver", () => {
    const { input, result } = fixture(); input.vehicles[0].driverId = null;
    expect(validateTransportResult(input, result).join(" ")).toMatch(/운전자/);
  });
  it("does not silently break approved locks", () => {
    const { input, result } = fixture(); input.locks = [{ personId: "P1", tripId: "back", vehicleId: null }];
    expect(validateTransportResult(input, result).join(" ")).toMatch(/잠금/);
  });
  it("stages a manual exception with a new revision and a durable lock", () => {
    const { input, result } = fixture();
    const next = moveTransportAssignment(input, result, { personId: "P1", tripId: "back", vehicleId: null });
    expect(next.input.revision).toBe(2);
    expect(next.input.locks).toEqual([{ personId: "P1", tripId: "back", vehicleId: null }]);
    expect(next.result.revision).toBe(2);
    expect(next.result.unassignedCount).toBe(1);
    expect(input.locks).toEqual([]);
  });
  it("blocks final export until approved and complete", () => {
    const { input, result } = fixture();
    expect(() => transportCsv(input, result, "outbound", false)).toThrow(/승인/);
    result.assignments[0].vehicleId = null;
    expect(() => transportCsv(input, result, "outbound", true)).toThrow();
  });
  it("escapes CSV names and excludes virtual seat rows", () => {
    const { input, result } = fixture(); input.people[0].name = '=HYPERLINK("x")';
    const csv = transportCsv(input, result, "return", true);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"P1"');
    expect(csv).toContain('"V1"');
    expect(csv).toContain('"back"');
    expect(csv).not.toContain("__reserve");
  });
  it("exports a selected vehicle without losing stable IDs", () => {
    const { input, result } = fixture();
    expect(transportCsv(input, result, "outbound", true, "V1").split("\r\n")).toHaveLength(2);
    expect(() => transportCsv(input, result, "outbound", true, "independent")).toThrow(/없습니다/);
  });
  it("exports virtual seat counts as a separate table without fake people", () => {
    const { input, result } = fixture(); input.extraCount = 1;
    result.reservations = [{ tripId: "out", vehicleId: "V1", count: 1 }, { tripId: "back", vehicleId: "V1", count: 1 }];
    const csv = transportReservationCsv(input, result, true);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("가상좌석수");
    expect(csv).not.toContain("P1");
  });
});
