import { backendFetch } from "./backend-client";
import { documentFileMetadata, isDocumentFileMetadata, type BlobStore, type DocumentFileMetadata } from "./document-files";
import type { ConversationScope } from "./conversation-scope";

async function rawRequest(path: string, init?: RequestInit) {
  let response: Response;
  try { response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" }); }
  catch { throw new Error("파일 서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); }
  if (response.ok || (response.status === 404 && (!init?.method || init.method === "GET"))) return response;
  const messages: Record<number, string> = {
    401: "로그인이 만료됐습니다. 다시 로그인해 주세요.",
    403: "이 파일을 처리할 권한이 없습니다.",
    404: "파일 또는 행사를 찾을 수 없습니다.",
    409: "이미 저장되었거나 사용 중인 파일입니다. 자료를 새로 확인해 주세요.",
    413: "파일 크기 또는 행사 저장 한도를 초과했습니다."
  };
  throw new Error(messages[response.status] ?? "파일 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

export class ServerBlobStore implements BlobStore {
  constructor(private readonly scope?: ConversationScope) {}

  private path(roomId: string, documentId: string, query?: "cleanup" | "reference") {
    const params = new URLSearchParams();
    if (this.scope) {
      if (roomId !== this.scope.roomId) throw new Error("파일의 행사 범위가 일치하지 않습니다.");
      params.set("accountId", this.scope.accountId);
      params.set("conversationId", this.scope.conversationId);
    }
    if (query) params.set(query, "1");
    return `/api/files/${encodeURIComponent(roomId)}/${encodeURIComponent(documentId)}${params.size ? `?${params}` : ""}`;
  }

  async put(roomId: string, documentId: string, blob: Blob, metadata?: DocumentFileMetadata) {
    const name = "name" in blob && typeof blob.name === "string" ? blob.name : undefined;
    const file = metadata ?? (name === undefined ? undefined : documentFileMetadata({ name, size: blob.size }));
    if (!isDocumentFileMetadata(file) || file.size !== blob.size) throw new Error("업로드할 파일 정보를 확인해 주세요.");
    await rawRequest(this.path(roomId, documentId), {
      method: "PUT", body: blob,
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }
    });
  }

  async get(roomId: string, documentId: string) {
    const response = await rawRequest(this.path(roomId, documentId));
    return response.status === 404 ? undefined : response.blob();
  }

  async delete(roomId: string, documentId: string) {
    await rawRequest(this.path(roomId, documentId), { method: "DELETE" });
  }

  async queueCleanup(roomId: string, documentId: string) {
    await backendFetch(this.path(roomId, documentId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue" }) });
  }

  async listCleanup(roomId: string): Promise<string[]> {
    const result = await backendFetch(this.path(roomId, "_journal", "cleanup"));
    if (!Array.isArray(result?.ids) || !result.ids.every((id: unknown) => typeof id === "string" && !!id && id.length <= 128)) throw new Error("파일 정리 목록을 읽지 못했습니다.");
    return result.ids;
  }

  async retireCleanup(roomId: string, documentId: string) {
    await backendFetch(this.path(roomId, documentId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retire" }) });
  }

  async isReferenced(roomId: string, documentId: string): Promise<boolean> {
    const result = await backendFetch(this.path(roomId, documentId, "reference"));
    if (typeof result?.referenced !== "boolean") throw new Error("서버의 파일 참조 정보를 확인하지 못했습니다.");
    return result.referenced;
  }
}

export function createServerBlobStore(scope?: ConversationScope) { return new ServerBlobStore(scope); }
