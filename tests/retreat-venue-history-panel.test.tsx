import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RetreatVenueHistory } from "../components/retreat-venue-history";
import { compareRetreatVenues, type RetreatVisit } from "../lib/retreat-venue-history";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const scope = { accountId: "test", roomId: "room", conversationId: "conversation" };
const visit: RetreatVisit = { name: "가상 리조트(공주)", year: 2025, features: ["worship", "groups", "bbq"] };
const snapshot = (history: RetreatVisit[], canPublish = false) => ({
  history, candidates: compareRetreatVenues(history), canPublish,
  reports: canPublish ? [{ id: "report", name: "결과보고서.md", venue: history[0]?.name ?? null, year: history[0]?.year ?? null }] : [],
});

it("separates visits and candidates, links to Maps and vetted sources, and shows capacity as unverified", async () => {
  const mockFetch = vi.fn(async (_path: string) => Response.json(snapshot([visit])));
  vi.stubGlobal("fetch", mockFetch);
  render(<RetreatVenueHistory scope={scope} question="수련회 100명이 묵을 숙소 추천, 바비큐가 필요해" />);
  expect(await screen.findByText("가상 리조트(공주)")).toBeDefined();
  const used = screen.getByText("가상 리조트(공주)").closest("li")!;
  const map = new URL(within(used).getByRole("link", { name: "지도에서 검색" }).getAttribute("href")!);
  expect(map.origin).toBe("https://www.google.com");
  expect(map.searchParams.get("query")).toBe(visit.name);
  expect(screen.getByText(/100명분 객실.*확인/)).toBeDefined();
  expect(screen.getAllByRole("link", { name: "시설 안내" }).length).toBe(3);
  expect(screen.queryByText("결과 보고서에서 이용 이력 등록")).toBeNull();
  expect(String(mockFetch.mock.calls[0][0])).toContain("bbq=1");
  expect(String(mockFetch.mock.calls[0][0])).not.toContain("100");
});

it("registers the selected report only on explicit submission", async () => {
  let history: RetreatVisit[] = [];
  const mockFetch = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ roomId: scope.roomId, conversationId: scope.conversationId,
        documentId: "report", name: visit.name, year: 2025 });
      history = [visit];
      return Response.json({ ok: true });
    }
    return Response.json(snapshot(history, true));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(<RetreatVenueHistory scope={scope} canRegister />);
  fireEvent.click(await screen.findByText("결과 보고서에서 이용 이력 등록"));
  fireEvent.change(screen.getByLabelText("결과 보고서"), { target: { value: "report" } });
  fireEvent.change(screen.getByLabelText("보고서에 적힌 장소"), { target: { value: visit.name } });
  fireEvent.change(screen.getByLabelText("이용 연도"), { target: { value: "2025" } });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "교회 이용 이력에 등록" }));
  await waitFor(() => expect(screen.getByText(visit.name)).toBeDefined());
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
