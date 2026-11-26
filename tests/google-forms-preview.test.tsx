import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountFormsPreview, GoogleFormsConnection } from "@/components/google-forms-connection";
import { TransportSurveyForm } from "@/components/transport-survey-form";
import * as backend from "@/lib/backend-client";
import { defaultSurveyMapping } from "@/lib/transport-survey";
import { setGoogleFormsRosterTarget } from "@/lib/google-forms-roster-target";
import { privateToolKey } from "@/lib/conversation-scope";
import { createTransportDraft, createTransportVehicle } from "@/lib/transport";

const endpoint = "/api/integrations/google-forms";
const draftEndpoint = "/api/integrations/google-form-drafts";
const editor = "https://docs.google.com/forms/d/mock_form01/edit";
const share = "https://docs.google.com/forms/d/e/public_mock_form01/viewform";
const status = { configured: true, connected: true };
const scope = { accountId: "account", roomId: "room", conversationId: "conversation" };
beforeEach(() => {
  vi.spyOn(backend, "isBackendConnected").mockReturnValue(true);
  vi.spyOn(backend, "backendFetch").mockImplementation(async (_, init) =>
    init ? { respondentUrl: share, notice: "아직 접수된 설문 응답이 없습니다." } : status);
});
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function preview() {
  const input = await screen.findByLabelText("구글폼 편집 주소");
  fireEvent.change(input, { target: { value: editor } });
  fireEvent.click(screen.getByRole("button", { name: "응답 미리보기" }));
  return input;
}

it("creates a blank form in Google and copies only the provider respondent URL before responses exist", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    render(<GoogleFormsConnection />);
    const create = screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" });
    expect(create.getAttribute("href")).toBe("https://docs.google.com/forms/u/0/create");
    expect(create.getAttribute("target")).toBe("_blank");
    expect(create.getAttribute("rel")).toContain("noreferrer");
    const input = await preview();
    expect(backend.backendFetch).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({
      method: "POST", body: JSON.stringify({ action: "account-preview", url: editor }),
    }));
    expect(await screen.findByText("아직 접수된 설문 응답이 없습니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "응답 링크 열기" }).getAttribute("href")).toBe(share);
    fireEvent.click(screen.getByRole("button", { name: "응답 링크 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(share));
    expect(await screen.findByText("응답 링크를 복사했습니다.")).toBeTruthy();
    fireEvent.change(input, { target: { value: editor.replace("01", "02") } });
    expect(screen.queryByRole("button", { name: "응답 링크 복사" })).toBeNull();
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("settings preview is read-only and ignores an editor URL in provider share metadata", async () => {
  const data = { headers: ["참석 여부", "이름"], rows: [["O", "가상 응답자"]] };
  vi.mocked(backend.backendFetch).mockImplementation(async (_, init) =>
    init ? { data, mapping: defaultSurveyMapping(data.headers), source: { formId: "mock_form01", personIds: [`GF-${"a".repeat(44)}`] }, respondentUrl: editor } : status);
  render(<GoogleFormsConnection />);
  await preview();
  expect(await screen.findByText(/^1\. 가상 응답자 · 참석$/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /반영|저장|응답 링크 복사/ })).toBeNull();
  expect(screen.queryByRole("link", { name: "응답 링크 열기" })).toBeNull();
});

it.each([false, true])("imports only after confirming the same roster snapshot (concurrent change: %s)", async concurrent => {
  vi.spyOn(backend, "getBackendProfile").mockReturnValue({ accountId: scope.accountId } as NonNullable<ReturnType<typeof backend.getBackendProfile>>);
  vi.spyOn(backend, "flushBackendWrites").mockResolvedValue(undefined);
  vi.spyOn(backend, "refreshBackendData").mockResolvedValue(undefined);
  const data = { headers: ["참석 여부", "이름"], rows: [["O", "가상 신규"]] };
  const survey = { data, mapping: defaultSurveyMapping(data.headers), source: { formId: "mock_form01", personIds: [`GF-${"b".repeat(44)}`] } };
  vi.mocked(backend.backendFetch).mockResolvedValue(survey);
  const input = createTransportDraft();
  input.vehicles = [createTransportVehicle("V1")];
  input.people = [{ id: "old", name: "가상 기존", roomAssignment: "101호", department: "청년부", familyId: "", companionGroup: "", outboundTripId: "main", returnTripId: "normal" }];
  const key = privateToolKey(scope, "transport");
  const original = JSON.stringify({ input, result: null, baseline: null, approved: false });
  sessionStorage.setItem(key, original);
  const otherKey = privateToolKey({ ...scope, conversationId: "other" }, "transport");
  sessionStorage.setItem(otherKey, original);
  setGoogleFormsRosterTarget(scope, "가상 행사 / 가상 대화");
  render(<AccountFormsPreview disabled={false} allowConversationImport />);
  expect(await screen.findByText("가상 행사 / 가상 대화")).toBeTruthy();
  await preview();
  const add = await screen.findByRole("button", { name: "신규 참석자 추가" });
  expect(backend.backendFetch).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({ body: JSON.stringify({ action: "preview", ...scope, url: editor }) }));
  expect(sessionStorage.getItem(key)).toBe(original);
  if (concurrent) sessionStorage.setItem(key, original.replace("101호", "102호"));
  fireEvent.click(add);
  if (concurrent) expect((await screen.findByRole("alert")).textContent).toContain("참가자 명단이 바뀌었습니다");
  else expect(await screen.findByText("참가자 명단에 1명을 추가했습니다.")).toBeTruthy();
  expect(JSON.parse(sessionStorage.getItem(key)!).input.people.map((person: { name: string }) => person.name)).toEqual(concurrent ? ["가상 기존"] : ["가상 기존", "가상 신규"]);
  expect(JSON.parse(sessionStorage.getItem(key)!).input.people[0].roomAssignment).toBe(concurrent ? "102호" : "101호");
  expect(sessionStorage.getItem(otherKey)).toBe(original);
});

it("vehicle surveys keep their owned scope and display a respondent link separately from the import", async () => {
  const data = { headers: ["참석 여부", "이름"], rows: [["O", "가상 참가자"]] };
  const survey = { data, mapping: defaultSurveyMapping(data.headers), source: { formId: "mock_form01", personIds: [`GF-${"b".repeat(44)}`] } };
  vi.mocked(backend.backendFetch).mockImplementation(async (_, init) => init ? { ...survey, respondentUrl: share } : status);
  const onImport = vi.fn();
  render(<TransportSurveyForm hasPeople={false} onImport={onImport} scope={scope} initialMode="google" />);
  expect(screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" })).toBeTruthy();
  await preview();
  expect(backend.backendFetch).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({
    body: JSON.stringify({ action: "preview", ...scope, url: editor }),
  }));
  expect((await screen.findByRole("link", { name: "응답 링크 열기" })).getAttribute("href")).toBe(share);
  fireEvent.click(screen.getByRole("button", { name: "신규 참석자 추가" }));
  expect(onImport).toHaveBeenCalledWith(survey);
});

it("keeps manual creation and creates a separate unpublished draft only on explicit submit", async () => {
  vi.mocked(backend.backendFetch).mockImplementation(async (path, init) =>
    path === draftEndpoint && init?.method === "POST" ? { editorUrl: editor } : status);
  vi.spyOn(backend, "flushBackendWrites").mockResolvedValue(undefined);
  const onImport = vi.fn();
  render(<TransportSurveyForm hasPeople={false} onImport={onImport} scope={scope} initialMode="google" />);
  const manual = screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" });
  expect(manual.getAttribute("href")).toBe("https://docs.google.com/forms/u/0/create");
  fireEvent.click(screen.getByRole("button", { name: "수련회 설문 초안 만들기" }));
  const title = await screen.findByRole("textbox", { name: "설문 제목" });
  fireEvent.change(title, { target: { value: "여름 수련회 참가 설문" } });
  expect(vi.mocked(backend.backendFetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "초안 생성" }));
  const editLink = await screen.findByRole("link", { name: "구글폼에서 설문 편집" });
  expect(editLink.getAttribute("href")).toBe(editor);
  expect(backend.backendFetch).toHaveBeenCalledWith(draftEndpoint, expect.objectContaining({
    method: "POST", body: JSON.stringify({ action: "create", title: "여름 수련회 참가 설문", roomId: scope.roomId, conversationId: scope.conversationId }),
  }));
  expect(screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "편집 주소 입력" }));
  expect(await screen.findByRole<HTMLInputElement>("textbox", { name: "구글폼 편집 주소" })).toHaveProperty("value", editor);
  expect(screen.queryByRole("link", { name: "응답 링크 열기" })).toBeNull();
  expect(onImport).not.toHaveBeenCalled();
});

it("manages draft OAuth separately from read access in settings", async () => {
  vi.mocked(backend.backendFetch).mockImplementation(async (path) =>
    path === draftEndpoint ? { ...status, connected: false } : status);
  render(<GoogleFormsConnection />);
  expect(await screen.findByRole("button", { name: "설문 생성 권한 연결" })).toBeTruthy();
  expect(await screen.findByRole("button", { name: "구글폼 연결 해제" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "구글폼에서 새 설문 만들기" })).toBeTruthy();
});

it("does not expose an unexpected edit link returned by the server", async () => {
  vi.mocked(backend.backendFetch).mockImplementation(async (path, init) =>
    path === draftEndpoint && init?.method === "POST" ? { editorUrl: "https://docs.google.com.evil.example/forms/d/mock_form01/edit" } : status);
  render(<GoogleFormsConnection />);
  fireEvent.click(await screen.findByRole("button", { name: "수련회 설문 초안 만들기" }));
  fireEvent.click(await screen.findByRole("button", { name: "초안 생성" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "설문 편집 주소를 확인하지 못했습니다.");
  expect(screen.queryByRole("link", { name: "구글폼에서 설문 편집" })).toBeNull();
});

it("keeps the known editor link when Google could not confirm the template", async () => {
  const warning = "편집기에서 문항과 게시 상태를 확인해 주세요.";
  vi.mocked(backend.backendFetch).mockImplementation(async (path, init) =>
    path === draftEndpoint && init?.method === "POST" ? { editorUrl: editor, warning } : status);
  render(<GoogleFormsConnection />);
  fireEvent.click(await screen.findByRole("button", { name: "수련회 설문 초안 만들기" }));
  fireEvent.click(await screen.findByRole("button", { name: "초안 생성" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", warning);
  expect(screen.getByRole("link", { name: "구글폼에서 설문 편집" }).getAttribute("href")).toBe(editor);
});

it("does not switch the editor URL while previewing a different form", async () => {
  let finishPreview!: (result: object) => void;
  const pendingPreview = new Promise<object>(resolve => { finishPreview = resolve; });
  vi.mocked(backend.backendFetch).mockImplementation(async (path, init) =>
    !init?.method ? status : path === draftEndpoint ? { editorUrl: editor } : pendingPreview);
  vi.spyOn(backend, "flushBackendWrites").mockResolvedValue(undefined);
  render(<TransportSurveyForm hasPeople={false} onImport={vi.fn()} scope={scope} initialMode="google" />);
  fireEvent.click(screen.getByRole("button", { name: "수련회 설문 초안 만들기" }));
  fireEvent.click(await screen.findByRole("button", { name: "초안 생성" }));
  await screen.findByRole("button", { name: "편집 주소 입력" });
  const input = screen.getByRole<HTMLInputElement>("textbox", { name: "구글폼 편집 주소" });
  const originalUrl = editor.replace("01", "02");
  fireEvent.change(input, { target: { value: originalUrl } });
  fireEvent.click(screen.getByRole("button", { name: "응답 미리보기" }));
  expect(screen.queryByRole("button", { name: "편집 주소 입력" })).toBeNull();
  expect(input.value).toBe(originalUrl);
  finishPreview({ respondentUrl: share, notice: "아직 접수된 설문 응답이 없습니다." });
  await screen.findByRole("link", { name: "응답 링크 열기" });
  fireEvent.click(screen.getByRole("button", { name: "편집 주소 입력" }));
  expect(input.value).toBe(editor);
  expect(screen.queryByRole("link", { name: "응답 링크 열기" })).toBeNull();
});

it("refreshes draft authorization after an expired grant without reloading settings", async () => {
  let expired = false;
  vi.mocked(backend.backendFetch).mockImplementation(async (path, init) => {
    if (path !== draftEndpoint) return status;
    if (!init?.method) return { ...status, connected: !expired, needsReconnect: expired };
    expired = true;
    throw new backend.BackendError("설문 생성 권한을 다시 연결해 주세요.", 409);
  });
  render(<GoogleFormsConnection />);
  fireEvent.click(await screen.findByRole("button", { name: "수련회 설문 초안 만들기" }));
  fireEvent.click(await screen.findByRole("button", { name: "초안 생성" }));
  expect(await screen.findByRole("button", { name: "설문 생성 권한 다시 연결" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "구글폼 연결 해제" })).toBeTruthy();
});
