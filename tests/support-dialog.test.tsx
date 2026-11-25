import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { SupportButton } from "../components/support-dialog";

const backend = vi.hoisted(() => ({ fetch: vi.fn(), connected: true }));
vi.mock("@/lib/backend-client", () => ({ backendFetch: backend.fetch, isBackendConnected: () => backend.connected }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => { backend.fetch.mockReset(); backend.connected = true; });
afterEach(cleanup);

const renderSupport = () => render(<SupportButton screenName="작업 화면" roomName="수련회" />);
const report = () => fireEvent.click(screen.getByRole("button", { name: "문제 신고" }));
const fill = (description: string) => fireEvent.change(screen.getByLabelText("어떤 문제가 있었나요?"), { target: { value: description } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "신고 접수" }));

it("opens help and the red report control independently, without reading report history", () => {
  renderSupport();
  fireEvent.click(screen.getByRole("button", { name: "도움말" }));
  expect(screen.getByRole("heading", { name: "사용설명서" })).toBeDefined();
  expect(screen.getByText("설문과 차량 배정")).toBeDefined();
  expect(screen.queryByLabelText("어떤 문제가 있었나요?")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.getByRole("button", { name: "문제 신고" }).classList.contains("report-open")).toBe(true);
  report();
  expect(screen.queryByText(/저장한 신고/)).toBeNull();
  expect(backend.fetch).not.toHaveBeenCalled();
});

it("lists the supported file formats and server quota under materials help", () => {
  renderSupport();
  fireEvent.click(screen.getByRole("button", { name: "도움말" }));
  const topic = screen.getByText("자료 관리");
  fireEvent.click(topic);
  const help = within(topic.closest("details")!);
  expect(help.getByText(/^미리보기:.*PDF.*DOCX.*JPEG/)).toBeDefined();
  expect(help.getByText(/^다운로드 전용:.*HWP.*XLSX/)).toBeDefined();
  expect(help.getByText(/내 계정.*1,000개.*100 MiB/)).toBeDefined();
});

it("submits only the description and issue type by default and distinguishes mail configuration from receipt", async () => {
  backend.fetch.mockResolvedValue({ notification: "unconfigured" });
  renderSupport(); report(); submit();
  expect(screen.getByRole("alert").textContent).toContain("내용");
  fill("자료 버튼 오류"); submit();
  await screen.findByText("신고가 접수되었습니다.");
  expect(screen.getByText(/메일 알림은 아직 설정되지 않았습니다/)).toBeDefined();
  const [path, init] = backend.fetch.mock.calls[0];
  expect(path).toBe("/api/reports");
  expect(JSON.parse(init.body)).toEqual({ requestId: expect.any(String), category: "screen", description: "자료 버튼 오류" });
  expect(screen.queryByText("자료 버튼 오류")).toBeNull();
});

it("retains the draft and retry id on failure, and includes only opted-in screen info", async () => {
  backend.fetch.mockRejectedValueOnce(Error("연결에 실패했습니다.")).mockResolvedValue({ notification: "queued" });
  renderSupport(); report(); fill("일정 표시 오류"); fireEvent.click(screen.getByLabelText("화면 정보 포함")); submit();
  await screen.findByText("연결에 실패했습니다.");
  expect((screen.getByLabelText("어떤 문제가 있었나요?") as HTMLTextAreaElement).value).toBe("일정 표시 오류");
  submit(); await screen.findByText("신고가 접수되었습니다.");
  const body = JSON.parse(backend.fetch.mock.calls[1][1].body);
  expect(body).toEqual(JSON.parse(backend.fetch.mock.calls[0][1].body));
  expect(body.context).toMatchObject({ screenName: "작업 화면", roomName: "수련회" });
});
