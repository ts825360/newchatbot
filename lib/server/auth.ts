import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreatedInvitation, InvitationDraft, InvitationView, MemberView, OwnerOverview } from "../invitation-types";
import type { Permission, UserProfile } from "../types";
import { bumpRevision, getDatabase, transaction } from "./database";
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from "./http";
import { hashPassword, verifyPassword } from "./password";

export type Actor = {
  id: string; name: string; username: string; grade: 1 | 2 | 3; role: string;
  permissions: Permission[]; accessExpiresAt: string | null; sessionVersion: number;
};
type Access = "viewer" | "chat" | "edit";
export type ServerInvitationDraft = InvitationDraft & { access?: Access };
type ServerInvitationView = InvitationView & { access?: Access };
type UserRow = {
  id: string; name: string; username: string; grade: 1 | 2 | 3; role: string;
  permissions_json: string; salt: string; password_hash: string; access_expires_at: string | null;
  suspended: number; session_version: number; invite_id: string | null; created_at: string;
};
type InviteRow = {
  id: string; label: string; grade: 2 | 3; role: string; permissions_json: string; digest: string;
  signup_expires_at: string | null; access_expires_at: string | null; issuer_id: string;
  created_at: string; used_by: string | null; used_at: string | null; revoked: number;
};

const COOKIE = "church_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const RATE_MS = 60_000;
const INVALID_LOGIN = "아이디 또는 비밀번호를 확인해 주세요.";
const INVALID_INVITE = "사용할 수 없는 초대코드입니다. 만료·취소·사용 여부를 확인해 주세요.";
const VIEW: Permission[] = ["viewRoom", "viewCalendar", "viewChecklist", "viewHistory"];
const CALENDAR_EDIT: Permission[] = ["createEvent", "editEvent"];
const EDIT: Permission[] = [...VIEW, ...CALENDAR_EDIT, "chat", "deleteEvent", "editChecklist", "uploadDocument", "addLink", "editLink"];
const MANAGEMENT: Permission[] = ["inviteMember", "manageMembers", "createRoom", "editRoom"];
const ALL: Permission[] = [...EDIT, ...MANAGEMENT, "admin"];
const DEVELOPMENT_IDS = new Set(["development-manager", "development-member"]);
const developmentSetup = new WeakMap<DatabaseSync, Promise<void>>();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const nowISO = () => new Date().toISOString();
const expired = (date: string | null) => date !== null && (!Number.isFinite(Date.parse(date)) || Date.now() >= Date.parse(date));
const userById = (db: DatabaseSync, id: string) => db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow | undefined;
const userByName = (db: DatabaseSync, username: string) => db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(username) as UserRow | undefined;

function permissionsFor(grade: 1 | 2 | 3, access: Access = "edit"): Permission[] {
  const base: Permission[] = access === "edit" ? [...EDIT] : [...VIEW, ...CALENDAR_EDIT];
  if (access === "chat") base.push("chat");
  if (grade <= 2) base.push(...MANAGEMENT);
  if (grade === 1) base.push("admin");
  return base;
}
function parsePermissions(value: string, grade: 1 | 2 | 3): Permission[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new ApiError(401, "Account permissions are invalid.");
  return [...new Set(parsed.filter((p): p is Permission => ALL.includes(p) && (grade === 1 || p !== "admin") && (grade <= 2 || !MANAGEMENT.includes(p))))];
}
function activeAccount(row: UserRow | undefined): asserts row is UserRow {
  if (!row || ![1, 2, 3].includes(row.grade) || process.env.NODE_ENV !== "development" && (DEVELOPMENT_IDS.has(row.id) || DEVELOPMENT_IDS.has(row.username))) throw new ApiError(401, INVALID_LOGIN);
  if (row.suspended) throw new ApiError(403, "이용이 정지된 계정입니다. 관리자에게 문의해 주세요.");
  if (expired(row.access_expires_at)) throw new ApiError(403, "이용 기간이 만료되었습니다. 관리자에게 재초대를 요청해 주세요.");
}
function actorFor(row: UserRow): Actor {
  const permissions = parsePermissions(row.permissions_json, row.grade);
  // Existing invitations granted calendar access before editing became a baseline permission.
  if (permissions.includes("viewRoom") && permissions.includes("viewCalendar")) {
    for (const permission of CALENDAR_EDIT) if (!permissions.includes(permission)) permissions.push(permission);
  }
  return { id: row.id, name: row.name, username: row.username, grade: row.grade, role: row.role,
    permissions, accessExpiresAt: row.access_expires_at, sessionVersion: row.session_version };
}
function cookieToken(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";").map(p => p.trim()).filter(p => p.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function sessionCookie(token: string, expiresAt: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}; Expires=${new Date(expiresAt).toUTCString()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

// Optional database arguments are for isolated callers/tests; request validation stays synchronous.
export function requireUser(request: Request, db: DatabaseSync = getDatabase()): Actor {
  const token = cookieToken(request);
  if (!token) throw new ApiError(401, "로그인이 필요합니다.");
  const hash = sha256(token);
  const session = db.prepare("SELECT user_id,session_version,expires_at FROM sessions WHERE token_hash=?").get(hash) as { user_id: string; session_version: number; expires_at: string } | undefined;
  if (!session) throw new ApiError(401, "로그인이 필요합니다.");
  const row = userById(db, session.user_id);
  try {
    activeAccount(row);
    if (expired(session.expires_at) || session.session_version !== row.session_version) throw new ApiError(401, "Your session has expired.");
  } catch {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash);
    throw new ApiError(401, "접속이 만료되었거나 이용할 수 없는 계정입니다. 다시 로그인해 주세요.");
  }
  return actorFor(row);
}

export function profileFor(actor: Actor): UserProfile {
  return { accountId: actor.id, nickname: actor.name, grade: actor.grade, duty: actor.role,
    role: `\uC81C${actor.grade}\uAD00\uB9AC\uC790`, roomIds: [], permissions: [...actor.permissions] };
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!actor.permissions.includes(permission) || permission === "admin" && actor.grade !== 1 || MANAGEMENT.includes(permission) && actor.grade > 2) throw new ApiError(403, "이 작업을 처리할 권한이 없습니다.");
}
function manager(request: Request, db: DatabaseSync, permission: "inviteMember" | "manageMembers" = "manageMembers"): Actor {
  const actor = requireUser(request, db); requirePermission(actor, permission);
  if (actor.grade > 2) throw new ApiError(403, "Administrator access is required.");
  return actor;
}
function audit(db: DatabaseSync, actorId: string, action: string, target: string): void {
  db.prepare("INSERT INTO activities(id,actor_id,action,target,at) VALUES (?,?,?,?,?)").run(randomUUID(), actorId, action, target, nowISO());
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "A JSON object is required.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, `Invalid ${field}.`);
  return value.trim();
}
function takeRateLimit(db: DatabaseSync, key: string, limit: number): void {
  const now = Date.now();
  const row = db.prepare(`INSERT INTO rate_limits(key,attempts,resets_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,
    resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING attempts`).get(key, now + RATE_MS, now, now)!;
  if (Number(row.attempts) > limit) throw new ApiError(429, "시도가 너무 많습니다. 1분 뒤 다시 시도해 주세요.");
}

function nextAnnualExpiry(): string {
  const now = Date.now(); const korean = new Date(now + 9 * 3_600_000);
  let year = korean.getUTCFullYear(); let cutoff = Date.UTC(year, 11, 1) - 9 * 3_600_000;
  if (now >= cutoff) cutoff = Date.UTC(++year, 11, 1) - 9 * 3_600_000;
  return new Date(cutoff).toISOString();
}

export async function ensureDevelopmentAccounts(database?: DatabaseSync): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  const db = database ?? getDatabase();
  const pending = developmentSetup.get(db);
  if (pending) return pending;
  const setup = (async () => {
    const definitions = [
      { id: "development-manager", grade: 2 as const, password: "admin1234@", expiresAt: null },
      { id: "development-member", grade: 3 as const, password: "admin1234#", expiresAt: nextAnnualExpiry() },
    ];
    const missing = definitions.filter(d => !userById(db, d.id));
    const hashes = await Promise.all(missing.map(d => hashPassword(d.password)));
    if (process.env.NODE_ENV !== "development" || !missing.length) return;
    transaction(db, () => {
      missing.forEach((definition, index) => {
        const hash = hashes[index];
        db.prepare("INSERT OR IGNORE INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,access_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(definition.id, "체험 관리자", definition.id, definition.grade, "개발 체험", JSON.stringify(permissionsFor(definition.grade)), hash.salt, hash.passwordHash, definition.expiresAt, nowISO());
      });
      bumpRevision(db);
    });
  })();
  developmentSetup.set(db, setup);
  try { await setup; } finally { developmentSetup.delete(db); }
}

async function login(request: Request, body: Record<string, unknown>, db: DatabaseSync): Promise<Response> {
  const username = text(body.username, "username", 24).toLowerCase();
  if (typeof body.password !== "string" || !body.password || body.password.length > 72) throw new ApiError(400, "Invalid password.");
  const password = body.password;
  // No trusted client address is provided by Request. Never let spoofed forwarding headers bypass limits.
  takeRateLimit(db, "login:global", 100);
  const accountRateKey = `login:account:${sha256(username)}`;
  takeRateLimit(db, accountRateKey, 10);
  await ensureDevelopmentAccounts(db);
  let selected = username;
  if (process.env.NODE_ENV === "development" && username === "admin") {
    if (password === "admin1234@") selected = "development-manager";
    else if (password === "admin1234#") selected = "development-member";
    else selected = "";
  }
  const row = userByName(db, selected);
  const valid = await verifyPassword(password, row?.salt ?? "0".repeat(64), row?.password_hash ?? `pbkdf2-sha256$600000$${"0".repeat(64)}`);
  if (!row || !valid || username === "admin" && (process.env.NODE_ENV !== "development" || !DEVELOPMENT_IDS.has(row.id))) throw new ApiError(401, INVALID_LOGIN);
  return transaction(db, () => {
    const fresh = userById(db, row.id);
    activeAccount(fresh);
    if (fresh.session_version !== row.session_version || fresh.password_hash !== row.password_hash || fresh.salt !== row.salt) throw new ApiError(401, "Account changed. Sign in again.");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Math.min(Date.now() + SESSION_MS, fresh.access_expires_at === null ? Infinity : Date.parse(fresh.access_expires_at));
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(nowISO());
    // Login also rotates the session presented by this browser without trusting its identity.
    const previous = cookieToken(request);
    if (previous) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha256(previous));
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES (?,?,?,?,?)").run(sha256(token), fresh.id, fresh.session_version, new Date(expiresAt).toISOString(), nowISO());
    db.prepare("DELETE FROM rate_limits WHERE key=?").run(accountRateKey);
    const response = json({ profile: profileFor(actorFor(fresh)) });
    response.headers.set("Set-Cookie", sessionCookie(token, expiresAt));
    return response;
  });
}

function ownAccount(request: Request, body: Record<string, unknown>, db: DatabaseSync) {
  const actor = requireUser(request, db);
  if (body.accountId !== actor.id) throw new ApiError(409, "접속 계정이 변경되었습니다. 다시 확인해 주세요.");
  return actor;
}

async function changePassword(request: Request, body: Record<string, unknown>, db: DatabaseSync) {
  const actor = ownAccount(request, body, db);
  if (DEVELOPMENT_IDS.has(actor.id)) throw new ApiError(403, "개발 체험 계정의 비밀번호는 변경할 수 없습니다.");
  const { currentPassword, newPassword, confirmation } = body;
  if (typeof currentPassword !== "string" || !currentPassword || currentPassword.length > 72 ||
      typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 72 || newPassword !== confirmation || currentPassword === newPassword)
    throw new ApiError(400, "현재와 다른 8~72자의 새 비밀번호와 확인 값을 입력해 주세요.");
  const rateKey = `password-change:${actor.id}`;
  takeRateLimit(db, rateKey, 5);
  const row = userById(db, actor.id)!;
  if (!await verifyPassword(currentPassword, row.salt, row.password_hash)) throw new ApiError(400, "현재 비밀번호를 확인해 주세요.");
  const next = await hashPassword(newPassword);
  return transaction(db, () => {
    ownAccount(request, body, db);
    const active = userById(db, actor.id)!;
    if (active.session_version !== actor.sessionVersion || active.password_hash !== row.password_hash) throw new ApiError(409, "계정이 변경되었습니다. 다시 시도해 주세요.");
    const token = randomBytes(32).toString("base64url");
    const current = db.prepare("SELECT expires_at FROM sessions WHERE token_hash=? AND user_id=?").get(sha256(cookieToken(request)!), actor.id)!;
    const expiresAt = Date.parse(String(current.expires_at));
    db.prepare("UPDATE users SET salt=?,password_hash=?,session_version=session_version+1 WHERE id=?").run(next.salt, next.passwordHash, actor.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(actor.id);
    db.prepare("INSERT INTO sessions(token_hash,user_id,session_version,expires_at,created_at) VALUES (?,?,?,?,?)").run(sha256(token), actor.id, actor.sessionVersion + 1, current.expires_at, nowISO());
    db.prepare("DELETE FROM rate_limits WHERE key=?").run(rateKey);
    const response = json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie(token, expiresAt));
    return response;
  });
}

function normalizeCode(value: unknown): string {
  if (typeof value !== "string" || value.length > 128) return "";
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code) ? code : "";
}
function inviteFor(db: DatabaseSync, code: unknown): InviteRow | undefined {
  const normalized = normalizeCode(code);
  return normalized ? db.prepare("SELECT * FROM invitations WHERE digest=?").get(sha256(normalized)) as InviteRow | undefined : undefined;
}
function available(invite: InviteRow | undefined): invite is InviteRow {
  return !!invite && [2, 3].includes(invite.grade) && !invite.used_by && !invite.revoked && !expired(invite.signup_expires_at) && !expired(invite.access_expires_at);
}
function checkInvite(body: Record<string, unknown>, db: DatabaseSync): Response {
  takeRateLimit(db, "invite:public", 10);
  const invite = inviteFor(db, body.code);
  return available(invite) ? json({ ok: true, id: invite.id, grade: invite.grade, role: invite.role, expiresAt: invite.access_expires_at, signupExpiresAt: invite.signup_expires_at }) : json({ ok: false, error: INVALID_INVITE });
}
async function signup(body: Record<string, unknown>, db: DatabaseSync): Promise<Response> {
  takeRateLimit(db, "invite:public", 10);
  const name = text(body.name, "name (1-20 characters)", 20);
  const username = text(body.username, "username", 24).toLowerCase();
  if (!/^[a-z0-9_-]{4,24}$/.test(username) || username === "admin" || DEVELOPMENT_IDS.has(username)) throw new ApiError(400, "This username cannot be used for signup.");
  if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 72 || body.password !== body.confirmation) throw new ApiError(400, "Use an 8-72 character password with matching confirmation.");
  if (!available(inviteFor(db, body.inviteCode))) throw new ApiError(400, INVALID_INVITE);
  const hash = await hashPassword(body.password);
  return transaction(db, () => {
    const invite = inviteFor(db, body.inviteCode);
    if (!available(invite)) throw new ApiError(400, INVALID_INVITE);
    if (userByName(db, username)) throw new ApiError(409, "이미 사용 중인 아이디입니다.");
    const id = randomUUID(); const at = nowISO();
    const consumed = db.prepare("UPDATE invitations SET used_by=?,used_at=? WHERE id=? AND used_by IS NULL AND revoked=0").run(id, at, invite.id);
    if (Number(consumed.changes) !== 1) throw new ApiError(400, INVALID_INVITE);
    db.prepare("INSERT INTO users(id,name,username,grade,role,permissions_json,salt,password_hash,access_expires_at,invite_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, name, username, invite.grade, invite.role, JSON.stringify(parsePermissions(invite.permissions_json, invite.grade)), hash.salt, hash.passwordHash, invite.access_expires_at, invite.id, at);
    audit(db, id, "Account created", id); bumpRevision(db);
    return json({ name, username, grade: invite.grade, expiresAt: invite.access_expires_at });
  });
}

function deadline(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "Invalid deadline.");
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const time = Date.parse(value);
  if (!parts || !Number.isFinite(time) || time <= Date.now()) throw new ApiError(400, "Deadlines must be future ISO timestamps with an explicit timezone.");
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) throw new ApiError(400, "Invalid calendar deadline.");
  return new Date(time).toISOString();
}
function accessFrom(permissions: Permission[]): Access {
  return permissions.includes("editChecklist") ? "edit" : permissions.includes("chat") ? "chat" : "viewer";
}
function invitationView(db: DatabaseSync, invite: InviteRow): ServerInvitationView {
  const issuer = userById(db, invite.issuer_id); const member = invite.used_by ? userById(db, invite.used_by) : undefined;
  return { id: invite.id, label: invite.label, grade: invite.grade, role: invite.role, signupExpiresAt: invite.signup_expires_at,
    accessExpiresAt: invite.access_expires_at, createdAt: invite.created_at, issuerName: issuer?.name ?? "Administrator",
    usedByName: member?.name ?? null, access: accessFrom(parsePermissions(invite.permissions_json, invite.grade)),
    status: invite.used_by ? "used" : invite.revoked ? "revoked" : expired(invite.signup_expires_at) || expired(invite.access_expires_at) ? "expired" : "unused" };
}
function createInvitation(request: Request, body: Record<string, unknown>, db: DatabaseSync): Response {
  const actor = manager(request, db, "inviteMember");
  takeRateLimit(db, `invitations:${actor.id}`, 30);
  if (body.grade !== 2 && body.grade !== 3) throw new ApiError(400, "Only grade2 and grade3 invitations are allowed.");
  const grade = body.grade;
  const label = text(body.label, "label", 60); const role = text(body.role, "role", 40);
  const signupEnd = deadline(body.signupExpiresAt);
  const accessEnd = body.accessExpiresAt === null ? null : deadline(body.accessExpiresAt);
  if (grade === 3 && accessEnd === null || accessEnd !== null && Date.parse(signupEnd) > Date.parse(accessEnd)) throw new ApiError(400, "Signup must end before account access; grade3 requires an access deadline.");
  const access = body.access === undefined ? "edit" : body.access;
  if (access !== "viewer" && access !== "chat" && access !== "edit") throw new ApiError(400, "Invalid access mode.");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const rawCode = Array.from(randomBytes(12), b => alphabet[b & 31]).join("");
  const code = rawCode.match(/.{4}/g)!.join("-");
  return transaction(db, () => {
    const invite: InviteRow = { id: randomUUID(), label, grade, role, permissions_json: JSON.stringify(permissionsFor(grade, access)),
      digest: sha256(rawCode), signup_expires_at: signupEnd, access_expires_at: accessEnd, issuer_id: actor.id,
      created_at: nowISO(), used_by: null, used_at: null, revoked: 0 };
    db.prepare("INSERT INTO invitations(id,label,grade,role,permissions_json,digest,signup_expires_at,access_expires_at,issuer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(invite.id, label, grade, role, invite.permissions_json, invite.digest, signupEnd, accessEnd, actor.id, invite.created_at);
    audit(db, actor.id, "Invitation issued", invite.id); bumpRevision(db);
    const result: CreatedInvitation = { invitation: invitationView(db, invite), code, signupPath: `/signup#invite=${code}` };
    return json(result);
  });
}
function revokeInvitation(request: Request, body: Record<string, unknown>, db: DatabaseSync): Response {
  const actor = manager(request, db, "inviteMember"); const id = text(body.id, "invitation id", 100);
  return transaction(db, () => {
    const invite = db.prepare("SELECT * FROM invitations WHERE id=?").get(id) as InviteRow | undefined;
    if (!available(invite)) throw new ApiError(400, "Only unused, active invitations can be revoked.");
    db.prepare("UPDATE invitations SET revoked=1 WHERE id=?").run(id);
    audit(db, actor.id, "Invitation revoked", id); bumpRevision(db);
    return json({ ok: true });
  });
}
function setMemberStatus(request: Request, body: Record<string, unknown>, db: DatabaseSync): Response {
  const actor = manager(request, db); const id = text(body.id, "member id", 100);
  if (typeof body.suspended !== "boolean") throw new ApiError(400, "Suspended must be a boolean.");
  const suspended = body.suspended;
  if (id === actor.id) throw new ApiError(403, "자기 자신은 이용 정지할 수 없습니다.");
  return transaction(db, () => {
    const target = userById(db, id);
    if (!target) throw new ApiError(404, "구성원을 찾을 수 없습니다.");
    if (target.grade === 1) throw new ApiError(403, "제1관리자는 이용 정지할 수 없습니다.");
    if (!!target.suspended === suspended) throw new ApiError(409, "이미 처리된 상태입니다. 목록을 다시 확인해 주세요.");
    db.prepare("UPDATE users SET suspended=?,session_version=session_version+1 WHERE id=?").run(Number(suspended), id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    audit(db, actor.id, suspended ? "Account suspended" : "Account restored", id); bumpRevision(db);
    return json({ ok: true });
  });
}
function overview(request: Request, db: DatabaseSync, ownerOnly: boolean): Response {
  const actor = manager(request, db);
  if (ownerOnly && actor.grade !== 1) throw new ApiError(403, "This view is restricted to the owner.");
  const users = db.prepare("SELECT * FROM users ORDER BY created_at,id").all() as UserRow[];
  const members: MemberView[] = users.map(row => ({ id: row.id, name: row.name, username: row.username, grade: row.grade, role: row.role,
    accessExpiresAt: row.access_expires_at, status: row.suspended ? "suspended" : expired(row.access_expires_at) ? "expired" : "active", fixed: DEVELOPMENT_IDS.has(row.id) }));
  const invitations = (db.prepare("SELECT * FROM invitations ORDER BY created_at DESC,id").all() as InviteRow[]).map(row => invitationView(db, row));
  const activities = actor.grade === 1 ? db.prepare(`SELECT a.id,a.at,a.action,a.target,COALESCE(u.name,'Administrator') AS actor
    FROM activities a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.at DESC,a.id LIMIT 500`).all() as OwnerOverview["activities"] : [];
  const result: OwnerOverview = { members, invitations, activities };
  if (actor.grade === 1) {
    const recent = db.prepare("SELECT id,reporter,category,description,context_json,created_at,mail_status FROM issue_reports ORDER BY created_at DESC LIMIT 500").all().map(row => ({
      id: String(row.id), reporter: String(row.reporter), category: String(row.category), description: String(row.description),
      createdAt: String(row.created_at), notification: String(row.mail_status), ...(row.context_json ? { context: JSON.parse(String(row.context_json)) } : {})
    }));
    const legacy = db.prepare("SELECT r.data_json,u.name FROM records r JOIN users u ON u.id=r.owner_id WHERE r.kind='feedback'").all().flatMap(row => {
      const data = JSON.parse(String(row.data_json));
      return (data.items ?? []).map((r: any) => ({ id: r.id, reporter: String(row.name), category: r.category, description: r.description, createdAt: r.createdAt, ...(r.context ? { context: r.context } : {}) }));
    });
    result.reports = [...recent, ...legacy].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 500);
  }
  return json(result);
}

// These dispatchers accept a private DatabaseSync so route semantics can be tested without getDatabase().
export async function authGet(request: Request, action: string, db: DatabaseSync = getDatabase()): Promise<Response> {
  try {
    if (action === "session") {
      await ensureDevelopmentAccounts(db);
      try { return json({ profile: profileFor(requireUser(request, db)) }); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const response = json({ profile: null });
        if (cookieToken(request)) response.headers.set("Set-Cookie", sessionCookie("", 0));
        return response;
      }
    }
    if (action === "account") return json({ username: requireUser(request, db).username });
    if (action === "management" || action === "owner") return overview(request, db, action === "owner");
    throw new ApiError(404, "Auth action not found.");
  } catch (error) { return errorResponse(error); }
}

export async function authPost(request: Request, action: string, db: DatabaseSync = getDatabase()): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = object(await readJson(request, 16 * 1024));
    if (action === "login") return await login(request, body, db);
    if (action === "change-password") return await changePassword(request, body, db);
    if (action === "display-name") {
      const actor = ownAccount(request, body, db);
      const name = text(body.name, "표시 이름", 20);
      transaction(db, () => { db.prepare("UPDATE users SET name=? WHERE id=?").run(name, actor.id); bumpRevision(db); });
      return json({ name });
    }
    if (action === "logout") {
      const token = cookieToken(request);
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha256(token));
      const response = json({ ok: true }); response.headers.set("Set-Cookie", sessionCookie("", 0)); return response;
    }
    if (action === "check-invite") return checkInvite(body, db);
    if (action === "signup") return await signup(body, db);
    if (action === "invitations") return createInvitation(request, body, db);
    if (action === "revoke-invitation") return revokeInvitation(request, body, db);
    if (action === "member-status") return setMemberStatus(request, body, db);
    throw new ApiError(404, "Auth action not found.");
  } catch (error) { return errorResponse(error); }
}
