"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Check, Copy, KeyRound, Link2, LoaderCircle, Plus, RotateCcw, Search, ShieldCheck, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createBrowserAuth } from "@/lib/prototype-auth";
import { isBackendConnected } from "@/lib/backend-client";
import type { CreatedInvitation, InvitationDraft, InvitationView, MemberView, OwnerOverview } from "@/lib/invitation-types";
import type { UserProfile } from "@/lib/types";
import { RoomDialog } from "./room-dialog";
import { ManagementShell } from "./management-shell";

const warning = "브라우저 체험용 · 같은 브라우저에서만 공유됩니다.";
const memberLabels = { active: "이용 중", suspended: "이용 정지", expired: "기간 만료" };
const invitationLabels = { unused: "미사용", used: "사용 완료", expired: "기간 만료", revoked: "취소됨" };
type Session = { profile: UserProfile | null; data: OwnerOverview | null; error: string };
type Confirmation = { kind: "member"; target: MemberView } | { kind: "invitation"; target: InvitationView };
type InviteForm = { label: string; grade: 2 | 3; role: string; signup: string; access: string; unlimited: boolean; permission: "viewer" | "chat" | "edit" };

export function managementError(cause: unknown) {
  return cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

export function memberStatus(member: MemberView): MemberView["status"] {
  return member.accessExpiresAt && Date.parse(member.accessExpiresAt) <= Date.now() ? "expired" : member.status;
}

export function invitationStatus(invite: InvitationView): InvitationView["status"] {
  return invite.status === "unused" && invite.signupExpiresAt && Date.parse(invite.signupExpiresAt) <= Date.now() ? "expired" : invite.status;
}

export function formatManagementTime(value: string | null) {
  if (!value) return "기한 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "기한 확인 필요";
  return `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)} KST`;
}

function formatAccessExpiry(value: string | null) {
  if (!value) return "기간 제한 없음";
  const date = new Date(Date.parse(value) - 1);
  if (!Number.isFinite(date.getTime())) return "기한 확인 필요";
  return `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)}까지`;
}

export function useManagementSession(scope: "members" | "owner") {
  const router = useRouter();
  const [session, setSession] = useState<Session>({ profile: null, data: null, error: "" });
  const refresh = useCallback(() => {
    try {
      const auth = createBrowserAuth();
      const profile = auth.currentProfile();
      if (!profile) {
        setSession({ profile: null, data: null, error: "" });
        router.replace("/login");
        return null;
      }
      const allowed = profile.grade === 1 || (scope === "members" && profile.grade === 2);
      const data = !allowed ? null : scope === "owner" ? auth.getOwnerOverview() : { members: auth.getMembers(), invitations: auth.getInvitations(), activities: [] };
      setSession({ profile, data, error: "" });
      return allowed ? profile : null;
    } catch (cause) {
      setSession({ profile: null, data: null, error: managementError(cause) });
      return null;
    }
  }, [router, scope]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("church-auth-changed", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("church-auth-changed", refresh);
      window.clearInterval(timer);
    };
  }, [refresh]);
  return { ...session, refresh };
}

export function ManagementGuard({ profile, error }: { profile: UserProfile | null; error: string }) {
  return <main className="management-guard">
    {error ? <p role="alert">{error}</p> : profile ? <><ShieldCheck size={28} aria-hidden="true" /><h1>접근 권한이 없습니다</h1></> : <p role="status">접속 확인 중...</p>}
    {(profile || error) && <Link href="/rooms" className="management-back"><ArrowLeft size={16} aria-hidden="true" />행사방 목록</Link>}
  </main>;
}

export function ManagementWarning() { return isBackendConnected() ? null : <p className="management-warning">{warning}</p>; }

function newInviteForm(): InviteForm {
  const kstNow = Date.now() + 9 * 60 * 60 * 1000;
  const year = new Date(kstNow).getUTCFullYear();
  const cutoffYear = kstNow < Date.UTC(year, 11, 1) ? year : year + 1;
  const signup = Math.min(kstNow + 7 * 24 * 60 * 60 * 1000, Date.UTC(cutoffYear, 11, 1));
  return { label: "", grade: 3, role: "", signup: new Date(signup).toISOString().slice(0, 16), access: `${cutoffYear}-11-30`, unlimited: false, permission: "edit" };
}

function accessCutoff(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  // UTC arithmetic operates on calendar fields; the resulting cutoff is explicitly KST.
  const nextDay = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)).toISOString().slice(0, 10);
  return `${nextDay}T00:00:00+09:00`;
}

function groupedCode(code: string) { return code.replace(/-/g, "").match(/.{1,4}/g)?.join("-") ?? code; }

export function MembershipScreen() {
  const router = useRouter();
  const { profile, data, error, refresh } = useManagementSession("members");
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MemberView["status"] | "all">("all");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<InviteForm>(newInviteForm);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const loggingOut = useRef(false);
  const dialogVersion = useRef(0);
  const submitting = useRef(false);

  const closeDialog = useCallback(() => {
    dialogVersion.current += 1;
    submitting.current = false;
    setCreateOpen(false); setCreated(null); setConfirmation(null);
    setDialogError(""); setCopyNotice(""); setBusy(false);
  }, []);
  useEffect(() => { closeDialog(); setNotice(""); setPageError(""); }, [profile?.accountId, profile?.grade, closeDialog]);
  useEffect(() => () => { dialogVersion.current += 1; }, []);

  const openCreate = () => { closeDialog(); setForm(newInviteForm()); setCreateOpen(true); };
  const updateForm = <K extends keyof InviteForm>(key: K, value: InviteForm[K]) => {
    setForm((current) => ({ ...current, [key]: value, ...(key === "grade" ? { unlimited: false } : {}) }));
    setDialogError("");
  };
  const logout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true; setLogoutBusy(true); setPageError("");
    try {
      const pending: unknown = createBrowserAuth().logout();
      if (pending) await pending;
      closeDialog(); refresh(); router.replace("/login");
    }
    catch (cause) { setPageError(managementError(cause)); }
    finally { loggingOut.current = false; setLogoutBusy(false); }
  };
  const confirmAction = async () => {
    if (!confirmation || submitting.current) return;
    const version = dialogVersion.current;
    submitting.current = true; setBusy(true); setDialogError("");
    try {
      const auth = createBrowserAuth();
      let message: string;
      if (confirmation.kind === "member") {
        const suspended = memberStatus(confirmation.target) === "active";
        const pending: unknown = auth.setMemberSuspended(confirmation.target.id, suspended);
        if (pending) await pending;
        message = `${confirmation.target.name}님의 이용을 ${suspended ? "정지" : "복구"}했습니다.`;
      } else {
        const pending: unknown = auth.revokeInvitation(confirmation.target.id);
        if (pending) await pending;
        message = `${confirmation.target.label} 초대를 취소했습니다.`;
      }
      if (dialogVersion.current !== version) return;
      closeDialog(); if (refresh()) setNotice(message);
    } catch (cause) { if (dialogVersion.current === version) setDialogError(managementError(cause)); }
    finally { if (dialogVersion.current === version) { submitting.current = false; setBusy(false); } }
  };
  const createInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const version = dialogVersion.current;
    const accountId = profile?.accountId;
    submitting.current = true; setBusy(true); setDialogError("");
    const draft: InvitationDraft & { access?: InviteForm["permission"] } = {
      label: form.label.trim(), grade: form.grade, role: form.role.trim(),
      signupExpiresAt: form.signup ? `${form.signup}:00+09:00` : "",
      accessExpiresAt: form.grade === 2 && form.unlimited ? null : accessCutoff(form.access),
      ...(isBackendConnected() ? { access: form.permission } : {})
    };
    try {
      const result = await createBrowserAuth().createInvitation(draft);
      const current = refresh();
      if (dialogVersion.current === version && current && current.accountId === accountId) setCreated(result);
    } catch (cause) { if (dialogVersion.current === version) setDialogError(managementError(cause)); }
    finally { if (dialogVersion.current === version) { submitting.current = false; setBusy(false); } }
  };
  const copy = async (kind: "code" | "link") => {
    if (!created) return;
    const version = dialogVersion.current;
    setDialogError(""); setCopyNotice("");
    try {
      await navigator.clipboard.writeText(kind === "code" ? groupedCode(created.code) : window.location.origin + created.signupPath);
      if (dialogVersion.current === version) setCopyNotice(kind === "code" ? "코드를 복사했습니다." : "초대 링크를 복사했습니다.");
    } catch {
      if (dialogVersion.current === version) setDialogError("복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하거나 표시된 코드를 직접 전달해 주세요.");
    }
  };

  if (!profile || !data) return <ManagementGuard profile={profile} error={error} />;
  const query = search.trim().toLocaleLowerCase("ko-KR");
  const members = data.members.filter((member) => (status === "all" || memberStatus(member) === status) && `${member.name} ${member.username} ${member.role}`.toLocaleLowerCase("ko-KR").includes(query));
  const confirmLabel = confirmation?.kind === "invitation" ? "초대 취소" : confirmation && memberStatus(confirmation.target) === "suspended" ? "이용 복구" : "이용 정지";

  return <ManagementShell page="members" profile={profile} onLogout={logout} logoutBusy={logoutBusy}>
    <div className="management-content">
      <header className="management-title"><div><UsersRound size={27} aria-hidden="true" /><h1>구성원 관리</h1></div><p>구성원 이용 상태와 초대코드</p><ManagementWarning /></header>
      {pageError && <p className="auth-error-summary" role="alert">{pageError}</p>}
      {notice && <p className="management-notice" role="status">{notice}</p>}
      <div className="console-surface management-overview" aria-label="구성원 현황">
        <dl><div><dt>전체 구성원</dt><dd>{data.members.length}</dd></div><div><dt>활성 계정</dt><dd>{data.members.filter(member => memberStatus(member) === "active").length}</dd></div><div><dt>정지 계정</dt><dd>{data.members.filter(member => memberStatus(member) === "suspended").length}</dd></div><div><dt>사용 가능한 초대</dt><dd>{data.invitations.filter(invite => invitationStatus(invite) === "unused").length}</dd></div></dl>
      </div>
      <div className="lobby-tabs management-tabs" role="tablist" aria-label="구성원 관리" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "members" : event.key === "End" ? "invitations" : tab === "members" ? "invitations" : "members";
        setTab(next); document.getElementById(`management-tab-${next}`)?.focus();
      }}>
        <button type="button" id="management-tab-members" role="tab" aria-controls="management-panel" aria-selected={tab === "members"} tabIndex={tab === "members" ? 0 : -1} onClick={() => setTab("members")}><UsersRound size={16} aria-hidden="true" />구성원</button>
        <button type="button" id="management-tab-invitations" role="tab" aria-controls="management-panel" aria-selected={tab === "invitations"} tabIndex={tab === "invitations" ? 0 : -1} onClick={() => setTab("invitations")}><KeyRound size={16} aria-hidden="true" />초대코드</button>
      </div>
      <section id="management-panel" className="console-surface management-list" role="tabpanel" aria-labelledby={`management-tab-${tab}`}>
        {tab === "members" ? <>
          <div className="management-toolbar"><div className="lobby-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="구성원 검색" placeholder="이름, 아이디, 역할 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <label className="lobby-sort">상태<select aria-label="구성원 상태" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">전체</option><option value="active">이용 중</option><option value="suspended">이용 정지</option><option value="expired">기간 만료</option></select></label>
          </div>
          <p className="management-count">구성원 {members.length}명</p>
          <TableFrame label="구성원 목록"><table className="management-table" aria-label="구성원 목록"><thead><tr><th scope="col">이름 / 아이디</th><th scope="col">등급</th><th scope="col">담당 역할</th><th scope="col">상태</th><th scope="col">이용 기한 (KST)</th><th scope="col">관리</th></tr></thead><tbody>
            {members.map((member) => {
              const state = memberStatus(member);
              const manageable = member.grade !== 1 && member.id !== profile.accountId && state !== "expired";
              const label = state === "suspended" ? "이용 복구" : "이용 정지";
              return <tr key={member.id}><th scope="row"><strong>{member.name}</strong><small>{member.username}</small></th><td>제{member.grade}관리자</td><td>{member.role}</td><td><span className={`management-state state-${state}`}>{memberLabels[state]}</span></td><td>{formatAccessExpiry(member.accessExpiresAt)}</td><td>{manageable && <button type="button" className="management-row-action" aria-label={`${member.name} ${label}`} onClick={() => { closeDialog(); setConfirmation({ kind: "member", target: member }); }}>{state === "suspended" ? <RotateCcw size={14} aria-hidden="true" /> : <Ban size={14} aria-hidden="true" />}{label}</button>}</td></tr>;
            })}
            {!members.length && <tr><td colSpan={6} className="management-empty">조건에 맞는 구성원이 없습니다</td></tr>}
          </tbody></table></TableFrame>
        </> : <>
          <div className="management-toolbar"><p className="management-count">초대 {data.invitations.length}개</p><button type="button" className="lobby-primary" onClick={openCreate}><Plus size={16} aria-hidden="true" />새 초대</button></div>
          <TableFrame label="초대 목록"><table className="management-table management-invites" aria-label="초대 목록"><thead><tr><th scope="col">초대 이름</th><th scope="col">등급 / 역할</th><th scope="col">가입 기한 (KST)</th><th scope="col">이용 기한 (KST)</th><th scope="col">상태</th><th scope="col">발급자 / 가입자</th><th scope="col">관리</th></tr></thead><tbody>
            {data.invitations.map((invitation) => {
              const state = invitationStatus(invitation);
              return <tr key={invitation.id}><th scope="row">{invitation.label}</th><td>제{invitation.grade}관리자<small>{invitation.role}</small></td><td>{formatManagementTime(invitation.signupExpiresAt)}</td><td>{formatAccessExpiry(invitation.accessExpiresAt)}</td><td><span className={`management-state state-${state}`}>{invitationLabels[state]}</span></td><td>{invitation.issuerName}<small>{invitation.usedByName ?? "-"}</small></td><td>{state === "unused" && <button type="button" className="management-row-action" aria-label={`${invitation.label} 초대 취소`} onClick={() => { closeDialog(); setConfirmation({ kind: "invitation", target: invitation }); }}><X size={14} aria-hidden="true" />초대 취소</button>}</td></tr>;
            })}
            {!data.invitations.length && <tr><td colSpan={7} className="management-empty">등록된 초대가 없습니다</td></tr>}
          </tbody></table></TableFrame>
        </>}
      </section>
    </div>
    {confirmation && <RoomDialog title={confirmLabel} onClose={closeDialog}><div className="room-dialog-body"><p className="room-delete-name">{confirmation.kind === "member" ? confirmation.target.name : confirmation.target.label}</p>
      <p className="room-delete-copy">{confirmation.kind === "invitation" ? "이 초대를 취소하면 더 이상 가입에 사용할 수 없습니다. 이미 가입한 구성원에게는 영향을 주지 않습니다." : confirmLabel === "이용 복구" ? "이 구성원의 이용 정지를 해제합니다. 파일과 이력은 유지됩니다. 이용 기한은 연장되지 않습니다." : "이 구성원은 로그인과 행사방 이용이 제한됩니다. 파일과 이력은 유지됩니다."}</p>
      {dialogError && <p className="auth-error-summary" role="alert">{dialogError}</p>}
    </div><footer className="room-dialog-footer"><button type="button" className="lobby-secondary" onClick={closeDialog} disabled={busy} autoFocus>취소</button><button type="button" className={confirmLabel === "이용 복구" ? "lobby-primary" : "lobby-danger"} disabled={busy} onClick={confirmAction}>{confirmLabel === "이용 복구" ? <RotateCcw size={15} aria-hidden="true" /> : <Ban size={15} aria-hidden="true" />}{confirmLabel}</button></footer></RoomDialog>}
    {createOpen && <RoomDialog title={created ? "초대가 만들어졌습니다" : "새 초대"} onClose={closeDialog}>
      {created ? <><div className="room-dialog-body management-result"><p className="management-result-label">{created.invitation.label}</p><output className="management-code" aria-label="발급된 초대코드">{groupedCode(created.code)}</output><p className="room-delete-copy">이 코드는 지금만 확인할 수 있습니다. 닫기 전에 전달해 주세요. 링크를 열기만 해서는 초대가 사용되지 않으며, 가입을 완료해야 사용 처리됩니다.</p>
        <div className="management-copy-actions"><button type="button" className="lobby-secondary" onClick={() => void copy("code")}><Copy size={15} aria-hidden="true" />코드 복사</button><button type="button" className="lobby-secondary" onClick={() => void copy("link")}><Link2 size={15} aria-hidden="true" />초대 링크 복사</button></div>
        {copyNotice && <p className="management-notice" role="status"><Check size={15} aria-hidden="true" />{copyNotice}</p>}{dialogError && <p className="auth-error-summary" role="alert">{dialogError}</p>}
      </div><footer className="room-dialog-footer"><button type="button" className="lobby-primary" onClick={closeDialog}>완료</button></footer></> : <form onSubmit={createInvite} noValidate aria-busy={busy}>
        <div className="room-dialog-body"><fieldset className="management-fields" disabled={busy}>
          <InviteField id="invite-label" label="초대 이름"><input id="invite-label" className="auth-input" value={form.label} onChange={(event) => updateForm("label", event.target.value)} required autoFocus /></InviteField>
          <div className="room-form-row"><InviteField id="invite-grade" label="등급"><select id="invite-grade" className="auth-input" value={form.grade} onChange={(event) => updateForm("grade", Number(event.target.value) as 2 | 3)}><option value={2}>제2관리자</option><option value={3}>제3관리자</option></select></InviteField><InviteField id="invite-role" label="담당 역할"><input id="invite-role" className="auth-input" value={form.role} onChange={(event) => updateForm("role", event.target.value)} required /></InviteField></div>
          {isBackendConnected() && <InviteField id="invite-permission" label="이용 권한"><select id="invite-permission" className="auth-input" value={form.permission} onChange={(event) => updateForm("permission", event.target.value as InviteForm["permission"])}><option value="viewer">일정 추가·수정</option><option value="chat">일정 추가·수정 및 대화</option><option value="edit">일정·준비 항목·자료 관리 및 대화</option></select></InviteField>}
          <InviteField id="invite-signup" label="가입 기한"><input id="invite-signup" type="datetime-local" className="auth-input" value={form.signup} onChange={(event) => updateForm("signup", event.target.value)} required aria-describedby="invite-signup-hint" /><small id="invite-signup-hint" className="management-hint">한국 시간 (KST)</small></InviteField>
          <InviteField id="invite-access" label="이용 기한"><input id="invite-access" type="date" className="auth-input" value={form.access} disabled={form.grade === 2 && form.unlimited} onChange={(event) => updateForm("access", event.target.value)} required aria-describedby="invite-access-hint" /><small id="invite-access-hint" className="management-hint">한국 시간 기준, 선택한 날짜까지 이용</small></InviteField>
          {form.grade === 2 && <label className="management-checkbox"><input type="checkbox" checked={form.unlimited} onChange={(event) => updateForm("unlimited", event.target.checked)} />기간 제한 없음</label>}
        </fieldset>{dialogError && <p className="auth-error-summary" role="alert">{dialogError}</p>}</div>
        <footer className="room-dialog-footer"><button type="button" className="lobby-secondary" onClick={closeDialog}>취소</button><button type="submit" className="lobby-primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{busy ? "만드는 중..." : "초대 만들기"}</button></footer>
      </form>}
    </RoomDialog>}
  </ManagementShell>;
}

export function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return <div className="management-table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

function InviteField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="auth-field"><label htmlFor={id}>{label}</label>{children}</div>;
}
