"use client";

import { BookOpen, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { backendFetch } from "@/lib/backend-client";
import { koreaDate, type DailyMeditation } from "@/lib/devotions";
import "./devotions.css";

export function DevotionLobbyPreview({ accountId }: { accountId: string }) {
  const [loaded, setLoaded] = useState<{ accountId: string; meditation: DailyMeditation } | null>(null);
  useEffect(() => {
    let controller: AbortController | undefined;
    let midnightTimer: number;
    const load = () => {
      setLoaded(previous => previous?.meditation.date === koreaDate() ? previous : null);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void backendFetch("/api/devotions?view=meditation", { signal: current.signal }).then((meditation: DailyMeditation) => {
        if (!current.signal.aborted) setLoaded({ accountId, meditation });
      }).catch(() => { if (!current.signal.aborted) setLoaded(null); });
    };
    const refresh = () => {
      window.clearTimeout(midnightTimer);
      load();
      const nextMidnight = Date.parse(`${koreaDate()}T00:00:00+09:00`) + 86_400_000;
      midnightTimer = window.setTimeout(refresh, Math.max(0, nextMidnight - Date.now()) + 50);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { controller?.abort(); window.clearTimeout(midnightTimer); window.removeEventListener("focus", refresh); };
  }, [accountId]);
  const meditation = loaded?.accountId === accountId && loaded.meditation.date === koreaDate() ? loaded.meditation : null;
  if (!meditation) return null;
  return <section className="devotion-preview" aria-label="오늘의 묵상">
    <BookOpen size={17} className="devotion-preview-icon" aria-hidden="true" />
    <div className="devotion-preview-content">
      <div>
        <h2>오늘의 묵상</h2>
        <a className="devotion-preview-link" href={meditation.url} target="_blank" rel="noreferrer">
          {meditation.reference}<ExternalLink size={12} aria-hidden="true" />
        </a>
        <span>개역한글 · 대한성서공회</span>
      </div>
      <blockquote>{meditation.verse}</blockquote>
    </div>
  </section>;
}
