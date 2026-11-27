"use client";

import { CalendarDays, CircleAlert, CircleCheck, CircleX, FilePlus2, FileSpreadsheet, Link2, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { backendFetch, flushBackendWrites } from "@/lib/backend-client";
import { googleConnectionFeatures, type GoogleAccountStatus, type GoogleConnectionFeature, type GoogleDiagnosticState, type GoogleDiagnostics } from "@/lib/google-settings";
import { GoogleFormDraftActions } from "./google-form-draft-actions";
import { AccountFormsPreview } from "./google-forms-connection";
import { BlankGoogleFormLink } from "./google-forms-sharing";
import { Badge, Button } from "./ui";

const endpoint = "/api/integrations/google/account-";
const services = {
  calendar: { name: "Google Calendar", label: "캘린더 전송", icon: CalendarDays, description: "확정된 행사 일정 전송" },
  formsRead: { name: "Google Forms", label: "설문 문항·응답 읽기", icon: FileSpreadsheet, description: "설문 문항 및 응답 불러오기" },
  formsCreate: { name: "Google Forms", label: "설문 생성", icon: FilePlus2, description: "새로운 설문 생성" },
} as const;
const usable = (status: GoogleAccountStatus[GoogleConnectionFeature]) => status?.configured && status.connected && !status.needsReconnect;
const diagnosticLabels: Record<GoogleDiagnosticState, { label: string; hint?: string }> = {
  server_setup: { label: "서버 설정 필요", hint: "관리자에게 Google 앱 설정을 문의해 주세요." },
  unconnected: { label: "미연결" },
  reconnect: { label: "재동의 필요", hint: "다시 연결해 주세요." },
  expired: { label: "인증 만료·철회", hint: "다시 연결해 주세요." },
  insufficient_scope: { label: "권한 부족", hint: "다시 연결하고 이 기능을 허용해 주세요." },
  error: { label: "연결 오류", hint: "잠시 후 다시 테스트해 주세요." },
  verified: { label: "인증 확인됨" },
};

export function GoogleAccountConnection({ calendar, forms, anchor }: { calendar: boolean; forms: boolean; anchor: "calendar" | "forms" | null }) {
  const id = useId();
  const [status, setStatus] = useState<GoogleAccountStatus>();
  const [diagnostics, setDiagnostics] = useState<GoogleDiagnostics>();
  const [excluded, setExcluded] = useState<GoogleConnectionFeature[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "test" | null>(null);
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const pending = useRef(false);
  const visible = googleConnectionFeatures.filter(feature => feature === "calendar" ? calendar : forms);
  const selected = visible.filter(feature => status?.[feature]?.configured && !excluded.includes(feature));
  const isUsable = (feature: GoogleConnectionFeature) => usable(status?.[feature]) && !["expired", "insufficient_scope", "server_setup"].includes(diagnostics?.[feature] ?? "");
  const connected = visible.filter(feature => diagnostics?.[feature] ? diagnostics[feature] === "verified" : usable(status?.[feature])).length;
  const configurable = visible.some(feature => status?.[feature]?.configured);
  const needsServerSetup = !!status && !configurable;
  const hasConnection = visible.some(feature => status?.[feature]?.connected || status?.[feature]?.needsReconnect);
  const canTest = visible.some(feature => usable(status?.[feature]));

  useEffect(() => {
    let active = true;
    void backendFetch(endpoint + "status").then(result => { if (active) setStatus(result); })
      .catch(() => { if (active) setError("Google 연결 상태를 확인하지 못했습니다."); });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (anchor && status) document.getElementById(`google-${anchor}`)?.scrollIntoView?.({ block: "nearest" });
  }, [anchor, status]);

  async function action(type: "connect" | "disconnect" | "test") {
    if (pending.current) return;
    if (type === "connect" && !selected.length) return;
    if (type === "test" && !canTest) return;
    if (type === "disconnect" && !window.confirm("행사비서의 Google 연결을 모두 해제할까요? 이미 전송한 일정과 Google 설문은 그대로 남습니다.")) return;
    pending.current = true;
    setBusy(type); setError(""); setDisconnected(false);
    try {
      if (type === "connect") {
        await flushBackendWrites();
        const result = await backendFetch(endpoint + type, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ features: selected }) });
        const url = new URL(result.url);
        if (url.origin !== "https://accounts.google.com" || url.username || url.password) throw new Error("Google 인증 주소를 확인하지 못했습니다.");
        window.location.assign(url.href);
      } else if (type === "test") {
        setDiagnostics(await backendFetch(endpoint + type, { method: "POST" }));
      } else {
        setStatus(await backendFetch(endpoint + type, { method: "POST" }));
        setDiagnostics(undefined);
        setDisconnected(true);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Google 연결 요청을 완료하지 못했습니다."); }
    finally { pending.current = false; setBusy(null); }
  }

  function row(feature: GoogleConnectionFeature) {
    const item = status?.[feature];
    const { name, label, icon: Icon, description } = services[feature];
    const fieldId = `${id}-${feature}`;
    const checked = diagnostics?.[feature];
    const details = checked ? diagnosticLabels[checked] : undefined;
    const stateLabel = needsServerSetup ? "미연결" : details?.label ?? (!item?.configured ? "서버 설정 필요" : item.needsReconnect ? "재동의 필요" : item.connected ? "연결됨" : "미연결");
    const StateIcon = stateLabel === "연결됨" || checked === "verified" ? CircleCheck : stateLabel === "미연결" ? CircleX : CircleAlert;
    return <div className="settings-google-row">
      <div className="settings-google-label"><span className="settings-google-symbol"><Icon size={20} aria-hidden="true" /></span><span><strong>{name}</strong><small>{description}</small></span></div>
      <div className="settings-google-status" data-state={StateIcon === CircleCheck ? "good" : StateIcon === CircleX ? "off" : "warning"}>
        <span id={`${fieldId}-status`}><StateIcon size={16} aria-hidden="true" />{stateLabel}</span>
        {details?.hint && <small>{details.hint}</small>}
      </div>
      {configurable && <label className="settings-google-choice" title={`${label} 권한을 동의에 포함`}>
        <input id={fieldId} type="checkbox" aria-label={label} aria-describedby={`${fieldId}-status`}
          checked={!!item?.configured && !excluded.includes(feature)} disabled={!!busy || !item?.configured}
          onChange={event => { const checked = event.target.checked; setExcluded(current => checked ? current.filter(value => value !== feature) : [...current, feature]); }} />
      </label>}
    </div>;
  }

  return <>
    <section className="settings-google" aria-labelledby={`${id}-account`} aria-busy={!!busy || (!status && !error)}>
      <header className="settings-google-heading">
        <div className="settings-google-label"><span className="settings-google-symbol settings-google-brand" aria-hidden="true">G</span><div><h4 id={`${id}-account`}>Google 계정</h4>
          {status && <small>{hasConnection ? `${connected} / ${visible.length} 연결됨` : "연결된 계정 없음"}</small>}
        </div></div>
        {status && <Badge tone={connected ? "green" : "amber"}>{connected ? connected < visible.length ? "일부 연결됨" : "연결됨" : hasConnection ? "확인 필요" : "연결되지 않음"}</Badge>}
      </header>
      {needsServerSetup && <div className="settings-google-setup">
        <strong><CircleAlert size={18} aria-hidden="true" />관리자의 서버 설정이 필요합니다.</strong>
        <p>Google 계정 연결에 필요한 서버 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.</p>
        {!!status?.setup?.missing.length && <ul aria-label="누락된 서버 설정">{status.setup.missing.map(item => <li key={item}><code>{item}</code></li>)}</ul>}
        {status?.setup?.invalidRedirect && <p><code>APP_BASE_URL</code>과 <code>GOOGLE_OAUTH_REDIRECT_URI</code>의 주소 설정을 확인해 주세요.</p>}
      </div>}
      {!status && !error && <p className="text-sm text-muted-foreground" role="status">연결 상태 확인 중...</p>}
      {status && <div className="settings-google-services"><h4>서비스별 연결 상태</h4><fieldset className="settings-google-list" data-configurable={configurable}>
        <legend className="sr-only">Google 동의 요청에 포함할 기능</legend>
        {configurable && <div className="settings-google-columns" aria-hidden="true"><span></span><span></span><span>동의에 포함</span></div>}
        {calendar && <div id="google-calendar" className="settings-connection">{row("calendar")}</div>}
        {forms && <div id="google-forms" className="settings-connection">{row("formsRead")}{row("formsCreate")}</div>}
      </fieldset></div>}
      <div className="settings-google-actions" data-setup={needsServerSetup}>
        {status && <Button type="button" variant="primary" disabled={!!busy || !selected.length} onClick={() => void action("connect")}>
          <Link2 size={16} aria-hidden="true" />{busy === "connect" ? "연결 중" : hasConnection ? "Google 계정 다시 연결" : "Google 계정 연결"}
        </Button>}
        {canTest && <Button type="button" variant="outline" disabled={!!busy} onClick={() => void action("test")}>
          <RefreshCw size={16} aria-hidden="true" />{busy === "test" ? "테스트 중" : "연결 테스트"}
        </Button>}
        {hasConnection && <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void action("disconnect")}>
          <Unplug size={16} aria-hidden="true" />{busy === "disconnect" ? "해제 중" : "Google 연결 모두 해제"}
        </Button>}
        {!status && error && <Button type="button" variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}><RefreshCw size={16} />다시 확인</Button>}
      </div>
      {needsServerSetup && <p className="settings-google-footnote">서버 설정이 완료되면 연결할 수 있습니다.</p>}
      {diagnostics && <p className="settings-google-footnote" role="status">최근 테스트는 Google 인증 및 권한만 확인했습니다. 일정 전송·설문 동작은 테스트하지 않았습니다.</p>}
      {disconnected && <p role="status" className="mt-2 text-sm">Google 연결을 해제했습니다.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
    {forms && <section aria-labelledby={`${id}-forms`} className="settings-google-tools">
      <h2 id={`${id}-forms`}>Google 설문 도구</h2>
      <div className="settings-google-create">
        <BlankGoogleFormLink />
        {isUsable("formsCreate") && <GoogleFormDraftActions showConsent={false} />}
      </div>
      {isUsable("formsRead") && <div className="settings-google-preview">
        <h3>설문 응답</h3>
        <AccountFormsPreview disabled={!!busy} allowConversationImport />
      </div>}
    </section>}
  </>;
}
