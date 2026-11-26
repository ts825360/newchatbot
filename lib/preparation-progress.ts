export const preparationProgressConsent = "preparation-summary-v1";

export type PreparationProgress = {
  state: "ready" | "remaining" | "pending";
  percent: number | null;
  notes: string[];
};

export type SavedPreparationProgress = {
  report: PreparationProgress | null;
  stale: boolean;
};
