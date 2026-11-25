import { beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "../lib/prototype-state";
import { createRoomCatalog, filterRooms, validateRoomDraft, type RoomDraft } from "../lib/room-catalog";
import type { UserProfile } from "../lib/types";

const owner: UserProfile = { ...createInitialState().profile, accountId: "owner-1", permissions: ["viewRoom", "createRoom", "admin"] };
const draft: RoomDraft = { name: "2027 청년 수련회", category: "retreat", date: "2027-08-15", location: "교회", description: "여름 수련회 준비" };

beforeEach(() => sessionStorage.clear());

describe("per-account room catalog", () => {
  it("edits room details while preserving identity, membership and selection", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    const { room } = store.create(draft);
    store.enter(room.id);
    const updated = store.update(room.id, { ...draft, name: "변경된 수련회", date: "2027-08-16", endDate: "2027-08-18", location: "새 장소" });
    const saved = updated.rooms.find(item => item.id === room.id)!;
    expect(saved).toMatchObject({ id: room.id, ownerId: room.ownerId, memberCount: room.memberCount, createdAt: room.createdAt, name: "변경된 수련회", date: "2027-08-16", endDate: "2027-08-18" });
    expect(updated.selectedRoomId).toBe(room.id);
    expect(store.load().rooms.find(item => item.id === room.id)?.location).toBe("새 장소");
    expect(() => store.update(room.id, { ...draft, date: "2027-08-18", endDate: "2027-08-17" })).toThrow("종료일");
    expect(() => store.update("missing", draft)).toThrow("찾을 수");
    expect(() => createRoomCatalog(sessionStorage, { ...owner, permissions: ["viewRoom"] }).update(room.id, draft)).toThrow("권한");
    const second = store.create({ ...draft, name: "두 번째 방" });
    expect(() => store.update(second.room.id, { ...draft, name: "변경된 수련회" })).toThrow("같은 이름");
  });
  it("seeds existing accessible rooms without selecting one", () => {
    const catalog = createRoomCatalog(sessionStorage, owner).load();
    expect(catalog.rooms).toHaveLength(owner.roomIds.length);
    expect(catalog.selectedRoomId).toBeNull();
    expect(catalog.rooms[0].category).toBe("retreat");
  });

  it("validates names, categories, and real calendar dates", () => {
    expect(validateRoomDraft({ ...draft, name: " " }).name).toBeTruthy();
    expect(validateRoomDraft({ ...draft, date: "2027-02-30" }).date).toBeTruthy();
    expect(validateRoomDraft({ ...draft, category: "invalid" as RoomDraft["category"] }).category).toBeTruthy();
    expect(validateRoomDraft(draft)).toEqual({});
  });

  it("creates a room with an empty participant team and persists it on reload", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    const created = store.create(draft);
    expect(created.room.name).toBe(draft.name);
    expect(created.room.memberCount).toBe(1);
    expect(created.room.ownerId).toBe(owner.accountId);
    expect(createRoomCatalog(sessionStorage, owner).load().rooms.some((room) => room.id === created.room.id)).toBe(true);
    expect(created.catalog.selectedRoomId).toBeNull();
  });

  it("supports rooms whose date has not been decided", () => {
    const { room } = createRoomCatalog(sessionStorage, owner).create({ ...draft, date: "" });
    expect(room.status).toBe("needsDate");
    expect(room.date).toBeNull();
  });

  it("rejects duplicate names and disallows mutations without room-management permission", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    const { room } = store.create(draft);
    expect(() => store.create(draft)).toThrow("같은 이름");
    const member = createRoomCatalog(sessionStorage, { ...owner, permissions: ["viewRoom"] });
    expect(() => member.create({ ...draft, name: "다른 방" })).toThrow("권한");
    expect(() => member.delete(room.id)).toThrow("권한");
  });

  it("selects only an existing room and clears deleted selection", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    const { room } = store.create(draft);
    expect(store.enter(room.id).selectedRoomId).toBe(room.id);
    expect(() => store.enter("missing")).toThrow("행사방");
    expect(store.delete(room.id).selectedRoomId).toBeNull();
    expect(store.load().rooms.some((item) => item.id === room.id)).toBe(false);
  });

  it("preserves an intentionally empty catalog", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    for (const room of store.load().rooms) store.delete(room.id);
    expect(createRoomCatalog(sessionStorage, owner).load().rooms).toEqual([]);
  });

  it("preserves pinning, order and cleared unread counts across session rechecks", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    const data = store.load();
    const first = data.rooms[0];
    expect(store.enter(first.id).rooms.find((room) => room.id === first.id)?.unreadChanges).toBe(0);
    const rooms = [...store.load().rooms].reverse().map((room) => ({ ...room, pinned: false }));
    store.savePreferences(rooms);
    const restored = createRoomCatalog(sessionStorage, owner).load();
    expect(restored.rooms.map((room) => room.id)).toEqual(rooms.map((room) => room.id));
    expect(restored.rooms.find((room) => room.id === first.id)?.pinned).toBe(false);
    expect(restored.rooms.find((room) => room.id === first.id)?.unreadChanges).toBe(0);
    expect(() => store.savePreferences([])).toThrow("변경");
  });

  it("keeps different accounts independent, including accounts with the same display name", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    store.create(draft);
    const other = createRoomCatalog(sessionStorage, { ...owner, accountId: "owner-2" });
    expect(other.load().rooms.some((room) => room.name === draft.name)).toBe(false);
  });

  it("appends new favorites after the current favorites and never pins rooms for another account", () => {
    const mine = createRoomCatalog(sessionStorage, owner);
    const [a, b, c] = mine.load().rooms;
    mine.togglePin(c.id); mine.togglePin(a.id); mine.enter(b.id);
    expect(mine.load().rooms.filter(room => room.pinned).map(room => room.id)).toEqual([c.id, a.id]);
    expect(createRoomCatalog(sessionStorage, { ...owner, accountId: "other" }).load().rooms.filter(room => room.pinned)).toEqual(mine.load().rooms.filter(room => room.pinned && room.id !== c.id && room.id !== a.id));
    mine.togglePin(c.id); mine.togglePin(c.id);
    expect(mine.load().rooms.filter(room => room.pinned).map(room => room.id)).toEqual([a.id, c.id]);
  });

  it("filters by search and category without mutating the catalog", () => {
    const store = createRoomCatalog(sessionStorage, owner);
    store.create(draft);
    const rooms = store.load().rooms;
    expect(filterRooms(rooms, "2027 청년", "retreat", "recent")).toHaveLength(1);
    expect(filterRooms(rooms, "2027 청년", "sports", "recent")).toHaveLength(0);
    expect(rooms).toHaveLength(owner.roomIds.length + 1);
  });

  it("reports read/write failures without pretending a mutation succeeded", () => {
    const blocked = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => createRoomCatalog(blocked, owner).create(draft)).toThrow("저장");
    const broken = { getItem: () => "{broken", setItem: () => undefined };
    expect(() => createRoomCatalog(broken, owner).load()).toThrow("읽지");
  });
});
