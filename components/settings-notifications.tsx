"use client";

import { Bell, CalendarDays, Check, Folder, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { backendFetch } from "@/lib/backend-client";
import { isNotificationPreferences, notificationCategories, type NotificationPreferences, type NotificationState } from "@/lib/notification-preferences";
import { googleSettingsHref } from "@/lib/google-settings";

const dateLabel = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });
const endpoint = "/api/notifications";

function AlertSwitch({ icon: Icon, title, description, checked, disabled, onChange }: {
  icon: LucideIcon; title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return <label className="settings-alert-switch-row">
    <Icon size={19} aria-hidden="true" />
    <span><strong>{title}</strong><small id={descriptionId}>{description}</small></span>
    <span className="settings-alert-switch">
      <input type="checkbox" role="switch" aria-label={title} aria-describedby={descriptionId} checked={checked} disabled={disabled}
        onChange={event => onChange(event.currentTarget.checked)} /><span aria-hidden="true" />
    </span>
  </label>;
}

export function SettingsNotifications({ accountId, canViewRoom, canConnectCalendar }: { accountId: string; canViewRoom: boolean; canConnectCalendar: boolean }) {
  const [state, setState] = useState<NotificationState | null>(null);
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void backendFetch(endpoint, { signal: controller.signal, headers: { "x-account-id": accountId } }).then((result: NotificationState) => {
      if (!isNotificationPreferences(result?.settings) || !Array.isArray(result.items)) throw new Error();
      if (!controller.signal.aborted) { setState(result); setDraft(result.settings); }
    }).catch(() => { if (!controller.signal.aborted) setError("알림 설정을 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [accountId, reload]);

  const dirty = !!draft && !!state && (draft.enabled !== state.settings.enabled || draft.calendar !== state.settings.calendar || draft.room !== state.settings.room);
  const update = (key: keyof NotificationPreferences, value: boolean) => {
    setDraft(previous => previous && { ...previous, [key]: value }); setStatus(""); setError("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || !draft || busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const result: NotificationState = await backendFetch(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json", "x-account-id": accountId }, body: JSON.stringify(draft),
      });
      if (!isNotificationPreferences(result?.settings) || !Array.isArray(result.items)) throw new Error();
      setState(result); setDraft(result.settings); setStatus("알림 설정을 저장했습니다.");
    } catch { setError("알림 설정을 저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };
  return <div className="settings-alerts">
    <form onSubmit={save}>
      <section className="settings-alert-band" aria-labelledby="alert-channels"><header><h3 id="alert-channels">알림 수신 방법</h3><p>일반 알림은 행사비서 안에서 확인할 수 있습니다.</p></header>
        <div>{draft ? <AlertSwitch icon={Bell} title="일반 알림 받기" description="끄면 새 일반 알림을 받지 않습니다. 이전 기록과 개별 설정은 유지됩니다."
          checked={draft.enabled} disabled={busy} onChange={value => update("enabled", value)} /> : error ?
          <button type="button" className="lobby-secondary" onClick={() => { setError(""); setReload(n => n + 1); }}>다시 불러오기</button> :
          <p role="status" className="settings-empty">알림 설정을 불러오는 중…</p>}</div>
      </section>
      {draft && <section className="settings-alert-band" aria-labelledby="alert-items"><header><h3 id="alert-items">알림 항목</h3><p>받고 싶은 활동만 선택하세요.</p></header>
        <div>
          {canViewRoom && canConnectCalendar && <AlertSwitch icon={CalendarDays} {...notificationCategories.calendar} checked={draft.calendar}
            disabled={busy || !draft.enabled} onChange={value => update("calendar", value)} />}
          {canViewRoom && <AlertSwitch icon={Folder} {...notificationCategories.room} checked={draft.room}
            disabled={busy || !draft.enabled} onChange={value => update("room", value)} />}
          {!canViewRoom && <p className="settings-empty">현재 권한으로 받을 수 있는 행사 알림이 없습니다.</p>}
        </div>
      </section>}
      <div className="settings-actions">
        <p className={error ? "settings-error" : "settings-save-status"} role={error ? "alert" : "status"}>{error || status}</p>
        {draft && <button type="submit" className="lobby-primary" disabled={!dirty || busy}><Check size={16} aria-hidden="true" />{busy ? "저장 중…" : "저장"}</button>}
      </div>
    </form>
    {state && <section className="settings-alert-band" aria-labelledby="alert-history"><header><h3 id="alert-history">최근 받은 알림</h3></header>
      {state.items.length > 0 ? <ul className="settings-alert-history">{state.items.map(item => <li key={item.id}>
        <strong>{item.roomName}</strong><span>{item.kind === "calendar" ? "공동 일정이 변경됐습니다." : "행사방 정보가 변경됐습니다."}</span>
        <time dateTime={item.createdAt}>{dateLabel.format(new Date(item.createdAt))}</time>
      </li>)}</ul> : <p className="settings-empty">받은 알림이 없습니다.</p>}
    </section>}
    <section className="settings-alert-band settings-alert-details" aria-labelledby="alert-details"><header><h3 id="alert-details">알림 세부 설정</h3></header>
      <div><p>계정 보안, 필수 운영 안내와 현재 작업의 저장·오류 안내는 일반 알림과 별개입니다.</p>
      {canConnectCalendar && <><p>Google로 보낸 일정의 알림과 반복은 Google 캘린더에서 관리합니다.</p><a href={googleSettingsHref("calendar")} className="lobby-secondary">캘린더 연동 관리</a></>}</div>
    </section>
  </div>;
}
