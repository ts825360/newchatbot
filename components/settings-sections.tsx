"use client";

import Link from "next/link";
import { Bell, CalendarDays, Check, CircleCheck, Eye, Info, KeyRound, ListChecks, LockKeyhole, Mail, MessageCircle, Monitor, Moon, Phone, RotateCcw, ShieldCheck, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { backendFetch, flushBackendWrites } from "@/lib/backend-client";
import { refreshServerAuth } from "@/lib/client-auth";
import { googleSettingsHref } from "@/lib/google-settings";
import type { UserProfile } from "@/lib/types";
import { defaultDisplay, readDisplaySettings, saveDisplaySettings, type DisplaySettings } from "@/lib/use-theme";
import { RoomDialog } from "./room-dialog";
import { SupportButton } from "./support-dialog";
import { Badge, Field, inputClass } from "./ui";
import { WorkspaceBrandMark } from "./workspace-brand-mark";

export function SettingsHeading({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return <header className="settings-section-heading"><Icon size={31} aria-hidden="true" /><div><h2>{title}</h2><p>{subtitle}</p></div></header>;
}

function Row({ icon: Icon, title, description, children }: { icon?: LucideIcon; title: string; description?: string; children?: ReactNode }) {
  return <div className="settings-row">
    <div className="settings-row-label">{Icon && <Icon size={19} aria-hidden="true" />}<div><strong>{title}</strong>{description && <p>{description}</p>}</div></div>
    <div className="settings-row-value">{children}</div>
  </div>;
}

const postAccount = (action: string, data: unknown) => backendFetch(`/api/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const failureMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

export function AccountPreferences({ profile }: { profile: UserProfile }) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState(profile.nickname);
  const [savedName, setSavedName] = useState(profile.nickname);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const canManage = (profile.grade === 1 || profile.grade === 2) && profile.permissions.includes("manageMembers");
  useEffect(() => {
    const controller = new AbortController();
    void backendFetch("/api/auth/account", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted && typeof value.username === "string") setUsername(value.username);
    }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !profile.accountId || !name.trim() || name.trim() === savedName) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await flushBackendWrites();
      const result = await postAccount("display-name", { accountId: profile.accountId, name: name.trim() });
      if (typeof result.name !== "string") throw new Error("저장된 이름을 확인하지 못했습니다.");
      setSavedName(result.name); setName(result.name); setNotice("표시 이름을 저장했습니다.");
      await refreshServerAuth().catch(() => setNotice("표시 이름은 저장되었습니다. 상단 계정 표시를 갱신하려면 새로고침해 주세요."));
    } catch (cause) { setError(failureMessage(cause, "표시 이름을 저장하지 못했습니다.")); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="settings-account-form">
    <Row title="프로필">
      <div className="settings-profile"><span className="settings-avatar" aria-hidden="true">{Array.from(savedName.trim())[0] || "관"}</span>
        <div><strong>{savedName}</strong><p>표시 이름의 첫 글자가 프로필에 표시됩니다.</p></div></div>
    </Row>
    <div className="settings-row"><label className="settings-row-label" htmlFor="settings-display-name"><strong>표시 이름</strong></label>
      <div className="settings-account-field"><input id="settings-display-name" className={inputClass} maxLength={20} value={name} disabled={busy || !profile.accountId} onChange={event => { setName(event.target.value); setNotice(""); setError(""); }} aria-describedby="settings-name-help" required /><p id="settings-name-help">행사비서에서 다른 화면에 표시되는 이름입니다.</p></div></div>
    <Row title="로그인 아이디"><div className="settings-account-field"><p className="settings-readonly-value">{username || (loading ? "불러오는 중…" : "확인할 수 없음")}</p><p>로그인에 사용하는 아이디입니다.</p></div></Row>
    <Row title="관리자 등급" description={profile.duty || profile.role}><Badge tone="blue">{profile.grade ? `제${profile.grade}관리자` : "등급 미지정"}</Badge></Row>
    <Row title="관리 권한">
      <span>{profile.permissions.includes("inviteMember") && (profile.grade === 1 || profile.grade === 2) ? "초대코드 발급 가능" : "초대코드 발급 권한 없음"}</span>
      {canManage && <Link href="/members" className="lobby-secondary">구성원 관리</Link>}
      {profile.grade === 1 && <Link href="/admin" className="lobby-secondary">운영 관리</Link>}
    </Row>
    <div className="settings-actions">
      <p className={error ? "settings-error" : "settings-save-status"} role={error ? "alert" : "status"}>{error || notice}</p>
      <div className="settings-action-buttons"><button type="button" className="lobby-secondary" disabled={busy || name === savedName} onClick={() => { setName(savedName); setNotice(""); setError(""); }}>취소</button><button type="submit" className="lobby-primary" disabled={busy || !profile.accountId || !name.trim() || name.trim() === savedName}><Check size={16} aria-hidden="true" />{busy ? "저장 중…" : "저장"}</button></div>
    </div>
  </form>;
}

export function DisplayPreferences() {
  const [saved, setSaved] = useState(readDisplaySettings);
  const [draft, setDraft] = useState(saved);
  const [systemDark, setSystemDark] = useState(false);
  const [result, setResult] = useState<"idle" | "saved" | "error">("idle");
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media?.matches ?? false);
    sync();
    media?.addEventListener?.("change", sync);
    return () => media?.removeEventListener?.("change", sync);
  }, []);
  const dirty = draft.theme !== saved.theme || draft.size !== saved.size || draft.density !== saved.density;
  const update = (change: Partial<DisplaySettings>) => { setDraft(current => ({ ...current, ...change })); setResult("idle"); };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    try { saveDisplaySettings(draft); setSaved(draft); setResult("saved"); }
    catch { setResult("error"); }
  };
  const themes = [["light", "밝은 모드", Sun, "항상 밝은 화면"], ["dark", "어두운 모드", Moon, "항상 어두운 화면"], ["system", "시스템 설정", Monitor, "기기의 테마를 따름"]] as const;
  const sizes = [["small", "작게"], ["standard", "기본"], ["large", "크게"], ["largest", "아주 크게"]] as const;
  const densities = [["spacious", "넓게", "항목 사이 여백을 넓게"], ["standard", "기본", "기본 간격으로 표시"], ["compact", "촘촘하게", "같은 화면에 더 많은 항목 표시"]] as const;
  return <form className="settings-display-form" onSubmit={save}><div className="settings-with-preview">
    <div className="settings-preferences settings-display-fields">
      <fieldset className="settings-option-group"><legend>화면 테마</legend><p className="settings-field-hint">화면에 사용할 밝기와 색상 모드를 선택합니다.</p><div className="settings-options settings-display-themes">
        {themes.map(([id, label, Icon, description]) => <label key={id} className="settings-option settings-theme-option"><input type="radio" name="theme" aria-label={label} checked={draft.theme === id} onChange={() => update({ theme: id })} /><Icon size={24} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span></label>)}
      </div></fieldset>
      <fieldset className="settings-option-group"><legend>글자 크기</legend><p className="settings-field-hint">화면에 표시되는 글자의 크기를 조절합니다.</p><div className="settings-options settings-size-options">
        {sizes.map(([id, label]) => <label key={id} className="settings-option"><input type="radio" name="size" checked={draft.size === id} onChange={() => update({ size: id })} /><span>{label}</span><span aria-hidden="true" data-example-size={id}>가</span></label>)}
      </div></fieldset>
      <fieldset className="settings-option-group"><legend>화면 밀도</legend><p className="settings-field-hint">목록과 대화의 항목 사이 간격을 조절합니다.</p><div className="settings-options settings-density-options">
        {densities.map(([id, label, description]) => <label key={id} className="settings-option"><input type="radio" name="density" aria-label={label} checked={draft.density === id} onChange={() => update({ density: id })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}
      </div></fieldset>
      <p className="settings-display-tip"><Info size={16} aria-hidden="true" /><span>화면 설정은 이 브라우저에 저장됩니다.</span></p>
    </div>
    <aside className="settings-preview" aria-label="화면 미리보기">
      <h3><Eye size={19} aria-hidden="true" />미리보기</h3>
      <p className="settings-preview-caption">테마, 글자 크기와 간격이 바뀐 화면입니다.</p>
      <div className="settings-display-example" data-theme={draft.theme === "dark" || draft.theme === "system" && systemDark ? "dark" : "light"} data-size={draft.size} data-density={draft.density}>
        <div className="settings-example-title"><strong>청년부 수련회</strong><span>준비 진행 중</span></div>
        <div className="settings-example-tools" aria-hidden="true"><span><MessageCircle size={15} />대화</span><span><CalendarDays size={15} />일정</span><span><ListChecks size={15} />행사 준비</span></div>
        <div className="settings-example-chat"><div className="settings-example-assistant"><span className="settings-preview-brand"><WorkspaceBrandMark size={17} /></span><div><p>수련회 준비를 도와드릴까요?</p><small>오후 2:10</small></div></div>
          <div className="settings-example-user"><p>전체 일정을 정리해 주세요.</p><small>오후 2:11</small></div></div>
      </div>
    </aside>
  </div><div className="settings-actions"><p className={result === "error" ? "settings-error" : "settings-save-status"} role={result === "error" ? "alert" : "status"}>{result === "error" ? "이 브라우저에 설정을 저장하지 못했습니다." : result === "saved" ? "화면 설정을 저장했습니다." : ""}</p>
    <div className="settings-action-buttons"><button type="button" className="lobby-secondary" onClick={() => update(defaultDisplay)}><RotateCcw size={15} aria-hidden="true" />기본값으로 되돌리기</button><button type="submit" className="lobby-primary" disabled={!dirty}><Check size={16} aria-hidden="true" />저장</button></div>
  </div></form>;
}

export function AlertPreferences({ canConnectCalendar }: { canConnectCalendar: boolean }) {
  return <div className="settings-alerts">
    <section className="settings-alert-band" aria-labelledby="alert-channels"><header><h3 id="alert-channels">알림 수신 방법</h3><p>현재 사용할 수 있는 알림 채널입니다.</p></header>
      <div className="settings-alert-channels">
        <div data-available="true"><Bell size={20} aria-hidden="true" /><strong>앱 내 알림</strong><Badge tone="green">사용 중</Badge></div>
        <div><Mail size={20} aria-hidden="true" /><strong>이메일 알림</strong><Badge tone="neutral">미지원</Badge></div>
        <div><MessageCircle size={20} aria-hidden="true" /><strong>카카오톡 알림</strong><Badge tone="neutral">미지원</Badge></div>
      </div>
    </section>
    <section className="settings-alert-band" aria-labelledby="alert-items"><header><h3 id="alert-items">알림 항목</h3></header>
      <div><Row icon={Bell} title="저장·연결·오류" description="작업 결과는 해당 화면에 바로 표시됩니다." /><Row icon={CalendarDays} title="행사 일정" description="Google로 보낸 확정 일정의 알림은 Google 캘린더에서 받을 수 있습니다." /></div>
    </section>
    <section className="settings-alert-band" aria-labelledby="alert-details"><header><h3 id="alert-details">알림 세부 설정</h3></header>
      <div><Row title="Google 일정 알림" description="알림 시간과 반복은 Google 캘린더에서 설정합니다.">{canConnectCalendar && <a href={googleSettingsHref("calendar")} className="lobby-secondary">캘린더 연동 관리</a>}</Row></div>
    </section>
  </div>;
}

export function PasswordPreferences({ accountId }: { accountId?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const close = () => { if (!busy) { setOpen(false); setError(""); } };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !accountId) return;
    const entries = new FormData(event.currentTarget);
    const fields = Object.fromEntries(entries);
    if (fields.newPassword !== fields.confirmation) { setError("새 비밀번호와 확인 값이 다릅니다."); return; }
    setBusy(true); setError("");
    try {
      await flushBackendWrites();
      await postAccount("change-password", { accountId, ...fields });
      setOpen(false); setNotice("비밀번호를 변경했어요. 다른 기기의 기존 접속은 종료됐습니다.");
    } catch (cause) { setError(failureMessage(cause, "비밀번호를 변경하지 못했습니다.")); }
    finally { setBusy(false); }
  };
  return <section className="settings-security-block" aria-label="계정 보안">
    <h3><ShieldCheck size={25} aria-hidden="true" />계정 보안</h3>
    <Row icon={KeyRound} title="비밀번호 변경" description="변경하면 현재 브라우저를 제외한 기존 접속이 종료됩니다."><button type="button" className="lobby-secondary" disabled={!accountId} onClick={() => { setOpen(true); setNotice(""); }}>비밀번호 변경</button></Row>
    <Row icon={LockKeyhole} title="대화와 자료" description="개인 대화와 첨부 자료는 다른 구성원에게 공유되지 않습니다." />
    {notice && <p className="settings-save-status" role="status">{notice}</p>}
    {open && <RoomDialog title="비밀번호 변경" onClose={close}>
      <form onSubmit={save} className="settings-password-form">
        <div className="room-dialog-body">
          <Field label="현재 비밀번호"><input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" maxLength={72} required /></Field>
          <Field label="새 비밀번호"><input className={inputClass} name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
          <Field label="새 비밀번호 확인"><input className={inputClass} name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
          {error && <p role="alert" className="settings-error">{error}</p>}
        </div>
        <footer className="room-dialog-footer"><button className="lobby-secondary" type="button" onClick={close} disabled={busy}>취소</button><button className="lobby-primary" type="submit" disabled={busy}><Check size={15} aria-hidden="true" />{busy ? "변경 중…" : "비밀번호 변경"}</button></footer>
      </form>
    </RoomDialog>}
  </section>;
}

export function SupportPreferences() {
  return <><SupportButton screenName="환경설정" presentation="settings" />
    <div className="settings-support-footer">
      <section aria-labelledby="settings-service-state"><h3 id="settings-service-state"><CircleCheck size={21} aria-hidden="true" />서비스 상태</h3><Badge tone="green">로그인됨</Badge><p>현재 계정으로 접속 중입니다. Google 서비스별 연결 상태는 보안 및 개인정보에서 확인할 수 있습니다.</p></section>
      <section aria-labelledby="settings-contact"><h3 id="settings-contact"><Phone size={21} aria-hidden="true" />문의 및 연락처</h3><p>가입이나 접근 권한은 초대코드를 발급한 관리자에게 문의해 주세요.</p><p>공개 문의 연락처는 설정되어 있지 않습니다.</p></section>
    </div></>;
}
