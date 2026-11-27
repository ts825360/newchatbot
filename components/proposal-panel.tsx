"use client";

import { Check, Clock3, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { chatProposalCandidates } from "@/lib/chat-tool-candidates";
import { createPreparationStore, PREPARATION_CHANGED_EVENT, sampleProposals, type ProposalApplyResult, type ProposalDecision, type ProposalDraft } from "@/lib/preparation-store";
import { validDate } from "@/lib/room-timing";
import { Badge, Button, Field, inputClass } from "./ui";
import "./proposal-panel.css";
import { flushBackendWrites, isBackendConnected } from "@/lib/backend-client";
import type { ConversationScope } from "@/lib/conversation-scope";
import type { ChatMessage } from "@/lib/types";
import { ChatWorkCard } from "./chat-work-card";

export function ProposalPanel({ room, scope, messages, onApply, canApprove = () => true, remember = true }: { room: { id: string; date?: string | null }; scope?: ConversationScope; messages?: readonly ChatMessage[]; onApply: (draft: ProposalDraft) => ProposalApplyResult | Promise<ProposalApplyResult>;
  canApprove?: (kind: ProposalDraft["kind"]) => boolean; remember?: boolean;
}) {
  const [decisions, setDecisions] = useState<ProposalDecision[] | null>(null);
  const [error, setError] = useState("");
  const real = isBackendConnected() && !!scope;
  const modern = real ? (messages ?? []).filter(message => message.sender === "assistant" && message.workProposal).toReversed() : [];
  const proposals = useMemo(() => real ? chatProposalCandidates(messages ?? []) : sampleProposals(room), [real, messages, room]);
  useEffect(() => {
    const store = createPreparationStore(localStorage, room.id, [], scope);
    const reload = () => {
      try { setDecisions(store.loadDecisions()); setError(""); }
      catch (cause) { setError((cause as Error).message); }
    };
    const changed = (event: Event) => {
      if (event instanceof StorageEvent && event.storageArea && event.storageArea !== localStorage) return;
      const key = event instanceof StorageEvent ? event.key : (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key == null || key === store.decisionsKey) reload();
    };
    reload(); window.addEventListener("storage", changed); window.addEventListener(PREPARATION_CHANGED_EVENT, changed);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener(PREPARATION_CHANGED_EVENT, changed); };
  }, [room.id, scope]);
  const decide = (id: string, status: ProposalDecision["status"], reason: string, title?: string, date?: string) => {
    try { setDecisions(createPreparationStore(localStorage, room.id, [], scope).decide(id, status, reason, title, date)); setError(""); return ""; }
    catch (cause) { return (cause as Error).message; }
  };
  return <div className="proposal-panel">
    {!real && <div className="proposal-intro"><Badge tone="amber">샘플 제안</Badge><p>회의록 예시로 구성된 체험 자료입니다. 실제 업로드 자료의 분석 결과가 아닙니다.</p></div>}
    {error && <p role="alert" className="documents-error">{error}</p>}
    {decisions === null && !error && <p role="status" className="text-xs text-muted-foreground">제안 불러오는 중...</p>}
    {decisions && real && !proposals.length && !modern.length && <p className="text-sm text-muted-foreground">이 대화에서 검토할 제안이 없습니다.</p>}
    <div className="proposal-grid">
      {scope && modern.map(message => <ChatWorkCard key={`${scope.accountId}:${scope.roomId}:${scope.conversationId}:${message.id}`} scope={scope} message={message} onApply={onApply}
        canApprove={message.workProposal?.kind === "survey" || canApprove(message.workProposal!.kind)} remember={remember} review />)}
      {decisions && proposals.map(proposal => <ProposalRow key={`${room.id}:${proposal.id}:${room.date ?? ""}`} proposal={proposal} privateReview={!!scope} decision={decisions.find(item => item.id === proposal.id)} onApply={onApply} onDecide={decide} />)}
    </div>
  </div>;
}

function ProposalRow({ proposal, privateReview, decision, onApply, onDecide }: { proposal: ProposalDraft; privateReview: boolean; decision?: ProposalDecision; onApply: (draft: ProposalDraft) => ProposalApplyResult | Promise<ProposalApplyResult>; onDecide: (id: string, status: ProposalDecision["status"], reason: string, title?: string, date?: string) => string }) {
  const [draft, setDraft] = useState({ ...proposal, title: decision?.title ?? proposal.title, date: decision?.date ?? proposal.date });
  const [reason, setReason] = useState(decision?.reason ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const status = decision?.status ?? "pending";
  const decide = (next: ProposalDecision["status"]) => setError(onDecide(proposal.id, next, reason, draft.title, draft.date));
  const change = (next: ProposalDraft) => { setDraft(next); setError(onDecide(proposal.id, "pending", reason, next.title, next.date)); };
  const apply = () => {
    if (!draft.title.trim()) { setError("반영할 항목을 입력해 주세요."); return; }
    if (draft.kind === "calendar" && !validDate(draft.date)) { setError("반영할 날짜를 입력해 주세요."); return; }
    const finish = (result: ProposalApplyResult) => {
    if (!(typeof result === "boolean" ? result : result.ok)) { setError(typeof result !== "boolean" && result.error || "항목을 저장하지 못했습니다. 저장 상태를 확인한 뒤 다시 반영해 주세요."); return; }
    const applied = typeof result !== "boolean" && result.applied ? result.applied : draft;
    setDraft(applied);
    if (typeof result !== "boolean" && result.recovered) setNotice("이미 저장된 항목을 유지하고 검토 상태를 복구했습니다.");
    const failure = onDecide(proposal.id, "accepted", "", applied.title.trim(), applied.date);
    setError(failure ? "항목은 저장됐지만 처리 상태를 저장하지 못했습니다. 다시 반영해도 중복 추가되지 않습니다." : "");
    };
    const result = onApply({ ...draft, title: draft.title.trim() });
    if (result instanceof Promise) { setBusy(true); void result.then(finish).then(() => flushBackendWrites()).catch((e) => setError(e.message)).finally(() => setBusy(false)); }
    else finish(result);
  };
  const statusText = { pending: "검토 중", accepted: "반영됨", deferred: "보류됨", excluded: "제외됨" }[status];
  return <section className="proposal-item" aria-label={`${proposal.title} 제안`}>
    <header><h3>{decision?.title || proposal.title}</h3><Badge tone={status === "accepted" ? "green" : status === "pending" ? "amber" : "neutral"}>{statusText}</Badge></header>
    <p className="proposal-destination">반영 위치: {proposal.kind === "checklist" ? privateReview ? "이 대화의 체크리스트" : "공동 체크리스트" : "공동 캘린더"}</p>
    <details open className="proposal-source"><summary>{proposal.sourceTitle}</summary><blockquote>{proposal.excerpt}</blockquote></details>
    {status === "pending" ? <>
      <Field label="반영할 항목"><input className={inputClass} value={draft.title} maxLength={120} onChange={event => change({ ...draft, title: event.target.value })} /></Field>
      {draft.kind === "calendar" && <Field label="반영할 날짜"><input type="date" className={inputClass} value={draft.date} onChange={event => change({ ...draft, date: event.target.value })} /></Field>}
      <Field label="제외 사유"><input className={inputClass} value={reason} maxLength={300} onChange={event => { setReason(event.target.value); setError(onDecide(proposal.id, "pending", event.target.value, draft.title, draft.date)); }} /></Field>
      {error && <p className="documents-error" role="alert">{error}</p>}
      <div className="proposal-actions"><Button disabled={busy} type="button" variant="ghost" onClick={() => decide("excluded")}><X size={15} />제외</Button><Button disabled={busy} type="button" variant="outline" onClick={() => decide("deferred")}><Clock3 size={15} />보류</Button><Button disabled={busy} type="button" variant="primary" onClick={apply}><Check size={15} />{busy ? "저장 중" : privateReview && proposal.kind === "calendar" ? "캘린더에 공유" : "반영"}</Button></div>
    </> : <>
      {decision?.reason && <p className="proposal-reason">{decision.reason}</p>}
      {notice && <p className="text-xs text-primary" role="status">{notice}</p>}
      {status !== "accepted" && <Button type="button" variant="outline" onClick={() => decide("pending")}><RotateCcw size={15} />다시 검토</Button>}
      {error && <p className="documents-error" role="alert">{error}</p>}
    </>}
  </section>;
}
