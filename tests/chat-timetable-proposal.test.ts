import { describe, expect, it } from "vitest";
import { buildChatTimetable, mergeChatTimetable } from "@/lib/chat-timetable-proposal";
import { emptyTimetable, isTimetable, timetableDate, timetableMaxDays, timetableMidnight, timetableMorning, type Timetable, type TimetableEntry } from "@/lib/timetable";

const entry = (id: string, start: number, end: number, day = 1): TimetableEntry => ({ id, title: id, day, start, end, kind: "program" });
const plan = (entries: TimetableEntry[], startDate = "", days = 1): Timetable => ({ version: 1, days, startDate, entries });

describe("buildChatTimetable", () => {
  it("builds a deterministic and fully tentative 2-night draft without interpreting bookings", () => {
    const request = "2박 3일 수련회 시간표 짜줘. 22:15 호텔 예약";
    const draft = buildChatTimetable({ category: "retreat" }, request);
    expect(draft).toEqual(buildChatTimetable({ category: "retreat" }, request));
    expect(draft).toMatchObject({ days: 3, startDate: "" });
    expect(isTimetable(draft)).toBe(true);
    expect([...new Set(draft.entries.map(item => item.day))]).toEqual([1, 2, 3]);
    expect(draft.entries.some(item => item.kind === "meal")).toBe(true);
    for (const item of draft.entries) {
      expect(item.title).toMatch(/^\[초안\] /);
      expect(item.title).not.toMatch(/호텔|예약/);
      expect(item.start).toBeGreaterThanOrEqual(timetableMorning);
      expect(item.start).not.toBe(22 * 60 + 15);
      expect(item.end).toBeLessThanOrEqual(timetableMidnight);
      expect(draft.entries.some(other => other !== item && other.day === item.day && item.start < other.end && other.start < item.end)).toBe(false);
    }
  });

  it("uses the inclusive stored range across years rather than the requested duration", () => {
    const draft = buildChatTimetable({ date: "2026-12-31", endDate: "2027-01-02" }, "1박 2일 일정 초안");
    expect(draft).toMatchObject({ days: 3, startDate: "2026-12-31" });
    expect(timetableDate(draft.startDate, draft.days)).toBe("2027-01-02");
    expect(buildChatTimetable({ date: "2026-12-31", endDate: "2026-12-31" }, "2박3일 시간표").days).toBe(1);
  });

  it("anchors an explicit duration to a lone valid start, but never invents a missing start", () => {
    expect(buildChatTimetable({ date: "2026-11-26" }, "2박3일 일정")).toMatchObject({ startDate: "2026-11-26", days: 3 });
    expect(buildChatTimetable({ date: "2026-02-29", endDate: "2026-03-02" }, "다음 달 시간표")).toMatchObject({ startDate: "", days: 1 });
    expect(buildChatTimetable({ date: "2026-11-26", endDate: "2026-11-24" }, "시간표")).toMatchObject({ startDate: "2026-11-26", days: 1 });
  });

  it.each(["2박 4일", "1박2일 또는 2박3일", "2박3일 또는 4일", "1박 혹은 2박3일", "-2박3일", "1.2박3일",
    "1 ~ 2박3일", "2박3일은 말고", "2박3일 이내", "11월 3일", "3일차"])(
    "does not infer an overnight duration from %s", request => {
      expect(buildChatTimetable({}, request).days).toBe(1);
    },
  );

  it("accepts a standalone day count only when phrased as a duration", () => {
    expect(buildChatTimetable({}, "4일 동안 진행할 행사 시간표").days).toBe(4);
  });

  it("defaults an undated retreat to two days with clear travel and meal blocks", () => {
    const draft = buildChatTimetable({ category: "retreat" }, "대략적인 타임테이블");
    expect(draft).toMatchObject({ days: 2, startDate: "" });
    expect(draft.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "travel", day: 1 }), expect.objectContaining({ kind: "travel", day: 2 })]));
    expect(buildChatTimetable({ category: "retreat" }, "당일 시간표").days).toBe(1);
  });

  it("bounds proposals to the grid and to representable calendar dates", () => {
    expect(buildChatTimetable({}, "30박31일 시간표").days).toBe(timetableMaxDays);
    expect(buildChatTimetable({ date: "2026-11-26", endDate: "2026-12-26" }, "초안").days).toBe(timetableMaxDays);
    const boundary = buildChatTimetable({ date: "9999-12-30" }, "2박3일 시간표");
    expect(boundary).toMatchObject({ startDate: "9999-12-30", days: 2 });
    expect(isTimetable(boundary)).toBe(true);
  });

  it("offers single-day worship and meeting blocks, while using a generic multi-day outline", () => {
    const worship = buildChatTimetable({ category: "worship" }, "행사 시간표");
    const meeting = buildChatTimetable({}, "운영 회의 시간표");
    expect(worship).toMatchObject({ days: 1 });
    expect(worship.entries.some(item => item.title.includes("예배"))).toBe(true);
    expect(meeting.entries.some(item => item.title.includes("안건"))).toBe(true);
    const multiDay = buildChatTimetable({ category: "worship" }, "1박2일 일정");
    expect(multiDay.days).toBe(2);
    expect(multiDay.entries.some(item => item.title.includes("예배"))).toBe(false);
  });
});

describe("mergeChatTimetable", () => {
  it("adopts proposal metadata into a pristine plan and never shrinks an established plan", () => {
    const draft = plan([entry("first", 540, 600)], "2026-11-26");
    expect(mergeChatTimetable(emptyTimetable(), draft, "one")).toMatchObject({ plan: { days: 1, startDate: "2026-11-26" }, recovered: false });
    const keep = entry("keep", 540, 600, 5);
    const merged = mergeChatTimetable(plan([keep], "2026-11-26", 5), { ...draft, startDate: "" }, "one");
    expect(merged.plan).toMatchObject({ days: 5, startDate: "2026-11-26", entries: [keep, { day: 1, start: 540, end: 600 }] });
    expect(mergeChatTimetable(plan([entry("earlier", 480, 540)]), { ...draft, days: 3 }, "one").plan)
      .toMatchObject({ days: 3, startDate: "2026-11-26" });
  });

  it("derives stable storage-safe IDs across retries and preserves edited blocks", () => {
    const draft = plan([entry("first", 540, 600), entry("second", 600, 660)], "2026-11-26");
    const proposalId = "대화: " + "x".repeat(300);
    const first = mergeChatTimetable(emptyTimetable(), draft, proposalId);
    expect(first.recovered).toBe(false);
    expect(isTimetable(first.plan)).toBe(true);
    const parseBack = JSON.parse(JSON.stringify(first.plan)) as Timetable;
    parseBack.startDate = "2026-11-27";
    parseBack.entries[0].title = "사용자가 검토한 일정";
    const retry = mergeChatTimetable(parseBack, { ...draft, entries: [...draft.entries].reverse() }, proposalId);
    expect(retry).toEqual({ plan: parseBack, recovered: true });
    expect(mergeChatTimetable(emptyTimetable(), draft, proposalId + "y").plan.entries[0].id).not.toBe(first.plan.entries[0].id);
  });

  it("adds only missing proposal entries and keeps pre-existing manual overlaps", () => {
    const draft = plan([entry("first", 540, 600), entry("second", 600, 660)]);
    const [previouslySaved] = mergeChatTimetable(emptyTimetable(), draft, "one").plan.entries;
    const manual = [entry("manual-a", 480, 520), entry("manual-b", 500, 540)];
    const current = plan([...manual, previouslySaved]);
    const result = mergeChatTimetable(current, draft, "one");
    expect(result).toMatchObject({ recovered: false, plan: { entries: [...manual, previouslySaved, { title: "second" }] } });
    expect(current.entries).toHaveLength(3);
  });

  it("rejects different start dates and an unrepresentable combined date range", () => {
    const draft = plan([entry("new", 600, 660)], "2026-11-27");
    expect(() => mergeChatTimetable(plan([], "2026-11-26"), draft, "one")).toThrow(/시작일/);
    expect(() => mergeChatTimetable(plan([], "9999-12-31"), { ...draft, startDate: "", days: 2 }, "one")).toThrow(/날짜/);
  });

  it("rejects overlaps with stored entries or within the proposal without mutating the inputs", () => {
    const current = plan([entry("existing", 540, 600)]);
    const draft = plan([entry("adjacent", 600, 660), entry("overlap", 570, 585)]);
    expect(() => mergeChatTimetable(current, draft, "one")).toThrow(/겹/);
    expect(current.entries).toEqual([entry("existing", 540, 600)]);
    expect(draft.entries).toEqual([entry("adjacent", 600, 660), entry("overlap", 570, 585)]);
    expect(() => mergeChatTimetable(emptyTimetable(), plan([entry("first", 540, 600), entry("other", 570, 660)]), "one")).toThrow(/겹/);
  });

  it("rejects malformed or empty drafts and blank proposal IDs", () => {
    expect(() => mergeChatTimetable(emptyTimetable(), plan([entry("short", 540, 545)]), "one")).toThrow(/초안/);
    expect(() => mergeChatTimetable(emptyTimetable(), plan([]), "one")).toThrow(/초안/);
    expect(() => mergeChatTimetable(emptyTimetable(), plan([entry("new", 540, 600)]), " ")).toThrow(/식별자/);
  });
});
