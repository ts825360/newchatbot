import { beforeEach, describe, expect, it } from "vitest";
import {
  createPrototypeAuth,
  validateSignup,
  type SignupInput
} from "../lib/prototype-auth";

const now = new Date("2026-11-16T12:00:00+09:00");
const valid: SignupInput = {
  inviteCode: "CHURCH-TEAM-2026",
  name: "테스트 담당자",
  username: "church-admin",
  password: "DemoPass123!",
  confirmation: "DemoPass123!"
};

describe("prototype invitation accounts", () => {
  beforeEach(() => sessionStorage.clear());

  it("requires all signup fields and matching passwords", () => {
    expect(validateSignup({ ...valid, name: " " }).name).toBeTruthy();
    expect(validateSignup({ ...valid, username: "ab" }).username).toBeTruthy();
    expect(validateSignup({ ...valid, password: "short" }).password).toBeTruthy();
    expect(validateSignup({ ...valid, confirmation: "different" }).confirmation).toBeTruthy();
    expect(validateSignup(valid)).toEqual({});
  });

  it("rejects unknown invitations", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    expect((await auth.checkInvite("unknown")).ok).toBe(false);
    await expect(auth.signup({ ...valid, inviteCode: "unknown" })).rejects.toThrow("초대코드");
  });

  it("creates an account without signing in and consumes its invitation", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    const account = await auth.signup(valid);
    expect(account.name).toBe(valid.name);
    expect(account.grade).toBe(3);
    expect(account.expiresAt).toBe("2026-11-30T15:00:00.000Z");
    expect(auth.currentProfile()).toBeNull();
    expect((await auth.checkInvite(valid.inviteCode)).ok).toBe(false);
    expect(JSON.stringify(sessionStorage)).not.toContain(valid.password);
  });

  it("rejects duplicate usernames without consuming another invitation", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    await auth.signup(valid);
    await expect(auth.signup({ ...valid, inviteCode: "CHURCH-STAFF-2026", username: "CHURCH-ADMIN" }))
      .rejects.toThrow("사용 중인 아이디");
    expect((await auth.checkInvite("CHURCH-STAFF-2026")).ok).toBe(true);
  });

  it("supports login after constructing a new adapter and clears only the session on logout", async () => {
    await createPrototypeAuth(sessionStorage, () => now).signup(valid);
    const auth = createPrototypeAuth(sessionStorage, () => now);
    const profile = await auth.login(" CHURCH-ADMIN ", valid.password);
    expect(profile.nickname).toBe(valid.name);
    expect(auth.currentProfile()?.nickname).toBe(valid.name);
    auth.logout();
    expect(auth.currentProfile()).toBeNull();
    await expect(auth.login(valid.username, valid.password)).resolves.toBeDefined();
  });

  it("rejects unknown accounts and incorrect passwords", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    await auth.signup(valid);
    await expect(auth.login(valid.username, "wrong-password")).rejects.toThrow("아이디 또는 비밀번호");
    await expect(auth.login("unknown", valid.password)).rejects.toThrow("아이디 또는 비밀번호");
  });

  it("expires third-grade accounts and existing sessions at December 1 in Korea", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    await auth.signup(valid);
    await auth.login(valid.username, valid.password);
    const later = createPrototypeAuth(sessionStorage, () => new Date("2026-12-01T00:00:00+09:00"));
    expect(later.currentProfile()).toBeNull();
    await expect(later.login(valid.username, valid.password)).rejects.toThrow("만료");
  });

  it("keeps second grade accounts without annual expiry", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    for (const [inviteCode, username, grade] of [
      ["CHURCH-STAFF-2026", "staff", 2]
    ] as const) {
      const account = await auth.signup({ ...valid, inviteCode, username });
      expect(account.grade).toBe(grade);
      expect(account.expiresAt).toBeNull();
    }
  });

  it("supports the fixed local preview login at each grade without signup", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    const ids = new Set<string | undefined>();
    for (const [password, grade] of [["admin1234", 1], ["admin1234@", 2], ["admin1234#", 3]] as const) {
      const profile = await auth.login("admin", password);
      expect(profile.role).toBe(`제${grade}관리자`);
      expect(createPrototypeAuth(sessionStorage, () => now).currentProfile()?.role).toBe(profile.role);
      ids.add(profile.accountId);
      auth.logout();
      expect(auth.currentProfile()).toBeNull();
    }
    expect(ids.size).toBe(3);
    await expect(auth.login("admin", "wrong-password")).rejects.toThrow("아이디 또는 비밀번호");
  });

  it("blocks first-grade signup and reserves the preview username", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    expect((await auth.checkInvite("CHURCH-OWNER-2026")).ok).toBe(false);
    await expect(auth.signup({ ...valid, inviteCode: "CHURCH-OWNER-2026" })).rejects.toThrow("초대코드");
    await expect(auth.signup({ ...valid, username: "ADMIN" })).rejects.toThrow("아이디");
  });

  it("rejects previously registered first-grade accounts and their old sessions", async () => {
    const auth = createPrototypeAuth(sessionStorage, () => now);
    await auth.signup(valid);
    await auth.login(valid.username, valid.password);
    const raw = JSON.parse(sessionStorage.getItem("church-planner-demo-auth-v1")!);
    raw.accounts[0].grade = 1;
    sessionStorage.setItem("church-planner-demo-auth-v1", JSON.stringify(raw));
    expect(auth.currentProfile()).toBeNull();
    await expect(auth.login(valid.username, valid.password)).rejects.toThrow("이용할 수 없는 계정");
  });

  it("treats malformed browser storage as empty without crashing", async () => {
    sessionStorage.setItem("church-planner-demo-auth-v1", "{broken");
    const auth = createPrototypeAuth(sessionStorage, () => now);
    expect(auth.currentProfile()).toBeNull();
    expect((await auth.checkInvite(valid.inviteCode)).ok).toBe(true);
  });

  it("reports unavailable storage instead of pretending signup succeeded", async () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => { throw new Error("blocked"); }
    };
    const auth = createPrototypeAuth(unavailable, () => now);
    await expect(auth.signup(valid)).rejects.toThrow("브라우저 저장소");
  });
});
