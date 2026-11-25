import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/transport/route";
vi.mock("@/lib/server/auth", () => ({ requireUser: () => ({ id: "test", permissions: ["editChecklist"] }), requirePermission: () => {} }));

describe("local transport endpoint boundary", () => {
  it("rejects cross-site requests", async () => {
    const response = await POST(new Request("http://localhost/api/transport", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.com" }, body: "{}" }));
    expect(response.status).toBe(403);
  });
  it("requires JSON and validates malformed bodies", async () => {
    const plain = await POST(new Request("http://localhost/api/transport", { method: "POST", body: "{}" }));
    expect(plain.status).toBe(415);
    const invalid = await POST(new Request("http://localhost/api/transport", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    expect(invalid.status).toBe(400);
    const missing = await POST(new Request("http://localhost/api/transport", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(missing.status).toBe(400);
  });
  it("uses the public Host header when Next rewrites its internal request URL", async () => {
    const response = await POST(new Request("http://localhost:3001/api/transport", { method: "POST", headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(400);
    const wrongOrigin = await POST(new Request("http://localhost:3001/api/transport", { method: "POST", headers: { host: "127.0.0.1:3001", origin: "http://localhost:3001", "content-type": "application/json" }, body: "{}" }));
    expect(wrongOrigin.status).toBe(403);
  });
  it("bounds request bytes before parsing", async () => {
    const response = await POST(new Request("http://localhost/api/transport", { method: "POST", headers: { "content-type": "application/json" }, body: " ".repeat(400001) }));
    expect(response.status).toBe(413);
  });
  it("times out an unfinished body and releases the calculation slot", async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } });
      const request = new Request("http://localhost/api/transport", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
      const pending = POST(request);
      await vi.advanceTimersByTimeAsync(5100);
      expect((await pending).status).toBe(408);
      const next = await POST(new Request("http://localhost/api/transport", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      expect(next.status).toBe(400);
    } finally { vi.useRealTimers(); }
  });
});
