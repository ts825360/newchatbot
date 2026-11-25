import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SaveStatus } from "../components/save-status";
import { markStorageStatus } from "../lib/storage-status";
afterEach(cleanup);
it("distinguishes current-tab saves, browser saves, and failures without a server sync claim", () => {
  markStorageStatus("idle"); render(<SaveStatus />);
  act(() => markStorageStatus("saving", "tab"));
  expect(screen.getByRole("status").textContent).toBe("저장 중");
  act(() => markStorageStatus("saved", "tab"));
  expect(screen.getByText("현재 탭에 저장됨")).toBeDefined();
  act(() => markStorageStatus("saved", "browser"));
  expect(screen.getByText("브라우저에 저장됨")).toBeDefined();
  act(() => markStorageStatus("failed"));
  expect(screen.getByText("저장 실패")).toBeDefined();
});
