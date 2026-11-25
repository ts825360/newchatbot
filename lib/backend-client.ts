import type { ServerRecord, ServerSnapshot, ServerWrite } from "./backend-contract";
import type { UserProfile } from "./types";
import { markStorageStatus } from "./storage-status";
import type { ConversationScope } from "./conversation-scope";

export class BackendError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}
type Draft = { value: string; version: string; sequence: number };
type State = { connected: boolean; phase: "idle" | "saving" | "saved" | "failed"; pending: number; error: string; userId: string | null };
let connected = false;
let profile: UserProfile | null = null;
let epoch = 0; let sequence = 0;
let state: State = { connected: false, phase: "idle", pending: 0, error: "", userId: null };
const records = new Map<string, ServerRecord>();
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | null = null;
let followedConversation: ConversationScope | null = null;

const emitAuth = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("church-auth-changed")); };
const emitRecord = (key: string) => { if (typeof window !== "undefined") window.dispatchEvent(new StorageEvent("storage", { key })); };
function publish(phase: State["phase"] = state.phase, error = state.error) {
  state = { connected, phase, pending: drafts.size, error, userId: profile?.accountId ?? null };
  if (connected) markStorageStatus(phase === "idle" ? "idle" : phase, "server");
  listeners.forEach((listener) => listener());
}
export const subscribeBackend = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getBackendState = () => state;
const serverState: State = { connected: false, phase: "idle", pending: 0, error: "", userId: null };
export const getBackendServerState = () => serverState;
export const isBackendConnected = () => connected;
export const getBackendProfile = () => profile;
export const hasBackendRecord = (key: string) => records.has(key);
export function enableBackendConnection(value: boolean) { connected = value; publish(); }
export function configureBackendUser(next: UserProfile | null) {
  const changed = JSON.stringify(profile) !== JSON.stringify(next);
  if (!changed) return;
  if (profile?.accountId !== next?.accountId) { epoch++; records.clear(); drafts.clear(); clearTimeout(timer); timer = undefined; inFlight = null; followedConversation = null; }
  profile = next; publish(next ? (drafts.size ? "saving" : "idle") : "idle", "");
  if (changed) emitAuth();
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<any> {
  const requestEpoch = epoch;
  let response: Response;
  try { response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" }); }
  catch { throw new BackendError("서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요."); }
  let data: any;
  try { data = await response.json(); } catch { throw new BackendError("서버 응답을 읽지 못했습니다.", response.status); }
  if (!response.ok) {
    if (response.status === 401 && requestEpoch === epoch) configureBackendUser(null);
    throw new BackendError(typeof data?.error === "string" ? data.error : "서버 요청이 거절되었습니다.", response.status);
  }
  return data;
}

function catalogKey() { return profile?.accountId ? `church-planner-room-catalog-v1:${profile.accountId}` : ""; }
function selectedRoom(): string | undefined {
  try { const value = JSON.parse(records.get(catalogKey())?.value ?? "null"); return typeof value?.selectedRoomId === "string" ? value.selectedRoomId : undefined; } catch { return undefined; }
}
function mergeValue(record: ServerRecord): string | null {
  if (record.key !== catalogKey() || !record.value) return record.value;
  try {
    const current = JSON.parse(records.get(record.key)?.value ?? "null");
    const next = JSON.parse(record.value);
    if (current?.selectedRoomId) next.selectedRoomId = next.rooms.some((room: { id: string }) => room.id === current.selectedRoomId) ? current.selectedRoomId : null;
    return JSON.stringify(next);
  } catch { return record.value; }
}
function validRecord(value: unknown): value is ServerRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as ServerRecord;
  return typeof r.key === "string" && r.key.length < 500 && typeof r.version === "string" && r.version.length < 80 && (r.value === null || typeof r.value === "string" && r.value.length <= 2_000_000);
}
function isOlder(version: string, previous: string) {
  const left = version.split(":").map(Number); const right = previous.split(":").map(Number);
  return left.length === right.length && left.every(Number.isSafeInteger) && right.every(Number.isSafeInteger) && left.some((n, i) => n < right[i]);
}
function hydrate(snapshot: ServerSnapshot, acknowledged = new Map<string, number>()) {
  if (!snapshot || !Array.isArray(snapshot.records) || !snapshot.records.every(validRecord) || (snapshot.written && (!Array.isArray(snapshot.written) || !snapshot.written.every(validRecord)))) throw new BackendError("서버 자료 형식이 올바르지 않습니다.");
  if (snapshot.profile.accountId !== profile?.accountId) throw new BackendError("접속 계정이 변경되었습니다. 다시 로그인해 주세요.", 401);
  const changed: string[] = [];
  const acknowledgedKeys = new Set<string>();
  for (const record of snapshot.written ?? []) {
    acknowledgedKeys.add(record.key);
    const draft = drafts.get(record.key);
    if (draft && draft.sequence === acknowledged.get(record.key)) drafts.delete(record.key);
    else if (draft && acknowledged.has(record.key)) draft.version = record.version;
    const value = drafts.get(record.key)?.value ?? mergeValue(record);
    records.set(record.key, { ...record, value }); changed.push(record.key);
  }
  for (const record of snapshot.records) {
    if (acknowledgedKeys.has(record.key)) continue;
    const current = records.get(record.key);
    if (current && isOlder(record.version, current.version)) continue;
    const draft = drafts.get(record.key);
    if (draft) {
      if (record.version !== draft.version && !acknowledged.has(record.key)) publish("failed", "다른 기기에서 같은 자료를 수정했습니다. 내 변경을 보관하고 서버 자료를 다시 확인해 주세요.");
      continue;
    }
    const value = mergeValue(record);
    const previous = records.get(record.key);
    if (!previous || previous.version !== record.version || previous.value !== value) changed.push(record.key);
    records.set(record.key, { ...record, value });
  }
  changed.forEach(emitRecord);
}

export function followBackendConversation(scope: ConversationScope) {
  followedConversation = scope;
  return () => { if (followedConversation === scope) followedConversation = null; };
}

export async function refreshBackendData(roomOverride?: string, conversationOverride?: string | null): Promise<void> {
  if (!connected || !profile) return;
  const currentEpoch = epoch;
  const room = roomOverride ?? selectedRoom();
  const conversation = conversationOverride === undefined
    ? followedConversation?.accountId === profile.accountId && followedConversation?.roomId === room ? followedConversation?.conversationId : undefined
    : conversationOverride;
  const path = `/api/data${room ? `?roomId=${encodeURIComponent(room)}` : ""}`;
  let snapshot: ServerSnapshot;
  try { snapshot = await backendFetch(path + (room && conversation ? `&conversationId=${encodeURIComponent(conversation)}` : "")); }
  catch (error) {
    if (currentEpoch !== epoch) return;
    if (error instanceof BackendError && error.status === 404 && room && typeof conversationOverride !== "string") {
      if (conversation) return refreshBackendData(room, null);
      snapshot = await backendFetch("/api/data");
    }
    else throw error;
  }
  if (currentEpoch !== epoch) return;
  hydrate(snapshot);
  if (state.phase !== "failed") publish(drafts.size ? "saving" : "saved", "");
}

const remoteStorage = {
  __serverManaged: true,
  getItem(key: string): string | null {
    if (!profile) throw new BackendError("로그인이 필요합니다.", 401);
    return records.get(key)?.value ?? null;
  },
  setItem(key: string, value: string) {
    if (!profile) throw new BackendError("로그인이 필요합니다.", 401);
    if (!records.has(key)) throw new BackendError("아직 서버에서 불러오지 않은 자료입니다. 새로고침 후 다시 시도해 주세요.");
    if (value.length > 2_000_000) throw new BackendError("자료 크기가 너무 큽니다.");
    const previous = records.get(key)!;
    const existing = drafts.get(key);
    drafts.set(key, { value, version: existing?.version ?? previous.version, sequence: ++sequence });
    records.set(key, { ...previous, value });
    publish("saving", "");
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void flushBackendWrites().catch(() => {}); }, 200);
  },
};

export function dataStorage<T extends Pick<Storage, "getItem" | "setItem">>(fallback: T): Pick<Storage, "getItem" | "setItem"> {
  return connected ? remoteStorage : fallback;
}

export function flushBackendWrites(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  if (!connected || !drafts.size) return inFlight ?? Promise.resolve();
  if (inFlight) return inFlight;
  const currentEpoch = epoch;
  const run = (async () => {
    try {
      while (drafts.size && currentEpoch === epoch) {
        publish("saving", "");
        const batch = new Map([...drafts].map(([key, value]) => [key, { ...value }]));
        const writes: ServerWrite[] = [...batch].map(([key, draft]) => ({ key, value: draft.value, version: draft.version }));
        const snapshot = await backendFetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writes, roomId: selectedRoom() }) });
        if (currentEpoch !== epoch) return;
        const writtenKeys = new Set((snapshot.written ?? []).map((r: ServerRecord) => r.key));
        if (writes.some((w) => !writtenKeys.has(w.key))) throw new BackendError("서버 저장 확인이 누락되었습니다. 다시 확인해 주세요.");
        hydrate(snapshot, new Map([...batch].map(([key, draft]) => [key, draft.sequence])));
      }
      if (currentEpoch === epoch) publish("saved", "");
    } catch (cause) {
      if (currentEpoch === epoch) publish("failed", cause instanceof Error ? cause.message : "서버에 저장하지 못했습니다.");
      throw cause;
    }
  })();
  inFlight = run;
  void run.finally(() => { if (inFlight === run) inFlight = null; }).catch(() => {});
  return run;
}

export function exportBackendDrafts(): string { return JSON.stringify([...drafts].map(([key, d]) => ({ key, value: d.value, baseVersion: d.version })), null, 2); }
export async function discardBackendWrites(): Promise<void> {
  if (inFlight) { try { await inFlight; } catch { /* The user explicitly chose to replace failed drafts. */ } }
  const room = selectedRoom();
  drafts.clear(); records.clear(); publish("idle", ""); await refreshBackendData(room);
}
export function resetBackendClient() { epoch++; connected = false; profile = null; followedConversation = null; records.clear(); drafts.clear(); clearTimeout(timer); timer = undefined; inFlight = null; publish("idle", ""); }
