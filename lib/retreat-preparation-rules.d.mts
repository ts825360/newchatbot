import type { MeetingAvailability, RetreatBlockedTask, RetreatField, RetreatFieldKey, RetreatTask } from "./retreat-preparation";

export type RetreatRuleFact = {
  key: RetreatFieldKey;
  editionId: string;
  source: "confirmed_record" | "draft_note";
  status: "confirmed" | "unverified" | "deferred" | "not_applicable";
  ref: string;
  value?: string | boolean;
};

export function evaluateRetreatPreparation(input: {
  editionId: string;
  year: number;
  meeting: MeetingAvailability;
  facts: RetreatRuleFact[];
  completedTaskIds: string[];
  referenceEditionIds?: string[];
}): {
  fields: (RetreatField & { refs: string[] })[];
  available: RetreatTask[];
  deferred: RetreatBlockedTask[];
  next: RetreatTask[];
};
