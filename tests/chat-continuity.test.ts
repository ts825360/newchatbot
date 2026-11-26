// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyConditionPatch, classifyContinuation, resolveVisitBasis } from "@/lib/chat-continuity";
import { diningVisit } from "@/lib/server/chat-dining";

const now = new Date("2026-11-26T08:00:00Z");
const event = { start: "2027-01-08", end: "2027-01-09" };

describe("conversation continuity", () => {
  it("changes only mentioned fields; null clears a condition without changing the input", () => {
    const original = { people: 24, budget: 20000, location: "대표 장소", date: "2027-01-08", exclusions: ["해산물"] };
    const changed = applyConditionPatch(original, { people: 30, budget: undefined });
    expect(changed).toEqual({ ...original, people: 30 });
    expect(original.people).toBe(24);
    expect(applyConditionPatch({ budget: 20000 as number | null, date: original.date }, { budget: null })).toEqual({ budget: null, date: original.date });
  });
  it.each([
    ["두 번째 안의 위험을 설명해줘", "reference"],
    ["인원만 36명으로 바꿔", "revise"],
    ["예산은 45만원이야", "supplement"],
    ["이 요청은 취소해", "cancel"],
    ["이제 차량부터 알아보자", "new"],
    ["예전에 권한을 취소한 이유는 뭐야?", "new"],
  ])("distinguishes a continuation without depending on the work domain (%s)", (message, action) => {
    expect(classifyContinuation(message)).toBe(action);
  });
  it("separates planning, on-site requests, and a date that is still undecided", () => {
    expect(resolveVisitBasis("수련회 첫날 저녁", event, "2026-11-26")).toMatchObject({ date: "2027-01-08", origin: "event", eventDay: 1 });
    expect(resolveVisitBasis("날짜 미정이야", event, "2026-11-26")).toMatchObject({ date: null, origin: "undecided" });
    expect(diningVisit("숙소 근처 식당 후보 추천해줘", now)).toMatchObject({ date: null, visitTime: null });
    expect(diningVisit("현재 기획 중인 행사에 식당 알아봐줘", now, "restaurant", event)).toMatchObject({ date: null, visitTime: null });
    expect(diningVisit("지금 바로 갈 식당 추천해줘", now, "restaurant", event)).toMatchObject({ date: "2026-11-26", visitTime: "17:00" });
  });
  it("keeps hypothetical visit conditions and refreshes event-derived dates for a continuing task", () => {
    const first = diningVisit("첫날 저녁 도보로 한식, 24명, 1인 2만원 이하", now, "restaurant", event)!;
    const next = diningVisit("36명으로 바꾸고 조개구이는 제외해줘", now, "restaurant", { start: "2027-01-15", end: "2027-01-16" }, first);
    expect(next).toMatchObject({ date: "2027-01-15", visitTime: "18:00", groupBand: "20~49명", transport: "walking", cuisine: ["한식"], excludedCuisine: ["조개구이"], budgetPerPerson: 20000 });
    const hypothetical = diningVisit("가정으로 2027-02-22 저녁에 식당 추천해줘", now, "restaurant", event)!;
    expect(diningVisit("인원만 8명으로", now, "restaurant", { start: "2027-02-13", end: "2027-02-14" }, hypothetical)?.date).toBe("2027-02-22");
  });
});
