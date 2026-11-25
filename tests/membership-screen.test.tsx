import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipScreen } from "../components/membership-screen";
import { OwnerConsole } from "../components/owner-console";
import type { InvitationDraft, InvitationView, MemberView } from "../lib/invitation-types";

const { auth, router, clipboard } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  clipboard: { writeText: vi.fn() },
  auth: {
    currentProfile: vi.fn(), getMembers: vi.fn(), getInvitations: vi.fn(),
    createInvitation: vi.fn(), revokeInvitation: vi.fn(), setMemberSuspended: vi.fn(),
    getOwnerOverview: vi.fn(), logout: vi.fn()
  }
}));
const backend = vi.hoisted(() => ({ connected: false }));
vi.mock("../lib/backend-client", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/backend-client")>(),
  isBackendConnected: () => backend.connected
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/prototype-auth", () => ({ createBrowserAuth: () => auth }));

const profile = (grade: 1 | 2 | 3) => ({ accountId: "self", nickname: "현재 관리자", grade, role: "행사 담당", permissions: [], roomIds: [] });
const member = (id: string, grade: 1 | 2 | 3, status: MemberView["status"] = "active"): MemberView => ({
  id, name: id, username: `${id}-login`, grade, role: "준비 담당", status,
  accessExpiresAt: "2026-12-01T00:00:00+09:00", fixed: grade === 1
});
const invite = (id: string, status: InvitationView["status"]): InvitationView => ({
  id, label: id, grade: 3, role: "행사 담당", status,
  signupExpiresAt: "2026-11-23T10:00:00+09:00", accessExpiresAt: "2026-12-01T00:00:00+09:00",
  createdAt: "2026-11-16T10:00:00+09:00", issuerName: "발급 관리자", usedByName: status === "used" ? "가입 구성원" : null
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  vi.resetAllMocks();
  backend.connected = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T01:00:00Z"));
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  auth.currentProfile.mockReturnValue(profile(2));
  auth.getMembers.mockReturnValue([member("소유자", 1), member("self", 2), member("동료", 2), member("담당자", 3), member("정지 구성원", 3, "suspended"), member("만료 구성원", 3, "expired")]);
  auth.getInvitations.mockReturnValue([invite("대기 초대", "unused"), invite("사용 초대", "used"), invite("만료 초대", "expired"), invite("취소 초대", "revoked")]);
  auth.createInvitation.mockImplementation(async (draft: InvitationDraft) => ({
    invitation: { ...invite(draft.label, "unused"), ...draft }, code: "ABCD1234EFGH5678", signupPath: "/signup?invite=ABCD1234EFGH5678"
  }));
  clipboard.writeText.mockResolvedValue(undefined);
  auth.getOwnerOverview.mockImplementation(() => ({ members: auth.getMembers(), invitations: auth.getInvitations(), activities: [{ id: "a1", actor: "운영자", at: "2026-11-16T01:00:00Z", action: "초대 발급", target: "겨울 준비팀" }] }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function openCreate() {
  fireEvent.click(screen.getByRole("tab", { name: "초대코드" }));
  fireEvent.click(screen.getByRole("button", { name: "새 초대" }));
}
function fillInvite(grade = "3") {
  fireEvent.change(screen.getByLabelText("초대 이름"), { target: { value: "겨울 준비팀" } });
  fireEvent.change(screen.getByLabelText("등급"), { target: { value: grade } });
  fireEvent.change(screen.getByLabelText("담당 역할"), { target: { value: "행사 담당" } });
}
async function createInvite() {
  openCreate(); fillInvite();
  fireEvent.click(screen.getByRole("button", { name: "초대 만들기" }));
  return screen.findByText("ABCD-1234-EFGH-5678");
}

describe("membership permissions and refresh", () => {
  it("redirects anonymous visitors without loading sensitive lists", () => {
    auth.currentProfile.mockReturnValue(null);
    render(<MembershipScreen />);
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(auth.getMembers).not.toHaveBeenCalled();
    expect(auth.getInvitations).not.toHaveBeenCalled();
  });
  it("denies grade3 without loading lists and links back to rooms", () => {
    auth.currentProfile.mockReturnValue(profile(3));
    render(<MembershipScreen />);
    expect(screen.getByText("접근 권한이 없습니다")).toBeDefined();
    expect(screen.getByRole("link", { name: "행사방 목록" }).getAttribute("href")).toBe("/rooms");
    expect(auth.getMembers).not.toHaveBeenCalled();
    expect(auth.getInvitations).not.toHaveBeenCalled();
  });
  it.each(["focus", "storage", "church-auth-changed"])("clears sensitive data when access changes on %s", (eventName) => {
    render(<MembershipScreen />);
    expect(screen.getByText("담당자-login")).toBeDefined();
    auth.currentProfile.mockReturnValue(profile(3));
    const calls = auth.getMembers.mock.calls.length;
    act(() => { window.dispatchEvent(new Event(eventName)); });
    expect(screen.queryByText("담당자-login")).toBeNull();
    expect(auth.getMembers).toHaveBeenCalledTimes(calls);
    expect(screen.getByText("접근 권한이 없습니다")).toBeDefined();
  });
  it("rechecks access on an interval and cleans up its timer", () => {
    vi.useFakeTimers();
    const view = render(<MembershipScreen />);
    auth.currentProfile.mockReturnValue(null);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(router.replace).toHaveBeenCalledWith("/login");
    view.unmount();
    const calls = auth.currentProfile.mock.calls.length;
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(auth.currentProfile).toHaveBeenCalledTimes(calls);
  });
  it("filters members by search and status, and toggles the existing theme", () => {
    render(<MembershipScreen />);
    fireEvent.change(screen.getByRole("searchbox", { name: "구성원 검색" }), { target: { value: "만료" } });
    expect(screen.queryByText("담당자-login")).toBeNull();
    expect(screen.getByText("만료 구성원-login")).toBeDefined();
    fireEvent.change(screen.getByRole("combobox", { name: "구성원 상태" }), { target: { value: "active" } });
    expect(screen.getByText("조건에 맞는 구성원이 없습니다")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "다크 모드" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("member suspension", () => {
  it("waits for server suspension and keeps a rejected confirmation open", async () => {
    let reject!: (cause: Error) => void;
    auth.setMemberSuspended.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    render(<MembershipScreen />);
    fireEvent.click(screen.getByRole("button", { name: "담당자 이용 정지" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "이용 정지" }));
    expect(screen.queryByText("담당자님의 이용을 정지했습니다.")).toBeNull();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "이용 정지" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { reject(Error("서버 저장 실패")); });
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("서버 저장 실패");
  });
  it("hides suspension for owner, self and expired members but permits managing peers", () => {
    render(<MembershipScreen />);
    for (const name of ["소유자", "self", "만료 구성원"]) {
      const row = screen.getByText(`${name}-login`).closest("tr")!;
      expect(within(row).queryByRole("button")).toBeNull();
    }
    expect(screen.getByRole("button", { name: "동료 이용 정지" })).toBeDefined();
    expect(screen.getByRole("button", { name: "담당자 이용 정지" })).toBeDefined();
    expect(within(screen.getByText("만료 구성원-login").closest("tr")!).getByText("기간 만료")).toBeDefined();
  });
  it("requires confirmation, supports cancel and refreshes after suspension", () => {
    render(<MembershipScreen />);
    fireEvent.click(screen.getByRole("button", { name: "담당자 이용 정지" }));
    expect(screen.getByRole("dialog").textContent).toContain("파일과 이력은 유지됩니다");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(auth.setMemberSuspended).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "담당자 이용 정지" }));
    const calls = auth.getMembers.mock.calls.length;
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "이용 정지" }));
    expect(auth.setMemberSuspended).toHaveBeenCalledWith("담당자", true);
    expect(auth.getMembers.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps the confirmation and local error visible on adapter failure", () => {
    auth.setMemberSuspended.mockImplementation(() => { throw new Error("권한이 변경되었습니다"); });
    render(<MembershipScreen />);
    fireEvent.click(screen.getByRole("button", { name: "담당자 이용 정지" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "이용 정지" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("권한이 변경되었습니다");
  });
  it("restores suspended members without offering a period extension", () => {
    render(<MembershipScreen />);
    fireEvent.click(screen.getByRole("button", { name: "정지 구성원 이용 복구" }));
    expect(screen.getByRole("dialog").textContent).toContain("이용 기한은 연장되지 않습니다");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "이용 복구" }));
    expect(auth.setMemberSuspended).toHaveBeenCalledWith("정지 구성원", false);
  });
});

it.each(["members", "owner"])("awaits asynchronous %s logout before redirecting", async scope => {
  if (scope === "owner") auth.currentProfile.mockReturnValue(profile(1));
  let finish!: () => void;
  auth.logout.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render(scope === "owner" ? <OwnerConsole /> : <MembershipScreen />);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => { auth.currentProfile.mockReturnValue(null); finish(); });
  expect(router.replace).toHaveBeenCalledWith("/login");
});

it("hides browser-only warnings in connected management", () => {
  backend.connected = true;
  render(<MembershipScreen />);
  expect(screen.queryByText(/브라우저 체험용/)).toBeNull();
});

describe("invitation management", () => {
  it.each(["2", "3"])("allows a grade2 manager to issue grade%s with explicit KST dates", async (grade) => {
    render(<MembershipScreen />); openCreate(); fillInvite(grade);
    expect(screen.queryByRole("option", { name: "제1관리자" })).toBeNull();
    fireEvent.change(screen.getByLabelText("가입 기한"), { target: { value: "2026-11-24T14:30" } });
    fireEvent.change(screen.getByLabelText("이용 기한"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "초대 만들기" }));
    await screen.findByText("ABCD-1234-EFGH-5678");
    expect(auth.createInvitation).toHaveBeenCalledWith({ label: "겨울 준비팀", grade: Number(grade), role: "행사 담당", signupExpiresAt: "2026-11-24T14:30:00+09:00", accessExpiresAt: "2026-12-01T00:00:00+09:00" });
  });
  it("defaults to grade3, signup in seven KST days, and the preceding December cutoff day", () => {
    render(<MembershipScreen />); openCreate();
    expect((screen.getByLabelText("등급") as HTMLSelectElement).value).toBe("3");
    expect((screen.getByLabelText("가입 기한") as HTMLInputElement).value).toBe("2026-11-23T10:00");
    expect((screen.getByLabelText("이용 기한") as HTMLInputElement).value).toBe("2026-11-30");
    expect(screen.queryByRole("checkbox", { name: "기간 제한 없음" })).toBeNull();
  });
  it("keeps the default signup deadline within the access period near the annual cutoff", () => {
    vi.setSystemTime(new Date("2026-11-29T10:00:00+09:00"));
    render(<MembershipScreen />); openCreate();
    expect((screen.getByLabelText("가입 기한") as HTMLInputElement).value).toBe("2026-12-01T00:00");
    expect((screen.getByLabelText("이용 기한") as HTMLInputElement).value).toBe("2026-11-30");
  });
  it("permits unlimited access only for grade2 and resets it when switching to grade3", async () => {
    render(<MembershipScreen />); openCreate(); fillInvite("2");
    fireEvent.click(screen.getByRole("checkbox", { name: "기간 제한 없음" }));
    expect((screen.getByLabelText("이용 기한") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "초대 만들기" }));
    await screen.findByText("ABCD-1234-EFGH-5678");
    expect(auth.createInvitation.mock.calls[0][0].accessExpiresAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    openCreate(); fillInvite("2");
    fireEvent.click(screen.getByRole("checkbox", { name: "기간 제한 없음" }));
    fireEvent.change(screen.getByLabelText("등급"), { target: { value: "3" } });
    expect(screen.queryByRole("checkbox", { name: "기간 제한 없음" })).toBeNull();
    expect((screen.getByLabelText("이용 기한") as HTMLInputElement).disabled).toBe(false);
  });
  it("preserves form values and adapter validation errors without closing", async () => {
    auth.createInvitation.mockRejectedValue(new Error("초대 이름과 미래 기한을 확인해 주세요"));
    render(<MembershipScreen />); openCreate(); fillInvite();
    fireEvent.click(screen.getByRole("button", { name: "초대 만들기" }));
    expect((await screen.findByRole("alert")).textContent).toBe("초대 이름과 미래 기한을 확인해 주세요");
    expect(screen.getByRole("dialog")).toBeDefined();
    expect((screen.getByLabelText("초대 이름") as HTMLInputElement).value).toBe("겨울 준비팀");
  });
  it("shows revoke only for unused invitations and requires confirmation", () => {
    render(<MembershipScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "초대코드" }));
    for (const label of ["사용 초대", "만료 초대", "취소 초대"]) expect(within(screen.getByText(label).closest("tr")!).queryByRole("button")).toBeNull();
    expect(screen.getByText("가입 구성원")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "대기 초대 초대 취소" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(auth.revokeInvitation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "대기 초대 초대 취소" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "초대 취소" }));
    expect(auth.revokeInvitation).toHaveBeenCalledWith("대기 초대");
  });
  it("keeps revoke errors inside the confirmation", () => {
    auth.revokeInvitation.mockImplementation(() => { throw new Error("이미 사용된 초대입니다"); });
    render(<MembershipScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "초대코드" }));
    fireEvent.click(screen.getByRole("button", { name: "대기 초대 초대 취소" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "초대 취소" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("이미 사용된 초대입니다");
  });
  it("copies the grouped code and absolute signup link then forgets the code on close", async () => {
    render(<MembershipScreen />); await createInvite();
    expect(screen.getByRole("dialog").textContent).toContain("가입을 완료해야 사용 처리됩니다");
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("ABCD-1234-EFGH-5678"));
    expect((await screen.findByText("코드를 복사했습니다.")).getAttribute("role")).toBe("status");
    fireEvent.click(screen.getByRole("button", { name: "초대 링크 복사" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/signup?invite=ABCD1234EFGH5678`));
    expect(await screen.findByText("초대 링크를 복사했습니다.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByText("ABCD-1234-EFGH-5678")).toBeNull();
    openCreate();
    expect(screen.queryByText("ABCD-1234-EFGH-5678")).toBeNull();
  });
  it("reports clipboard failure explicitly and keeps the generated code", async () => {
    clipboard.writeText.mockRejectedValue(new Error("blocked"));
    render(<MembershipScreen />); await createInvite();
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    expect((await screen.findByRole("alert")).textContent).toContain("복사하지 못했습니다");
    expect(screen.getByText("ABCD-1234-EFGH-5678")).toBeDefined();
  });
  it("does not redisplay a code if its pending creation finishes after the dialog closes", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof auth.createInvitation>>) => void;
    auth.createInvitation.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<MembershipScreen />); openCreate(); fillInvite();
    fireEvent.click(screen.getByRole("button", { name: "초대 만들기" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await act(async () => { resolve({ invitation: invite("late", "unused"), code: "LATECODE", signupPath: "/signup?invite=LATECODE" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("LATE-CODE")).toBeNull();
  });
});

describe("owner console", () => {
  it.each([2, 3] as const)("denies grade%s without calling overview", (grade) => {
    auth.currentProfile.mockReturnValue(profile(grade));
    render(<OwnerConsole />);
    expect(screen.getByText("접근 권한이 없습니다")).toBeDefined();
    expect(auth.getOwnerOverview).not.toHaveBeenCalled();
  });
  it("redirects anonymous owners without calling overview", () => {
    auth.currentProfile.mockReturnValue(null);
    render(<OwnerConsole />);
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(auth.getOwnerOverview).not.toHaveBeenCalled();
  });
  it("shows read-only counts and operational activity for grade1", () => {
    auth.currentProfile.mockReturnValue(profile(1));
    render(<OwnerConsole />);
    expect(screen.getByRole("heading", { name: "운영 관리" })).toBeDefined();
    const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
    expect(nav.getByRole("link", { name: "운영 관리" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("link", { name: "환경설정" }).getAttribute("href")).toBe("/settings");
    for (const [label, count] of [["이용 중", "4"], ["이용 정지", "1"], ["기간 만료", "1"], ["미사용 초대", "1"]]) {
      expect(screen.getByText(label).closest("dt")!.nextElementSibling!.textContent).toBe(count);
    }
    expect(screen.getByRole("table", { name: "운영 활동" }).textContent).toContain("겨울 준비팀");
    expect(screen.queryByRole("button", { name: /이용 정지/ })).toBeNull();
    expect(screen.getByText("브라우저 체험용 · 같은 브라우저에서만 공유됩니다.")).toBeDefined();
  });
  it("removes the overview when owner permission changes", () => {
    auth.currentProfile.mockReturnValue(profile(1));
    render(<OwnerConsole />);
    auth.currentProfile.mockReturnValue(profile(2));
    const calls = auth.getOwnerOverview.mock.calls.length;
    act(() => { window.dispatchEvent(new Event("church-auth-changed")); });
    expect(auth.getOwnerOverview).toHaveBeenCalledTimes(calls);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("접근 권한이 없습니다")).toBeDefined();
  });
});
