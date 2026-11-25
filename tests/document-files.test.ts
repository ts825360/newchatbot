import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIndexedDBBlobStore, documentFileMetadata, downloadDocumentBlob,
  isDocumentFileMetadata, prepareDocumentPreview, reconcileDocumentCleanup, saveDocumentFile, type BlobStore
} from "../lib/document-files";
import { syntheticResume, syntheticWord } from "./fixtures/synthetic-word";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function memoryStore(): BlobStore {
  const blobs = new Map<string, Blob>();
  const intents = new Map<string, { room: string; id: string }>();
  const key = (room: string, id: string) => JSON.stringify([room, id]);
  return {
    put: vi.fn(async (room, id, blob) => { blobs.set(key(room, id), blob); intents.set(key(room, id), { room, id }); }),
    get: vi.fn(async (room, id) => blobs.get(key(room, id))),
    delete: vi.fn(async (room, id) => { blobs.delete(key(room, id)); intents.delete(key(room, id)); }),
    queueCleanup: vi.fn(async (room, id) => { intents.set(key(room, id), { room, id }); }),
    listCleanup: vi.fn(async (room) => [...intents.values()].filter((intent) => intent.room === room).map((intent) => intent.id)),
    retireCleanup: vi.fn(async (room, id) => { intents.delete(key(room, id)); })
  };
}

describe("document files", () => {
  it("previews Word body and table contents as inert structured text", async () => {
    const file = new File([syntheticWord(syntheticResume)], "resume.docx");
    expect(await prepareDocumentPreview(documentFileMetadata(file), file)).toEqual({
      kind: "word", truncated: false, blocks: [
        { kind: "paragraph", heading: true, text: "가상 이력서" },
        { kind: "paragraph", heading: false, text: "모의 경력\t운영팀" },
        { kind: "table", rows: [{ header: false, cells: ["경력", "<img src=x>"] }] },
      ],
    });
  });

  it.each([
    () => syntheticWord('<w:p/>', '<!DOCTYPE w:document SYSTEM "https://example.invalid/entity">'),
    () => syntheticWord('<w:p><w:r><w:t>' + "a".repeat(2 * 1024 * 1024) + '</w:t></w:r></w:p>'),
  ])("does not render a Word file that exceeds safe preview limits", async archive => {
    const file = new File([archive()], "limited.docx");
    expect(await prepareDocumentPreview(documentFileMetadata(file), file)).toEqual({ kind: "unavailable" });
  });
  it("bounds the CSV preview and preserves CSV quoting", async () => {
    const file = new File(['이름,확인\n연습,"a,b"\n' + "다음,행\n".repeat(105)], "survey.csv");
    const preview = await prepareDocumentPreview(documentFileMetadata(file), file);
    expect(preview).toMatchObject({ kind: "table", headers: ["이름", "확인"], rows: expect.arrayContaining([["연습", "a,b"]]), truncated: true });
    if (preview.kind === "table") expect(preview.rows).toHaveLength(100);
  });

  it("bounds large text previews without changing the downloadable file", async () => {
    const file = new File(["Hi ".repeat(90000)], "large.txt");
    const preview = await prepareDocumentPreview(documentFileMetadata(file), file);
    expect(preview).toMatchObject({ kind: "text", truncated: true });
    if (preview.kind === "text") expect(preview.text.length).toBeLessThan(file.size);
  });
  it.each(["txt", "MD", "csv", "pdf", "png", "jpg", "JPEG", "xlsx", "docx", "hwp", "HWPX", "gif", "webp", "xls", "pptx", "ods"])("accepts %s case-insensitively with canonical safe MIME", (ext) => {
    const metadata = documentFileMetadata(new File(["data"], `notes.${ext}`, { type: "text/html" }));
    expect(isDocumentFileMetadata(metadata)).toBe(true);
    expect(metadata.type).not.toBe("text/html");
  });

  it.each(["evil.html", "evil.svg", "notes.txt.exe", "no-extension", "txt", "pdf"])("rejects %s", (name) => {
    expect(() => documentFileMetadata(new File(["bad"], name))).toThrow(/지원하지/);
  });

  it("accepts exactly 5 MiB but rejects larger or invalid lengths", () => {
    expect(documentFileMetadata({ name: "a.pdf", size: 5 * 1024 * 1024 }).size).toBe(5 * 1024 * 1024);
    expect(() => documentFileMetadata({ name: "a.pdf", size: 5 * 1024 * 1024 + 1 })).toThrow(/5 MiB/);
    expect(isDocumentFileMetadata({ name: "a.txt", size: NaN, type: "text/plain" })).toBe(false);
  });

  it("awaits blob completion before publishing metadata and isolates composite room/document keys", async () => {
    const store = memoryStore();
    const original = store.put;
    let finish!: () => void;
    store.put = vi.fn(async (room: string, id: string, blob: Blob) => { await new Promise<void>((resolve) => { finish = resolve; }); await original(room, id, blob); });
    const commit = vi.fn(() => true);
    const saving = saveDocumentFile(store, "a", "same", new File(["first"], "a.txt"), commit);
    expect(commit).not.toHaveBeenCalled();
    finish();
    await saving;
    expect(commit).toHaveBeenCalledOnce();
    await original("b", "same", new Blob(["second"]));
    await store.delete("a", "same");
    expect(await store.get("a", "same")).toBeUndefined();
    expect((await store.get("b", "same"))?.size).toBe(6);
  });

  it("does not publish metadata after blob failure", async () => {
    const store = memoryStore();
    vi.mocked(store.put).mockRejectedValueOnce(Error("quota"));
    const commit = vi.fn();
    await expect(saveDocumentFile(store, "a", "id", new File(["x"], "x.txt"), commit)).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it.each([false, "throw"])("rolls back new blobs on metadata failure %s", async (failure) => {
    const store = memoryStore();
    await expect(saveDocumentFile(store, "a", "id", new File(["x"], "x.txt"), () => {
      if (failure === "throw") throw Error("metadata");
      return false;
    })).rejects.toThrow(/저장/);
    expect(await store.get("a", "id")).toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith("a", "id");
  });

  it("reports recoverable rollback cleanup failure", async () => {
    const store = memoryStore();
    vi.mocked(store.delete).mockRejectedValueOnce(Error("locked"));
    await expect(saveDocumentFile(store, "a", "id", new File(["x"], "x.txt"), () => false)).rejects.toThrow(/정리.*다시/);
    expect(await store.listCleanup("a")).toEqual(["id"]);
  });

  it("retires provisional cleanup intent only after metadata success", async () => {
    const store = memoryStore();
    await saveDocumentFile(store, "a", "id", new File(["x"], "x.txt"), () => {
      expect(store.retireCleanup).not.toHaveBeenCalled();
      return true;
    });
    expect(await store.listCleanup("a")).toEqual([]);
    expect(await store.get("a", "id")).toBeDefined();
  });

  it("waits for asynchronous metadata persistence before retiring the staged upload", async () => {
    const store = memoryStore();
    let finish!: (saved: boolean) => void;
    const commit = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const saving = saveDocumentFile(store, "a", "id", new File(["x"], "x.txt"), commit);
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(store.retireCleanup).not.toHaveBeenCalled();
    expect(store.put).toHaveBeenCalledWith("a", "id", expect.any(Blob), { name: "x.txt", size: 1, type: "text/plain" });
    finish(true);
    await saving;
    expect(store.retireCleanup).toHaveBeenCalledOnce();
  });

  it("rolls back after an asynchronous metadata rejection using the awaited authoritative reference", async () => {
    const store = memoryStore();
    await expect(saveDocumentFile(store, "a", "id", new File(["x"], "x.txt"), async () => false, async () => false)).rejects.toThrow(/저장/);
    expect(store.delete).toHaveBeenCalledWith("a", "id");
    expect(await store.listCleanup("a")).toEqual([]);
  });

  it("preserves a staged file and journal when the asynchronous reference request fails", async () => {
    const store = memoryStore();
    await store.put("a", "id", new Blob(["x"]));
    await expect(reconcileDocumentCleanup(store, "a", "id", async () => { throw Error("offline"); })).rejects.toThrow("offline");
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.retireCleanup).not.toHaveBeenCalled();
    expect(await store.listCleanup("a")).toEqual(["id"]);
  });

  it("preserves a live file after a delayed authoritative reference response", async () => {
    const store = memoryStore();
    await store.put("a", "id", new Blob(["x"]));
    let finish!: (referenced: boolean) => void;
    const cleaning = reconcileDocumentCleanup(store, "a", "id", () => new Promise<boolean>((resolve) => { finish = resolve; }));
    expect(store.retireCleanup).not.toHaveBeenCalled();
    finish(true);
    expect(await cleaning).toBe("referenced");
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("does not roll back a live Blob when retiring its provisional intent fails", async () => {
    const store = memoryStore();
    vi.mocked(store.retireCleanup).mockRejectedValueOnce(Error("locked"));
    await expect(saveDocumentFile(store, "a", "id", new File(["x"], "x.txt"), () => true)).rejects.toMatchObject({ metadataSaved: true });
    expect(store.delete).not.toHaveBeenCalled();
    expect(await store.listCleanup("a")).toEqual(["id"]);
    await reconcileDocumentCleanup(store, "a", "id", () => true);
    expect(await store.listCleanup("a")).toEqual([]);
    expect(await store.get("a", "id")).toBeDefined();
  });

  it("does not delete or retire when the current metadata read fails", async () => {
    const store = memoryStore();
    await store.put("a", "id", new Blob(["x"]));
    await expect(reconcileDocumentCleanup(store, "a", "id", () => { throw Error("unreadable"); })).rejects.toThrow();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.retireCleanup).not.toHaveBeenCalled();
    expect(await store.listCleanup("a")).toEqual(["id"]);
  });

  it.each(["txt", "md", "csv"])("prepares hostile %s contents as plain text only", async (ext) => {
    const file = new File(['<svg onload="evil()"><script>evil()</script></svg>'], `notes.${ext}`, { type: "text/html" });
    expect(await prepareDocumentPreview(documentFileMetadata(file), file)).toEqual({ kind: "text", text: '<svg onload="evil()"><script>evil()</script></svg>' });
  });

  it.each(["xlsx", "docx", "png", "pdf"])("does not render renamed HTML/SVG in %s", async (ext) => {
    const file = new File(["<svg onload='evil()'></svg>"], `bad.${ext}`);
    expect((await prepareDocumentPreview(documentFileMetadata(file), file)).kind).toBe("unavailable");
  });

  it("recognizes image and PDF bytes without trusting the incoming MIME", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "a.png");
    expect((await prepareDocumentPreview(documentFileMetadata(png), png)).kind).toBe("image");
    const pdf = new File(["%PDF-1.7\n"], "a.pdf");
    expect((await prepareDocumentPreview(documentFileMetadata(pdf), pdf)).kind).toBe("pdf");
  });

  it("keeps download URLs alive for browser handoff, then revokes them", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:download");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("notes.txt");
      expect(revoke).not.toHaveBeenCalled();
    });
    downloadDocumentBlob(new Blob(["notes"]), "notes.txt");
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:download");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("releases download URLs even if the browser click throws", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:failed", revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw Error("blocked"); });
    expect(() => downloadDocumentBlob(new Blob(), "notes.txt")).toThrow();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:failed");
  });
});

// Deliberately small transaction harness: request success is distinct from commit.
function indexedDBHarness() {
  const stores = new Map<string, Map<string, unknown>>([["files", new Map()]]);
  let version = 1;
  type Transaction = { oncomplete?: () => void; onabort?: () => void; onerror?: () => void; error?: Error };
  const transactions: Transaction[] = [];
  const close = vi.fn();
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: vi.fn((name: string) => { if (stores.has(name)) throw Error("exists"); stores.set(name, new Map()); }), close,
    transaction: vi.fn((names: string | string[]) => {
      const scope = typeof names === "string" ? [names] : names;
      const staged = new Map(scope.map((name) => {
        if (!stores.has(name)) throw Error("missing store");
        return [name, new Map(stores.get(name))];
      }));
      const tx: Transaction & { objectStore: (name: string) => unknown; abort: () => void } = {
        objectStore: (name) => {
          const values = staged.get(name);
          if (!values) throw Error("outside transaction");
          return {
            put: (value: unknown, key: unknown) => request(() => { values.set(JSON.stringify(key), value); }),
            get: (key: unknown) => request(() => values.get(JSON.stringify(key))),
            getAll: () => request(() => [...values.values()]),
            delete: (key: unknown) => request(() => { values.delete(JSON.stringify(key)); })
          };
        },
        abort: () => { tx.onabort?.(); }
      };
      transactions.push({
        oncomplete: () => { for (const [name, values] of staged) stores.set(name, values); tx.oncomplete?.(); },
        onabort: () => tx.onabort?.(), onerror: () => tx.onerror?.()
      });
      return tx;
    })
  };
  const request = (action: () => unknown) => {
    const req: { result?: unknown; onsuccess?: () => void } = {};
    queueMicrotask(() => { req.result = action(); req.onsuccess?.(); });
    return req;
  };
  const factory = { open: vi.fn((_name: string, nextVersion: number) => {
    const req: { result: typeof db; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: db };
    queueMicrotask(() => { if (nextVersion > version) { req.onupgradeneeded?.(); version = nextVersion; } req.onsuccess?.(); });
    return req;
  }) } as unknown as IDBFactory;
  const finish = async <T,>(operation: Promise<T>) => {
    await vi.waitFor(() => expect(transactions.length).toBeGreaterThan(0));
    transactions.shift()!.oncomplete?.();
    return operation;
  };
  return { factory, transactions, db, stores, finish, version: () => version };
}

describe("native IndexedDB adapter", () => {
  it("upgrades v1 without replacing existing Blobs and persists cleanup intents across adapter instances", async () => {
    const harness = indexedDBHarness();
    const legacy = new Blob(["legacy"]);
    harness.stores.get("files")!.set(JSON.stringify(["old-room", "old-id"]), legacy);
    const store = createIndexedDBBlobStore(harness.factory);
    expect(await harness.finish(store.get("old-room", "old-id"))).toBe(legacy);
    expect(harness.version()).toBe(2);
    expect(harness.db.createObjectStore).toHaveBeenCalledExactlyOnceWith("cleanup-intents");
    await harness.finish(store.queueCleanup("old-room", "old-id"));
    await harness.finish(store.queueCleanup("other-room", "old-id"));
    const reloaded = createIndexedDBBlobStore(harness.factory);
    expect(await harness.finish(reloaded.listCleanup("old-room"))).toEqual(["old-id"]);
    await harness.finish(reloaded.retireCleanup("old-room", "old-id"));
    expect(await harness.finish(reloaded.get("old-room", "old-id"))).toBe(legacy);
    expect(await harness.finish(reloaded.listCleanup("old-room"))).toEqual([]);
    expect(await harness.finish(reloaded.listCleanup("other-room"))).toEqual(["old-id"]);
  });

  it("atomically writes Blob plus intent and atomically deletes both, retaining both on abort", async () => {
    const harness = indexedDBHarness();
    const store = createIndexedDBBlobStore(harness.factory);
    await harness.finish(store.put("a", "id", new Blob(["data"])));
    expect(harness.db.transaction).toHaveBeenLastCalledWith(["files", "cleanup-intents"], "readwrite");
    expect(await harness.finish(store.listCleanup("a"))).toEqual(["id"]);
    const removing = store.delete("a", "id");
    const failed = expect(removing).rejects.toThrow();
    await vi.waitFor(() => expect(harness.transactions).toHaveLength(1));
    harness.transactions.shift()!.onabort?.();
    await failed;
    expect((await harness.finish(store.get("a", "id")))?.size).toBe(4);
    expect(await harness.finish(store.listCleanup("a"))).toEqual(["id"]);
    await harness.finish(store.delete("a", "id"));
    expect(await harness.finish(store.get("a", "id"))).toBeUndefined();
    expect(await harness.finish(store.listCleanup("a"))).toEqual([]);
    const writing = store.put("a", "aborted", new Blob(["bad"]));
    const rejected = expect(writing).rejects.toThrow();
    await vi.waitFor(() => expect(harness.transactions).toHaveLength(1));
    harness.transactions.shift()!.onabort?.();
    await rejected;
    expect(await harness.finish(store.get("a", "aborted"))).toBeUndefined();
    expect(await harness.finish(store.listCleanup("a"))).toEqual([]);
  });
  it("uses structured composite keys and resolves only on transaction completion", async () => {
    const harness = indexedDBHarness();
    const store = createIndexedDBBlobStore(harness.factory);
    const finish = async <T,>(operation: Promise<T>) => {
      await vi.waitFor(() => expect(harness.transactions.length).toBeGreaterThan(0));
      const tx = harness.transactions.shift()!;
      tx.oncomplete?.();
      return operation;
    };
    let saved = false;
    const writing = store.put("a:b", "c", new Blob(["a"])).then(() => { saved = true; });
    await vi.waitFor(() => expect(harness.transactions).toHaveLength(1));
    expect(saved).toBe(false);
    harness.transactions.shift()!.oncomplete?.();
    await writing;
    await finish(store.put("a", "b:c", new Blob(["bb"])));
    expect((await finish(store.get("a:b", "c")))?.size).toBe(1);
    await finish(store.delete("a:b", "c"));
    expect(await finish(store.get("a:b", "c"))).toBeUndefined();
    expect((await finish(store.get("a", "b:c")))?.size).toBe(2);
    expect(harness.db.close).toHaveBeenCalledTimes(6);
  });

  it("rejects transaction abort even after request success", async () => {
    const harness = indexedDBHarness();
    const operation = createIndexedDBBlobStore(harness.factory).put("a", "id", new Blob());
    const rejected = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(harness.transactions).toHaveLength(1));
    harness.transactions[0].onabort?.();
    await rejected;
    expect(harness.db.close).toHaveBeenCalledOnce();
  });

  it("reports unavailable IndexedDB without fake success", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(createIndexedDBBlobStore().get("a", "id")).rejects.toThrow(/저장소/);
  });
});
