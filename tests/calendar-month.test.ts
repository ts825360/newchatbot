import { describe, expect, it } from "vitest";

import { buildCalendarMonth, shiftCalendarMonth } from "../lib/calendar-month";

describe("calendar month helpers", () => {
  it("builds a six-week grid for a Google Calendar style month view", () => {
    const month = buildCalendarMonth(2026, 8);

    expect(month.label).toBe("2026년 8월");
    expect(month.cells).toHaveLength(42);
    expect(month.cells[0]).toMatchObject({
      date: "2026-07-26",
      inCurrentMonth: false
    });
    expect(month.cells.at(-1)).toMatchObject({
      date: "2026-09-05",
      inCurrentMonth: false
    });
    expect(month.cells.filter((cell) => cell.inCurrentMonth)).toHaveLength(31);
  });

  it("moves across year boundaries when changing months", () => {
    expect(shiftCalendarMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftCalendarMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});
