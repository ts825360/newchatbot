import { applyConditionPatch } from "./chat-continuity";

export type WorkCondition<T> = {
  value: T;
  source: "user" | "event" | "assistant" | "search" | "calculation";
  scope?: "request" | "task" | "conversation" | "event" | "account";
  nature?: "required" | "preference" | "assumption" | "exclusion";
  status?: "confirmed" | "candidate" | "unconfirmed" | "conflict" | "needs-review";
  revision?: string;
};

export type WorkConditions<T extends object> = { [K in keyof T]?: WorkCondition<T[K]> };

export function resolveWorkConditions<T extends object>(stored: WorkConditions<T>, patch: WorkConditions<T>) {
  const persistent = { ...patch };
  for (const key of Object.keys(persistent) as (keyof T)[]) if (persistent[key]?.scope === "request") delete persistent[key];
  return { active: applyConditionPatch<WorkConditions<T>>(stored, patch), persistent: applyConditionPatch<WorkConditions<T>>(stored, persistent) };
}

export function isWorkCondition<T>(data: unknown, valid: (value: unknown) => value is T): data is WorkCondition<T> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const x = data as Record<string, unknown>;
  return Object.keys(x).every(key => ["value", "source", "scope", "nature", "status", "revision"].includes(key))
    && valid(x.value) && ["user", "event", "assistant", "search", "calculation"].some(source => source === x.source)
    && (x.scope === undefined || ["request", "task", "conversation", "event", "account"].some(scope => scope === x.scope))
    && (x.nature === undefined || ["required", "preference", "assumption", "exclusion"].some(nature => nature === x.nature))
    && (x.status === undefined || ["confirmed", "candidate", "unconfirmed", "conflict", "needs-review"].some(status => status === x.status))
    && (x.revision === undefined || typeof x.revision === "string" && /^\d{1,20}$/.test(x.revision));
}
