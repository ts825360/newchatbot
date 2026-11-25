import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { TransportConfig } from "../components/transport-config";
import { createTransportDraft, createTransportVehicle, validateTransportInput, type TransportInput } from "../lib/transport";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

it("closes the clock after choosing minutes and keeps focus on the clock button", () => {
  const change = vi.fn<(value: TransportInput) => void>();
  const input = createTransportDraft();
  render(<TransportConfig tab="teams" input={input} onChange={change} selectedVehicleIds={[]} onVehicleSelect={vi.fn()} onVehicleDelete={vi.fn()} onRosterExport={vi.fn()} />);
  const clock = screen.getByRole("button", { name: "본대 출발 시각" });
  fireEvent.click(clock);
  fireEvent.click(screen.getByRole("button", { name: "19시" }));
  fireEvent.click(screen.getByRole("button", { name: "28분" }));
  expect(screen.queryByRole("button", { name: "28분" })).toBeNull();
  expect(document.activeElement).toBe(clock);
  expect(change.mock.calls[0][0].trips.find(t => t.id === "main")?.start).toBe(19 * 60 + 28);
});

it("opens only the main team and deletes an unused trip without leaving invalid references", () => {
  const change = vi.fn<(value: TransportInput) => void>();
  const input = createTransportDraft();
  render(<TransportConfig tab="teams" input={input} onChange={change} selectedVehicleIds={[]} onVehicleSelect={vi.fn()} onVehicleDelete={vi.fn()} onRosterExport={vi.fn()} />);
  expect(screen.getByRole("button", { name: "본대", expanded: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "선발대", expanded: false })).toBeTruthy();
  expect(screen.queryByLabelText("선발대 출발 시각")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "본대 삭제" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "이동편 삭제" })).getByRole("button", { name: "삭제하기" }));
  const next = change.mock.calls[0][0];
  expect(next.trips.find(trip => trip.id === "main")).toBeUndefined();
  expect(next.extraOutboundTripId).toBe("advance");
  expect(validateTransportInput(next, { draft: true })).toEqual([]);
});

it("does not silently detach a vehicle from an in-use trip", () => {
  const input = createTransportDraft();
  input.vehicles = [{ ...createTransportVehicle("car"), tripIds: ["main"] }];
  const change = vi.fn();
  render(<TransportConfig tab="teams" input={input} onChange={change} selectedVehicleIds={[]} onVehicleSelect={vi.fn()} onVehicleDelete={vi.fn()} onRosterExport={vi.fn()} />);
  expect((screen.getByRole("button", { name: "본대 삭제" }) as HTMLButtonElement).disabled).toBe(true);
  expect(change).not.toHaveBeenCalled();
});
