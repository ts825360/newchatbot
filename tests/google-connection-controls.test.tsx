import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import * as backend from "@/lib/backend-client";
import { GoogleCalendarConnection } from "@/components/google-calendar-connection";
import { GoogleFormsConnection } from "@/components/google-forms-connection";
import { TransportSurveyForm } from "@/components/transport-survey-form";

const disconnected = { configured: true, connected: false, needsReconnect: false, canSync: false, synced: 0, pending: 0, error: "" };
const ready = { ...disconnected, connected: true, canSync: true, synced: 3, pending: 2 };
const scope = { accountId: "account", roomId: "room", conversationId: "conversation" };
let fetcher: MockInstance<typeof backend.backendFetch>;
beforeEach(() => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  fetcher = vi.spyOn(backend, "backendFetch").mockResolvedValue(disconnected);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("directs a disconnected workspace calendar to settings without starting OAuth", async () => {
  render(<GoogleCalendarConnection />);
  const link = await screen.findByRole("link", { name: "환경설정에서 연결" });
  expect(link.getAttribute("href")).toBe("/settings?section=connections#google-calendar");
  expect(screen.queryByRole("button", { name: /구글 캘린더 연결/ })).toBeNull();
  expect(fetcher.mock.calls).toEqual([["/api/integrations/google/status"]]);
});

it("shows automatic delivery without a send button while Google has no error", async () => {
  fetcher.mockResolvedValue(ready);
  render(<GoogleCalendarConnection />);
  await screen.findByText("자동 전송 · 완료 3 · 대기 2");
  expect(screen.queryByRole("button", { name: /전송|연결 해제/ })).toBeNull();
  expect(fetcher.mock.calls).toEqual([["/api/integrations/google/status"]]);
});

it("shows retry only for a failed delivery and disconnect only in settings", async () => {
  fetcher.mockResolvedValue({ ...ready, error: "구글 전송 오류" });
  const view = render(<GoogleCalendarConnection />);
  fireEvent.click(await screen.findByRole("button", { name: "전송 재시도" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/integrations/google/sync", { method: "POST" }));
  expect(screen.queryByRole("button", { name: /연결 해제/ })).toBeNull();
  view.unmount();
  render(<GoogleCalendarConnection mode="manage" />);
  const button = await screen.findByRole("button", { name: "구글 캘린더 연결 해제" });
  expect(screen.queryByRole("button", { name: "전송 재시도" })).toBeNull();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(button);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/integrations/google/disconnect", { method: "POST" }));
});

it("moves Forms authorization out of survey import but keeps CSV available", async () => {
  vi.spyOn(backend, "isBackendConnected").mockReturnValue(true);
  render(<TransportSurveyForm hasPeople={false} onImport={vi.fn()} scope={scope} initialMode="google" />);
  const link = await screen.findByRole("link", { name: "환경설정에서 연결" });
  expect(link.getAttribute("href")).toBe("/settings?section=connections#google-forms");
  expect(screen.queryByRole("button", { name: /권한 연결/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "CSV 파일" }));
  expect(screen.getByLabelText("Google Forms 응답 CSV")).toBeDefined();
});

it("updates only the Forms controls after disconnecting read access", async () => {
  fetcher.mockResolvedValue({ configured: true, connected: true });
  render(<GoogleFormsConnection />);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(await screen.findByRole("button", { name: "구글폼 연결 해제" }));
  expect(await screen.findByRole("button", { name: "구글폼 연결" })).toBeDefined();
  expect(fetcher).toHaveBeenCalledWith("/api/integrations/google-forms", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "disconnect" }) }));
});
