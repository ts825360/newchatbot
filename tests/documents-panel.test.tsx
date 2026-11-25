import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsPanel } from "../components/documents-panel";
import { createRoomMaterialsStore, sampleDocuments } from "../lib/room-materials";
import { getStorageStatus, markStorageStatus } from "../lib/storage-status";
import { syntheticResume, syntheticWord } from "./fixtures/synthetic-word";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => { localStorage.clear(); props.blobStore = memoryBlobs(); });
afterEach(async () => { vi.useRealTimers(); await act(async () => {}); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const titles = () => screen.getAllByTestId("document-title").map((element) => element.textContent);
const memoryBlobs = () => {
  const blobs = new Map<string, Blob>();
  const intents = new Map<string, { room: string; id: string }>();
  const key = (room: string, id: string) => JSON.stringify([room, id]);
  return {
    put: vi.fn(async (room: string, id: string, blob: Blob) => { blobs.set(key(room, id), blob); intents.set(key(room, id), { room, id }); }),
    get: vi.fn(async (room: string, id: string) => blobs.get(JSON.stringify([room, id]))),
    delete: vi.fn(async (room: string, id: string) => { blobs.delete(key(room, id)); intents.delete(key(room, id)); }),
    queueCleanup: vi.fn(async (room: string, id: string) => { intents.set(key(room, id), { room, id }); }),
    listCleanup: vi.fn(async (room: string) => [...intents.values()].filter((intent) => intent.room === room).map((intent) => intent.id)),
    retireCleanup: vi.fn(async (room: string, id: string) => { intents.delete(key(room, id)); })
  };
};
const props = { roomId: "room-a", onAddExtractedEvent: vi.fn(), onAddExtractedChecklist: vi.fn(), blobStore: memoryBlobs() };
const selectFiles = (...files: File[]) => fireEvent.change(screen.getByLabelText("파일 선택"), { target: { files } });
const uploaded = async (name: string) => waitFor(() => expect(titles()).toContain(name));
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "photo.png", { type: "image/png" });

describe("documents panel", () => {
  it("renders a Word resume and its table in the same dialog without activating markup", async () => {
    render(<DocumentsPanel {...props} />);
    selectFiles(new File([syntheticWord(syntheticResume)], "가상 이력서.docx"));
    await uploaded("가상 이력서.docx");
    fireEvent.click(screen.getByRole("button", { name: "가상 이력서.docx 보기" }));
    const viewer = within(screen.getByRole("dialog", { name: "가상 이력서.docx" }));
    expect(await viewer.findByRole("heading", { name: "가상 이력서" })).toBeDefined();
    expect(within(viewer.getByRole("table")).getByRole("cell", { name: "<img src=x>" })).toBeDefined();
    expect(viewer.queryByRole("img")).toBeNull();
  });
  it("opens the PDF preview dialog with a download action and no active embed", async () => {
    const store = memoryBlobs();
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["%PDF-1.7\n"], "notice.pdf"));
    await uploaded("notice.pdf");
    fireEvent.click(screen.getByRole("button", { name: "notice.pdf 보기" }));
    const viewer = screen.getByRole("dialog", { name: "notice.pdf" });
    expect(within(viewer).getByRole("button", { name: "notice.pdf 다운로드" })).toBeDefined();
    expect(viewer.querySelector("iframe, object, embed")).toBeNull();
    fireEvent.click(within(viewer).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lazily opens a CSV in a modal with accessible columns and plain-text cells", async () => {
    const store = memoryBlobs();
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(['부서,메모\n청년부,"<img src=x>, 지각 없음"\n'], "응답.csv"));
    await uploaded("응답.csv");
    expect(store.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "응답.csv 보기" }));
    const viewer = screen.getByRole("dialog", { name: "응답.csv" });
    const table = await within(viewer).findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "부서" })).toBeDefined();
    expect(within(table).getByRole("cell", { name: "<img src=x>, 지각 없음" })).toBeDefined();
    expect(viewer.querySelector("img")).toBeNull();
  });
  it("stages order until save, cancels, and persists saved order", () => {
    const view = render(<DocumentsPanel {...props} />);
    const original = titles();
    fireEvent.click(screen.getByRole("button", { name: "순서 편집" }));
    fireEvent.click(screen.getByRole("button", { name: `${original[1]} 위로` }));
    expect(createRoomMaterialsStore(localStorage, props.roomId).loadDocuments().map((doc) => doc.title)).toEqual(original);
    expect(titles()[0]).toBe(original[1]);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(titles()).toEqual(original);
    fireEvent.click(screen.getByRole("button", { name: "순서 편집" }));
    fireEvent.click(screen.getByRole("button", { name: `${original[1]} 위로` }));
    fireEvent.click(screen.getByRole("button", { name: "순서 저장" }));
    view.unmount();
    render(<DocumentsPanel {...props} />);
    expect(titles()[0]).toBe(original[1]);
  });

  it("pins above ordinary documents and unpins across reload", () => {
    const view = render(<DocumentsPanel {...props} />);
    const title = sampleDocuments[2].title;
    fireEvent.click(screen.getByRole("button", { name: `${title} 고정` }));
    expect(within(screen.getByRole("region", { name: "고정 자료" })).getByText(title)).toBeDefined();
    expect(titles()[0]).toBe(title);
    view.unmount();
    render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: `${title} 고정 해제` }));
    expect(screen.queryByRole("region", { name: "고정 자료" })).toBeNull();
  });

  it("confirms deletion, supports cancel and keeps a deleted-empty list after reload", () => {
    const view = render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: `${sampleDocuments[0].title} 삭제` }));
    expect(titles()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    for (const doc of sampleDocuments) {
      fireEvent.click(screen.getByRole("button", { name: `${doc.title} 삭제` }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    }
    view.unmount();
    render(<DocumentsPanel {...props} />);
    expect(screen.getByText("자료가 없습니다.")).toBeDefined();
  });

  it("retains pending order on storage failure", () => {
    render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "순서 편집" }));
    fireEvent.click(screen.getByRole("button", { name: `${sampleDocuments[1].title} 위로` }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "순서 저장" }));
    expect(screen.getByRole("alert").textContent).toMatch(/저장하지 못/);
    expect(screen.getByRole("button", { name: "순서 저장" })).toBeDefined();
    expect(titles()[0]).toBe(sampleDocuments[1].title);
  });

  it("updates same-tab and cross-tab changes, drops deleted IDs from a pending order", () => {
    render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "순서 편집" }));
    const store = createRoomMaterialsStore(localStorage, props.roomId);
    act(() => { store.updateDocuments((docs) => docs.slice(1)); });
    expect(titles()).toHaveLength(2);
    localStorage.setItem(store.documentsKey, JSON.stringify({ version: 1, items: [] }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: store.documentsKey, storageArea: localStorage })));
    fireEvent.click(screen.getByRole("button", { name: "순서 저장" }));
    expect(store.loadDocuments()).toEqual([]);
  });

  it("preserves meeting-minutes extraction actions", () => {
    render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "회의록 예시 보기" }));
    expect(screen.getByRole("dialog", { name: "회의록 예시" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "일정 후보 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "준비 항목 추가" }));
    expect(props.onAddExtractedEvent).toHaveBeenCalled();
    expect(props.onAddExtractedChecklist).toHaveBeenCalled();
  });

  it("keeps pin and delete state intact when saving fails", () => {
    render(<DocumentsPanel {...props} />);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: `${sampleDocuments[0].title} 고정` }));
    expect(screen.queryByRole("region", { name: "고정 자료" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/저장하지 못/);
    fireEvent.click(screen.getByRole("button", { name: `${sampleDocuments[0].title} 삭제` }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(titles()).toHaveLength(3);
    write.mockRestore();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titles()).toHaveLength(2);
  });

  it("loads the next room without leaking the previous room's documents or pending order", () => {
    createRoomMaterialsStore(localStorage, "room-b").updateDocuments(() => []);
    const view = render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "순서 편집" }));
    view.rerender(<DocumentsPanel {...props} roomId="room-b" />);
    expect(screen.queryByTestId("document-title")).toBeNull();
    expect(screen.queryByRole("button", { name: "순서 저장" })).toBeNull();
    expect(screen.getByText("자료가 없습니다.")).toBeDefined();
    view.rerender(<DocumentsPanel {...props} />);
    expect(titles()).toHaveLength(3);
  });

  it("opens sample proposal review without immediately adding candidates", () => {
    const review = vi.fn();
    const addEvent = vi.fn();
    const addChecklist = vi.fn();
    render(<DocumentsPanel {...props} onReviewProposals={review} onAddExtractedEvent={addEvent} onAddExtractedChecklist={addChecklist} />);
    fireEvent.click(screen.getByRole("button", { name: "회의록 예시 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "제안 검토" }));
    expect(review).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(addEvent).not.toHaveBeenCalled();
    expect(addChecklist).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "일정 후보 추가" })).toBeNull();
  });

  it("rejects hostile extensions and oversized files per file", async () => {
    render(<DocumentsPanel {...props} />);
    fireEvent.change(screen.getByLabelText("파일 선택"), { target: { files: [
      new File(["<script>bad()</script>"], "bad.HTML", { type: "text/html" }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" })
    ] } });
    await waitFor(() => expect(screen.getByText(/bad.HTML.*지원하지/)).toBeDefined());
    expect(screen.getByText(/large.pdf.*5 MiB/)).toBeDefined();
    expect(titles()).toHaveLength(3);
  });

  it("retains draft on IDB failure, retries, reloads metadata and renders hostile text literally", async () => {
    const store = memoryBlobs();
    store.put.mockRejectedValueOnce(Error("quota"));
    const addEvent = vi.fn();
    const view = render(<DocumentsPanel {...props} blobStore={store} onAddExtractedEvent={addEvent} />);
    const hostile = '<script>window.evil = true</script><img src=x onerror=evil()>';
    selectFiles(new File([hostile], "notes.MD", { type: "text/html" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "notes.MD 다시 저장" })).toBeDefined());
    expect(titles()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "notes.MD 다시 저장" }));
    await uploaded("notes.MD");
    expect(screen.getByText(/로컬 저장 완료/)).toBeDefined();
    view.unmount();
    render(<DocumentsPanel {...props} blobStore={store} />);
    fireEvent.click(screen.getByRole("button", { name: "notes.MD 보기" }));
    await waitFor(() => expect(screen.getByText(hostile)).toBeDefined());
    expect(document.querySelector(".documents-preview script")).toBeNull();
    expect(document.querySelector(".documents-preview img")).toBeNull();
    expect(store.get).toHaveBeenCalledWith(props.roomId, expect.any(String));
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("shows local saving until blob completion and rolls back after metadata failure", async () => {
    const store = memoryBlobs();
    let finish!: () => void;
    const original = store.put;
    store.put = vi.fn(async (...args) => { await new Promise<void>((resolve) => { finish = resolve; }); await original(...args); });
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["x"], "waiting.txt"));
    expect(screen.getByText(/로컬 저장 중/)).toBeDefined();
    expect(titles()).toHaveLength(3);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("full"); });
    await act(async () => { finish(); });
    await waitFor(() => expect(store.delete).toHaveBeenCalledOnce());
    expect(titles()).toHaveLength(3);
    expect(screen.queryByText(/로컬 저장 완료/)).toBeNull();
    expect(screen.getByRole("button", { name: "waiting.txt 다시 저장" })).toBeDefined();
  });

  it("deletes uploaded metadata before blob cleanup and offers cleanup retry without restoring metadata", async () => {
    const store = memoryBlobs();
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["x"], "remove.txt"));
    await uploaded("remove.txt");
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("full"); });
    fireEvent.click(screen.getByRole("button", { name: "remove.txt 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeDefined());
    expect(store.delete).not.toHaveBeenCalled();
    expect(titles()).toContain("remove.txt");
    write.mockRestore();
    store.delete.mockImplementationOnce(async (room) => {
      expect(createRoomMaterialsStore(localStorage, room).loadDocuments().some((doc) => doc.title === "remove.txt")).toBe(false);
      throw Error("locked");
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "파일 정리 다시 시도" })).toBeDefined());
    expect(titles()).not.toContain("remove.txt");
    expect(screen.getByText(/자료는 삭제.*파일 정리/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "파일 정리 다시 시도" })).toBeNull());
  });

  it("revokes image preview URLs on close, delete, room switch and unmount", async () => {
    const revoke = vi.fn();
    const create = vi.fn(() => `blob:preview-${revoke.mock.calls.length}`);
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const store = memoryBlobs();
    const view = render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(png());
    await uploaded("photo.png");
    const open = async () => {
      fireEvent.click(screen.getByRole("button", { name: "photo.png 보기" }));
      await waitFor(() => expect(screen.getByAltText("photo.png")).toBeDefined());
    };
    await open();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
    expect(revoke).toHaveBeenCalledTimes(1);
    await open();
    view.rerender(<DocumentsPanel {...props} roomId="room-b" blobStore={store} />);
    expect(revoke).toHaveBeenCalledTimes(2);
    view.rerender(<DocumentsPanel {...props} blobStore={store} />);
    await open();
    act(() => { createRoomMaterialsStore(localStorage, props.roomId).updateDocuments(items => items.filter(doc => doc.title !== "photo.png")); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(3));
    selectFiles(png());
    await uploaded("photo.png");
    await open();
    view.unmount();
    expect(revoke).toHaveBeenCalledTimes(4);
  });

  it("never creates a preview URL after a pending preview is closed", async () => {
    const store = memoryBlobs();
    const create = vi.fn(() => "blob:late");
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(png());
    await uploaded("photo.png");
    let finish!: (blob: Blob) => void;
    store.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "photo.png 보기" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
    await act(async () => { finish(png()); });
    expect(create).not.toHaveBeenCalled();
  });

  it("shows safe download-only and download error states", async () => {
    const store = memoryBlobs();
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["office bytes"], "plan.docx"));
    await uploaded("plan.docx");
    fireEvent.click(screen.getByRole("button", { name: "plan.docx 보기" }));
    const viewer = within(screen.getByRole("dialog", { name: "plan.docx" }));
    expect(await viewer.findByText(/이 파일은 미리볼 수 없습니다/)).toBeDefined();
    store.get.mockRejectedValueOnce(Error("missing"));
    fireEvent.click(viewer.getByRole("button", { name: "plan.docx 다운로드" }));
    await waitFor(() => expect(screen.getByText(/다운로드하지 못/)).toBeDefined());
    expect(screen.queryByText(/다운로드 시작/)).toBeNull();
  });

  it("keeps pending order through focus and merges same-tab/cross-tab changes without resurrecting deletion", () => {
    render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "순서 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "진행 일정표 예시 위로" }));
    fireEvent.focus(window);
    expect(titles()[0]).toBe("진행 일정표 예시");
    act(() => { createRoomMaterialsStore(localStorage, props.roomId).updateDocuments((items) => items.filter((doc) => doc.id !== "sample-minutes")); });
    expect(titles()).not.toContain("회의록 예시");
    const store = createRoomMaterialsStore(localStorage, props.roomId);
    localStorage.setItem(store.documentsKey, JSON.stringify({ version: 1, items: [{ ...sampleDocuments[2], pinned: true }] }));
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: store.documentsKey, storageArea: localStorage })); });
    fireEvent.click(screen.getByRole("button", { name: "순서 저장" }));
    expect(titles()).toEqual(["준비물 목록 예시"]);
    expect(store.loadDocuments()).toEqual([{ ...sampleDocuments[2], pinned: true }]);
  });

  it("keeps the preview URL when metadata is updated or pinning moves the list row", async () => {
    const store = memoryBlobs();
    const create = vi.fn(() => "blob:stable");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(png());
    await uploaded("photo.png");
    fireEvent.click(screen.getByRole("button", { name: "photo.png 보기" }));
    await screen.findByAltText("photo.png");
    fireEvent.focus(window);
    act(() => { createRoomMaterialsStore(localStorage, props.roomId).updateDocuments((items) => items.map((doc) => doc.id === "sample-supplies" ? { ...doc, title: "Updated sample" } : doc)); });
    await act(async () => {});
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    act(() => { createRoomMaterialsStore(localStorage, props.roomId).updateDocuments(items => items.map(doc => doc.title === "photo.png" ? { ...doc, pinned: true } : doc)); });
    expect(within(screen.getByRole("dialog")).getByAltText("photo.png")).toBeDefined();
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
    expect(revoke).toHaveBeenCalledOnce();
    expect(within(screen.getByRole("region", { name: "고정 자료" })).getByText("photo.png")).toBeDefined();
  });

  it("previews and downloads every sample as sample text, retaining fallback callbacks", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:sample");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const add = vi.fn();
    render(<DocumentsPanel {...props} onAddExtractedEvent={add} />);
    markStorageStatus("idle");
    for (const doc of sampleDocuments) {
      fireEvent.click(screen.getByRole("button", { name: `${doc.title} 보기` }));
      expect(document.querySelector(".documents-preview pre")?.textContent).toContain("[샘플 자료]");
      if (doc.kind === "minutes") fireEvent.click(screen.getByRole("button", { name: "일정 후보 추가" }));
      const viewer = within(screen.getByRole("dialog", { name: doc.title }));
      fireEvent.click(viewer.getByRole("button", { name: `${doc.title} 다운로드` }));
      fireEvent.click(viewer.getByRole("button", { name: "닫기" }));
    }
    expect(add).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledTimes(3);
    expect(getStorageStatus().phase).toBe("idle");
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("rolls back pending uploads when the room is switched without leaking next-room state", async () => {
    const store = memoryBlobs();
    let finish!: () => void;
    const put = store.put;
    store.put = vi.fn(async (room, id, blob) => { await new Promise<void>((resolve) => { finish = resolve; }); await put(room, id, blob); });
    const view = render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["x"], "pending.txt"));
    view.rerender(<DocumentsPanel {...props} roomId="room-b" blobStore={store} />);
    await act(async () => { finish(); });
    expect(store.delete).toHaveBeenCalledWith(props.roomId, expect.any(String));
    expect(titles()).not.toContain("pending.txt");
    expect(screen.queryByText(/pending.txt.*저장/)).toBeNull();
    expect(createRoomMaterialsStore(localStorage, props.roomId).loadDocuments()).toEqual(sampleDocuments);
  });

  it("restores failed deletion intents after remount and retires them only after successful cleanup", async () => {
    const store = memoryBlobs();
    const view = render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["kept bytes"], "recover.txt"));
    await uploaded("recover.txt");
    const id = createRoomMaterialsStore(localStorage, props.roomId).loadDocuments().find((doc) => doc.kind === "file")!.id;
    store.delete.mockRejectedValueOnce(Error("temporary"));
    fireEvent.click(screen.getByRole("button", { name: "recover.txt 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    await screen.findByRole("button", { name: "파일 정리 다시 시도" });
    expect(await store.listCleanup(props.roomId)).toEqual([id]);
    expect(await store.get(props.roomId, id)).toBeDefined();
    view.unmount();
    render(<DocumentsPanel {...props} blobStore={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "파일 정리 다시 시도" })).toBeNull());
    expect(await store.get(props.roomId, id)).toBeUndefined();
    expect(await store.listCleanup(props.roomId)).toEqual([]);
    expect(titles()).not.toContain("recover.txt");
  });

  it("recovers deletion failure that arrives after unmount", async () => {
    const store = memoryBlobs();
    const view = render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["x"], "late-delete.txt"));
    await uploaded("late-delete.txt");
    let fail!: (cause: Error) => void;
    store.delete.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "late-delete.txt 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    await waitFor(() => expect(store.delete).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { fail(Error("late failure")); });
    render(<DocumentsPanel {...props} blobStore={store} />);
    expect(await screen.findByRole("button", { name: "파일 정리 다시 시도" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(async () => expect(await store.listCleanup(props.roomId)).toEqual([]));
  });

  it("recovers provisional upload rollback failure after unmount and navigation", async () => {
    const store = memoryBlobs();
    const put = store.put;
    let finish!: () => void;
    store.put.mockImplementationOnce(async (room, id, blob) => { await new Promise<void>((resolve) => { finish = resolve; }); await put(room, id, blob); });
    store.delete.mockRejectedValueOnce(Error("rollback failed"));
    const view = render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["x"], "late-upload.txt"));
    view.rerender(<DocumentsPanel {...props} roomId="room-b" blobStore={store} />);
    await act(async () => { finish(); });
    expect(screen.queryByRole("button", { name: "파일 정리 다시 시도" })).toBeNull();
    view.rerender(<DocumentsPanel {...props} blobStore={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(async () => expect(await store.listCleanup(props.roomId)).toEqual([]));
    expect(titles()).not.toContain("late-upload.txt");
  });

  it("does not remove metadata until the cleanup intent is durable", async () => {
    const store = memoryBlobs();
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["x"], "protected.txt"));
    await uploaded("protected.txt");
    let finish!: () => void;
    const queue = store.queueCleanup;
    store.queueCleanup.mockImplementationOnce(async (room, id) => { await new Promise<void>((resolve) => { finish = resolve; }); await queue(room, id); });
    fireEvent.click(screen.getByRole("button", { name: "protected.txt 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    expect(titles()).toContain("protected.txt");
    expect(store.delete).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await waitFor(() => expect(titles()).not.toContain("protected.txt"));
  });

  it("keeps metadata and Blob intact when journaling deletion fails", async () => {
    const store = memoryBlobs();
    render(<DocumentsPanel {...props} blobStore={store} />);
    selectFiles(new File(["x"], "journal-error.txt"));
    await uploaded("journal-error.txt");
    store.queueCleanup.mockRejectedValueOnce(Error("quota"));
    fireEvent.click(screen.getByRole("button", { name: "journal-error.txt 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeDefined());
    expect(titles()).toContain("journal-error.txt");
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("rechecks current metadata on retry and preserves a now-live referenced Blob", async () => {
    const store = memoryBlobs();
    const file = new File(["live"], "live.txt");
    const doc = { id: "live", title: file.name, kind: "file" as const, pinned: false, file: { name: file.name, size: file.size, type: "text/plain" } };
    await store.put(props.roomId, doc.id, file);
    render(<DocumentsPanel {...props} blobStore={store} />);
    await screen.findByRole("button", { name: "파일 정리 다시 시도" });
    // No storage event: retry must read storage, not the rendered snapshot.
    const materials = createRoomMaterialsStore(localStorage, props.roomId);
    localStorage.setItem(materials.documentsKey, JSON.stringify({ version: 1, items: [doc] }));
    fireEvent.click(screen.getByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "파일 정리 다시 시도" })).toBeNull());
    expect(store.delete).not.toHaveBeenCalled();
    expect(await store.get(props.roomId, doc.id)).toBeDefined();
    expect(await store.listCleanup(props.roomId)).toEqual([]);
  });

  it("retains cleanup intents when metadata is unreadable and allows later safe retry", async () => {
    const store = memoryBlobs();
    await store.put(props.roomId, "orphan", new Blob(["x"]));
    render(<DocumentsPanel {...props} blobStore={store} />);
    await screen.findByRole("button", { name: "파일 정리 다시 시도" });
    const key = createRoomMaterialsStore(localStorage, props.roomId).documentsKey;
    localStorage.setItem(key, "corrupt");
    fireEvent.click(screen.getByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(() => expect(getStorageStatus().phase).toBe("failed"));
    expect(store.delete).not.toHaveBeenCalled();
    expect(await store.listCleanup(props.roomId)).toEqual(["orphan"]);
    localStorage.setItem(key, JSON.stringify({ version: 1, items: [] }));
    fireEvent.click(screen.getByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "파일 정리 다시 시도" })).toBeNull());
  });
});
