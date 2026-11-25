import { defaultProfile } from "./mock-data";
import { generateInvitationCode, hashInvitationCode, nextAnnualExpiry, normalizeInvitationCode } from "./invitation-code";
import type { AdminGrade, CreatedInvitation, InvitationDraft, InvitationView, ManagementActivity, MemberView, OwnerOverview } from "./invitation-types";
import type { Permission, UserProfile } from "./types";

export type { AdminGrade } from "./invitation-types";
export type SignupInput = { inviteCode: string; name: string; username: string; password: string; confirmation: string };
export type SignupErrors = Partial<Record<keyof SignupInput, string>>;
type Store = Pick<Storage, "getItem" | "setItem">;
type Account = { id: string; name: string; username: string; grade: AdminGrade; role?: string; inviteCode?: string; inviteId?: string; salt: string; digest: string; algorithm?: "pbkdf2"; expiresAt: string | null };
type Identity = Pick<Account, "id" | "name" | "username" | "grade" | "role" | "expiresAt">;
type Invitation = Omit<InvitationView, "status" | "usedByName"> & { digest: string; usedBy: string | null; revoked: boolean; annual?: boolean };
type Control = { suspended: boolean; version: number };
type Directory = { accounts: Account[]; invitations: Invitation[]; controls: Record<string, Control>; activities: ManagementActivity[] };
type Session = { id: string; version: number };

export const DEMO_AUTH_KEY = "church-planner-demo-auth-v1";
export const DEMO_SESSION_KEY = "church-planner-demo-session-v2";
export const AUTH_CHANGED_EVENT = "church-auth-changed";
export const DEMO_INVITES = [{ code: "CHURCH-STAFF-2026", grade: 2 }, { code: "CHURCH-TEAM-2026", grade: 3 }] as const;
// This entire adapter is a browser simulation, not a production security boundary.
const FIXED_PREVIEWS = [
  { password: "admin1234", grade: 1, id: "local-preview-1" },
  { password: "admin1234@", grade: 2, id: "local-preview-2" },
  { password: "admin1234#", grade: 3, id: "local-preview-3" }
] as const;
const SEEDS: Invitation[] = [
  { id: "demo-staff", label: "제2관리자 체험 초대", grade: 2, role: "행사 운영", signupExpiresAt: null, accessExpiresAt: null, createdAt: "2026-01-01T00:00:00.000Z", issuerName: "체험", digest: "5a89c0bd9fbe3341d3909e36a217f8e4f2a0b9d28804a0c251ee1bc06e76332e", usedBy: null, revoked: false },
  { id: "demo-team", label: "제3관리자 체험 초대", grade: 3, role: "행사 담당", signupExpiresAt: null, accessExpiresAt: null, createdAt: "2026-01-01T00:00:00.000Z", issuerName: "체험", digest: "8e13fe42279c6f86ad08dc107dd399fa24c5f8a2eb798eed655850f21ee8c6d8", usedBy: null, revoked: false, annual: true }
];

export function validateSignup(input: SignupInput): SignupErrors {
  const errors: SignupErrors = {};
  if (!input.inviteCode.trim()) errors.inviteCode = "초대코드를 입력해 주세요.";
  if (!input.name.trim() || input.name.trim().length > 20) errors.name = "이름은 1~20자로 입력해 주세요.";
  if (!/^[a-zA-Z0-9_-]{4,24}$/.test(input.username.trim())) errors.username = "아이디는 영문, 숫자, 밑줄, 하이픈으로 4~24자 입력해 주세요.";
  if (input.username.trim().toLowerCase() === "admin") errors.username = "이 아이디는 회원가입에 사용할 수 없습니다.";
  if (input.password.length < 8 || input.password.length > 72) errors.password = "비밀번호는 8~72자로 입력해 주세요.";
  if (input.password !== input.confirmation || !input.confirmation) errors.confirmation = "비밀번호가 일치하지 않습니다.";
  return errors;
}

function profileFor(account: Identity): UserProfile {
  const extra: Permission[] = account.grade <= 2 ? ["inviteMember", "manageMembers", "createRoom", "editRoom", "deleteEvent", "uploadDocument"] : [];
  if (account.grade === 1) extra.push("admin");
  return { accountId: account.id, nickname: account.name, grade: account.grade, duty: account.role, role: `제${account.grade}관리자`, roomIds: [...defaultProfile.roomIds], permissions: [...new Set([...defaultProfile.permissions, ...extra])] };
}
function fixedIdentities(): Identity[] {
  return FIXED_PREVIEWS.map(item => ({ ...item, name: `체험 관리자`, username: "admin", role: "체험", expiresAt: null }));
}
function validAccount(value: unknown): value is Account {
  if (!value || typeof value !== "object") return false;
  const a = value as Account;
  return [a.id, a.name, a.username, a.salt, a.digest].every(v => typeof v === "string") && [1, 2, 3].includes(a.grade) && (a.expiresAt === null || typeof a.expiresAt === "string" && Number.isFinite(Date.parse(a.expiresAt)));
}
async function passwordDigest(password: string, salt: string, algorithm?: "pbkdf2") {
  if (!algorithm) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 600_000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

export function createPrototypeAuth(storage: Store, clock = () => new Date(), sessions: Store = storage) {
  const empty = (): Directory => ({ accounts: [], invitations: SEEDS.map(i => ({ ...i })), controls: {}, activities: [] });
  const read = (): Directory => {
    let raw: unknown;
    try { raw = JSON.parse(storage.getItem(DEMO_AUTH_KEY) ?? "null"); } catch { return empty(); }
    if (!raw || typeof raw !== "object") return empty();
    const data = raw as Partial<Directory>;
    if (!Array.isArray(data.accounts) || !data.accounts.every(validAccount)) return empty();
    const invitations = Array.isArray(data.invitations) ? data.invitations : empty().invitations;
    // Link legacy demo signups without re-enabling a previously consumed invitation.
    for (const invite of invitations) {
      const legacy = data.accounts.find(a => a.inviteCode && normalizeInvitationCode(a.inviteCode) === (invite.id === "demo-staff" ? "CHURCHSTAFF2026" : invite.id === "demo-team" ? "CHURCHTEAM2026" : ""));
      if (legacy) invite.usedBy = legacy.id;
    }
    return { accounts: data.accounts, invitations, controls: data.controls ?? {}, activities: data.activities ?? [] };
  };
  const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); };
  const setItem = (target: Store, key: string, value: unknown) => {
    try { target.setItem(key, JSON.stringify(value)); } catch { throw new Error("브라우저 저장소를 사용할 수 없습니다. 사이트 저장소를 허용한 뒤 다시 시도해 주세요."); }
  };
  const write = (data: Directory) => { setItem(storage, DEMO_AUTH_KEY, data); notify(); };
  const setSession = (session: Session | null) => { setItem(sessions, DEMO_SESSION_KEY, session); };
  const attempts = (kind: "invite" | "login"): { count: number; until: number } => {
    try {
      const saved = JSON.parse(sessions.getItem(`church-attempts-${kind}`) ?? "null");
      if (saved && Number.isFinite(saved.count) && Number.isFinite(saved.until) && saved.until > clock().getTime()) return saved;
    } catch { /* An invalid demo cooldown starts a new window. */ }
    return { count: 0, until: clock().getTime() + 60_000 };
  };
  const cooldownMessage = "시도가 너무 많습니다. 1분 뒤 다시 시도해 주세요.";
  const failedAttempt = (kind: "invite" | "login") => {
    const previous = attempts(kind); setItem(sessions, `church-attempts-${kind}`, { ...previous, count: previous.count + 1 });
  };
  const controlFor = (data: Directory, id: string): Control => data.controls[id] ?? { suspended: false, version: 0 };
  const lookup = (data: Directory, id: string): Identity | undefined => fixedIdentities().find(a => a.id === id) ?? data.accounts.find(a => a.id === id && a.grade !== 1);
  const expired = (account: Identity) => !!account.expiresAt && clock().getTime() >= Date.parse(account.expiresAt);
  const currentProfile = (): UserProfile | null => {
    let session: Session | null;
    try { session = JSON.parse(sessions.getItem(DEMO_SESSION_KEY) ?? "null"); } catch { return null; }
    if (!session) return null;
    const data = read(); const account = lookup(data, session.id); const control = controlFor(data, session.id);
    if (!account || control.suspended || control.version !== session.version || expired(account)) { setSession(null); return null; }
    return profileFor(account);
  };
  const manager = () => {
    const profile = currentProfile();
    if (!profile || !profile.permissions.includes("manageMembers")) throw new Error("구성원을 관리할 권한이 없습니다.");
    return profile;
  };
  const log = (data: Directory, actor: UserProfile, action: string, target: string) => {
    data.activities.unshift({ id: crypto.randomUUID(), at: clock().toISOString(), actor: `${actor.nickname} (${actor.role})`, action, target });
    data.activities = data.activities.slice(0, 500);
  };
  const view = (invite: Invitation, data: Directory): InvitationView => {
    const { digest: _digest, usedBy, revoked, annual: _annual, ...item } = invite;
    const member = data.accounts.find(a => a.id === usedBy);
    const status = usedBy ? "used" : revoked ? "revoked" : invite.signupExpiresAt && clock().getTime() >= Date.parse(invite.signupExpiresAt) || invite.accessExpiresAt && clock().getTime() >= Date.parse(invite.accessExpiresAt) ? "expired" : "unused";
    return { ...item, accessExpiresAt: invite.annual ? member?.expiresAt ?? nextAnnualExpiry(clock()) : item.accessExpiresAt, status, usedByName: member?.name ?? null };
  };
  const invitationError = (invite: Invitation | undefined) => {
    if (!invite || ![2, 3].includes(invite.grade)) return "유효하지 않은 초대코드입니다.";
    if (invite.usedBy) return "이미 사용된 초대코드입니다.";
    if (invite.revoked) return "폐기된 초대코드입니다.";
    if (invite.signupExpiresAt && clock().getTime() >= Date.parse(invite.signupExpiresAt) || invite.accessExpiresAt && clock().getTime() >= Date.parse(invite.accessExpiresAt)) return "만료된 초대코드입니다.";
    return null;
  };
  const checkInvite = async (code: string) => {
    if (attempts("invite").count >= 10) return { ok: false as const, error: cooldownMessage };
    const digest = await hashInvitationCode(code); const data = read();
    const invite = data.invitations.find(i => i.digest === digest); const error = invitationError(invite);
    if (error || !invite) { failedAttempt("invite"); return { ok: false as const, error: error! }; }
    return { ok: true as const, id: invite.id, grade: invite.grade, role: invite.role, expiresAt: invite.annual ? nextAnnualExpiry(clock()) : invite.accessExpiresAt, signupExpiresAt: invite.signupExpiresAt };
  };
  const getInvitations = () => { manager(); const data = read(); return data.invitations.map(i => view(i, data)); };
  const getMembers = (): MemberView[] => {
    manager(); const data = read();
    return [...fixedIdentities(), ...data.accounts.filter(a => a.grade !== 1)].map(a => ({ id: a.id, name: a.name, username: a.username, grade: a.grade, role: a.role ?? "행사 담당", accessExpiresAt: a.expiresAt, status: controlFor(data, a.id).suspended ? "suspended" : expired(a) ? "expired" : "active", fixed: a.id.startsWith("local-preview-") }));
  };

  return {
    checkInvite, currentProfile, getInvitations, getMembers,
    async signup(input: SignupInput) {
      const errors = validateSignup(input);
      if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
      const invitation = await checkInvite(input.inviteCode);
      if (!invitation.ok) throw new Error(invitation.error);
      const username = input.username.trim().toLowerCase();
      const salt = crypto.randomUUID(); const digest = await passwordDigest(input.password, salt, "pbkdf2");
      // No awaits between this final check and write. Production needs a DB transaction.
      const data = read(); const fresh = data.invitations.find(i => i.id === invitation.id);
      const error = invitationError(fresh);
      if (error || !fresh) throw new Error(error!);
      if (data.accounts.some(a => a.username === username)) throw new Error("이미 사용 중인 아이디입니다.");
      const account: Account = { id: crypto.randomUUID(), name: input.name.trim(), username, grade: fresh.grade, role: fresh.role, inviteId: fresh.id, salt, digest, algorithm: "pbkdf2", expiresAt: fresh.annual ? nextAnnualExpiry(clock()) : fresh.accessExpiresAt };
      setItem(sessions, "church-signup-hint", { name: account.name, username });
      fresh.usedBy = account.id; data.accounts.push(account); write(data);
      return { name: account.name, username, grade: account.grade, expiresAt: account.expiresAt };
    },
    async login(username: string, password: string) {
      if (attempts("login").count >= 10) throw new Error(cooldownMessage);
      const normalized = username.trim().toLowerCase(); const data = read();
      let account: Identity | undefined;
      if (normalized === "admin") {
        const preview = FIXED_PREVIEWS.find(i => i.password === password);
        if (preview) account = lookup(data, preview.id);
      } else {
        const stored = data.accounts.find(a => a.username === normalized);
        if (stored && stored.digest === await passwordDigest(password, stored.salt, stored.algorithm)) {
          if (stored.grade === 1) throw new Error("이용할 수 없는 계정입니다.");
          account = stored;
        }
      }
      if (!account) { failedAttempt("login"); throw new Error("아이디 또는 비밀번호를 확인해 주세요."); }
      const fresh = read(); const latest = lookup(fresh, account.id); const control = controlFor(fresh, account.id);
      if (!latest) throw new Error("이용할 수 없는 계정입니다.");
      if (control.suspended) throw new Error("이용이 정지된 계정입니다. 관리자에게 문의해 주세요.");
      if (expired(latest)) throw new Error("이용 기간이 만료된 계정입니다. 관리자에게 재초대를 요청해 주세요.");
      setItem(sessions, "church-attempts-login", null); setItem(sessions, "church-signup-hint", null);
      setSession({ id: latest.id, version: control.version });
      return profileFor(latest);
    },
    signupHint(): { name: string; username: string } | null {
      try {
        const hint = JSON.parse(sessions.getItem("church-signup-hint") ?? "null");
        return hint && read().accounts.some(a => a.username === hint.username) ? hint : null;
      } catch { return null; }
    },
    logout() { setSession(null); },
    async createInvitation(draft: InvitationDraft): Promise<CreatedInvitation> {
      const actor = manager();
      if (![2, 3].includes(draft.grade)) throw new Error("초대 가능한 등급은 제2·3관리자입니다.");
      if (!draft.label.trim() || draft.label.trim().length > 60 || !draft.role.trim() || draft.role.trim().length > 40) throw new Error("초대 이름과 담당 역할을 입력해 주세요. 이름은 60자, 역할은 40자 이내입니다.");
      const signupEnd = Date.parse(draft.signupExpiresAt); const accessEnd = draft.accessExpiresAt ? Date.parse(draft.accessExpiresAt) : null;
      if (!Number.isFinite(signupEnd) || signupEnd <= clock().getTime() || accessEnd !== null && (!Number.isFinite(accessEnd) || accessEnd <= clock().getTime() || signupEnd > accessEnd)) throw new Error("가입·이용 기한을 확인해 주세요. 가입 기한은 이용 기한보다 늦을 수 없습니다.");
      if (draft.grade === 3 && accessEnd === null) throw new Error("일반 사용자의 이용 기한을 지정해 주세요.");
      const code = generateInvitationCode(); const digest = await hashInvitationCode(code);
      if (manager().accountId !== actor.accountId) throw new Error("접속 계정이 변경되었습니다. 다시 시도해 주세요.");
      const data = read();
      if (data.invitations.some(i => i.digest === digest)) throw new Error("코드를 다시 생성해 주세요.");
      const invite: Invitation = { ...draft, label: draft.label.trim(), role: draft.role.trim(), id: crypto.randomUUID(), signupExpiresAt: new Date(signupEnd).toISOString(), accessExpiresAt: accessEnd === null ? null : new Date(accessEnd).toISOString(), createdAt: clock().toISOString(), issuerName: actor.nickname, digest, usedBy: null, revoked: false };
      data.invitations.unshift(invite); log(data, actor, "초대 발급", invite.label); write(data);
      return { invitation: view(invite, data), code, signupPath: `/signup#invite=${code}` };
    },
    revokeInvitation(id: string) {
      const actor = manager(); const data = read(); const invite = data.invitations.find(i => i.id === id);
      if (!invite || view(invite, data).status !== "unused") throw new Error("사용 가능한 초대만 폐기할 수 있습니다.");
      invite.revoked = true; log(data, actor, "초대 폐기", invite.label); write(data);
    },
    setMemberSuspended(id: string, suspended: boolean) {
      const actor = manager(); const data = read(); const target = lookup(data, id);
      if (id === "local-preview-1" || target?.grade === 1) throw new Error("제1관리자는 이용 정지할 수 없습니다.");
      if (id === actor.accountId) throw new Error("자기 자신은 이용 정지할 수 없습니다.");
      if (!target) throw new Error("구성원을 찾을 수 없습니다.");
      const previous = controlFor(data, id);
      if (previous.suspended === suspended) throw new Error("이미 처리된 상태입니다. 목록을 다시 확인해 주세요.");
      data.controls[id] = { suspended, version: previous.version + 1 };
      log(data, actor, suspended ? "이용 정지" : "이용 복구", `${target.name} (${target.username})`); write(data);
    },
    getOwnerOverview(): OwnerOverview {
      if (currentProfile()?.grade !== 1) throw new Error("제1관리자 전용 화면입니다. 접근 권한이 없습니다.");
      return { members: getMembers(), invitations: getInvitations(), activities: read().activities };
    }
  };
}

let connectedAuthFactory: (() => ReturnType<typeof createPrototypeAuth>) | null = null;
export function setBrowserAuthFactory(factory: (() => ReturnType<typeof createPrototypeAuth>) | null) { connectedAuthFactory = factory; }

export function createBrowserAuth() {
  if (connectedAuthFactory) return connectedAuthFactory();
  // Migrate the previous tab-local directory without transferring another tab's login.
  const legacy = sessionStorage.getItem(DEMO_AUTH_KEY);
  if (legacy && !localStorage.getItem(DEMO_AUTH_KEY)) localStorage.setItem(DEMO_AUTH_KEY, legacy);
  return createPrototypeAuth(localStorage, () => new Date(), sessionStorage);
}
