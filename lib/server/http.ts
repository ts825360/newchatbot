export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function errorResponse(error: unknown): Response {
  return error instanceof ApiError ? json({ error: error.message }, error.status) : json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
}

export function assertSameOrigin(request: Request): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "다른 사이트에서 보낸 요청입니다.");
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    if (new URL(origin).host !== (request.headers.get("host") ?? new URL(request.url).host)) throw new Error();
  } catch { throw new ApiError(403, "요청 출처를 확인해 주세요."); }
}

export async function readBytes(request: Pick<Request, "body">, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "요청 내용이 없습니다.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new ApiError(408, "입력 전송 시간이 초과됐습니다.")); }, 10_000); }),
      (async () => {
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new ApiError(413, "요청 내용이 너무 큽니다."); }
          chunks.push(value);
        }
        return new Uint8Array(Buffer.concat(chunks));
      })(),
    ]);
  } finally { clearTimeout(timer); }
}

export async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
  assertSameOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError(415, "JSON 요청이 필요합니다.");
  const bytes = await readBytes(request, maxBytes);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "JSON 형식이 올바르지 않습니다."); }
}
