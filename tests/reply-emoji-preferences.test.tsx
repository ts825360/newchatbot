import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsScreen } from "../components/settings-screen";

const { backendFetch, router } = vi.hoisted(() => ({ backendFetch: vi.fn(), router: { replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../lib/backend-client", async original => ({
  ...await original<typeof import("../lib/backend-client")>(),
  backendFetch,
  getBackendProfile: () => ({ accountId: "reply-style-test", grade: 3, nickname: "담당자", permissions: ["chat"], role: "담당자", roomIds: [] }),
}));

const saved = { tone: "direct", length: "brief", emoji: "off", instructions: "PRIVATE_PREVIEW_NOTE", instructionsEnabled: true };
const preview = () => within(screen.getByRole("complementary", { name: "답변 미리보기" }));
const slider = () => screen.getByRole<HTMLInputElement>("slider", { name: "이모티콘 사용 빈도" });
const select = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

beforeEach(() => {
  backendFetch.mockReset();
  window.history.replaceState(null, "", "/settings?section=reply");
});
afterEach(cleanup);

it("previews adjustable zero separately from off and saves only on explicit submission", async () => {
  const zero = { ...saved, emoji: "frequency", emojiFrequency: 0 };
  backendFetch.mockResolvedValueOnce(saved).mockResolvedValueOnce(zero).mockResolvedValueOnce(zero);
  const { unmount } = render(<SettingsScreen />);
  expect((await screen.findByRole<HTMLInputElement>("radio", { name: "사용 안 함" })).checked).toBe(true);
  expect(screen.queryByRole("slider")).toBeNull();
  expect(preview().getByText("날짜와 장소부터 확정하세요.")).toBeDefined();

  select("사용 빈도 조절");
  expect(slider().value).toBe("50");
  expect([slider().min, slider().max, slider().step]).toEqual(["0", "100", "1"]);
  const middle = preview().getByText(/날짜와 장소부터 확정하세요/).textContent;
  fireEvent.change(slider(), { target: { value: "100" } });
  expect(screen.getByText("100", { exact: true })).toBeDefined();
  const high = preview().getByText(/날짜와 장소부터 확정하세요/).textContent;
  expect(high).not.toBe(middle);
  fireEvent.change(slider(), { target: { value: "0" } });
  expect(screen.getByText("0", { exact: true })).toBeDefined();
  const minimal = preview().getByText(/날짜와 장소부터 확정하세요/).textContent;
  expect(minimal).not.toBe(middle);
  expect(minimal).not.toBe("날짜와 장소부터 확정하세요.");
  expect(preview().queryByRole("list")).toBeNull();
  expect(preview().queryByText(saved.instructions)).toBeNull();

  select("사용 안 함");
  expect(screen.queryByRole("slider")).toBeNull();
  expect(preview().getByText("날짜와 장소부터 확정하세요.")).toBeDefined();
  select("사용 빈도 조절");
  expect(slider().value).toBe("0");
  expect(backendFetch.mock.calls).toEqual([["/api/preferences"]]);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByText("답변 스타일을 저장했습니다.")).toBeDefined();
  expect(JSON.parse(backendFetch.mock.calls[1][1].body)).toEqual(zero);

  unmount();
  render(<SettingsScreen />);
  expect((await screen.findByRole<HTMLInputElement>("slider", { name: "이모티콘 사용 빈도" })).value).toBe("0");
});

it("loads an older occasional response at the midpoint without saving or changing tone and length", async () => {
  backendFetch.mockResolvedValueOnce({ ...saved, tone: "friendly", length: "detailed", emoji: "occasional" });
  render(<SettingsScreen />);
  expect((await screen.findByRole<HTMLInputElement>("slider", { name: "이모티콘 사용 빈도" })).value).toBe("50");
  expect(preview().getByText(/좋아요, 한 가지씩 준비해 봐요/)).toBeDefined();
  expect(preview().getAllByRole("listitem")).toHaveLength(3);
  expect(preview().getByText(/날짜가 미정이라면/)).toBeDefined();
  expect(backendFetch).toHaveBeenCalledTimes(1);
});
