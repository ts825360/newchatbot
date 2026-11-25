import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "./types";
import { isCalendarStatus } from "./calendar-status";
import { normalizeCalendarTime, resolveCalendarHours } from "./calendar-time";
import { validDate } from "./room-timing";
import { writeBrowserRecord } from "./storage-status";
import { dataStorage, hasBackendRecord, isBackendConnected } from "./backend-client";
import { privateToolKey, type ConversationScope } from "./conversation-scope";

export type ProposalDraft = { id: string; kind: "checklist" | "calendar"; title: string; date: string; sourceTitle: string; excerpt: string; origin?: "assistant" | "preparation" };
export type ProposalDecision = { id: string; status: "pending" | "accepted" | "deferred" | "excluded"; reason: string; title?: string; date?: string };
export type ProposalApplyResult = boolean | { ok: boolean; applied?: ProposalDraft; recovered?: boolean; error?: string };
export const PREPARATION_CHANGED_EVENT = "church-preparation-changed";
type BrowserStorage = Pick<Storage, "getItem" | "setItem">;
export function sampleProposals(room: { id: string; date?: string | null }): ProposalDraft[] {
  return [
    { id: "sample-vehicle", kind: "checklist", title: "차량 배정표 작성", date: "", sourceTitle: "회의록 예시", excerpt: "차량 배정표 작성" },
    { id: "sample-gathering", kind: "calendar", title: "교회 집합 일정", date: room.date || "", sourceTitle: "회의록 예시", excerpt: "교회 집합 일정" }
  ];
}
export function validateCalendarEvent(event: CalendarEvent): string {
  if (!event.title.trim() || event.title.trim().length > 120) return "일정 제목은 1~120자로 입력해 주세요.";
  if (!validDate(event.date)) return "올바른 날짜를 입력해 주세요.";
  if (event.endTime !== undefined) {
    if (typeof event.endTime !== "string") return "종료 시간을 확인해 주세요.";
    if (normalizeCalendarTime(event.time) === "" && normalizeCalendarTime(event.endTime)) return "종료 시간을 지정하려면 시작 시간을 선택해 주세요.";
    if (!resolveCalendarHours(event.time, event.endTime)) return "종료 시간은 시작 시간보다 늦어야 합니다.";
  }
  if (event.linkUrl) {
    try { if (!["http:", "https:"].includes(new URL(event.linkUrl).protocol)) return "링크는 http 또는 https 주소만 입력해 주세요."; }
    catch { return "올바른 링크 주소를 입력해 주세요."; }
  }
  return "";
}
function isEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "title", "date", "time", "location", "memo", "author", "lastEditor", "changeLog"].every(key => typeof item[key] === "string")
    && !!item.id && isCalendarStatus(item.status)
    && ["linkUrl", "linkLabel"].every(key => item[key] === undefined || typeof item[key] === "string")
    && !validateCalendarEvent(value as CalendarEvent);
}
function isDecision(value: unknown): value is ProposalDecision {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && !!item.id && ["pending", "accepted", "deferred", "excluded"].includes(item.status as string)
    && typeof item.reason === "string" && (item.status !== "excluded" || !!item.reason.trim())
    && (item.title === undefined || typeof item.title === "string")
    && (item.date === undefined || item.date === "" || (typeof item.date === "string" && validDate(item.date)));
}
export function createPreparationStore(storage: BrowserStorage, roomId: string, seedEvents: CalendarEvent[] = [], scope?: ConversationScope) {
  storage = dataStorage(storage);
  const prefix = `church-preparation-v1:${encodeURIComponent(roomId)}:`;
  const eventsKey = prefix + "events";
  const decisionsKey = scope ? privateToolKey(scope, "decisions") : prefix + "decisions";
  function load<T extends { id: string }>(key: string, seed: T[], validate: (item: unknown) => item is T): T[] {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return seed.map(item => ({ ...item }));
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.items) || !data.items.every(validate) || new Set(data.items.map((item: T) => item.id)).size !== data.items.length) throw Error();
      return data.items;
    } catch { throw new Error("준비 정보를 읽지 못했습니다. 저장된 데이터를 확인해 주세요."); }
  }
  function save<T>(key: string, items: T[]) {
    try { writeBrowserRecord(storage, key, { version: 1, items }, "browser"); }
    catch { throw new Error("저장하지 못했습니다. 사이트 저장소와 저장 공간을 확인해 주세요."); }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PREPARATION_CHANGED_EVENT, { detail: { key } }));
    return items;
  }
  const loadEvents = () => load(eventsKey, seedEvents, isEvent);
  const loadDecisions = () => load(decisionsKey, [], isDecision);
  return {
    eventsKey, decisionsKey, loadEvents, loadDecisions,
    saveEvent(event: CalendarEvent, requireExisting = false) {
      const error = validateCalendarEvent(event);
      if (error) throw new Error(error);
      if (!isEvent(event)) throw new Error("일정 정보를 확인해 주세요.");
      const items = loadEvents();
      if (requireExisting && !items.some(item => item.id === event.id)) throw new Error("이미 삭제된 일정입니다. 편집을 닫고 다시 확인해 주세요.");
      return save(eventsKey, items.some(item => item.id === event.id) ? items.map(item => item.id === event.id ? { ...event, title: event.title.trim() } : item) : [...items, { ...event, title: event.title.trim() }]);
    },
    deleteEvent(id: string) { return save(eventsKey, loadEvents().filter(item => item.id !== id)); },
    decide(id: string, status: ProposalDecision["status"], reason = "", title?: string, date?: string) {
      if (status === "excluded" && !reason.trim()) throw new Error("제외 사유를 입력해 주세요.");
      const next = { id, status, reason: reason.trim(), title, date };
      if (!isDecision(next)) throw new Error("처리 상태를 확인해 주세요.");
      return save(decisionsKey, [...loadDecisions().filter(item => item.id !== id), next]);
    }
  };
}

export function usePreparationEvents(roomId: string, seedEvents: CalendarEvent[]) {
  const seed = useRef(seedEvents); seed.current = seedEvents;
  const [snapshot, setSnapshot] = useState<{ roomId: string; events: CalendarEvent[]; error: string }>({ roomId: "", events: [], error: "" });
  useEffect(() => {
    const reload = () => {
      try { setSnapshot({ roomId, events: createPreparationStore(localStorage, roomId, seed.current).loadEvents(), error: "" }); }
      catch (cause) { setSnapshot(previous => ({ roomId, events: previous.roomId === roomId ? previous.events : [], error: (cause as Error).message })); }
    };
    const onChange = (event: Event) => {
      if (event instanceof StorageEvent && event.storageArea && event.storageArea !== localStorage) return;
      const key = event instanceof StorageEvent ? event.key : (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key == null || key.startsWith(`church-preparation-v1:${encodeURIComponent(roomId)}:`)) reload();
    };
    reload(); window.addEventListener("storage", onChange); window.addEventListener(PREPARATION_CHANGED_EVENT, onChange);
    return () => { window.removeEventListener("storage", onChange); window.removeEventListener(PREPARATION_CHANGED_EVENT, onChange); };
  }, [roomId]);
  const mutate = (operation: (store: ReturnType<typeof createPreparationStore>) => void) => {
    try { operation(createPreparationStore(localStorage, roomId, seed.current)); return true; }
    catch (cause) { setSnapshot(previous => ({ ...previous, error: (cause as Error).message })); return false; }
  };
  const loaded = snapshot.roomId === roomId && (!isBackendConnected() || hasBackendRecord(`church-preparation-v1:${encodeURIComponent(roomId)}:events`));
  return { loaded, events: snapshot.roomId === roomId ? snapshot.events : [], error: snapshot.roomId === roomId ? snapshot.error : "",
    saveEvent: (event: CalendarEvent, requireExisting = false) => mutate(store => { store.saveEvent(event, requireExisting); }),
    deleteEvent: (id: string) => mutate(store => { store.deleteEvent(id); }) };
}
