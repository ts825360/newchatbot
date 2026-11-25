import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RetreatPreparationPanel } from "@/components/retreat-preparation-panel";
import * as backend from "@/lib/backend-client";
import type { RetreatReview } from "@/lib/retreat-preparation";

const scope = { accountId: "account", roomId: "room", conversationId: "thread" };
const sample: RetreatReview = {
  roomId: scope.roomId, conversationId: scope.conversationId, year: 2027,
  fields: [
    { key: "date", label: "행사 날짜", status: "confirmed", reason: "confirmed", evidence: "calendar", value: "2027-08-15" },
    { key: "venue", label: "행사 장소", status: "needs_review", reason: "missing", evidence: null },
    { key: "transport", label: "차량 배정", status: "needs_review", reason: "missing", evidence: null },
  ],
  next: [{ id: "draft-survey", label: "참석 설문 초안 작성" }],
  deferred: [{ id: "draft-confirmed-notice", label: "공지문 초안", blockedBy: [{ key: "venue", reason: "missing" }] }],
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows missing preparation at a glance and can refresh without a meeting selector", async () => {
  const fetcher = vi.spyOn(backend, "backendFetch").mockResolvedValue(sample);
  render(<RetreatPreparationPanel scope={scope} />);
  const next = await screen.findByRole("region", { name: "지금 할 일" });
  expect(within(next).getByText("참석 설문 초안 작성")).toBeTruthy();
  expect(screen.getByText("2027-08-15")).toBeTruthy();
  expect(screen.getByText("공동 캘린더")).toBeTruthy();
  expect(screen.getByText("행사 장소: 저장된 근거 없음")).toBeTruthy();
  const transport = screen.getByText("차량 배정").closest("li")!;
  expect(within(transport).getByText("미정").getAttribute("data-tone")).toBe("red");
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(fetcher.mock.calls[0][0]).toBe("/api/retreat-preparation?roomId=room&conversationId=thread");
  fireEvent.click(screen.getByRole("button", { name: "다시 점검" }));
  await screen.findByRole("region", { name: "지금 할 일" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([_, init]) => !init?.method)).toBe(true);
});

it("drops previous-scope results immediately, including a response that arrives after navigation", async () => {
  let finish!: (result: RetreatReview) => void;
  const pending = new Promise<RetreatReview>(resolve => { finish = resolve; });
  const fetcher = vi.spyOn(backend, "backendFetch").mockReturnValueOnce(pending).mockResolvedValueOnce({
    ...sample, conversationId: "second", next: [], fields: [],
  });
  const { rerender } = render(<RetreatPreparationPanel scope={scope} />);
  rerender(<RetreatPreparationPanel scope={{ ...scope, conversationId: "second" }} />);
  expect(await screen.findByText("지금 제안할 수 있는 일이 없습니다.")).toBeTruthy();
  await act(async () => { finish(sample); await pending; });
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(screen.queryByText("참석 설문 초안 작성")).toBeNull();
});

it("allows retry after a temporary load error", async () => {
  vi.spyOn(backend, "backendFetch").mockRejectedValueOnce(new Error("오프라인")).mockResolvedValueOnce(sample);
  render(<RetreatPreparationPanel scope={scope} />);
  expect((await screen.findByRole("alert")).textContent).toBe("오프라인");
  fireEvent.click(screen.getByRole("button", { name: "다시 점검" }));
  expect(await screen.findByRole("region", { name: "지금 할 일" })).toBeTruthy();
});
