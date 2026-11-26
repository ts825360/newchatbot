// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, getDatabase } from "@/lib/server/database";
import { authGet, authPost, ensureDevelopmentAccounts, profileFor, requirePermission, requireUser } from "@/lib/server/auth";
import { hashPassword, verifyPassword } from "@/lib/server/password";
import { GET, POST } from "@/app/api/auth/[action]/route";
import { openAIChatConsentVersion } from "@/lib/assistant-privacy";

vi.mock("@/lib/server/database", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/server/database")>();
  return { ...actual, getDatabase: vi.fn(() => { throw new Error("Tests must supply a private database."); }) };
});

let db: DatabaseSync;
const password = "Private-test-password!";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const draft = (extra = {}) => ({ label: "Test invitation", grade: 3, role: "Team", signupExpiresAt: future(2), accessExpiresAt: future(5), ...extra });
const input = (inviteCode: string, username = "new-member") => ({ inviteCode, username, name: "Member", password, confirmation: password });
function request(action: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/auth/${action}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json", origin: "http://localhost" }), ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function post(action: string, body: unknown, cookie?: string, headers?: Record<string, string>) {
  const response = await authPost(request(action, body, cookie, headers), action, db);
  return { response, body: await response.json() as any };
}
async function get(action: string, cookie?: string) {
  const response = await authGet(request(action, undefined, cookie), action, db);
  return { response, body: await response.json() as any };
}
async function seed(username = "manager", grade = 2, id = username) {
  const hash = await hashPassword(password);
  const permissions = ["viewRoom", "chat", "viewCalendar", "viewChecklist", "createEvent", "editEvent", "editChecklist", "uploadDocument", "addLink", "editLink", "viewHistory", ...(grade <= 2 ? ["inviteMember", "manageMembers", "createRoom", "editRoom", "deleteEvent"] : []), ...(grade === 1 ? ["admin"] : [])];
  db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, username, username, grade, "Team", JSON.stringify(permissions), hash.salt, hash.passwordHash, new Date().toISOString());
  const login = await post("login", { username, password });
  expect(login.response.status).toBe(200);
  return { cookie: login.response.headers.get("set-cookie")!.split(";")[0], profile: login.body.profile };
}
async function invitation(cookie: string, extra = {}) {
  const result = await post("invitations", draft(extra), cookie);
  expect(result.response.status).toBe(200);
  return result.body;
}

beforeEach(() => {
  db = createDatabase(":memory:"); vi.stubEnv("NODE_ENV", "test");
  vi.mocked(getDatabase).mockImplementation(() => { throw new Error("Tests must supply a private database."); });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("records the optional external chat consent at signup for only the consenting account", async () => {
  const manager = await seed();
  for (const [username, optIn] of [["opted-in", true], ["opted-out", false]] as const) {
    const issued = await invitation(manager.cookie);
    const result = await post("signup", { ...input(issued.code, username), ...(optIn && { openAIConsent: openAIChatConsentVersion }) });
    expect(result.response.status).toBe(200);
    const row = db.prepare("SELECT records.data_json FROM users JOIN records ON records.owner_id=users.id WHERE users.username=? AND records.kind='chat-external-consent'").get(username);
    expect(row?.data_json).toBe(optIn ? JSON.stringify(openAIChatConsentVersion) : undefined);
  }
});

describe("server password storage", () => {
  it("uses random salt, PBKDF2 SHA256 at >=600k and constant-time verification", async () => {
    const first = await hashPassword(password); const second = await hashPassword(password);
    expect(first.salt).not.toBe(second.salt);
    expect(first.salt).toMatch(/^[a-f0-9]{32,}$/);
    expect(first.passwordHash).toMatch(/^pbkdf2-sha256\$600000\$[a-f0-9]{64}$/);
    expect(await verifyPassword(password, first.salt, first.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong", first.salt, first.passwordHash)).toBe(false);
    expect(await verifyPassword(password, first.salt, "plain-text")).toBe(false);
  });
});

describe("opaque server sessions", () => {
  it("reads the actual login ID and updates only the signed-in display name without changing permissions", async () => {
    const member = await seed("test-member", 3);
    expect((await get("account")).response.status).toBe(401);
    expect((await get("account", member.cookie)).body).toEqual({ username: "test-member" });
    expect((await post("display-name", { accountId: "other", name: "새 이름" }, member.cookie)).response.status).toBe(409);
    expect((await post("display-name", { accountId: member.profile.accountId, name: "  새 이름  " }, member.cookie)).body).toEqual({ name: "새 이름" });
    const { profile } = (await get("session", member.cookie)).body;
    expect(profile).toEqual({ ...member.profile, nickname: "새 이름" });
  });
  it("changes only the signed-in user's password after verification and revokes their other sessions", async () => {
    const { cookie, profile } = await seed();
    const secondary = (await post("login", { username: "manager", password })).response.headers.get("set-cookie")!.split(";")[0];
    const other = await seed("different-member", 3);
    const replacement = "Replacement-test-password!";
    const payload = { accountId: profile.accountId, currentPassword: password, newPassword: replacement, confirmation: replacement };
    expect((await post("change-password", payload)).response.status).toBe(401);
    expect((await post("change-password", payload, cookie, { origin: "https://other.example" })).response.status).toBe(403);
    expect((await post("change-password", { ...payload, currentPassword: "wrong-current" }, cookie)).response.status).toBe(400);
    expect((await post("change-password", { ...payload, accountId: other.profile.accountId }, cookie)).response.status).toBe(409);
    const changed = await post("change-password", payload, cookie);
    expect(changed.response.status).toBe(200);
    const rotated = changed.response.headers.get("set-cookie")!.split(";")[0];
    expect(rotated).not.toBe(cookie);
    expect((await get("session", rotated)).body.profile.accountId).toBe(profile.accountId);
    expect((await get("session", cookie)).body.profile).toBeNull();
    expect((await get("session", secondary)).body.profile).toBeNull();
    expect((await get("session", other.cookie)).body.profile.accountId).toBe(other.profile.accountId);
    expect((await post("login", { username: "manager", password })).response.status).toBe(401);
    expect((await post("login", { username: "manager", password: replacement })).response.status).toBe(200);
  });
  it("stores only a token digest and issues HttpOnly SameSite cookies", async () => {
    const manager = await seed();
    const token = manager.cookie.split("=")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const session = db.prepare("SELECT * FROM sessions").get()!;
    expect(session.token_hash).toBe(digest(token));
    expect(JSON.stringify(session)).not.toContain(token);
    const login = await post("login", { username: "manager", password });
    expect(login.response.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(login.response.headers.get("set-cookie")).toMatch(/SameSite=Lax/);
    expect(login.response.headers.get("cache-control")).toBe("no-store");
    const actor = requireUser(request("session", undefined, manager.cookie), db);
    expect(actor).not.toHaveProperty("then");
    expect(profileFor(actor).accountId).toBe(manager.profile.accountId);
    requirePermission(actor, "manageMembers");
    expect((await get("session", manager.cookie)).body.profile.accountId).toBe(actor.id);
    expect((await get("session", "church_session=not-a-session")).body.profile).toBeNull();
  });

  it("revokes server sessions on logout and refuses cross-origin logout", async () => {
    const manager = await seed();
    expect((await post("logout", {}, manager.cookie, { origin: "https://other.example" })).response.status).toBe(403);
    expect((await get("session", manager.cookie)).body.profile).not.toBeNull();
    const result = await post("logout", {}, manager.cookie);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
    expect((await get("session", manager.cookie)).body.profile).toBeNull();
  });

  it("routes real GET/POST handlers through the same auth dispatchers", async () => {
    vi.mocked(getDatabase).mockReturnValue(db);
    await seed();
    const result = await POST(request("login", { username: "manager", password }), { params: Promise.resolve({ action: "login" }) });
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")!.split(";")[0];
    const session = await GET(request("session", undefined, cookie), { params: Promise.resolve({ action: "session" }) });
    expect((await session.json()).profile.accountId).toBe("manager");
    expect((await POST(request("logout", {}, cookie), { params: Promise.resolve({ action: "logout" }) })).status).toBe(200);
    expect((await GET(request("session", undefined, cookie), { params: Promise.resolve({ action: "session" }) })).status).toBe(200);
    expect(db.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
  });

  it("rotates a browser's prior token on login without reviving it", async () => {
    const manager = await seed();
    const replacement = await post("login", { username: "manager", password }, manager.cookie);
    expect(replacement.response.status).toBe(200);
    expect((await get("session", manager.cookie)).body.profile).toBeNull();
    expect((await get("session", replacement.response.headers.get("set-cookie")!.split(";")[0])).body.profile.accountId).toBe("manager");
  });

  it.each(["suspension", "version", "account-expiry", "session-expiry"])("rechecks %s on every request", async (kind) => {
    const manager = await seed();
    if (kind === "suspension") db.exec("UPDATE users SET suspended=1");
    if (kind === "version") db.exec("UPDATE users SET session_version=session_version+1");
    if (kind === "account-expiry") db.prepare("UPDATE users SET access_expires_at=?").run(new Date(Date.now() - 1).toISOString());
    if (kind === "session-expiry") db.prepare("UPDATE sessions SET expires_at=?").run(new Date(Date.now() - 1).toISOString());
    expect(() => requireUser(request("session", undefined, manager.cookie), db)).toThrow();
    expect((await get("session", manager.cookie)).body.profile).toBeNull();
    expect((await get("management", manager.cookie)).response.status).toBe(401);
  });

  it("makes production cookies Secure and rejects persisted development users", async () => {
    const manager = await seed();
    vi.stubEnv("NODE_ENV", "production");
    const result = await post("login", { username: "manager", password });
    expect(result.response.headers.get("set-cookie")).toContain("Secure");
    vi.stubEnv("NODE_ENV", "development");
    await ensureDevelopmentAccounts(db);
    const demo = await post("login", { username: "admin", password: "admin1234@" });
    const demoCookie = demo.response.headers.get("set-cookie")!.split(";")[0];
    vi.stubEnv("NODE_ENV", "production");
    expect((await get("session", demoCookie)).body.profile).toBeNull();
    expect((await post("login", { username: "development-manager", password: "admin1234@" })).response.status).toBe(401);
    expect((await get("session", manager.cookie)).body.profile).not.toBeNull();
  });
});

describe("one-use invitations and membership", () => {
  it("returns prototype shapes and never stores or audits raw invitation secrets", async () => {
    const manager = await seed();
    const issued = await invitation(manager.cookie);
    expect(issued.code.replaceAll("-", "")).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(issued.signupPath).toBe(`/signup#invite=${issued.code}`);
    const stored = db.prepare("SELECT * FROM invitations").get()!;
    expect(stored.digest).toBe(digest(issued.code.replaceAll("-", "")));
    expect(JSON.stringify(stored)).not.toContain(issued.code);
    expect(JSON.stringify(db.prepare("SELECT * FROM activities").all())).not.toContain(issued.code);
    const check = await post("check-invite", { code: issued.code.toLowerCase().replaceAll("-", " ") });
    expect(check.body).toMatchObject({ ok: true, id: issued.invitation.id, grade: 3, role: "Team", expiresAt: stored.access_expires_at, signupExpiresAt: stored.signup_expires_at });
    const signup = await post("signup", input(issued.code));
    expect(signup.response.status).toBe(200);
    expect(signup.response.headers.get("set-cookie")).toBeNull();
    expect(signup.body).toMatchObject({ name: "Member", username: "new-member", grade: 3, expiresAt: stored.access_expires_at });
    expect((await post("check-invite", { code: issued.code })).body.ok).toBe(false);
    expect((await post("signup", input(issued.code, "another-member"))).response.status).toBe(400);
  });

  it("atomically consumes only once when slow password hashes overlap", async () => {
    const manager = await seed(); const issued = await invitation(manager.cookie);
    const results = await Promise.all([post("signup", input(issued.code, "first-member")), post("signup", input(issued.code, "second-member"))]);
    expect(results.map(r => r.response.status).sort()).toEqual([200, 400]);
    expect(db.prepare("SELECT id FROM users WHERE invite_id=?").all(issued.invitation.id)).toHaveLength(1);
  });

  it("does not consume an invite on duplicate username or a failed user insert", async () => {
    const manager = await seed(); const first = await invitation(manager.cookie); const second = await invitation(manager.cookie);
    await post("signup", input(first.code));
    expect((await post("signup", input(second.code, "NEW-MEMBER"))).response.status).toBe(409);
    expect((await post("check-invite", { code: second.code })).body.ok).toBe(true);
    db.exec("CREATE TRIGGER fail_signup BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect((await post("signup", input(second.code, "fresh-member"))).response.status).toBe(500);
    expect(db.prepare("SELECT used_by FROM invitations WHERE id=?").get(second.invitation.id)?.used_by).toBeNull();
  });

  it("separates signup deadline from account expiry and observes exact KST cutoff", async () => {
    const manager = await seed();
    const end = new Date(Date.now() + 8 * 86_400_000);
    const cutoff = `${end.toISOString().slice(0, 10)}T00:00:00+09:00`;
    const issued = await invitation(manager.cookie, { accessExpiresAt: cutoff });
    await post("signup", input(issued.code));
    db.prepare("UPDATE invitations SET signup_expires_at=?").run(new Date(Date.now() - 1).toISOString());
    const login = await post("login", { username: "new-member", password });
    expect(login.response.status).toBe(200);
    const cookie = login.response.headers.get("set-cookie")!.split(";")[0];
    db.prepare("UPDATE sessions SET expires_at=?").run(future(20));
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.parse(cutoff) - 1));
    expect((await get("session", cookie)).body.profile).not.toBeNull();
    vi.setSystemTime(new Date(cutoff));
    expect((await get("session", cookie)).body.profile).toBeNull();
    expect((await post("login", { username: "new-member", password })).response.status).toBe(403);
  });

  it("rejects expired/revoked invites, grade1 and invalid deadlines", async () => {
    const manager = await seed(); const issued = await invitation(manager.cookie);
    expect((await post("revoke-invitation", { id: issued.invitation.id }, manager.cookie)).response.status).toBe(200);
    expect((await post("check-invite", { code: issued.code })).body.ok).toBe(false);
    const expired = await invitation(manager.cookie);
    db.prepare("UPDATE invitations SET signup_expires_at=? WHERE id=?").run(new Date(Date.now() - 1).toISOString(), expired.invitation.id);
    expect((await post("signup", input(expired.code))).response.status).toBe(400);
    for (const extra of [{ grade: 1 }, { accessExpiresAt: null }, { signupExpiresAt: "invalid" }, { accessExpiresAt: future(1) }, { signupExpiresAt: "2030-02-30T00:00:00+09:00" }, { signupExpiresAt: "2030-01-01T00:00:00" }]) {
      expect((await post("invitations", draft(extra), manager.cookie)).response.status).toBe(400);
    }
    expect((await post("signup", input("CHURCH-OWNER-2026"))).response.status).toBe(400);
  });

  it.each(["viewer", "chat", "edit"])("enforces %s permissions from the server invite", async (access) => {
    const manager = await seed(); const issued = await invitation(manager.cookie, { access });
    expect(issued.invitation.access).toBe(access);
    await post("signup", { ...input(issued.code), grade: 1, permissions: ["admin"] });
    const login = await post("login", { username: "new-member", password });
    expect(login.body.profile.grade).toBe(3);
    expect(login.body.profile.permissions.includes("chat")).toBe(access !== "viewer");
    expect(login.body.profile.permissions).toEqual(expect.arrayContaining(["createEvent", "editEvent"]));
    expect(login.body.profile.permissions.includes("editChecklist")).toBe(access === "edit");
    expect(login.body.profile.permissions.includes("deleteEvent")).toBe(access === "edit");
    expect(login.body.profile.permissions).not.toContain("manageMembers");
    const actor = requireUser(request("session", undefined, login.response.headers.get("set-cookie")!.split(";")[0]), db);
    expect(() => requirePermission(actor, "manageMembers")).toThrow();
  });

  it("adds shared calendar editing to an existing active viewer without changing stored roles", async () => {
    const member = await seed("existing-viewer", 3);
    const oldPermissions = ["viewRoom", "viewCalendar", "viewChecklist", "viewHistory"];
    db.prepare("UPDATE users SET permissions_json=? WHERE id=?").run(JSON.stringify(oldPermissions), member.profile.accountId);
    const current = (await get("session", member.cookie)).body.profile;
    expect(current.permissions).toEqual(expect.arrayContaining(["createEvent", "editEvent"]));
    for (const excluded of ["chat", "editChecklist", "deleteEvent", "manageMembers"]) expect(current.permissions).not.toContain(excluded);
    expect(db.prepare("SELECT permissions_json FROM users WHERE id=?").get(current.accountId)?.permissions_json).toBe(JSON.stringify(oldPermissions));
  });

  it("preserves default grade3 privileges without silently granting grade2 operations", async () => {
    const manager = await seed(); const issued = await invitation(manager.cookie);
    await post("signup", input(issued.code));
    const login = await post("login", { username: "new-member", password });
    expect(login.body.profile.permissions).toEqual(expect.arrayContaining(["viewRoom", "chat", "viewCalendar", "createEvent", "editEvent", "viewChecklist", "editChecklist", "uploadDocument"]));
    expect(login.body.profile.permissions).not.toEqual(expect.arrayContaining(["manageMembers", "inviteMember", "admin", "createRoom"]));
  });

  it("lets grade2 invite/suspend other grade2+3, never self or owner, and revokes all old sessions", async () => {
    const owner = await seed("owner", 1); const manager = await seed();
    const issued = await invitation(manager.cookie, { grade: 2, accessExpiresAt: null });
    await post("signup", input(issued.code));
    const first = await post("login", { username: "new-member", password });
    const second = await post("login", { username: "new-member", password });
    const id = first.body.profile.accountId;
    expect((await post("member-status", { id: "manager", suspended: true }, manager.cookie)).response.status).toBe(403);
    expect((await post("member-status", { id: "owner", suspended: true }, manager.cookie)).response.status).toBe(403);
    expect((await post("member-status", { id, suspended: "true" }, manager.cookie)).response.status).toBe(400);
    expect((await post("member-status", { id, suspended: true }, manager.cookie)).response.status).toBe(200);
    expect(db.prepare("SELECT * FROM sessions WHERE user_id=?").all(id)).toHaveLength(0);
    expect((await post("login", { username: "new-member", password })).response.status).toBe(403);
    await post("member-status", { id, suspended: false }, manager.cookie);
    for (const old of [first, second]) expect((await get("session", old.response.headers.get("set-cookie")!.split(";")[0])).body.profile).toBeNull();
    const overview = await get("management", manager.cookie);
    expect(overview.body.activities).toEqual([]);
    expect((await get("owner", manager.cookie)).response.status).toBe(403);
    expect((await get("owner", owner.cookie)).body.activities.length).toBeGreaterThan(0);
    const member = await seed("member", 3);
    expect((await get("management", member.cookie)).response.status).toBe(403);
    expect((await post("invitations", draft(), member.cookie)).response.status).toBe(403);
  });
});

describe("development bootstrap, abuse limits and request validation", () => {
  it("only bootstraps grade2+3 in development, from GET session, using stable IDs", async () => {
    const setup = ensureDevelopmentAccounts(db);
    expect(setup).toBeInstanceOf(Promise);
    await setup;
    expect(db.prepare("SELECT * FROM users").all()).toHaveLength(0);
    vi.stubEnv("NODE_ENV", "development");
    expect((await get("session")).body.profile).toBeNull();
    await Promise.all([ensureDevelopmentAccounts(db), ensureDevelopmentAccounts(db)]);
    expect(db.prepare("SELECT id FROM users").all()).toHaveLength(2);
    for (const [demoPassword, id, grade] of [["admin1234@", "development-manager", 2], ["admin1234#", "development-member", 3]] as const) {
      const login = await post("login", { username: "admin", password: demoPassword });
      expect(login.body.profile).toMatchObject({ accountId: id, grade });
    }
    expect((await post("login", { username: "admin", password: "admin1234" })).response.status).toBe(401);
    expect(db.prepare("SELECT * FROM users WHERE grade=1").all()).toHaveLength(0);
    db.prepare("UPDATE users SET suspended=1 WHERE id=?").run("development-member");
    await ensureDevelopmentAccounts(db);
    expect((await post("login", { username: "admin", password: "admin1234#" })).response.status).toBe(403);
  });

  it("persists rate limits in SQLite and ignores spoofable forwarding headers", async () => {
    await seed();
    for (let i = 0; i < 10; i++) expect((await post("login", { username: "manager", password: "wrong" }, undefined, { "x-forwarded-for": String(i) })).response.status).toBe(401);
    expect((await post("login", { username: "manager", password })).response.status).toBe(429);
    expect(db.prepare("SELECT * FROM rate_limits").all().length).toBeGreaterThan(0);
    expect(JSON.stringify(db.prepare("SELECT * FROM rate_limits").all())).not.toContain(password);
    db.exec("UPDATE rate_limits SET resets_at=0");
    expect((await post("login", { username: "manager", password })).response.status).toBe(200);
    for (let i = 0; i < 10; i++) await post("check-invite", { code: "invalid" });
    expect((await post("check-invite", { code: "invalid" })).response.status).toBe(429);
  });

  it("bounds JSON bodies and checks origin on all mutations including logout", async () => {
    const manager = await seed();
    expect((await post("invitations", draft(), manager.cookie, { origin: "https://other.example" })).response.status).toBe(403);
    expect((await post("logout", {}, manager.cookie, { "sec-fetch-site": "cross-site" })).response.status).toBe(403);
    const invalid = new Request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect((await authPost(invalid, "login", db)).status).toBe(400);
    expect((await post("login", { username: "x".repeat(40_000), password })).response.status).toBe(413);
    expect((await post("login", null)).response.status).toBe(400);
    expect((await get("unknown")).response.status).toBe(404);
    expect((await post("unknown", {})).response.status).toBe(404);
  });
});

describe("offline owner provisioning", () => {
  it("requires explicit private setup, never prints credentials, and refuses a second owner", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "church-auth-owner-"));
    const ownerPassword = "Private-offline-owner-password!";
    const cli = (extra: Record<string, string> = {}, args: string[] = ["--create-owner"]) => spawnSync(process.execPath, ["scripts/bootstrap-admin.mjs", ...args], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
      env: { ...process.env, NODE_ENV: "production", CHURCH_DATA_DIR: directory, CHURCH_BOOTSTRAP_USERNAME: "", CHURCH_BOOTSTRAP_NAME: "", CHURCH_BOOTSTRAP_PASSWORD: "", CHURCH_BOOTSTRAP_CONFIRM: "", ...extra },
    });
    let privateDb: DatabaseSync | undefined;
    try {
      expect(cli({}, []).status).toBe(1);
      expect(cli().status).toBe(1);
      expect(cli({}, ["--help"]).status).toBe(0);
      const setup = { CHURCH_BOOTSTRAP_USERNAME: "private-owner", CHURCH_BOOTSTRAP_NAME: "Owner", CHURCH_BOOTSTRAP_PASSWORD: ownerPassword, CHURCH_BOOTSTRAP_CONFIRM: "CREATE_OWNER" };
      const result = cli(setup);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout + result.stderr).not.toContain(ownerPassword);
      expect(result.stdout + result.stderr).not.toContain("private-owner");
      privateDb = createDatabase(path.join(directory, "church.sqlite"));
      const owner = privateDb.prepare("SELECT * FROM users").get()!;
      expect(owner.grade).toBe(1);
      expect(await verifyPassword(ownerPassword, String(owner.salt), String(owner.password_hash))).toBe(true);
      const resultLogin = await authPost(request("login", { username: "private-owner", password: ownerPassword }), "login", privateDb);
      expect(resultLogin.status).toBe(200);
      expect((await resultLogin.json()).profile.permissions).toContain("admin");
      const second = cli({ ...setup, CHURCH_BOOTSTRAP_USERNAME: "second-owner" });
      expect(second.status).toBe(1);
      expect(second.stdout + second.stderr).not.toContain(ownerPassword);
      expect(privateDb.prepare("SELECT id FROM users WHERE grade=1").all()).toHaveLength(1);
      expect(cli({ ...setup, CHURCH_BOOTSTRAP_PASSWORD: "admin1234" }).status).toBe(1);
      expect(cli({ ...setup, CHURCH_BOOTSTRAP_USERNAME: "admin" }).status).toBe(1);
    } finally {
      privateDb?.close();
      if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith("church-auth-owner-")) rmSync(directory, { recursive: true, force: true });
    }
  });
});
