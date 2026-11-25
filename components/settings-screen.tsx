"use client";

import Link from "next/link";
import { ArrowLeft, Bell, Check, CircleAlert, CircleHelp, Link2, LockKeyhole, MessageSquare, Monitor, RotateCcw, Save, Settings, Sparkles, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  assistantEmojiLabels, assistantLengthLabels, assistantToneLabels, defaultAssistantPreferences, isAssistantPreferences,
  maxAssistantInstructionsLength, type AssistantPreferences
} from "@/lib/assistant-preferences";
import { backendFetch, flushBackendWrites, getBackendProfile } from "@/lib/backend-client";
import type { GoogleConnectionOutcome, GoogleConnectionService } from "@/lib/google-settings";
import { AUTH_CHANGED_EVENT, createBrowserAuth } from "@/lib/prototype-auth";
import type { UserProfile } from "@/lib/types";
import { GoogleAccountConnection } from "./google-account-connection";
import { ManagementShell } from "./management-shell";
import { AccountPreferences, AlertPreferences, DisplayPreferences, PasswordPreferences, SettingsHeading, SupportPreferences } from "./settings-sections";
import { WorkspaceBrandMark } from "./workspace-brand-mark";

const sections = [
  { id: "account", label: "내 계정", icon: UserRound, subtitle: "표시 이름과 계정 권한을 확인합니다." },
  { id: "display", label: "화면 및 접근성", icon: Monitor, subtitle: "이 브라우저의 테마, 글자 크기, 화면 밀도를 설정합니다." },
  { id: "notifications", label: "알림", icon: Bell, subtitle: "받을 수 있는 알림과 설정 위치를 확인합니다." },
  { id: "reply", label: "답변 스타일", icon: MessageSquare, subtitle: "행사비서의 말투, 답변 길이와 이모티콘 사용을 설정합니다." },
  { id: "security", label: "보안 및 개인정보", icon: LockKeyhole, subtitle: "비밀번호와 외부 서비스 권한을 관리합니다." },
  { id: "support", label: "도움말 및 지원", icon: CircleHelp, subtitle: "이용 안내를 확인하고 문제를 신고합니다." },
] as const;
type Section = typeof sections[number]["id"];
type Connection = "calendar" | "forms";
type Outcome = { connection: GoogleConnectionService; result: GoogleConnectionOutcome };
type LocationState = { section: Section; anchor: Connection | null; outcome: Outcome | null; fromWorkspace: boolean };

export function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const checkSession = () => {
      const current = getBackendProfile();
      setProfile(current);
      if (!current) router.replace("/login");
    };
    window.addEventListener(AUTH_CHANGED_EVENT, checkSession);
    checkSession();
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, checkSession);
  }, [router]);

  if (!profile) return <main className="management-guard"><p role="status">접속 확인 중...</p></main>;
  return <AccountSettings key={profile.accountId ?? profile.nickname} profile={profile} />;
}

function AccountSettings({ profile }: { profile: UserProfile }) {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [visitedReply, setVisitedReply] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const lastUrl = useRef("");
  const router = useRouter();
  const canChat = profile.permissions.includes("chat");
  const canConnectCalendar = profile.permissions.includes("viewCalendar");
  const canConnectForms = profile.permissions.includes("viewRoom");

  useEffect(() => {
    const syncLocation = () => {
      const url = new URL(window.location.href);
      // Keep the captured outcome when the same cleaned URL is read again.
      if (url.href === lastUrl.current) return;
      const anchor = url.hash === "#google-calendar" ? "calendar" : url.hash === "#google-forms" ? "forms" : null;
      const querySection = url.searchParams.get("section");
      const section = anchor || querySection === "connections" ? "security" : sections.find(item => item.id === querySection)?.id ?? "account";
      const connections = url.searchParams.getAll("connection");
      const results = url.searchParams.getAll("result");
      const [connection] = connections;
      const [result] = results;
      const outcome = (querySection === "connections" || querySection === "security")
        && connections.length === 1 && (connection === "calendar" || connection === "forms" || connection === "account")
        && results.length === 1 && (result === "connected" || result === "cancelled" || result === "failed" || (connection === "account" && result === "partial"))
        ? { connection, result } satisfies Outcome : null;
      if (anchor && querySection !== "connections") url.searchParams.set("section", "connections");
      url.searchParams.delete("connection");
      url.searchParams.delete("result");
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
      lastUrl.current = url.href;
      setLocation({ section, anchor, outcome, fromWorkspace: url.searchParams.get("from") === "workspace" });
      if (section === "reply") setVisitedReply(true);
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("hashchange", syncLocation);
    return () => {
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("hashchange", syncLocation);
    };
  }, []);

  const switchSection = (section: Section) => {
    if (location?.section === section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    url.searchParams.delete("connection");
    url.searchParams.delete("result");
    url.hash = "";
    window.history.pushState(window.history.state, "", url);
    lastUrl.current = url.href;
    setLocation({ section, anchor: null, outcome: null, fromWorkspace: url.searchParams.get("from") === "workspace" });
    if (section === "reply") setVisitedReply(true);
  };

  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!location) return;
    const currentIndex = sections.findIndex(({ id }) => id === location.section);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sections.length - 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (currentIndex + 1) % sections.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (currentIndex + sections.length - 1) % sections.length;
    else return;
    event.preventDefault();
    const next = sections[nextIndex].id;
    document.getElementById(`settings-tab-${next}`)?.focus();
    switchSection(next);
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(false);
    try {
      await flushBackendWrites();
      await createBrowserAuth().logout();
      router.replace("/login");
    } catch {
      setLogoutError(true);
    } finally {
      setLoggingOut(false);
    }
  };

  const framed = location?.section === "account" || location?.section === "display";

  return <ManagementShell page="settings" profile={profile} onLogout={logout} logoutBusy={loggingOut}>
    <div className="management-content settings-content" data-layout={framed ? "framed" : "section"}>
      <header className={`management-title settings-page-heading${!framed && !location?.fromWorkspace ? " sr-only" : ""}`}><div><Settings size={28} aria-hidden="true" /><h1>환경설정</h1></div>
        {location?.fromWorkspace && <Link href="/workspace" className="lobby-secondary"><ArrowLeft size={16} aria-hidden="true" />대화로 돌아가기</Link>}
      </header>
      {logoutError && <p className="settings-error" role="alert">로그아웃하지 못했습니다. 다시 시도해 주세요.</p>}
      {location && <div className="settings-layout">
        <div className="settings-menu" role="tablist" aria-label="환경설정 분류" aria-orientation="vertical" onKeyDown={navigateTabs}>
          {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" id={`settings-tab-${id}`}
            aria-controls={`settings-panel-${id}`} aria-selected={location.section === id} tabIndex={location.section === id ? 0 : -1}
            onClick={() => switchSection(id)}><Icon size={20} aria-hidden="true" /><span>{label}</span></button>)}
        </div>
        {sections.map(({ id, label, icon, subtitle }) => <section key={id} id={`settings-panel-${id}`} className="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${id}`} hidden={location.section !== id}>
          <SettingsHeading icon={icon} title={label} subtitle={subtitle} />
          {id === "account" && location.section === id && <AccountPreferences profile={profile} />}
          {id === "display" && location.section === id && <DisplayPreferences />}
          {id === "notifications" && location.section === id && <AlertPreferences canConnectCalendar={canConnectCalendar} />}
          {id === "reply" && (!canChat ? <p className="settings-empty">답변 스타일을 설정할 권한이 없습니다.</p> : visitedReply && <ReplyPreferences />)}
          {id === "support" && location.section === id && <SupportPreferences />}
          {id === "security" && location.section === id && <>
            <PasswordPreferences accountId={profile.accountId} />
            <section className="settings-security-block" aria-label="외부 서비스 연결">
            <h3><Link2 size={25} aria-hidden="true" />외부 서비스 연결</h3>
            {!canConnectCalendar && !canConnectForms && <p className="settings-empty">Google 연동을 관리할 권한이 없습니다.</p>}
            {(canConnectCalendar && location.outcome?.connection === "calendar" || canConnectForms && location.outcome?.connection === "forms"
              || (canConnectCalendar || canConnectForms) && location.outcome?.connection === "account") && <ConnectionOutcome outcome={location.outcome} />}
            {(canConnectCalendar || canConnectForms) && <GoogleAccountConnection calendar={canConnectCalendar} forms={canConnectForms} anchor={location.anchor} />}
            </section>
          </>}
        </section>)}
      </div>}
    </div>
  </ManagementShell>;
}

function ConnectionOutcome({ outcome }: { outcome: Outcome }) {
  const name = outcome.connection === "calendar" ? "Google 캘린더" : outcome.connection === "forms" ? "Google 설문지" : "Google 계정";
  const failed = outcome.result === "failed";
  const Icon = outcome.result === "connected" ? Check : CircleAlert;
  const message = outcome.result === "connected" ? "연동이 완료되었습니다."
    : outcome.result === "cancelled" ? "연동이 취소되었습니다." : "연동에 실패했습니다.";
  return <p className={`settings-banner settings-banner-${outcome.result}`} role={failed ? "alert" : "status"}>
    <Icon size={17} aria-hidden="true" />{outcome.result === "partial" ? "Google 계정: 일부 권한만 허용되었습니다. 기능별 연결 상태를 확인해 주세요." : `${name} ${message}`}
  </p>;
}

const preferencesPath = "/api/preferences";
const equalPreferences = (left: AssistantPreferences, right: AssistantPreferences) => left.tone === right.tone && left.length === right.length
  && left.emoji === right.emoji && left.instructions === right.instructions && left.instructionsEnabled === right.instructionsEnabled;

function ReplyPreferences() {
  const [saved, setSaved] = useState<AssistantPreferences | null>(null);
  const [draft, setDraft] = useState<AssistantPreferences | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  useEffect(() => {
    let current = true;
    void backendFetch(preferencesPath).then((value: unknown) => {
      if (!isAssistantPreferences(value)) throw new Error("Invalid preferences response");
      if (current) { setSaved(value); setDraft(value); }
    }).catch(() => { if (current) setLoadFailed(true); });
    return () => { current = false; };
  }, [attempt]);

  const dirty = saved !== null && draft !== null && !equalPreferences(saved, draft);
  const saving = saveStatus === "saving";
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !dirty || saving) return;
    setSaveStatus("saving");
    try {
      const response: unknown = await backendFetch(preferencesPath, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!isAssistantPreferences(response)) throw new Error("Invalid preferences response");
      setSaved(response);
      setDraft(response);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("failed");
    }
  };

  if (loadFailed) return <div className="settings-empty settings-load-error">
    <p className="settings-error" role="alert">답변 스타일을 불러오지 못했습니다.</p>
    <button type="button" className="lobby-secondary" onClick={() => { setLoadFailed(false); setAttempt((value) => value + 1); }}>
      <RotateCcw size={15} aria-hidden="true" />다시 시도
    </button>
  </div>;
  if (!draft) return <p className="settings-empty" role="status">답변 스타일을 불러오는 중...</p>;

  const update = (value: AssistantPreferences) => { setDraft(value); setSaveStatus("idle"); };

  return <div className="settings-with-preview"><form className="settings-preferences" onSubmit={save}>
    <PreferenceOptions label="말투" hint="행사비서가 답변할 때의 말투입니다." name="tone" value={draft.tone} labels={assistantToneLabels} descriptions={{ standard: "정중하고 자연스럽게", friendly: "편하고 부드럽게", direct: "핵심부터 간결하게" }} disabled={saving}
      onChange={(tone) => update({ ...draft, tone })} />
    <PreferenceOptions label="답변 길이" hint="답변에 포함할 설명의 양입니다." name="length" value={draft.length} labels={assistantLengthLabels} descriptions={{ brief: "핵심만 간단히", balanced: "일반적인 길이", detailed: "배경과 예시까지" }} disabled={saving}
      onChange={(length) => update({ ...draft, length })} />
    <PreferenceOptions label="이모티콘" hint="답변에 이모티콘을 넣을지 선택합니다." name="emoji" value={draft.emoji} labels={assistantEmojiLabels} descriptions={{ off: "이모티콘 없이", occasional: "필요한 경우에만" }} disabled={saving}
      onChange={(emoji) => update({ ...draft, emoji })} />
    <div className="settings-instructions">
      <label className="settings-instructions-label" htmlFor="settings-instructions">내 답변 지침 <small>(선택)</small></label>
      <textarea id="settings-instructions" rows={5} maxLength={maxAssistantInstructionsLength}
        aria-describedby="settings-instructions-privacy settings-instructions-count" value={draft.instructions} disabled={saving}
        onChange={(event) => update({ ...draft, instructions: event.target.value })} />
      <span id="settings-instructions-count" className="settings-instructions-count">{draft.instructions.length} / {maxAssistantInstructionsLength}자</span>
      <p id="settings-instructions-privacy" className="settings-instructions-privacy">개인 지침은 저장되지만 OpenAI에 자동으로 전송하거나 답변에 적용하지 않습니다. 말투, 길이, 이모티콘 설정은 답변에 적용됩니다.</p>
    </div>
    <div className="settings-actions">
      <p className={`settings-save-status${saveStatus === "failed" ? " settings-error" : ""}`} role={saveStatus === "failed" ? "alert" : "status"}>
        {saving ? "저장 중..." : saveStatus === "saved" ? "답변 스타일을 저장했습니다."
          : saveStatus === "failed" ? "답변 스타일을 저장하지 못했습니다. 다시 시도해 주세요."
          : dirty ? "저장하지 않은 변경사항이 있습니다." : ""}
      </p>
      <div className="settings-action-buttons">
        <button className="lobby-secondary" type="button" disabled={saving || equalPreferences(draft, defaultAssistantPreferences)}
          onClick={() => update(defaultAssistantPreferences)}><RotateCcw size={15} aria-hidden="true" />기본값으로 되돌리기</button>
        <button className="lobby-primary" type="submit" disabled={saving || !dirty}><Save size={15} aria-hidden="true" />저장</button>
      </div>
    </div>
  </form><aside className="settings-preview settings-reply-preview" aria-label="답변 미리보기">
    <h3><Sparkles size={19} aria-hidden="true" />답변 미리보기</h3>
    <p className="settings-empty">예시 답변이며, 입력한 개인 지침은 반영하지 않습니다.</p>
    <div className="settings-preview-thread"><p>수련회 준비는 어디서부터 시작하면 좋을까요?</p>
      <div><span className="settings-preview-brand"><WorkspaceBrandMark size={19} /></span><div>
        <p>{draft.tone === "friendly" ? "좋아요, 한 가지씩 준비해 봐요!" : draft.tone === "direct" ? "날짜와 장소부터 확정하세요." : "먼저 행사 날짜와 장소를 확인해 주세요."}{draft.emoji === "occasional" && " \u2728"}</p>
        {draft.length !== "brief" && <ol><li><strong>기본 계획 수립</strong><p>날짜, 장소, 예상 참가 인원을 확인해요.</p></li><li><strong>준비 항목 정리</strong><p>숙소, 식사, 차량을 체크리스트에 넣어요.</p></li><li><strong>담당자 지정</strong><p>항목별 담당자와 확인 기한을 정해요.</p></li></ol>}
        {draft.length === "detailed" && <p>날짜가 미정이라면 가능한 주말을 2~3개 먼저 정해 의견을 모아 보세요.</p>}
      </div></div>
    </div>
  </aside></div>;
}

function PreferenceOptions<T extends string>({ label, hint, name, value, labels, descriptions, disabled, onChange }: {
  label: string; hint: string; name: string; value: T; labels: Readonly<Record<T, string>>; descriptions: Readonly<Record<T, string>>; disabled: boolean; onChange: (value: T) => void;
}) {
  return <fieldset className="settings-option-group" disabled={disabled}>
    <legend>{label}</legend>
    <p className="settings-field-hint">{hint}</p>
    <div className="settings-options">
      {(Object.keys(labels) as T[]).map((option) => <label key={option} className="settings-option">
        <input type="radio" name={name} value={option} checked={value === option} aria-label={labels[option]} onChange={() => onChange(option)} />
        <span><strong>{labels[option]}</strong><small>{descriptions[option]}</small></span>
      </label>)}
    </div>
  </fieldset>;
}
