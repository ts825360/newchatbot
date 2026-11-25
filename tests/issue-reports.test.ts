// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/lib/server/database";
import { authGet, type Actor } from "@/lib/server/auth";
import { readSnapshot, locateRecord } from "@/lib/server/records";
import { acceptReport, dispatchReportNotifications, reportPost } from "@/lib/server/issue-reports";

let db: DatabaseSync;
const actor: Actor = { id: "manager", name: "관리자", username: "manager", grade: 2, role: "Test", permissions: ["viewRoom", "manageMembers"], accessExpiresAt: null, sessionVersion: 0 };
const payload = () => ({ requestId: randomUUID(), category: "screen", description: "비공개 오류 상세" });
const token = "a".repeat(43);
function request(path: string, id: string, data?: unknown) {
  return new Request(`http://localhost/${path}`, { method: data ? "POST" : "GET", headers: { cookie: `church_session=${id}`, "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
beforeEach(() => {
  db = createDatabase(":memory:");
  vi.stubEnv("RESEND_API_KEY", "private-test-key"); vi.stubEnv("REPORT_EMAIL_FROM", "notice@example.test"); vi.stubEnv("REPORT_EMAIL_TO", "owner@example.test");
  for (const grade of [1, 2]) {
    const id = grade === 1 ? "owner" : actor.id;
    db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,id,id,grade,actor.role,JSON.stringify(actor.permissions),"x","x",new Date().toISOString());
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES(?,?,?,?,?)").run(createHash("sha256").update(grade === 1 ? "b".repeat(43) : token).digest("hex"),id,0,new Date(Date.now()+3600000).toISOString(),new Date().toISOString());
  }
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
describe("private issue report intake", () => {
  it("does not expose old or new reports through snapshots, and only lets the owner read details", async () => {
    const old = { id: "old", category: "screen", description: "기존 비공개", createdAt: new Date().toISOString() };
    db.prepare("INSERT INTO records(key,kind,owner_id,data_json,updated_at) VALUES(?,?,?,?,?)").run(`feedback:${actor.id}`,"feedback",actor.id,JSON.stringify({ version: 1, items: [old] }),old.createdAt);
    acceptReport(actor, payload(), db);
    expect(JSON.stringify(readSnapshot(actor, undefined, db))).not.toMatch(/feedback|비공개/);
    expect(() => locateRecord(actor, `church-feedback-v1:${actor.id}`)).toThrow();
    const manager = await authGet(request("management",token),"management",db);
    expect(await manager.json()).not.toHaveProperty("reports");
    const owner = await authGet(request("owner","b".repeat(43)),"owner",db);
    expect((await owner.json()).reports).toEqual(expect.arrayContaining([expect.objectContaining({ description: "비공개 오류 상세" }), expect.objectContaining(old)]));
  });
  it("requires an authenticated request and returns only a receipt (not report details or addresses)", async () => {
    expect((await reportPost(request("reports","z".repeat(43),payload()), db)).status).toBe(401);
    const response = await reportPost(request("reports",token,payload()),db);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ notification: "queued" });
  });
  it("deduplicates retries and sends only a fixed owner notification", async () => {
    const draft = { ...payload(), to: "attacker@example.test", reporter: "owner" };
    acceptReport(actor, draft, db); acceptReport(actor, draft, db);
    const send = vi.fn(async () => Response.json({ id: "mail" }));
    await Promise.all([dispatchReportNotifications(db, send), dispatchReportNotifications(db, send)]);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = (send.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(options.body))).toMatchObject({ to: ["owner@example.test"], subject: "문제 신고 확인" });
    expect(String(options.body)).not.toMatch(/비공개|attacker/);
    expect(db.prepare("SELECT mail_status FROM issue_reports").all()).toEqual([{ mail_status: "sent" }]);
  });
  it("retains accepted reports while mail is unconfigured and does not pretend to send", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(acceptReport(actor,payload(),db)).toEqual({ notification: "unconfigured" });
    const send=vi.fn(); await dispatchReportNotifications(db,send); expect(send).not.toHaveBeenCalled();
  });
  it("keeps failed notifications retryable with the same idempotency key", async () => {
    acceptReport(actor,payload(),db);
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(Response.json({id:"sent"}));
    await dispatchReportNotifications(db,send);
    expect(db.prepare("SELECT mail_status FROM issue_reports").get()?.mail_status).toBe("queued");
    db.prepare("UPDATE issue_reports SET mail_next_at=0").run();
    await dispatchReportNotifications(db,send);
    expect(new Headers(send.mock.calls[0][1]?.headers).get("Idempotency-Key")).toBe(new Headers(send.mock.calls[1][1]?.headers).get("Idempotency-Key"));
    expect(db.prepare("SELECT mail_status FROM issue_reports").get()?.mail_status).toBe("sent");
  });
  it("bounds submissions and rejects cross-site writes without queuing email", async () => {
    const cross = new Request("http://localhost/reports", { method: "POST", headers: { cookie: `church_session=${token}`, "content-type": "application/json", origin: "https://other.example" }, body: JSON.stringify(payload()) });
    expect((await reportPost(cross, db)).status).toBe(403);
    const first = payload(); acceptReport(actor, first, db);
    for (let count = 0; count < 4; count++) acceptReport(actor, payload(), db);
    expect((await reportPost(request("reports", token, payload()), db)).status).toBe(429);
    expect((await reportPost(request("reports", token, first), db)).status).toBe(201);
  });
});
