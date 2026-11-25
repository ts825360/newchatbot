import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { DevotionsScreen } from "../components/devotions-screen";
import { DevotionLobbyPreview } from "../components/devotion-lobby-preview";
import { koreaDate } from "../lib/devotions";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), account: "active" as string | null, request: vi.fn() }));
const params = new URLSearchParams();
vi.mock("next/navigation", () => {
  const router = { replace: mocks.replace };
  return { useRouter: () => router, useSearchParams: () => params };
});
vi.mock("../lib/backend-client", () => ({
  BackendError: class BackendError extends Error { status = 401; },
  backendFetch: mocks.request,
  getBackendState: () => ({ userId: mocks.account }),
  subscribeBackend: () => () => {},
}));
vi.mock("../lib/use-theme", () => ({ usePrototypeTheme: () => ({ darkMode: false, toggleTheme: () => {} }) }));

const latest = { date: "2026-11-20", title: "", excerpt: "첫 문장입니다. 둘째 문장입니다." };
const entry = { date: latest.date, title: "", body: "첫 문장입니다.\n\n둘째 문장입니다.", revision: 1 };
const feed = { today: "2026-11-21", entry, canPublish: false, archive: [latest], next: null };
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.account = "active"; });

it("shows a previous entry with its date, with no editing controls for a reader", async () => {
  mocks.request.mockResolvedValue(feed);
  render(<DevotionsScreen />);
  const reader = await screen.findByRole("region", { name: "말씀 본문" });
  const body = reader.querySelector(".devotion-body")!;
  expect(body.textContent).toBe(entry.body);
  expect(screen.getByText("최근 등록")).toBeDefined();
  expect(screen.getByText("오늘은 아직 등록된 말씀이 없습니다.")).toBeDefined();
  expect(screen.queryByRole("button", { name: "말씀 등록" })).toBeNull();
});

it("lets a manager paste and explicitly save the original lines", async () => {
  mocks.request.mockImplementation(async (_path, init) => init?.method === "PUT" ? { entry } : { ...feed, canPublish: true });
  render(<DevotionsScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "말씀 등록" }));
  const original = "가상 첫 줄\n\n가상 둘째 줄";
  fireEvent.change(screen.getByRole("textbox", { name: "말씀 본문" }), { target: { value: original } });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "게시" }));
  await waitFor(() => {
    const write = mocks.request.mock.calls.find(([path, init]) => path === "/api/devotions" && init?.method === "PUT");
    expect(write).toBeDefined();
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({ date: feed.today, title: "", body: original, revision: 0 });
  });
});

it("redirects a signed-out reader without loading any text", async () => {
  mocks.account = null;
  render(<DevotionsScreen />);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  expect(mocks.request).not.toHaveBeenCalled();
});

it("shows one readable passage in the lobby without linking to the archive", async () => {
  mocks.request.mockResolvedValue({ date: koreaDate(), reference: "시편 23:1", verse: "묵상 본문", url: "https://www.bible.com/ko/bible/88/PSA.23.1.KRV" });
  render(<DevotionLobbyPreview accountId="active" />);
  const panel = await screen.findByRole("region", { name: "오늘의 묵상" });
  expect(panel.textContent).toContain("묵상 본문");
  const link = screen.getByRole("link", { name: "시편 23:1" });
  expect(link.getAttribute("href")).toBe("https://www.bible.com/ko/bible/88/PSA.23.1.KRV");
  expect(panel.textContent).toContain("개역한글");
  expect(mocks.request.mock.calls[0]?.[0]).toBe("/api/devotions?view=meditation");
  expect(panel.querySelector('[href="/devotions"]')).toBeNull();
});

it("replaces the visible verse after Korean midnight without reloading the lobby", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const url = "https://www.bible.com/ko/bible/88/PSA.23.1.KRV";
  try {
    vi.setSystemTime(new Date("2026-11-20T14:59:59.900Z"));
    mocks.request.mockResolvedValueOnce({ date: "2026-11-20", reference: "시편 23:1", verse: "어제의 구절", url })
      .mockResolvedValueOnce({ date: "2026-11-21", reference: "잠언 3:5", verse: "오늘의 구절", url });
    await act(async () => { render(<DevotionLobbyPreview accountId="active" />); });
    expect(screen.getByText("어제의 구절")).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.queryByText("어제의 구절")).toBeNull();
    expect(screen.getByText("오늘의 구절")).toBeDefined();
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
