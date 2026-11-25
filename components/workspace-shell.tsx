import { Folder } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { WorkspaceBrandMark } from "./workspace-brand-mark";
import { SettingsEntry } from "./settings-entry";

export function WorkspaceShell({ layoutRef, historyRef, historyVisible, chatVisible, columns, style, onBackToRooms, onOpenSettings, history, header, navigation, chat, inspector, children }: {
  layoutRef: Ref<HTMLDivElement>; historyRef: Ref<HTMLElement>; historyVisible: boolean;
  columns: string; style?: CSSProperties; chatVisible: boolean; onBackToRooms: () => void; onOpenSettings?: () => void;
  history: ReactNode; header: ReactNode; navigation: ReactNode; chat: ReactNode; inspector: ReactNode; children?: ReactNode;
}) {
  return <div className="workspace-shell">
    <div ref={layoutRef} style={style} className={`workspace-columns ${columns}`}>
      <aside ref={historyRef} id="conversation-history" className="workspace-history workspace-theme" aria-label="대화 기록" hidden={!historyVisible}>
        <button type="button" className="workspace-brand" aria-label="행사비서: 행사방 목록" title="행사방 목록" onClick={onBackToRooms}><span className="workspace-brand-mark"><WorkspaceBrandMark size={21} /></span>행사비서</button>
        <div className="workspace-history-nav">
          <button type="button" className="workspace-rooms-link" onClick={onBackToRooms}><Folder size={17} aria-hidden="true" />행사방 목록</button>
        </div>
        {history}
        {onOpenSettings && <div className="workspace-history-footer"><SettingsEntry placement="rail" onOpen={onOpenSettings} /></div>}
      </aside>
      {header}
      {navigation}
      <div className="workspace-center workspace-theme" hidden={!chatVisible}>{chat}</div>
      {inspector}
    </div>
    {children}
  </div>;
}
