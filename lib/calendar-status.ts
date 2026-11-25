import type { CalendarEventStatus, EditableCalendarStatus } from "./types";

export const calendarStatusDisplay = {
  confirmed: { label: "확정", tone: "green" },
  pending: { label: "보류", tone: "amber" },
  other: { label: "기타", tone: "neutral" },
} as const;

export function isCalendarStatus(value: unknown): value is CalendarEventStatus {
  return typeof value === "string" && ["confirmed", "pending", "other", "candidate", "needsReview", "changed"].includes(value);
}

export function normalizeCalendarStatus(status: CalendarEventStatus): EditableCalendarStatus {
  if (status === "candidate" || status === "needsReview") return "pending";
  return status === "changed" ? "other" : status;
}
