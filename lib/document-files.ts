import { parse } from "csv-parse/browser/esm/sync";
import type { RoomDocument } from "./room-materials";
import type { WordPreview } from "./word-preview";

export const MEBIBYTE = 1024 * 1024;
export const MAX_DOCUMENT_FILE_SIZE = 5 * MEBIBYTE;
export const MAX_ROOM_FILE_BYTES = 100 * MEBIBYTE;
export const MAX_ROOM_FILE_COUNT = 1000;

const previewFileTypes = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain", md: "text/plain", csv: "text/csv",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
} as const;
const downloadOnlyFileTypes = {
  hwp: "application/x-hwp", hwpx: "application/hwp+zip", doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text", rtf: "application/rtf",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
} as const;
const fileTypes = { ...previewFileTypes, ...downloadOnlyFileTypes };
export const DOCUMENT_PREVIEW_EXTENSIONS = Object.keys(previewFileTypes).map(ext => ext.toUpperCase());
export const DOCUMENT_DOWNLOAD_ONLY_EXTENSIONS = Object.keys(downloadOnlyFileTypes).map(ext => ext.toUpperCase());
export const DOCUMENT_FILE_ACCEPT = Object.keys(fileTypes).map((extension) => `.${extension}`).join(",");
export type DocumentFileMetadata = { name: string; size: number; type: string };

export interface BlobStore {
  // Provisional uploads and their cleanup intent must commit together.
  put(roomId: string, documentId: string, blob: Blob, metadata?: DocumentFileMetadata): Promise<void>;
  get(roomId: string, documentId: string): Promise<Blob | undefined>;
  // Confirmed deletion retires its intent in the same transaction.
  delete(roomId: string, documentId: string): Promise<void>;
  queueCleanup(roomId: string, documentId: string): Promise<void>;
  listCleanup(roomId: string): Promise<string[]>;
  retireCleanup(roomId: string, documentId: string): Promise<void>;
}

function extension(name: string) { return name.slice(name.lastIndexOf(".") + 1).toLowerCase(); }

export function documentFileMetadata(file: Pick<File, "name" | "size">): DocumentFileMetadata {
  const ext = extension(file.name);
  if (!file.name.trim() || file.name.length > 255 || !file.name.isWellFormed() || !file.name.includes(".") || /[\x00-\x1f\x7f/\\]/.test(file.name) || !Object.hasOwn(fileTypes, ext)) {
    throw new Error("지원하지 않는 파일 형식입니다.");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_DOCUMENT_FILE_SIZE) {
    throw new Error("파일은 5 MiB 이하여야 합니다.");
  }
  return { name: file.name, size: file.size, type: fileTypes[ext as keyof typeof fileTypes] };
}

export function isDocumentFileMetadata(value: unknown): value is DocumentFileMetadata {
  if (!value || typeof value !== "object") return false;
  const file = value as DocumentFileMetadata;
  if (typeof file.name !== "string" || typeof file.size !== "number" || typeof file.type !== "string") return false;
  try { return documentFileMetadata(file).type === file.type; } catch { return false; }
}

export function createIndexedDBBlobStore(factory?: IDBFactory): BlobStore {
  const databaseName = "church-planner-document-files-v1";
  const storeName = "files";
  const journalName = "cleanup-intents";
  function run<T>(stores: string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      const unavailable = () => new Error("로컬 파일 저장소를 사용할 수 없습니다. 저장 공간과 사이트 권한을 확인해 주세요.");
      const idb = factory ?? globalThis.indexedDB;
      if (!idb) { reject(unavailable()); return; }
      let open: IDBOpenDBRequest;
      let settled = false;
      try { open = idb.open(databaseName, 2); } catch { reject(unavailable()); return; }
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        if (!db.objectStoreNames.contains(journalName)) db.createObjectStore(journalName);
      };
      open.onerror = open.onblocked = () => { settled = true; reject(unavailable()); };
      open.onsuccess = () => {
        const db = open.result;
        if (settled) { db.close(); return; }
        let transaction: IDBTransaction | undefined;
        try {
          transaction = db.transaction(stores, mode);
          const fail = () => {
            if (settled) return;
            settled = true;
            db.close();
            reject(unavailable());
          };
          transaction.onerror = transaction.onabort = fail;
          const result = operation(transaction);
          // Request success can still be followed by a transaction abort.
          transaction.oncomplete = () => {
            if (settled) return;
            settled = true;
            db.close();
            try { resolve(result()); } catch (cause) { reject(cause); }
          };
        } catch {
          settled = true;
          try { transaction?.abort(); } catch { /* Transaction may already be inactive. */ }
          db.close();
          reject(unavailable());
        }
      };
    });
  }
  return {
    put: (roomId, documentId, blob) => run([storeName, journalName], "readwrite", (transaction) => {
      const key = [roomId, documentId];
      transaction.objectStore(storeName).put(blob, key);
      transaction.objectStore(journalName).put({ roomId, documentId }, key);
      return () => undefined;
    }),
    get: async (room, id) => {
      const blob: unknown = await run([storeName], "readonly", (transaction) => {
        const request = transaction.objectStore(storeName).get([room, id]);
        return () => request.result;
      });
      if (blob !== undefined && !(blob instanceof Blob)) throw new Error("저장된 파일을 읽지 못했습니다.");
      return blob;
    },
    delete: (room, id) => run([storeName, journalName], "readwrite", (transaction) => {
      transaction.objectStore(storeName).delete([room, id]);
      transaction.objectStore(journalName).delete([room, id]);
      return () => undefined;
    }),
    queueCleanup: (roomId, documentId) => run([journalName], "readwrite", (transaction) => {
      transaction.objectStore(journalName).put({ roomId, documentId }, [roomId, documentId]);
      return () => undefined;
    }),
    listCleanup: (roomId) => run([journalName], "readonly", (transaction) => {
      const request = transaction.objectStore(journalName).getAll();
      return () => {
        const intents: unknown[] = request.result;
        return intents.flatMap((value) => {
          if (!value || typeof value !== "object") throw new Error("파일 정리 목록을 읽지 못했습니다.");
          const intent = value as { roomId?: unknown; documentId?: unknown };
          if (typeof intent.roomId !== "string" || typeof intent.documentId !== "string") throw new Error("파일 정리 목록을 읽지 못했습니다.");
          return intent.roomId === roomId ? [intent.documentId] : [];
        });
      };
    }),
    retireCleanup: (room, id) => run([journalName], "readwrite", (transaction) => {
      transaction.objectStore(journalName).delete([room, id]);
      return () => undefined;
    })
  };
}

export class DocumentCleanupError extends Error {
  constructor(public readonly documentId: string, public readonly metadataSaved = false) {
    super(metadataSaved ? "자료는 저장했지만 파일 정리 기록을 완료하지 못했습니다. 파일 정리를 다시 시도해 주세요."
      : "자료 정보를 저장하지 못했고 파일 정리도 완료하지 못했습니다. 파일 정리를 다시 시도해 주세요.");
  }
}

export async function reconcileDocumentCleanup(store: BlobStore, roomId: string, id: string, isReferenced: () => boolean | Promise<boolean>) {
  // Never infer liveness from a rendered snapshot or from a failed metadata read.
  if (await isReferenced()) {
    await store.retireCleanup(roomId, id);
    return "referenced";
  }
  await store.delete(roomId, id);
  return "deleted";
}

export async function saveDocumentFile(store: BlobStore, roomId: string, id: string, file: File, commit: (document: RoomDocument) => boolean | Promise<boolean>, isReferenced: () => boolean | Promise<boolean> = () => false) {
  const metadata = documentFileMetadata(file);
  await store.put(roomId, id, new Blob([file], { type: metadata.type }), metadata);
  try {
    if (!await commit({ id, title: metadata.name, kind: "file", pinned: false, file: metadata })) throw new Error("metadata");
  } catch {
    try { await reconcileDocumentCleanup(store, roomId, id, isReferenced); }
    catch { throw new DocumentCleanupError(id); }
    throw new Error("자료 정보를 저장하지 못했습니다. 다시 저장해 주세요.");
  }
  try { await store.retireCleanup(roomId, id); }
  catch { throw new DocumentCleanupError(id, true); }
}

export type DocumentPreview =
  | WordPreview
  | { kind: "text"; text: string; truncated?: true }
  | { kind: "table"; headers: string[]; rows: string[][]; truncated: boolean }
  | { kind: "image"; blob: Blob }
  | { kind: "pdf"; blob: Blob }
  | { kind: "unavailable" };

function readBlob(blob: Blob, mode: "text"): Promise<string>;
function readBlob(blob: Blob, mode: "bytes"): Promise<ArrayBuffer>;
function readBlob(blob: Blob, mode: "text" | "bytes"): Promise<string | ArrayBuffer> {
  if (mode === "text" && blob.text) return blob.text();
  if (mode === "bytes" && blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    reader.onerror = reader.onabort = () => reject(new Error("파일을 읽지 못했습니다."));
    if (mode === "text") reader.readAsText(blob); else reader.readAsArrayBuffer(blob);
  });
}

export async function prepareDocumentPreview(file: DocumentFileMetadata, blob: Blob): Promise<DocumentPreview> {
  if (!isDocumentFileMetadata(file) || blob.size !== file.size) throw new Error("저장된 파일 정보를 확인해 주세요.");
  const ext = extension(file.name);
  if (ext === "docx") {
    try {
      const { readWordPreview } = await import("./word-preview");
      return readWordPreview(new Uint8Array(await readBlob(blob, "bytes"))) ?? { kind: "unavailable" };
    } catch { return { kind: "unavailable" }; }
  }
  if (ext === "csv") {
    try {
      const rowLimit = 100, columnLimit = 32, cellLimit = 500;
      const rows: string[][] = parse(await readBlob(blob, "text"), {
        bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 64 * 1024, to: rowLimit + 2
      });
      const columns = Math.max(0, ...rows.map(row => row.length));
      let truncated = rows.length > rowLimit + 1 || columns > columnLimit;
      const visible = rows.slice(0, rowLimit + 1).map(row => Array.from({ length: Math.min(columns, columnLimit) }, (_, index) => {
        const value = row[index] ?? "";
        if (value.length <= cellLimit) return value;
        truncated = true;
        return value.slice(0, cellLimit) + "…";
      }));
      return { kind: "table", headers: visible[0] ?? [], rows: visible.slice(1), truncated };
    } catch { /* A malformed CSV can still be inspected as plain text. */ }
  }
  if (["txt", "md", "csv"].includes(ext)) {
    const limit = 128 * 1024;
    const text = await readBlob(blob.size > limit ? blob.slice(0, limit) : blob, "text");
    return blob.size > limit ? { kind: "text", text, truncated: true } : { kind: "text", text };
  }
  if (file.type !== "application/pdf" && !file.type.startsWith("image/")) return { kind: "unavailable" };
  const header = new Uint8Array(await readBlob(blob.slice(0, 12), "bytes"));
  const startsWith = (bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  const image = ext === "png" ? startsWith([137, 80, 78, 71, 13, 10, 26, 10])
    : ext === "gif" ? startsWith([71, 73, 70, 56]) && (header[4] === 55 || header[4] === 57) && header[5] === 97
    : ext === "webp" ? startsWith([82, 73, 70, 70]) && [87, 69, 66, 80].every((byte, index) => header[index + 8] === byte)
    : ["jpg", "jpeg"].includes(ext) && startsWith([255, 216, 255]);
  const pdf = ext === "pdf" && startsWith([37, 80, 68, 70, 45]);
  if (!image && !pdf) return { kind: "unavailable" };
  return { kind: image ? "image" : "pdf", blob: new Blob([blob], { type: file.type }) };
}

export function downloadDocumentBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Keep the URL alive through browser download handoff, including navigation.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function sampleDocumentText(document: RoomDocument): string {
  if (document.kind === "minutes") return "[샘플 자료] 회의록 예시\n\n교회 집합 일정\n차량 배정표 작성\n안전 담당자 지정";
  if (document.id === "sample-schedule") return "[샘플 자료] 진행 일정표 예시\n\n09:00 교회 집합\n10:00 행사 시작\n12:00 점심 식사";
  return "[샘플 자료] 준비물 목록 예시\n\n이름표\n구급상자\n생수";
}
