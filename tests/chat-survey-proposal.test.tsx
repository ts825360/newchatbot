import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatSurveyProposal } from "@/components/chat-survey-proposal";
import { GoogleFormDraftActions } from "@/components/google-form-draft-actions";
import { defaultSurveyItems, surveyTemplateVersion, type SurveyDraft } from "@/lib/chat-survey-draft";

const endpoint = "/api/integrations/google-form-drafts";
const editorUrl = "https://docs.google.com/forms/d/draft_fixture1/edit";
const scope = { accountId: "private-account", roomId: "retreat", conversationId: "planning" };
const title = "여름 수련회 신청 설문";
const connected = { configured: true, connected: true, needsReconnect: false };
const fetchDraft = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const versioned: SurveyDraft = { id: "d57ec424-64fe-4bd2-a777-b3717581c420", version: 1, template: "retreat", templateVersion: 1,
  title, description: "", items: defaultSurveyItems(1) };

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

it("shows the old questions on a title-only preview without enabling approval", async () => {
  render(<ChatSurveyProposal scope={scope} title={title} />);
  const list = screen.getByRole("list");
  expect(list.tagName).toBe("OL");
  const questions = within(list).getAllByRole("listitem");
  const expected = ["참석 여부", "소속", "이름", "성별", "숙소 배정", "이동수단", "기타 특이사항"];
  expect(questions).toHaveLength(expected.length);
  expected.forEach((label, index) => expect(within(questions[index]).getByText(label)).toBeTruthy());
  expect(within(questions[0]).getByText("참석 (참석자 정보로 이동) · 불참 (설문 제출) · 기타 (직접 입력, 참석자 정보로 이동)")).toBeTruthy();
  expect(within(questions[1]).getByText("유초등부 · 아동부 · 청소년부 · 청년부 · 장년부 · 명단 확인 필요 · 기타 (직접 입력)")).toBeTruthy();
  expect(within(questions[2]).getByText("단답형")).toBeTruthy();
  expect(within(questions[3]).getByText("남성 · 여성 · 응답하지 않음")).toBeTruthy();
  expect(within(questions[4]).getByText("가족방 · 단체방 · 기타 (직접 입력)")).toBeTruthy();
  expect(within(questions[5]).getByText("왕복 자차 · 단체 이동 · 가족 차량 동승 · 기타 (직접 입력)")).toBeTruthy();
  expect(within(questions[6]).getByText("장문형")).toBeTruthy();
  expect(fetchDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Google Forms에 생성/ })).toBeNull();
});

it("shows v2 route destinations and sends only the reviewed snapshot reference on approval", async () => {
  const draft = { ...versioned, templateVersion: surveyTemplateVersion, items: defaultSurveyItems() };
  render(<ChatSurveyProposal scope={scope} title={title} draft={draft} />);
  const outbound = screen.getByText("출발 이동수단").closest("li")!;
  expect(within(outbound).getByText(/자차 이동 \(이동: 출발 추가 좌석\)/)).toBeTruthy();
  expect(within(outbound).getByText(/단체 이동 \(이동: 귀가 이동 정보\)/)).toBeTruthy();
  const returning = screen.getByText("귀가 이동수단").closest("li")!;
  expect(within(returning).getByText(/출발할 때와 동일 \(이동: 기타 특이사항 작성\)/)).toBeTruthy();
  expect(within(returning).getByText(/미정 \(이동: 기타 특이사항 작성\)/)).toBeTruthy();
  const approve = await screen.findByRole("button", { name: "승인하고 Google Forms에 생성" });
  expect(fetchDraft.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET"]);
  fireEvent.click(approve);
  await screen.findByRole("link", { name: "구글폼에서 설문 편집" });
  expect(JSON.parse(String(fetchDraft.mock.lastCall?.[1]?.body))).toEqual({ action: "create-version", roomId: scope.roomId,
    conversationId: scope.conversationId, workId: draft.id, version: draft.version });
});

it("submits only the edited title and conversation IDs on explicit creation and exposes the editor link", async () => {
  render(<GoogleFormDraftActions scope={{ roomId: scope.roomId, conversationId: scope.conversationId }} initialTitle={title} initiallyExpanded />);
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

it("shows only the saved version and sends its reference on explicit approval", async () => {
  const draft: SurveyDraft = { id: "d57ec424-64fe-4bd2-a777-b3717581c420", version: 2, template: "retreat", templateVersion: 1,
    title, description: "검토할 설명", items: defaultSurveyItems(1).filter(item => item.id !== "department") };
  render(<ChatSurveyProposal scope={scope} title={title} draft={draft} />);
  const approve = await screen.findByRole("button", { name: "승인하고 Google Forms에 생성" });
  expect(screen.queryByText("소속")).toBeNull();
  expect(screen.getByText("검토 버전 2", { exact: true })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "설문 제목" })).toHaveProperty("readOnly", true);
  expect(fetchDraft.mock.calls).toHaveLength(1);
  fireEvent.click(approve);
  await screen.findByRole("link", { name: "구글폼에서 설문 편집" });
  expect(JSON.parse(String(fetchDraft.mock.lastCall?.[1]?.body))).toEqual({ action: "create-version", roomId: scope.roomId,
    conversationId: scope.conversationId, workId: draft.id, version: 2 });
});

it.each([true, false])("shows setup instead of creation when not connected (configured: %s)", async (configured) => {
  fetchDraft.mockResolvedValueOnce(Response.json({ configured, connected: false, needsReconnect: false }));
  render(<ChatSurveyProposal scope={scope} title={title} draft={versioned} />);
  const setup = await screen.findByRole("link", { name: "환경설정에서 생성 권한 연결" });
  expect(setup.getAttribute("href")).toBe("/settings?section=connections#google-forms");
  if (!configured) expect(screen.getByText("서버 설정 필요")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "초안 생성" })).toBeNull();
  expect(fetchDraft.mock.calls.map(([path, init]) => [path, init?.method ?? "GET"])).toEqual([[endpoint, "GET"]]);
});

it("does not carry an editor link into another conversation", async () => {
  const { rerender } = render(<ChatSurveyProposal scope={scope} title={title} draft={versioned} />);
  fireEvent.click(await screen.findByRole("button", { name: "승인하고 Google Forms에 생성" }));
  await screen.findByRole("link", { name: "구글폼에서 설문 편집" });
  rerender(<ChatSurveyProposal scope={{ ...scope, conversationId: "other-planning" }} title={title} draft={{ ...versioned, id: "b3537a74-10a1-4632-a740-f72038110dbd" }} />);
  await screen.findByRole("textbox", { name: "설문 제목" });
  expect(screen.queryByRole("link", { name: "구글폼에서 설문 편집" })).toBeNull();
});
