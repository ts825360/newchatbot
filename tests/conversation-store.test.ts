import { beforeEach, describe, expect, it } from "vitest";
import { createConversationStore } from "../lib/conversation-store";

beforeEach(() => sessionStorage.clear());
const make = (account = "one", room = "retreat") => createConversationStore(sessionStorage, account, room);

describe("private event conversations", () => {
  it("starts with one empty conversation and restores changes across reload", () => {
    const store = make();
    const first = store.load().conversations[0];
    expect(first.messages).toEqual([]);
    expect(first.title).toBe("새 대화");
    store.rename(first.id, "차량 준비");
    expect(make().load().conversations[0].title).toBe("차량 준비");
  });

  it("creates and selects separate conversations without mixing messages or drafts", () => {
    const store = make();
    const first = store.load().activeId!;
    store.setDraft(first, "전송 전 메모");
    const next = store.create();
    const second = next.activeId!;
    expect(second).not.toBe(first);
    store.send(second, "차량 준비에서 빠진 게 뭐야?");
    const restored = store.select(first);
    expect(restored.conversations.find((item) => item.id === first)?.draft).toBe("전송 전 메모");
    expect(restored.conversations.find((item) => item.id === first)?.messages).toHaveLength(0);
    const conversation = restored.conversations.find((item) => item.id === second)!;
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.title).toBe("차량 준비에서 빠진 게 뭐야?");
    expect(conversation.draft).toBe("");
  });

  it("keeps account and event histories independent", () => {
    const store = make();
    store.send(store.load().activeId!, "이 방만의 메시지");
    expect(make("two").load().conversations[0].messages).toHaveLength(0);
    expect(make("one", "christmas").load().conversations[0].messages).toHaveLength(0);
  });

  it("preserves an empty history after deleting the last conversation", () => {
    const store = make();
    const result = store.delete(store.load().activeId!);
    expect(result.activeId).toBeNull();
    expect(make().load().conversations).toEqual([]);
    expect(store.create().conversations).toHaveLength(1);
  });

  it("selects another conversation when the current one is deleted", () => {
    const store = make();
    const first = store.load().activeId!;
    const second = store.create().activeId!;
    expect(store.delete(second).activeId).toBe(first);
  });

  it("validates titles, unknown conversation IDs and empty messages", () => {
    const store = make();
    const id = store.load().activeId!;
    expect(() => store.rename(id, " ")).toThrow("이름");
    expect(() => store.select("unknown")).toThrow("대화");
    expect(store.send(id, " ").conversations[0].messages).toHaveLength(0);
  });

  it("treats slash text as ordinary conversation text without a privileged command path", () => {
    const store = make();
    const data = store.send(store.load().activeId!, "/admin");
    expect(data.conversations[0].messages[0].text).toBe("/admin");
    expect(data.conversations[0].messages).toHaveLength(2);
  });

  it("surfaces unavailable storage instead of pretending changes were saved", () => {
    const broken = createConversationStore({ getItem: () => null, setItem: () => { throw Error("quota"); } }, "one", "retreat");
    expect(() => broken.create()).toThrow("저장");
    const corrupt = createConversationStore({ getItem: () => "{broken", setItem: () => undefined }, "one", "retreat");
    expect(() => corrupt.load()).toThrow("읽지");
  });
});
