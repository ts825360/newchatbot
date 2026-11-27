import { ArrowRight, CalendarDays, ChartNoAxesColumnIncreasing, Folder, House, Plus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import type { LobbyRoom } from "@/lib/room-catalog";
import { roomStages, type RoomStage } from "@/lib/room-timing";
import { SettingsEntry } from "./settings-entry";

const stageColor = (id: RoomStage) => `var(--lobby-stage-${id})`;
const navLinks = [
  { hash: "#lobby-home", label: "홈", Icon: House },
  { hash: "#rooms-panel", label: "행사방", Icon: Folder },
] as const;

export function AppRailBrand() {
  return <Link className="lobby-brand" href="/rooms" aria-label="행사비서 홈">
    <span className="lobby-brand-mark" aria-hidden="true"><Plus size={24} strokeWidth={2.5} /></span><span>행사비서</span>
  </Link>;
}

export function LobbyNavigation({ recent, busy, onEnter }: { recent: LobbyRoom[]; busy: boolean; onEnter: (id: string) => void }) {
  const [active, setActive] = useState("#rooms-panel");
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash;
      setActive(navLinks.some(item => item.hash === hash) ? hash : "#rooms-panel");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return <aside className="lobby-rail" aria-label="행사비서 탐색">
    <AppRailBrand />
    <nav className="lobby-rail-links" aria-label="주 메뉴">
      {navLinks.map(({ hash, label, Icon }) => <a key={hash} href={hash} aria-current={active === hash ? "location" : undefined}><Icon size={20} aria-hidden="true" />{label}</a>)}
    </nav>
    {recent.length > 0 && <div className="lobby-recent">
      <h2>최근 만든 행사방</h2>
      {recent.map(room => <button key={room.id} type="button" disabled={busy} onClick={() => onEnter(room.id)} title={room.name} aria-label={`${room.name} 바로 열기`}>
        <UsersRound size={18} aria-hidden="true" /><span>{room.name}</span>
      </button>)}
    </div>}
    <div className="lobby-rail-footer"><SettingsEntry placement="rail" href="/settings" /></div>
  </aside>;
}

export function LobbyOverview({ stages, total, today, busy, onEnter }: {
  stages: Record<RoomStage, number>;
  total: number;
  today: LobbyRoom[];
  busy: boolean;
  onEnter: (id: string) => void;
}) {
  let cursor = 0;
  const segments = roomStages.flatMap(({ id }) => {
    if (!total || !stages[id]) return [];
    const start = cursor;
    cursor += stages[id];
    return [`${stageColor(id)} ${start / total * 100}% ${cursor / total * 100}%`];
  });
  const chart = (segments.length ? { "--lobby-chart": `conic-gradient(${segments.join(", ")})` } : {}) as CSSProperties;

  return <>
    <section className="lobby-summary-card" id="lobby-today" aria-labelledby="lobby-today-title" tabIndex={-1}>
      <h2 id="lobby-today-title"><CalendarDays size={21} aria-hidden="true" />오늘의 행사</h2>
      {today.length ? <ul className="lobby-today-list">{today.map(room => <li key={room.id}>
        <button type="button" disabled={busy} onClick={() => onEnter(room.id)} aria-label={room.name}>
          <span className="lobby-status-dot" aria-hidden="true" /><span>{room.name}{room.location && <small className="lobby-today-location">{room.location}</small>}</span><ArrowRight size={16} aria-hidden="true" />
        </button>
      </li>)}</ul> : <p className="lobby-summary-empty">오늘 진행하는 행사가 없습니다.</p>}
    </section>
    <section className="lobby-summary-card" aria-labelledby="lobby-stages-title">
      <h2 id="lobby-stages-title"><ChartNoAxesColumnIncreasing size={21} aria-hidden="true" />전체 진행 현황</h2>
      <div className="lobby-progress-body">
        <div className="lobby-donut" style={chart}><span>전체 행사<strong>{total}<small>개</small></strong></span></div>
        <dl className="lobby-stage-legend">{roomStages.map(stage => <div key={stage.id}>
          <dt><span style={{ "--lobby-dot": stageColor(stage.id) } as CSSProperties} aria-hidden="true" />{stage.label}</dt><dd>{stages[stage.id]}개</dd>
        </div>)}</dl>
      </div>
    </section>
  </>;
}
