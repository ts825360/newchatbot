import { beforeEach, expect, it, vi } from "vitest";
import { createPreparationStore, sampleProposals } from "../lib/preparation-store";
import { createInitialState } from "../lib/prototype-state";
import { getStorageStatus, subscribeStorageStatus, writeBrowserRecord } from "../lib/storage-status";

beforeEach(() => localStorage.clear());

it("persists calendar changes, validates input, deduplicates retries and isolates rooms", () => {
  const event = createInitialState().events["summer-retreat-2026"][0];
  const store = createPreparationStore(localStorage, "a", [event]);
  store.saveEvent({ ...event, title: "수정한 일정" });
  store.saveEvent({ ...event, title: "수정한 일정" });
  expect(store.loadEvents()).toHaveLength(1);
  expect(createPreparationStore(localStorage, "a").loadEvents()[0].title).toBe("수정한 일정");
  expect(createPreparationStore(localStorage, "b").loadEvents()).toEqual([]);
  expect(() => store.saveEvent({ ...event, date: "2026-02-30" })).toThrow("날짜");
  expect(() => store.saveEvent({ ...event, title: " " })).toThrow("제목");
  expect(() => store.saveEvent({ ...event, linkUrl: "javascript:alert(1)" })).toThrow("링크");
  store.deleteEvent(event.id);
  expect(createPreparationStore(localStorage, "a", [event]).loadEvents()).toEqual([]);
  expect(() => store.saveEvent(event, true)).toThrow("삭제");
});

it("saves proposal decisions and requires an exclusion reason", () => {
  const store = createPreparationStore(localStorage, "a");
  expect(() => store.decide("vehicle", "excluded", "")).toThrow("사유");
  store.decide("vehicle", "deferred");
  expect(store.loadDecisions()[0].status).toBe("deferred");
  store.decide("vehicle", "excluded", "이번에는 차량 이동 없음");
  expect(store.loadDecisions()).toHaveLength(1);
  expect(store.loadDecisions()[0].reason).toBe("이번에는 차량 이동 없음");
  store.decide("vehicle", "pending");
  expect(store.loadDecisions()[0].status).toBe("pending");
  expect(sampleProposals({ id: "a", date: null })[1].date).toBe("");
});

it("reports malformed data and failed writes without altering the stored record", () => {
  const bad = createPreparationStore({ getItem: () => "{bad", setItem: vi.fn() }, "a");
  expect(() => bad.loadEvents()).toThrow("읽지");
  const event = createInitialState().events["summer-retreat-2026"][0];
  const blocked = createPreparationStore({ getItem: () => null, setItem: () => { throw Error("quota"); } }, "a", [event]);
  expect(() => blocked.saveEvent(event)).toThrow("저장");
  expect(blocked.loadEvents()).toEqual([event]);
});

it("emits saving/saved/failed states with accurate browser storage scope", () => {
  const observed: string[] = [];
  const unsubscribe = subscribeStorageStatus(() => observed.push(getStorageStatus().phase));
  writeBrowserRecord(localStorage, "test", { value: 1 }, "browser");
  expect(observed).toEqual(["saving", "saved"]);
  expect(getStorageStatus().scope).toBe("browser");
  expect(() => writeBrowserRecord({ setItem: () => { throw Error("quota"); } }, "test", {}, "tab")).toThrow();
  expect(getStorageStatus()).toMatchObject({ phase: "failed", scope: "tab" });
  unsubscribe();
});
