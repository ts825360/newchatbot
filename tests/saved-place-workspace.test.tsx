import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationLocation } from "../components/conversation-location";
import { appendConversationPlace, conversationPlaceDetails, isConversationPlaceRecord } from "../lib/conversation-places";
import { privateToolKey } from "../lib/conversation-scope";

const scope = { accountId: "test-owner", roomId: "test-room", conversationId: "test-thread" };
const key = privateToolKey(scope, "location");
const places = Array.from({ length: 10 }, (_, index) => `가상 장소 ${index + 1}`);
const name = places[0];
const address = "가상시 공용도로 10";
const notes = "기존 안내 (비공개)";
const memo = "다음 행사에서는 단체석 확인";
const savedMemo = { text: memo, authorId: scope.accountId, updatedAt: "2026-11-27T00:00:00.000Z" };
const fixture = {
  location: name, places,
  details: [{ name, address, notes }],
  placeMetadata: [{ name, category: "cafe", privateMemo: savedMemo }, { name: places[1], category: "lodging" }],
};
const seed = (value: unknown = fixture) => localStorage.setItem(key, JSON.stringify(value));
const read = () => JSON.parse(localStorage.getItem(key)!);
const view = (mode = "docked", current = scope) => <aside data-size={mode}><ConversationLocation scope={current} /></aside>;
const detail = () => within(screen.getByRole("region", { name: "행사 장소" }));
const currentName = (place: string) => detail().getByRole("heading", { name: place });

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("keeps optional metadata on later appends and keeps it out of the legacy details projection", () => {
  expect(isConversationPlaceRecord({ location: name })).toBe(true);
  expect(isConversationPlaceRecord(fixture)).toBe(true);
  expect(isConversationPlaceRecord({ ...fixture, placeMetadata: [{ name: "unknown", category: "cafe" }] })).toBe(false);
  expect(isConversationPlaceRecord({ ...fixture, placeMetadata: [{ name, category: "provider-type" }] })).toBe(false);
  expect(isConversationPlaceRecord({ ...fixture, placeMetadata: [{ name, privateMemo: { ...savedMemo, updatedAt: "invalid" } }] })).toBe(false);
  expect(appendConversationPlace(fixture, "새 장소")).toEqual({ ...fixture, places: [...places, "새 장소"] });
  expect(conversationPlaceDetails(name, fixture.details)).toEqual({ address, notes });
});

it("cycles a 10-place docked panel with arrows and swipe, and jumps directly by name", () => {
  seed();
  render(view());
  const position = () => screen.getByRole("status", { name: "장소 위치" }).textContent;
  expect(currentName(name)).toBeTruthy();
  expect(position()).toBe("1 / 10");
  fireEvent.click(screen.getByRole("button", { name: "다음 장소" }));
  expect(currentName(places[1])).toBeTruthy();
  const card = screen.getByRole("region", { name: "행사 장소" });
  fireEvent.touchStart(card, { touches: [{ clientX: 160, clientY: 60 }] });
  fireEvent.touchEnd(card, { changedTouches: [{ clientX: 60, clientY: 62 }] });
  expect(position()).toBe("3 / 10");
  fireEvent.click(screen.getByRole("button", { name: "이전 장소" }));
  expect(position()).toBe("2 / 10");
  fireEvent.click(screen.getByText("장소 목록", { exact: true }));
  const jump = within(screen.getByRole("list", { name: "저장한 장소" }));
  expect(jump.getByRole("button", { name: places[1] }).getAttribute("aria-current")).toBe("true");
  fireEvent.click(jump.getByRole("button", { name: places[9] }));
  expect(currentName(places[9])).toBeTruthy();
  expect(position()).toBe("10 / 10");
});

it("filters the expanded cards by stored category and address, keeping browsing state when detail and mode change", async () => {
  seed();
  const workspace = render(view("expanded"));
  const count = () => within(screen.getByRole("list", { name: "저장한 장소 카드" })).getAllByRole("listitem").length;
  expect(count()).toBe(10);
  fireEvent.change(screen.getByLabelText("장소 분류 필터"), { target: { value: "cafe" } });
  fireEvent.change(screen.getByRole("searchbox", { name: "저장한 장소 검색" }), { target: { value: "공용도로" } });
  expect(count()).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: `${name} 상세 보기` }));
  expect(within(screen.getByRole("dialog", { name: "장소 상세" })).getByText(memo, { selector: ".location-memo p" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "장소 상세 닫기" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  workspace.rerender(view());
  await waitFor(() => expect(currentName(name)).toBeTruthy());
  workspace.rerender(view("expanded"));
  await waitFor(() => expect(count()).toBe(1));
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("공용도로");
  expect((screen.getByLabelText("장소 분류 필터") as HTMLSelectElement).value).toBe("cafe");
});

it("saves, reloads, and removes a per-place private memo without altering old guidance or crossing scopes", () => {
  seed({ location: name, details: [{ name, address, notes }] });
  const workspace = render(view());
  const edit = () => {
    fireEvent.click(detail().getByText("주소 및 안내 편집"));
    return detail().getByLabelText("비공개 메모");
  };
  fireEvent.change(edit(), { target: { value: memo } });
  fireEvent.change(detail().getByLabelText("행사 내부 분류"), { target: { value: "cafe" } });
  fireEvent.click(detail().getByRole("button", { name: "저장" }));
  expect(read().details).toEqual([{ name, address, notes }]);
  expect(read().placeMetadata).toEqual([{ name, category: "cafe", privateMemo: { text: memo, authorId: scope.accountId, updatedAt: expect.any(String) } }]);
  workspace.unmount();
  const reloaded = render(view());
  expect(detail().getByText(memo, { selector: ".location-memo p" })).toBeTruthy();
  fireEvent.change(edit(), { target: { value: "" } });
  fireEvent.click(detail().getByRole("button", { name: "저장" }));
  expect(read().placeMetadata).toEqual([{ name, category: "cafe" }]);
  reloaded.rerender(view("docked", { ...scope, roomId: "another-room" }));
  expect(screen.queryByRole("heading", { name })).toBeNull();
  expect(screen.queryByText(memo)).toBeNull();
});

it("copies address and Maps link independently and only sends the public share payload to system share", async () => {
  seed();
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.assign(Object.create(window.navigator), { clipboard: { writeText }, share }));
  try {
    render(view());
    expect(screen.queryByRole("button", { name: "주소 복사" })).toBeNull();
    fireEvent.click(detail().getByRole("button", { name: "공유" }));
    const popup = within(screen.getByRole("dialog", { name: "장소 공유" }));
    fireEvent.click(popup.getByRole("button", { name: "주소 복사" }));
    expect(await popup.findByText("주소를 복사했습니다.")).toBeTruthy();
    const url = detail().getByRole("link", { name: "Google Maps에서 열기" }).getAttribute("href");
    fireEvent.click(popup.getByRole("button", { name: "Google Maps 링크 복사" }));
    expect((await popup.findByLabelText("Google Maps 링크 직접 복사") as HTMLInputElement).value).toBe(url);
    expect(writeText.mock.calls).toEqual([[address], [url]]);
    fireEvent.click(popup.getByRole("button", { name: "시스템 공유" }));
    expect(share).toHaveBeenCalledWith({ title: name, url });
    expect(popup.queryByText(memo)).toBeNull();
    expect(popup.queryByText(notes)).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});

it("never overwrites an unreadable record when adding a place", () => {
  localStorage.setItem(key, "malformed record");
  render(view());
  expect(screen.getByRole("alert").textContent).toContain("불러오지 못했습니다");
  expect((screen.getByLabelText("장소 추가") as HTMLInputElement).disabled).toBe(true);
  expect(localStorage.getItem(key)).toBe("malformed record");
});
