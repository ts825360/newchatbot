import { ApiError } from "./http";
import { object, text } from "./record-schema";

export type GeminiMessage = { role: "user" | "model"; parts: { text: string }[] };
const supportedModel = "gemini-3.8-flash";
const unavailable = () => new ApiError(503, "Gemini를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
const invalidReply = () => new ApiError(502, "Gemini에서 표시할 수 있는 답변을 받지 못했습니다. 메시지를 확인하거나 다시 요청해 주세요.");

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

export async function generateGeminiText(contents: GeminiMessage[], signal: AbortSignal, styleInstruction = ""): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!key || model !== supportedModel) throw unavailable();
  const timeout = AbortSignal.timeout(60_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.any([signal, timeout]),
      body: JSON.stringify({
        contents,
        ...(styleInstruction ? { systemInstruction: { parts: [{ text: styleInstruction }] } } : {}),
        generationConfig: { candidateCount: 1, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "LOW" } },
      }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status >= 500) throw new ApiError(503, "Gemini 서버에서 일시적인 오류가 발생했습니다. 잠시 후 답변을 다시 요청해 주세요.");
      if (response.status === 429) throw new ApiError(503, "Gemini 요청 한도에 도달했습니다. 잠시 후 답변을 다시 요청해 주세요.");
      throw [401, 403, 404].includes(response.status) ? unavailable() : invalidReply();
    }
    const reply = await readReply(response);
    const candidate = object(reply) && Array.isArray(reply.candidates) ? reply.candidates[0] : undefined;
    if (object(candidate) && candidate.finishReason === "MAX_TOKENS") {
      throw new ApiError(502, "Gemini 답변이 길이 한도에 도달했습니다. 질문을 짧게 나눠서 보내거나 다시 요청해 주세요.");
    }
    if (!object(candidate) || candidate.finishReason !== "STOP" || !object(candidate.content) || candidate.content.role !== "model" || !Array.isArray(candidate.content.parts)) throw invalidReply();
    const output: string[] = [];
    for (const part of candidate.content.parts) {
      if (!object(part) || typeof part.text !== "string" || Object.keys(part).some((key) => !["text", "thought", "thoughtSignature"].includes(key))) throw invalidReply();
      if (part.thought !== true) output.push(part.text);
    }
    const result = output.join("").trim();
    if (!text(result, 16_000)) throw invalidReply();
    return result;
  } catch (error) {
    if (signal.aborted) throw new ApiError(408, "답변 요청이 취소되었습니다.");
    if (timeout.aborted) throw new ApiError(504, "Gemini 답변 시간이 초과되었습니다. 다시 시도해 주세요.");
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
