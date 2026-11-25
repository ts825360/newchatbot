import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountMenu } from "../components/account-menu";
import { defaultProfile } from "../lib/mock-data";

afterEach(cleanup);
describe("lobby account menu", () => {
  it("keeps owner operations separate from member management", () => {
    render(<AccountMenu profile={{ ...defaultProfile, grade: 1, permissions: ["admin", "manageMembers"] }} />);
    fireEvent.click(screen.getByText(defaultProfile.nickname));
    expect(screen.getByRole("link", { name: "구성원 관리" }).getAttribute("href")).toBe("/members");
    expect(screen.queryByRole("link", { name: "환경설정" })).toBeNull();
    expect(screen.getByRole("link", { name: "운영 관리" }).getAttribute("href")).toBe("/admin");
    expect(within(screen.getByRole("navigation", { name: "계정 관리 메뉴" })).getAllByRole("link").map((link) => link.textContent))
      .toEqual(["구성원 관리", "운영 관리"]);
  });
  it("does not expose owner operations to grade2", () => {
    render(<AccountMenu profile={{ ...defaultProfile, grade: 2, permissions: ["manageMembers"] }} />);
    fireEvent.click(screen.getByText(defaultProfile.nickname));
    expect(screen.getByRole("link", { name: "구성원 관리" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "운영 관리" })).toBeNull();
  });
  it("shows only the account name instead of an empty settings-only menu for a general member", () => {
    render(<AccountMenu profile={{ ...defaultProfile, grade: 3 }} />);
    expect(screen.getByText(defaultProfile.nickname)).toBeDefined();
    expect(screen.queryByLabelText("계정 메뉴")).toBeNull();
    expect(screen.queryByRole("link", { name: "환경설정" })).toBeNull();
    expect(screen.queryByRole("link", { name: "구성원 관리" })).toBeNull();
    expect(screen.queryByRole("link", { name: "운영 관리" })).toBeNull();
  });
  it("does not make grade 1 operations depend on the member-management permission", () => {
    render(<AccountMenu profile={{ ...defaultProfile, grade: 1, permissions: ["admin"] }} />);
    fireEvent.click(screen.getByLabelText("계정 메뉴"));
    expect(screen.queryByRole("link", { name: "구성원 관리" })).toBeNull();
    expect(screen.getByRole("link", { name: "운영 관리" }).getAttribute("href")).toBe("/admin");
  });
});
