import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsPanel } from "@/components/documents-panel";
import { createRoomMaterialsStore } from "@/lib/room-materials";

const remote = vi.hoisted(() => ({
  connected: true, flush: vi.fn(),
  store: { put: vi.fn(), get: vi.fn(), delete: vi.fn(), queueCleanup: vi.fn(), retireCleanup: vi.fn(), listCleanup: vi.fn(), isReferenced: vi.fn() }
}));
vi.mock("@/lib/backend-client", () => ({ isBackendConnected: () => remote.connected, flushBackendWrites: remote.flush, dataStorage: (fallback: unknown) => fallback }));
vi.mock("@/lib/server-blob-store", () => ({ createServerBlobStore: () => remote.store }));
const props = { roomId: "room-a", onAddExtractedEvent: vi.fn(), onAddExtractedChecklist: vi.fn() };
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  localStorage.clear(); remote.connected = true; remote.flush.mockReset().mockResolvedValue(undefined);
  for (const method of Object.values(remote.store)) method.mockReset().mockResolvedValue(undefined);
  remote.store.listCleanup.mockResolvedValue([]); remote.store.isReferenced.mockResolvedValue(false);
});
afterEach(async () => { await act(async () => {}); cleanup(); vi.restoreAllMocks(); });

describe("connected documents panel", () => {
  it("shows the server limits without listing file formats in the panel", () => {
    render(<DocumentsPanel {...props} />);
    expect(screen.getByText("서버 저장 · 파일당 최대 5 MiB · 행사방당 최대 1,000개")).toBeDefined();
    expect(screen.queryByText(/^미리보기:/)).toBeNull();
    expect(screen.queryByText(/^다운로드 전용:/)).toBeNull();
  });

  it("does not show a server file count when only browser storage is available", async () => {
    remote.connected = false;
    await act(async () => { render(<DocumentsPanel {...props} />); });
    expect(screen.getByText("이 브라우저에만 저장 · 파일당 최대 5 MiB")).toBeDefined();
    expect(screen.queryByText(/1,000개/)).toBeNull();
  });

  it("chooses the server adapter and waits for the metadata flush before reporting upload success", async () => {
    let finish!: () => void;
    remote.flush.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<DocumentsPanel {...props} />);
    fireEvent.change(screen.getByLabelText("파일 선택"), { target: { files: [new File(["x"], "remote.txt")] } });
    await waitFor(() => expect(remote.flush).toHaveBeenCalledOnce());
    expect(remote.store.put).toHaveBeenCalledOnce();
    expect(remote.store.retireCleanup).not.toHaveBeenCalled();
    expect(screen.queryByText(/서버 저장 완료/)).toBeNull();
    await act(async () => { finish(); });
    await screen.findByText(/remote.txt.*서버 저장 완료/);
    expect(remote.store.retireCleanup).toHaveBeenCalledOnce();
  });

  it("does not delete a file or retire its journal while metadata writes are failing", async () => {
    const file = { id: "live", title: "live.txt", kind: "file" as const, pinned: false, file: { name: "live.txt", size: 1, type: "text/plain" } };
    createRoomMaterialsStore(localStorage, props.roomId).updateDocuments(() => [file]);
    remote.flush.mockRejectedValue(Error("offline"));
    render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "live.txt 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제하기" }));
    await screen.findByRole("button", { name: "파일 정리 다시 시도" });
    expect(remote.store.queueCleanup).toHaveBeenCalledWith(props.roomId, "live");
    expect(remote.store.delete).not.toHaveBeenCalled();
    expect(remote.store.retireCleanup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(() => expect(remote.flush).toHaveBeenCalledTimes(2));
    expect(remote.store.delete).not.toHaveBeenCalled();
  });

  it("uses authoritative server references rather than optimistic client metadata on cleanup retry", async () => {
    remote.store.listCleanup.mockResolvedValue(["staged"]);
    remote.store.isReferenced.mockResolvedValue(true);
    createRoomMaterialsStore(localStorage, props.roomId).updateDocuments(() => []);
    render(<DocumentsPanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "파일 정리 다시 시도" }));
    await waitFor(() => expect(remote.store.retireCleanup).toHaveBeenCalledWith(props.roomId, "staged"));
    expect(remote.store.isReferenced).toHaveBeenCalledWith(props.roomId, "staged");
    expect(remote.store.delete).not.toHaveBeenCalled();
  });

  it("flushes pin and order edits and retains an unsaved order on server failure", async () => {
    render(<DocumentsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "회의록 예시 고정" }));
    await waitFor(() => expect(remote.flush).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole("button", { name: "순서 편집" }) as HTMLButtonElement).disabled).toBe(false));
    remote.flush.mockRejectedValueOnce(Error("conflict"));
    fireEvent.click(screen.getByRole("button", { name: "순서 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "순서 저장" }));
    await screen.findByText(/서버에 저장하지 못/);
    expect(screen.getByRole("button", { name: "순서 저장" })).toBeDefined();
  });
});
