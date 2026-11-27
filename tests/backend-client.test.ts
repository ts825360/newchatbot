import { afterEach, describe, expect, it, vi } from "vitest";
import { configureBackendUser, dataStorage, discardBackendWrites, enableBackendConnection, flushBackendWrites, getBackendState, refreshBackendData, resetBackendClient } from "@/lib/backend-client";
import { defaultProfile } from "@/lib/mock-data";
const key = "church-planner-room-materials-v1:room-1:checklist";
const profile = { ...defaultProfile, accountId: "user-1" };
const value = JSON.stringify({ version: 1, items: [] });
const snapshot = (version = "0", raw = value) => ({ profile, activeRoomId: "room-1", records: [{ key, version, value: raw }] });
afterEach(() => { resetBackendClient(); vi.unstubAllGlobals(); });
describe("connected server record storage", () => {
  it("hydrates from server and waits for acknowledgement instead of claiming a local save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot() }));
    enableBackendConnection(true); configureBackendUser(profile); await refreshBackendData();
    const storage = dataStorage(localStorage);
    expect(storage.getItem(key)).toBe(value);
    const next = JSON.stringify({ version: 1, items: [{ id: "one" }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot("1", next), written: [{ key, version: "1", value: next }] }) }));
    storage.setItem(key, next);
    expect(getBackendState().phase).toBe("saving");
    await flushBackendWrites();
    expect(getBackendState().pending).toBe(0);
    expect(getBackendState().phase).toBe("saved");
  });
  it("keeps failed drafts pending, never falling back to browser storage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot() }));
    enableBackendConnection(true); configureBackendUser(profile); await refreshBackendData();
    const storage = dataStorage(localStorage); const next = JSON.stringify({ version: 1, items: ["draft"] });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    storage.setItem(key, next);
    await expect(flushBackendWrites()).rejects.toThrow();
    expect(storage.getItem(key)).toBe(next);
    expect(getBackendState().pending).toBe(1);
    expect(getBackendState().phase).toBe("failed");
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("does not erase newer edits made while a write is in flight", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot() }));
    enableBackendConnection(true); configureBackendUser(profile); await refreshBackendData();
    let resolve!: (value: unknown) => void;
    const first = new Promise((r) => { resolve = r; });
    const fetcher = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot("2", "second"), written: [{ key, version: "2", value: "second" }] }) });
    vi.stubGlobal("fetch", fetcher);
    const storage = dataStorage(localStorage); storage.setItem(key, "first"); const pending = flushBackendWrites();
    storage.setItem(key, "second");
    resolve({ ok: true, json: async () => ({ ...snapshot("1", "first"), written: [{ key, version: "1", value: "first" }] }) });
    await pending;
    expect(storage.getItem(key)).toBe("second");
    expect(JSON.parse(fetcher.mock.calls[1][1].body).writes[0].version).toBe("1");
  });
  it("does not replace acknowledged data with an older in-flight poll", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot("1") }));
    enableBackendConnection(true); configureBackendUser(profile); await refreshBackendData();
    let resolve!: (value: unknown) => void;
    const oldPoll = new Promise((r) => { resolve = r; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(oldPoll).mockResolvedValue({ ok: true, json: async () => ({ ...snapshot("2", "new"), written: [{ key, version: "2", value: "new" }] }) }));
    const refresh = refreshBackendData();
    const storage = dataStorage(localStorage); storage.setItem(key, "new"); await flushBackendWrites();
    resolve({ ok: true, json: async () => snapshot("1") }); await refresh;
    expect(storage.getItem(key)).toBe("new");
  });
  it("restores active-room records immediately when failed drafts are discarded", async () => {
    const catalogKey = "church-planner-room-catalog-v1:user-1";
    const catalog = { key: catalogKey, version: "1:1", value: JSON.stringify({ rooms: [{ id: "room-1" }], selectedRoomId: "room-1" }) };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), records: [catalog, ...snapshot().records] }) });
    vi.stubGlobal("fetch", fetcher);
    enableBackendConnection(true); configureBackendUser(profile); await refreshBackendData();
    const storage = dataStorage(localStorage); storage.setItem(key, "draft");
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(flushBackendWrites()).rejects.toThrow();
    fetcher.mockImplementation(async (path: string) => ({ ok: true, json: async () => ({ ...snapshot("2", "latest"), records: path.includes("roomId=room-1") ? [catalog, ...snapshot("2", "latest").records] : [catalog] }) }));
    await discardBackendWrites();
    expect(storage.getItem(key)).toBe("latest");
    expect(getBackendState().pending).toBe(0);
  });

  it("keeps catalog polling and saves separate from the selected workspace scope", async () => {
    const catalogKey = "church-planner-room-catalog-v1:user-1";
    const catalog = { key: catalogKey, version: "1:1", value: JSON.stringify({ rooms: [{ id: "room-1" }], selectedRoomId: "room-1" }) };
    const result = { ...snapshot(), records: [catalog], written: [catalog] };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetcher);
    enableBackendConnection(true);
    configureBackendUser(profile);
    const oldPath = window.location.pathname;
    try {
      window.history.replaceState(null, "", "/rooms");
      await refreshBackendData();
      await refreshBackendData();
      expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/api/data", "/api/data"]);
      dataStorage(localStorage).setItem(catalogKey, catalog.value);
      await flushBackendWrites();
      expect(JSON.parse(fetcher.mock.calls[2][1].body)).not.toHaveProperty("roomId");
      window.history.replaceState(null, "", "/workspace");
      await refreshBackendData();
      expect(fetcher.mock.calls[3][0]).toBe("/api/data?roomId=room-1");
    } finally { window.history.replaceState(null, "", oldPath); }
  });
});
