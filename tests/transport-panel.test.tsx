import React from "react";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TransportPanel } from "@/components/transport-panel";
import { createTransportDemo, createTransportDraft, type TransportInput, type TransportResult } from "@/lib/transport";
import * as backend from "@/lib/backend-client";
import { privateToolKey } from "@/lib/conversation-scope";
import { defaultSurveyMapping, parseSurveyCsv, type TransportSurvey } from "@/lib/transport-survey";

function storedFixture(room = "small") {
  const input: TransportInput = { ...createTransportDemo(), people: [{ id: "P1", name: "가상 A", department: "청년부", familyId: "", companionGroup: "", outboundTripId: "main", returnTripId: "normal" }], vehicles: [{ id: "V1", label: "차량 A", capacity: 2, driverId: null, externalDriverConfirmed: true, rental: false, rentalCost: 0, enabled: true, tripIds: ["main", "normal"] }, { id: "V2", label: "차량 B", capacity: 2, driverId: null, externalDriverConfirmed: true, rental: false, rentalCost: 0, enabled: true, tripIds: ["main", "normal"] }] };
  const result: TransportResult = { revision: 1, status: "optimal", assignments: [{ personId: "P1", tripId: "main", vehicleId: "V1" }, { personId: "P1", tripId: "normal", vehicleId: "V1" }], reservations: [], usedVehicleIds: ["V1"], unassignedCount: 0, unreservedCount: 0, cost: 0, message: "최적성 확인" };
  const value = { input, result, baseline: null, approved: false };
  sessionStorage.setItem(`church:transport:v1:${room}`, JSON.stringify(value));
  return value;
}

function loadDemo() {
  fireEvent.click(screen.getByRole("button", { name: "가상 예시 불러오기" }));
  fireEvent.click(screen.getByRole("button", { name: "예시 불러오기" }));
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("vehicle simulation work surface", () => {
  it("prepends each new participant, focuses the name and offers saved departure teams", () => {
    storedFixture();
    render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("tab", { name: "참가자" }));
    fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
    const record = () => JSON.parse(sessionStorage.getItem("church:transport:v1:small")!) as ReturnType<typeof storedFixture>;
    const id = record().input.people[0].id;
    expect(id).not.toBe("P1");
    const name = screen.getByLabelText(`${id} 이름`);
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "테스트 참가자" } });
    fireEvent.blur(name);
    expect(screen.getByLabelText(`${id} 이름`)).toBe(name);
    const team = screen.getByRole("combobox", { name: `${id} 출발` });
    const late = record().input.trips.find(t => t.label === "후발대")!;
    fireEvent.change(team, { target: { value: late.id } });
    expect(record().input.people[0]).toMatchObject({ name: "테스트 참가자", outboundTripId: late.id });
    fireEvent.click(screen.getByRole("button", { name: "참가자 추가" }));
    expect(record().input.people.map(p => p.id).slice(1)).toEqual([id, "P1"]);
  });
  it("shows empty vehicles and the team of a vehicle that runs on a different trip", () => {
    const value = storedFixture();
    const late = value.input.trips.find(t => t.label === "후발대")!;
    value.input.vehicles.push({ ...value.input.vehicles[1], id: "V3", label: "후발 자차", tripIds: [late.id] });
    sessionStorage.setItem("church:transport:v1:small", JSON.stringify(value));
    render(<TransportPanel roomId="small" />);
    expect(screen.getByText("차량 B", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("후발 자차", { selector: "strong" }).closest("article")?.textContent).toContain("후발대");
  });
  it("saves a room assignment without overwriting the preference or revoking vehicle approval", () => {
    const value = storedFixture();
    value.input.people[0].lodging = "가족끼리";
    value.input.people[0].familyId = "F1";
    sessionStorage.setItem("church:transport:v1:small", JSON.stringify({ ...value, approved: true }));
    render(<TransportPanel roomId="small" lodgingView />);
    fireEvent.click(screen.getByRole("button", { name: "객실 수 계산 · 자동 배정" }));
    expect(screen.getByText("가족방 1실")).toBeTruthy();
    const room = screen.getByLabelText("가족방 1 방 번호");
    fireEvent.change(room, { target: { value: "201호" } });
    fireEvent.blur(room);
    expect(JSON.parse(sessionStorage.getItem("church:transport:v1:small")!)).toMatchObject({
      approved: true, input: { revision: value.input.revision, people: [{ lodging: "가족끼리", roomAssignment: "201호" }] },
    });
    fireEvent.click(screen.getByRole("button", { name: "객실 수 계산 · 자동 배정" }));
    expect(screen.getByRole("article", { name: "201호" })).toBeTruthy();
  });
  it("moves focus and switches vehicle tabs using the arrow keys", () => {
    render(<TransportPanel roomId="vehicle-keyboard" />);
    const first = screen.getByRole("tab", { name: "팀 구성" });
    const vehicles = screen.getByRole("tab", { name: "차량" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(vehicles);
    expect(vehicles.getAttribute("aria-selected")).toBe("true");
    expect(first.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel", { name: "차량" })).toBeDefined();
  });
  it("does not restore a deleted default team when loading the saved panel", () => {
    const input = createTransportDraft();
    input.trips = input.trips.filter(trip => trip.id !== "advance");
    sessionStorage.setItem("church:transport:v1:deleted-team", JSON.stringify({ input, result: null, approved: false }));
    render(<TransportPanel roomId="deleted-team" />);
    expect(screen.getByRole("button", { name: "본대" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "선발대" })).toBeNull();
  });
  it("starts with team configuration and sends the user to vehicle entry before importing", () => {
    render(<TransportPanel roomId="new-survey" />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["팀 구성", "차량", "참가자", "배치", "배정안 비교"]);
    expect(screen.getByRole("heading", { name: "출발 팀 구성" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "후발대", expanded: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "폼 불러오기" }));
    expect(screen.getByRole("alert").textContent).toContain("차량을 먼저 입력");
    expect(screen.queryByLabelText("Google Forms 응답 CSV")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "차량 입력" }));
    expect(screen.getByRole("tab", { name: "차량" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    expect(screen.getByLabelText("추가 차량 운전자 이름")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole("columnheader", { name: "배정 가능 좌석" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "폼 불러오기" }));
    expect(screen.getByLabelText("Google Forms 응답 CSV")).toBeTruthy();
  });
  it("shows fictional people and keeps final export blocked before a calculation", () => {
    render(<TransportPanel roomId="room1" />);
    loadDemo();
    expect(screen.getByText("150명")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "폼 불러오기" }));
    expect(screen.getByRole("alert").textContent).toContain("가상 예시에는 실제 설문을 가져올 수 없습니다");
    expect((screen.getByRole("button", { name: "확정 CSV 다운로드" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("can edit vehicle inputs and retain them in the current room", () => {
    const view = render(<TransportPanel roomId="room1" />);
    loadDemo();
    fireEvent.click(screen.getByRole("tab", { name: "차량" }));
    fireEvent.change(screen.getByLabelText("교회 스타렉스 배정 가능 좌석"), { target: { value: "10" } });
    view.unmount(); render(<TransportPanel roomId="room1" />);
    fireEvent.click(screen.getByRole("tab", { name: "차량" }));
    expect((screen.getByLabelText("교회 스타렉스 배정 가능 좌석") as HTMLInputElement).value).toBe("10");
  });
  it("reports calculation failure without presenting a confirmed result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "계산 환경 오류" }) }));
    render(<TransportPanel roomId="room1" />);
    loadDemo();
    fireEvent.click(screen.getByRole("button", { name: "배정 계산" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("계산 환경 오류"));
    expect((screen.getByRole("button", { name: "확정 CSV 다운로드" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("finds the rider, then drag-and-drop opens review and only approval creates a durable lock", () => {
    storedFixture(); render(<TransportPanel roomId="small" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "차량 배정 이름 검색" }), { target: { value: "가상 A" } });
    fireEvent.click(screen.getByRole("button", { name: /가상 A.*본대.*차량 A/ }));
    const rider = document.querySelector<HTMLElement>('[data-person-id="P1"]')!;
    expect(document.activeElement).toBe(rider);
    const car = document.querySelector('[data-vehicle-id="V2"]')!;
    const transfer = { setData: vi.fn(), getData: vi.fn(() => "P1") };
    const drag = () => {
      fireEvent.dragStart(rider, { dataTransfer: transfer });
      fireEvent.dragOver(car, { dataTransfer: transfer });
      expect(car.getAttribute("data-drop")).toBe("active");
      fireEvent.drop(car, { dataTransfer: transfer });
    };
    drag();
    fireEvent.click(screen.getByRole("button", { name: "검토 창 닫기" }));
    expect(JSON.parse(sessionStorage.getItem("church:transport:v1:small")!).input.locks).toEqual([]);
    drag();
    fireEvent.click(screen.getByRole("button", { name: "변경 승인" }));
    const value = JSON.parse(sessionStorage.getItem("church:transport:v1:small")!);
    expect(value.input.locks).toEqual([{ personId: "P1", tripId: "main", vehicleId: "V2" }]);
    expect(value.approved).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "배정안 승인" }));
    fireEvent.click(screen.getByRole("button", { name: "배정안 확정" }));
    expect((screen.getByRole("button", { name: "확정 CSV 다운로드" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("추가 인원"), { target: { value: "1" } });
    expect(screen.getByText("재계산 필요")).toBeTruthy();
    expect((screen.getByRole("button", { name: "확정 CSV 다운로드" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("blocks a capacity-breaking move before approval", () => {
    const value = storedFixture(); value.input.vehicles[1].capacity = 1;
    value.input.people.push({ ...value.input.people[0], id: "P2", name: "가상 B" });
    value.result.assignments.push({ personId: "P2", tripId: "main", vehicleId: "V2" }, { personId: "P2", tripId: "normal", vehicleId: "V2" }); value.result.usedVehicleIds.push("V2");
    sessionStorage.setItem("church:transport:v1:small", JSON.stringify(value));
    render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("button", { name: "가상 A 차량 변경" }));
    fireEvent.change(screen.getByLabelText("옮길 차량"), { target: { value: "V2" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 검토" }));
    expect((screen.getByRole("button", { name: "변경 승인" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("explains which trip is short of requested reserve seats before approval", () => {
    const value = storedFixture();
    value.input.extraCount = 1;
    value.result.reservations = [{ tripId: "main", vehicleId: "V2", count: 1 }];
    value.result.usedVehicleIds = ["V1", "V2"];
    value.result.unreservedCount = 1;
    sessionStorage.setItem("church:transport:v1:small", JSON.stringify(value));
    render(<TransportPanel roomId="small" />);
    expect(screen.getByText(/예상 추가 좌석 부족: 정상 귀가 1석/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "배정안 승인" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not render corrupt reservation rows from stored state", () => {
    const value = storedFixture(); value.result.reservations = [null as never];
    sessionStorage.setItem("church:transport:v1:small", JSON.stringify(value));
    expect(() => render(<TransportPanel roomId="small" />)).not.toThrow();
    expect(screen.getByRole("alert").textContent).toContain("읽지 못했습니다");
  });
  it("compares separately captured results without changing the allocation, and reloads the two summaries", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const value = storedFixture();
    value.input.vehicles[0].rental = true; value.input.vehicles[0].rentalCost = 5000;
    value.input.vehicles[1].rental = true; value.input.vehicles[1].rentalCost = 4000;
    value.result.cost = 5000;
    const key = "church:transport:v1:small";
    sessionStorage.setItem(key, JSON.stringify(value));
    const alternative = { ...value.result, cost: 4000, usedVehicleIds: ["V2"], assignments: value.result.assignments.map(row => ({ ...row, vehicleId: "V2" })) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => alternative }));
    const view = render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("tab", { name: "배정안 비교" }));
    fireEvent.click(screen.getByRole("button", { name: "배정안 A에 담기" }));
    await screen.findByRole("spinbutton", { name: "배정안 A 집합 지점 수" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "배정안 A 집합 지점 수" }), { target: { value: "2" } });
    expect(JSON.parse(sessionStorage.getItem(key)!).result).toEqual(value.result);
    expect(JSON.parse(sessionStorage.getItem(key)!).approved).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "배정 계산" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "배치" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(screen.getByRole("tab", { name: "배정안 비교" }));
    fireEvent.click(screen.getByRole("button", { name: "배정안 B에 담기" }));
    await screen.findByRole("spinbutton", { name: "배정안 B 집합 지점 수" });
    fireEvent.click(screen.getByRole("button", { name: "비용 우선" }));
    expect(screen.getByText("확인된 견적이 낮은 안: 배정안 B")).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(key)!).result).toEqual(alternative);
    view.unmount();
    render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("tab", { name: "배정안 비교" }));
    expect((screen.getByRole("spinbutton", { name: "배정안 A 집합 지점 수" }) as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "배정안 B 제거" }));
    expect(JSON.parse(sessionStorage.getItem(key)!).result).toEqual(alternative);
  });
  it("preserves the comparison when undoing an allocation change", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const value = storedFixture();
    const key = "church:transport:v1:small";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => value.result }));
    render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("button", { name: "배정 계산" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "이전 변경 되돌리기" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("tab", { name: "배정안 비교" }));
    fireEvent.click(screen.getByRole("button", { name: "배정안 A에 담기" }));
    await screen.findByRole("spinbutton", { name: "배정안 A 집합 지점 수" });
    fireEvent.click(screen.getByRole("button", { name: "이전 변경 되돌리기" }));
    expect(JSON.parse(sessionStorage.getItem(key)!).comparison.a).toBeTruthy();
  });
  it("retains unsaved edits and allows an explicit retry", () => {
    storedFixture(); render(<TransportPanel roomId="small" />);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
    fireEvent.change(screen.getByLabelText("추가 인원"), { target: { value: "3" } });
    expect(screen.getByRole("alert").textContent).toContain("저장하지 못했습니다");
    expect((screen.getByLabelText("추가 인원") as HTMLInputElement).value).toBe("3");
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "다시 저장" }));
    expect(JSON.parse(sessionStorage.getItem("church:transport:v1:small")!).input.extraCount).toBe(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not reuse another room's allocation when the room changes", () => {
    storedFixture(); const view = render(<TransportPanel roomId="small" />);
    expect(screen.getByText("1명")).toBeTruthy();
    view.rerender(<TransportPanel roomId="another" />);
    expect(screen.getByRole("heading", { name: "출발 팀 구성" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "배정안 승인" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("filters obsolete replan hints when travel preferences change", async () => {
    const value = storedFixture(); value.input.previousAssignments = value.result.assignments;
    sessionStorage.setItem("church:transport:v1:small", JSON.stringify(value));
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "검증 호출" }) }); vi.stubGlobal("fetch", fetcher);
    render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("tab", { name: "참가자" }));
    fireEvent.change(screen.getByLabelText("P1 출발"), { target: { value: "__independent" } });
    fireEvent.click(screen.getByRole("button", { name: "배정 계산" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.previousAssignments.some((a: { tripId: string }) => a.tripId === "main")).toBe(false);
  });
  it("undo does not make a stale snapshot approvable", () => {
    storedFixture(); render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("tab", { name: "차량" }));
    fireEvent.change(screen.getByLabelText("차량 A 배정 가능 좌석"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("차량 B 배정 가능 좌석"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "이전 변경 되돌리기" }));
    expect(screen.getByText("재계산 필요")).toBeTruthy();
    expect((screen.getByRole("button", { name: "배정안 승인" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("can release a lock independently of a fresh or feasible result", () => {
    const value = storedFixture(); value.input.locks = [{ personId: "P1", tripId: "main", vehicleId: "V1" }]; value.input.revision = 2;
    sessionStorage.setItem("church:transport:v1:small", JSON.stringify(value));
    render(<TransportPanel roomId="small" />);
    fireEvent.click(screen.getByRole("button", { name: "P1 main 잠금 해제" }));
    expect(JSON.parse(sessionStorage.getItem("church:transport:v1:small")!).input.locks).toEqual([]);
  });
  it("saves the configured vehicle and all CSV answers, but calculates with only the attending roster", async () => {
    const view = render(<TransportPanel roomId="survey" />);
    fireEvent.click(screen.getByRole("tab", { name: "차량" }));
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    view.unmount();
    render(<TransportPanel roomId="survey" />);
    fireEvent.click(screen.getByRole("button", { name: "폼 불러오기" }));
    const contents = "참석 여부,이름,소속,출발 팀,이동수단,기타 특이사항\nO,가상 참가,청년부,후발대,버스,가상 메모\nX,가상 불참,,,,불참 응답";
    const file = Object.assign(new File([contents], "survey.csv"), { arrayBuffer: async () => new TextEncoder().encode(contents).buffer });
    fireEvent.change(screen.getByLabelText("Google Forms 응답 CSV"), { target: { files: [file] } });
    await screen.findByText("불참 1건");
    expect(JSON.parse(sessionStorage.getItem("church:transport:v1:survey")!).input.people).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "참석자 반영" }));
    expect(screen.getByText("가져온 설문 응답 · 2건")).toBeTruthy();
    const saved = JSON.parse(sessionStorage.getItem("church:transport:v1:survey")!);
    expect(saved.input.people).toMatchObject([{ name: "가상 참가", outboundTripId: "late", notes: "가상 메모" }]);
    expect(screen.getByDisplayValue("후발대")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByDisplayValue("청년부")).toBeTruthy();
    expect(screen.getByRole("button", { name: "참가자 CSV 내보내기" })).toBeTruthy();
    expect(saved.survey.data.rows[1][5]).toBe("불참 응답");
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "검증 호출" }) });
    vi.stubGlobal("fetch", fetcher);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "배정 계산" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "차량" }));
    fireEvent.change(screen.getByLabelText("1번 차종"), { target: { value: "car-5" } });
    fireEvent.change(screen.getByLabelText("승용차 배정 가능 좌석"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("승용차 후발대 가용"));
    fireEvent.click(screen.getByLabelText("승용차 정상 귀가 가용"));
    fireEvent.click(screen.getByLabelText("승용차 외부 운전자 확정"));
    fireEvent.click(screen.getByRole("button", { name: "배정 계산" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.people).toHaveLength(1);
    expect(body.people[0].notes).toBeUndefined();
    expect(body.survey).toBeUndefined();
  });

  it("keeps a survey preview while registering its first vehicle", async () => {
    render(<TransportPanel roomId="survey-shortcut" surveyShortcut={1} />);
    fireEvent.click(screen.getByRole("button", { name: "CSV 파일" }));
    const contents = "참석 여부,이름,소속\nO,가상 참가,청년부";
    const file = Object.assign(new File([contents], "survey.csv"), { arrayBuffer: async () => new TextEncoder().encode(contents).buffer });
    fireEvent.change(screen.getByLabelText("Google Forms 응답 CSV"), { target: { files: [file] } });
    const apply = await screen.findByRole<HTMLButtonElement>("button", { name: "참석자 반영" });
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "차량 등록" }));
    fireEvent.click(screen.getByRole("button", { name: "차량 추가" }));
    fireEvent.click(screen.getByRole("tab", { name: "참가자" }));
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(screen.getByText("가져온 설문 응답 · 1건")).toBeTruthy();
  });

  it("keeps approvals on a Google survey refresh and keeps locks when adding new people", async () => {
    const scope = { accountId: "account", roomId: "small", conversationId: "conversation" };
    const key = privateToolKey(scope, "transport");
    const { input, result } = storedFixture();
    const existingId = `GF-${"a".repeat(44)}`, newId = `GF-${"b".repeat(44)}`;
    input.people[0].id = existingId;
    result.assignments.forEach((a) => { a.personId = existingId; });
    input.locks = [result.assignments[0]];
    const survey = (csv: string, personIds: string[]): TransportSurvey => {
      const data = parseSurveyCsv(`참석 여부,이름,소속\n${csv}`);
      return { data, mapping: defaultSurveyMapping(data.headers), source: { formId: "test-form", personIds } };
    };
    const previous = survey("O,가상 A,청년부", [existingId]);
    const refresh = survey("O,수정된 응답,청년부", [existingId]);
    const appended = survey("O,수정된 응답,청년부\nO,가상 B,청년부", [existingId, newId]);
    sessionStorage.setItem(key, JSON.stringify({ input, result, baseline: result, approved: true, survey: previous }));
    let response = refresh;
    vi.spyOn(backend, "isBackendConnected").mockReturnValue(true);
    vi.spyOn(backend, "backendFetch").mockImplementation(async (_path, init) => !init ? { configured: true, connected: true } : response);
    render(<TransportPanel roomId="small" scope={scope} />);

    const click = async (button: HTMLElement) => { await act(async () => { fireEvent.click(button); }); };
    const preview = async () => {
      await click(screen.getByRole("button", { name: "폼 불러오기" }));
      const button = await screen.findByRole("button", { name: "응답 미리보기" });
      expect(screen.getByLabelText<HTMLInputElement>("구글폼 편집 주소").value).toContain("test-form");
      await click(button);
    };
    const saved = () => JSON.parse(sessionStorage.getItem(key)!);
    await preview();
    expect(await screen.findByText(/이미 반영됨 · 응답 변경/)).toBeTruthy();
    await click(screen.getByRole("button", { name: "설문 응답 저장" }));
    expect(saved()).toMatchObject({ input, result, baseline: result, approved: true, survey: refresh });

    response = appended;
    await preview();
    await click(await screen.findByRole("button", { name: "신규 참석자 추가" }));
    expect(saved()).toMatchObject({ input: { revision: 2, locks: input.locks }, result, baseline: result, approved: false, survey: appended });
    expect(saved().input.people.map(({ id }: { id: string }) => id)).toEqual([existingId, newId]);
    expect(screen.getByText("재계산 필요")).toBeTruthy();
  });
});
