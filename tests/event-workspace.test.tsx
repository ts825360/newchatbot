import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventWorkspace } from "../components/event-workspace";
import { PreparationProgressReview, PreparationProgressShortcut } from "../components/preparation-progress-review";
import { createInitialState } from "../lib/prototype-state";
import { configureBackendUser, enableBackendConnection, refreshBackendData, resetBackendClient } from "../lib/backend-client";
import { conversationHistoryKey } from "../lib/conversation-scope";
import type { ConversationHistory } from "../lib/conversation-store";
import type { ChatMessage } from "../lib/types";
import { chatProposalCandidates } from "../lib/chat-tool-candidates";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
vi.mock("../components/location-panel", () => ({ LocationPanel: ({ location }: { location: string }) => <div data-testid="location-panel">{location}</div> }));
vi.mock("../lib/document-files", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/document-files")>(),
  createIndexedDBBlobStore: () => ({ put: vi.fn(), get: vi.fn(), delete: vi.fn(), queueCleanup: vi.fn(), listCleanup: async () => [], retireCleanup: vi.fn() })
}));
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); resetBackendClient(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const initial = createInitialState();
const openGroupedTool = (group: string, name: string) => {
  const trigger = screen.getByRole("button", { name: group });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name }));
};
const props = {
  room: initial.rooms[0], profile: { ...initial.profile, accountId: "test-account" }, seedMessages: [],
  notice: "", darkMode: false, onToggleTheme: vi.fn(), onSignOut: vi.fn(), onBackToRooms: vi.fn(),
  onAddExtractedEvent: vi.fn(), onAddExtractedChecklist: vi.fn(),
  renderTools: (mode: "calendar" | "prepare") => <div>{mode === "calendar" ? "캘린더 내용" : "준비 내용"}</div>
};

describe("workspace 3-1", () => {
  it("moves keyboard focus into conversation history when opening it", () => {
    render(<EventWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "대화 목록 닫기" }));
    const open = screen.getByRole("button", { name: "대화 목록 열기" });
    open.focus();
    fireEvent.click(open);
    expect(document.activeElement).toBe(within(screen.getByRole("complementary", { name: "대화 기록" })).getByRole("heading", { name: "대화 기록" }));
  });

  it("keeps navigation above the private history and reuses the inspector when opening a summary shortcut", () => {
    render(<EventWorkspace {...props} overview={() => ({ calendar: { state: "ready", items: [] }, onEvent: vi.fn() })} />);
    const history = screen.getByRole("complementary", { name: "대화 기록" });
    expect(within(history).getByRole("button", { name: "행사방 목록" })).toBeDefined();
    const toggle = screen.getByRole("button", { name: "행사 요약 열기" });
    fireEvent.click(toggle);
    const inspector = screen.getByRole("complementary", { name: "행사 요약" });
    expect(within(inspector).getByRole("separator", { name: "부가기능 너비 조절" })).toBeDefined();
    fireEvent.click(within(inspector).getByRole("button", { name: "전체 일정 보기" }));
    expect(screen.getByRole("complementary", { name: "부가기능" })).toBe(inspector);
    const back = within(inspector).getByRole("button", { name: "행사 요약으로 돌아가기" });
    back.focus();
    fireEvent.click(back);
    expect(screen.getByRole("complementary", { name: "행사 요약" })).toBe(inspector);
    expect(document.activeElement).toBe(within(inspector).getByRole("heading", { name: "행사 요약" }));
  });

  it("starts with a one-line composer, leaves shift-enter for line breaks and does not send during IME composition", () => {
    render(<EventWorkspace {...props} />);
    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메시지" });
    expect(composer.rows).toBe(1);
    fireEvent.change(composer, { target: { value: "준비 확인" } });
    expect(fireEvent.keyDown(composer, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(composer, { key: "Enter", isComposing: true })).toBe(true);
    expect(screen.queryByText("준비 확인", { selector: "p" })).toBeNull();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(screen.getByText("준비 확인", { selector: "p" })).toBeDefined();
  });

  it("puts named tools in a separate group and restores focus when the panel closes", () => {
    render(<EventWorkspace {...props} renderProposals={() => null} />);
    const tools = within(screen.getByRole("navigation", { name: "행사방 도구" }));
    const calendar = tools.getByRole("button", { name: "일정 열기" });
    expect(calendar.textContent).toBe("일정");
    const preparation = tools.getByRole("button", { name: "행사 준비" });
    expect(tools.queryByRole("button", { name: "준비 현황 열기" })).toBeNull();
    fireEvent.click(preparation);
    expect(tools.getByRole("button", { name: "준비 현황 열기" }).textContent).toBe("준비 현황");
    expect(tools.queryByRole("button", { name: "로그아웃" })).toBeNull();
    fireEvent.click(calendar);
    expect(calendar.getAttribute("aria-pressed")).toBe("true");
    const panel = within(screen.getByRole("complementary", { name: "부가기능" }));
    const close = panel.getByRole("button", { name: "부가기능 닫기" });
    close.focus();
    fireEvent.click(close);
    expect(document.activeElement).toBe(calendar);
    expect(calendar.getAttribute("aria-pressed")).toBe("false");
  });

  it("returns from a full-width vehicle tool to visible conversation history", () => {
    render(<EventWorkspace {...props} />);
    openGroupedTool("참가·이동", "차량 배정 열기");
    const history = screen.getByRole("button", { name: "대화 목록 열기" });
    expect(history.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(history);
    expect(screen.queryByRole("complementary", { name: "부가기능" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "대화 기록" })).toBeDefined();
  });

  it("returns to the room list from the brand or the top bar with history still open", () => {
    render(<EventWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "행사비서: 행사방 목록" }));
    fireEvent.click(screen.getByRole("button", { name: "행사방 목록으로 돌아가기" }));
    expect(props.onBackToRooms).toHaveBeenCalledTimes(2);
  });

  it("uses the shared settings control in the sidebar and the toolbar fallback", () => {
    const open = vi.fn();
    render(<EventWorkspace {...props} onOpenSettings={open} />);
    const history = within(screen.getByRole("complementary", { name: "대화 기록" }));
    const rail = history.getByRole("button", { name: "환경설정" });
    expect(rail.getAttribute("data-settings-entry")).toBe("rail");
    fireEvent.click(rail);
    fireEvent.click(screen.getByRole("button", { name: "대화 목록 닫기" }));
    const toolbar = screen.getByRole("button", { name: "환경설정" });
    expect(toolbar.getAttribute("data-settings-entry")).toBe("toolbar");
    fireEvent.click(toolbar);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it.each([["숙소 배정", "lodging"], ["차량 배정", "transport"]] as const)("keeps the workspace theme and selection in the full-width %s tool", (name, tool) => {
    render(<EventWorkspace {...props} />);
    openGroupedTool("참가·이동", `${name} 열기`);
    expect(screen.getByRole("complementary", { name: "부가기능" }).classList.contains("workspace-theme")).toBe(true);
    const group = screen.getByRole("button", { name: "참가·이동" });
    expect(group.getAttribute("data-active")).toBe("true");
    fireEvent.click(group);
    const option = screen.getByRole("button", { name: `${name} 닫기` });
    expect(option.getAttribute("data-tool")).toBe(tool);
    expect(option.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the consent-gated progress in chat, keeps it across tools, and hides it for the next conversation", async () => {
    const profile = props.profile;
    const roomId = props.room.id;
    const record = { key: conversationHistoryKey(profile.accountId, roomId), version: "1", value: JSON.stringify({ activeId: "first", conversations: ["first", "second"].map(id => ({ id, title: id, draft: "", messages: [], createdAt: "2026-11-25", updatedAt: "2026-11-25" })) } satisfies ConversationHistory) };
    const review = vi.fn(() => Response.json({ state: "remaining", percent: 33, notes: ["미완료 항목 2개"] }));
    vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/api/preparation-progress") return review();
      if (path.startsWith("/api/preparation-progress?")) return Response.json({ report: null, stale: false });
      if (path === "/api/data" && init.method === "POST") {
        const [write] = JSON.parse(init.body as string).writes;
        Object.assign(record, { value: write.value, version: "2" });
        return Response.json({ profile, activeRoomId: roomId, records: [record], written: [record] });
      }
      return Response.json({ profile, activeRoomId: roomId, records: [record] });
    }));
    enableBackendConnection(true);
    configureBackendUser(profile);
    await refreshBackendData(roomId);
    render(<EventWorkspace {...props} overview={() => ({ onEvent: vi.fn() })} />);
    const chat = within(screen.getByRole("region", { name: "개인 대화" }));
    fireEvent.click(await chat.findByRole("button", { name: "준비 진행도 · 미검토" }));
    const summary = within(screen.getByRole("complementary", { name: "행사 요약" }));
    expect((await summary.findByRole("progressbar", { name: "준비 진행도" })).getAttribute("value")).toBe("0");
    expect(summary.getByText("0%")).toBeDefined();
    expect(summary.getByText("아직 점검하지 않았어요.")).toBeDefined();
    fireEvent.click(summary.getByRole("button", { name: "중간점검" }));
    expect(review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "확인하고 점검" }));
    expect(await chat.findByRole("button", { name: "준비 진행도 · 33%" })).toBeDefined();
    expect(summary.getByRole("progressbar", { name: "준비 진행도" }).getAttribute("value")).toBe("33");
    openGroupedTool("참가·이동", "차량 배정 열기");
    fireEvent.click(screen.getByRole("button", { name: "대화" }));
    expect(chat.getByRole("button", { name: "준비 진행도 · 33%" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "second 선택" }));
    expect(chat.queryByRole("button", { name: "준비 진행도 · 33%" })).toBeNull();
    expect(await chat.findByRole("button", { name: "준비 진행도 · 미검토" })).toBeDefined();
    expect(review).toHaveBeenCalledTimes(1);
  });

  it.each(["pending", "remaining"] as const)("displays an empty graph and preserves the reasons when %s has no calculated score", state => {
    const view = { busy: false, loading: false, saving: false, error: "", stale: false, report: { state, percent: null, notes: ["확정된 일정이 필요합니다."] } };
    render(<><PreparationProgressShortcut {...view} onOpen={vi.fn()} /><PreparationProgressReview {...view} review={vi.fn()} /></>);
    expect(screen.getByRole("button", { name: "준비 진행도 · 0%" })).toBeDefined();
    expect(screen.getByRole("progressbar", { name: "준비 진행도" }).getAttribute("value")).toBe("0");
    expect(screen.queryByText("판단 보류")).toBeNull();
    const details = screen.getByText("판단 근거").closest("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("확정된 일정이 필요합니다.");
  });

  it("does not repeat the empty conversation title and preserves a draft across grouped tools", () => {
    render(<EventWorkspace {...props} renderProposals={() => null} />);
    expect(screen.queryByRole("heading", { name: "새 대화" })).toBeNull();
    expect(screen.getByRole("heading", { name: "무엇을 도와드릴까요?" })).toBeDefined();
    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메시지" });
    fireEvent.change(composer, { target: { value: "확인 중인 초안" } });
    openGroupedTool("참가·이동", "차량 배정 열기");
    expect(screen.queryByRole("textbox", { name: "메시지" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "대화 기록" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "대화" }));
    expect(screen.getByRole("textbox", { name: "메시지" })).toBe(composer);
    expect(composer.value).toBe("확인 중인 초안");
    expect(screen.getByRole("complementary", { name: "대화 기록" })).toBeDefined();
  });

  it("shows a structured plan and opens only its proposals without applying them", async () => {
    const profile = props.profile;
    const roomId = props.room.id;
    const id = "conversation";
    const time = "2026-11-21T00:00:00.000Z";
    const plan: ChatMessage = {
      id: `openai-${"b".repeat(64)}`, sender: "assistant", time, text: "시험 전에 다녀오는 날짜 후보입니다.",
      advisor: { kind: "plan", title: "12월 4~5일 추천", rows: [{ label: "금요일", detail: "14:30 출발 후보" }],
        rationale: "시험 준비 여유를 우선했습니다.", proposals: [
          { kind: "checklist", title: "숙소 할인 조건 확인", date: "" },
          { kind: "checklist", title: "출발 가능 시간 조사", date: "" },
        ] },
    };
    const value: ConversationHistory = { activeId: id, conversations: [{ id, title: "12월 계획", draft: "",
      createdAt: time, updatedAt: time, messages: [
        { ...plan, id: `openai-${"a".repeat(64)}`, text: "[준비 제안] 이전 제안", advisor: undefined },
        { id: "user", sender: "user", time, text: "12월 여행 날짜를 추천해줘." }, plan,
      ] }] };
    const record = { key: conversationHistoryKey(profile.accountId, roomId), version: "1", value: JSON.stringify(value) };
    const mockFetch = vi.fn(async () => Response.json({ profile, activeRoomId: roomId, records: [record] }));
    vi.stubGlobal("fetch", mockFetch);
    enableBackendConnection(true);
    configureBackendUser(profile);
    await refreshBackendData(roomId);
    render(<EventWorkspace {...props} renderProposals={(_scope, messages) => <div>{chatProposalCandidates(messages).map(item => <p key={item.id}>{item.title}</p>)}</div>} />);
    expect(screen.getByRole("heading", { name: "12월 4~5일 추천" })).toBeDefined();
    expect(screen.getByText("14:30 출발 후보")).toBeDefined();
    const rationale = screen.getByText("추천 근거");
    expect(rationale.closest("details")?.open).toBe(false);
    expect(screen.queryByText("숙소 할인 조건 확인")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "제안 검토 2건" }));
    expect(await screen.findByText("숙소 할인 조건 확인")).toBeDefined();
    expect(screen.getByText("출발 가능 시간 조사")).toBeDefined();
    expect(screen.queryByText("이전 제안", { exact: true })).toBeNull();
    expect(props.onAddExtractedChecklist).not.toHaveBeenCalled();
    expect(props.onAddExtractedEvent).not.toHaveBeenCalled();
  });

  it("links to settings instead of asking for consent in chat and still blocks detected private messages", async () => {
    const profile = props.profile;
    const { id: roomId } = props.room;
    const key = conversationHistoryKey(profile.accountId, roomId);
    let stored: string | null = null;
    let revision = 0;
    let approved = false;
    let release!: (response: Response) => void;
    const firstReply = new Promise<Response>((resolve) => { release = resolve; });
    const calls: { roomId: string; conversationId: string; userMessageId: string; userMessageText: string }[] = [];
    const snapshot = (written: boolean) => {
      const record = { key, value: stored, version: String(revision) };
      return Response.json({ records: [record], profile, activeRoomId: roomId, written: written ? [record] : undefined });
    };
    vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/api/data" && init.method === "POST") {
        stored = JSON.parse(init.body as string).writes[0].value;
        revision++;
        return snapshot(true);
      }
      if (path === "/api/chat" && init.method !== "POST") return Response.json({ approved });
      if (path === "/api/chat") {
        const call = JSON.parse(init.body as string) as typeof calls[number];
        calls.push(call);
        const history: ConversationHistory = JSON.parse(stored!);
        const conversation = history.conversations.find(item => item.id === call.conversationId)!;
        expect(conversation.messages).toEqual([{ id: call.userMessageId, sender: "user", text: "Synthetic question", time: "방금 전" }]);
        expect(conversation.draft).toBe("");
        if (calls.length === 1) return firstReply;
        conversation.messages.push({ id: "openai-test", sender: "assistant", text: "Synthetic model reply", time: "방금 전" });
        stored = JSON.stringify(history);
        revision++;
        return Response.json({ ok: true });
      }
      if (path.startsWith("/api/data")) return snapshot(false);
      throw new Error("Unexpected request");
    }));
    enableBackendConnection(true);
    configureBackendUser(profile);
    await refreshBackendData(roomId);
    const view = render(<EventWorkspace {...props} renderProposals={() => null} />);
    await screen.findByText("외부 AI 꺼짐");
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "Unapproved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(calls).toHaveLength(0);
    expect(screen.queryByText("Synthetic question", { selector: "p" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: "보안 및 개인정보 설정" }).getAttribute("href")).toContain("section=security");
    expect((screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement).value).toBe("Unapproved draft");
    approved = true;
    view.unmount();
    const approvedView = render(<EventWorkspace {...props} renderProposals={() => null} />);
    await screen.findByText("외부 AI 허용됨");
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "Synthetic question" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).not.toHaveProperty("consent");
    expect(calls[0].userMessageText).toBe("Synthetic question");
    expect(screen.getByText("답변 작성 중")).toBeDefined();
    expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(true);
    release(Response.json({ error: "OpenAI를 사용할 수 없습니다." }, { status: 503 }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "OpenAI를 사용할 수 없습니다.");
    await waitFor(() => expect(screen.queryByText("답변 작성 중")).toBeNull());
    approvedView.unmount();
    const retriedView = render(<EventWorkspace {...props} renderProposals={() => null} />);
    await screen.findByText("외부 AI 허용됨");
    fireEvent.click(screen.getByRole("button", { name: "답변 다시 요청" }));
    expect(screen.queryByRole("dialog", { name: "OpenAI에 메시지 보내기" })).toBeNull();
    expect(await screen.findByText("Synthetic model reply")).toBeDefined();
    expect(calls).toEqual([calls[0], calls[0]]);
    expect(screen.queryByText("샘플 응답")).toBeNull();
    expect(screen.queryByText("샘플 제안 검토")).toBeNull();
    expect(screen.queryByRole("button", { name: "답변 다시 요청" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "가상 담당자 010-0000-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("연락처");
    fireEvent.click(screen.getByRole("button", { name: "내부에만 저장" }));
    expect(screen.getByText("내부 기록")).toBeDefined();
    await waitFor(() => expect(stored).toContain("local-only"));
    expect(calls).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "답변 다시 요청" })).toBeNull();
    approved = false;
    retriedView.unmount();
    render(<EventWorkspace {...props} renderProposals={() => null} />);
    await screen.findByText("외부 AI 꺼짐");
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "After revocation" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: "보안 및 개인정보 설정" })).toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it("opens only lodging tools and switches to the participant table without overlap", () => {
    render(<EventWorkspace {...props} />);
    expect(screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" }).getAttribute("href")).toContain("forms");
    openGroupedTool("참가·이동", "숙소 배정 열기");
    expect(screen.getByRole("heading", { name: "숙소 배정", level: 2 })).toBeDefined();
    expect(screen.queryByRole("tab", { name: "차량" })).toBeNull();
    expect(screen.getByText("방을 배정할 참가자가 없습니다.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "설문 응답 불러오기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "참가자 명단 열기" }));
    expect(screen.getByRole("heading", { name: "차량 배정", level: 2 })).toBeDefined();
    expect(screen.getByRole("tab", { name: "참가자", selected: true })).toBeDefined();
  });

  it("retains unsaved transport edits across tools and protects navigation", () => {
    render(<EventWorkspace {...props} />);
    openGroupedTool("참가·이동", "차량 배정 열기");
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("church-private-v1:") && key.endsWith(":transport")) throw new Error("quota");
      original.call(this, key, value);
    });
    fireEvent.change(screen.getByLabelText("추가 인원"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "일정 열기" }));
    openGroupedTool("참가·이동", "차량 배정 열기");
    expect((screen.getByLabelText("추가 인원") as HTMLInputElement).value).toBe("3");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "행사방 목록으로 돌아가기" }));
    expect(confirm).toHaveBeenCalled();
    expect(props.onBackToRooms).not.toHaveBeenCalled();
    write.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "다시 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "행사방 목록으로 돌아가기" }));
    expect(props.onBackToRooms).toHaveBeenCalled();
  });
  it("opens reviewed sample proposals from the assistant message without applying anything", () => {
    render(<EventWorkspace {...props} seedMessages={[{ id: "reply", sender: "assistant", text: "샘플 답변", time: "방금 전" }]} renderProposals={() => <div>제안 검토 내용</div>} />);
    fireEvent.click(screen.getByRole("button", { name: "샘플 제안 검토" }));
    expect(screen.getByText("제안 검토 내용")).toBeDefined();
    expect(props.onAddExtractedEvent).not.toHaveBeenCalled();
  });
  it("switches to the relevant pane after extracting meeting-minutes candidates", () => {
    render(<EventWorkspace {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "자료 열기" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "회의록 예시 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "일정 후보 추가" }));
    expect(props.onAddExtractedEvent).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "일정 닫기" })).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "자료 열기" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "준비 항목 추가" }));
    expect(props.onAddExtractedChecklist).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "행사 준비" }));
    expect(screen.getByRole("button", { name: "준비 현황 닫기" })).toBeDefined();
  });
  it("keeps the location private, ignores the old room location, and remounts on conversation changes", () => {
    render(<EventWorkspace {...props} room={{ ...props.room, location: "행사 장소" }} />);
    expect(screen.queryByText(props.profile.nickname)).toBeNull();
    expect(screen.queryByTestId("location-panel")).toBeNull();
    openGroupedTool("행사 준비", "장소 열기");
    expect(screen.getByTestId("location-panel").textContent).toBe("");
    fireEvent.change(screen.getByLabelText("장소 추가"), { target: { value: "첫 대화 장소" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(screen.getByTestId("location-panel").textContent).toBe("첫 대화 장소");
    fireEvent.click(screen.getByRole("button", { name: "새 대화 만들기" }));
    expect(screen.getByTestId("location-panel").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "부가기능 닫기" }));
    expect(screen.queryByTestId("location-panel")).toBeNull();
  });

  it("does not collapse history when a side tool is opened on a medium screen", () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 877 });
    render(<EventWorkspace {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "자료 열기" })[0]);
    expect(screen.getByRole("complementary", { name: "대화 기록" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "대화 목록 닫기" }));
    expect(screen.getByRole("complementary", { name: "부가기능" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "대화 목록 열기" }));
    expect(screen.getByRole("complementary", { name: "대화 기록" })).toBeDefined();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  });

  it("provides keyboard resizing, clamps to the available space, and persists the chosen width", () => {
    localStorage.removeItem("church-workspace-tools-width");
    const { container } = render(<EventWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "일정 열기" }));
    const panel = screen.getByRole("complementary", { name: "부가기능" });
    const layout = container.querySelector<HTMLElement>(".workspace-columns")!;
    const history = screen.getByRole("complementary", { name: "대화 기록" });
    Object.defineProperty(layout, "clientWidth", { value: 1100 });
    Object.defineProperty(history, "clientWidth", { value: 200 });
    Object.defineProperty(panel, "clientWidth", { value: 360 });
    const handle = screen.getByRole("separator", { name: "부가기능 너비 조절" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(layout.style.getPropertyValue("--preferred-tools-width")).toBe("384px");
    fireEvent.keyDown(handle, { key: "End" });
    expect(localStorage.getItem("church-workspace-tools-width")).toBe("640");
    fireEvent.doubleClick(handle);
    expect(localStorage.getItem("church-workspace-tools-width")).toBeNull();
    openGroupedTool("참가·이동", "차량 배정 열기");
    expect(screen.queryByRole("separator", { name: "부가기능 너비 조절" })).toBeNull();
  });

  it.each([1, 2, 3] as const)("lets logged-in grade %s confirm document deletion", (grade) => {
    render(<EventWorkspace {...props} profile={{ ...props.profile, grade }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "자료 열기" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "회의록 예시 삭제" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
    expect(screen.queryByText("회의록 예시", { selector: "strong" })).toBeNull();
  });
  it("shows conversations within one event, not a list of other event rooms", () => {
    render(<EventWorkspace {...props} />);
    expect(screen.getByRole("heading", { name: "2026 여름 수련회" })).toBeDefined();
    expect(screen.queryByText("성탄 발표회")).toBeNull();
    expect(screen.queryByRole("button", { name: "관리자" })).toBeNull();
    expect(screen.queryByPlaceholderText(/\/admin/)).toBeNull();
  });

  it("creates multiple conversations and restores independent drafts and messages", () => {
    render(<EventWorkspace {...props} />);
    const first = screen.getByRole("button", { name: "새 대화 선택" });
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "초안 유지" } });
    fireEvent.click(screen.getByRole("button", { name: "새 대화 만들기" }));
    expect((screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "차량을 준비하자" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(screen.getByRole("button", { name: "차량을 준비하자 선택" })).toBeDefined();
    fireEvent.click(first);
    expect((screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement).value).toBe("초안 유지");
    expect(screen.queryByText("차량을 준비하자", { selector: ".workspace-message-text" })).toBeNull();
  });

  it("collapses history and tools independently without losing a draft", () => {
    render(<EventWorkspace {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "작업 중" } });
    fireEvent.click(screen.getByRole("button", { name: "대화 목록 닫기" }));
    expect(screen.queryByRole("complementary", { name: "대화 기록" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "일정 열기" }));
    expect(screen.getByText("캘린더 내용")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "부가기능 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "대화 목록 열기" }));
    expect((screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement).value).toBe("작업 중");
  });

  it("renames and confirms deletion of a conversation", () => {
    render(<EventWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "새 대화 작업" }));
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    fireEvent.change(screen.getByLabelText("대화 이름"), { target: { value: "차량 논의" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
    expect(screen.getByRole("button", { name: "차량 논의 선택" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "차량 논의 작업" }));
    fireEvent.click(screen.getByRole("button", { name: "대화 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("button", { name: "차량 논의 선택" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "차량 논의 작업" }));
    fireEvent.click(screen.getByRole("button", { name: "대화 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
    expect(screen.getByText("대화가 없습니다")).toBeDefined();
  });

  it("keeps slash text in the conversation instead of navigating to another mode", () => {
    render(<EventWorkspace {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "/admin" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(screen.getByText("/admin", { selector: ".workspace-message-text" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "메시지" })).toBeDefined();
  });

  it("keeps a draft on storage failure and blocks navigation until it can be saved", () => {
    render(<EventWorkspace {...props} />);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "아직 저장되지 않은 초안" } });
    expect((screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement).value).toBe("아직 저장되지 않은 초안");
    fireEvent.click(screen.getByRole("button", { name: "행사방 목록" }));
    expect(props.onBackToRooms).not.toHaveBeenCalled();
    write.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "행사방 목록" }));
    expect(props.onBackToRooms).toHaveBeenCalled();
  });

  it("allows confirmed deletion to discard a draft that exceeds the storage quota", () => {
    render(<EventWorkspace {...props} />);
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (value.length > 400) throw Error("quota");
      originalSet.call(this, key, value);
    });
    fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "x".repeat(1000) } });
    fireEvent.click(screen.getByRole("button", { name: "새 대화 작업" }));
    fireEvent.click(screen.getByRole("button", { name: "대화 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("대화가 없습니다")).toBeDefined();
  });
});
