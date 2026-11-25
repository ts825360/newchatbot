import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomMaterialsStore, sampleDocuments, validateChecklistItem } from "../lib/room-materials";
import type { ChecklistItem } from "../lib/types";
import { getStorageStatus, markStorageStatus, subscribeStorageStatus } from "../lib/storage-status";

const item: ChecklistItem = { id: "one", title: "Prepare", owner: "Owner", due: "2026-08-10", status: "needsReview", memo: "" };
beforeEach(() => localStorage.clear());

describe("room materials", () => {
  it("seeds three labelled samples only for an absent record", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a", [item]);
    expect(store.loadDocuments()).toEqual(sampleDocuments);
    store.updateDocuments(() => []);
    store.updateChecklist(() => []);
    const reloaded = createRoomMaterialsStore(localStorage, "room-a", [item]);
    expect(reloaded.loadDocuments()).toEqual([]);
    expect(reloaded.loadChecklist()).toEqual([]);
  });

  it("persists pinning and saved order across instances but isolates rooms", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a", [item]);
    store.updateDocuments((docs) => docs.map((doc, index) => ({ ...doc, pinned: index === 2 })));
    store.reorderDocuments([...sampleDocuments].reverse().map((doc) => doc.id));
    const saved = createRoomMaterialsStore(localStorage, "room-a").loadDocuments();
    expect(saved.map((doc) => doc.id)).toEqual([...sampleDocuments].reverse().map((doc) => doc.id));
    expect(saved[0].pinned).toBe(true);
    expect(createRoomMaterialsStore(localStorage, "room-b").loadDocuments()).toEqual(sampleDocuments);
  });

  it("does not resurrect documents removed while order was being edited", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a");
    const draft = store.loadDocuments().map((doc) => doc.id).reverse();
    store.updateDocuments((docs) => docs.filter((doc) => doc.id !== draft[0]));
    expect(store.reorderDocuments(draft).map((doc) => doc.id)).toEqual(draft.slice(1));
  });

  it("persists checklist edit, addition, completion and deletion independently of documents", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a", [item]);
    store.updateChecklist((items) => [...items.map((entry) => ({ ...entry, title: "Edited", status: "done" as const })), { ...item, id: "two" }]);
    expect(createRoomMaterialsStore(localStorage, "room-a").loadChecklist()[0]).toMatchObject({ title: "Edited", status: "done" });
    store.updateChecklist((items) => items.filter((entry) => entry.id !== "one"));
    expect(store.loadChecklist().map((entry) => entry.id)).toEqual(["two"]);
    expect(store.loadDocuments()).toEqual(sampleDocuments);
    expect(createRoomMaterialsStore(localStorage, "room-b", [item]).loadChecklist()).toEqual([item]);
  });

  it("rejects invalid schema and duplicate IDs without reseeding or overwriting", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a", [item]);
    localStorage.setItem(store.documentsKey, JSON.stringify({ version: 9, items: [] }));
    expect(() => store.loadDocuments()).toThrow(/읽지 못/);
    expect(() => store.updateDocuments(() => [])).toThrow();
    localStorage.setItem(store.checklistKey, JSON.stringify({ version: 1, items: [item, item] }));
    expect(() => store.loadChecklist()).toThrow(/읽지 못/);
  });

  it("reports failed writes without changing the previously saved state", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a", [item]);
    store.updateChecklist((items) => items);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
    expect(() => store.updateChecklist(() => [])).toThrow(/저장하지 못/);
    expect(store.loadChecklist()).toEqual([item]);
    write.mockRestore();
  });

  it.each(["2026-02-30", "2026-13-01", "bad", "0000-01-01"])("rejects impossible due date %s", (due) => {
    expect(validateChecklistItem({ ...item, due })).toBeTruthy();
  });

  it("requires a title and allows an empty optional due date", () => {
    expect(validateChecklistItem({ ...item, title: "  " })).toBeTruthy();
    expect(validateChecklistItem({ ...item, due: "" })).toBe("");
    expect(validateChecklistItem({ ...item, due: "2028-02-29" })).toBe("");
  });

  it("persists validated file metadata in version 1 alongside legacy samples", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a");
    const file = { id: "upload", title: "Notes.TXT", kind: "file" as const, pinned: false,
      file: { name: "Notes.TXT", size: 12, type: "text/plain" } };
    store.updateDocuments((items) => [...items, file]);
    expect(createRoomMaterialsStore(localStorage, "room-a").loadDocuments()).toEqual([...sampleDocuments, file]);
    expect(JSON.parse(localStorage.getItem(store.documentsKey)!).version).toBe(1);
  });

  it("publishes real materials writes and failures to the browser save-status bus", () => {
    const store = createRoomMaterialsStore(localStorage, "room-a");
    markStorageStatus("idle");
    const phases: string[] = [];
    const unsubscribe = subscribeStorageStatus(() => phases.push(getStorageStatus().phase));
    try {
      store.updateDocuments((items) => items);
      expect(phases).toEqual(["saving", "saved"]);
      expect(getStorageStatus().scope).toBe("browser");
      const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
      expect(() => store.updateDocuments(() => [])).toThrow();
      write.mockRestore();
      expect(phases.slice(-2)).toEqual(["saving", "failed"]);
    } finally { unsubscribe(); }
  });

  it.each([
    undefined,
    { name: "page.html", size: 5, type: "text/html" },
    { name: "image.svg", size: 5, type: "image/svg+xml" },
    { name: "notes.txt", size: 5, type: "text/html" },
    { name: "notes.txt", size: -1, type: "text/plain" },
    { name: "notes.txt", size: 5 * 1024 * 1024 + 1, type: "text/plain" }
  ])("rejects unvalidated file metadata %j without overwriting", (file) => {
    const store = createRoomMaterialsStore(localStorage, "room-a");
    expect(() => store.updateDocuments(() => [{ id: "bad", title: "Bad", kind: "file", pinned: false, file }] as never)).toThrow();
    expect(store.loadDocuments()).toEqual(sampleDocuments);
  });
});
