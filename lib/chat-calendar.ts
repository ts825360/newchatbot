import { validDate } from "./room-timing";
import { resolveTemporalValues } from "./chat-continuity";
import type { CalendarEvent } from "./types";

type DateIssue = "missing" | "invalid" | "ambiguous" | "multiple" | null;

export function extractChatCalendarFields(text: string): { date: string; time: string; dateIssue: DateIssue } {
  const pattern = /(?<![\d/-])(\d{4})-(\d{2})-(\d{2})(?![\d-])|(?<!\d)(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?!\d)/g;
  const mentions = [...text.matchAll(pattern)].map(match => {
    const year = match[1] ?? match[4];
    const month = match[2] ?? match[5];
    const day = match[3] ?? match[6];
    return { value: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, start: match.index, end: match.index + match[0].length };
  });
  const unique = [...new Set(mentions.map(item => item.value))];
  const remainder = text.replace(pattern, " ");
  // Never resolve a partial or relative alternative against the room date or today's year.
  const ambiguous = /\d{4}[-/.]\d+[-/.]\d+|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[/.]\d{1,2}|\d{1,2}\s*일|오늘|내일|모레|어제|올해|내년|작년|다음\s*(?:주|달|월|해)|이번\s*(?:주|달|월)|다음\s*날/.test(remainder);
  const dateIssue: DateIssue = unique.length > 1 ? "multiple"
    : !unique.length ? "missing"
    : !validDate(unique[0]) || unique[0].startsWith("0000-") ? "invalid"
    : ambiguous || !resolveTemporalValues(text, mentions).value ? "ambiguous" : null;
  if (dateIssue) return { date: "", time: "", dateIssue };
  return { date: unique[0], time: explicitTime(remainder), dateIssue: null };
}

function explicitTime(text: string): string {
  if (/시\s*반|\b(?:UTC|GMT|KST|PST|EST)\b|[+-]\d{2}:\d{2}/i.test(text)) return "";
  const pattern = /(?<![\d:])(오전|오후)\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)(?![\d:])|(?<![\d:])(\d{2}):(\d{2})(?![\d:])/g;
  const times: { value: string; start: number; end: number }[] = [];
  let invalid = false;
  for (const match of text.matchAll(pattern)) {
    let hour = Number(match[2] ?? match[5]);
    const minute = Number(match[3] ?? match[4] ?? match[6] ?? 0);
    if (minute > 59 || (match[1] ? hour < 1 || hour > 12 : hour > 23)) { invalid = true; continue; }
    if (match[1]) hour = hour % 12 + (match[1] === "오후" ? 12 : 0);
    times.push({ value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, start: match.index, end: match.index + match[0].length });
  }
  const unique = [...new Set(times.map(item => item.value))];
  const ambiguous = /\d+\s*시|\d+:\d+/.test(text.replace(pattern, " "));
  return !invalid && !ambiguous && unique.length === 1 ? resolveTemporalValues(text, times).value ?? "" : "";
}

export function chatCalendarSourceId(accountId: string, conversationId: string, messageId: string): string {
  const tuple = [accountId, conversationId, messageId];
  try {
    const legacy = `chat:${tuple.map(encodeURIComponent).join(":")}`;
    if (legacy.length <= 128) return legacy;
  } catch (cause) {
    if (!(cause instanceof URIError)) throw cause;
  }
  // JSON preserves tuple boundaries and lone surrogates; hash every byte, never a truncated ID.
  return `chat:v1:${sourceDigest(JSON.stringify(tuple))}`;
}

export function privateCalendarSourceId(kind: string, ...parts: string[]): string {
  return `${kind}:v1:${sourceDigest(JSON.stringify(parts))}`;
}

// FNV-1a 128 is for stable metadata IDs only, not identity, authentication, or other security decisions.
function sourceDigest(value: string): string {
  let hash = BigInt("0x6c62272e07bb014262b821756295c58d");
  const prime = BigInt("0x0000000001000000000000000000013b");
  for (const byte of new TextEncoder().encode(value)) {
    hash = BigInt.asUintN(128, (hash ^ BigInt(byte)) * prime);
  }
  return hash.toString(16).padStart(32, "0");
}

export function createChatCalendarEvent(source: { accountId: string; conversationId: string; messageId: string; text: string; author: string }): CalendarEvent {
  const fields = extractChatCalendarFields(source.text);
  return {
    id: chatCalendarSourceId(source.accountId, source.conversationId, source.messageId),
    title: "대화에서 추가한 일정",
    date: fields.date,
    time: fields.time,
    location: "",
    memo: "",
    status: "confirmed",
    author: source.author,
    lastEditor: source.author,
    changeLog: `${source.author}님이 대화에서 일정을 추가했습니다.`,
  };
}
