"use client";

import { CalendarDays, FilePlus2, FileSpreadsheet, Link2, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { backendFetch, flushBackendWrites } from "@/lib/backend-client";
import { googleConnectionFeatures, type GoogleAccountStatus, type GoogleConnectionFeature } from "@/lib/google-settings";
import { GoogleFormDraftActions } from "./google-form-draft-actions";
import { AccountFormsPreview } from "./google-forms-connection";
import { BlankGoogleFormLink } from "./google-forms-sharing";
import { Badge, Button } from "./ui";

const endpoint = "/api/integrations/google/account-";
const services = {
  calendar: { label: "캘린더 전송", icon: CalendarDays, description: "확정 일정을 전용 Google 캘린더로 보냅니다." },
  formsRead: { label: "설문 문항·응답 읽기", icon: FileSpreadsheet, description: "기존 Google 설문의 문항과 응답을 불러옵니다." },
  formsCreate: { label: "설문 생성", icon: FilePlus2, description: "Google 계정에 새 설문을 만듭니다." },
} as const;
const usable = (status: GoogleAccountStatus[GoogleConnectionFeature]) => status?.configured && status.connected && !status.needsReconnect;

export function GoogleAccountConnection({ calendar, forms, anchor }: { calendar: boolean; forms: boolean; anchor: "calendar" | "forms" | null }) {
  const id = useId();
  const [status, setStatus] = useState<GoogleAccountStatus>();
  const [excluded, setExcluded] = useState<GoogleConnectionFeature[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const pending = useRef(false);
  const visible = googleConnectionFeatures.filter(feature => feature === "calendar" ? calendar : forms);
  const selected = visible.filter(feature => status?.[feature]?.configured && !excluded.includes(feature));
  const connected = visible.filter(feature => usable(status?.[feature])).length;
  const hasConnection = visible.some(feature => status?.[feature]?.connected || status?.[feature]?.needsReconnect);

  useEffect(() => {
    let active = true;
    void backendFetch(endpoint + "status").then(result => { if (active) setStatus(result); })
      .catch(() => { if (active) setError("Google 연결 상태를 확인하지 못했습니다."); });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (anchor && status) document.getElementById(`google-${anchor}`)?.scrollIntoView?.({ block: "nearest" });
  }, [anchor, status]);

  async function action(type: "connect" | "disconnect") {
    if (pending.current) return;
    if (type === "connect" && !selected.length) return;
    if (type === "disconnect" && !window.confirm("행사비서의 Google 연결을 모두 해제할까요? 이미 전송한 일정과 Google 설문은 그대로 남습니다.")) return;
    pending.current = true;
    setBusy(type); setError(""); setDisconnected(false);
    try {
      if (type === "connect") {
        await flushBackendWrites();
        const result = await backendFetch(endpoint + type, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ features: selected }) });
        const url = new URL(result.url);
        if (url.origin !== "https://accounts.google.com") throw new Error("Google 인증 주소를 확인하지 못했습니다.");
        window.location.assign(url.href);
      } else {
        setStatus(await backendFetch(endpoint + type, { method: "POST" }));
        setDisconnected(true);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Google 연결을 변경하지 못했습니다."); }
    finally { pending.current = false; setBusy(null); }
  }

  function row(feature: GoogleConnectionFeature) {
    const item = status?.[feature];
    const { label, icon: Icon, description } = services[feature];
    const fieldId = `${id}-${feature}`;
    const [stateLabel, tone] = !item?.configured ? ["서버 설정 필요", "amber"] as const : item.needsReconnect ? ["재동의 필요", "amber"] as const
      : item.connected ? ["연결됨", "green"] as const : ["연결 안 됨", "neutral"] as const;
    return <div className="settings-google-row">
      <label htmlFor={fieldId} className="settings-google-label"><span className="settings-google-symbol"><Icon size={20} aria-hidden="true" /></span><span><strong id={`${fieldId}-label`}>{label}</strong><small>{description}</small></span></label>
      <span id={`${fieldId}-status`} className="settings-google-status"><Badge tone={tone}>{stateLabel}</Badge></span>
      <label className="settings-google-choice">
        <input id={fieldId} type="checkbox" aria-labelledby={`${fieldId}-label`} aria-describedby={`${fieldId}-status`}
          checked={!!item?.configured && !excluded.includes(feature)} disabled={!!busy || !item?.configured}
          onChange={event => { const checked = event.target.checked; setExcluded(current => checked ? current.filter(value => value !== feature) : [...current, feature]); }} />
      </label>
    </div>;
  }

  return <>
    <section className="settings-google" aria-labelledby={`${id}-account`} aria-busy={!!busy || (!status && !error)}>
      <header className="settings-google-heading">
        <h2 id={`${id}-account`}>Google 계정</h2>
        {status && <span className="settings-google-count">{connected} / {visible.length} 연결됨</span>}
      </header>
      {!status && !error && <p className="text-sm text-muted-foreground" role="status">연결 상태 확인 중...</p>}
      {status && <fieldset className="settings-google-list">
        <legend className="sr-only">Google 동의 요청에 포함할 기능</legend>
        <div className="settings-google-columns" aria-hidden="true"><span>기능</span><span>연결 상태</span><span>동의에 포함</span></div>
        {calendar && <div id="google-calendar" className="settings-connection">{row("calendar")}</div>}
        {forms && <div id="google-forms" className="settings-connection">{row("formsRead")}{row("formsCreate")}</div>}
      </fieldset>}
      <div className="settings-google-actions">
        {status && <Button type="button" variant="primary" disabled={!!busy || !selected.length} onClick={() => void action("connect")}>
          <Link2 size={16} aria-hidden="true" />{busy === "connect" ? "연결 중" : hasConnection ? "Google 계정 다시 연결" : "Google 계정 연결"}
        </Button>}
        {hasConnection && <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void action("disconnect")}>
          <Unplug size={16} aria-hidden="true" />{busy === "disconnect" ? "해제 중" : "Google 연결 모두 해제"}
        </Button>}
        {!status && error && <Button type="button" variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}><RefreshCw size={16} />다시 확인</Button>}
      </div>
      {disconnected && <p role="status" className="mt-2 text-sm">Google 연결을 해제했습니다.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
    {forms && <section aria-labelledby={`${id}-forms`} className="settings-google-tools">
      <h2 id={`${id}-forms`}>Google 설문 도구</h2>
      <div className="settings-google-create">
        <BlankGoogleFormLink />
        {usable(status?.formsCreate) && <GoogleFormDraftActions showConsent={false} />}
      </div>
      {usable(status?.formsRead) && <div className="settings-google-preview">
        <h3>설문 응답</h3>
        <AccountFormsPreview disabled={!!busy} allowConversationImport />
      </div>}
    </section>}
  </>;
}
