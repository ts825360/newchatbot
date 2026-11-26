import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../components/auth-screen";
import { createBrowserAuth, setBrowserAuthFactory } from "../lib/prototype-auth";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const backend = vi.hoisted(() => ({ connected: false }));
vi.mock("../lib/backend-client", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/backend-client")>(),
  isBackendConnected: () => backend.connected
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  backend.connected = false;
  setBrowserAuthFactory(null);
});
afterEach(() => { cleanup(); setBrowserAuthFactory(null); });

function fillSignup() {
  fireEvent.change(screen.getByLabelText("초대코드"), { target: { value: "CHURCH-TEAM-2026" } });
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "시연 담당자" } });
  fireEvent.change(screen.getByLabelText("아이디"), { target: { value: "demo-user" } });
  fireEvent.change(screen.getByLabelText("비밀번호", { exact: true }), { target: { value: "DemoPass123!" } });
  fireEvent.change(screen.getByLabelText("비밀번호 확인", { exact: true }), { target: { value: "DemoPass123!" } });
}

describe("auth screen flow", () => {
  it("hides prototype warnings and surfaces invitation server failures when connected", async () => {
    const auth = createBrowserAuth();
    setBrowserAuthFactory(() => ({ ...auth, checkInvite: async () => { throw Error("초대 확인 서버에 연결할 수 없습니다."); } }));
    backend.connected = true;
    render(<AuthScreen mode="signup" />);
    expect(screen.queryByText(/실제 비밀번호를 사용하지/)).toBeNull();
    fireEvent.change(screen.getByLabelText("초대코드"), { target: { value: "server-code" } });
    fireEvent.click(screen.getByRole("button", { name: "초대코드 확인" }));
    expect((await screen.findByRole("alert")).textContent).toBe("초대 확인 서버에 연결할 수 없습니다.");
  });

  it("shows field errors for empty signup", () => {
    render(<AuthScreen mode="signup" />);
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
    expect(screen.getByText("초대코드를 입력해 주세요.")).toBeDefined();
    expect(screen.getByText("이름은 1~20자로 입력해 주세요.")).toBeDefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("checks invitations and clears verification after editing the code", async () => {
    render(<AuthScreen mode="signup" />);
    fireEvent.change(screen.getByLabelText("초대코드"), { target: { value: "CHURCH-TEAM-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "초대코드 확인" }));
    expect(await screen.findByText("제3관리자 초대")).toBeDefined();
    fireEvent.change(screen.getByLabelText("초대코드"), { target: { value: "wrong" } });
    expect(screen.queryByText("제3관리자 초대")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "초대코드 확인" }));
    expect(await screen.findByText("유효하지 않은 초대코드입니다.")).toBeDefined();
  });

  it("returns to login after signup and enters the room lobby only with correct credentials", async () => {
    render(<AuthScreen mode="signup" />);
    fillSignup();
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    cleanup();
    render(<AuthScreen mode="login" />);
    await waitFor(() => expect((screen.getByLabelText("아이디") as HTMLInputElement).value).toBe("demo-user"));
    expect(screen.getByRole("status").textContent).toContain("가입이 완료");
    fireEvent.change(screen.getByLabelText("비밀번호", { exact: true }), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await screen.findByText("아이디 또는 비밀번호를 확인해 주세요.");
    expect(replace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("비밀번호", { exact: true }), { target: { value: "DemoPass123!" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/rooms"));
  });

  it("keeps typed passwords while toggling visibility", () => {
    render(<AuthScreen mode="login" />);
    const input = screen.getByLabelText("비밀번호", { exact: true }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "DemoPass123!" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 표시" }));
    expect(input.type).toBe("text");
    expect(input.value).toBe("DemoPass123!");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 숨기기" }));
    expect(input.type).toBe("password");
  });

  it("shows signup precautions instead of the login introduction", () => {
    const { rerender } = render(<AuthScreen mode="login" />);
    expect(screen.getByRole("heading", { name: /교회 행사를 더 체계적이고\s*함께 준비하세요/ })).toBeDefined();
    expect(screen.getByText("일정과 준비 현황을 한눈에")).toBeDefined();
    expect(screen.getByText("참가자와 차량을 효율적으로")).toBeDefined();
    expect(screen.getByText("기록을 바탕으로 더 나은 준비")).toBeDefined();
    expect(screen.getByRole("link", { name: "회원가입" }).getAttribute("href")).toBe("/signup");
    expect(screen.getByPlaceholderText("아이디를 입력하세요")).toBeDefined();
    rerender(<AuthScreen mode="signup" />);
    expect(screen.getByRole("heading", { name: "가입 전 확인해 주세요" })).toBeDefined();
    expect(screen.getByText("초대코드가 있어야 가입할 수 있어요")).toBeDefined();
    expect(screen.getByText("아이디와 비밀번호는 공유하지 마세요")).toBeDefined();
    expect(screen.getByText("표시 이름은 ‘담당 역할_이름’으로 적어 주세요")).toBeDefined();
    expect(screen.getByPlaceholderText("예: 차량담당_홍길동")).toBeDefined();
    expect(screen.queryByText("일정과 준비 현황을 한눈에")).toBeNull();
    expect(screen.getByRole("heading", { name: "회원가입", level: 1 })).toBeDefined();
    expect(screen.getByRole("button", { name: "초대코드 확인" })).toBeDefined();
    expect(screen.getByLabelText("비밀번호 확인", { exact: true }).getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByRole("link", { name: "로그인" }).getAttribute("href")).toBe("/login");
  });

  it("keeps the saved display theme when entering login directly", () => {
    localStorage.setItem("church-planner-display", JSON.stringify({ theme: "dark" }));
    render(<AuthScreen mode="login" />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("prefills an invitation link without claiming it and removes the secret fragment", async () => {
    window.history.replaceState(null, "", "/signup#invite=7K9M-P4DX-2R6T");
    render(<AuthScreen mode="signup" />);
    await waitFor(() => expect((screen.getByLabelText("초대코드") as HTMLInputElement).value).toBe("7K9M-P4DX-2R6T"));
    expect(window.location.hash).toBe("");
    expect(push).not.toHaveBeenCalled();
  });
});
