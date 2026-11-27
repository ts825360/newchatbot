import { hasObviousPrivateData } from "../assistant-privacy";
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

export type OpenAIChatTurn = { role: "user" | "assistant"; content: string };
export type ChatTool = {
  definition: { type: "function"; name: string; strict: true; description: string; parameters: Record<string, unknown> };
  policy?: { requires?: readonly string[]; effect?: (args: Record<string, unknown>) => "read" | "draft";
    satisfies?: (args: Record<string, unknown>) => boolean; stateKey?: () => string };
  run: (argumentsValue: unknown) => string;
};
type StopReason = "duplicate" | "draft_already_staged" | "budget";
type ToolRunOptions = { adaptiveOutput?: boolean; onStopped?: (reason: StopReason) => void };
const maxToolSteps = 5;
const defaultOutputTokens = 1200;
const complexOutputTokens = 1800;

function canonicalArguments(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalArguments).join(",") + "]";
  if (!object(value)) return JSON.stringify(value);
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalArguments(value[key])).join(",") + "}";
}
const maxInFlight = 4;
let inFlight = 0;

async function withOpenAI<T>(signal: AbortSignal, timeoutMs: number, run: (respond: (body: Record<string, unknown>) => Promise<unknown[]>, model: string) => Promise<T>) {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
  if (process.env.AI_PROVIDER !== "openai" || !key || (model !== "gpt-6-luna" && model !== "gpt-6.2-sol")) throw unavailable();
  const timeout = AbortSignal.timeout(timeoutMs);
  async function respond(body: Record<string, unknown>) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.any([signal, timeout]),
      body: JSON.stringify({ ...body, model, store: false }),
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
    return reply.output as unknown[];
  }
  if (inFlight >= maxInFlight) throw new ApiError(429, "외부 AI 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.");
  inFlight++;
  try { return await run(respond, model); }
  catch (error) {
    if (signal.aborted) throw new ApiError(408, "답변 요청이 취소되었습니다.");
    if (timeout.aborted) throw new ApiError(504, "OpenAI 답변 시간이 초과되었습니다. 다시 시도해 주세요.");
    if (error instanceof ApiError) throw error;
    throw unavailable();
  } finally { inFlight--; }
}

export function searchOpenAIWeb(input: string, signal: AbortSignal, instructions: string, format: Record<string, unknown>) {
  return withOpenAI(signal, 30_000, respond => respond({
    input, instructions, reasoning: { effort: "low" }, max_output_tokens: 2400,
    text: { format }, tools: [{ type: "web_search", search_context_size: "low", external_web_access: true,
      user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" } }],
    tool_choice: "required", max_tool_calls: 2, include: ["web_search_call.action.sources"],
  }));
}

export async function generateOpenAIText(input: string | OpenAIChatTurn[], signal: AbortSignal, instructions = "", format?: Record<string, unknown>, tools: readonly ChatTool[] = [], beforeRequest = () => {}, options: ToolRunOptions = {}): Promise<string> {
  if ((typeof input === "string" ? [input] : input.map(turn => turn.content)).some(hasObviousPrivateData)) {
    throw new ApiError(422, "개인정보가 포함된 문맥은 외부 AI에 보낼 수 없습니다.");
  }
  return withOpenAI(signal, 45_000, async (request, model) => {
    const used = new Set<string>();
    const completed = new Set<string>();
    const executed = new Set<string>();
    const blocked = new Set<string>();
    let draftStaged = false;
    const respond = (context: string | readonly unknown[], stopped?: StopReason) => {
      beforeRequest();
      const nextInstructions = stopped ? [instructions,
        "Tool execution stopped for this turn. Use only the results already returned. Explain any work left unverified; do not claim a missing step ran."].filter(Boolean).join("\n\n") : instructions;
      return request({
        ...(nextInstructions && { instructions: nextInstructions }), input: context, reasoning: { effort: model === "gpt-6-luna" ? "none" : "low" },
        max_output_tokens: options.adaptiveOutput && executed.size >= 2 ? complexOutputTokens : defaultOutputTokens,
        ...(format && { text: { format } }),
        ...(tools.length && { tools: tools.map(tool => tool.definition), tool_choice: stopped ? "none" : "auto", parallel_tool_calls: false,
          ...(model === "gpt-6.2-sol" && { include: ["reasoning.encrypted_content"] }) }),
      });
    };
    let items = await respond(input);
    const previous: unknown[] = typeof input === "string" ? [{ role: "user", content: input }] : [...input];
    let stopped: StopReason | undefined;
    for (;;) {
      const calls = items.filter(item => object(item) && item.type === "function_call");
      if (!calls.length) break;
      const [call] = calls;
      if (stopped || calls.length !== 1 || !object(call) || typeof call.call_id !== "string" || used.has(call.call_id)
        || !/^[a-zA-Z0-9_-]{1,128}$/.test(call.call_id) || typeof call.arguments !== "string" || call.arguments.length > 3200 || hasObviousPrivateData(call.arguments)) throw invalidReply();
      const tool = tools.find(item => item.definition.name === call.name);
      if (!tool) throw invalidReply();
      let args: unknown;
      try { args = JSON.parse(call.arguments); } catch { throw invalidReply(); }
      if (!object(args)) throw invalidReply();
      const reasoning = items.filter(item => object(item) && item.type === "reasoning" && typeof item.encrypted_content === "string");
      used.add(call.call_id);
      const signature = JSON.stringify([tool.definition.name, tool.policy?.stateKey?.() ?? "", canonicalArguments(args)]);
      const requires = tool.policy?.requires?.filter(name => !completed.has(name)) ?? [];
      const blockedSignature = JSON.stringify([signature, requires]);
      const drafts = tool.policy?.effect?.(args) === "draft";
      let output: string;
      if (executed.has(signature) || blocked.has(blockedSignature)) {
        stopped = "duplicate";
        output = JSON.stringify({ state: "stopped", reason: stopped });
      } else if (drafts && draftStaged) {
        stopped = "draft_already_staged";
        output = JSON.stringify({ state: "stopped", reason: stopped });
      } else if (requires.length) {
        blocked.add(blockedSignature);
        output = JSON.stringify({ state: "not_ready", requires });
      } else {
        output = tool.run(args);
        executed.add(signature);
        if (tool.policy?.satisfies?.(args) ?? true) completed.add(tool.definition.name);
        if (drafts) draftStaged = true;
      }
      if (output.length > 8000 || hasObviousPrivateData(output)) throw invalidReply();
      previous.push(...reasoning, { type: "function_call", name: tool.definition.name, call_id: call.call_id, arguments: call.arguments },
        { type: "function_call_output", call_id: call.call_id, output });
      stopped ??= used.size >= maxToolSteps ? "budget" : undefined;
      if (stopped) options.onStopped?.(stopped);
      items = await respond(previous, stopped);
    }
    const output: string[] = [];
    for (const item of items) {
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
  });
}
