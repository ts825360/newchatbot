import { surveyFields } from "./transport-survey";

type SurveyOption = Readonly<{ value: string; goToAction?: "NEXT_SECTION" | "SUBMIT_FORM" }>;
type Question = { title: string; required: boolean; description?: string };
type SurveyItem = Readonly<
  | { kind: "section"; title: string }
  | (Question & { kind: "choice"; options: readonly SurveyOption[] })
  | (Question & { kind: "text"; paragraph: boolean })
>;

const choice = (title: string, required: boolean, options: (string | SurveyOption)[]): SurveyItem => ({
  kind: "choice", title, required, options: options.map(option => typeof option === "string" ? { value: option } : option),
});

export const retreatSurveyTemplate: readonly SurveyItem[] = [
  choice(surveyFields.attendance, true, [{ value: "참석", goToAction: "NEXT_SECTION" }, { value: "불참", goToAction: "SUBMIT_FORM" }]),
  { kind: "section", title: "참석자 정보" },
  choice(surveyFields.department, true, ["유초등부", "아동부", "청소년부", "청년부", "장년부", "명단 확인 필요"]),
  { kind: "text", title: surveyFields.name, required: true, paragraph: false },
  choice(surveyFields.lodging, true, ["가족방", "단체방"]),
  choice(surveyFields.movement, false, ["단체 이동", "왕복 자차", "왕복 개별 이동", "편도 개별 이동", "가족 차량 동승", "다른 차량 동승", "미정", "기타"]),
  { kind: "text", title: surveyFields.notes, required: false, paragraph: true },
  { kind: "text", title: surveyFields.family, required: false, paragraph: false, description: "가족방을 선택한 경우, 함께 묵는 가족이 같은 코드를 입력해 주세요." },
];
