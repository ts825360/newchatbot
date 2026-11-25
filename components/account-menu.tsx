"use client";

import Link from "next/link";
import { ChevronDown, Settings2, UsersRound } from "lucide-react";
import { useEffect, useRef } from "react";
import type { UserProfile } from "@/lib/types";
import "./account-menu.css";

export function AccountMenu({ profile }: { profile: UserProfile }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) menu.current?.removeAttribute("open"); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const name = <span className="lobby-account-name">{profile.nickname}<small>{profile.role}</small></span>;
  if (profile.grade !== 1 && !profile.permissions.includes("manageMembers")) return name;
  return <details className="account-menu" ref={menu} onKeyDown={event => { if (event.key === "Escape") { menu.current?.removeAttribute("open"); menu.current?.querySelector("summary")?.focus(); } }}>
    <summary aria-label="계정 메뉴">{name}<ChevronDown size={14} aria-hidden="true" /></summary>
    <nav aria-label="계정 관리 메뉴">
      {profile.permissions.includes("manageMembers") && <Link href="/members"><UsersRound size={16} aria-hidden="true" />구성원 관리</Link>}
      {profile.grade === 1 && <Link href="/admin"><Settings2 size={16} aria-hidden="true" />운영 관리</Link>}
    </nav>
  </details>;
}
