"use client";

import { Copy, ExternalLink, MapPin, Navigation, Save, X } from "lucide-react";
import { useId, useState } from "react";
import { googleMapsUrl, googleEmbedUrl, usableLocation } from "@/lib/location-links";
import "./location-panel.css";

export function LocationPanel({ location, placeId, details, onSave, busy }: {
  location: string; placeId?: string; details?: { address: string; notes: string; source?: string }; onSave?: (address: string, notes: string) => void; busy?: boolean;
}) {
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const id = useId();
  if (!usableLocation(location)) return <div className="location-panel location-empty"><MapPin size={26} aria-hidden="true" /><h3>장소 미정</h3></div>;
  const query = details?.address ? `${location} ${details.address}` : location;
  const embed = googleEmbedUrl(query, process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY ?? "", placeId);
  const showing = !!embed && shownFor === embed;
  return <section className="location-panel" aria-label="행사 장소"><div className="location-title"><MapPin size={19} aria-hidden="true" /><h3>{location}</h3></div>
    {onSave && <div className="location-details">
      <div className="location-detail-address"><p><strong>도로명 주소</strong><br />{details?.address || "주소 미등록"}</p>
        {details?.address && <button type="button" className="location-show" onClick={async () => {
          try { await navigator.clipboard.writeText(details.address); setCopy("copied"); } catch { setCopy("manual"); }
        }}><Copy size={14} aria-hidden="true" />주소 복사</button>}
      </div>
      {copy === "copied" && <p role="status">주소를 복사했습니다.</p>}
      {copy === "manual" && <label>주소 직접 복사<input readOnly value={details?.address ?? ""} onFocus={event => event.currentTarget.select()} /></label>}
      {!!details?.notes && <p className="location-detail-notes">{details.notes}</p>}
      {details?.source && <a href={details.source} target="_blank" rel="noopener noreferrer">공식 시설 안내 <ExternalLink size={13} aria-hidden="true" /></a>}
      <details>
        <summary>주소 및 안내 편집</summary>
        <form onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setCopy("idle");
          onSave(String(data.get("address") ?? "").trim().replace(/\s+/g, " "), String(data.get("notes") ?? "").trim());
        }}>
          <label>주소<input name="address" maxLength={250} defaultValue={details?.address ?? ""} /></label>
          <label>장소 안내<textarea name="notes" rows={3} maxLength={600} defaultValue={details?.notes ?? ""} /></label>
          <button type="submit" className="location-show" disabled={busy}><Save size={15} aria-hidden="true" />저장</button>
        </form>
      </details>
    </div>}
    <div className="location-actions"><a href={googleMapsUrl(query, "search", placeId)!} target="_blank" rel="noopener noreferrer">Google Maps에서 열기<ExternalLink size={14} aria-hidden="true" /></a><a href={googleMapsUrl(query, "directions", placeId)!} target="_blank" rel="noopener noreferrer"><Navigation size={14} aria-hidden="true" />길찾기</a></div>
    {embed && <>
      <button type="button" className="location-show" aria-expanded={showing} aria-controls={id}
        onClick={() => setShownFor(showing ? null : embed)}>{showing ? <X size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}{showing ? "지도 닫기" : "지도 표시"}</button>
      <div id={id} hidden={!showing}>{showing && <iframe title={`${location} 지도`} src={embed} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />}</div>
    </>}
    {!embed && <p className="location-note" role="status">내장 지도 미설정 · Google Maps 링크 사용 가능</p>}
    {!placeId && !details?.address && <p className="location-note">입력한 장소명으로 검색합니다. 동명 장소는 지도에서 주소를 확인해 주세요.</p>}
  </section>;
}

export function LocationLink({ location, placeId }: { location: string; placeId?: string }) {
  const href = googleMapsUrl(location, "search", placeId);
  if (!href) return <span className="room-info-line"><MapPin size={13} aria-hidden="true" /><span>{location || "장소 미정"}</span></span>;
  return <span className="room-location-link"><a href={href} target="_blank" rel="noopener noreferrer" title={`${location} · Google Maps에서 열기`}><MapPin size={13} aria-hidden="true" /><span>{location}</span><ExternalLink size={11} aria-hidden="true" /></a><span className="room-location-preview" role="tooltip"><MapPin size={15} aria-hidden="true" /><span><strong>{location}</strong><small>Google Maps에서 주소 확인</small></span></span></span>;
}
