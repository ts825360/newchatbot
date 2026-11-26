export const openAIChatConsentVersion = "openai-account-chat-v4";
export const internalChatAction = "local-only";
export const openAIPrivacyWarning = "연락처, 식별번호, 명단 또는 비밀키로 보이는 내용이 있습니다. 지우고 다시 보내거나 내부에만 저장해 주세요.";

export function hasObviousPrivateData(message: string) {
  const value = message.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
  return /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/i.test(value)
    || /\b(?:\+?82[ .-]?)?(?:01[016789]|0[2-6][1-5]?)[ .-]?\d{3,4}[ .-]?\d{4}\b/.test(value)
    || /\b\d{6}[ -]?[1-8]\d{6}\b/.test(value)
    || /(?:^|\n)\s*(?:이름|성명|소속|가족\s*ID)\s*[,;\t]\s*(?:이름|성명|소속|연락처|전화번호|가족\s*ID)/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[a-z0-9_-]{16,}\b/i.test(value);
}
