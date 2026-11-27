import { describe, expect, it } from "vitest";
import { defaultSurveyItems, isSurveyDraft, surveyDraftOutline, surveyTemplateVersion, type SurveyDraft } from "@/lib/chat-survey-draft";

function draft(templateVersion = surveyTemplateVersion): SurveyDraft {
  return { id: "d57ec424-64fe-4bd2-a777-b3717581c420", version: 1, template: "retreat", templateVersion,
    title: "참가 설문", description: "", items: defaultSurveyItems(templateVersion) };
}

describe("retreat survey draft formats", () => {
  it("creates independent v2 drafts with stable transport IDs and preserves edits outside the branch block", () => {
    const original = draft();
    const edited = { ...draft(), version: 2, items: draft().items.filter(item => item.id !== "department") };
    expect(original.templateVersion).toBe(2);
    expect(original.items.find(item => item.id === "outbound-method")?.title).toBe("출발 이동수단");
    expect(isSurveyDraft(JSON.parse(JSON.stringify(original)))).toBe(true);
    expect(isSurveyDraft(edited)).toBe(true);
    edited.items.splice(0, edited.items.length);
    expect(original.items).toEqual(draft().items);
  });

  it("continues reading prior v1 edits without adding the v2 transport questions", () => {
    const prior = draft(1);
    prior.items = prior.items.map(item => item.id === "movement" ? { ...item, title: "어떻게 이동하시나요?" } : item);
    expect(isSurveyDraft(JSON.parse(JSON.stringify(prior)))).toBe(true);
    expect(prior.items.map(item => item.id)).toEqual(["attendance", "attendees", "department", "name", "gender", "lodging", "movement", "notes"]);
    expect(surveyDraftOutline(prior).questions.find(item => item.field === "이동수단")).toMatchObject({ number: 6, type: "choice" });
  });

  it("rejects incomplete or modified branch topology and mismatched format versions", () => {
    const original = draft();
    const missing = { ...original, items: original.items.filter(item => item.id !== "return-method") };
    const rerouted = { ...original, items: original.items.map(item => item.id === "outbound-method" && item.kind === "choice"
      ? { ...item, options: item.options.map((option, index) => index === 0 ? { ...option, goToSection: "missing-section" } : option) } : item) };
    expect(isSurveyDraft(missing)).toBe(false);
    expect(isSurveyDraft(rerouted)).toBe(false);
    expect(isSurveyDraft({ ...original, templateVersion: 1 })).toBe(false);
    expect(isSurveyDraft({ ...draft(1), templateVersion: 2 })).toBe(false);
    expect(isSurveyDraft({ ...draft(1), templateVersion: 3 })).toBe(false);
  });

  it("lists the default branch questions under their actual ordinals without exposing custom labels", () => {
    const current = draft();
    current.items.push({ id: "private-label", kind: "text", title: "비공개 문항", required: false, paragraph: false });
    const outline = surveyDraftOutline(current);
    expect(outline.questions).toContainEqual({ number: 6, field: "출발 이동수단", key: "outbound-method", required: true, type: "choice", editable: false });
    expect(outline.questions.at(-1)).toMatchObject({ field: "사용자 문항" });
    expect(JSON.stringify(outline)).not.toContain("비공개 문항");
  });
});
