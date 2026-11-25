import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "../components/settings-screen";
import { assistantLengthLabels, assistantToneLabels, defaultAssistantPreferences } from "../lib/assistant-preferences";
import { AUTH_CHANGED_EVENT } from "../lib/prototype-auth";
import type { Permission, UserProfile } from "../lib/types";

const { backendFetch, flushBackendWrites, getBackendProfile, logout, router } = vi.hoisted(() => ({
  backendFetch: vi.fn(), flushBackendWrites: vi.fn(), getBackendProfile: vi.fn(), logout: vi.fn(), router: { replace: vi.fn() }
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/backend-client", async (original) => ({
  ...await original<typeof import("../lib/backend-client")>(), backendFetch, flushBackendWrites, getBackendProfile
}));
vi.mock("../lib/prototype-auth", async (original) => ({
  ...await original<typeof import("../lib/prototype-auth")>(), createBrowserAuth: () => ({ logout })
}));
const profile = (grade: UserProfile["grade"], permissions: Permission[]): UserProfile => ({
  grade, permissions, accountId: "settings-fixture", nickname: "준비 담당자", role: "행사 담당", roomIds: []
});
const calendarPermissions: Permission[] = ["viewCalendar"];
const formsPermissions: Permission[] = ["viewRoom"];
const unconnected = { configured: true, connected: false };
const connectionStatuses = { calendar: unconnected, formsRead: unconnected, formsCreate: unconnected };
const savedPreferences = { ...defaultAssistantPreferences, tone: "friendly", length: "detailed", instructions: "", instructionsEnabled: false };
const select = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/settings");
  getBackendProfile.mockReturnValue(profile(3, ["chat"]));
  backendFetch.mockImplementation(async (path) => path.endsWith("/account-status") ? connectionStatuses : savedPreferences);
  flushBackendWrites.mockResolvedValue(undefined);
  logout.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("settings access", () => {
  it("opens the account with six vertical sections and keeps password change in security", async () => {
    render(<SettingsScreen />);
    const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
    expect(nav.getByRole("link", { name: "환경설정" }).getAttribute("aria-current")).toBe("page");
    expect(nav.queryByRole("link", { name: "운영 관리" })).toBeNull();
    expect(nav.queryByRole("link", { name: "구성원 관리" })).toBeNull();
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["내 계정", "화면 및 접근성", "알림", "답변 스타일", "보안 및 개인정보", "도움말 및 지원"]);
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
    const account = screen.getByRole("tab", { name: "내 계정" });
    expect(account.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button", { name: "비밀번호 변경" })).toBeNull();
    fireEvent.keyDown(account, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "화면 및 접근성" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "보안 및 개인정보" }));
    expect(screen.getByRole("button", { name: "비밀번호 변경" })).toBeDefined();
    expect(window.location.search).toBe("?section=security");
  });
  it("redirects an anonymous visit without fetching preferences or mounting integrations", () => {
    getBackendProfile.mockReturnValue(null);
    window.history.replaceState(null, "", "/settings?section=connections");
    render(<SettingsScreen />);
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(screen.getByRole("status").textContent).toBe("접속 확인 중...");
    expect(screen.queryByRole("button")).toBeNull();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("previews display changes and applies them only on save", () => {
    window.history.replaceState(null, "", "/settings?from=workspace&section=display");
    const view = render(<SettingsScreen />);
    expect(screen.getByRole("link", { name: "대화로 돌아가기" }).getAttribute("href")).toBe("/workspace");
    select("어두운 모드"); select("아주 크게"); select("촘촘하게");
    expect(screen.getByRole("complementary", { name: "화면 미리보기" }).querySelector("[data-theme=dark]")).not.toBeNull();
    const preview = within(screen.getByRole("complementary", { name: "화면 미리보기" }));
    expect(preview.getByText("수련회 준비를 도와드릴까요?")).toBeDefined();
    expect(preview.getByText("전체 일정을 정리해 주세요.")).toBeDefined();
    expect(document.documentElement.dataset.uiSize).toBe("standard");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.uiSize).toBe("largest");
    view.unmount();
    render(<SettingsScreen />);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "촘촘하게" }).checked).toBe(true);
  });

  it("separates actual alert channels and settings from unsupported delivery controls", () => {
    getBackendProfile.mockReturnValue(profile(3, ["viewCalendar"]));
    window.history.replaceState(null, "", "/settings?section=notifications");
    render(<SettingsScreen />);
    expect(screen.getByRole("region", { name: "알림 수신 방법" })).toBeDefined();
    const details = within(screen.getByRole("region", { name: "알림 세부 설정" }));
    expect(details.getByRole("link", { name: "캘린더 연동 관리" }).getAttribute("href")).toContain("#google-calendar");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it.each([1, 2, 3] as const)("offers one Google connection to grade %i without member management or chat permissions", async (grade) => {
    getBackendProfile.mockReturnValue(profile(grade, [...calendarPermissions, ...formsPermissions]));
    window.history.replaceState(null, "", "/settings?section=connections#google-calendar");
    render(<SettingsScreen />);
    expect(await screen.findByRole("button", { name: "Google 계정 연결" })).toBeDefined();
    expect(screen.getAllByRole<HTMLInputElement>("checkbox").map(input => input.checked)).toEqual([true, true, true]);
    expect(screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "구글폼 연결" })).toBeNull();
    expect(backendFetch.mock.calls.map(([path]) => path)).toEqual(["/api/integrations/google/account-status"]);
  });

  it("opens a Forms hash link for an eligible grade 3 account without exposing Calendar", async () => {
    getBackendProfile.mockReturnValue(profile(3, formsPermissions));
    window.history.replaceState(null, "", "/settings#google-forms");
    render(<SettingsScreen />);
    expect(await screen.findByRole("checkbox", { name: "설문 생성" })).toBeDefined();
    expect(document.getElementById("google-forms")).not.toBeNull();
    expect(screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" })).toBeDefined();
    expect(document.getElementById("google-calendar")).toBeNull();
    expect(screen.getByRole("tab", { name: "보안 및 개인정보" }).getAttribute("aria-selected")).toBe("true");
  });

  it("starts one consent request for the selected features", async () => {
    getBackendProfile.mockReturnValue(profile(3, [...calendarPermissions, ...formsPermissions]));
    window.history.replaceState(null, "", "/settings?section=connections");
    backendFetch.mockImplementation(async (path) => {
      if (path.endsWith("/account-status")) return connectionStatuses;
      throw new Error("fixture navigation suppressed");
    });
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "설문 생성" }));
    fireEvent.click(screen.getByRole("button", { name: "Google 계정 연결" }));
    await screen.findByRole("alert");
    const requests = backendFetch.mock.calls.filter(([path]) => path.endsWith("/account-connect"));
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0][1].body)).toEqual({ features: ["calendar", "formsRead"] });
    expect(flushBackendWrites).toHaveBeenCalledOnce();
  });

  it("keeps current service status distinct from the next consent selection", async () => {
    getBackendProfile.mockReturnValue(profile(3, [...calendarPermissions, ...formsPermissions]));
    window.history.replaceState(null, "", "/settings?section=connections");
    backendFetch.mockResolvedValue({
      calendar: { configured: true, connected: true },
      formsRead: { configured: true, connected: false, needsReconnect: true },
      formsCreate: { configured: false, connected: false },
    });
    render(<SettingsScreen />);
    const serviceList = await screen.findByRole("group", { name: "Google 동의 요청에 포함할 기능" });
    const calendar = within(serviceList).getByRole<HTMLInputElement>("checkbox", { name: "캘린더 전송", description: "연결됨" });
    const formCreation = within(serviceList).getByRole<HTMLInputElement>("checkbox", { name: "설문 생성" });
    expect(screen.getByText("1 / 3 연결됨")).toBeDefined();
    expect(within(serviceList).getByText("재동의 필요")).toBeDefined();
    expect(formCreation.disabled).toBe(true);
    fireEvent.click(calendar);
    expect(calendar.checked).toBe(false);
    expect(screen.getByText("1 / 3 연결됨")).toBeDefined();
    expect(backendFetch).toHaveBeenCalledTimes(1);
  });

  it("denies both integrations and preferences when required permissions are missing", () => {
    getBackendProfile.mockReturnValue(profile(2, ["manageMembers", "editChecklist"]));
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "답변 스타일" }));
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("답변 스타일을 설정할 권한이 없습니다.")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "보안 및 개인정보" }));
    expect(screen.getByText("Google 연동을 관리할 권한이 없습니다.")).toBeDefined();
    expect(document.getElementById("google-calendar")).toBeNull();
    expect(document.getElementById("google-forms")).toBeNull();
    expect(backendFetch.mock.calls.map(([path]) => path)).toEqual(["/api/auth/account"]);
  });

  it("clears settings when the account signs out while the page is open", () => {
    render(<SettingsScreen />);
    getBackendProfile.mockReturnValue(null);
    act(() => window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)));
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("waits for pending backend writes before logging out", async () => {
    getBackendProfile.mockReturnValue(profile(3, []));
    let finish!: () => void;
    flushBackendWrites.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(flushBackendWrites).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(logout).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith("/login");
  });

  it("stays signed in and reports an error when pending writes cannot be flushed", async () => {
    getBackendProfile.mockReturnValue(profile(3, []));
    flushBackendWrites.mockRejectedValueOnce(new Error("offline"));
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect((await screen.findByRole("alert")).textContent).toContain("로그아웃하지 못했습니다");
    expect(logout).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("Google outcome navigation", () => {
  it.each([
    ["calendar", "connected", "status", "Google 캘린더 연동이 완료되었습니다."],
    ["forms", "cancelled", "status", "Google 설문지 연동이 취소되었습니다."],
    ["calendar", "failed", "alert", "Google 캘린더 연동에 실패했습니다."],
    ["account", "partial", "status", "Google 계정: 일부 권한만 허용되었습니다. 기능별 연결 상태를 확인해 주세요."]
  ])("captures %s %s, cleans the URL and clears the banner on switching", (connection, result, role, message) => {
    getBackendProfile.mockReturnValue(profile(2, [...calendarPermissions, ...formsPermissions]));
    const hash = connection === "account" ? "" : `#google-${connection}`;
    window.history.replaceState(null, "", `/settings?section=connections&connection=${connection}&result=${result}${hash}`);
    render(<StrictMode><SettingsScreen /></StrictMode>);
    expect(screen.getByText(message).getAttribute("role")).toBe(role);
    expect(window.location.search).toBe("?section=connections");
    expect(window.location.hash).toBe(hash);
    fireEvent.click(screen.getByRole("tab", { name: "답변 스타일" }));
    expect(window.location.search).toBe("?section=reply");
    expect(window.location.hash).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: "보안 및 개인정보" }));
    expect(window.location.search).toBe("?section=security");
    expect(screen.queryByText(message)).toBeNull();
  });

  it("ignores unknown outcomes and follows a restored URL on popstate", () => {
    getBackendProfile.mockReturnValue(profile(2, calendarPermissions));
    window.history.replaceState(null, "", "/settings?section=connections&connection=calendar&result=raw-provider-error");
    render(<SettingsScreen />);
    expect(screen.queryByText(/연동이 완료|연동이 취소|연동에 실패|raw-provider-error/)).toBeNull();
    expect(window.location.search).toBe("?section=connections");
    act(() => {
      window.history.replaceState(null, "", "/settings?section=reply");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tab", { name: "답변 스타일" }).getAttribute("aria-selected")).toBe("true");
  });

  it("does not display a callback banner for a connection the account cannot manage", () => {
    getBackendProfile.mockReturnValue(profile(3, formsPermissions));
    window.history.replaceState(null, "", "/settings?section=connections&connection=calendar&result=connected");
    render(<SettingsScreen />);
    expect(screen.queryByText("Google 캘린더 연동이 완료되었습니다.")).toBeNull();
    expect(window.location.search).toBe("?section=connections");
  });

  it("preserves existing history state when consuming outcomes and switching tabs", () => {
    const historyState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { fixture: "settings" } };
    getBackendProfile.mockReturnValue(profile(2, calendarPermissions));
    window.history.replaceState(historyState, "", "/settings?section=connections&connection=calendar&result=connected");
    render(<SettingsScreen />);
    expect(window.history.state).toEqual(historyState);
    fireEvent.click(screen.getByRole("tab", { name: "답변 스타일" }));
    expect(window.history.state).toEqual(historyState);
  });

  it("moves focus and updates the URL using vertical tabs", () => {
    render(<SettingsScreen />);
    const account = screen.getByRole("tab", { name: "내 계정" });
    const display = screen.getByRole("tab", { name: "화면 및 접근성" });
    const support = screen.getByRole("tab", { name: "도움말 및 지원" });
    account.focus();
    fireEvent.keyDown(account, { key: "ArrowDown" });
    expect(document.activeElement).toBe(display);
    expect(window.location.search).toBe("?section=display");
    fireEvent.keyDown(display, { key: "End" });
    expect(document.activeElement).toBe(support);
    expect(support.tabIndex).toBe(0);
    expect(display.tabIndex).toBe(-1);
    fireEvent.keyDown(support, { key: "Home" });
    expect(document.activeElement).toBe(account);
    fireEvent.keyDown(account, { key: "ArrowUp" });
    expect(document.activeElement).toBe(support);
  });
});

describe("reply preferences", () => {
  beforeEach(() => window.history.replaceState(null, "", "/settings?section=reply"));
  it("stores the account's emoji choice with other settings", async () => {
    const changed = { ...savedPreferences, emoji: "occasional" };
    backendFetch.mockResolvedValueOnce(savedPreferences).mockResolvedValueOnce(changed);
    render(<SettingsScreen />);
    expect((await screen.findByRole<HTMLInputElement>("radio", { name: "사용 안 함" })).checked).toBe(true);
    select("가끔 사용");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("답변 스타일을 저장했습니다.")).toBeDefined();
    expect(JSON.parse(backendFetch.mock.calls[1][1].body)).toEqual(changed);
  });

  it("loads server preferences and retains a failed draft for an explicit retry", async () => {
    const changed = { ...savedPreferences, tone: "direct", length: "brief" };
    backendFetch.mockResolvedValueOnce(savedPreferences)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(changed);
    render(<SettingsScreen />);
    expect((await screen.findByRole<HTMLInputElement>("radio", { name: assistantToneLabels.friendly })).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: assistantLengthLabels.detailed }).checked).toBe(true);
    expect(backendFetch.mock.calls[0][0]).toBe("/api/preferences");
    select(assistantToneLabels.direct);
    select(assistantLengthLabels.brief);
    const save = screen.getByRole("button", { name: "저장" });
    fireEvent.click(save);
    expect((await screen.findByRole("alert")).textContent).toContain("저장하지 못했습니다");
    fireEvent.click(screen.getByRole("tab", { name: "보안 및 개인정보" }));
    fireEvent.click(screen.getByRole("tab", { name: "답변 스타일" }));
    expect(screen.getByRole<HTMLInputElement>("radio", { name: assistantToneLabels.direct }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: assistantLengthLabels.brief }).checked).toBe(true);
    fireEvent.click(save);
    expect(await screen.findByText("답변 스타일을 저장했습니다.")).toBeDefined();
    for (const [path, init] of backendFetch.mock.calls.slice(1)) {
      expect(path).toBe("/api/preferences");
      expect(init.method).toBe("PUT");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body)).toEqual(changed);
    }
    expect(backendFetch).toHaveBeenCalledTimes(3);
  });

  it("saves personal instructions only on request and discloses that OpenAI does not receive them", async () => {
    const saved = { ...savedPreferences, instructions: "먼저 요점을 알려주세요." };
    backendFetch.mockResolvedValueOnce(savedPreferences).mockResolvedValueOnce(saved);
    render(<SettingsScreen />);
    const input = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "내 답변 지침 (선택)" });
    const save = screen.getByRole("button", { name: "저장" });
    expect(input.maxLength).toBe(800);
    expect(screen.getByText(/OpenAI에 자동으로 전송하거나 답변에 적용하지 않습니다/)).toBeDefined();
    fireEvent.change(input, { target: { value: saved.instructions } });
    expect(backendFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(save);
    expect(await screen.findByText("답변 스타일을 저장했습니다.")).toBeDefined();
    expect(JSON.parse(backendFetch.mock.calls[1][1].body)).toEqual(saved);
    expect(input.value).toBe(saved.instructions);
  });

  it("resets the draft to defaults without writing until Save is pressed", async () => {
    backendFetch.mockResolvedValueOnce({ ...savedPreferences, instructions: "짧게", instructionsEnabled: true })
      .mockResolvedValueOnce(defaultAssistantPreferences);
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "기본값으로 되돌리기" }));
    const groups = screen.getAllByRole("group");
    const checked = (group: HTMLElement) => within(group).getByRole<HTMLInputElement>("radio", { checked: true }).value;
    expect(groups.map(checked)).toEqual([defaultAssistantPreferences.tone, defaultAssistantPreferences.length, defaultAssistantPreferences.emoji]);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "내 답변 지침 (선택)" }).value).toBe("");
    expect(backendFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("답변 스타일을 저장했습니다.")).toBeDefined();
    expect(JSON.parse(backendFetch.mock.calls[1][1].body)).toEqual(defaultAssistantPreferences);
  });

  it("does not offer saved controls after an invalid load until it can retry", async () => {
    backendFetch.mockResolvedValueOnce({ tone: "custom", length: "detailed" });
    render(<SettingsScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("불러오지 못했습니다");
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("radio", { name: assistantToneLabels.friendly })).toBeDefined();
  });
});
