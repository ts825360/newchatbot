import { expect, it } from "vitest";
import { resolveCalendarHours } from "../lib/calendar-time";

it.each([
  ["", "", { start: "00:00", end: "22:00", nextDay: false }],
  ["오후 7:05", "", { start: "19:05", end: "20:05", nextDay: false }],
  ["23:30", "", { start: "23:30", end: "00:30", nextDay: true }],
  ["09:00", "10:15", { start: "09:00", end: "10:15", nextDay: false }],
  ["", "10:15", null],
  ["09:00", "09:00", null],
  ["10:00", "09:00", null],
])("resolves start %s and end %s", (start, end, expected) => {
  expect(resolveCalendarHours(start, end)).toEqual(expected);
});
