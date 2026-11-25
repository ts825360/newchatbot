import type { Permission } from "./types";

export const retreatReviewPermissions = ["viewRoom", "chat", "viewCalendar", "viewChecklist"] as const satisfies readonly Permission[];
export const retreatReviewAccountHeader = "x-preparation-account";
export const meetingOptions = { unknown: "미정", available: "회의 가능", unavailable: "회의 어려움" } as const;
export type MeetingAvailability = keyof typeof meetingOptions;
export type RetreatFieldKey = "date" | "venue" | "transport" | "lodging" | "meals" | "agenda" | "water-activity" | "water-safety";
export type RetreatFieldStatus = "confirmed" | "needs_review" | "deferred" | "not_applicable";
export type RetreatReason = "confirmed" | "missing" | "unverified" | "invalid_date" | "conflicting_records" | "administrative_hold" | "required_field" |
  "no_water_activity" | "water_plan_unconfirmed" | "meeting_unknown" | "meeting_unavailable";

export type RetreatTask = { id: string; label: string };
export type RetreatReference = { taskId: string; documentId: string; sourceTitle: string; excerpt: string };
export type RetreatBlockedTask = RetreatTask & { blockedBy: { key: RetreatFieldKey | "meeting"; reason: RetreatReason }[] };
export type RetreatField = {
  key: RetreatFieldKey; label: string; status: RetreatFieldStatus; reason: RetreatReason; value?: string | boolean;
};
export type RetreatReview = {
  roomId: string; conversationId: string; year: number;
  fields: (RetreatField & { evidence: "room" | "calendar" | "location" | "transport" | "checklist" | null })[];
  next: RetreatTask[]; deferred: RetreatBlockedTask[]; references?: RetreatReference[];
};
