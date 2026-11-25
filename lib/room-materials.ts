import { useEffect, useRef, useState } from "react";
import type { ChecklistItem } from "./types";
import { isDocumentFileMetadata, type DocumentFileMetadata } from "./document-files";
import { writeBrowserRecord } from "./storage-status";
import { dataStorage } from "./backend-client";
import { privateToolKey, scopeId, type ConversationScope } from "./conversation-scope";

export type RoomDocument = { id: string; title: string; kind: "minutes" | "sample" | "file"; pinned: boolean; file?: DocumentFileMetadata };
export const sampleDocuments: RoomDocument[] = [
  { id: "sample-minutes", title: "회의록 예시", kind: "minutes", pinned: false },
  { id: "sample-schedule", title: "진행 일정표 예시", kind: "sample", pinned: false },
  { id: "sample-supplies", title: "준비물 목록 예시", kind: "sample", pinned: false }
];
export const ROOM_MATERIALS_CHANGED_EVENT = "church-planner-room-materials-changed";
type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export function validateChecklistItem(item: ChecklistItem): string {
  if (!item.title.trim()) return "항목 이름을 입력해 주세요.";
  if (item.due) {
    const date = new Date(`${item.due}T00:00:00Z`);
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(item.due) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item.due) {
      return "올바른 마감일을 입력해 주세요.";
    }
  }
  return "";
}

function isDocument(value: unknown): value is RoomDocument {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && !!item.id && typeof item.title === "string" && !!item.title.trim()
    && ["minutes", "sample", "file"].includes(item.kind as string) && typeof item.pinned === "boolean"
    && (item.file === undefined || isDocumentFileMetadata(item.file))
    && (item.kind !== "file" || isDocumentFileMetadata(item.file));
}

function isChecklistItem(value: unknown): value is ChecklistItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "title", "owner", "due", "memo"].every((key) => typeof item[key] === "string")
    && !!item.id && ["done", "inProgress", "needsReview", "risk"].includes(item.status as string)
    && !validateChecklistItem(value as ChecklistItem);
}

function validItems<T extends { id: string }>(items: unknown, validate: (item: unknown) => item is T): items is T[] {
  return Array.isArray(items) && items.every(validate) && new Set(items.map((item) => item.id)).size === items.length;
}

function materialsKeys(roomId: string, scope?: ConversationScope) {
  const prefix = `church-planner-room-materials-v1:${encodeURIComponent(roomId)}:`;
  return {
    documentsKey: scope ? privateToolKey(scope, "documents") : prefix + "documents",
    checklistKey: scope ? privateToolKey(scope, "checklist") : prefix + "checklist",
  };
}

export function createRoomMaterialsStore(storage: BrowserStorage, roomId: string, seedChecklist: ChecklistItem[] = [], scope?: ConversationScope) {
  storage = dataStorage(storage);
  const { documentsKey, checklistKey } = materialsKeys(roomId, scope);
  function load<T extends { id: string }>(key: string, seed: T[], validate: (item: unknown) => item is T): T[] {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return seed.map((item) => ({ ...item }));
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object") throw Error("Invalid record");
      const record = data as Record<string, unknown>;
      if (record.version !== 1 || !validItems(record.items, validate)) throw Error("Invalid schema");
      return record.items;
    } catch { throw new Error("자료를 읽지 못했습니다. 사이트 저장소와 저장된 데이터를 확인해 주세요."); }
  }
  function save<T extends { id: string }>(key: string, items: T[], validate: (item: unknown) => item is T) {
    if (!validItems(items, validate)) throw new Error("저장할 항목을 확인해 주세요.");
    try { writeBrowserRecord(storage, key, { version: 1, items }, "browser"); }
    catch { throw new Error("저장하지 못했습니다. 사이트 저장소를 허용하거나 저장 공간을 확인해 주세요."); }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ROOM_MATERIALS_CHANGED_EVENT, { detail: { key } }));
    return items;
  }
  const loadDocuments = () => load(documentsKey, sampleDocuments, isDocument);
  const loadChecklist = () => load(checklistKey, seedChecklist, isChecklistItem);
  const updateDocuments = (transform: (items: RoomDocument[]) => RoomDocument[]) => save(documentsKey, transform(loadDocuments()), isDocument);
  const updateChecklist = (transform: (items: ChecklistItem[]) => ChecklistItem[]) => save(checklistKey, transform(loadChecklist()), isChecklistItem);
  return {
    documentsKey, checklistKey, loadDocuments, loadChecklist, updateDocuments, updateChecklist,
    reorderDocuments(ids: string[]) {
      return updateDocuments((items) => {
        const remaining = new Map(items.map((item) => [item.id, item]));
        const ordered: RoomDocument[] = [];
        for (const id of ids) {
          const item = remaining.get(id);
          if (item) { ordered.push(item); remaining.delete(id); }
        }
        return [...ordered, ...remaining.values()];
      });
    }
  };
}

// Reload only for material changes, not browser focus, to preserve pending editors.
export function useRoomMaterials(roomId: string, seedChecklist: ChecklistItem[] = [], scope?: ConversationScope | null) {
  const seed = useRef(seedChecklist);
  seed.current = seedChecklist;
  const identity = scope === null ? "" : scope ? scopeId(scope) : roomId;
  const [snapshot, setSnapshot] = useState<{ identity: string; documents: RoomDocument[]; checklist: ChecklistItem[]; error: string }>({ identity: "", documents: [], checklist: [], error: "" });
  useEffect(() => {
    if (scope === null) return;
    const { documentsKey, checklistKey } = materialsKeys(roomId, scope);
    const reload = () => {
      try {
        const store = createRoomMaterialsStore(window.localStorage, roomId, seed.current, scope);
        const documents = store.loadDocuments();
        const checklist = store.loadChecklist();
        setSnapshot({ identity, documents, checklist, error: "" });
      } catch (cause) {
        setSnapshot((current) => ({ identity, documents: current.identity === identity ? current.documents : [], checklist: current.identity === identity ? current.checklist : [], error: storageError(cause) }));
      }
    };
    const onChange = (event: Event) => {
      const key = event instanceof StorageEvent ? event.key : (event as CustomEvent<{ key?: string }>).detail?.key;
      if (event instanceof StorageEvent && event.storageArea && event.storageArea !== window.localStorage) return;
      if (key == null || key === documentsKey || key === checklistKey) reload();
    };
    reload();
    window.addEventListener("storage", onChange);
    window.addEventListener(ROOM_MATERIALS_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(ROOM_MATERIALS_CHANGED_EVENT, onChange);
    };
  }, [roomId, identity, scope]);
  const mutate = (operation: (store: ReturnType<typeof createRoomMaterialsStore>) => void) => {
    if (scope === null) return false;
    try {
      operation(createRoomMaterialsStore(window.localStorage, roomId, seed.current, scope));
      return true;
    } catch (cause) {
      setSnapshot((current) => ({ ...current, error: storageError(cause) }));
      return false;
    }
  };
  return {
    loaded: Boolean(identity) && snapshot.identity === identity,
    documents: identity && snapshot.identity === identity ? snapshot.documents : [],
    checklist: identity && snapshot.identity === identity ? snapshot.checklist : [],
    error: identity && snapshot.identity === identity ? snapshot.error : "",
    updateDocuments: (transform: (items: RoomDocument[]) => RoomDocument[]) => mutate((store) => { store.updateDocuments(transform); }),
    reorderDocuments: (ids: string[]) => mutate((store) => { store.reorderDocuments(ids); }),
    updateChecklist: (transform: (items: ChecklistItem[]) => ChecklistItem[]) => mutate((store) => { store.updateChecklist(transform); })
  };
}

function storageError(cause: unknown) {
  return cause instanceof Error ? cause.message : "사이트 저장소를 사용할 수 없습니다.";
}
