import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PersonalCategoryBar } from "../components/personal-category-bar";
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it("creates a personal category, filters rooms, edits and deletes without deleting rooms", () => {
  const onFilter = vi.fn();
  render(<PersonalCategoryBar accountId="me" rooms={[{ id: "a", name: "수련회" }, { id: "b", name: "환영회" }]} onFilter={onFilter} />);
  fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
  fireEvent.change(screen.getByLabelText("카테고리 이름"), { target: { value: "내 담당" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "수련회" }));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(screen.getByRole("tab", { name: "내 담당" })).toBeDefined();
  expect(onFilter).toHaveBeenLastCalledWith(["a"]);
  fireEvent.click(screen.getByRole("button", { name: "카테고리 편집" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "환영회" }));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(onFilter).toHaveBeenLastCalledWith(["a", "b"]);
  fireEvent.click(screen.getByRole("button", { name: "카테고리 편집" }));
  fireEvent.click(screen.getByRole("button", { name: "카테고리 삭제" }));
  expect(screen.getByRole("dialog").textContent).toContain("행사방은 삭제되지 않습니다");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
  expect(screen.queryByRole("tab", { name: "내 담당" })).toBeNull();
  expect(onFilter).toHaveBeenLastCalledWith(null);
});
