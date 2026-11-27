import { describe, expect, it } from "vitest";
import { calculateLodging, initialLodgingPlan, moveLodgingPerson, summarizeLodging } from "../lib/lodging-plan";
import type { TransportPerson } from "../lib/transport";

const person = (id: string, lodging = "", department = "", familyId = "", roomAssignment?: string): TransportPerson => ({
  id, name: id, lodging, department, familyId, roomAssignment, companionGroup: "", outboundTripId: null, returnTripId: null,
});

describe("숙소 배정", () => {
  it("separates youth departments and explicit genders, leaves unknowns pending, and keeps mixed-gender families together", () => {
    const people: TransportPerson[] = [
      { ...person("young-m1", "단체방", "청년부"), gender: "male" },
      { ...person("young-m2", "단체방", "청년부"), gender: "male" },
      { ...person("young-f", "단체방", "청년부"), gender: "female" },
      { ...person("teen-m", "단체방", "청소년부"), gender: "male" },
      { ...person("teen-f", "단체방", "청소년부"), gender: "female" },
      person("가상 여자 이름", "단체방", "청소년부"),
      { ...person("family-m", "가족방", "청년부", "F1"), gender: "male" },
      { ...person("family-f", "가족방", "청소년부", "F1"), gender: "female" },
    ];
    const next = calculateLodging(people, initialLodgingPlan(people));
    expect(next.rooms.filter(r => r.kind === "group").map(r => r.people)).toEqual([["young-m1", "young-m2"], ["young-f"], ["teen-m"], ["teen-f"]]);
    expect(next.rooms.find(r => r.kind === "family")?.people).toEqual(["family-m", "family-f"]);
    expect(summarizeLodging(people, next).pending).toBe(1);
  });
  it("allocates 150 distinct people once and reports capacity counts at retreat scale", () => {
    const groups = Array.from({ length: 120 }, (_, i) => person(`g${i}`, "단체방", i < 60 ? "남자" : "여자"));
    const families = Array.from({ length: 24 }, (_, i) => person(`f${i}`, "가족방", "", `F${Math.floor(i / 4)}`));
    const individuals = Array.from({ length: 6 }, (_, i) => person(`p${i}`));
    const people = [...groups, ...families, ...individuals];
    const plan = calculateLodging(people, { ...initialLodgingPlan(people), overrides: individuals.map(p => ({ id: p.id, kind: "personal" })) });
    expect(summarizeLodging(people, plan)).toMatchObject({ assigned: 150, pending: 0 });
    expect(plan.rooms.filter(r => r.kind === "group")).toHaveLength(16);
    expect(plan.rooms.filter(r => r.kind === "family" && r.capacity === 4)).toHaveLength(6);
    expect(plan.rooms.filter(r => r.kind === "personal")).toHaveLength(6);
    expect(plan.rooms.every(r => r.capacity !== null && r.people.length <= r.capacity)).toBe(true);
  });

  it("counts rooms by configured occupancy, keeps each family together and never guesses a group from a name", () => {
    const people = [...Array.from({ length: 19 }, (_, i) => person(`m${i}`, "단체방", "남자")),
      ...Array.from({ length: 13 }, (_, i) => person(`f${i}`, "단체방", "여자")),
      person("가족1", "가족방", "남자", "F1"), person("가족2", "가족끼리", "여자", "F1"), person("가족3", "가족방", "여자", "F2"),
      person("확인1", "단체방", "교사"), person("확인2", "가족방"), person("개인")];
    const plan = { ...initialLodgingPlan(people), familySizes: [2, 4], groupSize: 8, overrides: [{ id: "개인", kind: "personal" as const }] };
    const next = calculateLodging(people, plan);
    expect(next.rooms.filter(r => r.kind === "group").map(r => r.people.length)).toEqual([8, 8, 3, 8, 5]);
    expect(next.rooms.filter(r => r.kind === "family").map(r => r.people)).toEqual([["가족1", "가족2"], ["가족3"]]);
    expect(summarizeLodging(people, next)).toMatchObject({ assigned: 36, pending: 2, numbered: 0 });
    expect(next.rooms.find(r => r.kind === "personal")?.people).toEqual(["개인"]);
  });

  it("preserves old numbered rooms and disabled automatic moves, and rejects overfilling or mixing groups", () => {
    const people = [person("old", "", "", "", "201호"), person("r1", "단체방", "남자"), person("r2", "단체방", "남자"), person("r3", "단체방", "여자")];
    const plan = { ...initialLodgingPlan(people), groupSize: 1 };
    const next = calculateLodging(people, plan);
    expect(next.rooms[0]).toMatchObject({ number: "201호", capacity: null, people: ["old"] });
    const r1 = next.rooms.find(r => r.people.includes("r1"))!;
    const r2 = next.rooms.find(r => r.people.includes("r2"))!;
    const r3 = next.rooms.find(r => r.people.includes("r3"))!;
    expect(() => moveLodgingPerson(people, next, "r1", r2.id)).toThrow("정원");
    expect(() => moveLodgingPerson(people, next, "r1", r3.id)).toThrow("그룹");
    const maintained = calculateLodging(people, { ...next, rooms: next.rooms.map(room => room.id === r1.id ? { ...room, locked: true } : room) });
    expect(maintained.rooms.find(room => room.id === r1.id)).toMatchObject({ locked: true, people: ["r1"] });
  });
});
