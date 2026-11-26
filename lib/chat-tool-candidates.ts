import { parse } from "csv-parse/browser/esm/sync";
import { extractChatCalendarFields, privateCalendarSourceId } from "./chat-calendar";
import type { ConversationScope } from "./conversation-scope";
import type { ProposalDraft } from "./preparation-store";
import { validDate } from "./room-timing";
import { isAdvisorPresentation, type AdvisorProposal } from "./chat-advisor";
import { personTripPatch, type TransportInput } from "./transport";
import type { ChatMessage, ChecklistItem } from "./types";

const fields = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const clean = (text: string, limit: number) => text.replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, limit);
const explicit = (lines: string[], label: RegExp) => lines.find(line => label.test(line))?.replace(label, "").trim() ?? "";
const scopeParts = (scope: ConversationScope) => [scope.accountId, scope.roomId, scope.conversationId];

export function buildChatChecklist(scope: ConversationScope, message: Pick<ChatMessage, "id" | "text">): ChecklistItem {
  const lines = fields(message.text);
  const title = explicit(lines, /^(?:준비\s*항목|체크리스트|항목)\s*[:：]\s*/) || lines.find(line => !/^(?:담당자?|마감(?:일)?)\s*[:：]/.test(line)) || "";
  return { id: privateCalendarSourceId("chat-checklist", ...scopeParts(scope), message.id), title: clean(title, 120),
    owner: clean(explicit(lines, /^담당자?\s*[:：]\s*/), 100), due: extractChatCalendarFields(explicit(lines, /^마감(?:일)?\s*[:：]\s*/)).date,
    status: "needsReview", memo: "" };
}

export const preparationChatQuery = "준비 점검 요약";
export const isPreparationChat = (value: string) => value.trim() === preparationChatQuery;

export function isPreparationStatusChat(value: string) {
  const question = value.normalize("NFKC").trim();
  if (question.length > 350 || /[\r\n]/.test(question)) return false;
  if (!/(알려|보여|확인|요약|정리|어디까지|어떤\s*상태|어떻게\s*됐|됐어|되어\s*있)/.test(question)) return false;
  if (/프롬프트|구현\s*방법|계산\s*(?:법|방식|방법|기준)|설계|사용법/.test(question)) return false;
  if (/가상의?\s*(?:행사|모임)|가정해|예시로/.test(question) && !/저장된|우리\s*행사방/.test(question)) return false;
  return /진행도|준비도|준비\s*(?:현황|상황|상태)|진행\s*(?:현황|상황|상태)|(?:준비|진행).{0,12}어디까지/.test(question)
    || /어디까지\s*(?:준비|진행)|(?:준비|진행).{0,20}(?:안\s*되었|안\s*됐)/.test(question)
    || /(?:웹사이트|사이트|행사방)(?:의)?\s*(?:저장된\s*)?상태/.test(question);
}

export function chatProposalCandidates(messages: readonly ChatMessage[]): ProposalDraft[] {
  const result: ProposalDraft[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.sender !== "assistant" || !/^(?:gemini|openai|prep)-[a-f0-9]{64}(?:-[a-f0-9]{32})?$/.test(message.id)) continue;
    const question = messages[index - 1];
    const sourceDate = question?.sender === "user" ? extractChatCalendarFields(question.text).date : "";
    const added = new Set<string>();
    const proposals = message.advisor !== undefined
      ? isAdvisorPresentation(message.advisor) ? message.advisor.proposals.map(proposal => ({ ...proposal, excerpt: message.text })) : []
      : fields(message.text).flatMap<AdvisorProposal & { excerpt: string }>(line => {
        const task = /^\[준비 제안\]\s+(.+)$/.exec(line);
        const schedule = /^\[일정 제안\]\s+(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)$/.exec(line);
        return task ? [{ kind: "checklist" as const, title: task[1], date: "", excerpt: line }]
          : schedule ? [{ kind: "calendar" as const, title: schedule[2], date: schedule[1], excerpt: line }] : [];
      });
    for (const proposal of proposals) {
      if (added.size >= 4 || result.length >= 60) break;
      const { kind, date } = proposal;
      if (kind === "calendar" && (!validDate(date) || date !== sourceDate)) continue;
      const title = clean(proposal.title, 120);
      const key = JSON.stringify([kind, title, date]);
      if (!title || added.has(key)) continue;
      added.add(key);
      const origin = message.id.startsWith("prep-") ? "preparation" : "assistant";
      result.push({ id: privateCalendarSourceId("chat-proposal", message.id, key), kind, title, date, origin,
        sourceTitle: origin === "assistant" ? "행사비서 답변" : "준비 점검 답변", excerpt: proposal.excerpt.slice(0, 240) });
    }
    if (result.length >= 60) break;
  }
  return result;
}

const rosterHeaders = { 이름: "name", 소속: "department", 가족ID: "familyId", 출발팀: "outbound", 귀가편: "return" } as const;
type RosterField = typeof rosterHeaders[keyof typeof rosterHeaders];
export type ChatRosterRow = Record<RosterField, string> & { row: number };
export type ChatRosterSource = { id: string; text: string; fromDraft?: boolean };
export const sameRosterName = (left: string, right: string) => left.normalize("NFKC").trim().toLowerCase() === right.normalize("NFKC").trim().toLowerCase();

export function parseChatRoster(text: string): ChatRosterRow[] {
  const value = text.trim();
  if (!value || value.length > 24_000) throw new Error("가져올 명단을 확인해 주세요. 한 번에 24,000자까지 입력할 수 있습니다.");
  const first = value.split(/\r?\n/, 1)[0];
  const delimiter = first.includes("\t") ? "\t" : first.includes(",") ? "," : null;
  const rows: string[][] = delimiter ? parse(value, { delimiter, bom: true, skip_empty_lines: true, relax_column_count: true,
    max_record_size: 4096, to: 502, trim: true }) : fields(value).map(line => [line]);
  const hasHeader = delimiter !== null || rows[0]?.[0] === "이름";
  const header = hasHeader ? rows.shift()!.map(name => rosterHeaders[name.replace(/\s/g, "").toUpperCase() as keyof typeof rosterHeaders]) : ["name" as const];
  if (!header.includes("name") || header.some(key => !key) || new Set(header).size !== header.length || !rows.length || rows.length > 500) {
    throw new Error("이름만 한 줄에 한 명씩 입력하거나, 이름·소속·가족 ID·출발 팀·귀가편 중 필요한 열을 사용해 주세요.");
  }
  return rows.map((values, row) => {
    if (values.length > header.length) throw new Error(`${row + 1}번째 참가자의 열 개수를 확인해 주세요.`);
    const entry: ChatRosterRow = { row, name: "", department: "", familyId: "", outbound: "", return: "" };
    header.forEach((key, index) => { entry[key] = values[index]?.trim() ?? ""; });
    if (!entry.name || [entry.name, entry.department, entry.familyId].some(field => field.length > 40 || /[\x00-\x1F\x7F]/.test(field)) ||
      [entry.outbound, entry.return].some(field => field.length > 120 || /[\x00-\x1F\x7F]/.test(field))) {
      throw new Error(`${row + 1}번째 참가자의 이름 또는 입력 길이를 확인해 주세요.`);
    }
    return entry;
  });
}

export const chatRosterPersonId = (scope: ConversationScope, messageId: string, row: number) => privateCalendarSourceId("roster", ...scopeParts(scope), messageId, String(row)).replaceAll(":", "-");

export function mergeChatRoster(input: TransportInput, scope: ConversationScope, messageId: string, rows: ChatRosterRow[]): TransportInput {
  const known = new Set(input.people.map(person => person.id));
  const additions = rows.flatMap(row => {
    const id = chatRosterPersonId(scope, messageId, row.row);
    if (known.has(id)) return [];
    known.add(id);
    return [{ id, name: row.name, department: row.department || "미분류", familyId: row.familyId, companionGroup: "",
      outboundTripId: null, returnTripId: null,
      ...personTripPatch(input.trips, "outbound", row.outbound || "미정"), ...personTripPatch(input.trips, "return", row.return || "미정") }];
  });
  return additions.length ? { ...input, people: [...input.people, ...additions], revision: input.revision + 1 } : input;
}
