import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PrototypeApp } from "../app/prototype-app";
import { EventWorkspace } from "../components/event-workspace";
import { createBrowserAuth } from "../lib/prototype-auth";
import { createRoomCatalog } from "../lib/room-catalog";
import { createConversationStore } from "../lib/conversation-store";
import { createPreparationStore } from "../lib/preparation-store";
import { createInitialState } from "../lib/prototype-state";
import { createRoomMaterialsStore } from "../lib/room-materials";
import { privateToolKey } from "../lib/conversation-scope";
import type { Permission } from "../lib/types";

const backend = vi.hoisted(() => ({ connected: false, flush: vi.fn() }));
const access = vi.hoisted(() => ({ permissions: null as Permission[] | null }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/backend-client", async original => ({
  ...await original<typeof import("../lib/backend-client")>(),
  isBackendConnected: () => backend.connected,
  flushBackendWrites: backend.flush,
}));
vi.mock("../components/location-panel", () => ({ LocationPanel: () => <div /> }));
vi.mock("../components/google-calendar-connection", () => ({ GoogleCalendarConnection: () => <div /> }));
vi.mock("../components/documents-panel", () => ({ DocumentsPanel: () => <div /> }));
vi.mock("../lib/prototype-auth", async original => {
  const actual = await original<typeof import("../lib/prototype-auth")>();
  return { ...actual, createBrowserAuth: () => {
    const auth = actual.createBrowserAuth();
    return { ...auth, currentProfile: () => {
      const profile = auth.currentProfile();
      return profile && access.permissions ? { ...profile, permissions: access.permissions } : profile;
    } };
  } };
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); access.permissions = null; backend.connected = false; backend.flush.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function enterRoom(text = "2028년 2월 29일 오후 3시 개인 상담\n비공개 내용") {
  const auth = createBrowserAuth();
  await auth.signup({ inviteCode: "CHURCH-STAFF-2026", name: "담당자", username: "chat-calendar-owner", password: "DemoPass123!", confirmation: "DemoPass123!" });
  const profile = await auth.login("chat-calendar-owner", "DemoPass123!");
  const roomId = profile.roomIds[0];
  createRoomCatalog(sessionStorage, profile).enter(roomId);
  const conversations = createConversationStore(sessionStorage, profile.accountId!, roomId);
  conversations.send(conversations.load().activeId!, text);
  const events = createPreparationStore(localStorage, roomId);
  localStorage.setItem(events.eventsKey, JSON.stringify({ version: 1, items: [] }));
  return { roomId, auth, profile, conversations, events };
}

it("opens a reviewed, private-safe editor without writing; repeated adds reopen the saved event", async () => {
  const { events } = await enterRoom();
  const initialCount = events.loadEvents().length;
  render(<PrototypeApp />);
  const action = screen.getByRole("button", { name: "일정으로 추가" });
  expect(action.title).toBe("일정으로 추가");
  fireEvent.click(action);
  expect(screen.getByRole("button", { name: "일정 닫기" })).toBeDefined();
  expect((screen.getByLabelText("날짜") as HTMLInputElement).value).toBe("2028-02-29");
  expect((screen.getByLabelText("시작 시간") as HTMLInputElement).value).toBe("15:00");
  expect((screen.getByLabelText("설명") as HTMLTextAreaElement).value).toBe("");
  expect(events.loadEvents()).toHaveLength(initialCount);
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "공유할 회의 제목" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  const saved = events.loadEvents().find(event => event.title === "공유할 회의 제목")!;
  expect(saved.status).toBe("confirmed");
  expect(JSON.stringify(saved)).not.toContain("비공개");
  fireEvent.click(action);
  expect(screen.getByRole("dialog", { name: "일정 상세 및 수정" })).toBeDefined();
  expect((screen.getByLabelText("일정 제목") as HTMLInputElement).value).toBe("공유할 회의 제목");
  fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "16:00" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(events.loadEvents()).toHaveLength(initialCount + 1);
  expect(events.loadEvents().find(event => event.id === saved.id)?.time).toBe("16:00");
});

it.each(["내일 3시 회의", "2026-11-18 또는 2026-11-19 회의", "2026-02-29 회의"])("requires manual date review for %s", async text => {
  const { events } = await enterRoom(text);
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  expect((screen.getByLabelText("날짜") as HTMLInputElement).value).toBe("");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(screen.getByRole("dialog")).toBeDefined();
  expect(events.loadEvents()).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-11-20" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(events.loadEvents()).toHaveLength(1);
});

it("does not write on cancel", async () => {
  const { events } = await enterRoom();
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(events.loadEvents()).toEqual([]);
});

it("keeps the reviewed draft open during a flush and after a CAS conflict", async () => {
  await enterRoom(); backend.connected = true;
  let reject!: (reason: Error) => void;
  backend.flush.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "검토한 제목" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(backend.flush).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.getByRole("dialog")).toBeDefined();
  await act(async () => { reject(Error("409 충돌: 새로고침 후 다시 확인해 주세요.")); });
  expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("409 충돌");
  expect((screen.getByLabelText("일정 제목") as HTMLInputElement).value).toBe("검토한 제목");
});

it.each(([[], ["viewCalendar"]] as Permission[][]).map(permissions => [permissions]))("hides message actions without create/edit permissions: %j", permissions => {
  const state = createInitialState();
  render(<EventWorkspace room={state.rooms[0]} profile={{ ...state.profile, permissions }} seedMessages={[{ id: "m", sender: "user", text: "2026-11-18", time: "" }]} notice="" darkMode={false} onToggleTheme={vi.fn()} onSignOut={vi.fn()} onBackToRooms={vi.fn()} onAddExtractedEvent={vi.fn()} onAddExtractedChecklist={vi.fn()} onAddChatEvent={vi.fn()} renderTools={() => null} />);
  expect(screen.queryByRole("button", { name: "일정으로 추가" })).toBeNull();
});

it("only shows the capture action for user messages and forwards the conversation/message source", () => {
  const state = createInitialState(); const capture = vi.fn();
  const message = { id: "user-message", sender: "user" as const, text: "2026-11-18", time: "" };
  render(<EventWorkspace room={state.rooms[0]} profile={state.profile} seedMessages={[message, { ...message, id: "assistant-message", sender: "assistant" }]} notice="" darkMode={false} onToggleTheme={vi.fn()} onSignOut={vi.fn()} onBackToRooms={vi.fn()} onAddExtractedEvent={vi.fn()} onAddExtractedChecklist={vi.fn()} onAddChatEvent={capture} renderTools={() => null} />);
  expect(screen.getAllByRole("button", { name: "일정으로 추가" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  expect(capture).toHaveBeenCalledWith(`initial-${state.rooms[0].id}`, message);
});

it("requires create permission for a new capture, then edit permission for the existing source", async () => {
  await enterRoom(); access.permissions = ["chat", "editEvent"];
  render(<PrototypeApp />);
  expect(screen.queryByRole("button", { name: "일정으로 추가" })).toBeNull();
  access.permissions = ["chat", "createEvent"];
  act(() => window.dispatchEvent(new Event("focus")));
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(screen.queryByRole("button", { name: "일정으로 추가" })).toBeNull();
  access.permissions = ["chat", "editEvent"];
  act(() => window.dispatchEvent(new Event("focus")));
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  expect(screen.getByRole("dialog", { name: "일정 상세 및 수정" })).toBeDefined();
});

it("refuses a new capture save if create permission was revoked while reviewing", async () => {
  const { events } = await enterRoom();
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  access.permissions = ["chat", "viewCalendar"];
  act(() => window.dispatchEvent(new Event("focus")));
  expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "저장" })).toBeNull();
  expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("권한");
  expect(events.loadEvents()).toHaveLength(0);
});

it("allows a create-only user to retry the same draft after a failed flush", async () => {
  await enterRoom(); access.permissions = ["chat", "createEvent"]; backend.connected = true;
  backend.flush.mockRejectedValueOnce(Error("연결 실패"));
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" })); });
  expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("연결 실패");
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" })); });
  expect(backend.flush).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not resurrect a captured event deleted while its editor was open", async () => {
  const { events } = await enterRoom();
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  const id = events.loadEvents()[0].id;
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  act(() => { events.deleteEvent(id); });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("이미 삭제된 일정");
  expect(events.loadEvents()).toHaveLength(0);
});

it("retains the source identity and reviewed event after reloading the workspace", async () => {
  const { events } = await enterRoom();
  const view = render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "검토 후 공유" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  const id = events.loadEvents()[0].id;
  view.unmount(); render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정으로 추가" }));
  expect(screen.getByRole("dialog", { name: "일정 상세 및 수정" })).toBeDefined();
  expect((screen.getByLabelText("일정 제목") as HTMLInputElement).value).toBe("검토 후 공유");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(events.loadEvents().map(event => event.id)).toEqual([id]);
});

it("opens a checklist draft from a message and reopens the saved item without duplicating it", async () => {
  const { profile, roomId, conversations } = await enterRoom("준비 항목: 차량 안내문 작성\n담당자: 안내팀\n마감: 2028-02-29");
  const scope = { accountId: profile.accountId!, roomId, conversationId: conversations.load().activeId! };
  const materials = createRoomMaterialsStore(localStorage, roomId, [], scope);
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "준비 항목으로 추가" }));
  const dialog = screen.getByRole("dialog", { name: "준비 항목 추가" });
  expect(within(dialog).getByLabelText<HTMLInputElement>("항목").value).toBe("차량 안내문 작성");
  expect(materials.loadChecklist()).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
  expect(materials.loadChecklist()).toMatchObject([{ title: "차량 안내문 작성", owner: "안내팀", due: "2028-02-29" }]);
  fireEvent.click(screen.getByRole("button", { name: "준비 항목으로 추가" }));
  expect(screen.getByRole("dialog", { name: "준비 항목 수정" })).toBeDefined();
  expect(materials.loadChecklist()).toHaveLength(1);
});

it("previews and appends a draft roster to the owned transport list without sending the draft to the assistant", async () => {
  const { profile, roomId, conversations } = await enterRoom("일반 메시지");
  const conversationId = conversations.load().activeId!;
  const key = privateToolKey({ accountId: profile.accountId!, roomId, conversationId }, "transport");
  const before = conversations.load().conversations[0].messages.length;
  render(<PrototypeApp />);
  fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "이름,소속\n테스트 참가자,청년부" } });
  fireEvent.click(screen.getByRole("button", { name: "전송 없이 참가자 가져오기" }));
  const dialog = await screen.findByRole("dialog", { name: "채팅 명단 가져오기" });
  expect(within(dialog).getByText("테스트 참가자")).toBeDefined();
  expect(sessionStorage.getItem(key)).toBeNull();
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "1명 추가" })); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(key)!).input.people).toMatchObject([{ name: "테스트 참가자", department: "청년부", outboundEntry: "미정" }]);
  expect(conversations.load().conversations[0].messages).toHaveLength(before);
  fireEvent.click(screen.getByRole("button", { name: "대화" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메시지" }).value).toBe("");
});
