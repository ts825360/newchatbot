import { createHash } from "node:crypto";
import { isEventVenueRouteQuestion, venueRouteFor } from "../chat-venue-route";
import { isDeepStrictEqual } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { eventPublicVenueUsedAction, hasObviousPrivateData, internalChatAction, openAIChatConsentVersion, openAIReplyContextConsentVersion, openAIPrivacyWarning, requestsPersonalDisclosure } from "../assistant-privacy";
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
import { diningVisit, nearbySearchKind, participantBand, recommendDining } from "./chat-dining";
import { classifyContinuation, contextOrdinal, requestOnlyConditions, type EventWindow } from "../chat-continuity";
import { resolveWorkConditions, type WorkCondition } from "../chat-work-state";
import { readParticipantCount } from "./chat-work-reads";
import { interpretNearbyFollowUp, type NearbyIntent } from "./chat-interpretation";
import type { NearbyTask } from "../chat-dining";
import { verifiedPublicPlace } from "../conversation-places";
import { validDate } from "../room-timing";
import { chatAdvisorPrompt, chatOutputInstruction } from "./chat-advisor-prompt";
import { assistantStyleInstruction, formatAssistantReply, loadAssistantPreferences } from "./assistant-preferences";
import { canonicalConversationHistory, requireOwnedConversation } from "./conversation-scope";
import { bumpRevision, getDatabase, transaction } from "./database";
import { hasChatConsent, hasReplyContextConsent, saveChatConsent, saveReplyContextConsent } from "./chat-consent";
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from "./http";
import { id, object, text, validateRecord } from "./record-schema";

const changed = () => new ApiError(409, "대화가 변경되었습니다. 최신 메시지를 확인한 뒤 다시 시도해 주세요.");
const full = () => new ApiError(413, "대화 저장 한도에 도달했습니다. 새 대화를 시작해 주세요.");
const pendingHistories = new WeakMap<DatabaseSync, Set<string>>();
const wantsPlaceSave = (text: string) => /(?:장소(?:\s*목록)?|저장한\s*장소)(?:에|로)\s*(?:추가|저장|등록|넣어)/.test(text)
  && !/(?:추가|저장|등록|넣)(?:하)?지\s*(?:말|않)/.test(text);
const wantsSearch = (text: string) => /추천|검색|찾아|알아봐/.test(text);
const wantsSavedHeadcount = (text: string) => /(?:실제|확정된|저장된|등록된)\s*(?:행사\s*)?(?:참가자(?:\s*수)?|인원)/.test(text);

export async function handleChatConsent(request: Request, database = getDatabase()): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = requireUser(request, database);
    requirePermission(actor, "chat");
    const purpose = new URL(request.url).searchParams.get("purpose");
    if (purpose !== null && purpose !== "reply-context") throw new ApiError(400, "지원하지 않는 동의 항목입니다.");
    const memory = purpose === "reply-context";
    const version = memory ? openAIReplyContextConsentVersion : openAIChatConsentVersion;
    if (request.method === "GET") return json({ approved: (memory ? hasReplyContextConsent : hasChatConsent)(database, actor.id) });
    if (request.method === "PUT") {
      const body = await readJson(request, 4096);
      if (!object(body) || !id(body.accountId) || typeof body.approved !== "boolean" || body.version !== version
        || Object.keys(body).some(key => !["accountId", "approved", "version"].includes(key))) throw new ApiError(400, "외부 AI 이용 동의 내용을 다시 확인해 주세요.");
      if (body.accountId !== actor.id) throw new ApiError(409, "접속 계정이 변경되었습니다.");
      const current = requireUser(request, database);
      requirePermission(current, "chat");
      if (memory && body.approved && !hasChatConsent(database, actor.id)) throw new ApiError(423, "먼저 외부 AI 이용을 허용해 주세요.");
      (memory ? saveReplyContextConsent : saveChatConsent)(database, actor.id, body.approved);
      return json({ approved: body.approved });
    }
    if (request.method === "DELETE") {
      (memory ? saveReplyContextConsent : saveChatConsent)(database, actor.id, false);
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
  return question?.sender === "user" && !question.actions?.includes(internalChatAction) && !requestsPersonalDisclosure(question.text) && reply?.sender === "assistant"
    && reply.id === replyIdFor(scope, question, false, false);
}

function chatInput(scope: ConversationScope, messages: readonly ChatMessage[], current: ChatMessage, includeReplies: boolean): string | OpenAIChatTurn[] {
  if (current.reference?.kind === "reply") {
    const index = messages.findIndex(message => message.id === current.reference?.messageId);
    const quoted = messages[index];
    const approved = quoted?.sender === "assistant" ? confirmedOpenAITurn(scope, messages[index - 1], quoted) : confirmedOpenAITurn(scope, quoted, messages[index + 1]);
    const selectedReply = approved && quoted && !quoted.actions?.includes(eventPublicVenueUsedAction) && !hasObviousPrivateData(quoted.text) ? quoted.text.slice(0, 600) : null;
    return [{ role: "user", content: JSON.stringify({ selectedReply }) }, { role: "user", content: current.text }];
  }
  const context: OpenAIChatTurn[] = [];
  const edited = new Map<string, string>();
  for (const message of messages) if (message.reference?.kind === "edit") edited.set(message.reference.messageId, message.id);
  const currentTaskStart = includeReplies ? messages.slice(0, -1).findLastIndex(item => item.sender === "user" && classifyContinuation(item.text) === "new") : -1;
  const start = Math.max(0, messages.length - 13, currentTaskStart, messages.findLastIndex(item => item.sender === "assistant" && item.actions?.includes("context-cancelled")) + 1);
  let remaining = 2400;
  let questions = 0;
  for (let i = messages.length - 3; i >= start && questions < 3; i--) {
    const question = messages[i], reply = messages[i + 1];
    // A matching server-owned reply proves this exact question previously reached OpenAI.
    if (!confirmedOpenAITurn(scope, question, reply) || hasObviousPrivateData(question.text) || requestOnlyConditions(question.text) || edited.has(question.id)
      || question.reference?.kind === "edit" && edited.get(question.reference.messageId) !== question.id) continue;
    const size = question.text.length;
    if (size > remaining) break;
    remaining -= size;
    questions++;
    if (includeReplies && !reply.actions?.includes(eventPublicVenueUsedAction) && !hasObviousPrivateData(reply.text)) {
      const rows = (reply.advisor?.rows ?? []).map(row => `${row.label}: ${row.detail}`);
      const excerpt = [reply.text, ...rows].join("\n");
      if (!hasObviousPrivateData(excerpt) && remaining >= 80) {
        const content = excerpt.slice(0, Math.min(1000, remaining));
        context.unshift({ role: "assistant", content });
        remaining -= content.length;
      }
    }
    context.unshift({ role: "user", content: question.text });
  }
  return context.length ? [...context, { role: "user", content: current.text }] : current.text;
}

function priorNearby(scope: ConversationScope, messages: readonly ChatMessage[], index: number) {
  const current = messages[index];
  if (!current || classifyContinuation(current.text) === "new" && current.reference?.kind !== "reply") return;
  const target = current.reference?.kind === "reply" ? messages.slice(0, index).findIndex(item => item.id === current.reference?.messageId) : index - 1;
  const answerIndex = messages[target]?.sender === "user" ? target + 1 : target;
  if (answerIndex < 1 || answerIndex >= index) return;
  const prior = messages[answerIndex], question = messages[answerIndex - 1];
  if (question.sender === "user" && prior.sender === "assistant" && prior.id === replyIdFor(scope, question, false, false, true) && prior.nearbyTask) return prior;
}

function eventWindow(db: DatabaseSync, roomId: string): EventWindow | undefined {
  const row = db.prepare("SELECT data_json FROM rooms WHERE id=?").get(roomId);
  const room: unknown = row && JSON.parse(String(row.data_json));
  if (!object(room) || typeof room.date !== "string" || !validDate(room.date)) return;
  return { start: room.date, end: typeof room.endDate === "string" && validDate(room.endDate) && room.endDate >= room.date ? room.endDate : room.date };
}

function nearbyOrigin(message: string, previous?: NearbyTask): Pick<NearbyTask, "origin" | "venueName"> {
  if (/(?:저장된|등록된|원래)\s*(?:행사\s*)?(?:숙소|장소)(?:로|를\s*기준)|(?:숙소|장소)(?:이|가|를|을)\s*(?:변경했|변경됐|바꿨|바뀌었|수정했)/.test(message)) return { origin: "saved" };
  const named = message.match(/(?:^|[.\n]\s*|가정(?:으로)?\s+)(?:숙소|장소)(?:는|을|를|:)\s*([^\n.!?]{1,125})/);
  if (named) {
    const name = named[1].split(/(?:으?로\s*(?:가정|바꿔|바꾸|변경|해서)|(?:이)?라고|(?:이)?(?:야|예요|입니다)(?:\s|$)|[,，]|\s+주변)/)[0].trim();
    const verified = verifiedPublicPlace(name);
    return verified ? { origin: "hypothetical", venueName: verified.name } : { origin: "unverified" };
  }
  return previous ? { origin: previous.origin, ...(previous.venueName && { venueName: previous.venueName }) } : { origin: "saved" };
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
  const previousNearby = internal ? undefined : priorNearby(scope, messages, index);
  const nearbyKind = internal ? null : nearbySearchKind(messages[index].text) ?? previousNearby?.nearbyTask?.kind ?? null;
  const replyId = replyIdFor(scope, messages[index], internal, retreatVenueReview, !!nearbyKind);
  const existing = messages[index + 1];
  const complete = existing?.sender === "assistant" && (existing.id === replyId || !internal && existing.id === replyIdFor(scope, messages[index], false, false));
  if (!complete) {
    if (index !== messages.length - 1 || messages.some(({ id }) => id === replyId)) throw changed();
    if (!text(messages[index].text, 8000)) throw new ApiError(400, "메시지는 8,000자 이내로 입력해 주세요.");
    if (messages.length >= 1000) throw full();
  }
  return { key, row, history, conversation, message: messages[index], replyId, complete, previousNearby, nearbyKind };
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
    const action = classifyContinuation(data.userMessageText);
    const venueRouteQuestion = !nearbySearchKind(data.userMessageText) && isEventVenueRouteQuestion(data.userMessageText);
    const localReview = venueRouteQuestion || action === "cancel" || isPreparationChat(data.userMessageText) || isPreparationStatusChat(data.userMessageText) || retreatVenueReview;
    if (!localReview && (!hasChatConsent(db, actor.id) || data.consent !== undefined && data.consent !== openAIChatConsentVersion)) {
      throw new ApiError(423, "환경설정의 보안 및 개인정보에서 외부 AI 이용을 허용해 주세요.");
    }
    if (requestsPersonalDisclosure(data.userMessageText) || (!localReview || venueRouteQuestion) && hasObviousPrivateData(data.userMessageText)) throw new ApiError(422, openAIPrivacyWarning);
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
    let { nearbyKind } = original;
    const { previousNearby } = original;
    const assertSameHistory = (turn: typeof original) => {
      if (turn.row.revision !== original.row.revision || turn.row.data_json !== original.row.data_json) throw changed();
    };
    if (original.complete) return json({ ok: true });
    const pending = pendingHistories.get(db) ?? new Set<string>();
    pendingHistories.set(db, pending);
    // All conversations in the same account and room share one optimistic history revision.
    if (pending.has(original.key)) return json({ error: "이 행사방의 다른 답변을 작성 중입니다. 잠시 후 다시 시도해 주세요." }, 429);
    pending.add(original.key);
    try {
      const preferences = loadAssistantPreferences(db, actor.id);
      const format = (value: string) => value.trim() ? formatAssistantReply(value.trim(), preferences.emoji) : "";
      let assertSourcesStillCurrent = () => {};
      let interpretation: NearbyIntent | null | undefined;
      const savePlace = Boolean(previousNearby && wantsPlaceSave(data.userMessageText));
      if (nearbyKind && previousNearby && action === "unknown" && !savePlace && !original.message.reference && !nearbySearchKind(data.userMessageText) && !wantsSavedHeadcount(data.userMessageText)) {
        const root = original.conversation.messages.find(message => message.id === previousNearby.nearbyTask?.candidateMessageId);
        interpretation = await interpretNearbyFollowUp(data.userMessageText, nearbyKind, (root ?? previousNearby).dining?.restaurants.length ?? 0, request.signal);
        assertSameHistory(currentTurn());
        if (!hasChatConsent(db, actor.id)) throw new ApiError(423, "OpenAI 전송 동의가 변경되었습니다.");
        if (interpretation?.intent === "unrelated") nearbyKind = null;
      }
      let reply: Pick<ChatMessage, "text" | "advisor" | "actions" | "dining" | "nearbyTask" | "venueRoute">;
      if (action === "cancel") {
        reply = { text: "이 대화에서 이어가던 요청을 중단했어요. 행사방에 저장된 기록은 변경하지 않았습니다.", actions: ["context-cancelled"] };
      } else if (venueRouteQuestion) {
        const venue = readPublicEventVenue(db, scope);
        assertSourcesStillCurrent = () => {
          if (!isDeepStrictEqual(venue, readPublicEventVenue(db, scope))) throw new ApiError(409, "대표 장소가 변경되었습니다. 다시 요청해 주세요.");
        };
        reply = venue ? {
          text: `이 행사방의 대표 숙소는 ${venue.name}입니다.\n주소: ${venue.address}\n이 앱은 경로를 실시간으로 계산하지 않습니다. 실제 소요 시간은 아래 지도에서 이동 수단을 선택해 확인해 주세요.`,
          venueRoute: venueRouteFor(venue.name, data.userMessageText),
          actions: [eventPublicVenueUsedAction],
        } : { text: "이 행사방에서 확인된 공개 대표 숙소가 없어요. 장소 목록에서 대표 숙소를 먼저 확인해 주세요." };
      } else if (retreatVenueReview) {
        loadRetreatVenueReview(db, actor, scope);
        reply = { text: "수련회 결과 보고서의 이용 이력과 비교 후보입니다.", actions: [venueHistoryReplyAction] };
      } else if (detailedPreparation) {
        reply = { text: formatAssistantReply(summarizeRetreatReview(loadRetreatReview(db, actor, scope, "available", new Date(), false), false), preferences.emoji) };
      } else if (localReview) {
        reply = loadPreparationStatus(db, actor, scope);
      } else if (nearbyKind) {
        const previous = previousNearby?.nearbyTask?.kind === nearbyKind ? previousNearby.nearbyTask : undefined;
        const place = nearbyOrigin(data.userMessageText, previous);
        const readVenue = () => place.origin === "hypothetical" && place.venueName ? verifiedPublicPlace(place.venueName)
          : place.origin === "saved" ? readPublicEventVenue(db, scope) : null;
        const venue = readVenue();
        const now = new Date();
        const window = eventWindow(db, scope.roomId);
        let visit = diningVisit(data.userMessageText, now, nearbyKind, window, previous?.visit ?? undefined);
        const requestOnly = requestOnlyConditions(data.userMessageText);
        const peopleInMessage = [...data.userMessageText.matchAll(/(?<!\d)(\d{1,3})\s*명/g)];
        const inheritCount = previous?.work?.people?.source === "event" && peopleInMessage.length === 0;
        const useSavedCount = wantsSavedHeadcount(data.userMessageText) || inheritCount;
        let count: WorkCondition<number> | undefined;
        if (useSavedCount) count = readParticipantCount(db, actor, scope);
        else if (visit?.people != null && peopleInMessage.length === 1) count = { value: visit.people, source: "user", scope: requestOnly ? "request" : "task",
          nature: /가정|예상|가상/.test(data.userMessageText) ? "assumption" : "required" };
        const work = resolveWorkConditions(previous?.work ?? {}, { people: count });
        if (visit && count) visit = { ...visit, people: count.value, groupBand: participantBand(count.value) };
        if (visit && interpretation?.traits.length) visit = { ...visit, traits: [...new Set([...(visit.traits ?? []), ...interpretation.traits])] };
        const root = previous?.candidateMessageId && original.conversation.messages.find(message => message.id === previous.candidateMessageId);
        const snapshot = root || previousNearby;
        const priorResult = previous && snapshot?.dining;
        const venueFingerprint = venue && createHash("sha256").update(JSON.stringify(venue)).digest("hex");
        const age = priorResult ? now.getTime() - Date.parse(priorResult.checkedAt) : Infinity;
        const sameSearch = !!(venueFingerprint && visit && priorResult && previous?.visit && !previous.temporaryResult && previous.venueFingerprint === venueFingerprint
          && isDeepStrictEqual(visit, previous.visit));
        const reusable = sameSearch && age >= 0 && age <= 20 * 60_000;
        assertSourcesStillCurrent = () => {
          if (!isDeepStrictEqual(venue, readVenue()) || visit?.basis.origin === "event" && !isDeepStrictEqual(window, eventWindow(db, scope.roomId))) {
            throw new ApiError(409, "행사 장소나 일정이 변경되었습니다. 다시 요청해 주세요.");
          }
          if (useSavedCount && !isDeepStrictEqual(count, readParticipantCount(db, requireUser(request, db), scope))) {
            throw new ApiError(409, "행사 참가자 정보 또는 조회 권한이 변경되었습니다. 다시 요청해 주세요.");
          }
        };
        const rank = interpretation?.intent === "select" ? interpretation.rank ?? undefined : contextOrdinal(data.userMessageText);
        const selected = rank && reusable ? priorResult?.restaurants[rank - 1] : undefined;
        const wantsAlternative = interpretation?.intent === "alternative" || action === "reference" && /말고|다른\s*(?:곳|데|후보)|대안/.test(data.userMessageText)
          || sameSearch && rank === undefined && /다시\s*(?:추천|검색|찾아|알아봐)/.test(data.userMessageText);
        const extendRanking = !wantsAlternative && reusable && priorResult && rank === priorResult.restaurants.length + 1 && rank <= 3 && wantsSearch(data.userMessageText);
        const approvalRank = rank ?? previous?.selectedCandidateRank ?? (priorResult?.restaurants.length === 1 ? 1 : undefined);
        const placeCandidate = approvalRank ? priorResult?.restaurants[approvalRank - 1] : undefined;
        let candidateMessageId: string | undefined;
        let selectedCandidateRank = previous?.selectedCandidateRank;
        if (savePlace) {
          candidateMessageId = priorResult ? snapshot?.id : undefined;
          if (placeCandidate && priorResult && !hasObviousPrivateData(placeCandidate.name)) {
            selectedCandidateRank = approvalRank;
            reply = { text: `‘${placeCandidate.name}’을 행사방 장소 목록에 추가할 수 있어요. 아래에서 확인하면 저장됩니다.`,
              dining: { ...priorResult, restaurants: [placeCandidate], selectedRank: approvalRank, placeSaveRequested: true } };
          } else reply = { text: "저장할 장소를 고르려면 이전 검색 후보의 순위를 알려주세요." };
        } else if (useSavedCount && !count) reply = { text: "현재 조회 가능한 등록 참가자 수가 없어요. 참가자 등록과 조회 권한을 확인해 주세요. 이전 가정 인원으로 대신 검색하지 않았습니다." };
        else if (interpretation === null || interpretation?.intent === "clarify") {
          reply = { text: "이전 후보를 비교할까요, 아니면 조건을 바꿔 다시 찾을까요? 지원되지 않는 조건은 임의로 적용하지 않았어요." };
          candidateMessageId = reusable ? snapshot?.id : undefined;
        } else if (!venue) reply = { text: place.origin === "unverified" ? "임시로 지정한 장소는 공개 위치를 확인할 수 없어 검색하지 않았어요. 저장된 대표 장소로 바꿔 다시 검색할 수 있습니다."
          : "이 행사방에서 검색에 사용할 공개 대표 장소를 확인하지 못했어요. 장소에서 대표 숙소를 확인해 주세요." };
        else if (!visit) reply = { text: "어느 날짜와 시간에 방문할까요? 예를 들어 ‘내일 아침’이나 ‘토요일 오후 6시’라고 알려주세요." };
        else if (extendRanking && priorResult) {
          const found = await recommendDining(nearbyKind, venue, visit, now, request.signal, priorResult.restaurants.map(item => item.name));
          const next = found.dining?.restaurants[0];
          if (next) {
            reply = { text: `기존 순위를 유지하고 ${rank}순위 후보를 추가로 찾았습니다. 방문 가능 여부는 따로 확인해 주세요.`,
              dining: { ...priorResult, restaurants: [...priorResult.restaurants, next] } };
            candidateMessageId = original.replyId;
          } else {
            reply = { text: `${found.text} 기존 후보와 순위는 유지했습니다.` };
            candidateMessageId = snapshot?.id;
          }
        } else if (selected && priorResult && !wantsAlternative) {
          reply = { text: "이전 검색에서 선택한 후보입니다. 영업과 이동 정보는 당시 검색 내용이며 실제 이용 여부는 확인이 필요해요.",
            dining: { ...priorResult, restaurants: [selected], selectedRank: rank } };
          candidateMessageId = snapshot?.id;
          selectedCandidateRank = rank;
        } else if (rank !== undefined && !wantsAlternative) {
          reply = { text: reusable ? "원래 검색에 그 번호의 후보가 없어요." : "이전 후보의 검색 조건이나 장소가 달라졌거나 결과가 오래됐어요. 최신 후보를 다시 찾아달라고 요청해 주세요." };
          candidateMessageId = reusable ? snapshot?.id : undefined;
        } else if (reusable && interpretation?.intent === "assess") {
          reply = { text: "이전 후보를 유지했습니다. 검색 카드만으로는 가격이나 단체 이용 조건을 확정할 수 없어요.", dining: priorResult || undefined };
          candidateMessageId = snapshot?.id;
        } else if (reusable && /가장\s*가까|가까운\s*순/.test(data.userMessageText)) {
          reply = { text: "같은 이동 수단으로 비교할 수 있는 거리 근거가 부족해 가장 가까운 곳을 확정할 수 없어요. 이전 후보의 ‘숙소에서 길찾기’로 경로를 비교해 주세요.", dining: priorResult || undefined };
          candidateMessageId = snapshot?.id;
        } else if (reusable && action === "reference" && !wantsAlternative) {
          reply = { text: "기존 후보를 다시 보여드려요. 영업이나 방문 가능 여부는 별도 확인이 필요합니다.", dining: priorResult || undefined };
          candidateMessageId = snapshot?.id;
        } else {
          reply = await recommendDining(nearbyKind, venue, visit, now, request.signal, wantsAlternative ? priorResult?.restaurants.map(candidate => candidate.name) : undefined);
          if (reply.dining) {
            candidateMessageId = original.replyId;
            selectedCandidateRank = undefined;
          } else if (sameSearch && priorResult) {
            reply.text += " 기존 후보는 유지했습니다.";
            candidateMessageId = snapshot?.id;
          }
          assertSameHistory(currentTurn());
          if (!hasChatConsent(db, actor.id)) throw new ApiError(423, "OpenAI 전송 동의가 변경되었습니다.");
        }
        if (savePlace && previous && candidateMessageId) {
          reply.nearbyTask = { ...previous, candidateMessageId, ...(selectedCandidateRank && { selectedCandidateRank }) };
        } else if (requestOnly) {
          const active = previousNearby?.nearbyTask;
          if (active) reply.nearbyTask = { ...active, temporaryResult: true };
        } else {
          reply.nearbyTask = { kind: nearbyKind, visit: visit ?? previous?.visit ?? null, ...place, work: work.persistent,
            ...(candidateMessageId && { candidateMessageId, ...(selectedCandidateRank && { selectedCandidateRank }) }), ...(venueFingerprint && { venueFingerprint }) };
        }
      } else {
        const publicVenue = readPublicEventVenue(db, scope);
        const memory = (action !== "new" || original.message.reference != null) && hasReplyContextConsent(db, actor.id);
        let venueUsed: string | undefined;
        const tool = publicVenue ? { definition: eventVenueTool, run: () => {
          assertSameHistory(currentTurn());
          if (!hasChatConsent(db, actor.id)) throw new ApiError(423, "OpenAI 전송 동의가 변경되었습니다.");
          if (memory && !hasReplyContextConsent(db, actor.id)) throw new ApiError(423, "이전 AI 답변 사용 동의가 변경되었습니다.");
          const venue = readPublicEventVenue(db, scope);
          if (!venue) throw new ApiError(409, "대표 장소가 변경되었습니다. 다시 요청해 주세요.");
          venueUsed = JSON.stringify(venue);
          return venueUsed;
        } } : undefined;
        const continuityInstruction = "후속 요청에서는 사용자가 바꾼 조건만 바꾸고 나머지는 유지하세요. 이전 AI 답변은 대화의 후보나 판단이며 저장 또는 확정된 사실이 아닙니다. 임시 가정, 이어가는 조건, 확인된 행사 기록을 구분하세요. 새 요청에는 관련 없는 이전 조건을 적용하지 마세요. 후보나 결정의 근거가 전달되지 않으면 추측하지 마세요. 본인·관리자의 요청에도 생년월일, 연락처, 개인 주소, 이메일, 참가자 명단 원문은 조회하거나 답변에 넣지 마세요.";
        const raw = await generateOpenAIText(chatInput(scope, original.conversation.messages, original.message, memory), request.signal,
          [chatAdvisorPrompt, continuityInstruction, chatOutputInstruction, assistantStyleInstruction(preferences), ...(tool ? ["사용자가 우리 숙소나 행사 장소, 그 주변 식당·활동을 물으면 장소를 다시 묻기 전에 get_current_event_venue를 호출하세요. 결과는 저장된 대표 장소의 공개 기본 정보이며 주변 시설의 최신 검색 결과가 아닙니다."] : [])].join("\n\n"), advisorReplyFormat, tool);
        assertSourcesStillCurrent = () => {
          if (memory && !hasReplyContextConsent(db, actor.id)) throw new ApiError(423, "이전 AI 답변 사용 동의가 변경되었습니다.");
          if (venueUsed && venueUsed !== JSON.stringify(readPublicEventVenue(db, scope))) throw new ApiError(409, "대표 장소가 변경되었습니다. 다시 요청해 주세요.");
        };
        const answer = parseAdvisorReply(raw);
        if (!answer) throw new ApiError(502, "AI 답변 형식을 읽지 못했습니다. 답변을 다시 요청해 주세요.");
        if ([answer.summary, answer.title, answer.rationale, ...answer.rows.flatMap(row => [row.label, row.detail]), ...answer.proposals.map(proposal => proposal.title)].some(hasObviousPrivateData)) {
          throw new ApiError(502, "AI 답변에 공개할 수 없는 정보가 포함되어 표시하지 않았습니다. 작성한 질문은 그대로 있으니 ‘답변 다시 요청’을 눌러 주세요.");
        }
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
        if (!localReview && !hasChatConsent(db, actor.id)) throw new ApiError(423, "OpenAI 전송 동의가 변경되었습니다.");
        assertSourcesStillCurrent();
        const replyId = original.nearbyKind && !nearbyKind ? replyIdFor(scope, latest.message, false, false) : latest.replyId;
        latest.conversation.messages.push({ id: replyId, sender: "assistant", ...reply, time: "방금 전", replyElapsedMs: Math.round(performance.now() - startedAt) });
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
    } finally { pending.delete(original.key); }
  } catch (error) { return errorResponse(error); }
}
