import { beforeEach, describe, expect, it } from "vitest";
import { createRoomCatalog, validateRoomDraft } from "../lib/room-catalog";
import { roomTiming } from "../lib/room-timing";
import { createPersonalCategories } from "../lib/personal-categories";
import { createInitialState } from "../lib/prototype-state";
import { googleMapsUrl, googleEmbedUrl, usableLocation } from "../lib/location-links";

const profile = { ...createInitialState().profile, accountId: "test-owner", permissions: ["createRoom" as const] };
const draft = { name: "겨울 준비", category: "retreat" as const, date: "2026-11-16", endDate: "2026-11-18", location: "대전광역시 중구 계백로 1700", description: "" };
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("room feedback domain", () => {
  it("validates date range and permits same-day events", () => {
    expect(validateRoomDraft({ ...draft, endDate: "2026-11-15" }).endDate).toContain("종료일");
    expect(validateRoomDraft({ ...draft, date: "", endDate: "2026-11-16" }).date).toBeTruthy();
    expect(validateRoomDraft({ ...draft, endDate: "2026-02-30" }).endDate).toBeTruthy();
    expect(validateRoomDraft({ ...draft, endDate: draft.date })).toEqual({});
    const store = createRoomCatalog(sessionStorage, profile);
    const { room } = store.create(draft);
    expect(room.dateLabel).toBe("2026.11.16 ~ 2026.11.18");
    expect(store.load().rooms.find(r => r.id === room.id)?.endDate).toBe("2026-11-18");
  });
  it("requires a short custom type only for Other", () => {
    expect(validateRoomDraft({ ...draft, category: "other", otherDetail: " " }).otherDetail).toBeTruthy();
    const { room } = createRoomCatalog(sessionStorage, profile).create({ ...draft, category: "other", otherDetail: "성가대 연습" });
    expect(room.otherDetail).toBe("성가대 연습");
  });
  it("loads old rooms without an end date", () => {
    const store = createRoomCatalog(sessionStorage, profile);
    const data = store.load();
    sessionStorage.setItem("church-planner-room-catalog-v1:test-owner", JSON.stringify({ ...data, rooms: data.rooms.map(({ endDate: _, ...r }) => r) }));
    expect(store.load().rooms[0].endDate).toBe(store.load().rooms[0].date);
  });
  it("rejects invalid persisted ranges rather than showing misleading statuses", () => {
    const store = createRoomCatalog(sessionStorage, profile);
    const data = store.load();
    sessionStorage.setItem("church-planner-room-catalog-v1:test-owner", JSON.stringify({ ...data, rooms: data.rooms.map(r => ({ ...r, endDate: "not-a-date" })) }));
    expect(() => store.load()).toThrow("읽지");
  });
  it("derives date status using KST and inclusive end dates", () => {
    const now = new Date("2026-11-15T15:00:00Z");
    expect(roomTiming({ date: null, endDate: null }, now).label).toBe("날짜 미정");
    expect(roomTiming({ date: "2026-11-14", endDate: "2026-11-15" }, now).label).toBe("지난 일정");
    expect(roomTiming({ date: "2026-11-14", endDate: "2026-11-16" }, now).label).toBe("진행 중");
    expect(roomTiming({ date: "2026-11-23", endDate: "2026-11-23" }, now).label).toBe("일정 임박");
    expect(roomTiming({ date: "2026-11-24", endDate: "2026-11-24" }, now).label).toBe("예정 일정");
  });
});
describe("personal categories", () => {
  it("persists personal groups, edits membership, and deletes only the category", () => {
    const store = createPersonalCategories(localStorage, "one");
    const group = store.create("올해 행사", ["a", "b", "a"]);
    expect(store.list()[0].roomIds).toEqual(["a", "b"]);
    store.update(group.id, "내 담당", ["b"]);
    expect(createPersonalCategories(localStorage, "one").list()[0].name).toBe("내 담당");
    expect(createPersonalCategories(localStorage, "two").list()).toEqual([]);
    expect(() => store.create("내 담당", [])).toThrow("같은 이름");
    store.remove(group.id);
    expect(store.list()).toEqual([]);
  });
  it("does not pretend saves worked on quota errors", () => {
    const store = createPersonalCategories({ getItem: () => null, setItem: () => { throw Error("quota"); } }, "one");
    expect(() => store.create("기획", [])).toThrow("저장");
  });
});
describe("Google map links", () => {
  it("encodes addresses and never makes arbitrary user text a link scheme", () => {
    const url = new URL(googleMapsUrl("대전 & 행사", "search")!);
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("query")).toBe("대전 & 행사");
    expect(url.searchParams.get("api")).toBe("1");
    expect(googleMapsUrl("장소 미정", "search")).toBeNull();
    expect(usableLocation("장소 협의 중")).toBe(false);
    expect(new URL(googleMapsUrl("javascript:alert(1)", "directions")!).searchParams.get("destination")).toBe("javascript:alert(1)");
  });
  it("does not generate an embed without a key and uses a fixed Google origin", () => {
    expect(googleEmbedUrl("대전역", "")).toBeNull();
    const url = new URL(googleEmbedUrl("대전역", "test-key")!);
    expect(url.pathname).toBe("/maps/embed/v1/place");
    expect(url.searchParams.get("q")).toBe("대전역");
  });
});
