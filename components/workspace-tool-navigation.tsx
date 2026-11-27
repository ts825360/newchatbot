"use client";

import { BedDouble, BusFront, CalendarDays, ChevronDown, ClipboardCheck, Folder, ListChecks, MapPin, MessageSquare, PanelRightClose, PanelRightOpen, ScanSearch, UsersRound } from "lucide-react";
import { useEffect, useState, type Ref } from "react";

export const workspaceTools = {
  calendar: { name: "일정", Icon: CalendarDays },
  prepare: { name: "준비 현황", Icon: ListChecks },
  retreatReview: { name: "준비 점검", Icon: ScanSearch },
  proposals: { name: "제안 검토", Icon: ClipboardCheck },
  location: { name: "장소", Icon: MapPin },
  lodging: { name: "숙소 배정", Icon: BedDouble },
  transport: { name: "차량 배정", Icon: BusFront },
  documents: { name: "자료", Icon: Folder },
} as const;
export type WorkspaceTool = keyof typeof workspaceTools;

const groups = [
  { id: "preparation", label: "행사 준비", Icon: ListChecks, tools: ["prepare", "retreatReview", "proposals", "location"] },
  { id: "travel", label: "참가·이동", Icon: UsersRound, tools: ["transport", "lodging"] },
] as const;

export function workspaceToolTrigger(tool: WorkspaceTool) {
  const group = groups.find(({ tools }) => (tools as readonly WorkspaceTool[]).includes(tool));
  return group ? `[data-workspace-tool-group="${group.id}"]` : `[data-tool="${tool}"]`;
}

export function WorkspaceToolNavigation({ navRef, panelRef, active, showChat, panelOpen, hasPanel, canExpand, expanded, canShow, isDisabled, onChat, onPanel, onTool }: {
  navRef: Ref<HTMLElement>;
  panelRef: Ref<HTMLButtonElement>;
  active: WorkspaceTool | null;
  showChat: boolean;
  panelOpen: boolean;
  hasPanel: boolean;
  canExpand: boolean;
  expanded: boolean;
  canShow: (tool: WorkspaceTool) => boolean;
  isDisabled: (tool: WorkspaceTool) => boolean;
  onChat: () => void;
  onPanel: () => void;
  onTool: (tool: WorkspaceTool) => void;
}) {
  const [menu, setMenu] = useState<(typeof groups)[number]["id"] | null>(null);
  const panelLabel = panelOpen ? "오른쪽 패널 접기" : "오른쪽 패널 열기";
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(`[data-tool-disclosure="${menu}"]`)) setMenu(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);

  const toolButton = (tool: WorkspaceTool, inMenu = false) => {
    const { name, Icon } = workspaceTools[tool];
    const selected = active === tool;
    const action = !selected ? "열기" : !inMenu && canExpand ? expanded ? "축소" : "확대" : "";
    const label = [name, action].filter(Boolean).join(" ");
    return <button key={tool} type="button" className={inMenu ? "workspace-tool-option" : "workspace-tool-button"}
      data-tool={tool} aria-label={label} title={label} aria-pressed={selected} aria-controls="workspace-tools"
      disabled={isDisabled(tool)} onClick={event => {
        if (inMenu) event.currentTarget.closest("[data-tool-disclosure]")?.querySelector<HTMLButtonElement>("[data-workspace-tool-group]")?.focus();
        setMenu(null);
        if (!inMenu || !selected) onTool(tool);
      }}><Icon size={17} aria-hidden="true" /><span>{name}</span></button>;
  };

  return <nav ref={navRef} className="workspace-tool-nav workspace-theme" aria-label="행사방 도구">
    <div className="workspace-tool-list">
      <button type="button" className="workspace-tool-button" aria-pressed={showChat} onClick={() => { setMenu(null); onChat(); }}><MessageSquare size={17} aria-hidden="true" />대화</button>
      {toolButton("calendar")}
      {groups.map(({ id, label, Icon, tools }) => {
        const available = tools.filter(canShow);
        const expanded = menu === id;
        const selected = !!active && available.some(tool => tool === active);
        if (!available.length) return null;
        return <div key={id} className="workspace-tool-group" data-tool-disclosure={id}
          onBlur={event => { if (expanded && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setMenu(null); }}
          onKeyDown={event => {
            if (event.key !== "Escape" || !expanded) return;
            event.preventDefault();
            setMenu(null);
            event.currentTarget.querySelector<HTMLButtonElement>("[data-workspace-tool-group]")?.focus();
          }}>
          <button type="button" className="workspace-tool-button" data-workspace-tool-group={id} data-active={selected}
            aria-expanded={expanded} aria-controls={`workspace-tool-menu-${id}`}
            aria-description={selected ? `선택한 도구: ${workspaceTools[active].name}` : undefined}
            onClick={() => setMenu(expanded ? null : id)}><Icon size={17} aria-hidden="true" /><span>{label}</span><ChevronDown className="workspace-tool-chevron" size={13} aria-hidden="true" /></button>
          <div className="workspace-tool-options" id={`workspace-tool-menu-${id}`} role="group" aria-label={`${label} 도구`} hidden={!expanded}>{available.map(tool => toolButton(tool, true))}</div>
        </div>;
      })}
      {toolButton("documents")}
    </div>
    <button ref={panelRef} type="button" className="workspace-tool-button workspace-overview-trigger" disabled={!hasPanel}
      aria-label={panelLabel} title={hasPanel ? panelLabel : "열 수 있는 오른쪽 패널이 없습니다."} aria-expanded={panelOpen} aria-controls="workspace-tools"
      onClick={() => { setMenu(null); onPanel(); }}>{panelOpen ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}</button>
  </nav>;
}
