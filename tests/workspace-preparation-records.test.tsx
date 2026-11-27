import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspacePreparationRecords } from "../components/workspace-preparation-records";
import { privateToolKey } from "../lib/conversation-scope";
import { buildChecklistChatDraft } from "../lib/checklist-chat-draft";
import { createInitialState } from "../lib/prototype-state";

const initial = createInitialState();
const room = initial.rooms[0];
const scope = { accountId: "prep-tester", roomId: room.id, conversationId: "preparation" };
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it("reads actual preparation records and distinguishes them from missing, restricted and invalid records", () => {
  localStorage.setItem(privateToolKey(scope, "location"), JSON.stringify({ location: "가상 행사장" }));
  sessionStorage.setItem(privateToolKey(scope, "transport"), "corrupt");
  const open = vi.fn();
  render(<WorkspacePreparationRecords scope={scope} room={room} events={[]} calendarState="restricted"
    documentsState="ready" documentCount={2} surveyState="ready" surveys={{ drafts: 1, forms: 0 }} onOpen={open} />);
  const row = (name: string) => within(screen.getByRole("listitem", { name }));
  expect(row("행사 장소").getByText("등록됨")).toBeDefined();
  expect(row("공동 캘린더").getByText("권한 없음")).toBeDefined();
  expect(row("타임테이블").getByText("미등록")).toBeDefined();
  expect(row("참가자 명단").getByText("읽기 실패")).toBeDefined();
  expect(row("참가 설문").getByText("등록됨")).toBeDefined();
  expect(row("행사 자료").getByText("2건")).toBeDefined();
  fireEvent.click(row("행사 장소").getByRole("button", { name: "행사 장소 열기" }));
  expect(open).toHaveBeenCalledWith("location");
  fireEvent.click(row("참가 설문").getByRole("button", { name: "참가 설문 열기" }));
  expect(open).toHaveBeenLastCalledWith("proposals");
});

it("changes checklist draft purpose with task state and adds a real due date without including owner or memo", () => {
  const base = { id: "one", title: "참석 수요 설문 초안 작성", owner: "PRIVATE_OWNER", memo: "PRIVATE_MEMO", due: "2026-12-10" };
  const review = buildChecklistChatDraft({ ...base, status: "needsReview" }, room);
  const running = buildChecklistChatDraft({ ...base, status: "inProgress" }, room);
  expect(review).toContain(base.title);
  expect(review).toContain(base.due);
  expect(review).not.toMatch(/PRIVATE/);
  expect(running).not.toBe(review);
  expect(running).toContain("이어");
});
