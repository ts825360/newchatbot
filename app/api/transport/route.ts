import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { validateTransportInput } from "@/lib/transport";
import { requireUser, requirePermission } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { ApiError, errorResponse } from "@/lib/server/http";
import { requireOwnedConversation } from "@/lib/server/conversation-scope";

export const runtime = "nodejs";
let running = false;
const limit = 400_000;

class BodyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError("배정 입력이 없습니다.", 400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new BodyError("입력 전송 시간이 초과됐습니다.", 408)); }, 5_000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { void reader.cancel().catch(() => {}); throw new BodyError("입력이 너무 큽니다.", 413); }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    })()]);
  } finally { clearTimeout(timer); }
}

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "다른 사이트의 계산 요청은 허용하지 않습니다." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== (request.headers.get("host") ?? new URL(request.url).host)) return Response.json({ error: "요청 출처를 확인해 주세요." }, { status: 403 }); }
    catch { return Response.json({ error: "요청 출처가 올바르지 않습니다." }, { status: 403 }); }
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON 입력이 필요합니다." }, { status: 415 });
  if (running) return Response.json({ error: "다른 계산이 진행 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  running = true;
  try {
    const actor = requireUser(request); requirePermission(actor, "editChecklist");
    const body = await readBody(request);
    let data: unknown;
    try { data = JSON.parse(body); }
    catch { return Response.json({ error: "JSON 형식이 올바르지 않습니다." }, { status: 400 }); }
    const errors = validateTransportInput(data);
    if (errors.length) return Response.json({ error: errors.join(" ") }, { status: 400 });
    const { roomId, accountId, conversationId } = data as { roomId?: unknown; accountId?: unknown; conversationId?: unknown };
    if (typeof roomId !== "string" || !getDatabase().prepare("SELECT 1 FROM rooms WHERE id=?").get(roomId)) throw new ApiError(404, "계산할 행사방을 확인해 주세요.");
    if (accountId !== undefined || conversationId !== undefined) {
      if (accountId !== actor.id || typeof conversationId !== "string") throw new ApiError(404, "계산할 대화를 확인해 주세요.");
      requirePermission(actor, "chat");
      requireOwnedConversation(getDatabase(), { accountId, roomId, conversationId });
    }
    const executable = path.join(process.cwd(), ".local", "transport-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    if (!existsSync(executable)) return Response.json({ error: "차량 계산 환경이 준비되지 않았습니다. 운영자에게 문의해 주세요." }, { status: 503 });
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, ["-X", "utf8", path.join(process.cwd(), "scripts", "transport_solver.py")], {
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { NODE_ENV: "production", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      });
      let stdout = ""; let outputSize = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error("계산 시간이 초과됐습니다. 조건을 확인하고 다시 시도해 주세요.")); }, 20_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        outputSize += Buffer.byteLength(chunk, "utf8");
        if (outputSize > limit) { child.kill(); reject(new Error("계산 결과 크기를 초과했습니다.")); }
        else stdout += chunk;
      });
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.on("error", () => { clearTimeout(timer); reject(new Error("계산기를 실행할 수 없습니다. 운영자에게 문의해 주세요.")); });
      child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error("계산에 실패했습니다. 입력 조건을 확인해 주세요.")); });
      child.stdin.end(JSON.stringify(data));
    });
    requireUser(request);
    return Response.json(JSON.parse(output), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return Response.json({ error: error instanceof Error ? error.message : "계산에 실패했습니다." }, { status: error instanceof BodyError ? error.status : 500 });
  } finally { running = false; }
}
