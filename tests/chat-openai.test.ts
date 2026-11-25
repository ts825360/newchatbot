// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateOpenAIText } from "@/lib/server/chat-openai";

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
