import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatPanel } from "../components/chat-panel";
import type { Conversation } from "../lib/conversation-store";

const conversation: Conversation = {
  id: "example", title: "예시 대화", draft: "", createdAt: "2026-11-26", updatedAt: "2026-11-26",
  messages: [
    { id: "question", sender: "user", text: "저장한 장소 알려줘", time: "방금 전" },
    { id: "answer", sender: "assistant", text: "예시 답변", time: "14:00" },
  ],
};
const props = { conversation, onDraftChange: vi.fn(), onSendMessage: vi.fn(), onNewConversation: vi.fn(), onOpenDocuments: vi.fn() };

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps the speaker and text but hides stored timestamps from message turns", () => {
  render(<ChatPanel {...props} />);
  const log = within(screen.getByRole("log", { name: "대화 내용" }));
  expect(log.getByText("나")).toBeDefined();
  expect(log.getByText("행사비서")).toBeDefined();
  expect(log.queryByText("방금 전")).toBeNull();
  expect(log.queryByText("14:00")).toBeNull();
});

it("shows current request elapsed time and resets it between replies", () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
  const view = render(<ChatPanel {...props} replyStartedAt={performance.now()} />);
  expect(screen.getByText("답변 작성 중")).toBeDefined();
  act(() => vi.advanceTimersByTime(3100));
  expect(screen.getByText("3초")).toBeDefined();
  view.rerender(<ChatPanel {...props} replyStartedAt={null} />);
  expect(screen.queryByText("답변 작성 중")).toBeNull();
  view.rerender(<ChatPanel {...props} replyStartedAt={performance.now()} />);
  expect(screen.getByText("0초")).toBeDefined();
});
