import { describe, expect, it } from "vitest";
import { formResponseSurvey } from "@/lib/google-forms-import";
import { createTransportDraft, surveyTripPending } from "@/lib/transport";
import { analyzeSurvey, defaultSurveyMapping, mergeGoogleSurvey, parseSurveyCsv, surveyTransportInput } from "@/lib/transport-survey";
import {
  directionalSurveyFields,
  mapDirectionalSurveyHeaders,
  parseDirectionalSurveyMovement,
  readDirectionalSurveyMovement,
  projectMovementCapacity,
  projectTransportMovement,
  type DirectionalSurveyAnswers,
  type MovementParticipant,
} from "@/lib/transport-movement";

describe("directional survey movement", () => {
  it("maps exact shared titles without selecting a duplicate column", () => {
    const fields = directionalSurveyFields.outbound;
    const headers = [directionalSurveyFields.return.method, fields.method, fields.extraSeats, fields.extraSeats, "이동수단"];
    const mapping = mapDirectionalSurveyHeaders(headers);
    expect(mapping.outbound).toMatchObject({ method: 1, extraSeats: -1 });
    expect(mapping.return.method).toBe(0);
    expect(mapDirectionalSurveyHeaders(["이동수단"]).outbound.method).toBe(-1);
  });

  it("keeps departure and return independent and ignores inactive branches", () => {
    const movement = parseDirectionalSurveyMovement({
      outbound: { method: "가족 차량 동승", providesVehicle: "예, 제가 차량을 제공합니다.", riderNames: "가상 B, 가상 B\n가상 C", extraSeats: "0" },
      return: { method: "다른 참가자와 차량 동승", providesVehicle: "아니요, 다른 사람의 차량에 탑승합니다.", providerName: "가상 D", extraSeats: "4" },
    });
    expect(movement.outbound).toEqual({
      kind: "provider", method: "family", riderNames: ["가상 B", "가상 C"], extraSeats: { kind: "reported", seats: 0 },
    });
    expect(movement.return).toEqual({ kind: "rider", method: "participant", providerName: "가상 D" });
  });

  it("copies departure only when return explicitly says same as departure", () => {
    const outbound = { method: "자차 이동", extraSeats: "3" };
    const parsed = parseDirectionalSurveyMovement({ outbound, return: { method: "출발할 때와 동일", extraSeats: "9" } });
    expect(parsed.return).toEqual(parsed.outbound);
    expect(parsed.return).not.toBe(parsed.outbound);
    expect(parseDirectionalSurveyMovement({ outbound }).return).toMatchObject({ kind: "unknown", reason: "missing_method" });
    expect(parseDirectionalSurveyMovement({ outbound: { method: "출발할 때와 동일" } }).outbound).toMatchObject({ kind: "unknown" });
  });

  it("reads mapped columns in any order without falling back to a legacy one-way field", () => {
    const headers = [directionalSurveyFields.return.method, "이동수단", directionalSurveyFields.outbound.extraSeats, directionalSurveyFields.outbound.method];
    const movement = readDirectionalSurveyMovement(["미정", "단체 이동", "0", "자차 이동"], mapDirectionalSurveyHeaders(headers));
    expect(movement.outbound).toMatchObject({ kind: "provider", extraSeats: { kind: "reported", seats: 0 } });
    expect(movement.return).toEqual({ kind: "undecided" });
  });

  it("distinguishes explicit independent travel, pickup, undecided and unclassified text", () => {
    const parseOther = (other: string) => parseDirectionalSurveyMovement({ outbound: { method: "기타", other } }).outbound;
    expect(parseOther("기차")).toMatchObject({ kind: "independent", method: "train" });
    expect(parseOther("개별 이동")).toMatchObject({ kind: "independent", method: "separate" });
    expect(parseOther("기차 후 역 픽업")).toMatchObject({ kind: "pickup", method: "train" });
    expect(parseOther("역 픽업")).toMatchObject({ kind: "pickup", method: "unspecified" });
    expect(parseOther("이동수단 미정")).toMatchObject({ kind: "undecided" });
    expect(parseOther("기차를 탈지 아직 모르겠음")).toMatchObject({ kind: "unknown", reason: "unclassified_other" });
    expect(parseDirectionalSurveyMovement({ return: { method: "미정" } }).return).toMatchObject({ kind: "undecided" });
  });

  it("does not guess provider status or parse ambiguous seat counts", () => {
    const { outbound, return: returning } = parseDirectionalSurveyMovement({
      outbound: { method: "다른 참가자와 차량 동승", providerName: "가상 D", extraSeats: "2" },
      return: { method: "자차 이동", extraSeats: "2-3" },
    });
    expect(outbound).toMatchObject({ kind: "unknown", reason: "missing_provider_choice" });
    expect(returning).toMatchObject({ kind: "provider", extraSeats: { kind: "invalid", answer: "2-3" } });
  });
});

describe("directional survey import", () => {
  it("preserves directional answers from CSV without using reported family IDs or inventing a trip", () => {
    const data = parseSurveyCsv(
      "참석 여부,이름,가족 ID,출발 이동수단,출발 기타 이동 방법,귀가 이동수단\n참석,가상 A,외부값,기타,기차,단체 이동\n불참,가상 B,,,,",
    );
    const review = analyzeSurvey(data, defaultSurveyMapping(data.headers));
    const input = surveyTransportInput(createTransportDraft(), review, () => "csv-attendee");
    expect(review.entries[0].cells[2]).toBe("외부값");
    expect(input.people).toMatchObject([{
      id: "csv-attendee", familyId: "", outboundTripId: null, returnTripId: null, returnEntry: surveyTripPending,
      movementPlan: { outbound: { kind: "independent", method: "train" }, return: { kind: "group" } },
    }]);
    expect(input.people[0].outboundEntry).toBeUndefined();
    expect(input.vehicles).toEqual([]);
  });

  it("carries through an explicit matching group but does not apply an incompatible group to an independent leg", () => {
    const data = parseSurveyCsv("참석 여부,이름,출발 이동수단,출발 팀,귀가 이동수단,귀가 기타 이동 방법,귀가편\n참석,가상 A,단체 이동,선발대,기타,기차,정상 귀가");
    const review = analyzeSurvey(data, defaultSurveyMapping(data.headers));
    const [person] = surveyTransportInput(createTransportDraft(), review, () => "csv-attendee").people;
    expect(person).toMatchObject({
      outboundTripId: "advance", returnTripId: null, returnEntry: surveyTripPending,
      movementPlan: { outbound: { kind: "group" }, return: { kind: "unknown", reason: "conflicting_survey_answers" } },
    });
  });

  it("does not let a conflicting legacy movement answer be replaced silently by a directional answer", () => {
    const data = parseSurveyCsv("참석 여부,이름,이동수단,출발 이동수단,출발 팀,귀가 이동수단\n참석,가상 A,왕복 자차,단체 이동,선발대,출발할 때와 동일");
    const review = analyzeSurvey(data, defaultSurveyMapping(data.headers));
    const [person] = surveyTransportInput(createTransportDraft(), review, () => "csv-attendee").people;
    expect(person).toMatchObject({
      outboundTripId: null, outboundEntry: surveyTripPending, returnEntry: surveyTripPending,
      movementPlan: { outbound: { kind: "unknown", reason: "conflicting_survey_answers" }, return: { kind: "unknown", reason: "conflicting_survey_answers" } },
    });
  });

  it("coalesces a populated Forms branch by exact title while preserving response IDs and existing roster edits", () => {
    const headers = ["참석 여부", "이름", "출발 이동수단", "출발 추가 탑승 가능 인원", "출발 추가 탑승 가능 인원", "귀가 이동수단"];
    const form = { items: headers.map((title, index) => ({ title, questionItem: { question: { questionId: "q" + index } } })) };
    const response = (seats: string) => ({
      responseId: "synthetic-response", answers: Object.fromEntries(
        ["참석", "가상 A", "자차 이동", "", seats, "출발할 때와 동일"].map((value, index) => ["q" + index, { textAnswers: { answers: [{ value }] } }]),
      ),
    });
    const first = formResponseSurvey("synthetic_form", form, [response("0")]);
    const original = mergeGoogleSurvey(createTransportDraft(), first);
    expect(original.people[0]).toMatchObject({
      id: first.source?.personIds[0], outboundTripId: null, returnTripId: null,
      movementPlan: {
        outbound: { kind: "provider", extraSeats: { kind: "reported", seats: 0 } },
        return: { kind: "provider", extraSeats: { kind: "reported", seats: 0 } },
      },
    });
    original.people[0].name = "가상 수동 수정";
    const refreshed = formResponseSurvey("synthetic_form", form, [response("4")]);
    expect(mergeGoogleSurvey(original, refreshed)).toBe(original);
    expect(original.people[0].name).toBe("가상 수동 수정");
  });

  it("flags competing populated branch values instead of picking a seat number or defaulting the return", () => {
    const data = parseSurveyCsv(
      "참석 여부,이름,출발 이동수단,출발 추가 탑승 가능 인원,출발 추가 탑승 가능 인원,귀가 이동수단\n참석,가상 A,자차 이동,2,3,출발할 때와 동일",
    );
    const review = analyzeSurvey(data, defaultSurveyMapping(data.headers));
    const [person] = surveyTransportInput(createTransportDraft(), review, () => "csv-attendee").people;
    const conflict = { kind: "unknown", reason: "conflicting_survey_answers", answer: "출발 추가 탑승 가능 인원" };
    expect(person).toMatchObject({
      outboundEntry: surveyTripPending, returnEntry: surveyTripPending,
      movementPlan: { outbound: conflict, return: conflict },
    });
  });
});

const attendee = (id: string, answers: DirectionalSurveyAnswers, name = "가상 " + id, familyId: string | null = null): MovementParticipant => ({
  id, name, familyId, attendance: "attending", movement: parseDirectionalSurveyMovement(answers),
});
const offer = (riderNames: string, extraSeats = "3") => ({
  method: "다른 참가자와 차량 동승", providesVehicle: "예, 제가 차량을 제공합니다.", riderNames, extraSeats,
});
const ride = (providerName: string) => ({
  method: "가족 차량 동승", providesVehicle: "아니요, 다른 사람의 차량에 탑승합니다.", providerName,
});

describe("directional vehicle projection", () => {
  it("counts one vehicle per provider, with separate existing passengers and seat reports for each direction", () => {
    const a = attendee("A", { outbound: offer("가상 B, 가상 C, 가상 B"), return: offer("가상 C", "0") }, "가상 A", "F1");
    const b = attendee("B", { outbound: ride("가상 A"), return: { method: "기타", other: "기차" } }, "가상 B", "F2");
    const c = attendee("C", { outbound: ride("가상 A"), return: ride("가상 A") }, "가상 C", "F2");
    const projection = projectTransportMovement([c, a, b], {
      vehicleFacts: new Map([["A", { totalSeats: 6 }]]),
    });
    expect(projection.conflicts).toEqual([]);
    expect(projection.vehicles).toHaveLength(1);
    const [car] = projection.vehicles;
    expect(car.providerId).toBe("A");
    expect(car.legs.outbound).toMatchObject({
      existingPersonIds: ["A", "B", "C"], reportedExtraSeats: 3, remainingExtraSeats: 3, physicalFreeSeats: 3, allocatableExtraSeats: 3,
    });
    expect(car.legs.return).toMatchObject({
      existingPersonIds: ["A", "C"], reportedExtraSeats: 0, remainingExtraSeats: 0, physicalFreeSeats: 4, allocatableExtraSeats: 0,
    });
    expect(projectTransportMovement([a, b, c], { vehicleFacts: new Map([["A", { totalSeats: 6 }]]) })).toEqual(projection);
    expect(projectTransportMovement([attendee("A", { return: offer("") }, "변경된 가상 A")]).vehicles[0].id).toBe(car.id);
  });

  it("does not merge different providers from the same family or infer a family ID", () => {
    const a = attendee("A", { outbound: offer("") }, "가상 A", "F1");
    const b = attendee("B", { return: offer("") }, "가상 B", "F1");
    const c = attendee("C", { outbound: { method: "단체 이동" } });
    const absent: MovementParticipant = { ...attendee("D", { outbound: offer("") }), attendance: "absent" };
    const projection = projectTransportMovement([a, b, c, absent]);
    expect(projection.vehicles.map(({ providerId }) => providerId)).toEqual(["A", "B"]);
    expect(projection.participants.map(({ id, familyId }) => [id, familyId])).toEqual([["A", "F1"], ["B", "F1"], ["C", null]]);
    expect(projection.excludedPersonIds).toEqual(["D"]);
  });

  it("coalesces equivalent snapshots with the same attendee ID", () => {
    const a = attendee("A", { outbound: offer("가상 B"), return: { method: "출발할 때와 동일" } });
    const b = attendee("B", { outbound: ride("가상 A"), return: ride("가상 A") });
    expect(projectTransportMovement([a, b, structuredClone(a)])).toEqual(projectTransportMovement([a, b]));
  });

  it("quarantines conflicting versions without permitting an alternate same-name match", () => {
    const a = attendee("A", { outbound: offer("가상 C") }, "동명");
    const b = attendee("B", { outbound: offer("") }, "동명");
    const revision = attendee("B", { outbound: offer("", "1") }, "동명");
    const c = attendee("C", { outbound: ride("동명") });
    const projection = projectTransportMovement([a, b, revision, c]);
    expect(projection.vehicles.map(({ providerId }) => providerId)).toEqual(["A"]);
    expect(projection.excludedPersonIds).toEqual(["B"]);
    expect(projection.conflicts).toEqual(expect.arrayContaining([
      { kind: "duplicate_participant", personId: "B" },
      expect.objectContaining({ kind: "ambiguous_provider", direction: "outbound", candidatePersonIds: ["A", "B"] }),
    ]));
    expect(projection.vehicles[0].legs.outbound?.existingPersonIds).toEqual(["A"]);
    expect(projectTransportMovement([revision, b, c, a])).toEqual(projection);
  });

  it("flags same-name ambiguity even when just one matching attendee offered a car", () => {
    const a = attendee("A", { outbound: offer("가상 C") }, "동명");
    const b = attendee("B", {}, "동명");
    const c = attendee("C", { outbound: ride("동명") });
    const projection = projectTransportMovement([a, b, c], { vehicleFacts: new Map([["A", { totalSeats: 5 }]]) });
    expect(projection.conflicts).toContainEqual(expect.objectContaining({
      kind: "ambiguous_provider", direction: "outbound", personId: "C", candidatePersonIds: ["A", "B"],
    }));
    expect(projection.participants[2].legs.outbound).toMatchObject({ vehicleId: null, assignmentNeed: "review" });
    expect(projection.vehicles[0].legs.outbound).toMatchObject({ existingPersonIds: ["A"], allocatableExtraSeats: null });
  });

  it("does not allow a rider claim to create a car, add an unacknowledged rider, or reuse the other leg", () => {
    const a = attendee("A", { outbound: offer("") });
    const b = attendee("B", { outbound: ride("가상 A"), return: ride("가상 A") });
    const c = attendee("C", { outbound: ride("없는 가상 제공자") });
    const projection = projectTransportMovement([a, b, c]);
    expect(projection.vehicles).toHaveLength(1);
    expect(projection.vehicles[0].legs).not.toHaveProperty("return");
    expect(projection.vehicles[0].legs.outbound?.existingPersonIds).toEqual(["A"]);
    expect(projection.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unacknowledged_rider", direction: "outbound", personId: "B" }),
      expect.objectContaining({ kind: "provider_not_operating", direction: "return", personId: "B" }),
      expect.objectContaining({ kind: "missing_provider", direction: "outbound", personId: "C" }),
    ]));
  });

  it("does not assign the same passenger when two providers named them", () => {
    const a = attendee("A", { outbound: offer("가상 C") });
    const b = attendee("B", { outbound: offer("가상 C") });
    const c = attendee("C", {});
    const projection = projectTransportMovement([a, b, c]);
    expect(projection.vehicles.map((vehicle) => vehicle.legs.outbound?.existingPersonIds)).toEqual([["A"], ["B"]]);
    expect(projection.participants[2].legs.outbound).toMatchObject({ vehicleId: null, assignmentNeed: "review" });
    expect(projection.conflicts).toContainEqual(expect.objectContaining({
      kind: "conflicting_rider_claim", direction: "outbound", personId: "C", vehicleIds: projection.vehicles.map(({ id }) => id),
    }));
  });

  it("keeps reported seats visible but withholds supply if declared operation or capacity conflicts", () => {
    const a = attendee("A", { outbound: offer("가상 B"), return: offer("가상 B") });
    const b = attendee("B", { outbound: ride("가상 A"), return: ride("가상 A") });
    const projection = projectTransportMovement([a, b], {
      vehicleFacts: new Map([["A", { totalSeats: 4, operates: { return: false } }]]),
    });
    const { legs } = projection.vehicles[0];
    expect(legs.outbound).toMatchObject({ reportedExtraSeats: 3, remainingExtraSeats: 3, physicalFreeSeats: 2, allocatableExtraSeats: null });
    expect(legs.return?.allocatableExtraSeats).toBeNull();
    expect(projection.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "reported_seats_exceed_capacity", direction: "outbound" }),
      expect.objectContaining({ kind: "vehicle_not_operating", direction: "return" }),
    ]));
  });

  it("classifies demand without making independent or unclassified travelers automatic car candidates", () => {
    const people = [
      attendee("A", { outbound: { method: "기타", other: "기차" }, return: { method: "기타", other: "기차 + 역 픽업" } }),
      attendee("B", { outbound: { method: "기타", other: "기차나 택시?" }, return: { method: "미정" } }),
      attendee("C", { outbound: { method: "단체 이동" } }),
    ];
    const [a, b, c] = projectTransportMovement(people).participants;
    expect(a.legs.outbound).toMatchObject({ condition: "individual", assignmentNeed: "none" });
    expect(a.legs.return).toMatchObject({ condition: "partial", assignmentNeed: "pickup" });
    expect(b.legs.outbound).toMatchObject({ condition: "unknown", assignmentNeed: "review" });
    expect(b.legs.return).toMatchObject({ condition: "unknown", assignmentNeed: "undecided" });
    expect(c.legs.outbound).toMatchObject({ condition: "joint", assignmentNeed: "group" });
  });
});

describe("movement capacity", () => {
  it("deducts only distinct new passengers, not existing passengers appearing in proposed assignments", () => {
    expect(projectMovementCapacity({
      totalSeats: 7, existingPersonIds: ["A", "B", "C", "B"], reportedExtraSeats: 3, addedPersonIds: ["B", "D", "D"],
    })).toEqual({
      totalSeats: 7, existingPersonIds: ["A", "B", "C"], addedPersonIds: ["D"], reportedExtraSeats: 3,
      remainingExtraSeats: 2, physicalFreeSeats: 3, allocatableExtraSeats: 2, conflicts: [],
    });
  });

  it("reports both physical overcapacity and excess over the seat offer without returning negative seats", () => {
    const capacity = projectMovementCapacity({ totalSeats: 3, existingPersonIds: ["A", "B"], reportedExtraSeats: 0, addedPersonIds: ["C", "D"] });
    expect(capacity).toMatchObject({ remainingExtraSeats: 0, physicalFreeSeats: 0, allocatableExtraSeats: null });
    expect(capacity.conflicts).toEqual(expect.arrayContaining(["occupancy_exceeds_capacity", "added_riders_exceed_report"]));
  });

  it("does not infer a physical capacity from the reported extra seats", () => {
    expect(projectMovementCapacity({ totalSeats: null, existingPersonIds: ["A"], reportedExtraSeats: 3 })).toMatchObject({
      reportedExtraSeats: 3, remainingExtraSeats: 3, physicalFreeSeats: null, allocatableExtraSeats: null,
    });
  });
});
