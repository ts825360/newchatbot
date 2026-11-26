import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatSurveyProposal } from "@/components/chat-survey-proposal";
import { GoogleFormDraftActions } from "@/components/google-form-draft-actions";

const endpoint = "/api/integrations/google-form-drafts";
const editorUrl = "https://docs.google.com/forms/d/draft_fixture1/edit";
const scope = { accountId: "private-account", roomId: "retreat", conversationId: "planning" };
const title = "여름 수련회 신청 설문";
const connected = { configured: true, connected: true, needsReconnect: false };
const fetchDraft = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchDraft.mockImplementation(async (path, init) => {
    if (path !== endpoint) throw new Error("Unexpected endpoint");
    return Response.json(init?.method === "POST" ? { editorUrl } : connected);
  });
  vi.stubGlobal("fetch", fetchDraft);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchDraft.mockReset(); });

it("can open the draft controls with a proposed title without creating a draft", async () => {
  const actionsScope = { roomId: scope.roomId, conversationId: scope.conversationId };
  render(<GoogleFormDraftActions scope={actionsScope} initialTitle={title} initiallyExpanded />);
  const input = await screen.findByRole("textbox", { name: "설문 제목" });
  expect(input).toHaveProperty("value", title);
  expect(fetchDraft.mock.calls.map(([path, init]) => [path, init?.method ?? "GET"])).toEqual([[endpoint, "GET"]]);
});

it("renders the existing numbered questions and choices in order without numbering the section break", async () => {
  render(<ChatSurveyProposal scope={scope} title={title} />);
  await screen.findByRole("textbox", { name: "설문 제목" });
  const list = screen.getByRole("list");
  expect(list.tagName).toBe("OL");
  const questions = within(list).getAllByRole("listitem");
  const expected = ["참석 여부", "소속", "이름", "숙소 배정", "이동수단", "기타 특이사항", "가족 ID"];
  expect(questions).toHaveLength(expected.length);
  expected.forEach((label, index) => expect(within(questions[index]).getByText(label)).toBeTruthy());
  expect(within(questions[0]).getByText("참석 (참석자 정보로 이동) · 불참 (설문 제출)")).toBeTruthy();
  expect(within(questions[1]).getByText("유초등부 · 아동부 · 청소년부 · 청년부 · 장년부 · 명단 확인 필요")).toBeTruthy();
  expect(within(questions[3]).getByText("가족방 · 단체방")).toBeTruthy();
  expect(within(questions[4]).getByText("단체 이동 · 왕복 자차 · 왕복 개별 이동 · 편도 개별 이동 · 가족 차량 동승 · 다른 차량 동승 · 미정 · 기타")).toBeTruthy();
  expect(within(questions[6]).getByText("가족방을 선택한 경우, 함께 묵는 가족이 같은 코드를 입력해 주세요.")).toBeTruthy();
});

it("submits only the edited title and conversation IDs on explicit creation and exposes the editor link", async () => {
  render(<ChatSurveyProposal scope={scope} title={title} />);
  const input = await screen.findByRole("textbox", { name: "설문 제목" });
  expect(input).toHaveProperty("value", title);
  fireEvent.change(input, { target: { value: "  여름 행사 참가 신청  " } });
  expect(fetchDraft.mock.calls.map(([path, init]) => [path, init?.method ?? "GET"])).toEqual([[endpoint, "GET"]]);
  fireEvent.click(screen.getByRole("button", { name: "초안 생성" }));
  const editor = await screen.findByRole("link", { name: "구글폼에서 설문 편집" });
  expect(editor.getAttribute("href")).toBe(editorUrl);
  expect(editor.getAttribute("target")).toBe("_blank");
  const posts = fetchDraft.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe(endpoint);
  expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
    action: "create", title: "여름 행사 참가 신청", roomId: scope.roomId, conversationId: scope.conversationId,
  });
});

it.each([true, false])("shows setup instead of creation when not connected (configured: %s)", async (configured) => {
  fetchDraft.mockResolvedValueOnce(Response.json({ configured, connected: false, needsReconnect: false }));
  render(<ChatSurveyProposal scope={scope} title={title} />);
  const setup = await screen.findByRole("link", { name: "환경설정에서 생성 권한 연결" });
  expect(setup.getAttribute("href")).toBe("/settings?section=connections#google-forms");
  if (!configured) expect(screen.getByText("서버 설정 필요")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "초안 생성" })).toBeNull();
  expect(fetchDraft.mock.calls.map(([path, init]) => [path, init?.method ?? "GET"])).toEqual([[endpoint, "GET"]]);
});

it("does not carry an editor link into another conversation", async () => {
  const { rerender } = render(<ChatSurveyProposal scope={scope} title={title} />);
  fireEvent.click(await screen.findByRole("button", { name: "초안 생성" }));
  await screen.findByRole("link", { name: "구글폼에서 설문 편집" });
  rerender(<ChatSurveyProposal scope={{ ...scope, conversationId: "other-planning" }} title={title} />);
  await screen.findByRole("textbox", { name: "설문 제목" });
  expect(screen.queryByRole("link", { name: "구글폼에서 설문 편집" })).toBeNull();
});
