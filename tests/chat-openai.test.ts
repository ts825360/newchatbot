// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateOpenAIText, type ChatTool } from "@/lib/server/chat-openai";

const upstream = vi.fn<typeof fetch>();
const signal = new AbortController().signal;
const reply = { status: "completed", output: [
  { type: "reasoning", summary: [{ type: "summary_text", text: "DO_NOT_RETURN" }] },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "테스트 답변" }] },
] };

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-api-key");
  vi.stubEnv("OPENAI_MODEL", undefined);
  vi.stubEnv("OPENAI_BASE_URL", "https://unexpected.invalid");
  vi.stubGlobal("fetch", upstream.mockReset().mockImplementation(async () => Response.json(reply)));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const toolCall = (name: string, id: string, args = "{}") => Response.json({
  status: "completed", output: [{ type: "function_call", name, call_id: id, arguments: args }],
});
const capability = (name: string, policy?: ChatTool["policy"]) => ({
  definition: { type: "function" as const, strict: true as const, name, description: name, parameters: { type: "object" } },
  run: vi.fn(() => '{"verified":true}'), policy,
});
const requestBody = (index: number) => JSON.parse(String(upstream.mock.calls[index][1]?.body));

it("continues four useful dependent steps in one bounded run and expands only the complex final answer budget", async () => {
  const tools = [capability("prepare"), capability("status"), capability("read"), capability("edit", { requires: ["read"], effect: () => "draft" })];
  tools.forEach((tool, index) => upstream.mockResolvedValueOnce(toolCall(tool.definition.name, "step_" + index)));
  await expect(generateOpenAIText("합성 복합 요청", signal, "", undefined, tools, undefined, { adaptiveOutput: true })).resolves.toBe("테스트 답변");
  expect(upstream).toHaveBeenCalledTimes(5);
  for (const tool of tools) expect(tool.run).toHaveBeenCalledOnce();
  expect(requestBody(0).max_output_tokens).toBe(1200);
  expect(requestBody(4).max_output_tokens).toBe(1800);
});

it("does not repeat an equivalent tool call with a new call id or reordered args", async () => {
  const tool = capability("read");
  const limited = vi.fn();
  upstream.mockResolvedValueOnce(toolCall("read", "one", '{"a":1,"b":2}'))
    .mockResolvedValueOnce(toolCall("read", "two", '{"b":2,"a":1}'));
  await expect(generateOpenAIText("합성 조회", signal, "", undefined, [tool], undefined, { onStopped: limited })).resolves.toBe("테스트 답변");
  expect(tool.run).toHaveBeenCalledOnce();
  expect(upstream).toHaveBeenCalledTimes(3);
  expect(requestBody(2).tool_choice).toBe("none");
  expect(JSON.parse(requestBody(2).input.at(-1).output)).toMatchObject({ state: "stopped", reason: "duplicate" });
  expect(limited).toHaveBeenCalledWith("duplicate");
});

it("reports a missing dependency without running a draft and allows an ordered recovery", async () => {
  const read = capability("read");
  const edit = capability("edit", { requires: ["read"], effect: () => "draft" });
  upstream.mockResolvedValueOnce(toolCall("edit", "one"))
    .mockResolvedValueOnce(toolCall("read", "two"))
    .mockResolvedValueOnce(toolCall("edit", "three"));
  await expect(generateOpenAIText("합성 수정", signal, "", undefined, [read, edit])).resolves.toBe("테스트 답변");
  expect(JSON.parse(requestBody(1).input.at(-1).output)).toMatchObject({ state: "not_ready", requires: ["read"] });
  expect(read.run).toHaveBeenCalledOnce();
  expect(edit.run).toHaveBeenCalledOnce();
});

it("forces a single final response after the tool budget and rejects a further tool request", async () => {
  const tool = capability("read");
  const limited = vi.fn();
  for (let index = 0; index < 6; index++) upstream.mockResolvedValueOnce(toolCall("read", "step_" + index, JSON.stringify({ index })));
  await expect(generateOpenAIText("검증용 요청", signal, "", undefined, [tool], undefined, { onStopped: limited })).rejects.toMatchObject({ status: 502 });
  expect(upstream).toHaveBeenCalledTimes(6);
  expect(tool.run).toHaveBeenCalledTimes(5);
  expect(requestBody(5).tool_choice).toBe("none");
  expect(limited).toHaveBeenCalledWith("budget");
});

it("leaves a second draft action unexecuted and completes with the first result", async () => {
  const first = capability("first", { effect: () => "draft" });
  const other = capability("other", { effect: () => "draft" });
  upstream.mockResolvedValueOnce(toolCall("first", "one")).mockResolvedValueOnce(toolCall("other", "two"));
  await expect(generateOpenAIText("합성 초안 요청", signal, "", undefined, [first, other])).resolves.toBe("테스트 답변");
  expect(first.run).toHaveBeenCalledOnce();
  expect(other.run).not.toHaveBeenCalled();
  expect(JSON.parse(requestBody(2).input.at(-1).output)).toMatchObject({ reason: "draft_already_staged" });
});

it("uses Luna by default, sends one message to the fixed Responses URL without tools or storage, and returns only the answer", async () => {
  await expect(generateOpenAIText("테스트 질문", signal, "테스트 지침")).resolves.toBe("테스트 답변");
  const [url, init] = upstream.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/responses");
  expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store" });
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-api-key");
  expect(JSON.parse(String(init?.body))).toEqual({ model: "gpt-6-luna", instructions: "테스트 지침", input: "테스트 질문",
    store: false, reasoning: { effort: "none" }, max_output_tokens: 1200 });
});

it("honors explicit Sol without granting access to arbitrary endpoints or models", async () => {
  vi.stubEnv("OPENAI_MODEL", "gpt-6.2-sol");
  await generateOpenAIText("테스트 질문", signal);
  expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toMatchObject({ model: "gpt-6.2-sol", reasoning: { effort: "low" } });
  vi.stubEnv("OPENAI_MODEL", "unexpected-model");
  await expect(generateOpenAIText("테스트 질문", signal)).rejects.toMatchObject({ status: 503 });
  expect(upstream).toHaveBeenCalledOnce();
});

it("fails closed when disabled even if API keys exist", async () => {
  vi.stubEnv("AI_PROVIDER", "none");
  await expect(generateOpenAIText("테스트 질문", signal)).rejects.toMatchObject({ status: 503 });
  expect(upstream).not.toHaveBeenCalled();
});

it("distinguishes account quota errors from rate limiting without echoing upstream data", async () => {
  upstream.mockResolvedValueOnce(Response.json({ error: { code: "insufficient_quota", message: "DO_NOT_RETURN" } }, { status: 429 }));
  await expect(generateOpenAIText("테스트 질문", signal)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("잔액") });
  upstream.mockResolvedValueOnce(Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 }));
  await expect(generateOpenAIText("테스트 질문", signal)).rejects.toMatchObject({ status: 429 });
});
