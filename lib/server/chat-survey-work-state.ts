import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SurveyDraft } from "../chat-survey-draft";
import type { ConversationScope } from "../conversation-scope";

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
  if (!state) return "이 개인 대화에는 저장된 참가 설문 초안이 없어요.";
  const details: Record<SurveyWorkState["status"], string> = {
    review_pending: "검토 대기 중입니다. 문항을 확인하고 승인해야 Google Forms에 미게시 초안이 생성됩니다.",
    creation_unconfirmed: "Google Forms 생성 결과를 확인하지 못했습니다. 중복 생성을 피하려면 Google Forms에서 먼저 확인해 주세요.",
    questions_unconfirmed: "Google Forms의 미게시 양식은 생성됐지만 문항 반영은 확인되지 않았습니다. Google Forms에서 확인해 주세요.",
    unpublished_form_created: "Google Forms에 미게시 초안으로 생성한 기록이 있습니다. 현재 게시·응답 수집 여부는 확인하지 않았습니다.",
  };
  return `참가 설문 버전 ${state.version} · ${details[state.status]}`;
}
