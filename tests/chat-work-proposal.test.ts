import { expect, it } from "vitest";
import { calendarWorkProposal, localWorkIntent } from "@/lib/chat-work-proposal";

const lateKorea = new Date("2026-11-27T15:01:00Z");

it("uses the Korean year for a single upcoming month/day and keeps an explicit clock", () => {
  expect(calendarWorkProposal('11월 28일 오후 2시에 공용 캘린더에 "회의"라고 등록해줘', lateKorea)).toEqual({
    kind: "calendar", title: "회의", date: "2026-11-28", time: "14:00", inferredYear: true,
  });
  expect(calendarWorkProposal("공동 캘린더에 2027-01-03 운영회의 추가해줘", lateKorea)).toMatchObject({ title: "운영회의", date: "2027-01-03", time: "", inferredYear: false });
});

it.each(["11월 27일", "11월 28일 또는 29일", "11월 28일은 말고", "11월 28일 14:00 또는 15:00", "11월 28일 14:00 또는 정오", "11월 31일"])("does not silently choose a date or time for %s", input => {
  expect(calendarWorkProposal(`${input} 공용 캘린더에 준비 회의 추가해줘`, lateKorea)).toBeNull();
});

it("keeps unrelated advice and travel timetables out of the work-action router", () => {
  expect(localWorkIntent("식당 몇 명까지 수용해?")).toBeNull();
  expect(localWorkIntent("실제 참가자가 몇 명인지 확인해서 내일 저녁 행사장 근처 맛집 찾아줘")).toBeNull();
  expect(localWorkIntent("공동 캘린더에 일정을 추가하는 방법 알려줘")).toBeNull();
  expect(localWorkIntent("대전역 기차 시간표 만들어줘")).toBeNull();
  expect(localWorkIntent("수련회 타임테이블을 짜 줘")).toBe("timetable");
});
