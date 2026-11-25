"use client";

import { ExternalLink, MapPin, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { backendFetch } from "@/lib/backend-client";
import type { ConversationScope } from "@/lib/conversation-scope";
import { googleMapsUrl } from "@/lib/location-links";
import { isRetreatVenueReview, needsVenueBarbecue, venueFeatureLabels, venueGroupSize, type RetreatVenueReview } from "@/lib/retreat-venue-history";
import { Button, Field, inputClass } from "./ui";

type ReportOption = { id: string; name: string; venue: string | null; year: number | null };
type Snapshot = RetreatVenueReview & { reports: ReportOption[]; canPublish: boolean };
const updateEvent = "church-retreat-venue-history-updated";

export function RetreatVenueHistory({ scope, question = "", canRegister = false }: { scope: ConversationScope; question?: string; canRegister?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [revision, setRevision] = useState(0);
  const bbq = needsVenueBarbecue(question);
  const size = venueGroupSize(question);

  useEffect(() => {
    const reload = () => setRevision(value => value + 1);
    window.addEventListener(updateEvent, reload);
    return () => window.removeEventListener(updateEvent, reload);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ roomId: scope.roomId, conversationId: scope.conversationId,
      ...(bbq && { bbq: "1" }), ...(canRegister && { manage: "1" }) });
    void backendFetch(`/api/retreat-venues?${query}`, { signal: controller.signal }).then(data => {
      if (!isRetreatVenueReview(data)) throw new Error("장소 이력 형식을 확인해 주세요.");
      if (!controller.signal.aborted) setSnapshot(data as Snapshot);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "장소 이력을 불러오지 못했습니다.");
    });
    return () => controller.abort();
  }, [scope.roomId, scope.conversationId, bbq, canRegister, revision]);

  async function submit(method: "POST" | "DELETE") {
    if (!source || busy) return;
    setError(""); setBusy(true);
    try {
      await backendFetch("/api/retreat-venues", { method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: scope.roomId, conversationId: scope.conversationId, documentId: source,
          ...(method === "POST" && { name: name.trim(), year: Number(year) }) }) });
      setSource(""); setName(""); setYear("");
      window.dispatchEvent(new Event(updateEvent));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "장소 이력을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }

  const selected = snapshot?.reports.find(report => report.id === source);
  return <section className="retreat-venue-history" aria-label="수련회 장소 이력">
    {error && <p role="alert" className="documents-error">{error}</p>}
    {!snapshot && !error && <p role="status" className="text-xs text-muted-foreground">장소 이력을 불러오는 중…</p>}
    {snapshot && <>
      <h3>이용한 장소 <span>{snapshot.history.length}건</span></h3>
      {!snapshot.history.length && <p className="venue-history-note">결과 보고서에 등록된 장소가 없습니다.</p>}
      <ul>{snapshot.history.map(place => <li key={`${place.year}:${place.name}`}>
        <div className="venue-history-title"><strong>{place.name}</strong><span>{place.year}년</span></div>
        {place.features.length > 0 && <p className="venue-history-note">기록된 운영 요소: {place.features.map(feature => venueFeatureLabels[feature]).join(" · ")}</p>}
        <PlaceLinks name={place.name} />
      </li>)}</ul>
      <h3>추가 검토 후보 <span>{snapshot.candidates.length}곳</span></h3>
      <p className="venue-history-note">{size ? `${size}명분 객실` : "실제 숙박 정원"}과 예약 가능 여부는 시설에 확인해야 합니다.</p>
      <ul>{snapshot.candidates.map(place => <li key={place.name}>
        <div className="venue-history-title"><strong>{place.name}</strong><span>미확정</span></div>
        <p className="venue-history-note">{place.matched.length
          ? `이전 장소와 공통: ${place.matched.map(feature => venueFeatureLabels[feature]).join(" · ")}`
          : `공개 시설: ${place.features.map(feature => venueFeatureLabels[feature]).join(" · ")}`}</p>
        <PlaceLinks name={`${place.name} ${place.address}`} website={place.website} />
      </li>)}</ul>
      {canRegister && snapshot.canPublish && <details>
        <summary>결과 보고서에서 이용 이력 등록</summary>
        {!snapshot.reports.length ? <p className="venue-history-note">이 대화에 첨부된 TXT·MD 결과 보고서가 없습니다.</p> :
          <form className="venue-history-form" onSubmit={event => { event.preventDefault(); void submit("POST"); }}>
            <Field label="결과 보고서"><select className={inputClass} value={source} onChange={event => {
              const next = snapshot.reports.find(item => item.id === event.target.value);
              setSource(event.target.value); setName(next?.venue ?? ""); setYear(next?.year ? String(next.year) : ""); setError("");
            }} required><option value="">보고서 선택</option>{snapshot.reports.map(report => <option key={report.id} value={report.id}>{report.name}</option>)}</select></Field>
            <Field label="보고서에 적힌 장소"><input className={inputClass} maxLength={120} value={name} onChange={event => setName(event.target.value)} required /></Field>
            <Field label="이용 연도"><input type="number" className={inputClass} min={1900} max={2099} value={year} onChange={event => setYear(event.target.value)} required /></Field>
            <div className="venue-history-links">
              <Button type="submit" variant="outline" disabled={busy}><Plus size={15} />교회 이용 이력에 등록</Button>
              {selected?.venue && <Button type="button" variant="ghost" disabled={busy} onClick={() => void submit("DELETE")}><Trash2 size={15} />이력에서 제거</Button>}
            </div>
          </form>}
      </details>}
    </>}
  </section>;
}

function PlaceLinks({ name, website }: { name: string; website?: string }) {
  return <div className="venue-history-links">
    <a href={googleMapsUrl(name, "search")!} target="_blank" rel="noopener noreferrer"><MapPin size={14} aria-hidden="true" />지도에서 검색</a>
    {website && <a href={website} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />시설 안내</a>}
  </div>;
}
