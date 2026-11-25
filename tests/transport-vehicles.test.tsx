import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportPanel } from "@/components/transport-panel";
import { createTransportDraft, type TransportInput, type TransportVehicle } from "@/lib/transport";
import { privateToolKey } from "@/lib/conversation-scope";

const storageKey = "church:transport:v1:vehicles";
const registered = (id: string, label: string): TransportVehicle => ({
  id, label, capacity: 2, driverId: null, externalDriverConfirmed: true, rental: false, rentalCost: 0, enabled: true, tripIds: ["main", "normal"],
});
const saved = () => JSON.parse(sessionStorage.getItem(storageKey)!) as { input: TransportInput };
const showVehicles = () => fireEvent.click(screen.getByRole("tab", { name: "차량" }));
const vehicleName = (row = 1) => screen.getByLabelText<HTMLInputElement>(`${row}번 차량 이름`);
const vehicleType = (row = 1) => screen.getByLabelText<HTMLSelectElement>(`${row}번 차종`);
const chooseType = (value: string) => fireEvent.change(vehicleType(), { target: { value } });
const rename = (field: HTMLInputElement, value: string) => {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe("vehicle registration", () => {
  it("starts unchecked and keeps allocatable seats blank without blocking the import flow", () => {
    const view = render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    const row = vehicleName().closest("tr")!;
    expect(within(row).getAllByRole<HTMLInputElement>("checkbox").every((checkbox) => !checkbox.checked)).toBe(true);
    expect(screen.queryByRole("columnheader", { name: "사용" })).toBeNull();
    expect(saved().input.vehicles[0]).toMatchObject({ tripIds: [], rental: false, externalDriverConfirmed: false, enabled: true });
    view.unmount();
    render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    expect(screen.getByLabelText<HTMLInputElement>("추가 차량 배정 가능 좌석").value).toBe("");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "배정 계산" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "폼 불러오기" }));
    expect(screen.getByLabelText("Google Forms 응답 CSV")).toBeTruthy();
  });

  it("sets only total seats from presets and preserves the entered allocation limit after reload", () => {
    const view = render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    const name = vehicleName();
    expect(name.type).toBe("text");
    expect(name.list).toBeNull();
    expect(vehicleType().value).toBe("");
    const allTypes = ["", "small-bus", "mid-bus", "large-bus", "starex-9", "starex-11", "starex-12", "car-5", "custom"];
    expect([...vehicleType().options].map((option) => option.value)).toEqual(allTypes);
    chooseType("starex-12");
    expect(screen.getByLabelText<HTMLInputElement>("스타렉스 12인승 총 좌석").value).toBe("12");
    expect(screen.getByLabelText<HTMLInputElement>("스타렉스 12인승 배정 가능 좌석").value).toBe("");
    fireEvent.change(screen.getByLabelText("스타렉스 12인승 배정 가능 좌석"), { target: { value: "9" } });
    fireEvent.click(screen.getByLabelText("스타렉스 12인승 후발대 가용"));
    expect([...vehicleType().options].map((option) => option.value)).toEqual(allTypes);
    chooseType("car-5");
    expect(screen.getByLabelText("승용차 배정 가능 좌석").getAttribute("aria-invalid")).toBe("true");
    view.unmount();
    render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    expect(vehicleName().value).toBe("승용차");
    expect(screen.getByLabelText<HTMLInputElement>("승용차 총 좌석").value).toBe("5");
    expect(screen.getByLabelText<HTMLInputElement>("승용차 배정 가능 좌석").value).toBe("9");
    expect(screen.getByLabelText<HTMLInputElement>("승용차 후발대 가용").checked).toBe(true);
    fireEvent.change(screen.getByLabelText("승용차 총 좌석"), { target: { value: "10" } });
    fireEvent.blur(vehicleName());
    expect(saved().input.vehicles[0]).toMatchObject({ totalSeats: 10, capacity: 9 });
    expect(vehicleType().value).toBe("car-5");
    chooseType("large-bus");
    expect(saved().input.vehicles[0]).toMatchObject({ totalSeats: 45, capacity: 9 });
  });

  it("preserves a named vehicle when the type is changed and can override the preset seats", () => {
    render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    rename(vehicleName(), "교회 차량 A");
    chooseType("small-bus");
    expect(vehicleName().value).toBe("교회 차량 A");
    expect(screen.getByLabelText<HTMLInputElement>("교회 차량 A 총 좌석").value).toBe("25");
    fireEvent.change(screen.getByLabelText("교회 차량 A 총 좌석"), { target: { value: "23" } });
    chooseType("custom");
    expect(saved().input.vehicles[0]).toMatchObject({ label: "교회 차량 A", vehicleType: "custom", totalSeats: 23 });
  });

  it("accepts a typed name without taking a preset's seat count from a partial match", () => {
    render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    fireEvent.change(screen.getByLabelText("추가 차량 총 좌석"), { target: { value: "7" } });
    fireEvent.change(vehicleName(), { target: { value: "승용차" } });
    rename(vehicleName(), "승용차 A · 기관 차량");
    expect(vehicleName().value).toBe("승용차 A · 기관 차량");
    expect(saved().input.vehicles[0]).toMatchObject({ label: "승용차 A · 기관 차량", totalSeats: 7, capacity: 0 });
  });

  it("shows the preset for an old default name without rewriting rows or seat limits", () => {
    const input = createTransportDraft();
    input.vehicles.push(
      { ...registered("V1", "추가 차량"), vehicleType: "car-5", totalSeats: 7 },
      { ...registered("V2", "교회 스타렉스"), vehicleType: "starex-12", totalSeats: 10 },
      registered("V3", "기존 차량"),
    );
    sessionStorage.setItem(storageKey, JSON.stringify({ input, result: null, baseline: null, approved: false }));
    render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    expect(vehicleName().value).toBe("승용차");
    expect(vehicleName(2).value).toBe("교회 스타렉스");
    expect(vehicleName(3).value).toBe("기존 차량");
    expect(screen.getByLabelText<HTMLInputElement>("승용차 총 좌석").value).toBe("7");
    fireEvent.blur(vehicleName());
    expect(saved().input.vehicles).toEqual(input.vehicles);
    rename(vehicleName(3), "현장 차량");
    expect(saved().input.vehicles[2]).toEqual({ ...input.vehicles[2], label: "현장 차량" });
  });

  it("confirms bulk removal without deleting a referenced vehicle or dropping its lock", () => {
    const input = createTransportDraft();
    input.people.push({ id: "P1", name: "가상 참가", department: "청년부", familyId: "", companionGroup: "", outboundTripId: "main", returnTripId: "normal" });
    input.vehicles.push(registered("V1", "차량 A"), registered("V2", "차량 B"), registered("V3", "차량 C"));
    input.locks = [{ personId: "P1", tripId: "main", vehicleId: "V1" }];
    input.previousAssignments = [{ personId: "P1", tripId: "normal", vehicleId: "V2" }];
    sessionStorage.setItem(storageKey, JSON.stringify({ input, result: null, baseline: null, approved: false }));
    render(<TransportPanel roomId="vehicles" />);
    showVehicles();
    const remove = () => fireEvent.click(screen.getByRole("button", { name: "선택 차량 삭제" }));
    fireEvent.click(screen.getByLabelText("차량 A 선택"));
    fireEvent.click(screen.getByLabelText("차량 B 선택"));
    remove();
    let dialog = screen.getByRole("dialog", { name: "선택 차량 삭제" });
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "삭제 확정" }).disabled).toBe(true);
    expect(within(dialog).getByText(/잠금을 먼저 해제/)).toBeTruthy();
    expect(saved().input.vehicles).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "검토 창 닫기" }));
    fireEvent.click(screen.getByLabelText("차량 A 선택"));
    fireEvent.click(screen.getByLabelText("차량 C 선택"));
    remove();
    dialog = screen.getByRole("dialog", { name: "선택 차량 삭제" });
    fireEvent.click(within(dialog).getByRole("button", { name: "검토 창 닫기" }));
    expect(saved().input.vehicles).toHaveLength(3);
    remove();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제 확정" }));
    expect(saved().input.vehicles.map((vehicle) => vehicle.id)).toEqual(["V1"]);
    expect(saved().input.locks).toEqual(input.locks);
    expect(saved().input.previousAssignments).toEqual([]);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "선택 차량 삭제" }).disabled).toBe(true);
  });

  it("keeps conversation storage scoped without exposing the header note", () => {
    const scope = { roomId: "vehicles", accountId: "account", conversationId: "conversation" };
    render(<TransportPanel roomId="vehicles" scope={scope} />);
    expect(screen.queryByText("이 대화에만 저장")).toBeNull();
    showVehicles();
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    expect(sessionStorage.getItem(privateToolKey(scope, "transport"))).not.toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
});
