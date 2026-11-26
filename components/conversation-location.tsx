"use client";

import { useEffect, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { dataStorage, flushBackendWrites, isBackendConnected } from "@/lib/backend-client";
import { conversationPlaceDetails, isConversationPlaceRecord, maxConversationPlaces, readConversationPlaces, type ConversationPlaceDetails } from "@/lib/conversation-places";
import { privateToolKey, type ConversationScope } from "@/lib/conversation-scope";
import { usableLocation } from "@/lib/location-links";
import { writeBrowserRecord } from "@/lib/storage-status";
import { LocationPanel } from "./location-panel";
import { Button, Field, inputClass } from "./ui";

export function ConversationLocation({ scope }: { scope: ConversationScope }) {
  const key = privateToolKey(scope, "location");
  const [places, setPlaces] = useState<string[]>([]);
  const [details, setDetails] = useState<ConversationPlaceDetails[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => {
      try {
        const raw = dataStorage(localStorage).getItem(key);
        const record: unknown = raw === null ? { location: "" } : JSON.parse(raw);
        setPlaces(readConversationPlaces(record));
        setDetails(isConversationPlaceRecord(record) ? record.details ?? [] : []);
      } catch { setError("이 대화의 장소를 불러오지 못했습니다."); }
    };
    const changed = (event: StorageEvent) => { if (event.key === key) load(); };
    load();
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  const active = selected && places.includes(selected) ? selected : places[0] ?? "";
  const commit = async (next: string[], nextSelected: string | null, clearInput = false, nextDetails = details) => {
    if (busy) return;
    setBusy(true); setSaved(false); setError("");
    try {
      const kept = nextDetails.filter(entry => next.includes(entry.name));
      writeBrowserRecord(dataStorage(localStorage), key, { location: next[0] ?? "", places: next, ...(kept.length ? { details: kept } : {}) }, "browser");
      if (isBackendConnected()) await flushBackendWrites();
      setPlaces(next); setDetails(kept); setSelected(nextSelected);
      if (!isBackendConnected()) window.dispatchEvent(new StorageEvent("storage", { key }));
      if (clearInput) setInput("");
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "장소를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <>
    <form className="location-edit" onSubmit={(event) => {
      event.preventDefault();
      const next = input.trim();
      if (busy || !usableLocation(next) || places.includes(next) || places.length >= maxConversationPlaces) return;
      void commit([...places, next], next, true);
    }}>
      <Field label="장소 추가"><input className={inputClass} value={input} maxLength={180} placeholder="장소명 또는 주소" disabled={busy || places.length >= maxConversationPlaces} onChange={(event) => { setInput(event.target.value); setSaved(false); }} /></Field>
      <Button type="submit" variant="outline" disabled={busy || !usableLocation(input) || places.includes(input.trim()) || places.length >= maxConversationPlaces}><Plus size={15} />추가</Button>
      {error && <p role="alert" className="documents-error">{error}</p>}
      {saved && <p role="status" className="text-xs text-muted-foreground">장소가 저장되었습니다.</p>}
      {places.length >= maxConversationPlaces && <p className="text-xs text-muted-foreground">장소는 최대 {maxConversationPlaces}개까지 저장할 수 있습니다.</p>}
    </form>
    {places.length > 0 && <ul className="location-saved-list" aria-label="저장한 장소">{places.map((place, index) => <li key={place}>
      <button type="button" className="location-saved-name" aria-pressed={active === place} onClick={() => setSelected(place)}>{place}{index === 0 && <small>대표</small>}</button>
      {index !== 0 && <button type="button" className="workspace-icon-button" disabled={busy} aria-label={`${place} 대표로 설정`} title="대표로 설정" onClick={() => void commit([place, ...places.filter(value => value !== place)], place)}><Star size={15} /></button>}
      <button type="button" className="workspace-icon-button" disabled={busy} aria-label={`${place} 삭제`} title="장소 삭제" onClick={() => void commit(places.filter(value => value !== place), active === place ? null : selected)}><Trash2 size={15} /></button>
    </li>)}</ul>}
    <LocationPanel key={active} location={active} details={conversationPlaceDetails(active, details)} onSave={active ? (address, notes) => {
      if (busy) return;
      const filtered = details.filter(entry => entry.name !== active);
      void commit(places, active, false, [...filtered, { name: active, address, notes }]);
    } : undefined} busy={busy} />
  </>;
}
