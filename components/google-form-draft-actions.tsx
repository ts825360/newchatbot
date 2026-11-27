"use client";

import Link from "next/link";
import { ExternalLink, FilePlus2, Link2, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { BackendError, backendFetch, flushBackendWrites } from "@/lib/backend-client";
import { googleSettingsHref } from "@/lib/google-settings";
import { Button } from "./ui";

const endpoint = "/api/integrations/google-form-drafts";
const post = (data: object) => backendFetch(endpoint, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});
type Status = { configured: boolean; connected: boolean; needsReconnect?: boolean };

function validEditorUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/docs\.google\.com\/forms\/d\/[A-Za-z0-9_-]{8,128}\/edit$/.test(value);
}

export function GoogleFormDraftActions({ scope, onUseEditorUrl, showConsent = true, initialTitle = "수련회 참가 설문", initiallyExpanded = false, work }: {
  showConsent?: boolean;
  scope?: { roomId: string; conversationId: string };
  onUseEditorUrl?: (url: string) => void;
  initialTitle?: string;
  initiallyExpanded?: boolean;
  work?: { workId: string; version: number };
}) {
  const manages = !scope;
  const panelId = useId();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [status, setStatus] = useState<Status>();
  const [check, setCheck] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "create" | "">("");
  const [title, setTitle] = useState(initialTitle);
  const [editorUrl, setEditorUrl] = useState("");
  const [error, setError] = useState("");
  const wantsStatus = manages || expanded;

  useEffect(() => {
    if (!wantsStatus) return;
    let current = true;
    void backendFetch(endpoint).then((value: Status) => {
      if (typeof value?.configured !== "boolean" || typeof value?.connected !== "boolean") throw new Error("Invalid status");
      if (current) { setStatus(value); setLoadError(false); }
    }).catch(() => { if (current) setLoadError(true); });
    return () => { current = false; };
  }, [wantsStatus, check]);

  const authorize = async (action: "connect" | "disconnect") => {
    if (!manages || busy) return;
    if (action === "disconnect" && !window.confirm("설문 생성 권한을 연결 해제할까요? Google에 있는 설문은 남습니다.")) return;
    setBusy(action); setError("");
    try {
      if (action === "connect") await flushBackendWrites();
      const result = await post({ action });
      if (action === "connect") {
        const url = new URL(result?.url);
        if (url.origin !== "https://accounts.google.com" || url.username || url.password) {
          throw new Error("Google 인증 주소를 확인하지 못했습니다.");
        }
        window.location.assign(url.href);
        return;
      }
      setStatus({ configured: status?.configured ?? false, connected: false });
      setEditorUrl("");
      setExpanded(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설문 생성 연결을 변경하지 못했습니다.");
    } finally { setBusy(""); }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!status?.connected || busy || !title.trim()) return;
    setBusy("create"); setEditorUrl(""); setError("");
    try {
      if (scope) await flushBackendWrites();
      const result = await post(work ? { action: "create-version", ...work, ...scope } : { action: "create", title: title.trim(), ...scope });
      if (!validEditorUrl(result?.editorUrl)) throw new Error("설문 편집 주소를 확인하지 못했습니다.");
      setEditorUrl(result.editorUrl);
      if (typeof result.warning === "string" && result.warning) setError(result.warning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설문 초안을 생성하지 못했습니다.");
      if (cause instanceof BackendError && cause.status === 409) {
        setStatus(undefined);
        setLoadError(false);
        setCheck((value) => value + 1);
      }
    } finally { setBusy(""); }
  };

  return <div className={manages && showConsent ? "mt-4 grid min-w-0 gap-2 border-t border-border pt-4" : "grid w-full min-w-0 gap-2"} aria-label={manages && showConsent ? "구글폼 생성 권한" : undefined}>
    {manages && showConsent && <h4 className="text-sm font-semibold">구글폼 생성 권한</h4>}
    <div className="flex flex-wrap items-center gap-2">
      {manages && showConsent && status && <>
        <span className="text-xs text-muted-foreground">{status.connected ? "생성 권한 연결됨" : status.needsReconnect ? "생성 권한 재동의 필요" : status.configured ? "생성 권한 연결 안 됨" : "서버 설정 필요"}</span>
        {!status.connected && <Button type="button" variant="outline" disabled={!status.configured || !!busy} onClick={() => void authorize("connect")}>
          <Link2 size={14} aria-hidden="true" />{busy === "connect" ? "연결 중" : status.needsReconnect ? "설문 생성 권한 다시 연결" : "설문 생성 권한 연결"}
        </Button>}
        {(status.connected || status.needsReconnect) && <Button type="button" variant="outline" disabled={!!busy} onClick={() => void authorize("disconnect")}>
          <Unplug size={14} aria-hidden="true" />설문 생성 권한 해제
        </Button>}
      </>}
      {(!manages || status?.connected) && <button type="button" className="lobby-secondary" aria-expanded={expanded} aria-controls={panelId}
        disabled={!!busy} onClick={() => setExpanded(!expanded)}><FilePlus2 size={15} aria-hidden="true" />수련회 설문 초안 만들기</button>}
    </div>
    {wantsStatus && !status && (loadError
      ? <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-danger" role="alert">생성 권한 상태를 확인하지 못했습니다.</p>
        <Button type="button" variant="outline" onClick={() => { setLoadError(false); setCheck(check + 1); }}><RefreshCw size={14} aria-hidden="true" />생성 권한 다시 확인</Button></div>
      : <p role="status" className="text-xs text-muted-foreground">생성 권한 확인 중...</p>)}
    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    <div id={panelId} hidden={!expanded}>
      {!manages && status && !status.connected && <div className="flex flex-wrap items-center gap-2">
        {!status.configured && <span className="text-xs text-muted-foreground">서버 설정 필요</span>}
        <Link className="lobby-secondary" href={googleSettingsHref("forms")}>
          <Link2 size={14} aria-hidden="true" />환경설정에서 생성 권한 연결
        </Link>
      </div>}
      {expanded && status?.connected && <form className="grid w-full min-w-0 gap-2 rounded-md border border-border p-3" onSubmit={(event) => void create(event)}>
        <label className="grid min-w-0 gap-1 text-sm font-medium">설문 제목
          <input type="text" className="w-full min-w-0 rounded-md border border-border bg-panel px-3 py-2" required maxLength={100} value={title} disabled={!!busy}
            readOnly={!!work} onChange={(event) => { setTitle(event.target.value); setEditorUrl(""); setError(""); }} />
        </label>
        <p className="text-xs text-muted-foreground">{work ? `검토 버전 ${work.version}의 문항 그대로 Google Forms에 미게시 초안을 만듭니다.` : "새 초안은 게시하지 않습니다. 같은 제목의 기존 설문은 Google에서 게시 상태를 확인해 주세요."}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!!busy || !title.trim()}><FilePlus2 size={14} aria-hidden="true" />{busy === "create" ? "초안 생성 중" : work ? "승인하고 Google Forms에 생성" : "초안 생성"}</Button>
          {editorUrl && <a className="lobby-secondary" href={editorUrl} rel="noopener noreferrer" target="_blank"><ExternalLink size={14} aria-hidden="true" />구글폼에서 설문 편집</a>}
          {editorUrl && onUseEditorUrl && <Button type="button" variant="outline" onClick={() => onUseEditorUrl(editorUrl)}><Link2 size={14} aria-hidden="true" />편집 주소 입력</Button>}
        </div>
      </form>}
    </div>
  </div>;
}
