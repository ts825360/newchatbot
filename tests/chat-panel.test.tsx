import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  const pending = { ...conversation, messages: conversation.messages.slice(0, 1) };
  const view = render(<ChatPanel {...props} conversation={pending} replyStartedAt={performance.now()} />);
  const log = within(screen.getByRole("log", { name: "대화 내용" }));
  expect(log.getByText("답변 작성 중")).toBeDefined();
  act(() => vi.advanceTimersByTime(3100));
  expect(screen.getByText("3초")).toBeDefined();
  view.rerender(<ChatPanel {...props} replyStartedAt={null} />);
  expect(screen.queryByText("답변 작성 중")).toBeNull();
  view.rerender(<ChatPanel {...props} conversation={pending} replyStartedAt={performance.now()} />);
  expect(screen.getByText("0초")).toBeDefined();
});

it("renders the recorded duration above the matching assistant reply only", () => {
  const completed: Conversation = { ...conversation, messages: [conversation.messages[0], { ...conversation.messages[1], replyElapsedMs: 4100 }] };
  render(<ChatPanel {...props} conversation={completed} />);
  const answer = screen.getByText("예시 답변");
  const duration = within(answer.closest("article")!).getByText("4초 소요");
  expect(duration.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("opens message actions and sends a reply to the selected assistant message", () => {
  render(<ChatPanel {...props} conversation={{ ...conversation, draft: "이 답변을 이어서 알려줘" }} />);
  const answer = within(screen.getByText("예시 답변").closest("article")!);
  fireEvent.click(answer.getByRole("button", { name: "메시지 작업" }));
  expect(answer.queryByRole("button", { name: "수정" })).toBeNull();
  fireEvent.click(answer.getByRole("button", { name: "답장" }));
  expect(screen.getByText("행사비서에게 답장")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "전송" }));
  expect(props.onSendMessage).toHaveBeenLastCalledWith("이 답변을 이어서 알려줘", { kind: "reply", messageId: "answer" });
});

it("fills the editor with the original text and resends the correction", () => {
  render(<ChatPanel {...props} />);
  const question = within(screen.getByText("저장한 장소 알려줘").closest("article")!);
  fireEvent.click(question.getByRole("button", { name: "메시지 작업" }));
  fireEvent.click(question.getByRole("button", { name: "수정" }));
  const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메시지" });
  expect(editor.value).toBe("저장한 장소 알려줘");
  fireEvent.change(editor, { target: { value: "저장한 날짜 알려줘" } });
  fireEvent.click(screen.getByRole("button", { name: "수정하고 다시 보내기" }));
  expect(props.onSendMessage).toHaveBeenLastCalledWith("저장한 날짜 알려줘", { kind: "edit", messageId: "question" });
});
