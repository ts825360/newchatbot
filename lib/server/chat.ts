import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { eventPublicVenueUsedAction, hasObviousPrivateData, internalChatAction, openAIChatConsentVersion, openAIPrivacyWarning } from "../assistant-privacy";
import { isPreparationChat, isPreparationStatusChat } from "../chat-tool-candidates";
import { advisorReplyFormat, parseAdvisorReply } from "../chat-advisor";
import { extractChatCalendarFields } from "../chat-calendar";
import { isVenueHistoryChat, venueHistoryReplyAction } from "../retreat-venue-history";
import { loadRetreatReview, summarizeRetreatReview } from "./retreat-preparation";
import { loadPreparationStatus } from "./preparation-status";
import { isRetreatRoom, loadRetreatVenueReview } from "./retreat-venue-history";
import type { ConversationHistory } from "../conversation-store";
import type { ConversationScope } from "../conversation-scope";
import type { ChatMessage } from "../types";
import { requirePermission, requireUser } from "./auth";
import { generateOpenAIText, type OpenAIChatTurn } from "./chat-openai";
import { eventVenueTool, readPublicEventVenue } from "./chat-venue-tool";
import { diningVisit, isDiningSearch, recommendDining } from "./chat-dining";
import { chatAdvisorPrompt, chatOutputInstruction } from "./chat-advisor-prompt";
import { assistantStyleInstruction, formatAssistantReply, loadAssistantPreferences } from "./assistant-preferences";
import { canonicalConversationHistory, requireOwnedConversation } from "./conversation-scope";
import { bumpRevision, getDatabase, transaction } from "./database";
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from "./http";
import { id, object, text, validateRecord } from "./record-schema";

const changed = () => new ApiError(409, "대화가 변경되었습니다. 최신 메시지를 확인한 뒤 다시 시도해 주세요.");
const full = () => new ApiError(413, "대화 저장 한도에 도달했습니다. 새 대화를 시작해 주세요.");
let generating = false;

const consentKind = "chat-external-consent";
const consentKey = (accountId: string) => `${consentKind}:${accountId}`;
const hasConsent = (db: DatabaseSync, accountId: string) => db.prepare("SELECT 1 FROM records WHERE key=? AND owner_id=? AND kind=? AND data_json=?")
  .get(consentKey(accountId), accountId, consentKind, JSON.stringify(openAIChatConsentVersion)) !== undefined;

export function handleChatConsent(request: Request, database = getDatabase()): Response {
  try {
    assertSameOrigin(request);
    const actor = requireUser(request, database);
    requirePermission(actor, "chat");
    if (request.method === "GET") return json({ approved: hasConsent(database, actor.id) });
    if (request.method === "DELETE") {
      database.prepare("DELETE FROM records WHERE key=? AND owner_id=? AND kind=?").run(consentKey(actor.id), actor.id, consentKind);
      return json({ approved: false });
    }
    return json({ error: "지원하지 않는 동의 요청입니다." }, 405);
  } catch (cause) { return errorResponse(cause); }
}

function replyIdFor(scope: ConversationScope, turn: ChatMessage, internal: boolean, retreatVenueReview: boolean, dining = false) {
  const prefix = retreatVenueReview ? "venue-history-" : internal ? "prep-" : dining ? "dining-" : "openai-";
  const reference = turn.reference ? [turn.reference.kind, turn.reference.messageId] : [];
  return prefix + createHash("sha256").update(JSON.stringify([scope.accountId, scope.roomId, scope.conversationId, turn.id, turn.text, ...reference])).digest("hex");
}

function confirmedOpenAITurn(scope: ConversationScope, question?: ChatMessage, reply?: ChatMessage) {
  return question?.sender === "user" && !question.actions?.includes(internalChatAction) && reply?.sender === "assistant"
    && reply.id === replyIdFor(scope, question, false, false);
}

function chatInput(scope: ConversationScope, messages: readonly ChatMessage[], current: ChatMessage): string | OpenAIChatTurn[] {
  const context: OpenAIChatTurn[] = [];
  const edited = new Map<string, string>();
  for (const message of messages) if (message.reference?.kind === "edit") edited.set(message.reference.messageId, message.id);
  const start = Math.max(0, messages.length - 13);
  let remaining = 2400;
  for (let i = messages.length - 3; i >= start && context.length < 3; i--) {
    const question = messages[i], reply = messages[i + 1];
    // A matching server-owned reply proves this exact question previously reached OpenAI.
    if (!confirmedOpenAITurn(scope, question, reply) || hasObviousPrivateData(question.text) || edited.has(question.id)
      || question.reference?.kind === "edit" && edited.get(question.reference.messageId) !== question.id
      || current.reference?.kind === "reply" && current.reference.messageId === question.id) continue;
    const size = question.text.length;
    if (size > remaining) break;
    remaining -= size;
    context.unshift({ role: "user", content: question.text });
  }
  if (current.reference?.kind === "reply") {
    const index = messages.findIndex(message => message.id === current.reference?.messageId);
    const quoted = messages[index];
    const approved = quoted?.sender === "assistant" ? confirmedOpenAITurn(scope, messages[index - 1], quoted) : confirmedOpenAITurn(scope, quoted, messages[index + 1]);
    context.push({ role: "user", content: JSON.stringify({ selectedReply: approved && quoted && !hasObviousPrivateData(quoted.text) ? quoted.text.slice(0, 600) : null }) });
  }
  return context.length ? [...context, { role: "user", content: current.text }] : current.text;
}

function findTurn(db: DatabaseSync, scope: ConversationScope, userMessageId: string, userMessageText: string, internal: boolean, retreatVenueReview: boolean) {
  requireOwnedConversation(db, scope);
  const key = canonicalConversationHistory(scope.accountId, scope.roomId);
  const row = db.prepare("SELECT data_json,revision FROM records WHERE key=? AND owner_id=? AND room_id=? AND kind='conversations'")
    .get(key, scope.accountId, scope.roomId) as { data_json: string; revision: number } | undefined;
  if (!row) throw changed();
  const history: ConversationHistory = JSON.parse(row.data_json);
  const conversation = history.conversations.find(({ id }) => id === scope.conversationId);
  if (!conversation) throw changed();
  const messages = conversation.messages;
  const index = messages.findIndex(({ id }) => id === userMessageId);
  if (index < 0 || messages[index].sender !== "user" || messages[index].text !== userMessageText) throw changed();
  if (messages[index].actions?.includes(internalChatAction)) throw new ApiError(422, "내부 저장 메시지는 외부로 전송하지 않습니다.");
  const replyId = replyIdFor(scope, messages[index], internal, retreatVenueReview, !internal && isDiningSearch(messages[index].text));
  const existing = messages[index + 1];
  const complete = existing?.sender === "assistant" && (existing.id === replyId || !internal && existing.id === replyIdFor(scope, messages[index], false, false));
  if (!complete) {
    if (index !== messages.length - 1 || messages.some(({ id }) => id === replyId)) throw changed();
    if (!text(messages[index].text, 8000)) throw new ApiError(400, "메시지는 8,000자 이내로 입력해 주세요.");
    if (messages.length >= 1000) throw full();
  }
  return { key, row, history, conversation, message: messages[index], replyId, complete };
}

export async function handleChat(request: Request, database?: DatabaseSync): Promise<Response> {
  const startedAt = performance.now();
  try {
    const db = database ?? getDatabase();
    const actor = requireUser(request, db);
    requirePermission(actor, "viewRoom");
    requirePermission(actor, "chat");
    const data = await readJson(request, 64 * 1024);
    if (!object(data) || Object.keys(data).some((key) => !["roomId", "conversationId", "userMessageId", "userMessageText", "consent"].includes(key)) ||
      !id(data.roomId) || !id(data.conversationId) || !id(data.userMessageId) || !text(data.userMessageText, 8000)) {
      throw new ApiError(400, "대화와 메시지 식별자를 확인해 주세요.");
    }
    const retreatVenueReview = isVenueHistoryChat(data.userMessageText) && isRetreatRoom(db, data.roomId);
    const detailedPreparation = isPreparationChat(data.userMessageText) && isRetreatRoom(db, data.roomId);
    const localReview = isPreparationChat(data.userMessageText) || isPreparationStatusChat(data.userMessageText) || retreatVenueReview;
    const approved = !localReview && hasConsent(db, actor.id);
    if (!localReview && (data.consent !== undefined ? data.consent !== openAIChatConsentVersion : !approved)) {
      throw new ApiError(423, "OpenAI로 처음 보내기 전에 외부 전송에 동의해 주세요.");
    }
    if (!localReview && hasObviousPrivateData(data.userMessageText)) throw new ApiError(422, openAIPrivacyWarning);
    const scope = { accountId: actor.id, roomId: data.roomId, conversationId: data.conversationId };
    const currentTurn = () => {
      if (request.signal.aborted) throw new ApiError(408, "답변 요청이 취소되었습니다.");
      const current = requireUser(request, db);
      if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion) throw new ApiError(401, "다시 로그인해 주세요.");
      requirePermission(current, "viewRoom");
      requirePermission(current, "chat");
      return findTurn(db, scope, data.userMessageId, data.userMessageText, localReview, retreatVenueReview);
    };
    const original = currentTurn();
    const assertSameHistory = (turn: typeof original) => {
      if (turn.row.revision !== original.row.revision || turn.row.data_json !== original.row.data_json) throw changed();
    };
    if (!localReview && !approved && data.consent === openAIChatConsentVersion) {
      db.prepare(`INSERT INTO records(key,owner_id,kind,data_json,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1,updated_at=excluded.updated_at`)
        .run(consentKey(actor.id), actor.id, consentKind, JSON.stringify(openAIChatConsentVersion), new Date().toISOString());
    }
    if (original.complete) return json({ ok: true });
    if (generating) return json({ error: "다른 답변을 작성 중입니다. 잠시 후 다시 시도해 주세요." }, 429);
    generating = true;
    try {
      const preferences = loadAssistantPreferences(db, actor.id);
      const format = (value: string) => value.trim() ? formatAssistantReply(value.trim(), preferences.emoji) : "";
      let reply: Pick<ChatMessage, "text" | "advisor" | "actions" | "dining">;
      if (retreatVenueReview) {
        loadRetreatVenueReview(db, actor, scope);
        reply = { text: "수련회 결과 보고서의 이용 이력과 비교 후보입니다.", actions: [venueHistoryReplyAction] };
      } else if (detailedPreparation) {
        reply = { text: formatAssistantReply(summarizeRetreatReview(loadRetreatReview(db, actor, scope)), preferences.emoji) };
      } else if (localReview) {
        reply = loadPreparationStatus(db, actor, scope);
      } else if (isDiningSearch(data.userMessageText)) {
        const venue = readPublicEventVenue(db, scope);
        const now = new Date();
        const visit = diningVisit(data.userMessageText, now);
        if (!venue) reply = { text: "이 행사방에서 검색에 사용할 공개 대표 장소를 확인하지 못했어요. 장소에서 대표 숙소를 확인해 주세요." };
        else if (!visit) reply = { text: "어느 날짜와 시간에 방문할까요? 예를 들어 ‘내일 아침’이나 ‘토요일 오후 6시’라고 알려주세요." };
        else {
          reply = await recommendDining(venue, visit, now, request.signal);
          assertSameHistory(currentTurn());
          if (!hasConsent(db, actor.id)) throw new ApiError(423, "OpenAI 전송 동의가 변경되었습니다.");
          if (JSON.stringify(venue) !== JSON.stringify(readPublicEventVenue(db, scope))) throw new ApiError(409, "대표 장소가 변경되었습니다. 다시 요청해 주세요.");
        }
      } else {
        const publicVenue = readPublicEventVenue(db, scope);
        let venueUsed: string | undefined;
        const tool = publicVenue ? { definition: eventVenueTool, run: () => {
          assertSameHistory(currentTurn());
          if (!hasConsent(db, actor.id)) throw new ApiError(423, "OpenAI 전송 동의가 변경되었습니다.");
          const venue = readPublicEventVenue(db, scope);
          if (!venue) throw new ApiError(409, "대표 장소가 변경되었습니다. 다시 요청해 주세요.");
          venueUsed = JSON.stringify(venue);
          return venueUsed;
        } } : undefined;
        const raw = await generateOpenAIText(chatInput(scope, original.conversation.messages, original.message), request.signal,
          [chatAdvisorPrompt, chatOutputInstruction, assistantStyleInstruction(preferences), ...(tool ? ["사용자가 우리 숙소나 행사 장소, 그 주변 식당·활동을 물으면 장소를 다시 묻기 전에 get_current_event_venue를 호출하세요. 결과는 저장된 대표 장소의 공개 기본 정보이며 주변 시설의 최신 검색 결과가 아닙니다."] : [])].join("\n\n"), advisorReplyFormat, tool);
        if (venueUsed) {
          assertSameHistory(currentTurn());
          if (!hasConsent(db, actor.id)) throw new ApiError(423, "OpenAI 전송 동의가 변경되었습니다.");
          if (venueUsed !== JSON.stringify(readPublicEventVenue(db, scope))) throw new ApiError(409, "대표 장소가 변경되었습니다. 다시 요청해 주세요.");
        }
        const answer = parseAdvisorReply(raw);
        if (!answer) throw new ApiError(502, "답변 형식을 확인하지 못했습니다. 다시 요청해 주세요.");
        const sourceDate = extractChatCalendarFields(data.userMessageText).date;
        reply = {
          text: format(answer.summary),
          ...(venueUsed && { actions: [eventPublicVenueUsedAction] }),
          advisor: {
            kind: answer.kind, title: format(answer.title), rationale: format(answer.rationale),
            rows: answer.rows.map(row => ({ label: format(row.label), detail: format(row.detail) })),
            proposals: answer.proposals.filter(proposal => proposal.kind === "checklist" || proposal.date === sourceDate)
              .map(proposal => ({ ...proposal, title: format(proposal.title) })),
          },
        };
      }
      transaction(db, () => {
        const latest = currentTurn();
        if (latest.complete) return;
        assertSameHistory(latest);
        latest.conversation.messages.push({ id: latest.replyId, sender: "assistant", ...reply, time: "방금 전", replyElapsedMs: Math.round(performance.now() - startedAt) });
        const updatedAt = new Date().toISOString();
        latest.conversation.updatedAt = updatedAt;
        validateRecord("conversations", latest.history);
        const serialized = JSON.stringify(latest.history);
        if (serialized.length > 2_000_000) throw full();
        const result = db.prepare("UPDATE records SET data_json=?,revision=revision+1,updated_at=? WHERE key=? AND owner_id=? AND room_id=? AND kind='conversations' AND revision=? AND data_json=?")
          .run(serialized, updatedAt, latest.key, scope.accountId, scope.roomId, original.row.revision, original.row.data_json);
        if (result.changes !== 1) throw changed();
        bumpRevision(db);
      });
      return json({ ok: true });
    } finally { generating = false; }
  } catch (error) { return errorResponse(error); }
}
