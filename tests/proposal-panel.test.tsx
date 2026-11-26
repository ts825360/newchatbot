import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProposalPanel } from "../components/proposal-panel";
import { createPreparationStore } from "../lib/preparation-store";

const backend = vi.hoisted(() => ({ connected: false }));
vi.mock("../lib/backend-client", async original => ({
  ...await original<typeof import("../lib/backend-client")>(), isBackendConnected: () => backend.connected,
}));
beforeEach(() => { localStorage.clear(); backend.connected = false; });
afterEach(cleanup);
const room = { id: "test-room", name: "수련회", date: "2026-11-16" };
it("shows real proposals in the private connected panel and never adds them without approval", () => {
  backend.connected = true;
  const scope = { accountId: "test", roomId: room.id, conversationId: "current" };
  const apply = vi.fn(() => true);
  render(<ProposalPanel room={room} scope={scope} onApply={apply} messages={[
    { id: `gemini-${"b".repeat(64)}`, sender: "assistant", text: "[준비 제안] 참가 설문 문항 검토", time: "" },
  ]} />);
  expect(screen.queryByText("샘플 제안")).toBeNull();
  const candidate = screen.getByRole("region", { name: "참가 설문 문항 검토 제안" });
  expect(within(candidate).getByText("[준비 제안] 참가 설문 문항 검토")).toBeDefined();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(within(candidate).getByRole("button", { name: "반영" }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ title: "참가 설문 문항 검토", origin: "assistant" }));
});
it("restores the reviewed title and date after deferral and remount", () => {
  let view = render(<ProposalPanel room={room} onApply={() => true} />);
  const event = screen.getByRole("region", { name: "교회 집합 일정 제안" });
  fireEvent.change(within(event).getByLabelText("반영할 항목"), { target: { value: "새 집합 일정" } });
  fireEvent.change(within(event).getByLabelText("반영할 날짜"), { target: { value: "2026-11-20" } });
  fireEvent.click(within(event).getByRole("button", { name: "보류" }));
  view.unmount(); view = render(<ProposalPanel room={room} onApply={() => true} />);
  const reopened = screen.getByRole("region", { name: "교회 집합 일정 제안" });
  fireEvent.click(within(reopened).getByRole("button", { name: "다시 검토" }));
  expect((within(reopened).getByLabelText("반영할 항목") as HTMLInputElement).value).toBe("새 집합 일정");
  expect((within(reopened).getByLabelText("반영할 날짜") as HTMLInputElement).value).toBe("2026-11-20");
});
it("reviews source and edited values before applying a single sample proposal", () => {
  const apply = vi.fn(() => true);
  render(<ProposalPanel room={room} onApply={apply} />);
  expect(screen.getByText("샘플 제안")).toBeDefined();
  expect(screen.getAllByText("회의록 예시").length).toBe(2);
  const vehicle = screen.getByRole("region", { name: "차량 배정표 작성 제안" });
  fireEvent.change(within(vehicle).getByLabelText("반영할 항목"), { target: { value: "차량 배정 검토" } });
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(within(vehicle).getByRole("button", { name: "반영" }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ title: "차량 배정 검토", kind: "checklist" }));
  expect(within(vehicle).getByText("반영됨")).toBeDefined();
  expect(createPreparationStore(localStorage, room.id).loadDecisions()[0].status).toBe("accepted");
});
it("requires an exclusion reason, supports deferral and reopening, and retains failed apply", () => {
  const apply = vi.fn(() => false);
  render(<ProposalPanel room={room} onApply={apply} />);
  const vehicle = screen.getByRole("region", { name: "차량 배정표 작성 제안" });
  fireEvent.click(within(vehicle).getByRole("button", { name: "제외" }));
  expect(within(vehicle).getByRole("alert").textContent).toContain("사유");
  fireEvent.change(within(vehicle).getByLabelText("제외 사유"), { target: { value: "차량 이동 없음" } });
  fireEvent.click(within(vehicle).getByRole("button", { name: "제외" }));
  expect(within(vehicle).getByText("제외됨")).toBeDefined();
  fireEvent.click(within(vehicle).getByRole("button", { name: "다시 검토" }));
  fireEvent.click(within(vehicle).getByRole("button", { name: "보류" }));
  expect(within(vehicle).getByText("보류됨")).toBeDefined();
  fireEvent.click(within(vehicle).getByRole("button", { name: "다시 검토" }));
  fireEvent.click(within(vehicle).getByRole("button", { name: "반영" }));
  expect(within(vehicle).getByRole("alert").textContent).toContain("저장하지 못했");
  expect(within(vehicle).getByRole("button", { name: "반영" })).toBeDefined();
});

it("shows the calendar draft as a compact approval card with its date, editable title and immediate approval", async () => {
  backend.connected = true;
  const scope = { accountId: "test", roomId: room.id, conversationId: "current" };
  const apply = vi.fn(() => true);
  render(<ProposalPanel room={room} scope={scope} onApply={apply} messages={[{ id: `prep-${"a".repeat(64)}`, sender: "assistant", text: "일정 초안", time: "",
    workProposal: { kind: "calendar", title: "가상 임원회의", date: "2026-11-28", time: "", inferredYear: true } }]} />);
  const card = await screen.findByRole("region", { name: "공동 캘린더 추가 제안" });
  expect(within(card).getByText("토요일")).toBeDefined();
  expect(within(card).getByText(/시간 미정/)).toBeDefined();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(within(card).getByRole("button", { name: "수정" }));
  fireEvent.change(within(card).getByLabelText("일정 제목"), { target: { value: "검토 완료된 회의" } });
  fireEvent.click(within(card).getByRole("button", { name: "승인 및 등록" }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ title: "검토 완료된 회의", date: "2026-11-28" }));
  expect(await within(card).findByText("반영됨")).toBeDefined();
});

it("separates confirmed checklist facts from selectable tasks and approves only the selected entries", async () => {
  backend.connected = true;
  const scope = { accountId: "test", roomId: room.id, conversationId: "current" };
  const apply = vi.fn(() => true);
  render(<ProposalPanel room={room} scope={scope} onApply={apply} messages={[{ id: `prep-${"b".repeat(64)}`, sender: "assistant", text: "준비 점검", time: "",
    workProposal: { kind: "checklist", confirmed: ["대표 숙소 등록"], items: ["최종 참가 인원 확인", "타임테이블 검토"] } }]} />);
  const card = await screen.findByRole("region", { name: "준비 체크리스트 추가 제안" });
  expect(within(card).getByText("대표 숙소 등록")).toBeDefined();
  expect(within(card).queryByRole("checkbox", { name: "대표 숙소 등록" })).toBeNull();
  fireEvent.click(within(card).getByRole("checkbox", { name: "최종 참가 인원 확인" }));
  fireEvent.click(within(card).getByRole("button", { name: "승인 및 반영" }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ checklistItems: [expect.objectContaining({ title: "타임테이블 검토" })] }));
  expect(await within(card).findByText("반영됨")).toBeDefined();
});
