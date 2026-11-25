// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "@/lib/server/database";
import { DELETE, GET, POST, PUT } from "@/app/api/files/[roomId]/[documentId]/route";

const fixture = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }));
vi.mock("@/lib/server/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/database")>(),
  getDatabase: () => { if (!fixture.db) throw Error("No file test fixture"); return fixture.db; }
}));
let editorCookie: string;
let viewerCookie: string;
let memberCookie: string;
const url = (id = "id", query = "", room = "room-a", account = "editor", conversation = `initial-${room}`) => `http://localhost/api/files/${room}/${id}?accountId=${account}&conversationId=${conversation}${query ? "&" + query.slice(1) : ""}`;
const context = (id = "id", room = "room-a") => ({ params: Promise.resolve({ roomId: room, documentId: id }) });
function request(method: string, options: { id?: string; room?: string; query?: string; cookie?: string; account?: string; conversation?: string; body?: BodyInit; headers?: HeadersInit } = {}) {
  const headers = new Headers(options.headers);
  headers.set("Cookie", options.cookie ?? editorCookie);
  if (method === "PUT") { if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream"); if (!headers.has("X-File-Name")) headers.set("X-File-Name", encodeURIComponent('주일 "일정".MD')); }
  const account = options.account ?? (options.cookie === viewerCookie ? "viewer" : options.cookie === memberCookie ? "member" : "editor");
  return new Request(url(options.id, options.query, options.room, account, options.conversation), { method, headers, body: options.body });
}
function liveReference(id = "id") {
  const file = fixture.db!.prepare("SELECT name,mime,size FROM conversation_files WHERE owner_id='editor' AND room_id=? AND conversation_id='initial-room-a' AND document_id=?").get("room-a", id)!;
  fixture.db!.prepare("INSERT OR REPLACE INTO records(key,room_id,owner_id,kind,data_json,updated_at) VALUES (?,?,?,?,?,?)")
    .run("private-v1:editor:room-a:initial-room-a:documents", "room-a", "editor", "documents", JSON.stringify({ version: 1, items: [{ id, title: file.name, kind: "file", pinned: false, file: { name: file.name, type: file.mime, size: file.size } }] }), new Date().toISOString());
}
beforeEach(() => {
  fixture.db = createDatabase(":memory:");
  fixture.db.prepare("INSERT INTO rooms(id,data_json) VALUES (?,?)").run("room-a", '{"id":"room-a"}');
  fixture.db.prepare("INSERT INTO rooms(id,data_json) VALUES (?,?)").run("room-b", '{"id":"room-b"}');
  const cookies: string[] = [];
  for (const [id, grade, permissions] of [["editor", 2, ["viewRoom", "chat", "uploadDocument"]], ["viewer", 3, ["viewRoom", "chat"]], ["member", 3, ["viewRoom", "chat", "uploadDocument"]]] as const) {
    fixture.db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, id, id, grade, "fixture", JSON.stringify(permissions), "fixture", "fixture", new Date().toISOString());
    const token = randomBytes(32).toString("base64url");
    fixture.db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES (?,?,0,?,?)").run(createHash("sha256").update(token).digest("hex"), id, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
    cookies.push(`church_session=${token}`);
  }
  [editorCookie, viewerCookie, memberCookie] = cookies;
});
afterEach(() => { fixture.db?.close(); fixture.db = undefined; });

describe("authenticated file routes with real session validation", () => {
  it("rejects unauthenticated reads and writes without disclosing content", async () => {
    expect((await GET(new Request(url()), context())).status).toBe(401);
    expect((await PUT(new Request(url(), { method: "PUT", body: "x" }), context())).status).toBe(401);
    expect((await POST(new Request(url(), { method: "POST", body: "{}" }), context())).status).toBe(401);
    expect((await DELETE(new Request(url(), { method: "DELETE" }), context())).status).toBe(401);
  });

  it("downloads only from the requested existing room with canonical MIME, attachment and nosniff", async () => {
    expect((await PUT(request("PUT", { body: "<script>never run</script>" }), context())).status).toBe(201);
    const response = await GET(request("GET"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(response.headers.get("Content-Disposition")).toContain(encodeURIComponent('주일 "일정".MD'));
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).toBe("<script>never run</script>");
    expect((await GET(request("GET", { cookie: viewerCookie, account: "editor" }), context())).status).toBe(404);
    expect((await GET(request("GET", { cookie: viewerCookie }), context())).status).toBe(404);
    expect((await GET(request("GET", { conversation: "unowned" }), context())).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/files/room-a/id", { headers: { Cookie: editorCookie } }), context())).status).toBe(404);
    expect((await GET(request("GET", { room: "room-b" }), context("id", "room-b"))).status).toBe(404);
    expect((await GET(request("GET", { room: "missing" }), context("id", "missing"))).status).toBe(404);
  });

  it("allows edit-capable grade3 uploads but denies viewers and stale/suspended sessions", async () => {
    expect((await PUT(request("PUT", { body: "x", cookie: viewerCookie }), context())).status).toBe(403);
    expect((await PUT(request("PUT", { body: "x", cookie: memberCookie }), context())).status).toBe(201);
    fixture.db!.prepare("UPDATE users SET suspended=1 WHERE id=?").run("member");
    expect((await GET(request("GET", { cookie: memberCookie }), context())).status).toBe(401);
    fixture.db!.prepare("UPDATE users SET session_version=session_version+1 WHERE id=?").run("editor");
    expect((await DELETE(request("DELETE"), context())).status).toBe(401);
  });

  it("reports authoritative references and durable journal state, preventing stale cleanup of live files", async () => {
    await PUT(request("PUT", { body: "x" }), context());
    expect(await (await GET(request("GET", { query: "?reference=1" }), context())).json()).toEqual({ referenced: false });
    expect(await (await GET(request("GET", { id: "_journal", query: "?cleanup=1", cookie: viewerCookie }), context("_journal"))).json()).toEqual({ ids: [] });
    expect(await (await GET(request("GET", { id: "_journal", query: "?cleanup=1" }), context("_journal"))).json()).toEqual({ ids: ["id"] });
    liveReference();
    expect((await DELETE(request("DELETE"), context())).status).toBe(409);
    expect(await (await GET(request("GET", { query: "?reference=1" }), context())).json()).toEqual({ referenced: true });
    const action = (value: unknown) => request("POST", { body: JSON.stringify(value), headers: { "Content-Type": "application/json" } });
    expect((await POST(action({ action: "retire" }), context())).status).toBe(200);
    expect((await POST(action({ action: "queue" }), context())).status).toBe(200);
    expect((await DELETE(request("DELETE"), context())).status).toBe(409);
    expect((await PUT(request("PUT", { body: "replacement" }), context())).status).toBe(409);
    fixture.db!.prepare("DELETE FROM records WHERE key=?").run("private-v1:editor:room-a:initial-room-a:documents");
    expect((await DELETE(request("DELETE"), context())).status).toBe(200);
    expect((await DELETE(request("DELETE"), context())).status).toBe(200);
    expect(await (await GET(request("GET", { id: "_journal", query: "?cleanup=1" }), context("_journal"))).json()).toEqual({ ids: [] });
  });

  it("rejects cross-origin mutation, unsupported MIME, malformed names and invalid cleanup actions", async () => {
    expect((await PUT(request("PUT", { body: "x", headers: { Origin: "https://elsewhere.test" } }), context())).status).toBe(403);
    expect((await PUT(request("PUT", { body: "x", headers: { "Content-Type": "text/html" } }), context())).status).toBe(415);
    expect((await PUT(request("PUT", { body: "x", headers: { "X-File-Name": "%zz" } }), context())).status).toBe(400);
    expect((await PUT(request("PUT", { body: "x", headers: { "X-File-Name": encodeURIComponent("evil.html") } }), context())).status).toBe(400);
    expect((await POST(request("POST", { body: '{"action":["queue"]}', headers: { "Content-Type": "application/json" } }), context())).status).toBe(400);
    expect((await DELETE(request("DELETE", { headers: { "Sec-Fetch-Site": "cross-site" } }), context())).status).toBe(403);
  });

  it("bounds streamed bytes even with a false Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel
    });
    const streamRequest = new Request(url(), { method: "PUT", body, duplex: "half", headers: { Cookie: editorCookie, "Content-Type": "application/octet-stream", "X-File-Name": "large.txt", "Content-Length": "1" } } as RequestInit & { duplex: string });
    expect((await PUT(streamRequest, context())).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(fixture.db!.prepare("SELECT COUNT(*) AS n FROM conversation_files").get()!.n).toBe(0);
  });

  it("survives room deletion with idempotent cleanup responses", async () => {
    await PUT(request("PUT", { body: "x" }), context());
    fixture.db!.prepare("DELETE FROM rooms WHERE id=?").run("room-a");
    expect((await DELETE(request("DELETE"), context())).status).toBe(200);
    expect(await (await GET(request("GET", { query: "?reference=1" }), context())).json()).toEqual({ referenced: false });
    expect(await (await GET(request("GET", { id: "_journal", query: "?cleanup=1" }), context("_journal"))).json()).toEqual({ ids: [] });
  });
});
