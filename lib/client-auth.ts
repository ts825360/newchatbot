import { backendFetch, configureBackendUser, flushBackendWrites, isBackendConnected, refreshBackendData } from "./backend-client";
import { AUTH_CHANGED_EVENT, setBrowserAuthFactory, type createPrototypeAuth, type SignupInput } from "./prototype-auth";
import type { CreatedInvitation, InvitationDraft, InvitationView, MemberView, OwnerOverview } from "./invitation-types";
import type { UserProfile } from "./types";

type BrowserAuth = ReturnType<typeof createPrototypeAuth>;
type CheckInviteResult = Awaited<ReturnType<BrowserAuth["checkInvite"]>>;
type SignupResult = Awaited<ReturnType<BrowserAuth["signup"]>>;
const emptyOverview = (): OwnerOverview => ({ members: [], invitations: [], activities: [] });
let profile: UserProfile | null = null;
let overview = emptyOverview();
let signupHint: { name: string; username: string } | null = null;
let generation = 0;
let refreshing: { generation: number; promise: Promise<UserProfile | null> } | null = null;

const copy = <T,>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); };

// Only public view fields enter the shared cache, never account credentials or invitation digests.
function publicProfile(value: UserProfile | null): UserProfile | null {
  if (!value) return null;
  return { accountId: value.accountId, nickname: value.nickname, grade: value.grade, duty: value.duty, role: value.role, roomIds: [...value.roomIds], permissions: [...value.permissions] };
}
function publicOverview(value: OwnerOverview): OwnerOverview {
  return {
    members: value.members.map(({ id, name, username, grade, role, accessExpiresAt, status, fixed }: MemberView) => ({ id, name, username, grade, role, accessExpiresAt, status, fixed })),
    invitations: value.invitations.map((invite: InvitationView) => {
      const { id, label, grade, role, signupExpiresAt, accessExpiresAt, createdAt, issuerName, status, usedByName } = invite;
      const access = (invite as InvitationView & { access?: "viewer" | "chat" | "edit" }).access;
      return { id, label, grade, role, signupExpiresAt, accessExpiresAt, createdAt, issuerName, status, usedByName, ...(access ? { access } : {}) };
    }),
    activities: (value.activities ?? []).map(({ id, actor, action, target, at }) => ({ id, actor, action, target, at })),
    ...(value.reports ? { reports: value.reports.map(({ id, reporter, category, description, createdAt, context, notification }) => ({ id, reporter, category, description, createdAt, context, notification })) } : {})
  };
}
async function loadOverview(current: UserProfile | null): Promise<OwnerOverview> {
  if (current?.grade !== 1 && current?.grade !== 2) return emptyOverview();
  return publicOverview(await backendFetch(current.grade === 1 ? "/api/auth/owner" : "/api/auth/management"));
}
async function commit(current: UserProfile | null, management: OwnerOverview, version: number, bootstrap = false) {
  if (version !== generation) return;
  const profileChanged = !same(profile, current);
  const changed = profileChanged || !same(overview, management);
  profile = current; overview = management;
  try {
    if (profileChanged || bootstrap) {
      configureBackendUser(copy(profile));
      if (isBackendConnected()) await refreshBackendData();
    }
  } finally {
    if (changed && version === generation) notify();
  }
}

export function refreshServerAuth(): Promise<UserProfile | null> {
  const version = generation;
  if (refreshing?.generation === version) return refreshing.promise;
  const promise = (async () => {
    const result: { profile: UserProfile | null } = await backendFetch("/api/auth/session");
    if (version !== generation) return copy(profile);
    const current = publicProfile(result.profile);
    let management: OwnerOverview;
    try { management = await loadOverview(current); }
    catch (cause) {
      await commit(current, emptyOverview(), version);
      throw cause;
    }
    await commit(current, management, version);
    return copy(profile);
  })();
  refreshing = { generation: version, promise };
  void promise.finally(() => { if (refreshing?.promise === promise) refreshing = null; }).catch(() => {});
  return promise;
}

const post = <T,>(action: string, body: unknown): Promise<T> => backendFetch(`/api/auth/${action}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});
const requireManagement = () => {
  if (profile?.grade !== 1 && profile?.grade !== 2) throw new Error("구성원을 관리할 권한이 없습니다.");
};
async function mutate(action: string, body: unknown) {
  await post(action, body);
  generation++;
  await refreshServerAuth();
}

const adapter = {
  currentProfile: () => copy(profile),
  getMembers() { requireManagement(); return copy(overview.members); },
  getInvitations() { requireManagement(); return copy(overview.invitations); },
  getOwnerOverview() {
    if (profile?.grade !== 1) throw new Error("제1관리자 전용 화면입니다. 접근 권한이 없습니다.");
    return copy(overview);
  },
  signupHint: () => copy(signupHint),
  checkInvite: (code: string) => post<CheckInviteResult>("check-invite", { code }),
  async signup(input: SignupInput) {
    const result = await post<SignupResult>("signup", input);
    signupHint = { name: result.name, username: result.username };
    if (profile) { generation++; await refreshServerAuth(); }
    return result;
  },
  async login(username: string, password: string) {
    const version = ++generation;
    const result = await post<{ profile: UserProfile }>("login", { username, password });
    if (version !== generation) throw new Error("접속 상태가 변경되었습니다. 다시 시도해 주세요.");
    const current = publicProfile(result.profile)!;
    let management: OwnerOverview;
    try { management = await loadOverview(current); }
    catch (cause) { await commit(current, emptyOverview(), version, true); throw cause; }
    await commit(current, management, version, true);
    if (version !== generation) throw new Error("접속 상태가 변경되었습니다. 다시 시도해 주세요.");
    signupHint = null;
    return copy(current);
  },
  async logout() {
    generation++;
    if (isBackendConnected()) await flushBackendWrites();
    await post("logout", {});
    const version = ++generation;
    signupHint = null;
    await commit(null, emptyOverview(), version, true);
  },
  async createInvitation(draft: InvitationDraft) {
    const result = await post<CreatedInvitation>("invitations", draft);
    generation++; await refreshServerAuth();
    return result;
  },
  revokeInvitation: (id: string) => mutate("revoke-invitation", { id }),
  setMemberSuspended: (id: string, suspended: boolean) => mutate("member-status", { id, suspended })
} satisfies BrowserAuth;

export function registerServerAuthAdapter(): void { setBrowserAuthFactory(() => adapter); }

export function clearServerAuth(): void {
  generation++; refreshing = null; signupHint = null;
  const changed = profile !== null || !same(overview, emptyOverview());
  profile = null; overview = emptyOverview();
  if (changed) notify();
}
