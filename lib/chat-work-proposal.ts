import { extractChatCalendarFields, privateCalendarSourceId } from "./chat-calendar";
import { resolveTemporalValues } from "./chat-continuity";
import type { ProposalDraft } from "./preparation-store";
import { isTimetable, timetableMorning, type Timetable } from "./timetable";
import type { ChatMessage } from "./types";
import { validDate } from "./room-timing";
import { isSurveyDraft, type SurveyDraft } from "./chat-survey-draft";

export type ChatWorkProposal =
  | { kind: "calendar"; title: string; date: string; time: string; inferredYear: boolean }
  | { kind: "checklist"; confirmed: string[]; items: string[] }
  | { kind: "timetable"; plan: Timetable }
  | { kind: "survey"; title: string; draft?: SurveyDraft };

const isTitle = (value: unknown, limit = 120): value is string => typeof value === "string" && value.length <= limit && !!value.trim() && !/[\p{Cc}\u2028\u2029]/u.test(value);
const isList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 8 && new Set(value).size === value.length && value.every(item => isTitle(item));
const isClock = (value: unknown) => typeof value === "string" && /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(value);

export function isChatWorkProposal(value: unknown): value is ChatWorkProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  const fields = (...keys: string[]) => Object.keys(draft).length === keys.length + 1 && keys.every(key => Object.hasOwn(draft, key));
  if (draft.kind === "calendar") return fields("title", "date", "time", "inferredYear") && isTitle(draft.title) && typeof draft.date === "string" && validDate(draft.date) && isClock(draft.time) && typeof draft.inferredYear === "boolean";
  if (draft.kind === "checklist") return fields("confirmed", "items") && isList(draft.confirmed) && isList(draft.items) && !draft.items.some(item => (draft.confirmed as string[]).includes(item));
  if (draft.kind === "timetable") return fields("plan") && isTimetable(draft.plan) && draft.plan.entries.length > 0 && draft.plan.entries.length <= 140
    && draft.plan.entries.every(entry => isTitle(entry.title) && entry.start >= timetableMorning);
  return draft.kind === "survey" && isTitle(draft.title, 100) && (fields("title") || fields("title", "draft") && isSurveyDraft(draft.draft) && draft.draft.title === draft.title);
}

const calendarMarker = /(?:공용|공동|공유)\s*(?:캘린더|달력)(?:\s*(?:에|으로))?/u;
const commandTail = /\s*(?:(?:라|이)고\s*)?(?:일정을?\s*)?(?:적어|넣어|잡아|올려|기록해|등록해|추가해|만들어|등록|추가)(?:\s*(?:주(?:세요|십시오)|줘(?:요)?|부탁해(?:요)?|해\s*(?:줘(?:요)?|주세요)))?[.!?。]*$/u;
const kstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

export function localWorkIntent(raw: string): "calendar" | "survey" | "timetable" | "headcount" | null {
  const message = raw.normalize("NFKC").trim();
  if (!message || message.length > 500 || /방법|사용법|프롬프트|(?:만들|추가|등록|적|넣)(?:하)?지\s*(?:말|마|않)/.test(message)) return null;
  if (calendarMarker.test(message) && commandTail.test(message)) return "calendar";
  if (/^(?:우리\s+)?(?:(?:구글|Google)\s*폼(?:에)?\s+(?:새\s+)?설문|참가\s*설문|설문\s*(?:폼|지|양식))(?:을|를)?\s*(?:만들어|작성해|생성해|준비해)\s*(?:줘(?:요)?|주세요)[.!?]*$/i.test(message)
    || /설문|폼/.test(message) && /만들|작성|생성/.test(message) && requestsAnonymousSurvey(message)) return "survey";
  if ((/타임\s*테이블/.test(message) || /시간표/.test(message) && !/기차|열차|지하철|버스|\b[KS]TX\b|\bSRT\b/i.test(message))
    && /만들|작성|제작|생성|짜\s*(?:줘|주)|초안|구성해/.test(message)) return "timetable";
  if (/(?:우리(?:\s*행사)?|참가자|참석자|참가\s*인원|참석\s*인원|총\s*인원|총\s*몇\s*명)/.test(message)
    && /몇\s*명|인원\s*(?:수|알려|확인)|인원(?:은|이)?\s*얼마/.test(message)
    && !/(?:가정|수용|차량|대여|예산|숙소|예약|식당|맛집|카페|관광|추천|배정|좌석|최대|최소|보다)/.test(message)) return "headcount";
  return null;
}

export function localSurveyRead(raw: string): "show" | "status" | undefined {
  const question = raw.normalize("NFKC").trim();
  if (/^(?:우리\s*)?(?:참가\s*)?설문\s*초안(?:을)?\s*(?:다시\s*)?(?:보여|열어)\s*(?:줘|주세요|줘요)[.!?]*$/.test(question)) return "show";
  if (/^(?:우리\s*)?(?:참가\s*)?설문(?:\s*(?:초안|작업))?\s*(?:진행\s*)?(?:상태|현황)(?:를|을)?\s*(?:알려|보여|확인해)\s*(?:줘|주세요|줘요)[.!?]*$/.test(question)) return "status";
}

export const requestsChecklistProposal = (raw: string) => /체크\s*리스트|점검표/.test(raw) && /나타내|추가|만들|작성|정리|넣어|보여|반영/.test(raw)
  && !/(?:추가|반영|작성)(?:하)?지\s*(?:말|마|않)/.test(raw);

export const requestsAnonymousSurvey = (raw: string) => /익명|(?:이름|성명|연락처|개인\s*정보)(?:을|를|은|는)?\s*(?:없이|빼고|제외|묻지|받지|수집하지)/.test(raw.normalize("NFKC"));

export function calendarWorkProposal(raw: string, now = new Date()): Extract<ChatWorkProposal, { kind: "calendar" }> | null {
  const message = raw.normalize("NFKC").trim();
  const marker = calendarMarker.exec(message);
  if (!marker || !commandTail.test(message)) return null;
  const monthDay = /(?<![\d년])(\d{1,2})\s*월\s*(\d{1,2})\s*일(?!\d)/g;
  const todayFields = Object.fromEntries(kstDate.formatToParts(now).map(part => [part.type, part.value]));
  const withoutQuotedTitles = message.replace(/[‘“'"][^’”'"]{1,120}[’”'"]/gu, " ");
  if (/정오|자정/.test(withoutQuotedTitles)) return null;
  let source = withoutQuotedTitles, inferredYear = false;
  if (!/\d{4}\s*년|\d{4}-\d{2}-\d{2}/.test(source)) {
    const matches = [...source.matchAll(monthDay)];
    if (matches.length !== 1 || /내년|작년|올해|다음\s*해/.test(source)) return null;
    const [mention] = matches;
    const date = `${todayFields.year}-${mention[1].padStart(2, "0")}-${mention[2].padStart(2, "0")}`;
    if (!validDate(date) || date < `${todayFields.year}-${todayFields.month}-${todayFields.day}` || !resolveTemporalValues(source, [{ value: date, start: mention.index, end: mention.index + mention[0].length }]).value) return null;
    source = source.slice(0, mention.index) + date + source.slice(mention.index + mention[0].length);
    inferredYear = true;
  }
  const { date, time } = extractChatCalendarFields(source);
  if (!date || !time && /\d\s*시|\d\s*:\s*\d/.test(source)) return null;
  const tail = message.slice(marker.index + marker[0].length).replace(commandTail, "").trim();
  const quoted = tail.match(/[‘“'"]([^’”'"]{1,120})[’”'"]/u);
  const title = (quoted?.[1] ?? tail.replace(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}-\d{2}-\d{2}|\d{1,2}\s*월\s*\d{1,2}\s*일/g, "")
    .replace(/^(?:에\s+)?(?:오전|오후)?\s*(?:\d{1,2}:\d{2}|\d{1,2}시(?:\s*\d{1,2}분)?)(?:에)?\s+/, "").replace(/^에\s+/, "").replace(/(?:\s+(?:일정을?|이라고|라고|으?로))$/u, "")).trim();
  if (!isTitle(title) || !quoted && /^(?:일정|그 일정|해당 내용|이 일정|그걸|이걸)$/.test(title)) return null;
  return { kind: "calendar", title, date, time, inferredYear };
}

export function chatWorkDraft(message: ChatMessage): ProposalDraft | null {
  const work = message.workProposal;
  if (message.sender !== "assistant" || !/^prep-[a-f0-9]{64}$/.test(message.id) || !isChatWorkProposal(work) || work.kind === "survey") return null;
  const id = privateCalendarSourceId("chat-work", message.id, work.kind);
  const base = { id, sourceTitle: "행사비서 초안", excerpt: "", origin: "assistant" as const };
  if (work.kind === "calendar") return { ...base, kind: work.kind, title: work.title, date: work.date, time: work.time };
  if (work.kind === "timetable") return { ...base, kind: work.kind, title: "타임테이블 초안", date: work.plan.startDate, timetable: work.plan };
  return { ...base, kind: work.kind, date: "", title: "준비 체크리스트 추가 제안", checklistItems: work.items.map(title => ({ id: privateCalendarSourceId("checklist-item", id, title), title })) };
}
