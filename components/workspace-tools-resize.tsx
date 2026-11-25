"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const widthKey = "church-workspace-tools-width";
const minimum = 300, maximum = 850, chatMinimum = 260;

export function useToolsResize(enabled: boolean, historyOpen: boolean) {
  const layout = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [preferred, setPreferred] = useState<number | null>(null);
  const [measured, setMeasured] = useState({ width: 440, limit: maximum });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; startX: number; startWidth: number; current: number } | null>(null);
  const limit = () => Math.max(minimum, Math.min(maximum, (layout.current?.clientWidth || window.innerWidth) - (historyOpen ? history.current?.clientWidth ?? 0 : 0) - chatMinimum));
  const clamp = (value: number) => Math.round(Math.max(minimum, Math.min(limit(), value)));
  const currentWidth = () => panel.current?.getBoundingClientRect().width || panel.current?.clientWidth || preferred || 440;
  const persist = (value: number | null) => {
    try { if (value === null) localStorage.removeItem(widthKey); else localStorage.setItem(widthKey, String(value)); } catch { /* Preference is optional. */ }
  };

  useEffect(() => {
    try { const value = Number(localStorage.getItem(widthKey)); if (value >= minimum && value <= maximum) setPreferred(value); } catch { /* Use the default. */ }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const measure = () => { const width = Math.round(currentWidth()), bound = limit(); setMeasured(previous => previous.width === width && previous.limit === bound ? previous : { width, limit: bound }); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (layout.current) observer.observe(layout.current);
    if (panel.current) observer.observe(panel.current);
    return () => observer.disconnect();
  }, [enabled, historyOpen, preferred]);

  const handle = enabled && <div className="workspace-tools-grip" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label="부가기능 너비 조절" aria-controls="workspace-tools" aria-valuemin={minimum} aria-valuemax={measured.limit}
    aria-valuenow={Math.min(measured.limit, Math.max(minimum, measured.width))} title="드래그하여 너비 조절 · 더블클릭하여 초기화"
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      const startWidth = currentWidth();
      drag.current = { id: event.pointerId, startX: event.clientX, startWidth, current: startWidth };
      event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); event.preventDefault();
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      active.current = clamp(active.startWidth + active.startX - event.clientX); setPreferred(active.current);
    }}
    onLostPointerCapture={event => {
      if (drag.current?.id !== event.pointerId) return;
      persist(clamp(drag.current.current)); drag.current = null; setDragging(false);
    }}
    onDoubleClick={() => { setPreferred(null); persist(null); }}
    onKeyDown={event => {
      const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
      if (!direction && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const value = clamp(direction ? currentWidth() + direction * 24 : event.key === "Home" ? minimum : maximum);
      setPreferred(value); persist(value);
    }} />;
  const style = preferred === null ? undefined : { "--preferred-tools-width": `${preferred}px` } as CSSProperties;
  return { layout, history, panel, style, handle, dragging };
}
