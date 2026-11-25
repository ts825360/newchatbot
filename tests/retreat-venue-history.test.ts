// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { extractReportVenue, isVenueHistoryChat, compareRetreatVenues } from "@/lib/retreat-venue-history";
import { handleRetreatVenueHistory } from "@/lib/server/retreat-venue-history";
import { canonicalConversationHistory, canonicalPrivateTool } from "@/lib/server/conversation-scope";
import { handleChat } from "@/lib/server/chat";
import { createDatabase } from "@/lib/server/database";

const report = "전교인 수련회 결과 보고서\n일시: 2025.08.23. ~ 24\n장소: 가상수련원(공주)\n예배실과 단체실을 사용함\n식당에서 아침 제공\n바베큐 그릴 2대 사용\n편의점 없음\nPRIVATE_REPORT_BODY";
const timestamp = "2026-01-01T00:00:00Z";
const draft = { roomId: "source", conversationId: "initial-source", documentId: "report", name: "가상수련원(공주)", year: 2025 };
let db: ReturnType<typeof createDatabase>;

function session(id: string, canPublish = false) {
  const permissions = canPublish ? ["viewRoom", "chat", "editRoom"] : ["viewRoom", "chat"];
  const token = createHash("sha256").update(id).digest("base64url");
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?, 'unused','unused',?)")
    .run(id, id, id, canPublish ? 2 : 3, "테스트", JSON.stringify(permissions), timestamp);
  db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,0,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), id, new Date(Date.now() + 60_000).toISOString(), timestamp);
  return `church_session=${token}`;
}
const request = (cookie: string, data?: object, method = data ? "POST" : "GET") => new Request(
  `http://localhost/api/retreat-venues${data ? "" : "?roomId=next&conversationId=initial-next"}`, {
    method, headers: { cookie, "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined,
  },
);
let alice: string, bob: string;
beforeEach(() => {
  db = createDatabase(":memory:");
  db.prepare("INSERT INTO rooms(id,data_json) VALUES('source','{\"category\":\"retreat\"}'),('next','{\"category\":\"retreat\"}')").run();
  alice = session("alice", true); bob = session("bob");
  const key = canonicalPrivateTool({ accountId: "alice", roomId: "source", conversationId: "initial-source" }, "documents");
  const file = { name: "2025-결과보고서.txt", size: Buffer.byteLength(report), type: "text/plain" };
  db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,?,'documents',?,?)")
    .run(key, "alice", "source", JSON.stringify({ version: 1, items: [{ id: "report", title: "2025 수련회 결과보고서", pinned: false, kind: "file", file }] }), timestamp);
  db.prepare("INSERT INTO conversation_files(owner_id,room_id,conversation_id,document_id,name,mime,size,bytes,cleanup,created_at) VALUES(?,?,?,?,?,?,?,?,0,?)")
    .run("alice", "source", "initial-source", "report", file.name, file.type, file.size, Buffer.from(report), timestamp);
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

it("takes a matching place and year from the finished report, not hints or negative notes", () => {
  expect(extractReportVenue(report, draft.name, 2025)).toEqual(["worship", "groups", "meals", "bbq"]);
  expect(extractReportVenue(report, "다른 후보", 2025)).toBeNull();
  expect(extractReportVenue(report, draft.name, 2026)).toBeNull();
  expect(extractReportVenue(report.replace("장소:", "후보 장소:"), draft.name, 2025)).toBeNull();
});

it("returns only registered summaries across rooms and removes a report whose source is deleted", async () => {
  const read = () => handleRetreatVenueHistory(request(bob), db);
  expect(await (await read()).json()).toMatchObject({ history: [] });
  expect((await handleRetreatVenueHistory(request(bob, draft), db)).status).toBe(403);
  expect((await handleRetreatVenueHistory(request(alice, { ...draft, name: "가상수련원" }), db)).status).toBe(422);
  expect((await handleRetreatVenueHistory(request(alice, draft), db)).status).toBe(200);
  const payload = await (await read()).text();
  expect(JSON.parse(payload).history).toEqual([{ name: draft.name, year: 2025, features: ["worship", "groups", "meals", "bbq"] }]);
  expect(payload).not.toMatch(/PRIVATE_REPORT_BODY|alice|initial-source|결과보고서\.txt/);
  const source = db.prepare("SELECT data_json FROM records WHERE kind='documents'").get()!.data_json!;
  db.prepare("UPDATE records SET data_json=? WHERE kind='documents'").run('{"version":1,"items":[]}');
  expect(await (await read()).json()).toMatchObject({ history: [] });
  db.prepare("UPDATE records SET data_json=? WHERE kind='documents'").run(source);
  db.prepare("DELETE FROM conversation_files WHERE document_id='report'").run();
  expect(await (await read()).json()).toMatchObject({ history: [] });
});

it("routes a natural question to internal venue history without sending or storing the report", async () => {
  const fetchProvider = vi.fn();
  vi.stubGlobal("fetch", fetchProvider);
  const text = "지난 수련회 숙소 참고해서 100명 이상 바비큐 가능한 장소 추천해줘";
  const history = { activeId: "initial-next", conversations: [{ id: "initial-next", title: "Test", draft: "", createdAt: timestamp,
    updatedAt: timestamp, messages: [{ sender: "user", id: "question", text, time: timestamp }] }] };
  const key = canonicalConversationHistory("bob", "next");
  db.prepare("INSERT INTO records(key,owner_id,room_id,kind,data_json,updated_at) VALUES(?,?,'next','conversations',?,?)")
    .run(key, "bob", JSON.stringify(history), timestamp);
  const response = await handleChat(new Request("http://localhost/api/chat", {
    method: "POST", headers: { cookie: bob, "content-type": "application/json" },
    body: JSON.stringify({ roomId: "next", conversationId: "initial-next", userMessageId: "question", userMessageText: text }),
  }), db);
  expect(response.status).toBe(200);
  const persisted = String(db.prepare("SELECT data_json FROM records WHERE key=?").get(key)?.data_json);
  expect(JSON.parse(persisted).conversations[0].messages.at(-1)).toMatchObject({ sender: "assistant", actions: ["retreat-venue-history"] });
  expect(persisted).not.toMatch(/PRIVATE_REPORT_BODY|롯데리조트|placeId/);
  expect(fetchProvider).not.toHaveBeenCalled();
});

it("keeps similarity and capacity uncertainty separate", () => {
  expect(isVenueHistoryChat("지난 수련회 숙소 참고해서 100명 바비큐 가능한 장소 추천해줘")).toBe(true);
  expect(isVenueHistoryChat("작년에 올린 전체 문서를 보내줘")).toBe(false);
  const candidates = compareRetreatVenues([{ name: "가상", year: 2025, features: ["worship", "meals", "bbq"] }]);
  expect(candidates[0].matched).toEqual(["worship", "meals", "bbq"]);
  expect(candidates.every(item => item.website.startsWith("https://"))).toBe(true);
});
