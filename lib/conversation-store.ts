import { createAssistantReply } from "./prototype-state";
import type { ChatMessage } from "./types";
import { writeBrowserRecord } from "./storage-status";
import { dataStorage, isBackendConnected } from "./backend-client";
import { conversationHistoryKey, initialConversationId } from "./conversation-scope";
import { internalChatAction } from "./assistant-privacy";

export type Conversation = {
  id: string;
  title: string;
  draft: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};
export type ConversationHistory = { conversations: Conversation[]; activeId: string | null };
type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

function validConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "title", "draft", "createdAt", "updatedAt"].every((key) => typeof item[key] === "string")
    && Array.isArray(item.messages) && item.messages.every((message: unknown) => {
      if (!message || typeof message !== "object") return false;
      const data = message as Record<string, unknown>;
      return ["id", "text", "time"].every((key) => typeof data[key] === "string")
        && ["user", "assistant"].includes(data.sender as string)
        && (data.actions === undefined || (Array.isArray(data.actions) && data.actions.every((action) => typeof action === "string")));
    });
}

export function createConversationStore(storage: BrowserStorage, accountId: string, roomId: string, seedMessages: ChatMessage[] = []) {
  storage = dataStorage(storage);
  const key = conversationHistoryKey(accountId, roomId);
  const makeConversation = (id = globalThis.crypto.randomUUID()): Conversation => {
    const now = new Date().toISOString();
    return { id, title: "새 대화", draft: "", messages: [], createdAt: now, updatedAt: now };
  };
  const load = (): ConversationHistory => {
    try {
      const raw = storage.getItem(key);
      if (raw === null) {
        const first = makeConversation(initialConversationId(roomId));
        first.messages = seedMessages.map((message) => ({ ...message, actions: message.actions ? [...message.actions] : undefined }));
        first.title = seedMessages.length ? "행사 준비 대화" : "새 대화";
        return { conversations: [first], activeId: first.id };
      }
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") throw Error("Invalid history");
      const data = value as Record<string, unknown>;
      if (!Array.isArray(data.conversations) || !data.conversations.every(validConversation)) throw Error("Invalid conversations");
      if (new Set(data.conversations.map((item) => item.id)).size !== data.conversations.length) throw Error("Duplicate IDs");
      return {
        conversations: data.conversations,
        activeId: typeof data.activeId === "string" && data.conversations.some((item) => item.id === data.activeId)
          ? data.activeId : data.conversations[0]?.id ?? null
      };
    } catch { throw new Error("대화 기록을 읽지 못했습니다. 사이트 저장소 설정을 확인해 주세요."); }
  };
  const save = (data: ConversationHistory) => {
    try { writeBrowserRecord(storage, key, data, "tab"); }
    catch { throw new Error("대화를 저장하지 못했습니다. 사이트 저장소를 허용하거나 저장 공간을 확인해 주세요."); }
    return data;
  };
  const find = (data: ConversationHistory, id: string) => {
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("대화를 찾을 수 없습니다.");
    return conversation;
  };
  return {
    load,
    create() {
      const data = load();
      const conversation = makeConversation();
      return save({ conversations: [conversation, ...data.conversations], activeId: conversation.id });
    },
    select(id: string) {
      const data = load();
      find(data, id);
      return save({ ...data, activeId: id });
    },
    rename(id: string, title: string) {
      const name = title.trim();
      if (!name || name.length > 60) throw new Error("대화 이름은 1~60자로 입력해 주세요.");
      const data = load();
      find(data, id).title = name;
      return save(data);
    },
    delete(id: string) {
      const data = load();
      find(data, id);
      const remaining = data.conversations.filter((item) => item.id !== id);
      return save({ conversations: remaining, activeId: data.activeId === id ? remaining[0]?.id ?? null : data.activeId });
    },
    setDraft(id: string, draft: string) {
      if (draft.length > 8000) throw new Error("메시지는 8,000자 이내로 입력해 주세요.");
      const data = load();
      find(data, id).draft = draft;
      return save(data);
    },
    send(id: string, text: string, { localOnly = false } = {}) {
      const data = load();
      const conversation = find(data, id);
      const message = text.trim();
      if (!message) return data;
      if (message.length > 8000) throw new Error("메시지는 8,000자 이내로 입력해 주세요.");
      if (!conversation.messages.length && conversation.title === "새 대화") conversation.title = message.slice(0, 30);
      conversation.messages.push({ id: globalThis.crypto.randomUUID(), sender: "user", text: message, time: "방금 전", ...(localOnly && { actions: [internalChatAction] }) });
      if (!isBackendConnected()) conversation.messages.push({ id: globalThis.crypto.randomUUID(), sender: "assistant", text: createAssistantReply(message), time: "방금 전" });
      conversation.draft = "";
      conversation.updatedAt = new Date().toISOString();
      return save(data);
    }
  };
}
