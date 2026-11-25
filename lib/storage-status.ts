export type StorageScope = "tab" | "browser" | "server";
export type StorageStatus = { phase: "idle" | "saving" | "saved" | "failed"; scope: StorageScope; at: number };
const initial: StorageStatus = { phase: "idle", scope: "browser", at: 0 };
let latest = initial;
const listeners = new Set<() => void>();
export const getStorageStatus = () => latest;
export const getServerStorageStatus = () => initial;
export function subscribeStorageStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function markStorageStatus(phase: StorageStatus["phase"], scope: StorageScope = "browser") {
  latest = { phase, scope, at: Date.now() };
  listeners.forEach(listener => listener());
}
export function writeBrowserRecord(storage: Pick<Storage, "setItem">, key: string, value: unknown, scope: StorageScope) {
  if ((storage as { __serverManaged?: boolean }).__serverManaged) { storage.setItem(key, JSON.stringify(value)); return; }
  markStorageStatus("saving", scope);
  try { storage.setItem(key, JSON.stringify(value)); }
  catch (cause) { markStorageStatus("failed", scope); throw cause; }
  markStorageStatus("saved", scope);
}
