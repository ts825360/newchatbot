import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SurveyDraft } from "../chat-survey-draft";
import type { ConversationScope } from "../conversation-scope";
import { chatWorkResultText } from "../chat-work-result";

export const surveyWorkspaceKey = (scope: Pick<ConversationScope, "roomId" | "conversationId">) =>
  JSON.stringify([scope.roomId, scope.conversationId]);
export const surveyVersionKey = (draft: Pick<SurveyDraft, "id" | "version">) =>
  createHash("sha256").update(JSON.stringify(["survey-work", draft.id, draft.version])).digest("hex");

// The immutable work version and the outbound claim are the sources of truth.
// Do not cache approval separately, or include editor links or account details in tool output.
export function surveyWorkState(db: DatabaseSync, scope: ConversationScope, draft: SurveyDraft) {
  const stored = db.prepare(`SELECT source_message_id,created_at FROM chat_work_versions
    WHERE owner_id=? AND room_id=? AND conversation_id=? AND work_id=? AND version=? AND kind='survey'`)
    .get(scope.accountId, scope.roomId, scope.conversationId, draft.id, draft.version);
  const row = db.prepare(`SELECT MAX(CASE WHEN completed=1 THEN 3 WHEN form_id IS NOT NULL THEN 2 ELSE 1 END) AS stage
    FROM google_form_drafts WHERE user_id=? AND scope_key=? AND title_hash=?`)
    .get(scope.accountId, surveyWorkspaceKey(scope), surveyVersionKey(draft));
  const [status, next] = row?.stage === 3 ? ["unpublished_form_created", "check_in_google"] as const
    : row?.stage === 2 ? ["questions_unconfirmed", "check_in_google"] as const
    : row?.stage === 1 ? ["creation_unconfirmed", "verify_before_retry"] as const
    : ["review_pending", "review_draft"] as const;
  return {
    artifactId: draft.id, sourceMessageId: String(stored?.source_message_id ?? ""), recordedAt: String(stored?.created_at ?? ""),
    kind: "survey" as const, version: draft.version, goal: "participant_registration" as const,
    scope: "private_conversation" as const, source: "saved_work_version" as const, status, next,
    conditions: { templateVersion: draft.templateVersion, questions: draft.items.filter(item => item.kind !== "section").length,
      requiredQuestions: draft.items.filter(item => item.kind !== "section" && item.required).length,
      attendanceBranch: true },
    unconfirmed: ["publication", "response_collection"] as const,
  };
}

export type SurveyWorkState = ReturnType<typeof surveyWorkState>;

export function publicSurveyWorkState(state: SurveyWorkState) {
  const { kind, version, goal, scope, source, status, next, conditions, unconfirmed } = state;
  return { found: true, kind, version, goal, scope, source, status, next, conditions, unconfirmed };
}

export function surveyStatusText(state: SurveyWorkState | null) {
  return chatWorkResultText(state
    ? { kind: "survey", operation: "status", version: state.version, status: state.status }
    : { kind: "survey", operation: "status", version: null, status: "not_found" });
}
