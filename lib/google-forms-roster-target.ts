import type { ConversationScope } from "./conversation-scope";

const key = "church:google-forms-roster-target:v1";
const validity = 30 * 60 * 1000;
type RosterTarget = { scope: ConversationScope; label: string; at: number };

export function setGoogleFormsRosterTarget(scope: ConversationScope, label: string) {
  sessionStorage.setItem(key, JSON.stringify({ scope, label: label.slice(0, 240), at: Date.now() } satisfies RosterTarget));
}

export function getGoogleFormsRosterTarget(accountId: string | undefined) {
  try {
    const target = JSON.parse(sessionStorage.getItem(key) ?? "null") as RosterTarget | null;
    if (!accountId || target?.scope?.accountId !== accountId || !target.scope.roomId || typeof target.scope.roomId !== "string" ||
      !target.scope.conversationId || typeof target.scope.conversationId !== "string" || typeof target.label !== "string" ||
      !Number.isFinite(target.at) || Date.now() - target.at >= validity || target.at > Date.now()) return undefined;
    return target;
  } catch { return undefined; }
}

export function clearGoogleFormsRosterTarget() {
  sessionStorage.removeItem(key);
}
