import { beforeEach, describe, expect, it } from "vitest";
import { createPrototypeAuth } from "../lib/prototype-auth";

const start = new Date("2026-11-16T12:00:00+09:00");
const draft = { label: "차량 담당 초대", grade: 3 as const, role: "차량 담당", signupExpiresAt: "2026-11-20T00:00:00+09:00", accessExpiresAt: "2026-12-01T00:00:00+09:00" };
const signup = (code: string, username = "new-member") => ({ inviteCode: code, name: "새 담당자", username, password: "DemoPass123!", confirmation: "DemoPass123!" });
function memory() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; }

describe("issued invitations and service membership", () => {
  beforeEach(() => sessionStorage.clear());
  const auth = () => createPrototypeAuth(sessionStorage, () => start);

  it("issues a grouped 12-symbol code and stores only its hash", async () => {
    const owner = auth(); await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft);
    expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/);
    expect(issued.signupPath).toBe(`/signup#invite=${issued.code}`);
    expect(JSON.stringify(sessionStorage)).not.toContain(issued.code.replaceAll("-", ""));
    expect(JSON.stringify(sessionStorage)).not.toContain(issued.code);
    expect((await owner.checkInvite(issued.code.toLowerCase().replaceAll("-", " "))).ok).toBe(true);
    expect(owner.getInvitations().find(i => i.id === issued.invitation.id)?.status).toBe("unused");
  });

  it("claims only on completed signup, then preserves account access past the signup deadline", async () => {
    const owner = auth(); await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft);
    await owner.checkInvite(issued.code); await owner.checkInvite(issued.code);
    await owner.signup(signup(issued.code));
    expect((await owner.checkInvite(issued.code)).ok).toBe(false);
    await expect(owner.signup(signup(issued.code, "second-user"))).rejects.toThrow("사용");
    const later = createPrototypeAuth(sessionStorage, () => new Date("2026-11-22T12:00:00+09:00"));
    expect((await later.login("new-member", "DemoPass123!")).role).toBe("제3관리자");
    const ended = createPrototypeAuth(sessionStorage, () => new Date(draft.accessExpiresAt));
    expect(ended.currentProfile()).toBeNull();
    await expect(ended.login("new-member", "DemoPass123!")).rejects.toThrow("만료");
  });

  it("rejects expired, revoked, and invalid invitations", async () => {
    const owner = auth(); await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft);
    owner.revokeInvitation(issued.invitation.id);
    expect((await owner.checkInvite(issued.code)).ok).toBe(false);
    const next = await owner.createInvitation(draft);
    const later = createPrototypeAuth(sessionStorage, () => new Date(draft.signupExpiresAt));
    expect((await later.checkInvite(next.code)).ok).toBe(false);
    await expect(later.signup(signup(next.code))).rejects.toThrow("만료");
    await expect(owner.createInvitation({ ...draft, grade: 1 as never })).rejects.toThrow("등급");
    await expect(owner.createInvitation({ ...draft, accessExpiresAt: "invalid" })).rejects.toThrow("기한");
  });

  it("does not double claim a code while password hashing is pending", async () => {
    const owner = auth(); await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft);
    const results = await Promise.allSettled([owner.signup(signup(issued.code, "user-one")), owner.signup(signup(issued.code, "user-two"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(owner.getMembers().filter(m => !m.fixed)).toHaveLength(1);
  });

  it("rechecks duplicate usernames after hashing without consuming the other code", async () => {
    const owner = auth(); await owner.login("admin", "admin1234");
    const first = await owner.createInvitation(draft); const second = await owner.createInvitation(draft);
    const results = await Promise.allSettled([owner.signup(signup(first.code)), owner.signup(signup(second.code))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(owner.getInvitations().filter(i => [first.invitation.id, second.invitation.id].includes(i.id) && i.status === "unused")).toHaveLength(1);
  });

  it("allows grade2 to invite and suspend other grade2 accounts but never owner or self", async () => {
    const manager = auth(); await manager.login("admin", "admin1234@");
    expect(manager.currentProfile()?.permissions).not.toContain("admin");
    expect(manager.currentProfile()?.permissions).toContain("manageMembers");
    const issued = await manager.createInvitation({ ...draft, grade: 2, accessExpiresAt: null });
    await manager.signup(signup(issued.code));
    const member = manager.getMembers().find(m => m.username === "new-member")!;
    manager.setMemberSuspended(member.id, true);
    expect(manager.getMembers().find(m => m.id === member.id)?.status).toBe("suspended");
    expect(() => manager.setMemberSuspended("local-preview-1", true)).toThrow("제1관리자");
    expect(() => manager.setMemberSuspended("local-preview-2", true)).toThrow("자신");
    expect(() => manager.getOwnerOverview()).toThrow("권한");
  });

  it("revokes every existing member session and does not resurrect it after restore", async () => {
    const directory = memory(); const ownerSession = memory(); const memberSession = memory();
    const owner = createPrototypeAuth(directory, () => start, ownerSession);
    const member = createPrototypeAuth(directory, () => start, memberSession);
    await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft); await member.signup(signup(issued.code));
    const profile = await member.login("new-member", "DemoPass123!");
    owner.setMemberSuspended(profile.accountId!, true);
    await expect(member.login("new-member", "DemoPass123!")).rejects.toThrow("정지");
    owner.setMemberSuspended(profile.accountId!, false);
    expect(member.currentProfile()).toBeNull();
    await expect(member.login("new-member", "DemoPass123!")).resolves.toBeDefined();
    expect(owner.getOwnerOverview().activities.some(a => a.action.includes("정지"))).toBe(true);
  });

  it("blocks third grade and anonymous users at the management methods", async () => {
    const member = auth();
    expect(() => member.getMembers()).toThrow("권한");
    await member.login("admin", "admin1234#");
    await expect(member.createInvitation(draft)).rejects.toThrow("권한");
    expect(() => member.getInvitations()).toThrow("권한");
    expect(() => member.setMemberSuspended("local-preview-2", true)).toThrow("권한");
    expect(() => member.getOwnerOverview()).toThrow("권한");
  });

  it("temporarily throttles invalid code attempts without permanently consuming the code", async () => {
    const owner = auth(); await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft);
    for (let i = 0; i < 10; i++) await owner.checkInvite("invalid");
    const blocked = await owner.checkInvite(issued.code);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("시도");
    const later = createPrototypeAuth(sessionStorage, () => new Date(start.getTime() + 61_000));
    expect((await later.checkInvite(issued.code)).ok).toBe(true);
  });

  it("throttles repeated wrong passwords and permits login after the cooldown", async () => {
    const member = auth();
    for (let i = 0; i < 10; i++) await expect(member.login("admin", "incorrect")).rejects.toThrow();
    await expect(member.login("admin", "admin1234")).rejects.toThrow("시도");
    const later = createPrototypeAuth(sessionStorage, () => new Date(start.getTime() + 61_000));
    await expect(later.login("admin", "admin1234")).resolves.toBeDefined();
  });

  it("rechecks a signup deadline after password derivation", async () => {
    let now = start;
    const owner = createPrototypeAuth(sessionStorage, () => now);
    await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft);
    const pending = owner.signup(signup(issued.code));
    now = new Date(draft.signupExpiresAt);
    await expect(pending).rejects.toThrow("만료");
    expect(owner.getMembers().filter(m => !m.fixed)).toHaveLength(0);
  });

  it("does not let a pending login bypass a new suspension", async () => {
    const directory = memory(); const memberSession = memory();
    const owner = createPrototypeAuth(directory, () => start, memory());
    const member = createPrototypeAuth(directory, () => start, memberSession);
    await owner.login("admin", "admin1234");
    const issued = await owner.createInvitation(draft); await member.signup(signup(issued.code));
    const target = owner.getMembers().find(m => m.username === "new-member")!;
    const pending = member.login("new-member", "DemoPass123!");
    owner.setMemberSuspended(target.id, true);
    await expect(pending).rejects.toThrow("정지");
    expect(member.currentProfile()).toBeNull();
  });

  it("shows the actual annual account expiry on legacy demo invitation rows", async () => {
    const owner = auth(); await owner.login("admin", "admin1234");
    expect(owner.getInvitations().find(i => i.id === "demo-team")?.accessExpiresAt).toBe("2026-11-30T15:00:00.000Z");
    await owner.signup(signup("CHURCH-TEAM-2026"));
    const later = createPrototypeAuth(sessionStorage, () => new Date("2026-12-02T12:00:00+09:00"));
    expect(later.getInvitations().find(i => i.id === "demo-team")?.accessExpiresAt).toBe("2026-11-30T15:00:00.000Z");
  });
});
