import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceOverview } from "@/components/workspace-overview";
import type { CalendarEvent } from "@/lib/types";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps the next event visible even after two timed events earlier today have ended", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T06:30:00Z"));
  const event = (id: string, title: string, time: string, endTime?: string): CalendarEvent => ({
    id, title, date: "2026-11-22", time, endTime, location: "", memo: "", status: "confirmed",
    author: "가상", lastEditor: "가상", changeLog: "",
  });
  render(<WorkspaceOverview event={{ name: "가상 행사", period: "2026.11.22", status: "진행 중" }} scope={null} calendar={{ state: "ready", items: [
    event("early", "오전 일정", "09:00", "10:00"), event("noon", "점심 일정", "12:00"),
    event("current", "진행 중인 일정", "15:00", "16:00"), event("next", "저녁 일정", "19:00"),
  ] }} onCalendar={vi.fn()} onEvent={vi.fn()} />);
  expect(screen.queryByText("오전 일정")).toBeNull();
  expect(screen.queryByText("점심 일정")).toBeNull();
  expect(screen.getByText("진행 중인 일정")).toBeDefined();
  expect(screen.getByText("저녁 일정")).toBeDefined();
});
