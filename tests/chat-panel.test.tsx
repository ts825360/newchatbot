import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatPanel } from "../components/chat-panel";
import type { Conversation } from "../lib/conversation-store";
import { defaultSurveyItems } from "../lib/chat-survey-draft";

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

it("renders ranked restaurants with keyboard-focusable map and source links", () => {
  const url = "https://restaurant.example.org/hours";
  const dining = { date: "2026-11-26", visitTime: "18:00", checkedAt: "2026-11-26T08:00:00.000Z", venue: "가상 숙소", restaurants: [
    { name: "가상 식당", reason: "지역 해산물 요리", hours: "17:00~20:30", rating: null, sources: [{ url, label: "식당 영업시간" }] },
  ] };
  render(<ChatPanel {...props} conversation={{ ...conversation, messages: [conversation.messages[0], { ...conversation.messages[1], dining }] }} />);
  const result = within(screen.getByRole("region", { name: "주변 식당 추천" }));
  expect(result.getByRole("heading", { name: /1순위.*가상 식당/ })).toBeDefined();
  expect(result.getByText(/확인되지 않음/)).toBeDefined();
  expect(result.getByRole("link", { name: "영업 출처" }).getAttribute("href")).toBe(url);
  const map = new URL(result.getByRole("link", { name: "지도에서 찾기" }).getAttribute("href")!);
  expect(map.searchParams.get("query")).toContain("가상 식당");
  const route = new URL(result.getByRole("link", { name: "숙소에서 길찾기" }).getAttribute("href")!);
  expect(route.searchParams.get("origin")).toBe("가상 숙소");
  expect(route.searchParams.get("destination")).toContain("가상 식당");
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

it("renders ten persisted display-only rows in an ordered list without exposing approval actions or markup", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ label: `준비 ${index + 1}`, detail: "<em>일반 텍스트</em>" }));
  const message = { ...conversation.messages[1], id: `openai-${"a".repeat(64)}`,
    advisor: { version: 2 as const, kind: "list" as const, title: "준비 항목", rationale: "", rows, proposals: [] } };
  const persisted: Conversation = JSON.parse(JSON.stringify({ ...conversation, messages: [conversation.messages[0], message] }));
  render(<ChatPanel {...props} conversation={persisted} onReviewProposals={vi.fn()} />);
  const region = within(screen.getByText("예시 답변").closest("article")!);
  expect(region.getByRole("list").tagName).toBe("OL");
  expect(region.getAllByRole("listitem")).toHaveLength(10);
  expect(region.getByText("준비 10")).toBeDefined();
  expect(region.getAllByText("<em>일반 텍스트</em>")).toHaveLength(10);
  expect(region.queryByRole("button", { name: /제안 검토/ })).toBeNull();
});

it("shows verified survey status before the explanation and keeps the rationale next to the artifact", () => {
  const message: Conversation["messages"][number] = {
    ...conversation.messages[1],
    text: "차량 수요는 응답 이후에 계산합니다.",
    advisor: { kind: "plan", title: "응답 이후 할 일", rows: [{ label: "인원 집계", detail: "회신을 집계합니다." }], rationale: "확정 인원을 기준으로 합니다.", proposals: [] },
    workResult: { kind: "survey", operation: "create", version: 1, status: "review_pending" },
    workProposal: { kind: "survey", title: "참가 설문", draft: {
      id: "cafebabe-0000-0000-0000-000000000001", version: 1, template: "retreat", templateVersion: 2,
      title: "참가 설문", description: "", items: defaultSurveyItems(),
    } },
  };
  render(<ChatPanel {...props} conversation={{ ...conversation, messages: [message] }} renderWorkProposal={() => <p>설문 검토 카드</p>} />);
  const verified = screen.getByText("서버 확인");
  const explanation = screen.getByText("차량 수요는 응답 이후에 계산합니다.");
  expect(verified.parentElement?.textContent).toContain("별도 승인");
  expect(verified.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("확정 인원을 기준으로 합니다.").closest("details")).not.toBeNull();
  expect(screen.getByText("설문 검토 카드")).toBeDefined();
});

it("opens message actions and sends a reply to the selected assistant message", () => {
  render(<ChatPanel {...props} conversation={{ ...conversation, draft: "이 답변을 이어서 알려줘" }} />);
  const answer = within(screen.getByText("예시 답변").closest("article")!);
  expect(answer.getByRole("button", { name: "메시지 작업" })).toBeTruthy();
  expect(answer.queryByRole("button", { name: "수정" })).toBeNull();
  fireEvent.click(answer.getByRole("button", { name: "답장" }));
  expect(screen.getByText("행사비서에게 답장").closest("form")).toBe(screen.getByRole("textbox", { name: "메시지" }).closest("form"));
  fireEvent.click(screen.getByRole("button", { name: "전송" }));
  expect(props.onSendMessage).toHaveBeenLastCalledWith("이 답변을 이어서 알려줘", { kind: "reply", messageId: "answer" });
});

it("allows copying both speakers directly and keeps the visible title and rows in a structured reply", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard: { writeText } }));
  try {
    const messages: Conversation["messages"] = [conversation.messages[0], { ...conversation.messages[1], actions: ["PRIVATE_ACTION"],
      advisor: { kind: "plan", title: "출발 계획", rows: [{ label: "1. 이동", detail: "단체 차량 후보" }], rationale: "검토 근거", proposals: [] } }];
    render(<ChatPanel {...props} conversation={{ ...conversation, messages }} />);
    const question = within(screen.getByText("저장한 장소 알려줘").closest("article")!);
    const answer = within(screen.getByText("예시 답변").closest("article")!);
    fireEvent.click(question.getByRole("button", { name: "복사" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("저장한 장소 알려줘"));
    fireEvent.click(answer.getByRole("button", { name: "복사" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("출발 계획\n예시 답변\n1. 이동: 단체 차량 후보\n검토 근거"));
    fireEvent.click(question.getByRole("button", { name: "답장" }));
    expect(screen.getByText("내 메시지에 답장").closest("form")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "답장 취소" }));
    expect(screen.queryByText("내 메시지에 답장")).toBeNull();
  } finally { vi.unstubAllGlobals(); }
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
