import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsHelp } from "@/components/settings-help";

const backend = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/backend-client", () => ({ backendFetch: backend.fetch, isBackendConnected: () => true }));
const contact = vi.hoisted(() => ({ email: "" }));
vi.mock("@/lib/support-config", () => ({ supportConfig: contact }));
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  contact.email = "support@example.invalid";
  backend.fetch.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard: { writeText } }));
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  }
});

it("does not offer a mailto link or copy an address without a configured support mailbox", () => {
  contact.email = "";
  render(<SettingsHelp />);
  expect(screen.getByText("공개 문의 이메일이 설정되지 않았습니다.")).toBeDefined();
  expect(screen.queryByRole("link", { name: "문의하기" })).toBeNull();
  expect(screen.queryByRole("button", { name: "이메일 주소 복사" })).toBeNull();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens the starter guide and restores focus to its entry button on return", () => {
  render(<SettingsHelp />);
  const starter = screen.getByRole("button", { name: "시작 가이드 보기" });
  fireEvent.click(starter);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "시작 가이드" }));
  expect(screen.getByText(/이름과 행사 기간/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "사용설명서 목록" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "시작 가이드 보기" }));
});

it("keeps the category navigation, active guide, and small-screen select in sync", () => {
  render(<SettingsHelp />);
  fireEvent.click(screen.getByRole("button", { name: /일정 관리/ }));
  const toc = screen.getByRole("navigation", { name: "사용설명서 목차" });
  expect(within(toc).getByRole("button", { name: "일정 관리" }).getAttribute("aria-current")).toBe("true");
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "사용설명서 항목" });
  expect(select.value).toBe("schedule");
  fireEvent.change(select, { target: { value: "materials" } });
  expect(screen.getByRole("heading", { name: "자료 관리" })).toBeDefined();
  expect(screen.getByText(/^다운로드 전용:.*HWP.*XLSX/)).toBeDefined();
  expect(screen.getByText(/내 계정.*1,000개.*100 MiB/)).toBeDefined();
  expect(within(toc).getByRole("button", { name: "자료 관리" }).getAttribute("aria-current")).toBe("true");
  fireEvent.click(within(toc).getByRole("button", { name: "AI 행사비서" }));
  expect(select.value).toBe("assistant");
});

it("copies the exact supported survey prompt and announces completion", async () => {
  render(<SettingsHelp />);
  fireEvent.click(screen.getByRole("button", { name: /참가 설문/ }));
  const example = screen.getByText("참가 설문을 만들어줘");
  fireEvent.click(within(example.closest("li")!).getByRole("button", { name: /예시 복사/ }));
  expect(writeText).toHaveBeenCalledWith("참가 설문을 만들어줘");
  expect(await screen.findByText("예시를 복사했습니다.")).toBeDefined();
  expect(backend.fetch).not.toHaveBeenCalled();
});

it("keeps legacy FAQ answers and uses one address for mailto and copy", async () => {
  render(<SettingsHelp />);
  expect(screen.getByText("다른 구성원도 제 대화를 볼 수 있나요?")).toBeDefined();
  expect(screen.getByText("휴대폰에서 일정을 못 찾겠어요.")).toBeDefined();
  const question = screen.getByText("개인 답변 지침이 왜 반영되지 않나요?");
  fireEvent.click(question);
  expect(within(question.closest("details")!).getByText(/외부 모델에 보내지 않습니다/)).toBeDefined();
  const mail = screen.getByRole("link", { name: "문의하기" });
  expect(mail.getAttribute("href")).toBe("mailto:support@example.invalid");
  expect(screen.getByText("support@example.invalid")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "이메일 주소 복사" }));
  expect(writeText).toHaveBeenCalledWith("support@example.invalid");
  expect(await screen.findByText("이메일 주소를 복사했습니다.")).toBeDefined();
  writeText.mockRejectedValueOnce(new Error("Clipboard not available"));
  fireEvent.click(screen.getByRole("button", { name: "이메일 주소 복사" }));
  expect(await screen.findByText(/직접 선택해서 복사/)).toBeDefined();
  expect(backend.fetch).not.toHaveBeenCalled();
});

it.each([["문제 신고", "screen"], ["개선 제안", "other"]])("opens the existing report flow via %s without adding context by default", async (label, category) => {
  backend.fetch.mockResolvedValue({ notification: "unconfigured" });
  render(<SettingsHelp />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  const dialog = screen.getByRole("dialog", { name: label });
  expect(within(dialog).getByLabelText<HTMLSelectElement>("문제 유형").value).toBe(category);
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "테스트 의견" } });
  fireEvent.submit(dialog.querySelector("form")!);
  await waitFor(() => expect(backend.fetch).toHaveBeenCalledOnce());
  const [path, init] = backend.fetch.mock.calls[0];
  expect(path).toBe("/api/reports");
  expect(JSON.parse(init.body)).toEqual({ requestId: expect.any(String), category, description: "테스트 의견" });
  expect(await screen.findByText(/접수되었습니다/)).toBeDefined();
});
