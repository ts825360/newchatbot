import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProposalPanel } from "../components/proposal-panel";
import { ChatWorkCard } from "../components/chat-work-card";
import { createPreparationStore } from "../lib/preparation-store";
import type { ChatMessage } from "../lib/types";

const backend = vi.hoisted(() => ({ connected: false }));
vi.mock("../lib/backend-client", async original => ({
  ...await original<typeof import("../lib/backend-client")>(), isBackendConnected: () => backend.connected,
}));
beforeEach(() => { localStorage.clear(); backend.connected = false; });
afterEach(cleanup);
const room = { id: "test-room", name: "수련회", date: "2026-11-16" };
const reviewScope = { accountId: "test", roomId: room.id, conversationId: "current" };
const reviewMessages: ChatMessage[] = [
  { id: `prep-${"1".repeat(64)}`, sender: "assistant", time: "", text: "행사 날짜를 기준으로 일정을 구성했습니다.",
    advisor: { kind: "plan", title: "일정 계획", rows: [{ label: "집합 조건", detail: "오전 집합" }], rationale: "이동 시간을 확보합니다.", proposals: [] },
    workProposal: { kind: "calendar", title: "가상 집합 일정", date: "2026-11-16", time: "09:00", inferredYear: false } },
  { id: `prep-${"2".repeat(64)}`, sender: "assistant", time: "", text: "준비 점검입니다.",
    workProposal: { kind: "checklist", confirmed: [], items: ["차량 확인"] } },
  { id: `prep-${"3".repeat(64)}`, sender: "assistant", time: "", text: "시간표를 제안합니다.",
    workProposal: { kind: "timetable", plan: { version: 1, days: 3, startDate: "2026-11-16",
      entries: [{ id: "last", day: 3, start: 540, end: 600, kind: "program", title: "마지막 날 프로그램" }] } } },
  { id: `prep-${"4".repeat(64)}`, sender: "assistant", time: "", text: "설문을 제안합니다.",
    workProposal: { kind: "survey", title: "가상 참가자 설문" } },
];

it("keeps proposal order and exposes wide survey and timetable cards to the review grid", () => {
  backend.connected = true;
  const { container } = render(<ProposalPanel room={room} scope={reviewScope} onApply={() => true} messages={reviewMessages} />);
  const grid = container.querySelector(".proposal-grid");
  expect(Array.from(grid?.children ?? []).map(card => card.getAttribute("data-proposal-span"))).toEqual(["full", "full", null, null]);
  const survey = screen.getByRole("region", { name: "수련회 설문 미리보기" });
  expect(within(survey).getByText("가상 참가자 설문")).toBeDefined();
  expect(within(survey).getByText("Google Forms", { exact: false, selector: ".proposal-destination" })).toBeDefined();
  const timetable = screen.getByRole("region", { name: "타임테이블 추가 제안" });
  const finalDay = within(timetable).getByText(/3일차/).closest("details");
  expect(finalDay?.open).toBe(false);
  expect(finalDay?.textContent).toContain("마지막 날 프로그램");
});

it("keeps the detailed AI answer and evidence collapsed without hiding the target or core proposal", () => {
  backend.connected = true;
  render(<ProposalPanel room={room} scope={reviewScope} onApply={() => true} messages={reviewMessages.slice(0, 1)} />);
  const card = screen.getByRole("region", { name: "공동 캘린더 추가 제안" });
  expect(within(card).getByRole("heading", { name: "가상 집합 일정" })).toBeDefined();
  expect(within(card).getByText("반영 위치: 공동 캘린더")).toBeDefined();
  expect(within(card).getByText("승인 대기")).toBeDefined();
  const answer = within(card).getByText("상세 AI 답변").closest("details");
  expect(answer?.open).toBe(false);
  expect(answer?.textContent).toContain(reviewMessages[0].text);
  expect(answer?.textContent).toContain("오전 집합");
  expect(answer?.textContent).toContain("이동 시간을 확보합니다.");
});

it("only presents review metadata in the proposal panel, not in inline chat cards", () => {
  backend.connected = true;
  render(<ChatWorkCard scope={reviewScope} message={reviewMessages[0]} onApply={() => true} />);
  expect(screen.queryByText("상세 AI 답변")).toBeNull();
  expect(screen.getByText("공동 캘린더 · 일정 추가 제안")).toBeDefined();
});

it("preserves read-only access to proposal content and the target without enabling approval", () => {
  backend.connected = true;
  const apply = vi.fn(() => true);
  render(<ProposalPanel room={room} scope={reviewScope} onApply={apply} messages={reviewMessages.slice(1, 2)} canApprove={() => false} />);
  const card = screen.getByRole("region", { name: "준비 체크리스트 추가 제안" });
  expect(within(card).getByText("반영 위치: 이 대화의 체크리스트")).toBeDefined();
  expect(within(card).getByText("이 제안을 반영할 권한이 없습니다.")).toBeDefined();
  expect((within(card).getByRole("checkbox", { name: "차량 확인" }) as HTMLInputElement).disabled).toBe(true);
  expect(within(card).queryByRole("button", { name: /승인|거절/ })).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});

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
