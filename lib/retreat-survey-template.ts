import { surveyFields } from "./transport-survey";
import { transportGenderLabels } from "./transport";

type SurveyOption = Readonly<{ value: string; isOther?: true } & (
  | { goToAction?: "NEXT_SECTION" | "SUBMIT_FORM"; goToSection?: never }
  | { goToSection: string; goToAction?: never }
)>;
type Question = { title: string; required: boolean; description?: string };
export type SurveyItem = Readonly<{ id: string } & (
  | { kind: "section"; title: string }
  | (Question & { kind: "choice"; options: readonly SurveyOption[] })
  | (Question & { kind: "text"; paragraph: boolean })
)>;

const choice = (id: string, title: string, required: boolean, options: (string | SurveyOption)[], otherAction?: SurveyOption["goToAction"] | false): Extract<SurveyItem, { kind: "choice" }> => ({
  kind: "choice", title, required, options: [
    ...options.map(option => typeof option === "string" ? { value: option } : option),
    ...(otherAction === false ? [] : [{ value: "기타", isOther: true as const, ...(otherAction && { goToAction: otherAction }) }]),
  ], id,
});
const section = (id: string, title: string): SurveyItem => ({ kind: "section", title, id });
const text = (id: string, title: string, required: boolean, paragraph: boolean, description?: string): SurveyItem =>
  ({ kind: "text", title, required, paragraph, ...(description && { description }), id });
const branch = (value: string, goToSection: string): SurveyOption => ({ value, goToSection });

const attendeeItems = [
  choice("attendance", surveyFields.attendance, true, [{ value: "참석", goToAction: "NEXT_SECTION" }, { value: "불참", goToAction: "SUBMIT_FORM" }], "NEXT_SECTION"),
  section("attendees", "참석자 정보"),
  choice("department", surveyFields.department, true, ["유초등부", "아동부", "청소년부", "청년부", "장년부", "명단 확인 필요"]),
  text("name", surveyFields.name, true, false),
  choice("gender", surveyFields.gender, false, [...Object.values(transportGenderLabels), "응답하지 않음"], false),
  choice("lodging", surveyFields.lodging, true, ["가족방", "단체방"]),
];
const notes = text("notes", surveyFields.notes, false, true);

// Keep the original form contract for title-only previews and persisted v1 drafts.
export const retreatSurveyTemplate: readonly SurveyItem[] = [
  ...attendeeItems, choice("movement", surveyFields.movement, false, ["왕복 자차", "단체 이동", "가족 차량 동승"]), notes,
];

function transportItems(leg: "outbound" | "return", label: "출발" | "귀가", next: string): SurveyItem[] {
  const id = (suffix: string) => `${leg}-${suffix}`;
  const seatSection = id("seat-section");
  const ownership = id("ownership");
  const driver = id("driver");
  const rider = id("rider");
  const other = id("other-section");
  // The provider and other pages fall through; sibling pages rejoin via a required choice.
  return [
    section(id("start"), `${label} 이동 정보`),
    choice(id("method"), `${label} 이동수단`, true, [
      branch("자차 이동", seatSection), branch("단체 이동", next), branch("가족 차량 동승", ownership),
      branch("다른 참가자와 차량 동승", ownership), branch("기타", other),
      ...(leg === "return" ? [branch("출발할 때와 동일", next), branch("미정", next)] : []),
    ], false),
    section(ownership, `${label} 차량 제공 확인`),
    { ...choice(id("vehicle-provider"), `${label} 차량 제공 여부`, true, [
      branch("예, 제가 차량을 제공합니다.", driver), branch("아니요, 다른 사람의 차량에 탑승합니다.", rider),
    ], false), description: "본인이 차량을 제공하나요?" },
    section(driver, `${label} 기존 동승자 확인`),
    text(id("companions"), `${label} 기존 동승자 이름`, false, false, "함께 이동하기로 한 사람의 이름을 쉼표로 구분해 적어 주세요."),
    section(seatSection, `${label} 추가 좌석`),
    text(id("seats"), `${label} 추가 탑승 가능 인원`, true, false,
      "운전자, 기존 동승자, 짐 공간을 제외한 추가 탑승 가능 인원을 숫자로 적어 주세요. 없으면 0을 입력해 주세요."),
    choice(id("after-seats"), `${label} 좌석 입력 후 계속`, true, [branch("계속", next)], false),
    section(rider, `${label} 동승 정보`),
    text(id("provider-name"), `${label} 차량 제공자 이름`, true, false),
    choice(id("after-rider"), `${label} 동승 정보 입력 후 계속`, true, [branch("계속", next)], false),
    section(other, `${label} 기타 이동`),
    text(id("other-method"), `${label} 기타 이동 방법`, true, true, "기차, 역 픽업, 개별 이동 등 이동 방법을 적어 주세요. 미정이면 미정이라고 적어 주세요."),
  ];
}

export const retreatTransportBlock: readonly SurveyItem[] = [
  ...transportItems("outbound", "출발", "return-start"),
  ...transportItems("return", "귀가", "notes-section"),
  section("notes-section", "기타 특이사항 작성"),
];
export const retreatSurveyTemplateV2: readonly SurveyItem[] = [...attendeeItems, ...retreatTransportBlock, notes];
