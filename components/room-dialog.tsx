"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function RoomDialog({ title, onClose, children, className, headerActions, open = true }: {
  title: string; onClose: () => void; children: ReactNode; className?: string; headerActions?: ReactNode; open?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [open]);
  return (
    <dialog ref={ref} className={className ? `room-dialog ${className}` : "room-dialog"} aria-labelledby={titleId} onCancel={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); onClose(); } }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="room-dialog-inner">
        <header className="room-dialog-header"><h2 id={titleId}>{title}</h2>{headerActions}<button type="button" className="lobby-icon-button" onClick={onClose} aria-label="닫기" title="닫기"><X size={18} /></button></header>
        {children}
      </div>
    </dialog>
  );
}
