import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomLobby } from "../components/room-lobby";
import { createBrowserAuth } from "../lib/prototype-auth";
import { createRoomCatalog } from "../lib/room-catalog";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
const backend = vi.hoisted(() => ({ connected: false, flush: vi.fn() }));
vi.mock("../lib/backend-client", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/backend-client")>(),
  isBackendConnected: () => backend.connected,
  flushBackendWrites: backend.flush
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); backend.connected = false; backend.flush.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", window.location.pathname); vi.restoreAllMocks(); });

const results = () => screen.getByRole("region", { name: "행사방 목록" });
const openListSettings = () => fireEvent.click(screen.getByRole("button", { name: "목록 설정" }));

async function signIn(inviteCode = "CHURCH-STAFF-2026") {
  const auth = createBrowserAuth();
  await auth.signup({ inviteCode, name: "시연 담당자", username: "demo-user", password: "DemoPass123!", confirmation: "DemoPass123!" });
  await auth.login("demo-user", "DemoPass123!");
}

describe("event room lobby", () => {
  it("waits for room entry writes and keeps the lobby visible when persistence fails", async () => {
    await signIn(); backend.connected = true;
    let reject!: (cause: Error) => void;
    backend.flush.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    render(<RoomLobby />);
    fireEvent.click(await screen.findByRole("button", { name: "성탄 발표회 입장" }));
    expect(backend.flush).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByText(/현재 탭에만 저장/)).toBeNull();
    await act(async () => { reject(Error("서버 저장 실패")); });
    expect(screen.getByRole("alert").textContent).toContain("서버 저장 실패");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps the create dialog pending until room writes finish", async () => {
    await signIn(); backend.connected = true;
    let finish!: () => void;
    backend.flush.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(<RoomLobby />);
    fireEvent.click(await screen.findByRole("button", { name: "새 행사방" }));
    fireEvent.change(screen.getByLabelText("행사방 이름"), { target: { value: "서버 행사" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "만들기" }));
    expect(screen.queryByText("‘서버 행사’ 행사방을 만들었습니다.")).toBeNull();
    expect(screen.getByRole("dialog")).toBeDefined();
    await act(async () => { finish(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("‘서버 행사’ 행사방을 만들었습니다.")).toBeDefined();
  });
  it("edits existing room details and cancellation leaves the original untouched", async () => {
    await signIn(); render(<RoomLobby />);
    fireEvent.click(await screen.findByRole("button", { name: "성탄 발표회 수정" }));
    fireEvent.change(screen.getByLabelText("행사방 이름"), { target: { value: "변경된 성탄 행사" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("button", { name: "성탄 발표회 입장" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "성탄 발표회 수정" }));
    fireEvent.change(screen.getByLabelText("행사방 이름"), { target: { value: "변경된 성탄 행사" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-12-26" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("button", { name: "변경된 성탄 행사 입장" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("redirects unauthenticated visitors without showing room data", async () => {
    render(<RoomLobby />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("2026 여름 수련회")).toBeNull();
  });

  it("filters by category and search and provides an empty-search reset", async () => {
    await signIn();
    render(<RoomLobby />);
    await screen.findByRole("button", { name: "2026 여름 수련회 입장" });
    expect(screen.queryByRole("tablist", { name: "행사 종류 필터" })).toBeNull();
    openListSettings();
    fireEvent.change(screen.getByLabelText("행사 종류 필터"), { target: { value: "sports" } });
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(screen.getByText("조건에 맞는 행사방이 없습니다")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "행사방 검색" }), { target: { value: "성탄" } });
    expect(screen.getByText("성탄 발표회")).toBeDefined();
    expect(within(results()).queryByText("2026 여름 수련회")).toBeNull();
  });

  it("switches room layouts without clearing search or changing the entry action", async () => {
    await signIn(); render(<RoomLobby />);
    fireEvent.change(await screen.findByRole("searchbox", { name: "행사방 검색" }), { target: { value: "성탄" } });
    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
    expect(screen.getByRole("button", { name: "목록 보기" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(results()).getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "카드 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "성탄 발표회 입장" }));
    expect(router.push).toHaveBeenCalledWith("/workspace");
  });

  it("shows ongoing rooms by event period and filters the catalog by status", async () => {
    await signIn();
    const profile = createBrowserAuth().currentProfile()!;
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const store = createRoomCatalog(sessionStorage, profile);
    store.create({ name: "오늘 행사", category: "retreat", date: today, endDate: today, location: "", description: "" });
    store.create({ name: "지난 행사", category: "retreat", date: "2000-01-01", location: "", description: "" });
    render(<RoomLobby />);
    const todayPanel = await screen.findByRole("region", { name: "오늘의 행사" });
    expect(within(todayPanel).getByRole("button", { name: "오늘 행사" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "진행 중" }));
    const panel = results();
    expect(within(panel).getByRole("button", { name: "오늘 행사 입장" })).toBeDefined();
    expect(within(panel).queryByRole("button", { name: "지난 행사 입장" })).toBeNull();
  });

  it("creates, selects and deletes a room with an explicit cancellation step", async () => {
    await signIn();
    render(<RoomLobby />);
    fireEvent.click(await screen.findByRole("button", { name: "새 행사방" }));
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(screen.getByText("행사방 이름은 1~60자로 입력해 주세요.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("행사방 이름"), { target: { value: "새 체육대회" } });
    fireEvent.change(screen.getByLabelText("행사 종류"), { target: { value: "sports" } });
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "새 체육대회 선택" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "새 체육대회 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("button", { name: "새 체육대회 입장" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "새 체육대회 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
    expect(screen.queryByText("새 체육대회")).toBeNull();
  });

  it("enters the selected room and supports logout", async () => {
    await signIn();
    render(<RoomLobby />);
    fireEvent.click(await screen.findByRole("button", { name: "성탄 발표회 입장" }));
    expect(router.push).toHaveBeenCalledWith("/workspace");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(createBrowserAuth().currentProfile()).toBeNull();
  });

  it("allows third administrators to enter but not create or delete", async () => {
    await signIn("CHURCH-TEAM-2026");
    render(<RoomLobby />);
    const create = await screen.findByRole("button", { name: "새 행사방" });
    expect(create.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "성탄 발표회 삭제" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "성탄 발표회 입장" }));
    expect(router.push).toHaveBeenCalledWith("/workspace");
  });

  it("keeps pinned rooms in pin order across sort changes and reloads", async () => {
    await signIn("CHURCH-TEAM-2026");
    const shown = render(<RoomLobby />);
    fireEvent.click(await screen.findByRole("button", { name: "성탄 발표회 즐겨찾기 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "2026 여름 수련회 즐겨찾기 추가" }));
    const names = () => within(results()).getAllByRole("article").map(card => within(card).getByRole("button", { name: /입장$/ }).getAttribute("aria-label"));
    const newest = names();
    expect(newest.slice(0, 2)).toEqual(["성탄 발표회 입장", "2026 여름 수련회 입장"]);
    openListSettings();
    fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "oldest" } });
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(names()).toEqual([...newest.slice(0, 2), ...newest.slice(2).reverse()]);
    shown.unmount(); render(<RoomLobby />);
    await screen.findByRole("button", { name: "성탄 발표회 즐겨찾기 해제" });
    expect(names()).toEqual(newest);
  });

  it("shows Other detail and reports reversed dates on submission", async () => {
    await signIn(); render(<RoomLobby />);
    fireEvent.click(await screen.findByRole("button", { name: "새 행사방" }));
    fireEvent.change(screen.getByLabelText("행사방 이름"), { target: { value: "새 연습방" } });
    fireEvent.change(screen.getByLabelText("행사 종류"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("기타 행사 설명"), { target: { value: "성가대 연습" } });
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-11-18" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-11-16" } });
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(screen.getByRole("alert").textContent).toContain("종료일은 시작일보다 이전일 수 없습니다");
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "날짜 수정" }));
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-11-18" } });
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(screen.getByRole("button", { name: "새 연습방 선택" })).toBeDefined();
  });
  it("resets an empty personal category together with the other filters", async () => {
    await signIn(); render(<RoomLobby />);
    await screen.findByRole("button", { name: "목록 설정" });
    openListSettings();
    fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    fireEvent.change(screen.getByLabelText("카테고리 이름"), { target: { value: "빈 분류" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(screen.getByText("조건에 맞는 행사방이 없습니다")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(await screen.findByRole("button", { name: "성탄 발표회 입장" })).toBeDefined();
  });

  it("highlights the current anchor, including direct navigation and history changes", async () => {
    await signIn();
    window.history.replaceState(null, "", "#lobby-today");
    render(<RoomLobby />);
    const nav = within(await screen.findByRole("navigation", { name: "주 메뉴" }));
    expect(nav.getByRole("link", { name: "오늘의 행사" }).getAttribute("aria-current")).toBe("location");
    expect(nav.getByRole("link", { name: "행사방" }).hasAttribute("aria-current")).toBe(false);
    for (const [hash, label] of [["#lobby-home", "홈"], ["#rooms-panel", "행사방"]]) {
      window.history.replaceState(null, "", hash);
      act(() => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
      expect(nav.getByRole("link", { name: label }).getAttribute("aria-current")).toBe("location");
    }
  });
});
