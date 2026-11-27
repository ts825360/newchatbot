import { isSurveyWorkVersion } from "./chat-survey-draft";

export const surveyStates = ["review_pending", "creation_unconfirmed", "questions_unconfirmed", "unpublished_form_created"] as const;
export type SurveyStatus = typeof surveyStates[number];
type DraftOperation = "create" | "edit" | "regenerate";
export type ChatWorkResult = { kind: "survey" } & (
  { operation: DraftOperation; version: number; status: "review_pending" }
  | { operation: "status" | "show"; version: number; status: SurveyStatus }
  | { operation: "status"; version: null; status: "not_found" }
);

export function isChatWorkResult(value: unknown): value is ChatWorkResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { kind, operation, version, status } = value as Record<string, unknown>;
  if (Object.keys(value).length !== 4 || kind !== "survey") return false;
  if (status === "not_found") return operation === "status" && version === null;
  if (!isSurveyWorkVersion(version)) return false;
  if (operation === "show" || operation === "status") return surveyStates.some(state => state === status);
  return (operation === "create" || operation === "edit" || operation === "regenerate") && status === "review_pending";
}

const detail: Record<SurveyStatus, string> = {
  review_pending: "검토 대기 중입니다. 별도 승인 전에는 Google Forms에 생성하지 않습니다.",
  creation_unconfirmed: "Google Forms 생성 결과를 확인하지 못했습니다. 중복 생성을 피하려면 Google Forms에서 먼저 확인해 주세요.",
  questions_unconfirmed: "Google Forms의 미게시 양식은 생성됐지만 문항 반영 여부는 확인되지 않았습니다.",
  unpublished_form_created: "Google Forms에 미게시 초안으로 생성한 기록이 있습니다. 현재 게시·응답 수집 여부는 확인하지 않았습니다.",
};

export function chatWorkResultText(result: ChatWorkResult) {
  if (result.status === "not_found") return "이 개인 대화에는 저장된 참가 설문 초안이 없어요.";
  const operations = { create: "초안 저장", edit: "수정본 저장", regenerate: "새 검토본 저장", show: "저장된 초안 조회", status: "설문 상태 조회" };
  return `참가 설문 버전 ${result.version} · ${operations[result.operation]}. ${detail[result.status]}`;
}

export const toolWorkflowLimited = "tool-workflow-limited";
export const toolWorkflowLimitedText = "이 답변에서는 도구 작업을 여기까지 진행했습니다. 나머지 작업은 완료로 처리하지 않았습니다.";
