import { MAX_DOCUMENT_FILE_SIZE } from "@/lib/document-files";
import { requireUser } from "@/lib/server/auth";
import {
  deleteFile, fileContentDisposition, getFile, isFileReferenced, listFileCleanup,
  putFile, queueFileCleanup, requireFileScope, retireFileCleanup
} from "@/lib/server/files";
import { ApiError, assertSameOrigin, errorResponse, json, readBytes, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string; documentId: string }> };
function fileScope(request: Request, roomId: string, actorId: string) {
  const query = new URL(request.url).searchParams;
  if (query.get("accountId") !== actorId) throw new ApiError(404, "대화의 파일을 찾을 수 없습니다.");
  const conversationId = query.get("conversationId");
  if (!conversationId) throw new ApiError(404, "대화의 파일을 찾을 수 없습니다.");
  return { roomId, conversationId };
}

export async function GET(request: Request, context: Context) {
  try {
    const { roomId, documentId } = await context.params;
    const actor = requireUser(request);
    const query = new URL(request.url).searchParams;
    const scope = fileScope(request, roomId, actor.id);
    if (query.get("cleanup") === "1" && documentId === "_journal") return json({ ids: listFileCleanup(actor, scope) });
    if (query.get("reference") === "1") return json({ referenced: isFileReferenced(actor, scope, documentId) });
    const file = getFile(actor, scope, documentId);
    if (!file) throw new ApiError(404, "파일을 찾을 수 없습니다.");
    return new Response(new Uint8Array(file.bytes), { headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.size),
      "Content-Disposition": fileContentDisposition(file.name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    } });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const actor = requireUser(request);
    const { roomId, documentId } = await context.params;
    const scope = fileScope(request, roomId, actor.id);
    requireFileScope(actor, scope, "uploadDocument");
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/octet-stream") {
      throw new ApiError(415, "파일 바이트 요청이 필요합니다.");
    }
    const encodedName = request.headers.get("x-file-name");
    let name: string;
    try {
      if (!encodedName || encodedName.length > 3072) throw Error();
      name = decodeURIComponent(encodedName);
    } catch { throw new ApiError(400, "파일 이름을 확인해 주세요."); }
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_DOCUMENT_FILE_SIZE)) throw new ApiError(413, "파일은 5 MiB 이하여야 합니다.");
    const bytes = await readBytes(request, MAX_DOCUMENT_FILE_SIZE);
    const current = requireUser(request);
    putFile(current, fileScope(request, roomId, current.id), documentId, name, bytes);
    return json({ ok: true }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const actor = requireUser(request);
    const { roomId, documentId } = await context.params;
    requireFileScope(actor, fileScope(request, roomId, actor.id), "uploadDocument", undefined, true);
    const input = await readJson(request, 1024);
    if (!input || typeof input !== "object" || Array.isArray(input) || !("action" in input) || (input.action !== "queue" && input.action !== "retire")) throw new ApiError(400, "파일 정리 요청을 확인해 주세요.");
    const current = requireUser(request);
    const scope = fileScope(request, roomId, current.id);
    if (input.action === "queue") queueFileCleanup(current, scope, documentId);
    else retireFileCleanup(current, scope, documentId);
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { roomId, documentId } = await context.params;
    const actor = requireUser(request);
    deleteFile(actor, fileScope(request, roomId, actor.id), documentId);
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
