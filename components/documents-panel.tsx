"use client";

import { ArrowDown, ArrowUp, Check, Download, FileText, ListOrdered, LoaderCircle, Pin, PinOff, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createIndexedDBBlobStore, DOCUMENT_FILE_ACCEPT, DocumentCleanupError, documentFileMetadata,
  downloadDocumentBlob, prepareDocumentPreview, reconcileDocumentCleanup, sampleDocumentText, saveDocumentFile,
  MAX_DOCUMENT_FILE_SIZE, MAX_ROOM_FILE_COUNT, MEBIBYTE,
  type BlobStore, type DocumentPreview
} from "@/lib/document-files";
import { createRoomMaterialsStore, useRoomMaterials, type RoomDocument } from "@/lib/room-materials";
import { flushBackendWrites, isBackendConnected } from "@/lib/backend-client";
import { createServerBlobStore } from "@/lib/server-blob-store";
import { markStorageStatus } from "@/lib/storage-status";
import { scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { RoomDialog } from "./room-dialog";
import { PdfDocumentPreview } from "./pdf-document-preview";
import { Button } from "./ui";
import "./documents-panel.css";

type DocumentsPanelProps = {
  roomId: string;
  scope?: ConversationScope;
  onAddExtractedEvent: () => void;
  onAddExtractedChecklist: () => void;
  onReviewProposals?: () => void;
  blobStore?: BlobStore;
};
type UploadDraft = { id: string; name: string; file?: File; status: "saving" | "error" | "done"; error?: string; valid: boolean };
type CleanupTask = { id: string; message: string; busy: boolean };
const localBlobs = createIndexedDBBlobStore();

export function DocumentsPanel(props: DocumentsPanelProps) {
  return <RoomDocuments key={props.scope ? scopeId(props.scope) : props.roomId} {...props} />;
}

function FilePreview({ roomId, document, store }: { roomId: string; document: RoomDocument; store: BlobStore }) {
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const { name, size, type } = document.file ?? {};
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setPreview(null);
    setError("");
    setUrl("");
    const load = async () => {
      try {
        const blob = await store.get(roomId, document.id);
        if (!blob || name === undefined || size === undefined || type === undefined) throw new Error("파일이 없습니다.");
        const result = await prepareDocumentPreview({ name, size, type }, blob);
        if (!active) return;
        if (result.kind === "image") {
          objectUrl = URL.createObjectURL(result.blob);
          setUrl(objectUrl);
        }
        setPreview(result);
      } catch (cause) { if (active) setError(isBackendConnected() && cause instanceof Error ? cause.message : "미리보기를 열지 못했습니다. 로컬 파일과 사이트 저장소를 확인해 주세요."); }
    };
    void load();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [roomId, document.id, name, size, type, store]);
  if (error) return <p role="alert" className="documents-viewer-message documents-error">{error}</p>;
  if (!preview) return <p role="status" className="documents-viewer-message">미리보기 여는 중...</p>;
  if (preview.kind === "pdf") return <PdfDocumentPreview blob={preview.blob} />;
  if (preview.kind === "image") return <div className="documents-image"><img src={url} alt={document.title} onError={() => setError("이미지 미리보기를 열지 못했습니다. 파일을 다운로드해 확인해 주세요.")} /></div>;
  if (preview.kind === "unavailable") return <p className="documents-viewer-message">이 파일은 미리볼 수 없습니다. 원본을 다운로드해 열어 주세요.</p>;
  if (preview.kind === "word") return <div className="documents-preview">
    <p className="documents-preview-limit">Word 본문 미리보기 · 원본 서식과 이미지는 다운로드해 확인할 수 있습니다.</p>
    <article className="documents-word">
      {preview.blocks.map((block, index) => block.kind === "paragraph"
        ? block.heading ? <h3 key={index}>{block.text}</h3> : <p key={index}>{block.text || "\u00a0"}</p>
        : <div key={index} className="documents-word-table"><table aria-label={`문서 표 ${index + 1}`}>
          <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.cells.map((text, col) =>
            row.header ? <th scope="col" key={col}>{text}</th> : <td key={col}>{text}</td>)}</tr>)}</tbody>
        </table></div>)}
      {!preview.blocks.length && <p className="documents-viewer-message">미리볼 본문이 없습니다. 원본을 다운로드해 열어 주세요.</p>}
    </article>
    {preview.truncated && <p className="documents-preview-limit">문서의 일부만 표시됩니다.</p>}
  </div>;
  return <div className="documents-preview">
    {preview.truncated && <p className="documents-preview-limit">파일의 일부만 표시됩니다.</p>}
    {preview.kind === "text" && (preview.text ? <pre>{preview.text}</pre> : <p className="documents-viewer-message">파일이 비어 있습니다.</p>)}
    {preview.kind === "table" && (preview.headers.length ? <table aria-label={`${document.title} 미리보기`}>
      <thead><tr>{preview.headers.map((label, column) => <th key={column} scope="col">{label || `${column + 1}열`}</th>)}</tr></thead>
      <tbody>{preview.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
    </table> : <p className="documents-viewer-message">파일이 비어 있습니다.</p>)}
  </div>;
}

function RoomDocuments({ roomId, scope, onAddExtractedEvent, onAddExtractedChecklist, onReviewProposals, blobStore: providedStore }: DocumentsPanelProps) {
  const connected = isBackendConnected();
  const storageScope = connected ? "server" : "browser";
  const serverBlobs = useMemo(() => createServerBlobStore(scope), [scope]);
  const blobStore = providedStore ?? (connected ? serverBlobs : localBlobs);
  const blobRoom = !connected && scope ? scopeId(scope) : roomId;
  const { documents, error, updateDocuments, reorderDocuments } = useRoomMaterials(roomId, [], scope);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [uploads, setUploads] = useState<UploadDraft[]>([]);
  const [cleanupTasks, setCleanupTasks] = useState<CleanupTask[]>([]);
  const [cleanupError, setCleanupError] = useState("");
  const [cleanupReload, setCleanupReload] = useState(0);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const metadataPending = useRef(false);
  const [metadataError, setMetadataError] = useState("");
  const cleanupLoadFailed = useRef(false);
  const [downloadState, setDownloadState] = useState({ id: "", error: "", message: "", busy: false });
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const downloads = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const ids = await blobStore.listCleanup(blobRoom);
        if (!active) return;
        if (cleanupLoadFailed.current) { setCleanupError(""); cleanupLoadFailed.current = false; }
        if (ids.length) setCleanupTasks((current) => {
          const tasks = new Map(current.map((task) => [task.id, task]));
          for (const id of ids) if (!tasks.has(id)) tasks.set(id, { id, busy: false, message: "완료하지 못한 파일 정리 기록이 있습니다. 파일 정리를 다시 시도해 주세요." });
          return tasks.size === current.length ? current : [...tasks.values()];
        });
      } catch {
        if (active) { cleanupLoadFailed.current = true; setCleanupError("파일 정리 목록을 읽지 못했습니다. 저장소를 확인하고 다시 불러와 주세요."); }
      }
    };
    void restore();
    return () => { active = false; };
  }, [blobRoom, blobStore, cleanupReload]);
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const ordered = draft ? [...draft.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), ...documents.filter((doc) => !draft.includes(doc.id))] : documents;
  const deleting = documents.find((doc) => doc.id === deleteId);
  const previewing = documents.find((doc) => doc.id === previewId);
  const changeUpload = (id: string, changes: Partial<UploadDraft>) => {
    if (mounted.current) setUploads((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
  };
  const recordCleanup = (id: string, message: string) => {
    if (mounted.current) setCleanupTasks((items) => [...items.filter((item) => item.id !== id), { id, message, busy: false }]);
  };
  const clearCleanup = (id: string) => {
    if (mounted.current) setCleanupTasks((items) => items.filter((item) => item.id !== id));
  };
  const isReferenced = (id: string): boolean | Promise<boolean> => {
    if (!connected) return createRoomMaterialsStore(window.localStorage, roomId, [], scope).loadDocuments().some((doc) => doc.id === id);
    // A failed metadata write can still be pending. Keep its cleanup intent until it settles.
    return flushBackendWrites().then(() => serverBlobs.isReferenced(roomId, id));
  };
  const editMetadata = async (edit: () => boolean, done?: () => void) => {
    if (metadataPending.current) return;
    setMetadataError("");
    if (!edit()) return;
    try {
      if (connected) {
        metadataPending.current = true;
        setMetadataBusy(true);
        markStorageStatus("saving", storageScope);
        await flushBackendWrites();
        markStorageStatus("saved", storageScope);
      }
      if (mounted.current) done?.();
    } catch {
      markStorageStatus("failed", storageScope);
      if (mounted.current) setMetadataError("자료 변경을 서버에 저장하지 못했습니다. 연결과 저장 상태를 확인하고 다시 시도해 주세요.");
    } finally {
      metadataPending.current = false;
      if (mounted.current) setMetadataBusy(false);
    }
  };
  const saveUpload = async (entry: UploadDraft) => {
    if (!entry.file) return;
    changeUpload(entry.id, { status: "saving", error: undefined });
    markStorageStatus("saving", storageScope);
    try {
      await saveDocumentFile(blobStore, blobRoom, entry.id, entry.file, (doc) => {
        const saved = mounted.current && updateDocuments((items) => [...items, doc]);
        return saved && connected ? flushBackendWrites().then(() => true) : saved;
      }, () => isReferenced(entry.id));
      markStorageStatus("saved", storageScope);
      changeUpload(entry.id, { status: "done", file: undefined });
    } catch (cause) {
      markStorageStatus("failed", storageScope);
      const message = cause instanceof Error ? cause.message : "로컬 파일을 저장하지 못했습니다.";
      changeUpload(entry.id, { status: "error", error: message });
      if (cause instanceof DocumentCleanupError) {
        if (cause.metadataSaved) changeUpload(entry.id, { file: undefined, valid: false });
        recordCleanup(entry.id, cause.message);
      }
      if (connected && mounted.current) setCleanupReload((value) => value + 1);
    }
  };
  const selectFiles = (files: File[]) => {
    const entries: UploadDraft[] = files.map((file) => {
      const id = crypto.randomUUID();
      try {
        documentFileMetadata(file);
        return { id, name: file.name, file, status: "saving", valid: true };
      } catch (cause) {
        return { id, name: file.name, status: "error", valid: false, error: cause instanceof Error ? cause.message : "파일을 확인해 주세요." };
      }
    });
    setUploads((items) => [...items, ...entries]);
    for (const entry of entries) if (entry.valid) void saveUpload(entry);
  };
  const retryCleanup = async (task: CleanupTask) => {
    setCleanupTasks((items) => items.map((item) => item.id === task.id ? { ...item, busy: true } : item));
    markStorageStatus("saving", storageScope);
    try {
      await reconcileDocumentCleanup(blobStore, blobRoom, task.id, () => isReferenced(task.id));
      markStorageStatus("saved", storageScope);
      clearCleanup(task.id);
    } catch {
      markStorageStatus("failed", storageScope);
      if (mounted.current) setCleanupTasks((items) => items.map((item) => item.id === task.id ? { ...item, busy: false } : item));
    }
  };
  const remove = async (document: RoomDocument) => {
    if (deletingBusy) return;
    setDeletingBusy(true);
    setDeleteError("");
    let metadataRemoved = false;
    let cleanupQueued = false;
    try {
      if (document.kind === "file") {
        markStorageStatus("saving", storageScope);
        await blobStore.queueCleanup(blobRoom, document.id);
        cleanupQueued = true;
        // A navigation while journaling must not remove a live file's metadata.
        if (!mounted.current) {
          await reconcileDocumentCleanup(blobStore, blobRoom, document.id, () => isReferenced(document.id));
          markStorageStatus("saved", storageScope);
          return;
        }
      }
      if (!updateDocuments((items) => items.filter((item) => item.id !== document.id))) {
        if (document.kind === "file") recordCleanup(document.id, "자료를 삭제하지 못했습니다. 파일 정리 기록을 다시 확인해 주세요.");
        return;
      }
      if (connected) await flushBackendWrites();
      metadataRemoved = true;
      if (mounted.current) {
        setDeleteId(null);
        if (previewId === document.id) setPreviewId(null);
        setUploads((items) => items.filter((item) => item.id !== document.id));
      }
      if (document.kind === "file") {
        await reconcileDocumentCleanup(blobStore, blobRoom, document.id, () => isReferenced(document.id));
        markStorageStatus("saved", storageScope);
        clearCleanup(document.id);
      }
    } catch {
      markStorageStatus("failed", storageScope);
      if (metadataRemoved) recordCleanup(document.id, "자료는 삭제했지만 파일 정리를 완료하지 못했습니다. 파일 정리를 다시 시도해 주세요.");
      else if (cleanupQueued) recordCleanup(document.id, "자료 삭제를 확인하지 못했습니다. 파일 정리 기록을 보존했습니다. 저장 상태를 확인하고 다시 시도해 주세요.");
      else if (mounted.current) setDeleteError("파일 정리 기록을 저장하지 못해 자료를 삭제하지 않았습니다. 다시 시도해 주세요.");
    } finally {
      if (mounted.current) setDeletingBusy(false);
    }
  };
  const download = async (document: RoomDocument) => {
    if (downloads.current.has(document.id)) return;
    downloads.current.add(document.id);
    setDownloadState({ id: document.id, busy: true, error: "", message: "" });
    try {
      const blob = document.kind === "file" ? await blobStore.get(blobRoom, document.id) : new Blob([sampleDocumentText(document)], { type: "text/plain" });
      if (!blob || (document.file && blob.size !== document.file.size)) throw new Error("파일이 없습니다.");
      if (!mounted.current) return;
      downloadDocumentBlob(blob, document.file?.name ?? `${document.title}.txt`);
      setDownloadState({ id: document.id, busy: false, error: "", message: `${document.title} 다운로드 시작` });
    } catch (cause) {
      if (mounted.current) setDownloadState({ id: document.id, busy: false, error: connected && cause instanceof Error ? cause.message : "파일을 다운로드하지 못했습니다. 로컬 파일과 브라우저 권한을 확인해 주세요.", message: "" });
    } finally { downloads.current.delete(document.id); }
  };
  const move = (group: RoomDocument[], index: number, offset: number) => {
    const ids = ordered.map((doc) => doc.id);
    const first = ids.indexOf(group[index].id);
    const second = ids.indexOf(group[index + offset].id);
    [ids[first], ids[second]] = [ids[second], ids[first]];
    setDraft(ids);
  };
  const renderGroup = (pinned: boolean) => {
    const group = ordered.filter((doc) => doc.pinned === pinned);
    if (!group.length) return null;
    return <section className="documents-section" aria-label={pinned ? "고정 자료" : "일반 자료"}>
      <h3>{pinned ? <Pin size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}{pinned ? "고정 자료" : "일반 자료"}</h3>
      <ul className="documents-list">{group.map((doc, index) => <li key={doc.id} className="documents-item">
        <div className="documents-row">
          <FileText size={19} aria-hidden="true" />
          <button type="button" className="documents-name" aria-label={`${doc.title} 보기`} aria-haspopup="dialog" title="미리보기" onClick={() => setPreviewId(doc.id)}>
            <strong data-testid="document-title">{doc.title}</strong><span>{doc.kind === "file" && doc.file ? `${doc.file.name.split(".").at(-1)?.toUpperCase()} · ${formatSize(doc.file.size)}` : "샘플 자료"}</span>
          </button>
          <div className="documents-row-actions">
            {draft ? <>
              <button type="button" className="workspace-icon-button" aria-label={`${doc.title} 위로`} title="위로" disabled={index === 0} onClick={() => move(group, index, -1)}><ArrowUp size={16} /></button>
              <button type="button" className="workspace-icon-button" aria-label={`${doc.title} 아래로`} title="아래로" disabled={index === group.length - 1} onClick={() => move(group, index, 1)}><ArrowDown size={16} /></button>
            </> : <>
              <button type="button" className="workspace-icon-button" aria-label={`${doc.title} 다운로드`} title="다운로드" disabled={downloadState.id === doc.id && downloadState.busy} onClick={() => { void download(doc); }}><Download size={16} /></button>
              <button type="button" className="workspace-icon-button" aria-label={`${doc.title} ${doc.pinned ? "고정 해제" : "고정"}`} title={doc.pinned ? "고정 해제" : "고정"} aria-pressed={doc.pinned} disabled={metadataBusy} onClick={() => { void editMetadata(() => updateDocuments((items) => items.map((item) => item.id === doc.id ? { ...item, pinned: !item.pinned } : item))); }}>{doc.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
              <button type="button" className="workspace-icon-button" aria-label={`${doc.title} 삭제`} title="자료 삭제" onClick={() => { setDeleteError(""); setDeleteId(doc.id); }}><Trash2 size={16} /></button>
            </>}
          </div>
        </div>
      </li>)}</ul>
    </section>;
  };
  return <div className="documents-panel">
    <div className="documents-toolbar">
      <input ref={input} className="documents-file-input" type="file" multiple accept={DOCUMENT_FILE_ACCEPT} aria-label="파일 선택" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; selectFiles(files); }} />
      <Button type="button" variant="outline" onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />파일 선택</Button>
      {draft ? <><Button type="button" variant="ghost" disabled={metadataBusy} onClick={() => setDraft(null)}>취소</Button><Button type="button" variant="primary" disabled={metadataBusy} onClick={() => { void editMetadata(() => reorderDocuments(ordered.map((doc) => doc.id)), () => setDraft(null)); }}>순서 저장</Button></> : <Button type="button" variant="outline" disabled={!documents.length || metadataBusy} onClick={() => setDraft(documents.map((doc) => doc.id))}><ListOrdered size={16} aria-hidden="true" />순서 편집</Button>}
    </div>
    <p className="documents-state documents-scope">{connected ? "서버 저장" : "이 브라우저에만 저장"} · 파일당 최대 {MAX_DOCUMENT_FILE_SIZE / MEBIBYTE} MiB{connected && ` · 행사방당 최대 ${MAX_ROOM_FILE_COUNT.toLocaleString("ko-KR")}개`}</p>
    {uploads.length > 0 && <ul className="documents-upload-list" aria-label="파일 저장 상태" aria-live="polite">{uploads.map((entry) => <li key={entry.id}>
      <div className={entry.status === "error" ? "documents-error" : "documents-state"} role={entry.status === "error" ? "alert" : "status"}>{entry.status === "saving" ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : entry.status === "done" ? <Check size={14} aria-hidden="true" /> : null}<span>{entry.name} · {entry.status === "saving" ? (connected ? "서버 저장 중..." : "로컬 저장 중...") : entry.status === "done" ? (connected ? "서버 저장 완료" : "로컬 저장 완료") : entry.error}</span></div>
      {entry.status === "error" && entry.valid && <button className="workspace-icon-button" type="button" title="다시 저장" aria-label={`${entry.name} 다시 저장`} disabled={cleanupTasks.some((task) => task.id === entry.id)} onClick={() => { void saveUpload(entry); }}><RotateCcw size={16} /></button>}
      {entry.status !== "saving" && <button className="workspace-icon-button" type="button" title="상태 닫기" aria-label={`${entry.name} 상태 닫기`} onClick={() => setUploads((items) => items.filter((item) => item.id !== entry.id))}><X size={16} /></button>}
    </li>)}</ul>}
    {error && <p role="alert" className="documents-error">{error}</p>}
    {metadataError && <p role="alert" className="documents-error">{metadataError}</p>}
    {!previewing && downloadState.error && <p role="alert" className="documents-error">{downloadState.error}</p>}
    {!previewing && downloadState.message && <p role="status" className="documents-state">{downloadState.message}</p>}
    {cleanupError && <div className="documents-cleanup"><p role="alert" className="documents-error">{cleanupError}</p><Button type="button" variant="outline" onClick={() => setCleanupReload((value) => value + 1)}><RotateCcw size={16} aria-hidden="true" />파일 정리 목록 다시 불러오기</Button></div>}
    {cleanupTasks.map((task) => <div key={task.id} className="documents-cleanup"><p role="alert" className="documents-error">{task.message}</p><Button type="button" variant="outline" disabled={task.busy} onClick={() => { void retryCleanup(task); }}><RotateCcw size={16} aria-hidden="true" />파일 정리 다시 시도</Button></div>)}
    {renderGroup(true)}{renderGroup(false)}
    {!documents.length && <p className="documents-empty">자료가 없습니다.</p>}
    {previewing && <RoomDialog key={previewing.id} title={previewing.title} className="documents-viewer" onClose={() => setPreviewId(null)} headerActions={
      <button type="button" className="lobby-icon-button" aria-label={`${previewing.title} 다운로드`} title="다운로드" disabled={downloadState.id === previewing.id && downloadState.busy} onClick={() => { void download(previewing); }}>
        {downloadState.id === previewing.id && downloadState.busy ? <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
      </button>
    }>
      <div className="documents-viewer-body">
        {downloadState.id === previewing.id && downloadState.error && <p role="alert" className="documents-error">{downloadState.error}</p>}
        {downloadState.id === previewing.id && downloadState.message && <p role="status" className="sr-only">{downloadState.message}</p>}
        {previewing.kind === "file" ? <FilePreview roomId={blobRoom} document={previewing} store={blobStore} /> : <div className="documents-preview">
          <pre>{sampleDocumentText(previewing)}</pre>
          {!connected && previewing.kind === "minutes" && <div className="documents-sample-actions">{onReviewProposals
            ? <Button type="button" variant="outline" onClick={() => { setPreviewId(null); onReviewProposals(); }}>제안 검토</Button>
            : <><Button type="button" variant="outline" onClick={onAddExtractedEvent}>일정 후보 추가</Button><Button type="button" variant="outline" onClick={onAddExtractedChecklist}>준비 항목 추가</Button></>}</div>}
        </div>}
      </div>
    </RoomDialog>}
    {deleting && <RoomDialog title="자료 삭제" onClose={() => setDeleteId(null)}><div className="room-dialog-body" aria-busy={deletingBusy}><p className="documents-delete-copy">{deleting.title} 자료를 삭제할까요?</p>{error && <p role="alert" className="documents-error">{error}</p>}{deleteError && <p role="alert" className="documents-error">{deleteError}</p>}</div><div className="room-dialog-footer"><Button type="button" variant="outline" onClick={() => setDeleteId(null)}>취소</Button><Button type="button" variant="danger" disabled={deletingBusy} onClick={() => { void remove(deleting); }}><Trash2 size={16} aria-hidden="true" />삭제하기</Button></div></RoomDialog>}
  </div>;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}
