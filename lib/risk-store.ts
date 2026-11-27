import { useEffect, useState } from "react";
import type { RiskAlert } from "./types";
import { dataStorage } from "./backend-client";
import { writeBrowserRecord } from "./storage-status";
import { privateToolKey, type ConversationScope } from "./conversation-scope";

export function useRoomRisks(roomId: string, seed: RiskAlert[], scope?: ConversationScope | null) {
  const key = scope === null ? "" : scope ? privateToolKey(scope, "risks") : `church-risks-v1:${encodeURIComponent(roomId)}`;
  const [value, setValue] = useState<{ key: string; items: RiskAlert[]; error: string; recorded: boolean }>({ key, items: seed, error: "", recorded: seed.length > 0 });
  const load = (): { items: RiskAlert[]; recorded: boolean } => {
    const raw = dataStorage(localStorage).getItem(key);
    if (!raw) return { items: seed, recorded: seed.length > 0 };
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.items)) throw new Error("주의 항목을 읽지 못했습니다.");
    return { items: data.items, recorded: true };
  };
  useEffect(() => {
    if (!key) return;
    const reload = () => { try { setValue({ key, ...load(), error: "" }); } catch (e) { setValue({ key, items: [], error: (e as Error).message, recorded: false }); } };
    const changed = (event: StorageEvent) => { if (!event.key || event.key === key) reload(); };
    reload(); window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [key]);
  return { risks: key && value.key === key ? value.items : [], error: key && value.key === key ? value.error : "", reviewed: !!key && value.key === key && value.recorded, resolve(id: string) {
    if (!key) return false;
    try {
      const items = load().items.map((item) => item.id === id ? { ...item, resolved: true } : item);
      writeBrowserRecord(dataStorage(localStorage), key, { version: 1, items }, "browser");
      setValue({ key, items, error: "", recorded: true }); return true;
    } catch (e) { setValue((v) => ({ ...v, error: (e as Error).message })); return false; }
  } };
}
