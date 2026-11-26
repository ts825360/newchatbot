import { describe, expect, it } from "vitest";
import { emptyTimetable, isTimetable, placeTimetableEntries, timetableDate, timetableTime, type TimetableEntry } from "@/lib/timetable";

const event = (id: string, start: number, end: number, day = 1): TimetableEntry => ({ id, title: id, day, start, end, kind: "program" });

describe("private event timetable", () => {
  it("defaults to two blank days and labels midnight and calendar rollovers", () => {
    expect(emptyTimetable()).toEqual({ version: 1, days: 2, startDate: "", entries: [] });
    expect(timetableDate("2026-12-31", 2)).toBe("2027-01-01");
    expect(timetableDate("", 2)).toBe("");
    expect(timetableTime(1440)).toBe("00:00");
  });

  it("rejects days outside the plan, invalid dates, duplicate ids and invalid durations", () => {
    const base = emptyTimetable();
    expect(isTimetable({ ...base, entries: [event("night", 1380, 1440, 2)] })).toBe(true);
    expect(isTimetable({ ...base, days: 1, entries: [event("day2", 420, 480, 2)] })).toBe(false);
    expect(isTimetable({ ...base, startDate: "2026-02-29" })).toBe(false);
    expect(isTimetable({ ...base, startDate: "9999-12-31" })).toBe(false);
    expect(isTimetable({ ...base, entries: [event("repeat", 0, 60), event("repeat", 60, 120)] })).toBe(false);
    expect(isTimetable({ ...base, entries: [event("short", 0, 14)] })).toBe(false);
    expect(isTimetable({ ...base, entries: [event("over", 1380, 1441)] })).toBe(false);
  });

  it("places long events, clusters overlaps and allows the next block its full lane width", () => {
    const result = placeTimetableEntries([event("a", 420, 600), event("b", 480, 510), event("c", 600, 660)]);
    expect(result.map(({ top, duration, lane, lanes }) => ({ top, duration, lane, lanes }))).toEqual([
      { top: 0, duration: 180, lane: 0, lanes: 2 },
      { top: 60, duration: 30, lane: 1, lanes: 2 },
      { top: 180, duration: 60, lane: 0, lanes: 1 },
    ]);
  });

  it("clips pre-0700 entries in the main grid without altering their stored times", () => {
    const early = event("early", 390, 450);
    expect(placeTimetableEntries([event("hidden", 0, 420), early])).toEqual([
      { entry: early, top: 0, duration: 30, lane: 0, lanes: 1 },
    ]);
  });
});
