import { isSurveyData, validGoogleSurveySource, type TransportSurvey } from "./transport-survey";

export const googleFormsEndpoint = "/api/integrations/google-forms";
export const googleFormsCreateUrl = "https://docs.google.com/forms/u/0/create";

export function googleFormRespondentUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1024) return;
  try {
    const url = new URL(value);
    if (url.origin === "https://docs.google.com" && !url.username && !url.password
      && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[A-Za-z0-9_-]{8,256}\/viewform\/?$/.test(url.pathname)) {
      return url.origin + url.pathname;
    }
  } catch { /* Not a responder URL. */ }
}

export type GoogleFormsPreview = { survey?: TransportSurvey; respondentUrl?: string; notice?: string };

export function parseGoogleFormsPreview(value: unknown): GoogleFormsPreview {
  if (!value || typeof value !== "object") throw new Error("구글폼 응답 형식을 읽지 못했습니다.");
  const { data, mapping, source, respondentUrl, notice } = value as Partial<TransportSurvey> & { respondentUrl?: unknown; notice?: unknown };
  const safeUrl = googleFormRespondentUrl(respondentUrl);
  if (data === undefined && typeof notice === "string" && notice) return { respondentUrl: safeUrl, notice };
  if (!isSurveyData(data) || !mapping || !validGoogleSurveySource(source, data.rows.length)) {
    throw new Error("구글폼 응답 형식을 읽지 못했습니다.");
  }
  return { survey: { data, mapping, source }, respondentUrl: safeUrl };
}
