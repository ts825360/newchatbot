import { describe, expect, it } from "vitest";
import { analyzeSurvey, defaultSurveyMapping, parseSurveyCsv, surveyTransportInput } from "@/lib/transport-survey";
import { createTransportDemo, createTransportDraft, driverIdFor, driverOption, transportRosterCsv, validateTransportInput } from "@/lib/transport";

describe("transport survey", () => {
  it("imports departure teams, return plans and additional answers without guessing unmatched trip text", () => {
    const data = parseSurveyCsv("참석 여부,이름,소속,가족ID,출발,귀가,기타 특이사항\nO,가상1,청년부,F2,후발대,사전 귀가,확인\nO,가상2,청년부,F10,선발대,개별 이동,\nO,가상3,청년부,,오후 7시,정상 귀가,");
    const input = createTransportDraft();
    input.vehicles = [{ id: "v", label: "가상 차량", capacity: 5, enabled: true, rental: false, rentalCost: 0, driverId: null, driverName: "가상1", tripIds: ["late", "early"] }];
    const next = surveyTransportInput(input, analyzeSurvey(data, defaultSurveyMapping(data.headers)));
    expect(next.people[0]).toMatchObject({ outboundTripId: "late", returnTripId: "early", notes: "확인" });
    expect(next.people[1]).toMatchObject({ outboundTripId: "advance", returnTripId: null });
    expect(next.people[2]).toMatchObject({ outboundEntry: "오후 7시" });
    expect(next.vehicles[0].driverId).toBe(next.people[0].id);
    expect(validateTransportInput(next, { draft: true })).toEqual([]);
    expect(validateTransportInput(next).join(" ")).toContain("오후 7시");
    const csv = transportRosterCsv(next);
    expect(csv.indexOf("F10")).toBeLessThan(csv.indexOf("F2"));
    expect(csv).toContain("오후 7시");
  });
  it("keeps original answers including quoted commas and newlines, but allocates only attendees", () => {
    const data = parseSurveyCsv('\uFEFF타임스탬프,참석 여부,이름,소속,이동수단,기타 특이사항\r\n2026-11-18,O,가상 참가,청년부,왕복 개별 이동,"메모, 첫 줄\r\n두 번째 줄"\r\n2026-11-19,X,,,,\r\n');
    const mapping = defaultSurveyMapping(data.headers);
    const review = analyzeSurvey(data, mapping);
    expect(review.counts).toEqual({ attending: 1, absent: 1, unresolved: 0 });
    expect(review.entries[0].cells[5]).toBe("메모, 첫 줄\r\n두 번째 줄");
    const input = createTransportDemo();
    const next = surveyTransportInput(input, review, () => "imported-1");
    expect(next.people).toMatchObject([{ id: "imported-1", name: "가상 참가", department: "청년부", outboundTripId: null, returnTripId: null }]);
    expect(next.vehicles[0]).toMatchObject({ driverId: null, externalDriverConfirmed: false });
    expect(next.revision).toBe(input.revision + 1);
  });
  it("flags unresolved rows and keeps same names distinct", () => {
    const data = parseSurveyCsv("참석여부,이름,소속,이동수단\n참석,가상 동명,청년부,자차\n참가,가상 동명,청년부,버스\n미정,가상 미정,장년부,");
    const mapping = defaultSurveyMapping(data.headers);
    const review = analyzeSurvey(data, mapping);
    expect(review.counts).toEqual({ attending: 2, absent: 0, unresolved: 1 });
    expect(review.entries[0]).toMatchObject({ duplicate: true, movementReview: true });
    expect(() => surveyTransportInput(createTransportDemo(), review)).toThrow();
    const resolved = analyzeSurvey({ ...data, rows: data.rows.slice(0, 2) }, mapping);
    expect(new Set(surveyTransportInput(createTransportDemo(), resolved).people.map((person) => person.id)).size).toBe(2);
  });
  it("rejects malformed CSV rather than silently losing answers", () => {
    expect(() => parseSurveyCsv('참석 여부,이름\nO,"닫히지 않은 이름')).toThrow();
    expect(() => parseSurveyCsv("참석 여부,이름\nO")).toThrow();
  });
  it("keeps a valid survey with only non-attendance responses without inventing a roster", () => {
    const data = parseSurveyCsv("참석 여부,이름\nX,");
    const review = analyzeSurvey(data, defaultSurveyMapping(data.headers));
    expect(review.canImport).toBe(true);
    expect(surveyTransportInput(createTransportDemo(), review).people).toEqual([]);
  });
  it("does not resolve a typed driver name to one of two people with that name", () => {
    const draft = createTransportDraft();
    const data = parseSurveyCsv("참석 여부,이름,소속\nO,가상 기사,청년부\nO,가상 기사,장년부");
    const { people } = surveyTransportInput(draft, analyzeSurvey(data, defaultSurveyMapping(data.headers)));
    expect(driverIdFor(people, "가상 기사")).toBeNull();
    expect(driverIdFor(people, driverOption(people[1]))).toBe(people[1].id);
  });
});
