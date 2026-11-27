"use client";

import { ChevronLeft, ChevronRight, MapPin, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dataStorage, flushBackendWrites, isBackendConnected } from "@/lib/backend-client";
import { appendConversationPlace, conversationPlaceCategories, conversationPlaceDetails, isConversationPlaceRecord, maxConversationPlaces, orderConversationPlaces, placeSearchKey, readConversationPlaces, type ConversationPlaceCategory, type ConversationPlaceRecord } from "@/lib/conversation-places";
import { privateToolKey, scopeId, type ConversationScope } from "@/lib/conversation-scope";
import { writeBrowserRecord } from "@/lib/storage-status";
import { LocationActions, LocationDialog } from "./location-actions";
import { LocationLabels, LocationMemo, LocationPanel, type LocationEdits } from "./location-panel";
import { LocationDiscovery, type PlaceWorkspaceAction } from "./location-discovery";
import { Button, Field, inputClass } from "./ui";

export function ConversationLocation({ scope, expanded }: { scope: ConversationScope; expanded?: boolean }) {
  return <SavedPlaces key={scopeId(scope)} scope={scope} expanded={expanded} />;
}

function SavedPlaces({ scope, expanded: layout }: { scope: ConversationScope; expanded?: boolean }) {
  const key = privateToolKey(scope, "location");
  const node = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pending = useRef(false);
  const [observedExpanded, setObservedExpanded] = useState(false);
  const expanded = layout ?? observedExpanded;
  const [record, setRecord] = useState<ConversationPlaceRecord | null>(null);
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConversationPlaceCategory | "all" | "unsorted">("all");
  const [detail, setDetail] = useState("");
  const [action, setAction] = useState<PlaceWorkspaceAction>();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (layout !== undefined) return;
    const owner = node.current?.closest<HTMLElement>("[data-size]");
    if (!owner) return;
    const measure = () => setObservedExpanded(owner.dataset.size === "expanded");
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(owner, { attributes: true, attributeFilter: ["data-size"] });
    return () => observer.disconnect();
  }, [layout]);
  const load = (): ConversationPlaceRecord => {
    const raw = dataStorage(localStorage).getItem(key);
    const value: unknown = raw === null ? { location: "" } : JSON.parse(raw);
    if (!isConversationPlaceRecord(value)) throw new Error("저장 형식 오류");
    return value;
  };
  useEffect(() => {
    const update = () => {
      if (pending.current) return;
      try { setRecord(load()); setFailed(false); }
      catch { setFailed(true); setError("이 행사방의 장소를 불러오지 못했습니다."); }
    };
    const changed = (event: StorageEvent) => { if (!event.key || event.key === key) update(); };
    update();
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);

  const places = record ? readConversationPlaces(record) : [];
  const active = places.includes(selected) ? selected : places[0] ?? "";
  const index = places.indexOf(active);
  const metadata = (name: string) => record?.placeMetadata?.find(item => item.name === name);
  const details = (name: string) => conversationPlaceDetails(name, record?.details);
  const visible = places.filter(name => {
    const group = metadata(name)?.category;
    return (category === "all" || (category === "unsorted" ? !group : group === category))
      && placeSearchKey(`${name} ${details(name)?.address ?? ""}`).includes(placeSearchKey(query));
  });
  const shift = (delta: number) => { if (places.length > 1) setSelected(places[(places.length + index + delta) % places.length]); };
  const commit = async (change: (current: ConversationPlaceRecord) => ConversationPlaceRecord, nextSelected?: string): Promise<boolean> => {
    if (pending.current || failed || !record) return false;
    pending.current = true; setBusy(true); setSaved(false); setError("");
    try {
      const next = change(load());
      writeBrowserRecord(dataStorage(localStorage), key, next, "browser");
      if (isBackendConnected()) await flushBackendWrites();
      setRecord(next);
      if (nextSelected !== undefined) setSelected(nextSelected);
      setSaved(true);
      if (!isBackendConnected()) window.dispatchEvent(new StorageEvent("storage", { key }));
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "장소를 저장하지 못했습니다."); return false; }
    finally { pending.current = false; setBusy(false); }
  };
  const add = (name: string, googlePlaceId?: string) => commit(current => {
    if (googlePlaceId && current.placeMetadata?.some(item => item.googlePlaceId === googlePlaceId)) throw new Error("이미 저장된 Google Maps 장소입니다.");
    const next = appendConversationPlace(current, name);
    if (!next) throw new Error("이미 저장된 장소 이름입니다. 지점을 구분할 이름을 입력해 주세요.");
    return googlePlaceId ? { ...next, placeMetadata: [...(next.placeMetadata ?? []), { name, googlePlaceId }] } : next;
  }, name);
  const linkPlace = (name: string, googlePlaceId: string) => commit(current => {
    if (!readConversationPlaces(current).includes(name)) throw new Error("삭제된 장소입니다.");
    const list = current.placeMetadata ?? [];
    if (list.some(item => item.googlePlaceId === googlePlaceId || item.name === name && item.googlePlaceId)) throw new Error("이미 연결된 장소입니다.");
    return { ...current, placeMetadata: [...list.filter(item => item.name !== name), { ...list.find(item => item.name === name), name, googlePlaceId }] };
  }, name);
  const primary = (name: string) => void commit(current => orderConversationPlaces(current, [name, ...readConversationPlaces(current).filter(place => place !== name)]), name);
  const remove = (name: string) => {
    if (!window.confirm(`'${name}' 장소를 삭제할까요?`)) return;
    void commit(current => orderConversationPlaces(current, readConversationPlaces(current).filter(place => place !== name)), name === active ? "" : active)
      .then(ok => { if (ok && detail === name) setDetail(""); });
  };
  const edit = (name: string, address: string, notes: string, edits: LocationEdits) => void commit(current => {
    if (!readConversationPlaces(current).includes(name)) throw new Error("삭제된 장소입니다.");
    const existing = current.placeMetadata?.find(item => item.name === name);
    const memo = edits.memo === existing?.privateMemo?.text ? existing.privateMemo
      : edits.memo ? { text: edits.memo, authorId: scope.accountId, updatedAt: new Date().toISOString() } : undefined;
    return { ...orderConversationPlaces(current, readConversationPlaces(current)),
      details: [...(current.details ?? []).filter(item => item.name.trim() !== name), { name, address, notes }],
      placeMetadata: [...(current.placeMetadata ?? []).filter(item => item.name !== name),
        ...(memo || edits.category || existing?.googlePlaceId ? [{ name, category: edits.category, privateMemo: memo, googlePlaceId: existing?.googlePlaceId }] : [])],
    };
  });
  const renderCard = (place: string) => <LocationPanel key={place} location={place} details={details(place)} metadata={metadata(place)} placeId={metadata(place)?.googlePlaceId}
    primary={places[0] === place} savedEntry accountId={scope.accountId} busy={busy} onSave={(address, notes, edits) => edit(place, address, notes, edits)}
    onRoute={() => setAction({ type: "route", place })} onNearby={isBackendConnected() ? () => setAction({ type: "nearby", place }) : undefined}
    onProvider={isBackendConnected() && metadata(place)?.googlePlaceId ? () => setAction({ type: "details", place }) : undefined}>
    <div className="location-card-footer">
      {places[0] !== place && <Button variant="ghost" type="button" disabled={busy} aria-label={`${place} 대표로 설정`} onClick={() => primary(place)}>대표로 설정</Button>}
      <Button variant="ghost" type="button" disabled={busy} aria-label={`${place} 삭제`} onClick={() => remove(place)}>삭제</Button>
    </div>
  </LocationPanel>;

  return <div className="saved-places" ref={node}>
    <form className="location-edit" onSubmit={event => { event.preventDefault(); const name = input.trim(); if (name) void add(name).then(ok => { if (ok) setInput(""); }); }}>
      <Field label="장소 추가"><input className={inputClass} value={input} maxLength={180} placeholder="장소 이름" disabled={busy || failed || !record || places.length >= maxConversationPlaces} onChange={event => { setInput(event.target.value); setSaved(false); }} /></Field>
      <div className="location-add-actions"><Button type="submit" variant="outline" disabled={busy || failed || !record || !input.trim() || places.length >= maxConversationPlaces}><Plus size={15} aria-hidden="true" />추가</Button>
        {isBackendConnected() && <Button type="button" variant="outline" onClick={() => setAction({ type: "search" })}>외부 장소 검색</Button>}</div>
      {error && <p role="alert" className="documents-error">{error}</p>}
      {saved && <p role="status" className="text-xs text-muted-foreground">장소가 저장되었습니다.</p>}
    </form>
    {!active && !failed && <LocationPanel location="" />}
    {active && <div hidden={expanded}>
      <div className="location-carousel-bar">
        <button type="button" className="location-icon-button" aria-label="이전 장소" disabled={places.length < 2} onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <span role="status" aria-label="장소 위치">{index + 1} / {places.length}</span>
        <button type="button" className="location-icon-button" aria-label="다음 장소" disabled={places.length < 2} onClick={() => shift(1)}><ChevronRight size={18} /></button>
        <button type="button" className="location-jump" aria-expanded={jumpOpen} onClick={() => setJumpOpen(!jumpOpen)}>장소 목록</button>
      </div>
      {jumpOpen && <ul className="location-saved-list" aria-label="저장한 장소">{places.map(name => <li key={name}>
        <button className="location-saved-name" type="button" aria-current={name === active ? "true" : undefined} onClick={() => { setSelected(name); setJumpOpen(false); }}>{name}</button>
      </li>)}</ul>}
      <div className="location-carousel-card" onTouchStart={event => { const touch = event.touches[0]; swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null; }}
        onTouchCancel={() => { swipe.current = null; }} onTouchEnd={event => {
          const from = swipe.current, touch = event.changedTouches[0]; swipe.current = null;
          if (from && touch && Math.abs(touch.clientX - from.x) >= 50 && Math.abs(touch.clientX - from.x) > 1.4 * Math.abs(touch.clientY - from.y)) shift(touch.clientX < from.x ? 1 : -1);
        }}>{renderCard(active)}</div>
    </div>}
    {expanded && places.length > 0 && <>
      <div className="location-grid-tools"><input className={inputClass} type="search" aria-label="저장한 장소 검색" placeholder="저장한 장소 검색" value={query} onChange={event => setQuery(event.target.value)} />
        <select className={inputClass} value={category} aria-label="장소 분류 필터" onChange={event => setCategory(event.target.value as typeof category)}>
          <option value="all">전체 · {places.length}곳</option>
          {Object.entries(conversationPlaceCategories).map(([value, label]) => { const count = places.filter(name => metadata(name)?.category === value).length;
            return count > 0 || category === value ? <option key={value} value={value}>{label} · {count}곳</option> : null; })}
          {(category === "unsorted" || places.some(name => !metadata(name)?.category)) && <option value="unsorted">미분류 · {places.filter(name => !metadata(name)?.category).length}곳</option>}
        </select></div>
      {!visible.length && <p className="location-note">조건에 맞는 저장 장소가 없습니다.</p>}
      <ul className="location-grid" aria-label="저장한 장소 카드">{visible.map(name => <li key={name}>
        <button type="button" className="location-grid-open" aria-label={`${name} 상세 보기`} onClick={() => { setSelected(name); setDetail(name); }}><MapPin size={18} aria-hidden="true" /><strong>{name}</strong></button>
        <LocationLabels category={metadata(name)?.category} primary={places[0] === name} />
        {details(name)?.address && <p className="location-note">{details(name)?.address}</p>}
        <LocationActions name={name} address={details(name)?.address} placeId={metadata(name)?.googlePlaceId}
          onEdit={() => { setSelected(name); setDetail(name); }} onRoute={() => setAction({ type: "route", place: name })}
          onNearby={isBackendConnected() ? () => setAction({ type: "nearby", place: name }) : undefined} />
        <LocationMemo memo={metadata(name)?.privateMemo} compact />
      </li>)}</ul>
    </>}
    {detail && places.includes(detail) && <LocationDialog title="장소 상세" onClose={() => setDetail("")}>{renderCard(detail)}</LocationDialog>}
    {action && <LocationDiscovery key={`${action.type}:${action.place ?? ""}`} action={action} scope={scope} onClose={() => setAction(undefined)}
      places={places.map(name => ({ name, address: details(name)?.address, placeId: metadata(name)?.googlePlaceId }))}
      onAdd={add} onLink={linkPlace} />}
  </div>;
}
