import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CHANGED_EVENT, createBrowserAuth, setBrowserAuthFactory } from "../lib/prototype-auth";
import { clearServerAuth, refreshServerAuth, registerServerAuthAdapter } from "../lib/client-auth";
import type { OwnerOverview } from "../lib/invitation-types";
import type { UserProfile } from "../lib/types";

const backend = vi.hoisted(() => ({
  backendFetch: vi.fn(), configureBackendUser: vi.fn(), refreshBackendData: vi.fn(), flushBackendWrites: vi.fn(), isBackendConnected: vi.fn()
}));
vi.mock("../lib/backend-client", () => backend);

const manager: UserProfile = { accountId: "manager", nickname: "Manager", grade: 2, role: "Staff", roomIds: ["room"], permissions: ["manageMembers", "inviteMember"] };
const overview: OwnerOverview = {
  members: [{ id: "member", name: "Member", username: "member", grade: 3, role: "Team", accessExpiresAt: null, status: "active", fixed: false }],
  invitations: [], activities: []
};
let session: UserProfile | null;
let management: OwnerOverview;
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear();
  clearServerAuth(); registerServerAuthAdapter();
  session = null; management = structuredClone(overview);
  backend.isBackendConnected.mockReturnValue(true);
  backend.refreshBackendData.mockResolvedValue(undefined);
  backend.flushBackendWrites.mockResolvedValue(undefined);
  backend.backendFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/session") return { profile: session };
    if (path === "/api/auth/management" || path === "/api/auth/owner") return management;
    if (path === "/api/auth/login") { session = manager; return { profile: session }; }
    if (path === "/api/auth/logout") { session = null; return {}; }
    if (path === "/api/auth/member-status") {
      const { suspended } = JSON.parse(String(init?.body));
      management.members[0].status = suspended ? "suspended" : "active"; return {};
    }
    if (path === "/api/auth/revoke-invitation") { management.invitations = []; return {}; }
    if (path === "/api/auth/signup") return { name: "New", username: "new-user", grade: 3, expiresAt: null };
    if (path === "/api/auth/check-invite") return { ok: true, id: "invite", grade: 3, role: "Team", expiresAt: null, signupExpiresAt: null };
    throw Error(`Unexpected auth endpoint ${path}`);
  });
});
afterEach(() => { clearServerAuth(); setBrowserAuthFactory(null); });

describe("server browser auth facade", () => {
  it("keeps synchronous cached reads and emits no event for unchanged polls", async () => {
    session = manager;
    const changed = vi.fn(); window.addEventListener(AUTH_CHANGED_EVENT, changed);
    try {
      expect(createBrowserAuth().currentProfile()).toBeNull();
      await refreshServerAuth();
      expect(createBrowserAuth().currentProfile()).toEqual(manager);
      expect(createBrowserAuth().getMembers()).toEqual(overview.members);
      expect(changed).toHaveBeenCalledTimes(1);
      await refreshServerAuth();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(backend.configureBackendUser).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(AUTH_CHANGED_EVENT, changed); }
  });

  it("waits for data bootstrap and refreshed management before login resolves", async () => {
    let finish!: () => void;
    backend.refreshBackendData.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    let resolved = false;
    const login = createBrowserAuth().login("manager", "secret").then(value => { resolved = true; return value; });
    await vi.waitFor(() => expect(backend.configureBackendUser).toHaveBeenCalledWith(manager));
    expect(resolved).toBe(false);
    finish();
    expect(await login).toEqual(manager);
    expect(createBrowserAuth().getMembers()).toEqual(overview.members);
    const [, init] = backend.backendFetch.mock.calls.find(([path]) => path === "/api/auth/login")!;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ username: "manager", password: "secret" });
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it("does not cache unexpected password or salt fields from the server", async () => {
    session = { ...manager, password: "secret", salt: "salt", digest: "hash" } as UserProfile;
    management.members[0] = { ...management.members[0], password: "secret", salt: "salt" } as typeof management.members[0];
    await refreshServerAuth();
    const auth = createBrowserAuth();
    expect(JSON.stringify([auth.currentProfile(), auth.getMembers()])).not.toMatch(/secret|salt|digest|password/);
    const profile = auth.currentProfile()!; profile.permissions.length = 0;
    expect(auth.currentProfile()!.permissions).toContain("manageMembers");
  });

  it("loads owner data only for grade1 and drops management when the session changes", async () => {
    session = { ...manager, grade: 1 };
    await refreshServerAuth();
    expect(backend.backendFetch).toHaveBeenCalledWith("/api/auth/owner");
    expect(createBrowserAuth().getOwnerOverview()).toEqual(overview);
    session = { ...manager, grade: 3, permissions: [] };
    backend.backendFetch.mockClear(); await refreshServerAuth();
    expect(backend.backendFetch).not.toHaveBeenCalledWith("/api/auth/management");
    expect(() => createBrowserAuth().getMembers()).toThrow();
    session = null; await refreshServerAuth();
    expect(createBrowserAuth().currentProfile()).toBeNull();
    expect(backend.configureBackendUser).toHaveBeenLastCalledWith(null);
  });

  it("refreshes cached members before a suspension mutation resolves", async () => {
    session = manager; await refreshServerAuth();
    await createBrowserAuth().setMemberSuspended("member", true);
    expect(createBrowserAuth().getMembers()[0].status).toBe("suspended");
    expect(backend.backendFetch).toHaveBeenCalledWith("/api/auth/member-status", expect.objectContaining({ body: JSON.stringify({ id: "member", suspended: true }) }));
  });

  it("preserves the session on failed logout, and clears it after successful logout", async () => {
    session = manager; await refreshServerAuth();
    backend.backendFetch.mockRejectedValueOnce(Error("Unavailable"));
    await expect(createBrowserAuth().logout()).rejects.toThrow("Unavailable");
    expect(createBrowserAuth().currentProfile()).toEqual(manager);
    await createBrowserAuth().logout();
    expect(createBrowserAuth().currentProfile()).toBeNull();
    expect(backend.configureBackendUser).toHaveBeenLastCalledWith(null);
  });

  it("keeps signup hints nonsecret and does not log in after signup", async () => {
    const input = { inviteCode: "invite", name: "New", username: "new-user", password: "secret123", confirmation: "secret123" };
    await createBrowserAuth().signup(input);
    expect(createBrowserAuth().signupHint()).toEqual({ name: "New", username: "new-user" });
    expect(createBrowserAuth().currentProfile()).toBeNull();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(await createBrowserAuth().checkInvite("invite")).toMatchObject({ ok: true, grade: 3 });
  });

  it("ignores an old session response that finishes after logout", async () => {
    session = manager; await refreshServerAuth();
    let finish!: (value: { profile: UserProfile }) => void;
    backend.backendFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = refreshServerAuth();
    await createBrowserAuth().logout();
    finish({ profile: manager }); await refresh;
    expect(createBrowserAuth().currentProfile()).toBeNull();
  });
});
