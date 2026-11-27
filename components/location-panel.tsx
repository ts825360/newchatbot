"use client";

import { BookmarkCheck, ExternalLink, LockKeyhole, MapPin, Save, Star, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { conversationPlaceCategories, isConversationPlaceCategory, maxPlaceMemoLength, type ConversationPlaceCategory, type ConversationPlaceMetadata } from "@/lib/conversation-places";
import { googleMapsUrl, googleEmbedUrl, usableLocation } from "@/lib/location-links";
import { LocationActions } from "./location-actions";
import "./location-panel.css";

export type LocationEdits = { category?: ConversationPlaceCategory; memo: string };
const placeTabs = [{ key: "overview", label: "개요" }, { key: "info", label: "정보" }] as const;

export function LocationPanel({ location, placeId, details, metadata, primary, savedEntry, accountId, onSave, busy, onRoute, onNearby, onProvider, children }: {
  location: string; placeId?: string; details?: { address: string; notes: string; source?: string };
  metadata?: ConversationPlaceMetadata; primary?: boolean; savedEntry?: boolean; accountId?: string;
  onSave?: (address: string, notes: string, edits: LocationEdits) => void; busy?: boolean; children?: ReactNode;
  onRoute?: () => void; onNearby?: () => void; onProvider?: () => void;
}) {
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof placeTabs)[number]["key"]>("overview");
  const id = useId();
  const editor = useRef<HTMLDetailsElement>(null);
  if (!usableLocation(location)) return <div className="location-panel location-empty"><MapPin size={26} aria-hidden="true" /><h3>장소 미정</h3></div>;
  const query = details?.address ? `${location} ${details.address}` : location;
  const embed = googleEmbedUrl(query, process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY ?? "", placeId);
  const showing = !!embed && shownFor === embed;
  return <section className="location-panel" aria-label="행사 장소">
    <div className="location-title"><MapPin size={19} aria-hidden="true" /><h3>{location}</h3></div>
    {savedEntry && <LocationLabels category={metadata?.category} primary={primary} />}
    <LocationActions name={location} address={details?.address} placeId={placeId} onRoute={onRoute} onNearby={onNearby} onEdit={onSave ? () => {
      if (editor.current) { editor.current.open = true; editor.current.querySelector("summary")?.focus(); }
    } : undefined} />
    {embed && <>
      <button type="button" className="location-show" aria-expanded={showing} aria-controls={`${id}-map`}
        onClick={() => setShownFor(showing ? null : embed)}>{showing ? <X size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}{showing ? "지도 닫기" : "지도 표시"}</button>
      <div id={`${id}-map`} hidden={!showing}>{showing && <iframe title={`${location} 지도`} src={embed} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />}</div>
    </>}
    {!embed && !savedEntry && <p className="location-note" role="status">내장 지도 미설정 · Google Maps 링크 사용 가능</p>}
    {savedEntry && <>
      <div className="location-tabs" role="tablist" aria-label="장소 상세 정보">
        {placeTabs.map(({ key, label }) => <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-selected={tab === key} aria-controls={`${id}-${key}-panel`} tabIndex={tab === key ? 0 : -1}
          onClick={() => setTab(key)} onKeyDown={event => {
            const next = event.key === "Home" ? "overview" : event.key === "End" ? "info"
              : event.key === "ArrowRight" || event.key === "ArrowLeft" ? (key === "overview" ? "info" : "overview") : null;
            if (!next) return;
            event.preventDefault(); setTab(next); document.getElementById(`${id}-${next}`)?.focus();
          }}>{label}</button>)}
      </div>
      <div className="location-details" id={`${id}-overview-panel`} role="tabpanel" aria-labelledby={`${id}-overview`} hidden={tab !== "overview"} tabIndex={0}>
        <p><strong>도로명 주소</strong><br />{details?.address || "주소 미등록"}</p>
        {!!details?.notes && <p className="location-detail-notes">{details.notes}</p>}
        {!placeId && !details?.address && <p className="location-note">동명 장소는 Google Maps에서 주소를 확인해 주세요.</p>}
      </div>
      <div className="location-details" id={`${id}-info-panel`} role="tabpanel" aria-labelledby={`${id}-info`} hidden={tab !== "info"} tabIndex={0}>
        {onProvider ? <button type="button" className="location-show" onClick={onProvider}>Google Maps 상세 조회</button> : <dl><div><dt>이용시간</dt><dd>정보 없음</dd></div><div><dt>연락처</dt><dd>정보 없음</dd></div></dl>}
        {details?.source && <a href={details.source} target="_blank" rel="noopener noreferrer">공식 시설 안내 <ExternalLink size={13} aria-hidden="true" /></a>}
      </div>
      <LocationMemo memo={metadata?.privateMemo} accountId={accountId} />
    </>}
    {onSave && <details className="location-editor" ref={editor}>
      <summary>주소 및 안내 편집</summary>
      <form key={JSON.stringify([details?.address, details?.notes, metadata?.category, metadata?.privateMemo?.text])} onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const category = data.get("category");
        onSave(String(data.get("address") ?? "").trim().replace(/\s+/g, " "), String(data.get("notes") ?? "").trim(), {
          category: isConversationPlaceCategory(category) ? category : undefined, memo: String(data.get("memo") ?? "").trim(),
        });
      }}>
        <label>주소<input name="address" maxLength={250} defaultValue={details?.address ?? ""} disabled={busy} /></label>
        <label>장소 안내<textarea name="notes" rows={3} maxLength={600} defaultValue={details?.notes ?? ""} disabled={busy} /></label>
        {savedEntry && <>
          <label>행사 내부 분류<select name="category" aria-label="행사 내부 분류" defaultValue={metadata?.category ?? ""} disabled={busy}>
            <option value="">미분류</option>
            {Object.entries(conversationPlaceCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>비공개 메모<textarea name="memo" rows={3} maxLength={maxPlaceMemoLength} defaultValue={metadata?.privateMemo?.text ?? ""} disabled={busy} /></label>
        </>}
        <button type="submit" className="location-show" disabled={busy}><Save size={15} aria-hidden="true" />저장</button>
      </form>
    </details>}
    {children}
  </section>;
}

export function LocationLabels({ category, primary }: { category?: ConversationPlaceCategory; primary?: boolean }) {
  return <div className="location-labels">
    <span>{category ? conversationPlaceCategories[category] : "미분류"}</span>
    {primary ? <span className="location-primary"><Star size={13} aria-hidden="true" />대표 장소</span>
      : <span><BookmarkCheck size={13} aria-hidden="true" />저장됨</span>}
  </div>;
}

export function LocationMemo({ memo, accountId, compact }: { memo?: ConversationPlaceMetadata["privateMemo"]; accountId?: string; compact?: boolean }) {
  return <div className="location-memo" data-compact={compact || undefined}>
    <strong><LockKeyhole size={13} aria-hidden="true" />비공개 메모</strong>
    <p>{memo?.text ?? "등록된 메모 없음"}</p>
    {memo && !compact && <small>{memo.authorId && memo.authorId === accountId ? "내 메모 · " : ""}수정 <time dateTime={memo.updatedAt}>{new Date(memo.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</time></small>}
  </div>;
}

export function LocationLink({ location, placeId }: { location: string; placeId?: string }) {
  const href = googleMapsUrl(location, "search", placeId);
  if (!href) return <span className="room-info-line"><MapPin size={13} aria-hidden="true" /><span>{location || "장소 미정"}</span></span>;
  return <span className="room-location-link"><a href={href} target="_blank" rel="noopener noreferrer" title={`${location} · Google Maps에서 열기`}><MapPin size={13} aria-hidden="true" /><span>{location}</span><ExternalLink size={11} aria-hidden="true" /></a><span className="room-location-preview" role="tooltip"><MapPin size={15} aria-hidden="true" /><span><strong>{location}</strong><small>Google Maps에서 주소 확인</small></span></span></span>;
}
