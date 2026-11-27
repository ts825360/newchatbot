// @vitest-environment node
import { expect, it } from "vitest";
import { formIdFromEditorUrl, formResponseSurvey } from "@/lib/google-forms-import";
import { analyzeSurvey, mergeGoogleSurvey } from "@/lib/transport-survey";
import { createTransportDraft } from "@/lib/transport";

const formId = "fakeFormId_01";
const form = { items: [
  { title: "참석 여부", questionItem: { question: { questionId: "a" } } },
  { title: "이름", questionItem: { question: { questionId: "b" } } },
] };
const row = (responseId: string, name: string, attendance = "참석") => ({
  responseId, respondentEmail: "unused@example.test",
  answers: { a: { textAnswers: { answers: [{ value: attendance }] } }, b: { textAnswers: { answers: [{ value: name }] } } }
});

it("accepts only Google Forms editor URLs", () => {
  expect(formIdFromEditorUrl("https://docs.google.com/forms/d/" + formId + "/edit")).toBe(formId);
  for (const url of ["https://forms.gle/sample", "https://docs.google.com/forms/d/e/sample/viewform", "https://docs.google.com.example.test/forms/d/sample/edit"]) {
    expect(() => formIdFromEditorUrl(url)).toThrow();
  }
});

it("maps by question ID, does not import automatic email, and only adds new attenders", () => {
  const input = createTransportDraft();
  const a = formResponseSurvey(formId, form, [row("r1", "가상 참가자"), row("r2", "가상 불참", "불참")]);
  expect(JSON.stringify(a)).not.toContain("unused@example.test");
  const initial = mergeGoogleSurvey(input, a);
  expect(initial.people.map((person) => person.name)).toEqual(["가상 참가자"]);
  initial.people[0].name = "수동 수정";
  const b = formResponseSurvey(formId, form, [row("r3", "새 참가자"), row("r1", "구글에서 변경"), row("r2", "가상 불참", "불참")]);
  const merged = mergeGoogleSurvey(initial, b);
  expect(merged.people.map((person) => person.name)).toEqual(["수동 수정", "새 참가자"]);
  expect(merged.people[0].id).toBe(initial.people[0].id);
  expect(mergeGoogleSurvey(merged, b)).toBe(merged);
});

it("keeps typed choices and does not require the family ID column in new forms", () => {
  const attendee = row("r1", "가상 참가자");
  const custom = { ...attendee, answers: {
    ...attendee.answers,
    c: { textAnswers: { answers: [{ value: "토요일만 개인 이동" }] } },
    d: { textAnswers: { answers: [{ value: "여성" }] } },
  } };
  const survey = formResponseSurvey(formId, { items: [...form.items,
    { title: "성별", questionItem: { question: { questionId: "d" } } },
    { title: "이동수단", questionItem: { question: { questionId: "c" } } },
  ] }, [custom]);
  expect(analyzeSurvey(survey.data, survey.mapping)).toMatchObject({ canImport: true, entries: [{ movement: "토요일만 개인 이동", movementReview: true }] });
  expect(mergeGoogleSurvey(createTransportDraft(), survey).people[0]).toMatchObject({ familyId: "", gender: "female", outboundEntry: "설문 이동수단 확인 필요" });

  const uncertain = formResponseSurvey(formId, form, [row("r2", "가상 응답자", "토요일 오후에야 참석 여부를 알 수 있어요")]);
  expect(analyzeSurvey(uncertain.data, uncertain.mapping)).toMatchObject({ counts: { attending: 0, unresolved: 1 }, canImport: false });
});
