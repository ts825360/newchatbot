// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransportComparisonPanel } from "@/components/transport-comparison-panel";
import { buildTransportComparisonSummaries, buildTransportPlan, createTransportComparisonFacts, isTransportComparison, lowestQuotedPlan, recordedTransportQuote, transportDemandFingerprint } from "@/lib/transport-comparison";
import { createTransportDraft, type TransportInput, type TransportResult } from "@/lib/transport";

export function comparisonFixture() {
  const input: TransportInput = {
    ...createTransportDraft(),
    people: [{ id: "p1", name: "Private name", department: "Group", familyId: "", companionGroup: "", outboundTripId: "main", returnTripId: "normal" }],
    vehicles: [{ id: "v1", label: "Private label", capacity: 2, driverId: null, externalDriverConfirmed: true, enabled: true, rental: true, rentalCost: 0, tripIds: ["main", "normal"] }],
  };
  const result: TransportResult = {
    revision: input.revision, status: "optimal", cost: 0, unassignedCount: 0, unreservedCount: 0,
    assignments: [{ personId: "p1", tripId: "main", vehicleId: "v1" }, { personId: "p1", tripId: "normal", vehicleId: "v1" }],
    reservations: [], usedVehicleIds: ["v1"], message: "Complete",
  };
  return { input, result };
}

describe("read-only transport comparison", () => {
  it("counts physical vehicles once, tracks directions and subtracts assigned and reserved seats", async () => {
    const { input, result } = comparisonFixture();
    input.extraCount = 1;
    input.vehicles = [
      { ...input.vehicles[0], source: "church", rental: false, totalSeats: 5, vehicleType: "car-5", capacity: 4 },
      { ...input.vehicles[0], id: "v2", source: "private", rental: false },
      { ...input.vehicles[0], id: "v3", source: "rental" },
      { ...input.vehicles[0], id: "unused" },
    ];
    result.assignments[1].vehicleId = "v2";
    result.reservations = [{ tripId: "main", vehicleId: "v1", count: 1 }, { tripId: "normal", vehicleId: "v3", count: 1 }];
    result.usedVehicleIds = ["v1", "v2", "v3"];
    const plan = await buildTransportPlan(input, result);
    expect(plan.metrics?.vehicles).toEqual({
      total: 3, outbound: 1, return: 2, private: 1, church: 1, rental: 1, unspecified: 0,
      byType: { "car-5": 1, unspecified: 2 }, availableSeats: { outbound: 2, return: 2 },
    });

    result.reservations[1].vehicleId = "v1";
    result.usedVehicleIds.pop();
    const shared = await buildTransportPlan(input, result);
    expect(shared.metrics?.vehicles).toMatchObject({ total: 2, outbound: 1, return: 2, rental: 0 });
    expect(plan.metrics?.vehicles?.total).toBe(3);
  });

  it("counts each participant once across both directions, including individual travel", async () => {
    const { input, result } = comparisonFixture();
    input.people.push({ ...input.people[0], id: "p2" }, { ...input.people[0], id: "p3", outboundTripId: null, returnTripId: null });
    result.assignments.push({ personId: "p2", tripId: "main", vehicleId: null }, { personId: "p2", tripId: "normal", vehicleId: null });
    result.unassignedCount = 2;
    input.previousAssignments = result.assignments.map(assignment => ({ ...assignment, vehicleId: null }));
    const partial = await buildTransportPlan(input, result);
    expect(partial.metrics?.people).toEqual({ total: 3, secured: 2, unassigned: 1, changed: 1 });
    expect(partial.metrics).toMatchObject({ allCanTravel: false, requiredConditionsMet: true });

    const unknown = await buildTransportPlan(input, { ...result, status: "unknown" });
    expect(unknown.metrics).toMatchObject({
      vehicles: null, cost: null, allCanTravel: null, requiredConditionsMet: null,
      people: { total: 3, secured: null, unassigned: null, changed: null },
    });
  });

  it("does not report a capacity violation as a verified transport plan", async () => {
    const { input, result } = comparisonFixture();
    input.people.push({ ...input.people[0], id: "p2" });
    result.assignments.push(...result.assignments.map(assignment => ({ ...assignment, personId: "p2" })));
    input.vehicles[0].capacity = 1;
    const plan = await buildTransportPlan(input, result);
    expect(plan.metrics).toMatchObject({ vehicles: null, cost: null, allCanTravel: null, requiredConditionsMet: false });
  });

  it.each([
    ["round-trip", undefined, 1000],
    ["one-way", undefined, 2000],
    ["day", 3, 3000],
    ["day", undefined, null],
  ] as const)("uses %s rental rates and does not guess days (%s)", async (rentalCostUnit, rentalDays, expected) => {
    const { input, result } = comparisonFixture();
    input.vehicles = [{ ...input.vehicles[0], rentalQuoteKnown: true, rentalCost: 1000, rentalCostUnit, rentalDays }];
    result.cost = 1000;
    const plan = await buildTransportPlan(input, result);
    expect(plan.quote).toBe(expected);
    expect(recordedTransportQuote(input, result)).toBe(expected);
    expect(plan.metrics?.cost).toMatchObject({ rentalCost: expected, pendingRentalVehicles: expected === null ? 1 : 0 });
    expect(plan.metrics?.cost?.estimatedTotal).toBeNull();
  });

  it("charges one-way rates for used legs only and keeps missing quotes out of the confirmed subtotal", async () => {
    const { input, result } = comparisonFixture();
    input.vehicles = [
      { ...input.vehicles[0], rentalQuoteKnown: true, rentalCost: 1500, rentalCostUnit: "one-way", otherCost: 400 },
      { ...input.vehicles[0], id: "v2", rentalQuoteKnown: false, rentalCost: 9000, otherCost: 100 },
    ];
    result.usedVehicleIds = ["v1", "v2"];
    result.assignments[1].vehicleId = "v2";
    result.cost = 10_500;
    const plan = await buildTransportPlan(input, result);
    expect(plan.quote).toBeNull();
    expect(plan.metrics?.cost).toEqual({ rentalCost: 1500, pendingRentalVehicles: 1, otherCost: 500, unenteredOtherCostVehicles: 0, estimatedTotal: null });
    input.vehicles[1].rentalQuoteKnown = true;
    expect((await buildTransportPlan(input, result)).metrics?.cost?.estimatedTotal).toBe(11_000);
  });

  it("distinguishes explicitly zero other costs from empty entries", async () => {
    const { input, result } = comparisonFixture();
    input.vehicles[0].rentalQuoteKnown = true;
    expect((await buildTransportPlan(input, result)).metrics?.cost).toEqual({
      rentalCost: 0, pendingRentalVehicles: 0, otherCost: null, unenteredOtherCostVehicles: 1, estimatedTotal: null,
    });
    input.vehicles = [{ ...input.vehicles[0], otherCost: 0 }];
    expect((await buildTransportPlan(input, result)).metrics?.cost?.estimatedTotal).toBe(0);
  });

  it("validates optional saved metrics without including them in the legacy explanation projection", async () => {
    const { input, result } = comparisonFixture();
    const plan = await buildTransportPlan(input, result);
    const { metrics, ...legacy } = plan;
    expect(metrics).toBeDefined();
    expect(isTransportComparison({ a: legacy, b: JSON.parse(JSON.stringify(plan)) })).toBe(true);
    expect(isTransportComparison({ a: { ...plan, metrics: { ...metrics, people: { total: -1 } } } })).toBe(false);
    expect(isTransportComparison({ a: { ...plan, metrics: { ...metrics, outbound: "unexpected" } } })).toBe(false);
    expect(isTransportComparison({ a: { ...plan, unexpected: true } })).toBe(false);
    expect(createTransportComparisonFacts({ a: plan, b: plan })).toEqual(createTransportComparisonFacts({ a: legacy, b: legacy }));
  });

  it("derives draft, live and saved summaries with the same baseline without changing their snapshots", async () => {
    const draft = comparisonFixture();
    const current = comparisonFixture();
    current.input.revision = current.result.revision = 2;
    const vehicle = { ...current.input.vehicles[0], id: "v2", rentalQuoteKnown: true };
    current.input.vehicles.push(vehicle);
    current.result.assignments.forEach(assignment => { assignment.vehicleId = vehicle.id; });
    current.result.usedVehicleIds = [vehicle.id];
    const before = JSON.stringify({ draft, current });
    const { currentPlan, draftPlan, savedPlans } = await buildTransportComparisonSummaries({ current, draft, saved: [
      { id: "first", title: "Saved", ...draft },
      { id: "stale", title: "Stale", input: current.input, result: draft.result },
    ] });
    expect(currentPlan).toMatchObject({ revision: 2, metrics: { people: { changed: 1 } } });
    expect(draftPlan).toMatchObject({ revision: 1, metrics: { people: { changed: 0 } } });
    expect(savedPlans).toEqual([{ id: "first", title: "Saved", plan: draftPlan }]);
    expect(JSON.stringify({ draft, current })).toBe(before);
  });

  it("preserves an explicit empty current or draft while allowing callers to omit it", async () => {
    expect(await buildTransportComparisonSummaries({ current: null })).toEqual({ currentPlan: null, draftPlan: undefined, savedPlans: [] });
    expect(await buildTransportComparisonSummaries({ draft: null })).toEqual({ currentPlan: undefined, draftPlan: null, savedPlans: [] });
  });

  it("shows the unsaved current, immutable draft and saved plans in compact cards and expanded columns", async () => {
    const { input, result } = comparisonFixture();
    const plan = await buildTransportPlan(input, result);
    const props = {
      comparison: { a: plan },
      currentPlan: { ...plan, revision: 3 }, draftPlan: plan,
      savedPlans: [{ id: "church-bus", title: "교회 차량 중심", plan }],
      canCapture: false, capturing: null, onCapture: () => {}, onRemove: () => {}, onAssembly: () => {}, onSelectPlan: () => {},
    };
    const cards = renderToStaticMarkup(createElement(TransportComparisonPanel, props));
    const table = renderToStaticMarkup(createElement(TransportComparisonPanel, { ...props, expanded: true }));
    for (const html of [cards, table]) {
      expect(html).toContain("현재 작업안");
      expect(html).toContain("최초 초안");
      expect(html).toContain("교회 차량 중심");
      expect(html).toContain("기타 비용 미입력");
      expect(html).not.toContain("배정안 확정");
    }
    expect(cards).toContain("<article");
    expect(table).toContain("<table");
    expect(table).toContain("차종별 대수");
  });

  it("keeps a blank quote different from explicit zero, and ignores unused rentals", async () => {
    const { input, result } = comparisonFixture();
    const unknown = await buildTransportPlan(input, result);
    expect(unknown.quote).toBeNull();
    input.vehicles.push({ ...input.vehicles[0], id: "unused" });
    input.vehicles[0].rentalQuoteKnown = true;
    const zero = await buildTransportPlan(input, result);
    expect(zero.quote).toBe(0);
    expect(lowestQuotedPlan({ a: zero, b: unknown })).toBeNull();
    expect(lowestQuotedPlan({ a: zero, b: { ...zero, quote: 1000 } })).toBe("a");
  });

  it("does not rank inadmissible, incomparable or tied plans", async () => {
    const { input, result } = comparisonFixture();
    input.vehicles[0].rentalQuoteKnown = true;
    const a = await buildTransportPlan(input, result);
    expect(lowestQuotedPlan({ a, b: { ...a, quote: 500, state: "blocked" } })).toBeNull();
    expect(lowestQuotedPlan({ a, b: { ...a, quote: 500, demand: "0".repeat(64) } })).toBeNull();
    expect(lowestQuotedPlan({ a, b: { ...a } })).toBeNull();
  });

  it("isolates missing seats by direction, and never equates solver timeout with zero shortages", async () => {
    const { input, result } = comparisonFixture();
    input.extraCount = 1;
    result.reservations = [{ tripId: "main", vehicleId: "v1", count: 1 }];
    result.assignments[1].vehicleId = null;
    result.unassignedCount = 1;
    result.unreservedCount = 1;
    const plan = await buildTransportPlan(input, result);
    expect(plan.state).toBe("blocked");
    expect(plan.outbound).toEqual({ demand: 1, missing: 0, extraMissing: 0 });
    expect(plan.return).toEqual({ demand: 1, missing: 1, extraMissing: 1 });
    const unknown = await buildTransportPlan(input, { ...result, status: "unknown" });
    expect(unknown.state).toBe("review");
    expect(unknown.return.missing).toBeNull();
    await expect(buildTransportPlan(input, { ...result, revision: 5 })).rejects.toThrow();
  });

  it("compares the same rider and trip conditions without putting names, IDs or notes in model facts", async () => {
    const { input, result } = comparisonFixture();
    const a = await buildTransportPlan(input, result);
    input.people[0].name = "Other Private name";
    expect(await transportDemandFingerprint(input)).toBe(a.demand);
    input.people[0].id = "p2";
    expect(await transportDemandFingerprint(input)).not.toBe(a.demand);
    const facts = createTransportComparisonFacts({ a, b: { ...a, assemblyPoints: 2 } });
    expect(JSON.stringify(facts)).not.toMatch(/Private|p1|v1|[a-f0-9]{64}/);
    expect(facts.comparable).toBe(true);
  });
});
