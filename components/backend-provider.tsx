"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { discardBackendWrites, enableBackendConnection, exportBackendDrafts, flushBackendWrites, getBackendServerState, getBackendState, refreshBackendData, subscribeBackend } from "@/lib/backend-client";
import { refreshServerAuth, registerServerAuthAdapter } from "@/lib/client-auth";

export function BackendProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [startupError, setStartupError] = useState("");
  const [syncError, setSyncError] = useState(""); const [retrying, setRetrying] = useState(false);
  const state = useSyncExternalStore(subscribeBackend, getBackendState, getBackendServerState);
  const checking = useRef(false); const mounted = useRef(true);
  const initialize = useCallback(async () => {
    setStartupError(""); setRetrying(true);
    try { enableBackendConnection(true); registerServerAuthAdapter(); await refreshServerAuth(); if (mounted.current) setReady(true); }
    catch (error) { if (mounted.current) setStartupError((error as Error).message); }
    finally { if (mounted.current) setRetrying(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void initialize();
    return () => { mounted.current = false; };
  }, [initialize]);
  useEffect(() => {
    if (!ready) return;
    const poll = async () => {
      if (checking.current || document.hidden) return;
      checking.current = true;
      try { await refreshServerAuth(); await refreshBackendData(); if (mounted.current) setSyncError(""); }
      catch (error) { if (mounted.current) setSyncError((error as Error).message); }
      finally { checking.current = false; }
    };
    const timer = setInterval(poll, 2000); window.addEventListener("focus", poll);
    return () => { clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [ready]);
  useEffect(() => {
    if (!state.pending) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect);
  }, [state.pending]);
  const retry = async () => {
    setRetrying(true);
    try { await flushBackendWrites(); await refreshBackendData(); setSyncError(""); }
    catch (e) { setSyncError((e as Error).message); } finally { setRetrying(false); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportBackendDrafts()], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "행사비서-미저장변경.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!ready) return <main className="backend-start"><h1>행사비서</h1>{startupError ? <><p role="alert">{startupError}</p><button type="button" disabled={retrying} onClick={initialize}><RefreshCw size={16} />다시 연결</button></> : <p role="status">서버 연결 확인 중...</p>}</main>;
  const failure = state.error || syncError;
  return <>{children}{failure && <aside className="backend-error" role="alert"><p>{failure}</p><div><button type="button" disabled={retrying} onClick={retry}><RefreshCw size={14} />다시 시도</button>{state.pending > 0 && <><button type="button" onClick={download}><Download size={14} />내 변경 보관</button><button type="button" disabled={retrying} onClick={async () => { if (window.confirm("아직 서버에 저장되지 않은 변경을 버리고 최신 자료로 바꿀까요? 필요하면 먼저 내 변경을 보관해 주세요.")) { setRetrying(true); try { await discardBackendWrites(); setSyncError(""); } catch (e) { setSyncError((e as Error).message); } finally { setRetrying(false); } } }}>서버 자료로 복원</button></>}</div></aside>}</>;
}
