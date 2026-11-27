"use client";

import { ExternalLink, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { backendFetch, isBackendConnected } from "@/lib/backend-client";
import type { ConversationScope } from "@/lib/conversation-scope";
import { googleMapsUrl } from "@/lib/location-links";
import { LocationDialog } from "./location-actions";
import { Button, Field, inputClass } from "./ui";

export type PlaceWorkspaceAction = { type: "search"; place?: undefined } | { type: "route" | "nearby" | "details"; place: string };
type Saved = { name: string; address?: string; placeId?: string };
type Attribution = { name: string; url?: string };
type MapsPlace = { placeId: string; name: string; address?: string; type?: string; mapsUrl: string; rating?: number; reviewCount?: number; phone?: string; website?: string; openingHours?: string[]; attributions?: Attribution[];
  photo?: { uri: string; mapsUrl?: string; authors: Attribution[] } };
type MapsRoute = { distanceMeters: number; durationSeconds: number; warnings?: string[] };
const endpoint = "/api/integrations/google-maps";
const types = { restaurant: "음식점", cafe: "카페", tourist_attraction: "관광지", convenience_store: "편의점", parking: "주차장", hospital: "병원", lodging: "숙소", church: "교회" } as const;
const modes = { driving: "자동차", walking: "도보", transit: "대중교통" } as const;

function GoogleCredit({ attributions = [] }: { attributions?: Attribution[] }) {
  return <p className="location-map-credit"><a translate="no" href="https://maps.google.com/" target="_blank" rel="noopener noreferrer">Google Maps</a>
    {attributions.map(item => item.url ? <a key={item.name} href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : <span key={item.name}>{item.name}</span>)}</p>;
}

export function LocationDiscovery({ action, scope, places, onClose, onAdd, onLink }: {
  action: PlaceWorkspaceAction; scope: ConversationScope; places: Saved[]; onClose: () => void; onAdd: (name: string, googlePlaceId: string) => Promise<boolean>;
  onLink: (name: string, googlePlaceId: string) => Promise<boolean>;
}) {
  const request = useRef<AbortController | null>(null);
  const lastRequest = useRef("");
  const [results, setResults] = useState<MapsPlace[] | null>(null);
  const [details, setDetails] = useState<MapsPlace>();
  const [route, setRoute] = useState<MapsRoute | null>();
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [category, setCategory] = useState<keyof typeof types>("restaurant");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState(action.place ?? "");
  const [mode, setMode] = useState<keyof typeof modes>("driving");
  const [choice, setChoice] = useState<MapsPlace>();
  const [alias, setAlias] = useState("");
  const [linkExisting, setLinkExisting] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const a = places.find(item => item.name === origin), b = places.find(item => item.name === destination);
  const target = places.find(item => item.name === action.place);
  const externalRoute = b && (googleMapsUrl(b.address || b.name, "directions", b.placeId) ?? googleMapsUrl(b.name, "directions", b.placeId));
  const link = externalRoute ? new URL(externalRoute) : null;
  if (link) {
    if (a) { link.searchParams.set("origin", a.address || a.name); if (a.placeId) link.searchParams.set("origin_place_id", a.placeId); }
    link.searchParams.set("travelmode", mode);
  }
  const embedKey = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY ?? "").trim();
  const canEmbed = Boolean(embedKey && a?.placeId && b?.placeId && origin !== destination);
  const close = () => { request.current?.abort(); onClose(); };
  useEffect(() => () => request.current?.abort(), []);

  async function load(body: Record<string, unknown>, apply: (value: any) => void) {
    const identity = JSON.stringify(body);
    if (request.current || lastRequest.current === identity) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const value = await backendFetch(endpoint, { method: "POST", signal: controller.signal, headers: { "x-maps-account": scope.accountId, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, roomId: scope.roomId, conversationId: scope.conversationId }) });
      if (!controller.signal.aborted) { apply(value); lastRequest.current = identity; }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Google Maps 정보를 불러오지 못했습니다."); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setBusy(false); } }
  }
  const lookup = (placeId: string) => void load({ action: "details", placeId, includePhoto: true }, value => setDetails(value.place));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (action.type === "search" && confirmed && query.trim()) void load({ action: "text-search", query: query.trim(), confirmPublicQuery: true }, value => {
      setResults(value.places); setChoice(undefined); setDetails(undefined);
    });
    if (action.type === "nearby" && target?.placeId) void load({ action: "nearby", originPlaceId: target.placeId, category }, value => {
      setResults(value.places); setChoice(undefined); setDetails(undefined);
    });
    if (action.type === "route" && a?.placeId && b?.placeId && a.placeId !== b.placeId) void load({ action: "compute-route", originPlaceId: a.placeId, destinationPlaceId: b.placeId, mode }, value => setRoute(value.route));
  };
  const label = { search: "외부 장소 검색", route: "이동 경로", nearby: "주변 시설", details: "Google Maps 장소 정보" }[action.type];
  const currentPlace = choice && details?.placeId === choice.placeId ? details : action.type === "details" ? details : undefined;
  return <LocationDialog title={label} onClose={close}><div className="location-discovery">
    <form onSubmit={submit} className="location-discovery-form">
      {action.type === "search" && <>
        <Field label="공개 시설명"><input className={inputClass} value={query} maxLength={100} onChange={event => { setQuery(event.target.value); setConfirmed(false); }} /></Field>
        <label className="location-search-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />공개 장소 이름만 Google에 보냅니다.</label>
        <Button type="submit" variant="primary" disabled={busy || !confirmed || !query.trim()}><Search size={15} aria-hidden="true" />검색</Button>
      </>}
      {action.type === "nearby" && <>
        {target?.placeId ? <><Field label="주변 시설 분류"><select className={inputClass} value={category} onChange={event => setCategory(event.target.value as typeof category)}>
          {Object.entries(types).filter(([key]) => !["lodging", "church"].includes(key)).map(([key, name]) => <option value={key} key={key}>{name}</option>)}
        </select></Field><Button type="submit" variant="primary" disabled={busy}>주변 검색</Button></> : <p>외부 검색 결과를 연결한 장소에서 주변 시설을 조회할 수 있습니다. 기존 장소는 Google Maps에서 주변을 확인할 수 있습니다.</p>}
        {target && <a href={googleMapsUrl(target.address || target.name, "search", target.placeId) ?? undefined} target="_blank" rel="noopener noreferrer">Google Maps에서 열기 <ExternalLink size={13} /></a>}
      </>}
      {action.type === "details" && target?.placeId && <Button type="button" variant="outline" disabled={busy || !!details} onClick={() => lookup(target.placeId!)}>상세 정보 불러오기</Button>}
      {action.type === "route" && <>
        <Field label="출발 장소"><select className={inputClass} value={origin === destination ? "" : origin} onChange={event => { setOrigin(event.target.value); setRoute(undefined); setMapReady(false); lastRequest.current = ""; }}>
          <option value="">지도에서 출발지 선택</option>{places.filter(item => item.name !== destination).map(item => <option key={item.name}>{item.name}</option>)}
        </select></Field>
        <Field label="도착 장소"><select className={inputClass} value={destination} onChange={event => { setDestination(event.target.value); setRoute(undefined); setMapReady(false); lastRequest.current = ""; }}>
          {places.map(item => <option key={item.name}>{item.name}</option>)}
        </select></Field>
        <Field label="이동수단"><select className={inputClass} value={mode} onChange={event => { setMode(event.target.value as typeof mode); setRoute(undefined); setMapReady(false); lastRequest.current = ""; }}>
          {Object.entries(modes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select></Field>
        {isBackendConnected() && a?.placeId && b?.placeId && a.placeId !== b.placeId ? <Button type="submit" variant="primary" disabled={busy}>거리와 시간 조회</Button> : <p className="location-note">두 장소가 Google Maps 장소와 연결되지 않았으면 앱에서 거리와 시간을 계산하지 않습니다.</p>}
        {link && <a href={link.href} target="_blank" rel="noopener noreferrer">Google Maps에서 경로 열기 <ExternalLink size={13} /></a>}
        {canEmbed && <Button type="button" variant="outline" onClick={() => setMapReady(value => !value)}>{mapReady ? "경로 지도 닫기" : "경로 지도 보기"}</Button>}
        {canEmbed && mapReady && <iframe title="Google Maps 경로 지도" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
          src={`https://www.google.com/maps/embed/v1/directions?${new URLSearchParams({ key: embedKey, origin: `place_id:${a!.placeId}`, destination: `place_id:${b!.placeId}`, mode })}`} />}
      </>}
    </form>
    {busy && <p role="status">Google Maps 조회 중…</p>}
    {error && <p role="alert" className="documents-error">{error}</p>}
    {route !== undefined && <div className="location-provider">{route ? <><strong>{route.distanceMeters.toLocaleString("ko-KR")}m · 약 {Math.ceil(route.durationSeconds / 60)}분</strong><p>실시간 교통을 반영하지 않은 예상 소요시간입니다.</p>{route.warnings?.map(warning => <p key={warning}>{warning}</p>)}</> : <p>조회 가능한 경로가 없습니다.</p>}<GoogleCredit /></div>}
    {results && <div className="location-provider"><GoogleCredit />{results.length ? <ul className="location-result-list">{results.map(result => <li key={result.placeId}>
      <button type="button" aria-pressed={choice?.placeId === result.placeId} disabled={busy} onClick={() => { setChoice(result); setAlias(""); setLinkExisting(""); if (details?.placeId !== result.placeId) { lastRequest.current = ""; lookup(result.placeId); } }}>
        <strong>{result.name}</strong><span>{result.address || "주소 정보 없음"}</span>
      </button><GoogleCredit attributions={result.attributions} />
    </li>)}</ul> : <p>검색 결과가 없습니다.</p>}</div>}
    {currentPlace && <div className="location-provider">
      {currentPlace.photo && <figure><img src={currentPlace.photo.uri} alt={`${currentPlace.name} 사진`} width="480" height="270" loading="lazy" referrerPolicy="no-referrer" />
        <figcaption><GoogleCredit attributions={currentPlace.photo.authors} />{currentPlace.photo.mapsUrl && <a href={currentPlace.photo.mapsUrl} target="_blank" rel="noopener noreferrer">사진 출처</a>}</figcaption></figure>}
      <h4>{currentPlace.name}</h4><p>{currentPlace.address || "주소 정보 없음"}</p>
      <p>{currentPlace.type ? types[currentPlace.type as keyof typeof types] ?? currentPlace.type : "분류 정보 없음"} · {currentPlace.rating === undefined ? "평점 정보 없음" : `평점 ${currentPlace.rating}${currentPlace.reviewCount === undefined ? "" : ` (${currentPlace.reviewCount}건)`}`}</p>
      <p>연락처: {currentPlace.phone ?? "정보 없음"}</p>
      {currentPlace.openingHours?.length ? <ul>{currentPlace.openingHours.map(day => <li key={day}>{day}</li>)}</ul> : <p>영업시간 정보 없음</p>}
      {currentPlace.type === "lodging" && <p>체크인·체크아웃: 시설에 확인</p>}
      {currentPlace.website && <a href={currentPlace.website} target="_blank" rel="noopener noreferrer">공식 홈페이지</a>} <a href={currentPlace.mapsUrl} target="_blank" rel="noopener noreferrer">Google Maps에서 열기</a>
      <GoogleCredit attributions={currentPlace.attributions} />
    </div>}
    {choice && <form className="location-discovery-form" onSubmit={event => { event.preventDefault(); if ((!alias.trim() && !linkExisting) || busy) return;
      setBusy(true); setError("");
      const operation = linkExisting ? onLink(linkExisting, choice.placeId) : onAdd(alias.trim(), choice.placeId);
      void operation.then(ok => { if (ok) close(); else setError("저장하지 못했습니다. 이미 등록된 장소인지, 이름과 등록 한도를 확인해 주세요."); }).finally(() => setBusy(false)); }}>
      {places.some(item => !item.placeId) && <Field label="Google Maps 장소 연결 대상"><select className={inputClass} aria-label="Google Maps 장소 연결 대상" value={linkExisting} onChange={event => setLinkExisting(event.target.value)}>
        <option value="">새로 저장</option>{places.filter(item => !item.placeId).map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
      </select></Field>}
      {!linkExisting && <Field label="행사에서 사용할 장소 이름"><input className={inputClass} maxLength={180} value={alias} onChange={event => setAlias(event.target.value)} /></Field>}
      <Button type="submit" variant="primary" disabled={busy || (!alias.trim() && !linkExisting) || places.some(item => item.placeId === choice.placeId)}>{linkExisting ? "기존 장소에 연결" : "이 행사방에 저장"}</Button>
    </form>}
  </div></LocationDialog>;
}
