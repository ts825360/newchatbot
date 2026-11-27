import { hasObviousPrivateData } from "./assistant-privacy";
import { retreatSurveyTemplate, retreatSurveyTemplateV2, retreatTransportBlock, type SurveyItem } from "./retreat-survey-template";
import { surveyFields } from "./transport-survey";

export type SurveyDraftItem = SurveyItem;
export type SurveyDraft = { id: string; version: number; template: "retreat"; templateVersion: number; title: string; description: string; items: SurveyDraftItem[] };
export const surveyTemplateVersion = 2;
const templateFor = (version: number) => version === 1 ? retreatSurveyTemplate : retreatSurveyTemplateV2;
export const defaultSurveyItems = (version = surveyTemplateVersion): SurveyDraftItem[] => structuredClone([...templateFor(version)]);
const transportIds = new Set(retreatTransportBlock.map(item => item.id));
const transportSnapshot = retreatTransportBlock.map(item => JSON.stringify(item));
export const isSurveyWorkId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export const isSurveyWorkVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000;
const line = (v: unknown, max: number, empty = false): v is string => typeof v === "string" && v.isWellFormed() && v.length <= max && (empty || !!v.trim()) && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v) && !hasObviousPrivateData(v);
const familyQuestion = (title: string) => /가족\s*(?:id|코드|식별\s*(?:코드|번호))|family\s*id/i.test(title.normalize("NFKC"));

export function isSurveyDraft(v: unknown): v is SurveyDraft {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const d = v as SurveyDraft;
  if (Object.keys(d).length !== 7 || !isSurveyWorkId(d.id) || !isSurveyWorkVersion(d.version) || d.template !== "retreat"
    || d.templateVersion !== 1 && d.templateVersion !== surveyTemplateVersion
    || !line(d.title, 100) || !line(d.description, 400, true) || !Array.isArray(d.items)) return false;
  const hasTransport = d.templateVersion === surveyTemplateVersion;
  const extraItems = hasTransport ? retreatSurveyTemplateV2.length - retreatSurveyTemplate.length : 0;
  if (d.items.length < 3 + extraItems || d.items.length > 19 + extraItems) return false;
  if (!d.items.every(item => item && typeof item.id === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(item.id) && line(item.title, 100) && item.title === item.title.trim() && !familyQuestion(item.title))) return false;
  if (new Set(d.items.map(item => item.id)).size !== d.items.length || new Set(d.items.map(item => item.title.normalize("NFKC").toLowerCase())).size !== d.items.length) return false;
  const [attendance, section] = d.items;
  const [originalAttendance] = retreatSurveyTemplate;
  if (attendance.id !== "attendance" || JSON.stringify(attendance) !== JSON.stringify(originalAttendance) || section.id !== "attendees" || section.kind !== "section") return false;
  if (!d.items.some(item => item.id === "name" && item.kind === "text" && item.title === surveyFields.name && item.required && !item.paragraph)) return false;
  // The Forms branches and transport import rely on this contiguous block.
  const transportStart = hasTransport ? d.items.findIndex(item => item.id === retreatTransportBlock[0].id) : -1;
  if (hasTransport && (transportStart < 3 || d.items.findIndex(item => item.id === "name") >= transportStart
    || !transportSnapshot.every((item, i) => JSON.stringify(d.items[transportStart + i]) === item))) return false;
  return d.items.every((item, index) => {
    if (hasTransport && index >= transportStart && index < transportStart + transportSnapshot.length) return true;
    if (item.kind === "section") return index === 1 && Object.keys(item).length === 3;
    if (typeof item.required !== "boolean" || item.description !== undefined && !line(item.description, 300, true)) return false;
    if (item.kind === "text") return typeof item.paragraph === "boolean" && Object.keys(item).every(key => ["id", "kind", "title", "required", "description", "paragraph"].includes(key));
    if (item.kind !== "choice" || !Object.keys(item).every(key => ["id", "kind", "title", "required", "description", "options"].includes(key)) || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 12) return false;
    return item.options.every((option, i) => option && line(option.value, 80) && option.value === option.value.trim() && Object.keys(option).every(key => key === "value" || key === "isOther" || index === 0 && key === "goToAction")
      && (option.isOther === undefined || option.isOther === true && i === item.options.length - 1 && option.value === "기타"))
      && new Set(item.options.map(option => option.value.normalize("NFKC").toLowerCase())).size === item.options.length;
  }) && JSON.stringify(d).length <= (hasTransport ? 20_000 : 12_000);
}

export function surveyDraftOutline(draft: SurveyDraft) {
  const known = new Map(templateFor(draft.templateVersion).map(item => [item.id, item.title]));
  return {
    kind: "survey", version: draft.version, status: "review_only",
    questions: draft.items.filter(item => item.kind !== "section").map((item, index) => ({
      number: index + 1, field: known.get(item.id) ?? "사용자 문항", type: item.kind, required: item.required,
      ...(known.has(item.id) && { key: item.id }),
      ...((item.id === "attendance" || item.id === "name" || draft.templateVersion === surveyTemplateVersion && transportIds.has(item.id)) && { editable: false }),
    })),
  };
}
