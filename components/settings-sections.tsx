"use client";

import Link from "next/link";
import { CalendarDays, Check, Eye, Info, KeyRound, ListChecks, LockKeyhole, MessageCircle, Monitor, Moon, RotateCcw, ShieldCheck, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { backendFetch, flushBackendWrites } from "@/lib/backend-client";
import { refreshServerAuth } from "@/lib/client-auth";
import { externalAIConsentDetails, externalAIConsentTitle, openAIChatConsentVersion, openAIReplyContextConsentVersion, replyContextConsentDetails, replyContextConsentPath, replyContextConsentTitle } from "@/lib/assistant-privacy";
import type { UserProfile } from "@/lib/types";
import { defaultDisplay, readDisplaySettings, saveDisplaySettings, type DisplaySettings } from "@/lib/use-theme";
import { RoomDialog } from "./room-dialog";
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
  const [accountLookup, setAccountLookup] = useState<"loading" | "ready" | "failed">("loading");
  const [accountRetry, setAccountRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const canManage = (profile.grade === 1 || profile.grade === 2) && profile.permissions.includes("manageMembers");
  useEffect(() => {
    if (!profile.accountId) { setAccountLookup("failed"); return; }
    const controller = new AbortController();
    void backendFetch("/api/auth/account", { signal: controller.signal, headers: { "x-account-id": profile.accountId } }).then(value => {
      if (controller.signal.aborted) return;
      if (typeof value?.username !== "string" || !value.username.trim()) throw new Error();
      setUsername(value.username);
      setAccountLookup("ready");
    }).catch(() => { if (!controller.signal.aborted) setAccountLookup("failed"); });
    return () => controller.abort();
  }, [profile.accountId, accountRetry]);
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
    <Row title="로그인 아이디"><div className="settings-account-field">
      {accountLookup === "failed" ? <><p className="settings-error" role="alert">로그인 아이디를 불러오지 못했습니다.</p>
        <button type="button" className="lobby-secondary" onClick={() => { setAccountLookup("loading"); setAccountRetry(n => n + 1); }}>로그인 아이디 다시 불러오기</button></> :
        <p className="settings-readonly-value">{accountLookup === "ready" ? username : "불러오는 중…"}</p>}
      <p>로그인에 사용하는 아이디입니다.</p></div></Row>
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

export function ExternalAIPreferences({ accountId }: { accountId: string }) {
  const [approved, setApproved] = useState<boolean | null>(null);
  const [memoryApproved, setMemoryApproved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void backendFetch("/api/chat", { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setApproved(data.approved === true);
    }).catch(cause => { if (!controller.signal.aborted) setError(failureMessage(cause, "동의 상태를 불러오지 못했습니다.")); });
    return () => controller.abort();
  }, [accountId, reload]);

  useEffect(() => {
    if (approved !== true) return;
    const controller = new AbortController();
    setMemoryApproved(null);
    void backendFetch(replyContextConsentPath, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setMemoryApproved(data.approved === true);
    }).catch(cause => { if (!controller.signal.aborted) setError(failureMessage(cause, "이전 답변 설정을 불러오지 못했습니다.")); });
    return () => controller.abort();
  }, [accountId, approved, reload]);

  const update = async (value: boolean, memory = false) => {
    if (busy || approved === null || memory && (!approved || memoryApproved === null)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await backendFetch(memory ? replyContextConsentPath : "/api/chat", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, approved: value, version: memory ? openAIReplyContextConsentVersion : openAIChatConsentVersion }) });
      if (memory) {
        setMemoryApproved(result.approved === true);
        setNotice(result.approved === true ? "이전 AI 답변 사용을 허용했습니다." : "이전 AI 답변 사용을 해제했습니다.");
      } else {
        setApproved(result.approved === true);
        setNotice(result.approved === true ? "외부 AI 이용을 허용했습니다." : "외부 AI 이용을 해제했습니다.");
      }
    } catch (cause) { setError(failureMessage(cause, "동의 설정을 저장하지 못했습니다.")); }
    finally { setBusy(false); }
  };

  return <section id="external-ai" className="settings-security-block" aria-label="외부 AI 개인정보">
    <h3><LockKeyhole size={25} aria-hidden="true" />외부 AI 개인정보</h3>
    <Row title={externalAIConsentTitle} description={externalAIConsentDetails}>
      {approved === null ? error && <button type="button" className="lobby-secondary" onClick={() => setReload(reload + 1)}>다시 불러오기</button> :
        <label className="settings-ai-toggle"><input type="checkbox" checked={approved} onChange={event => void update(event.target.checked)} disabled={busy} aria-label={externalAIConsentTitle} />{approved ? "허용됨" : "미동의"}</label>}
    </Row>
    {approved === true && <Row title={replyContextConsentTitle} description={replyContextConsentDetails}>
      {memoryApproved === null ? error && <button type="button" className="lobby-secondary" onClick={() => setReload(reload + 1)}>이전 답변 설정 다시 불러오기</button> :
        <label className="settings-ai-toggle"><input type="checkbox" checked={memoryApproved} onChange={event => void update(event.target.checked, true)} disabled={busy} aria-label={replyContextConsentTitle} />{memoryApproved ? "허용됨" : "미동의"}</label>}
    </Row>}
    <p className="settings-row-hint">해제하면 이후 외부 AI 요청을 차단합니다. 이미 보낸 내용이나 저장된 대화는 삭제되지 않습니다.</p>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {notice && <p className="settings-save-status" role="status">{notice}</p>}
  </section>;
}
