"use client";

import { BookmarkCheck, Compass, Copy, ExternalLink, Link2, Navigation, Share2, Star, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { googleMapsUrl } from "@/lib/location-links";

export function LocationDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    close.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close?.();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="location-dialog" aria-labelledby={id} aria-modal="true" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="location-dialog-header">
      <h3 id={id}>{title}</h3>
      <button ref={close} type="button" className="location-icon-button" aria-label={`${title} 닫기`} title="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    {children}
  </dialog>;
}

export function LocationActions({ name, address, placeId, primary, onSetPrimary, onRoute, onNearby, onEdit }: { name: string; address?: string; placeId?: string;
  primary?: boolean; onSetPrimary?: () => void; onRoute?: () => void; onNearby?: () => void; onEdit?: () => void }) {
  const [shareOpen, setShareOpen] = useState(false);
  const query = address ? `${name} ${address}` : name;
  const maps = googleMapsUrl(query, "search", placeId);
  const route = googleMapsUrl(query, "directions", placeId);
  if (!maps || !route) return null;
  return <div className="location-actions">
    <a className="location-action" href={maps} target="_blank" rel="noopener noreferrer" aria-label="Google Maps에서 열기" title="Google Maps에서 열기"><span><ExternalLink size={17} aria-hidden="true" /></span><span>지도</span></a>
    {onRoute ? <button className="location-action" type="button" onClick={onRoute}><span><Navigation size={17} aria-hidden="true" /></span><span>경로</span></button> : <a className="location-action" href={route} target="_blank" rel="noopener noreferrer" title="Google Maps 길찾기"><span><Navigation size={17} aria-hidden="true" /></span><span>길찾기</span></a>}
    {onEdit && <button className="location-action" type="button" onClick={onEdit}><span><BookmarkCheck size={17} aria-hidden="true" /></span><span>저장됨</span></button>}
    {onSetPrimary && !primary && <button className="location-action" type="button" aria-label={`${name} 대표로 설정`} onClick={onSetPrimary}><span><Star size={17} aria-hidden="true" /></span><span>대표로 설정</span></button>}
    {onNearby && <button className="location-action" type="button" onClick={onNearby}><span><Compass size={17} aria-hidden="true" /></span><span>주변</span></button>}
    <button className="location-action" type="button" aria-haspopup="dialog" onClick={() => setShareOpen(true)}><span><Share2 size={17} aria-hidden="true" /></span><span>공유</span></button>
    {shareOpen && <LocationShare name={name} address={address} maps={maps} onClose={() => setShareOpen(false)} />}
  </div>;
}

function LocationShare({ name, address, maps, onClose }: { name: string; address?: string; maps: string; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState<{ label: string; value: string }>();
  const [busy, setBusy] = useState(false);
  async function copy(label: string, value: string, success: string) {
    setBusy(true); setManual(undefined); setMessage("");
    try { await navigator.clipboard.writeText(value); setMessage(success); }
    catch { setManual({ label, value }); setMessage("자동 복사를 할 수 없습니다."); }
    finally { setBusy(false); }
  }
  async function share() {
    setBusy(true); setManual(undefined); setMessage("");
    try { await navigator.share({ title: name, url: maps }); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setMessage("시스템 공유를 열지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <LocationDialog title="장소 공유" onClose={onClose}>
    <div className="location-share-options">
      {address && <button type="button" className="location-show" disabled={busy} onClick={() => void copy("주소", address, "주소를 복사했습니다.")}><Copy size={15} aria-hidden="true" />주소 복사</button>}
      <button type="button" className="location-show" disabled={busy} onClick={() => void copy("Google Maps 링크", maps, "Google Maps 링크를 복사했습니다.")}><Link2 size={15} aria-hidden="true" />Google Maps 링크 복사</button>
      {typeof navigator.share === "function" && <button type="button" className="location-show" disabled={busy} onClick={() => void share()}><Share2 size={15} aria-hidden="true" />시스템 공유</button>}
      {message && <p role="status">{message}</p>}
      {manual && <label>{manual.label} 직접 복사<input readOnly value={manual.value} onFocus={event => event.currentTarget.select()} /></label>}
    </div>
  </LocationDialog>;
}
