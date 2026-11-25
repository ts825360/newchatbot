import { request } from "node:http";
import { ApiError } from "./http";
import { object, text } from "./record-schema";

export type OllamaMessage = { role: "system" | "user" | "assistant"; content: string };
const unavailable = () => new ApiError(503, "로컬 Ollama 또는 대화 모델을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
const invalidReply = () => new ApiError(502, "로컬 Ollama에서 유효한 답변을 받지 못했습니다.");

function localOrigin() {
  let url: URL;
  try { url = new URL(process.env.OLLAMA_BASE_URL ?? ""); }
  catch { throw unavailable(); }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash
    || !["/", "/api", "/api/"].includes(url.pathname)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw unavailable();
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

async function post(origin: string, path: "/api/show" | "/api/chat", value: unknown, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const body = JSON.stringify(value);
  try {
    return await new Promise((resolve, reject) => {
      // A direct, numeric-loopback connection neither uses a proxy nor follows redirects.
      const outgoing = request(new URL(path, origin), {
        method: "POST", agent: false, signal: AbortSignal.any([signal, timeout]),
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, async (incoming) => {
        try {
          const status = incoming.statusCode ?? 0;
          if (status !== 200) {
            incoming.destroy();
            throw [403, 404, 429, 503].includes(status) ? unavailable() : invalidReply();
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of incoming) {
            size += chunk.length;
            if (size > 256 * 1024) throw invalidReply();
            chunks.push(chunk);
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) { reject(error); }
      });
      outgoing.once("error", reject);
      outgoing.end(body);
    });
  } catch (error) {
    if (signal.aborted) throw new ApiError(408, "답변 요청이 취소되었습니다.");
    if (timeout.aborted) throw new ApiError(504, "로컬 Ollama 답변 시간이 초과되었습니다. 다시 시도해 주세요.");
    if (error instanceof ApiError) throw error;
    throw error instanceof SyntaxError ? invalidReply() : unavailable();
  }
}

export async function openLocalChat(signal: AbortSignal) {
  const origin = localOrigin();
  const configured = process.env.OLLAMA_MODEL?.trim();
  if (configured !== "qwen3:4b") throw unavailable();
  // Ollama's :local source selector rejects remote-backed models even if an alias changes.
  const model = `${configured}:local`;
  const info = await post(origin, "/api/show", { model }, signal, 5_000);
  if (!object(info) || info.remote_model || info.remote_host || info.details?.format !== "gguf"
    || !Array.isArray(info.capabilities) || !info.capabilities.includes("completion")) throw unavailable();

  return async (messages: OllamaMessage[], format?: Record<string, unknown>) => {
    const reply = await post(origin, "/api/chat", {
      model, messages, stream: false, think: false,
      options: format ? { num_ctx: 4096, num_predict: 96 } : { num_ctx: 8192, num_predict: 512 },
      ...(format ? { format } : {}),
    }, signal, format ? 18_000 : 120_000);
    if (!object(reply) || reply.remote_model || reply.remote_host || reply.done !== true || !object(reply.message)
      || reply.message.role !== "assistant" || reply.message.tool_calls?.length || !text(reply.message.content, 16_000)) throw invalidReply();
    return reply.message.content.trim();
  };
}
