"use client";

import { Check, CircleAlert, HardDrive, LoaderCircle } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getServerStorageStatus, getStorageStatus, subscribeStorageStatus } from "@/lib/storage-status";
import "./save-status.css";

export function SaveStatus() {
  const status = useSyncExternalStore(subscribeStorageStatus, getStorageStatus, getServerStorageStatus);
  const label = status.phase === "saving" ? "저장 중" : status.phase === "failed" ? "저장 실패" : status.phase === "saved" ? status.scope === "server" ? "서버에 저장됨" : status.scope === "tab" ? "현재 탭에 저장됨" : "브라우저에 저장됨" : status.scope === "server" ? "서버 연결" : "브라우저 저장";
  const Icon = status.phase === "saving" ? LoaderCircle : status.phase === "failed" ? CircleAlert : status.phase === "saved" ? Check : HardDrive;
  return <span role="status" aria-live="polite" className={`save-status is-${status.phase}`} title={status.scope === "server" ? "서버 저장 상태" : `${status.scope === "tab" ? "현재 탭" : "이 브라우저"}에 저장합니다. 서버나 다른 기기에 전송된 상태가 아닙니다.`}><Icon size={13} aria-hidden="true" />{label}</span>;
}
