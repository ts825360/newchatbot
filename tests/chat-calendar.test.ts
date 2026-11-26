import { describe, expect, it } from "vitest";
import { chatCalendarSourceId, createChatCalendarEvent, extractChatCalendarFields } from "../lib/chat-calendar";
import { createPreparationStore } from "../lib/preparation-store";

describe("explicit chat calendar fields", () => {
  it.each([
    ["2026-11-18 회의", "2026-11-18"],
    ["2028년 2월 29일 회의", "2028-02-29"],
    ["2026년11월18일 회의", "2026-11-18"],
    ["2000-02-29", "2000-02-29"],
    ["2026-11-18 (2026년 11월 18일)", "2026-11-18"],
  ])("extracts one explicit valid date from %s", (text, date) => {
    expect(extractChatCalendarFields(text).date).toBe(date);
  });

  it.each([
    "2026-02-29", "1900-02-29", "2026년 4월 31일", "2026-13-01", "2026-00-10",
    "2026-01-00", "2026-1-2", "12026-11-18", "2026-11-180", "0000-01-01",
    "11월 18일", "11/18", "내일 오후 3시", "다음 주 월요일", "회의하자",
    "2026-11-18 또는 2026-11-19", "2026-11-18 또는 11월 19일",
    "2026-11-18 또는 내일", "2026-11-18 또는 2026-02-30",
    "2026-11-18/2026-11-19", "2026년 11월 18일 또는 2027-1-2",
    "2026-11-18 아니 내년", "2026년 11월 18일 또는 2026-11-180",
    "2026-11-18은 제외하고 회의", "2026년 11월 18일은 빼고 새 날짜를 정해줘",
  ])("requires manual date input for %s", text => {
    const fields = extractChatCalendarFields(text);
    expect(fields.date).toBe("");
    expect(fields.time).toBe("");
    expect(fields.dateIssue).not.toBeNull();
  });

  it.each([
    ["15:30", "15:30"], ["오후 3시 20분", "15:20"], ["오전 12시", "00:00"],
    ["오후 12:05", "12:05"], ["오전 9시", "09:00"],
    ["3시", ""], ["3:30", ""], ["오후 13시", ""], ["25:00", ""],
    ["09:70", ""], ["15:30 또는 16:30", ""], ["오전 9시 또는 오후 3시", ""],
    ["오후 3시 반", ""], ["15:30 UTC", ""], ["15:30 KST", ""],
    ["15:30은 제외", ""],
  ])("only prefills an unambiguous time: %s", (time, expected) => {
    expect(extractChatCalendarFields(`2026-11-18 ${time} 회의`).time).toBe(expected);
  });
});

describe("private chat calendar capture", () => {
  const source = { accountId: "account", conversationId: "conversation", messageId: "message" };

  it("uses a stable source ID scoped to account, conversation and message", () => {
    const id = chatCalendarSourceId(source.accountId, source.conversationId, source.messageId);
    expect(chatCalendarSourceId("account", "conversation", "message")).toBe(id);
    expect(chatCalendarSourceId("other", "conversation", "message")).not.toBe(id);
    expect(chatCalendarSourceId("account", "other", "message")).not.toBe(id);
    expect(chatCalendarSourceId("account", "conversation", "other")).not.toBe(id);
    expect(chatCalendarSourceId("a:b", "c", "d")).not.toBe(chatCalendarSourceId("a", "b:c", "d"));
  });

  it("bounds real UUID sources with conversation/message prefixes to the server ID limit", () => {
    const accountId = "550e8400-e29b-41d4-a716-446655440000";
    const conversationId = "conversation-550e8400-e29b-41d4-a716-446655440001";
    const messageId = "message-550e8400-e29b-41d4-a716-446655440002";
    const id = chatCalendarSourceId(accountId, conversationId, messageId);
    expect(typeof id).toBe("string");
    expect(id.length).toBeLessThanOrEqual(128);
    expect(id).toMatch(/^chat:v1:[a-f0-9]{32}$/);
    expect(chatCalendarSourceId(accountId, conversationId, messageId)).toBe(id);
  });

  it("preserves already valid source IDs, including the 128-character boundary", () => {
    expect(chatCalendarSourceId("account", "conversation", "message")).toBe("chat:account:conversation:message");
    expect(chatCalendarSourceId("계정", "대화", "메시지")).toBe(`chat:${["계정", "대화", "메시지"].map(encodeURIComponent).join(":")}`);
    const exact = chatCalendarSourceId("a".repeat(119), "b", "c");
    expect(exact).toBe(`chat:${"a".repeat(119)}:b:c`);
    expect(exact).toHaveLength(128);
    expect(chatCalendarSourceId("a".repeat(120), "b", "c")).toMatch(/^chat:v1:[a-f0-9]{32}$/);
  });

  it.each([
    ["a".repeat(200), "conversation", "message"],
    ["계정".repeat(100), "대화\u{1f4c5}", "메시지\u{1f680}"],
    ["a".repeat(200), ":/\u0000\"%", "\\\n"],
    ["a".repeat(200), "\ud800", "\udfff"],
    ["long".repeat(20000), "conversation", "message"],
  ])("synchronously hashes long and Unicode tuples into stable 128-bit IDs (case %#)", (accountId, conversationId, messageId) => {
    const id = chatCalendarSourceId(accountId, conversationId, messageId);
    expect(id).toMatch(/^chat:v1:[a-f0-9]{32}$/);
    expect(chatCalendarSourceId(accountId, conversationId, messageId)).toBe(id);
  });

  it("keeps tuple boundaries and differences beyond a long shared prefix in the digest", () => {
    const prefix = "same-prefix".repeat(1000);
    const tuples = [
      [prefix, "conversation", "message-a"], [prefix, "conversation", "message-b"],
      [prefix + "a", "conversation", "message-a"], [prefix, "other-conversation", "message-a"],
      [prefix + ":x", "y", "z"], [prefix, "x:y", "z"],
      [prefix, "\u00e9", "message"], [prefix, "e\u0301", "message"],
      [prefix, "계정가", "메시지"], [prefix, "계정나", "메시지"],
      [prefix, "\ud800", "message"], [prefix, "\ufffd", "message"],
    ];
    const ids = tuples.map(([accountId, conversationId, messageId]) => chatCalendarSourceId(accountId, conversationId, messageId));
    expect(new Set(ids).size).toBe(tuples.length);
    expect(ids.every(id => id.length <= 128)).toBe(true);
  });

  it("hashes malformed Unicode identifiers deterministically instead of throwing", () => {
    const id = chatCalendarSourceId("\ud800", "conversation", "message");
    expect(id).toMatch(/^chat:v1:[a-f0-9]{32}$/);
    expect(chatCalendarSourceId("\ud800", "conversation", "message")).toBe(id);
    expect(chatCalendarSourceId("\ud801", "conversation", "message")).not.toBe(id);
  });

  it("does not copy private content into any shared event field", () => {
    const event = createChatCalendarEvent({ ...source, text: "2026-11-18 오후 3시\n비공개 개인 상담 내용", author: "담당자" });
    expect(event).toMatchObject({ title: "대화에서 추가한 일정", date: "2026-11-18", time: "15:00", memo: "", location: "", status: "confirmed" });
    expect(JSON.stringify(event)).not.toContain("비공개");
  });

  it("upserts the same source instead of making a duplicate and preserves the reviewed title", () => {
    const storage = new Map<string, string>();
    const store = createPreparationStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } }, "room");
    const draft = createChatCalendarEvent({ ...source, text: "2026-11-18 회의", author: "담당자" });
    store.saveEvent(draft);
    store.saveEvent({ ...draft, title: "사용자가 선택한 공유 제목" }, true);
    expect(store.loadEvents()).toEqual([{ ...draft, title: "사용자가 선택한 공유 제목" }]);
  });
});
