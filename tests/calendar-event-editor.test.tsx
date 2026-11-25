import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CalendarEventEditor } from "../components/calendar-event-editor";
import { createInitialState } from "../lib/prototype-state";

afterEach(cleanup);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

it("shows native start and end controls, the automatic duration, and only three statuses", () => {
  const { events, rooms } = createInitialState();
  const value = { ...events[rooms[0].id][0], time: "오후 7:05" };
  const change = vi.fn();
  render(<CalendarEventEditor value={value} editing={false} error="" onChange={change} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
  const input = screen.getByLabelText<HTMLInputElement>("시작 시간");
  expect(input.type).toBe("time");
  expect(input.value).toBe("19:05");
  expect(screen.getByLabelText<HTMLInputElement>("종료 시간").type).toBe("time");
  expect(screen.getByText("자동 적용: 19:05 ~ 20:05")).toBeDefined();
  expect(Array.from(screen.getByLabelText<HTMLSelectElement>("일정 상태").options, option => option.text)).toEqual(["확정", "보류", "기타"]);
  fireEvent.change(input,{target:{value:""}});
  expect(change).toHaveBeenCalledWith({...value,time:""});
  expect(screen.queryByLabelText("링크 이름")).toBeNull();
  expect(screen.queryByLabelText("하이퍼링크")).toBeNull();
});

it("opens a read-only detail view for someone without edit access", () => {
  const { events, rooms } = createInitialState();
  render(<CalendarEventEditor value={events[rooms[0].id][0]} editing={true} readOnly error="" onChange={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "일정 상세" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("일정 제목").readOnly).toBe(true);
});
