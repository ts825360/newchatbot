// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendFetch } from "@/lib/backend-client";
import { createServerBlobStore } from "@/lib/server-blob-store";

vi.mock("@/lib/backend-client", () => ({ backendFetch: vi.fn() }));
const rawFetch = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", rawFetch); vi.mocked(backendFetch).mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); rawFetch.mockReset(); });

describe("authenticated server BlobStore", () => {
  it("sends encoded names and raw canonical bytes with same-origin credentials", async () => {
    rawFetch.mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }));
    const store = createServerBlobStore();
    const blob = new Blob(["notes"], { type: "text/html" });
    await store.put("room a", "id", blob, { name: '주일 "일정".MD', size: blob.size, type: "text/plain" });
    const [url, init] = rawFetch.mock.calls[0];
    expect(url).toBe("/api/files/room%20a/id");
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin", cache: "no-store", body: blob });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/octet-stream");
    expect(new Headers(init?.headers).get("X-File-Name")).toBe(encodeURIComponent('주일 "일정".MD'));
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("accepts a File directly but rejects unnamed or mismatched metadata without sending bytes", async () => {
    const store = createServerBlobStore();
    rawFetch.mockResolvedValueOnce(Response.json({ ok: true }));
    await store.put("r", "id", new File(["x"], "x.txt"));
    await expect(store.put("r", "id", new Blob(["x"]))).rejects.toThrow();
    await expect(store.put("r", "id", new Blob(["x"]), { name: "x.txt", size: 2, type: "text/plain" })).rejects.toThrow();
    expect(rawFetch).toHaveBeenCalledOnce();
  });

  it("fetches BLOBs and performs idempotent deletion without parsing them as JSON", async () => {
    rawFetch.mockResolvedValueOnce(new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } }));
    const store = createServerBlobStore();
    const blob = await store.get("r", "id");
    expect(blob?.type).toBe("application/pdf");
    expect(await blob?.text()).toBe("%PDF-1.7");
    rawFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await store.get("r", "missing")).toBeUndefined();
    rawFetch.mockResolvedValueOnce(Response.json({ ok: true }));
    await store.delete("r", "id");
    expect(rawFetch).toHaveBeenLastCalledWith("/api/files/r/id", expect.objectContaining({ method: "DELETE", credentials: "same-origin" }));
  });

  it("uses backendFetch for durable journal actions and authoritative reference queries", async () => {
    const store = createServerBlobStore();
    vi.mocked(backendFetch).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ids: ["id"] }).mockResolvedValueOnce({ referenced: true }).mockResolvedValueOnce({ ok: true });
    await store.queueCleanup("r", "id");
    expect(backendFetch).toHaveBeenLastCalledWith("/api/files/r/id", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "queue" }) }));
    expect(await store.listCleanup("r")).toEqual(["id"]);
    expect(await store.isReferenced("r", "id")).toBe(true);
    expect(backendFetch).toHaveBeenLastCalledWith("/api/files/r/id?reference=1");
    await store.retireCleanup("r", "id");
    expect(backendFetch).toHaveBeenLastCalledWith("/api/files/r/id", expect.objectContaining({ body: JSON.stringify({ action: "retire" }) }));
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409, 413, 500])("reports clean actionable raw request errors for HTTP %s", async (status) => {
    rawFetch.mockResolvedValueOnce(new Response("<html>private internal error</html>", { status }));
    await expect(createServerBlobStore().get("r", "id")).rejects.toThrow(/로그인|권한|사용 중|한도|처리하지/);
  });

  it("never treats malformed reference responses or server failures as unreferenced", async () => {
    const store = createServerBlobStore();
    vi.mocked(backendFetch).mockResolvedValueOnce({ referenced: "false" }).mockResolvedValueOnce({ ids: [1] }).mockRejectedValueOnce(Error("offline"));
    await expect(store.isReferenced("r", "id")).rejects.toThrow();
    await expect(store.listCleanup("r")).rejects.toThrow();
    await expect(store.isReferenced("r", "id")).rejects.toThrow("offline");
  });
});
