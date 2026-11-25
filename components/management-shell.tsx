"use client";

import Link from "next/link";
import { CalendarDays, Folder, House, LogOut, Moon, Settings, ShieldCheck, Sun, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import type { UserProfile } from "@/lib/types";
import { usePrototypeTheme } from "@/lib/use-theme";
import { AccountMenu } from "./account-menu";
import { AppRailBrand } from "./room-lobby-overview";
import { SupportButton } from "./support-dialog";
import { SettingsEntry } from "./settings-entry";

const consolePages = {
  settings: { href: "/settings", label: "환경설정", Icon: Settings },
  members: { href: "/members", label: "구성원 관리", Icon: UsersRound },
  owner: { href: "/admin", label: "운영 관리", Icon: ShieldCheck },
};

export function ManagementShell({ page, profile, onLogout, logoutBusy, children }: {
  page: keyof typeof consolePages;
  profile: UserProfile;
  onLogout: () => void;
  logoutBusy: boolean;
  children: ReactNode;
}) {
  const { darkMode, toggleTheme } = usePrototypeTheme();
  const { label, Icon } = consolePages[page];
  const consoleLink = (key: keyof typeof consolePages) => {
    const target = consolePages[key];
    if (key === "settings") return <SettingsEntry placement="rail" href={target.href} current={page === key} />;
    return <Link href={target.href} aria-current={page === key ? "page" : undefined}><target.Icon size={19} aria-hidden="true" />{target.label}</Link>;
  };
  const canManage = (profile.grade === 1 || profile.grade === 2) && profile.permissions.includes("manageMembers");
  return <main className={`lobby-page lobby-reference management-page console-page${page === "settings" ? " settings-page" : ""}`}>
    <aside className="lobby-rail console-rail" aria-label="행사비서 탐색">
      <AppRailBrand />
      <nav className="lobby-rail-links console-navigation" aria-label="주 메뉴">
        <Link href="/rooms#lobby-home"><House size={19} aria-hidden="true" />홈</Link>
        <Link href="/rooms#rooms-panel"><Folder size={19} aria-hidden="true" />행사방</Link>
        <Link href="/rooms#lobby-today"><CalendarDays size={19} aria-hidden="true" />오늘의 행사</Link>
        {(canManage || profile.grade === 1) && <p>관리</p>}
        {canManage && consoleLink("members")}
        {profile.grade === 1 && consoleLink("owner")}
        {consoleLink("settings")}
      </nav>
    </aside>
    <header className="lobby-header console-header">
      <span className="console-breadcrumb"><Icon size={19} aria-hidden="true" />{label}</span>
      <div className="lobby-account">
        <SupportButton screenName={label} />
        <button type="button" className="lobby-icon-button" onClick={toggleTheme} aria-label={darkMode ? "라이트 모드" : "다크 모드"} title={darkMode ? "라이트 모드" : "다크 모드"}>{darkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
        <span className="lobby-avatar" aria-hidden="true">{Array.from(profile.nickname.trim())[0] || "관"}</span><AccountMenu profile={profile} />
        <button className="lobby-icon-button lobby-logout" type="button" onClick={onLogout} disabled={logoutBusy} aria-label="로그아웃" title="로그아웃"><LogOut size={18} aria-hidden="true" /></button>
      </div>
    </header>
    {children}
  </main>;
}
