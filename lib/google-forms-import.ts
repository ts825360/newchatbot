import { createHash } from "node:crypto";
import { defaultSurveyMapping, isSurveyData, validGoogleSurveySource, type TransportSurvey } from "./transport-survey";
import { ApiError } from "./server/http";

export function formIdFromEditorUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    const id = url.pathname.match(/^\/forms\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{8,128})\/edit\/?$/)?.[1];
    if (url.origin === "https://docs.google.com" && !url.username && !url.password && id) return id;
  } catch { /* Invalid or non-editor link. */ }
  throw new ApiError(400, "구글폼 응답 링크가 아닌 편집 주소를 입력해 주세요.");
}

type Question = { questionId?: string; rowQuestion?: { title?: string }; fileUploadQuestion?: unknown };
type Item = { title?: string; questionItem?: { question?: Question }; questionGroupItem?: { questions?: Question[] } };
type ResponseItem = { responseId?: string; answers?: Record<string, { textAnswers?: { answers?: { value?: string }[] } }> };

export function formResponseSurvey(id: string, form: { items?: Item[] }, responses: ResponseItem[]): TransportSurvey {
  if (!responses.length) throw new ApiError(422, "아직 접수된 설문 응답이 없습니다.");
  const questions = (form.items ?? []).flatMap(item => {
    const list = item.questionItem?.question ? [item.questionItem.question] : item.questionGroupItem?.questions ?? [];
    return list.flatMap(q => q.questionId && !q.fileUploadQuestion ? [{ key: q.questionId, title: [item.title, q.rowQuestion?.title].filter(Boolean).join(" · ") }] : []);
  });
  if (questions.length < 2 || questions.length > 40 || responses.length > 500) throw new ApiError(422, "질문은 2~40개, 응답은 500개까지 불러올 수 있습니다.");
  const headers = questions.map(q => q.title);
  const rows = responses.map(response => questions.map(q => (response.answers?.[q.key]?.textAnswers?.answers ?? []).map(answer => answer.value ?? "").join(", ")));
  const data = { headers, rows };
  if (!isSurveyData(data)) throw new ApiError(422, "응답 크기가 가져오기 한도를 초과했습니다.");
  const source = { formId: id, personIds: responses.map(r => {
    if (!r.responseId) throw new ApiError(502, "구글 응답 식별자를 읽지 못했습니다.");
    return "GF-" + createHash("sha256").update(JSON.stringify([id, r.responseId])).digest("hex").slice(0, 44);
  }) };
  if (!validGoogleSurveySource(source, rows.length)) throw new ApiError(502, "구글 응답 목록을 확인하지 못했습니다.");
  return { data, mapping: defaultSurveyMapping(headers), source };
}
