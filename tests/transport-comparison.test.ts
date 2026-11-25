// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildTransportPlan, createTransportComparisonFacts, lowestQuotedPlan, transportDemandFingerprint } from "@/lib/transport-comparison";
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
