export const openAIChatConsentVersion = "openai-account-chat-v6";
export const externalAIConsentTitle = "외부 AI 이용 및 전송 동의";
export const externalAIConsentDetails = "OpenAI로 질문과 이 대화에서 이전에 전송한 메시지 최대 3개, 또는 지정한 답장의 일부가 전송될 수 있습니다. 주변 장소 검색에는 공개 장소명·주소와 방문 조건만 보내며 대화 원문, 첨부자료, 참가자 명단은 검색에 보내지 않습니다.";
export const externalAISettingsHref = "/settings?section=security&from=workspace#external-ai";
export const internalChatAction = "local-only";
export const eventPublicVenueUsedAction = "event-public-venue-used";
export const openAIPrivacyWarning = "연락처, 식별번호, 명단 또는 비밀키로 보이는 내용이 있습니다. 지우고 다시 보내거나 내부에만 저장해 주세요.";

export function hasObviousPrivateData(message: string) {
  const value = message.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
  return /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/i.test(value)
    || /\b(?:\+?82[ .-]?)?(?:01[016789]|0[2-6][1-5]?)[ .-]?\d{3,4}[ .-]?\d{4}\b/.test(value)
    || /\b\d{6}[ -]?[1-8]\d{6}\b/.test(value)
    || /(?:^|\n)\s*(?:이름|성명|소속|가족\s*ID)\s*[,;\t]\s*(?:이름|성명|소속|연락처|전화번호|가족\s*ID)/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[a-z0-9_-]{16,}\b/i.test(value);
}
