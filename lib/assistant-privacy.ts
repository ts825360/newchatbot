import { verifiedPublicAddresses } from "./conversation-places";

export const openAIChatConsentVersion = "openai-account-chat-v6";
export const openAIReplyContextConsentVersion = "openai-chat-reply-context-v1";
export const replyContextConsentPath = "/api/chat?purpose=reply-context";
export const replyContextConsentTitle = "이전 AI 답변을 후속 질문에 활용";
export const replyContextConsentDetails = "같은 개인 대화에서 OpenAI가 이미 생성한 답변의 일부만 후속 요청에 다시 사용할 수 있습니다. 내부 자료와 다른 대화는 전송하지 않습니다.";
export const externalAIConsentTitle = "외부 AI 이용 및 전송 동의";
export const externalAIConsentDetails = "OpenAI로 질문과 이 대화에서 이전에 전송한 메시지 최대 3개, 또는 지정한 답장의 일부가 전송될 수 있습니다. 모호한 후속 질문은 검색과 별개로 OpenAI가 뜻을 해석할 수 있습니다. 웹 검색에는 공개 장소명·주소와 구조화된 방문 조건만 보내며 대화 원문, 첨부자료, 참가자 명단은 보내지 않습니다.";
export const externalAISettingsHref = "/settings?section=security&from=workspace#external-ai";
export const internalChatAction = "local-only";
export const eventPublicVenueUsedAction = "event-public-venue-used";
export const openAIPrivacyWarning = "연락처, 개인 주소, 생년월일, 명단 등 개인정보는 AI 채팅에서 조회하거나 전송할 수 없습니다. 개인정보를 제외한 뒤 다시 보내 주세요.";
export const replyPrivacyNotice = "직접 답장할 때는 전송이 가능한 인용문만 최대 600자까지 OpenAI로 보낼 수 있어요. 자동 문맥 설정과 별개이며, 개인정보와 내부 자료는 보내지 않습니다.";

export function hasObviousPrivateData(message: string) {
  const normalized = message.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const value = verifiedPublicAddresses.reduce((text, address) => text.replaceAll(address, "[공개 장소 주소]"), normalized);
  return /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/i.test(value)
    || /\b(?:\+?82[ ()/._-]*)(?:0?1[016789]|0?[2-6][1-5]?)[ ()/._-]*\d{3,4}[ ()/._-]*\d{4}\b|\b(?:01[016789]|0[2-6][1-5]?)[ ()/._-]*\d{3,4}[ ()/._-]*\d{4}\b/.test(value)
    || /\b\d{6}[ -]?[1-8]\d{6}\b/.test(value)
    || /(?:^|\n)\s*(?:이름|성명|소속|가족\s*ID)\s*[,;\t]\s*(?:이름|성명|소속|연락처|전화번호|가족\s*ID)/i.test(value)
    || /(?:생년월일|출생일|개인\s*주소|자택\s*주소|집\s*주소)\s*(?::|은|는|이|가)\s*\S/.test(value)
    || /(?:^|\s)(?:제|내|본인(?:의)?|[가-힣]{2,8}의)\s+성별\s*(?::|은|는|이|가)\s*(?:남성|남자|여성|여자|남|여|male|female)/im.test(value)
    || /(?:개인별|참가자별|참석자별|교인별)\s*(?:성별|(?:숙소|객실|방)\s*(?:배정|번호))\s*[:：]\s*\S/.test(value)
    || /[가-힣]{1,12}(?:시|도|구|군)\s+(?:[가-힣]{1,12}(?:시|구|군|읍|면|동|리)\s+){0,3}[가-힣\d]{1,20}(?:길|로|동|리)\s*\d{1,5}(?:-\d{1,5})?/.test(value)
    || /(?:참가자|교인|구성원|신청자|참석자)(?:들의?|의)?\s*(?:이름|성명)\s*(?::|은|는|이|가)\s*[^\n]+/.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[a-z0-9_-]{16,}\b/i.test(value);
}

export function requestsPersonalDisclosure(message: string) {
  const text = message.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return /(?:생년월일|출생일|주민등록번호|전화번호|연락처|(?:개인|자택|집)\s*주소|이메일|메일\s*주소|(?:참가자|참석자|교인|구성원)\s*(?:이름|명단)|명단\s*원문|(?:개인별|참가자별|참석자별|교인별)\s*(?:성별|(?:숙소|객실|방)\s*(?:배정|번호)))[^.!?\n]{0,40}(?:알려|보여|찾아|조회|공개|제공|내보내|불러|읽어|출력|뽑아|뭐야|무엇이|어디야)/.test(text);
}
