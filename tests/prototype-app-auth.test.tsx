import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PrototypeApp } from "../app/prototype-app";
import { createBrowserAuth } from "../lib/prototype-auth";
import { createRoomCatalog } from "../lib/room-catalog";
import { createRoomMaterialsStore } from "../lib/room-materials";
import { createPreparationStore } from "../lib/preparation-store";
import { createInitialState } from "../lib/prototype-state";
import { initialConversationId, privateToolKey } from "../lib/conversation-scope";

const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const backend = vi.hoisted(() => ({ connected: false, flush: vi.fn() }));
vi.mock("../lib/backend-client", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/backend-client")>(),
  isBackendConnected: () => backend.connected,
  flushBackendWrites: backend.flush
}));
vi.mock("../components/location-panel", () => ({ LocationPanel: () => <div /> }));
vi.mock("../lib/document-files", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/document-files")>(),
  createIndexedDBBlobStore: () => ({ put: vi.fn(), get: vi.fn(), delete: vi.fn(), queueCleanup: vi.fn(), listCleanup: async () => [], retireCleanup: vi.fn() })
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); backend.connected = false; backend.flush.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function enterRoom() {
  const auth = createBrowserAuth();
  await auth.signup({ inviteCode: "CHURCH-STAFF-2026", name: "담당자", username: "demo-owner", password: "DemoPass123!", confirmation: "DemoPass123!" });
  const profile = await auth.login("demo-owner", "DemoPass123!");
  const catalog = createRoomCatalog(sessionStorage, profile);
  catalog.enter(profile.roomIds[0]);
  const roomId = profile.roomIds[0];
  const scope = { accountId: profile.accountId!, roomId, conversationId: initialConversationId(roomId) };
  return { catalog, profile, roomId, scope };
}

const openGroupedTool = (group: string, name: string) => {
  const trigger = screen.getByRole("button", { name: group });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name }));
};

it("shows upcoming room events and the active conversation's actual completed and remaining checklist", async () => {
  const { roomId, scope } = await enterRoom();
  createPreparationStore(localStorage, roomId).saveEvent({
    id: "upcoming", title: "다음 준비 회의", date: "2099-12-01", time: "10:00", status: "confirmed",
    author: "담당자", lastEditor: "담당자", location: "", memo: "", changeLog: "",
  });
  createRoomMaterialsStore(localStorage, roomId, [], scope).updateChecklist(() => [
    { id: "todo", title: "이 대화의 장소 예약", status: "needsReview", owner: "", due: "", memo: "" },
    { id: "done", title: "완료된 준비 항목", status: "done", owner: "", due: "", memo: "" },
  ]);
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "행사 요약 열기" }));
  const summary = within(screen.getByRole("complementary", { name: "행사 요약" }));
  expect(summary.getByText("다음 준비 회의")).toBeDefined();
  expect(await summary.findByText("이 대화의 장소 예약")).toBeDefined();
  expect(summary.getByText("완료된 준비 항목")).toBeDefined();
  expect(summary.getByText("1 / 2 완료")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "새 대화 만들기" }));
  await waitFor(() => expect(summary.queryByText("이 대화의 장소 예약")).toBeNull());
  expect(summary.queryByText("완료된 준비 항목")).toBeNull();
  expect(summary.queryByText("1 / 2 완료")).toBeNull();
  expect(summary.getByText("다음 준비 회의")).toBeDefined();
  fireEvent.click(summary.getByRole("button", { name: "체크리스트 보기" }));
  expect(screen.getByRole("complementary", { name: "부가기능" })).toBeDefined();
  expect(screen.queryByRole("complementary", { name: "행사 요약" })).toBeNull();
});

it("keeps calendar editing open until server writes finish and reports a rejected flush", async () => {
  await enterRoom(); backend.connected = true;
  let reject!: (cause: Error) => void;
  backend.flush.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정 열기" }));
  fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(backend.flush).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeDefined();
  await act(async () => { reject(Error("서버 저장 실패")); });
  expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("서버 저장 실패");
});

it("guards logout when pending server writes cannot be saved", async () => {
  await enterRoom(); backend.connected = true;
  backend.flush.mockRejectedValue(Error("미저장 변경사항"));
  render(<PrototypeApp />);
  fireEvent.click(screen.getAllByRole("button", { name: "로그아웃" })[0]);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("미저장 변경사항"));
  expect(createBrowserAuth().currentProfile()).not.toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it("persists risk resolution through the private conversation store", async () => {
  const { roomId, scope } = await enterRoom();
  const risk = createInitialState().risks[roomId][0];
  const key = privateToolKey(scope, "risks");
  localStorage.setItem(key, JSON.stringify({ version: 1, items: [risk] }));
  const view = render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  const resolve = screen.getAllByRole("button", { name: "완료 처리" })[0];
  fireEvent.click(resolve);
  const saved = JSON.parse(localStorage.getItem(key) ?? "null");
  expect(saved?.items.find((item: { id: string }) => item.id === risk.id)?.resolved).toBe(true);
  view.unmount(); render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  expect(screen.queryAllByRole("button", { name: "완료 처리" })).toHaveLength(0);
});

it("validates and persists calendar CRUD and keeps proposal applications deduplicated", async () => {
  const { roomId, scope } = await enterRoom();
  let view = render(<PrototypeApp />);
  fireEvent.click(screen.getByRole("button", { name: "일정 열기" }));
  fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "검증 일정" } });
  fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-11-16" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(createPreparationStore(localStorage, roomId).loadEvents().some(item => item.title === "검증 일정")).toBe(true);
  view.unmount(); view = render(<PrototypeApp />);
  openGroupedTool("행사 준비", "제안 검토 열기");
  const vehicle = screen.getByRole("region", { name: "차량 배정표 작성 제안" });
  fireEvent.click(within(vehicle).getByRole("button", { name: "반영" }));
  expect(createRoomMaterialsStore(localStorage, roomId, [], scope).loadChecklist().filter(item => item.id === "proposal:sample-vehicle")).toHaveLength(1);
  expect(within(vehicle).getByText("반영됨")).toBeDefined();
});

it("adds, edits, completes, deletes and reloads checklist items using accessible dialogs", async () => {
  const { roomId, scope } = await enterRoom();
  let view = render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  fireEvent.click(screen.getByRole("button", { name: "준비 항목 추가" }));
  expect(screen.getByRole("combobox", { name: "상태" })).toBeDefined();
  fireEvent.change(screen.getByLabelText("항목"), { target: { value: "신규 준비" } });
  fireEvent.change(screen.getByLabelText("담당자"), { target: { value: "팀장" } });
  fireEvent.change(screen.getByLabelText("마감일"), { target: { value: "2026-11-20" } });
  fireEvent.change(screen.getByLabelText("메모"), { target: { value: "확인 메모" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  fireEvent.click(screen.getByRole("button", { name: "신규 준비 수정" }));
  fireEvent.change(screen.getByLabelText("항목"), { target: { value: "수정 준비" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  fireEvent.click(screen.getByRole("button", { name: "수정 준비 상태 변경" }));
  expect(createRoomMaterialsStore(localStorage, roomId, [], scope).loadChecklist().find((item) => item.title === "수정 준비")).toMatchObject({ status: "done", owner: "팀장", memo: "확인 메모" });
  view.unmount();
  view = render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  fireEvent.click(screen.getByRole("button", { name: "수정 준비 수정" }));
  fireEvent.click(screen.getByRole("button", { name: "항목 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.getByLabelText("항목")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "항목 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(createRoomMaterialsStore(localStorage, roomId, [], scope).loadChecklist().some((item) => item.title === "수정 준비")).toBe(false);
});

it("keeps an invalid or unsaved checklist draft open and unchanged on focus", async () => {
  await enterRoom();
  render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  fireEvent.click(screen.getByRole("button", { name: "준비 항목 추가" }));
  fireEvent.change(screen.getByLabelText("항목"), { target: { value: "   " } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(screen.getByRole("alert").textContent).toMatch(/항목/);
  fireEvent.change(screen.getByLabelText("항목"), { target: { value: "저장 전 초안" } });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  expect(screen.getByRole("dialog")).toBeDefined();
  expect(screen.getAllByRole("alert").some((element) => /저장하지 못/.test(element.textContent ?? ""))).toBe(true);
  act(() => window.dispatchEvent(new Event("focus")));
  expect((screen.getByLabelText("항목") as HTMLInputElement).value).toBe("저장 전 초안");
});

it("refreshes checklist changes across tabs and same-tab events and isolates room switches", async () => {
  const { catalog, profile, roomId, scope } = await enterRoom();
  render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  const store = createRoomMaterialsStore(localStorage, roomId, [], scope);
  act(() => { store.updateChecklist(() => [{ id: "external", title: "외부 변경", owner: "", due: "", status: "done", memo: "" }]); });
  expect(screen.getByRole("button", { name: "외부 변경 수정" })).toBeDefined();
  localStorage.setItem(store.checklistKey, JSON.stringify({ version: 1, items: [] }));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: store.checklistKey, storageArea: localStorage })));
  expect(screen.queryByRole("button", { name: "외부 변경 수정" })).toBeNull();
  act(() => { catalog.enter(profile.roomIds[1]); window.dispatchEvent(new Event("focus")); });
  openGroupedTool("행사 준비", "준비 현황 열기");
  expect(screen.queryByRole("button", { name: "외부 변경 수정" })).toBeNull();
  act(() => { catalog.enter(roomId); window.dispatchEvent(new Event("focus")); });
  openGroupedTool("행사 준비", "준비 현황 열기");
  expect(screen.getByText("준비 항목이 없습니다.")).toBeDefined();
});

it("keeps checklist completion unchanged on failed writes and empty deletion across reload", async () => {
  const { roomId, scope } = await enterRoom();
  const store = createRoomMaterialsStore(localStorage, roomId, [], scope);
  store.updateChecklist(() => [{ id: "last", title: "마지막 준비", owner: "", due: "", status: "needsReview", memo: "" }]);
  const view = render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
  fireEvent.click(screen.getByRole("button", { name: "마지막 준비 상태 변경" }));
  expect(store.loadChecklist()[0].status).toBe("needsReview");
  expect(screen.getByRole("alert").textContent).toMatch(/저장하지 못/);
  write.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "마지막 준비 수정" }));
  fireEvent.click(screen.getByRole("button", { name: "항목 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
  view.unmount();
  render(<PrototypeApp />);
  openGroupedTool("행사 준비", "준비 현황 열기");
  expect(screen.getByText("준비 항목이 없습니다.")).toBeDefined();
  expect(store.loadChecklist()).toEqual([]);
});

it("returns a logged-in account to the lobby if no room has been entered", async () => {
  const auth = createBrowserAuth();
  await auth.signup({ inviteCode: "CHURCH-STAFF-2026", name: "담당자", username: "demo-owner", password: "DemoPass123!", confirmation: "DemoPass123!" });
  await auth.login("demo-owner", "DemoPass123!");
  render(<PrototypeApp />);
  expect(replace).toHaveBeenCalledWith("/rooms");
});

it("loads a newly created event room into the existing workspace", async () => {
  const auth = createBrowserAuth();
  await auth.signup({ inviteCode: "CHURCH-STAFF-2026", name: "담당자", username: "demo-owner", password: "DemoPass123!", confirmation: "DemoPass123!" });
  const profile = await auth.login("demo-owner", "DemoPass123!");
  const store = createRoomCatalog(sessionStorage, profile);
  const { room } = store.create({ name: "새로운 행사", category: "sports", date: "", location: "", description: "" });
  store.enter(room.id);
  render(<PrototypeApp />);
  expect(screen.getAllByText("새로운 행사").length).toBeGreaterThan(0);
  expect(replace).not.toHaveBeenCalled();
});

it("shows a recoverable error if browser storage prevents logout", async () => {
  const auth = createBrowserAuth();
  await auth.signup({ inviteCode: "CHURCH-STAFF-2026", name: "시연 담당자", username: "demo-owner", password: "DemoPass123!", confirmation: "DemoPass123!" });
  const profile = await auth.login("demo-owner", "DemoPass123!");
  createRoomCatalog(sessionStorage, profile).enter(profile.roomIds[0]);
  render(<PrototypeApp />);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  fireEvent.click(screen.getAllByRole("button", { name: "로그아웃" })[0]);
  expect(screen.getByRole("alert").textContent).toContain("로그아웃하지 못했습니다");
  expect(replace).not.toHaveBeenCalled();
  write.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(auth.currentProfile()).toBeNull();
  expect(replace).toHaveBeenCalledWith("/login");
});
