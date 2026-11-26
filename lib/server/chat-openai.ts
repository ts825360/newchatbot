import { ApiError } from "./http";
import { object, text } from "./record-schema";

const unavailable = () => new ApiError(503, "OpenAI 채팅을 사용할 수 없습니다. 연결 설정을 확인하거나 잠시 후 다시 시도해 주세요.");
const invalidReply = () => new ApiError(502, "OpenAI에서 표시할 수 있는 답변을 받지 못했습니다. 질문을 확인하거나 다시 요청해 주세요.");

async function readReply(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw invalidReply();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) throw invalidReply();
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw invalidReply(); }
}

export type OpenAIChatTurn = { role: "user"; content: string };

export async function generateOpenAIText(input: string | OpenAIChatTurn[], signal: AbortSignal, instructions = "", format?: Record<string, unknown>): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
  if (process.env.AI_PROVIDER !== "openai" || !key || (model !== "gpt-6-luna" && model !== "gpt-6.2-sol")) throw unavailable();
  const timeout = AbortSignal.timeout(45_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.any([signal, timeout]),
      body: JSON.stringify({
        model, ...(instructions && { instructions }), input, store: false,
        reasoning: { effort: model === "gpt-6-luna" ? "none" : "low" }, max_output_tokens: 1200,
        ...(format && { text: { format } }),
      }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        const error = await readReply(response).catch(() => undefined);
        const code = object(error) && object(error.error) ? error.error.code : undefined;
        if (code === "insufficient_quota" || code === "credit_balance_exhausted") {
          throw new ApiError(503, "OpenAI API 잔액 또는 프로젝트 사용 한도를 확인해 주세요.");
        }
        throw new ApiError(429, "OpenAI 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
      }
      void response.body?.cancel().catch(() => {});
      if (response.status >= 500) throw new ApiError(503, "OpenAI 서버에서 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      throw [401, 403, 404].includes(response.status) ? unavailable() : invalidReply();
    }
    const reply = await readReply(response);
    if (object(reply) && reply.status === "incomplete" && object(reply.incomplete_details) && reply.incomplete_details.reason === "max_output_tokens") {
      throw new ApiError(502, "OpenAI 답변이 길이 한도에 도달했습니다. 질문을 짧게 나눠 주세요.");
    }
    if (!object(reply) || reply.status !== "completed" || !Array.isArray(reply.output)) throw invalidReply();
    const output: string[] = [];
    for (const item of reply.output) {
      if (object(item) && item.type === "reasoning") continue;
      if (!object(item) || item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) throw invalidReply();
      for (const part of item.content) {
        if (!object(part) || part.type !== "output_text" || typeof part.text !== "string") throw invalidReply();
        output.push(part.text);
      }
    }
    const result = output.join("\n").trim();
    if (!text(result, 16_000)) throw invalidReply();
    return result;
  } catch (error) {
    if (signal.aborted) throw new ApiError(408, "답변 요청이 취소되었습니다.");
    if (timeout.aborted) throw new ApiError(504, "OpenAI 답변 시간이 초과되었습니다. 다시 시도해 주세요.");
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
