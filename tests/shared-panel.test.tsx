import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { SharedPanel } from "../components/shared-panel";
import { createInitialState } from "../lib/prototype-state";

afterEach(cleanup);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

it("opens a complete picker for all events on the same day", () => {
  const initial = createInitialState();
  const events = Array.from({ length: 6 }, (_, i) => ({ ...initial.events[initial.rooms[0].id][0], id: `event-${i}`, title: `별도 일정 ${i + 1}`, date: "2026-11-16" }));
  const open = vi.fn();
  render(<SharedPanel mode="calendar" room={{ ...initial.rooms[0], date: "2026-11-16" }} events={events} checklist={[]} risks={[]} onOpenEvent={open} onAddEvent={vi.fn()} onToggleChecklist={vi.fn()} onOpenChecklist={vi.fn()} onResolveRisk={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "2026-11-16 일정 보기" }));
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /별도 일정 6/ }));
  expect(open).toHaveBeenCalledWith("event-5");
});

it("shows room period from room metadata without moving individual events", () => {
  const initial = createInitialState();
  render(<SharedPanel mode="calendar" room={{ ...initial.rooms[0], date: "2026-11-16", endDate: "2026-11-18", dateLabel: "2026.11.16 ~ 2026.11.18" }} events={[]} checklist={[]} risks={[]} onOpenEvent={vi.fn()} onAddEvent={vi.fn()} onToggleChecklist={vi.fn()} onOpenChecklist={vi.fn()} onResolveRisk={vi.fn()} />);
  expect(screen.getByText("행사 기간 2026.11.16 ~ 2026.11.18")).toBeDefined();
  expect(screen.getAllByText("행사일")).toHaveLength(3);
});

it("keeps an explicit add-event action when only the calendar is shown", () => {
  const initial = createInitialState();
  const add = vi.fn();
  render(<SharedPanel mode="calendar" room={initial.rooms[0]} events={[]} checklist={[]} risks={[]} onOpenEvent={vi.fn()} onAddEvent={add} onToggleChecklist={vi.fn()} onOpenChecklist={vi.fn()} onResolveRisk={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
  expect(add).toHaveBeenCalled();
});

it("lets users open an older event to edit from the full room list regardless of the displayed month", () => {
  const initial = createInitialState();
  const events = [{ ...initial.events[initial.rooms[0].id][0], id: "old-event", title: "이전 회의", date: "2026-11-20", status: "needsReview" as const }];
  const open = vi.fn();
  render(<SharedPanel mode="calendar" room={{ ...initial.rooms[0], date: "2026-12-16" }} events={events} checklist={[]} risks={[]} onOpenEvent={open} onAddEvent={vi.fn()} onToggleChecklist={vi.fn()} onOpenChecklist={vi.fn()} onResolveRisk={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "일정 목록" }));
  const list = within(screen.getByRole("dialog", { name: "일정 목록" }));
  expect(list.getByText("보류")).toBeDefined();
  fireEvent.click(list.getByRole("button", { name: /이전 회의/ }));
  expect(open).toHaveBeenCalledWith("old-event");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("refreshes server data without resetting the displayed month and announces completion", async () => {
  const initial = createInitialState();
  let complete!: () => void;
  const refresh = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  render(<SharedPanel mode="calendar" room={{ ...initial.rooms[0], date: "2026-11-16" }} events={[]} checklist={[]} risks={[]} onOpenEvent={vi.fn()} onAddEvent={vi.fn()} onToggleChecklist={vi.fn()} onOpenChecklist={vi.fn()} onResolveRisk={vi.fn()} onRefreshCalendar={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  fireEvent.click(screen.getByRole("button", { name: "캘린더 새로고침" }));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toBe("새로고침 중");
  await act(async () => complete());
  expect(screen.getByRole("status").textContent).toBe("새로고침됨");
  expect(screen.getByLabelText<HTMLInputElement>("년도와 달 선택").value).toBe("2026-12");
});

it("edits by title and sends the separate checklist action to the draft handler", () => {
  const initial = createInitialState();
  const open = vi.fn();
  const add = vi.fn();
  const item = initial.checklists[initial.rooms[0].id][0];
  const ask = vi.fn(), toggle = vi.fn();
  render(<SharedPanel mode="prepare" room={initial.rooms[0]} events={[]} checklist={[item]} risks={[]} onOpenEvent={vi.fn()} onAddEvent={vi.fn()} onToggleChecklist={toggle} onOpenChecklist={open} onAddChecklist={add} onAskChecklist={ask} onResolveRisk={vi.fn()} />);
  fireEvent.click(within(screen.getByRole("region", { name: "준비 체크리스트" })).getByText(item.title, { exact: true }).closest("button")!);
  expect(open).toHaveBeenCalledWith(item.id);
  fireEvent.click(screen.getByRole("button", { name: `${item.title} AI 작업 요청` }));
  expect(ask).toHaveBeenCalledWith(item);
  expect(open).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: `${item.title} 상태 변경` }));
  expect(toggle).toHaveBeenCalledWith(item.id);
  fireEvent.click(screen.getByRole("button", { name: "준비 항목 추가" }));
  expect(add).toHaveBeenCalled();
});

it("shows checklist details without mutation controls in read-only mode", () => {
  const initial = createInitialState();
  const item = initial.checklists[initial.rooms[0].id][0];
  render(<SharedPanel mode="prepare" room={initial.rooms[0]} events={[]} checklist={[item]} risks={initial.risks[initial.rooms[0].id]}
    canEditChecklist={false} onOpenEvent={vi.fn()} onToggleChecklist={vi.fn()} onOpenChecklist={vi.fn()} onAddChecklist={vi.fn()} onResolveRisk={vi.fn()} />);
  expect(within(screen.getByRole("region", { name: "준비 체크리스트" })).getByText(item.title, { exact: true })).toBeDefined();
  expect(screen.queryByRole("button", { name: `${item.title} 상태 변경` })).toBeNull();
  expect(screen.queryByRole("button", { name: `${item.title} 수정` })).toBeNull();
  expect(screen.queryByRole("button", { name: "준비 항목 추가" })).toBeNull();
  expect(screen.queryByRole("button", { name: "완료 처리" })).toBeNull();
});

it("distinguishes unreviewed risks from recorded warnings without showing recent shared changes", () => {
  const { rooms } = createInitialState();
  const props = { mode: "prepare" as const, room: rooms[0], events: [], checklist: [], risks: [], onOpenEvent: vi.fn(), onToggleChecklist: vi.fn(), onOpenChecklist: vi.fn(), onResolveRisk: vi.fn() };
  const view = render(<SharedPanel {...props} />);
  expect(screen.getByText("미검토", { exact: true })).toBeDefined();
  expect(screen.queryByText("정상", { exact: true })).toBeNull();
  expect(screen.queryByText("최근 공동 변경", { exact: true })).toBeNull();
  view.rerender(<SharedPanel {...props} risks={[{ id: "1", title: "차량 점검", detail: "운전자 확인", action: "확인", resolved: false }]} />);
  expect(screen.getByText("차량 점검", { exact: true })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "완료 처리" }));
  expect(props.onResolveRisk).toHaveBeenCalledWith("1");
});
