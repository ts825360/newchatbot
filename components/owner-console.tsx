"use client";

import { useRouter } from "next/navigation";
import { Activity, ShieldCheck, Siren } from "lucide-react";
import { useRef, useState } from "react";
import { createBrowserAuth } from "@/lib/prototype-auth";
import { feedbackCategories, type FeedbackCategory } from "@/lib/feedback-store";
import { formatManagementTime, invitationStatus, ManagementGuard, managementError, ManagementWarning, memberStatus, TableFrame, useManagementSession } from "./membership-screen";
import { ManagementShell } from "./management-shell";

const mailLabels: Record<string, string> = { sent: "메일 서비스 접수", queued: "발송 대기", failed: "발송 실패", unconfigured: "설정 안 됨" };

export function OwnerConsole() {
  const router = useRouter();
  const { profile, data, error, refresh } = useManagementSession("owner");
  const [actionError, setActionError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const loggingOut = useRef(false);
  const logout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true; setLogoutBusy(true); setActionError("");
    try {
      const pending: unknown = createBrowserAuth().logout();
      if (pending) await pending;
      refresh(); router.replace("/login");
    }
    catch (cause) { setActionError(managementError(cause)); }
    finally { loggingOut.current = false; setLogoutBusy(false); }
  };
  if (!profile || !data) return <ManagementGuard profile={profile} error={error} />;
  const counts = [
    { label: "이용 중", value: data.members.filter((member) => memberStatus(member) === "active").length, state: "active" },
    { label: "이용 정지", value: data.members.filter((member) => memberStatus(member) === "suspended").length, state: "suspended" },
    { label: "기간 만료", value: data.members.filter((member) => memberStatus(member) === "expired").length, state: "expired" },
    { label: "미사용 초대", value: data.invitations.filter((invitation) => invitationStatus(invitation) === "unused").length, state: "unused" }
  ];
  return <ManagementShell page="owner" profile={profile} onLogout={logout} logoutBusy={logoutBusy}>
    <div className="management-content">
      <header className="management-title"><div><ShieldCheck size={27} aria-hidden="true" /><h1>운영 관리</h1></div><p>서비스 운영 현황, 활동 기록 및 접수된 신고</p><ManagementWarning /></header>
      {actionError && <p className="auth-error-summary" role="alert">{actionError}</p>}
      <section className="console-surface management-overview" aria-label="운영 현황"><dl>{counts.map((count) => <div key={count.label}><dt><span className={`management-state state-${count.state}`}>{count.label}</span></dt><dd>{count.value}</dd></div>)}</dl></section>
      <section className="console-surface management-activity" aria-labelledby="management-activity-title"><h2 id="management-activity-title"><Activity size={19} aria-hidden="true" />운영 활동</h2>
        <TableFrame label="운영 활동"><table className="management-table management-activity-table" aria-label="운영 활동"><thead><tr><th scope="col">처리자</th><th scope="col">일시 (KST)</th><th scope="col">활동</th><th scope="col">대상</th></tr></thead><tbody>
          {[...data.activities].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((activity) => <tr key={activity.id}><th scope="row">{activity.actor}</th><td>{formatManagementTime(activity.at)}</td><td>{activity.action}</td><td>{activity.target}</td></tr>)}
          {!data.activities.length && <tr><td colSpan={4} className="management-empty">아직 운영 활동이 없습니다</td></tr>}
        </tbody></table></TableFrame>
      </section>
      <section className="console-surface management-activity" aria-label="접수된 문제 신고"><h2><Siren size={19} aria-hidden="true" />접수된 문제 신고</h2>
        <TableFrame label="문제 신고"><table className="management-table management-report-table"><thead><tr><th>접수 시각</th><th>작성자</th><th>유형</th><th>내용</th><th>메일 알림</th></tr></thead><tbody>
          {(data.reports ?? []).map(report => <tr key={`${report.reporter}:${report.id}`}><td>{formatManagementTime(report.createdAt)}</td><td>{report.reporter}</td><td>{feedbackCategories[report.category as FeedbackCategory] ?? "기타"}</td><td>{report.description}{report.context && <small>{[report.context.screenName, report.context.roomName, `${report.context.width}×${report.context.height}`].filter(Boolean).join(" · ")}</small>}</td><td>{mailLabels[report.notification ?? ""] ?? "기존 신고"}</td></tr>)}
          {!data.reports?.length && <tr><td colSpan={5} className="management-empty">접수된 신고가 없습니다.</td></tr>}
        </tbody></table></TableFrame>
      </section>
    </div>
  </ManagementShell>;
}
