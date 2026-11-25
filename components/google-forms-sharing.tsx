"use client";

import { Copy, ExternalLink, FilePlus2 } from "lucide-react";
import { useState } from "react";
import { googleFormsCreateUrl } from "@/lib/google-forms-preview";
import { Button } from "./ui";

export function BlankGoogleFormLink({ className = "lobby-secondary", iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  const label = "구글폼에서 새 설문 만들기";
  return <a className={className} href={googleFormsCreateUrl} target="_blank" rel="noopener noreferrer" aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
    <FilePlus2 size={15} aria-hidden="true" />{!iconOnly && label}
  </a>;
}

export function GoogleFormsRespondentLink({ url }: { url?: string }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  if (!url) return <p className="text-xs text-muted-foreground">응답 링크를 가져오지 못했습니다. 구글폼의 게시 상태와 응답자 액세스를 확인해 주세요.</p>;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch { setCopy("manual"); }
  };
  return <div className="grid min-w-0 gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <a className="lobby-secondary" href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} aria-hidden="true" />응답 링크 열기
      </a>
      <Button type="button" variant="outline" onClick={() => void copyLink()}><Copy size={14} aria-hidden="true" />응답 링크 복사</Button>
    </div>
    {copy === "copied" && <p className="text-xs text-muted-foreground" role="status">응답 링크를 복사했습니다.</p>}
    {copy === "manual" && <label className="grid min-w-0 gap-1 text-xs">응답 링크 직접 복사
      <input className="min-w-0 rounded-md border border-border bg-panel px-2 py-1.5 text-sm"
        value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
    </label>}
  </div>;
}
