import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocationPanel } from "../components/location-panel";
import { ConversationLocation } from "../components/conversation-location";
import { privateToolKey } from "../lib/conversation-scope";
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
it("offers a keyless external map without manufacturing place details", () => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "");
  const { container } = render(<LocationPanel location="대전광역시 중구 계백로 1700" />);
  expect(screen.getByRole("link", { name: /Google Maps에서 열기/ }).getAttribute("href")).toContain("google.com/maps/search/");
  expect(screen.getByRole("status").textContent).toContain("내장 지도 미설정");
  expect(container.querySelector("iframe")).toBeNull();
  expect(screen.queryByText(/4\.3/)).toBeNull();
});

it("preserves an old single venue, adds another, and saves the selected primary venue", async () => {
  const scope = { accountId: "owner", roomId: "room", conversationId: "place-list" };
  const key = privateToolKey(scope, "location");
  localStorage.setItem(key, JSON.stringify({ location: "교회 집합 장소" }));
  const view = render(<ConversationLocation scope={scope} />);
  expect(within(screen.getByRole("region", { name: "행사 장소" })).getByText("교회 집합 장소")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("장소 추가"), { target: { value: "수련원" } });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  expect(within(screen.getByRole("region", { name: "행사 장소" })).getByText("수련원")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "수련원 대표로 설정" }));
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ location: "수련원", places: ["수련원", "교회 집합 장소"] });
  view.unmount();
  render(<ConversationLocation scope={scope} />);
  expect(within(screen.getByRole("region", { name: "행사 장소" })).getByText("수련원")).toBeTruthy();
  localStorage.removeItem(key);
});
it("loads a configured embed only on explicit request and never for an unknown place", () => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "test-key");
  const { container, rerender } = render(<LocationPanel location="대전역" />);
  expect(container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "지도 표시" }));
  expect(screen.getByTitle("대전역 지도")).toBeDefined();
  expect(screen.getByRole("link", { name: /Google Maps에서 열기/ })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "지도 닫기" }));
  expect(container.querySelector("iframe")).toBeNull();
  rerender(<LocationPanel location="장소 협의 중" />);
  expect(container.querySelector("iframe")).toBeNull();
});
