"use client";

import Link from "next/link";
import { CalendarDays, Link2, RefreshCw, Settings2, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { backendFetch, flushBackendWrites } from "@/lib/backend-client";
import { googleSettingsHref } from "@/lib/google-settings";
import { Button } from "./ui";

type Status = { configured: boolean; connected: boolean; needsReconnect: boolean; pending: number; synced: number; error: string; canSync: boolean };
const base = "/api/integrations/google";

export function GoogleCalendarConnection({ mode = "export" }: { mode?: "manage" | "export" }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"" | "connect" | "disconnect" | "sync">("");
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const value = await backendFetch(`${base}/status`);
        if (mounted) { setStatus(value); setReadError(""); }
      } catch (cause) {
        if (mounted) setReadError(cause instanceof Error ? cause.message : "연결 상태를 확인하지 못했습니다.");
      }
    };
    void refresh();
    const timer = mode === "export" ? setInterval(refresh, 5000) : undefined;
    return () => { mounted = false; clearInterval(timer); };
  }, [mode, refreshCount]);

  const action = async (type: "connect" | "disconnect" | "sync") => {
    if (busy) return;
    if (type === "disconnect" && !window.confirm("구글 캘린더 연결을 해제할까요? 이미 전송한 일정은 삭제하지 않습니다.")) return;
    setBusy(type); setError("");
    try {
      if (type !== "disconnect") await flushBackendWrites();
      const result = await backendFetch(`${base}/${type}`, { method: "POST" });
      if (type === "connect") { window.location.assign(result.url); return; }
      setStatus(await backendFetch(`${base}/status`));
      setReadError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 완료하지 못했습니다.");
    } finally { setBusy(""); }
  };
  const manages = mode === "manage";
  const usable = status?.configured && status.connected && !status.needsReconnect;
  const label = !status ? "" : !status.configured ? "서버 설정 필요" : status.needsReconnect ? "전송 권한 재동의 필요" :
    status.connected ? manages ? "연결됨" : `자동 전송 · 완료 ${status.synced} · 대기 ${status.pending}` : "연결 안 됨";

  return <section className={manages ? "border-b border-border py-4" : "border-b border-border p-4"} aria-label="Google 캘린더">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays size={16} aria-hidden="true" />Google 캘린더</h3>
      <span className="text-xs text-muted-foreground">행사비서 → 전용 Google 캘린더</span>
    </div>
    {status && <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {manages ? <>
        {!usable && <Button type="button" variant="outline" disabled={!!busy || !status.configured} onClick={() => void action("connect")}><Link2 size={14} aria-hidden="true" />{busy === "connect" ? "연결 중" : status.needsReconnect ? "전송 권한으로 다시 연결" : "구글 캘린더 연결"}</Button>}
        {status.connected && <Button type="button" variant="outline" disabled={!!busy} onClick={() => void action("disconnect")}><Unplug size={14} aria-hidden="true" />구글 캘린더 연결 해제</Button>}
      </> : !usable
        ? <Link className="lobby-secondary" href={googleSettingsHref("calendar")}><Settings2 size={14} aria-hidden="true" />환경설정에서 연결</Link>
        : status.canSync && (busy === "sync" || (status.pending > 0 && status.error)) && <Button type="button" variant="outline" disabled={!!busy} onClick={() => void action("sync")}><RefreshCw size={14} aria-hidden="true" className={busy === "sync" ? "motion-safe:animate-spin" : ""} />{busy === "sync" ? "전송 중" : "전송 재시도"}</Button>}
    </div>}
    {!status && !readError && <p className="mt-2 text-xs text-muted-foreground" role="status">연결 상태 확인 중...</p>}
    {(error || readError || (!manages && status?.error)) && <p className="mt-2 text-sm text-danger" role="alert">{error || readError || status?.error}</p>}
    {readError && <Button className="mt-2" type="button" variant="outline" disabled={!!busy} onClick={() => setRefreshCount((count) => count + 1)}><RefreshCw size={14} />다시 확인</Button>}
  </section>;
}
