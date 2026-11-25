import Link from "next/link";
import { Settings } from "lucide-react";
import "./settings-entry.css";

type Destination = { href: string; onOpen?: never } | { href?: never; onOpen: () => void };

export function SettingsEntry({ placement, href, onOpen, current }: Destination & { placement: "rail" | "toolbar"; current?: boolean }) {
  const iconOnly = placement === "toolbar";
  const props = { className: "settings-entry", "data-settings-entry": placement, "aria-label": "환경설정", title: iconOnly ? "환경설정" : undefined };
  const content = <><Settings size={iconOnly ? 18 : 20} aria-hidden="true" />{!iconOnly && <span>환경설정</span>}</>;
  return href !== undefined ? <Link {...props} href={href} aria-current={current ? "page" : undefined}>{content}</Link>
    : <button {...props} type="button" onClick={onOpen}>{content}</button>;
}
