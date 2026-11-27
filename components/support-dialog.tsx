"use client";

import { BookOpen, ChevronRight, Copy, Headset, HelpCircle, Mail, MessageSquare, Send, Siren } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { backendFetch, isBackendConnected } from "@/lib/backend-client";
import { feedbackCategories, type FeedbackCategory } from "@/lib/feedback-store";
import { helpFaqs, quickHelpTopics } from "@/lib/settings-help-data";
import { supportConfig } from "@/lib/support-config";
import { RoomDialog } from "./room-dialog";
import { Button, Field, inputClass } from "./ui";
import "./support-dialog.css";

export function SupportEmail() {
  const [notice, setNotice] = useState("");
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(supportConfig.email);
      setNotice("이메일 주소를 복사했습니다.");
    } catch {
      setNotice("복사할 수 없습니다. 이메일 주소를 직접 선택해서 복사해 주세요.");
    }
  }
  if (!supportConfig.email) return <p className="support-email-notice">공개 문의 이메일이 설정되지 않았습니다.</p>;
  return <div className="support-email">
    <p className="support-email-address">{supportConfig.email}</p>
    <div className="support-email-actions flex flex-wrap items-center gap-2">
      <a className="lobby-secondary" href={`mailto:${supportConfig.email}`}><Mail size={16} aria-hidden="true" />문의하기</a>
      <Button type="button" variant="outline" onClick={() => void copyEmail()}><Copy size={16} aria-hidden="true" />이메일 주소 복사</Button>
    </div>
    <p className="support-email-notice" role="status">{notice}</p>
  </div>;
}

type Receipt = { notification: "queued" | "sent" | "failed" | "unconfigured" };
const receiptMessages: Record<Receipt["notification"], string> = {
  queued: "운영자 메일 알림은 발송 대기 중입니다.",
  sent: "메일 서비스가 운영자 알림을 접수했습니다.",
  failed: "메일 알림을 보내지 못했습니다. 신고는 서버에 저장되어 있습니다.",
  unconfigured: "운영자 메일 알림은 아직 설정되지 않았습니다. 신고는 서버에 저장되어 있습니다."
};

export function SupportButton({ screenName, roomName, presentation = "toolbar" }: { screenName: string; roomName?: string; presentation?: "toolbar" | "settings" | "help-center" }) {
  const [open, setOpen] = useState<"help" | "faq" | "report" | "feedback" | "contact" | null>(null);
  const [category, setCategory] = useState<FeedbackCategory>("screen");
  const [description, setDescription] = useState("");
  const [includeContext, setIncludeContext] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const retry = useRef<{ signature: string; body: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    if (!description.trim()) { setError("문제 내용을 입력해 주세요."); return; }
    if (!isBackendConnected()) { setError("서버에 연결한 뒤 다시 시도해 주세요."); return; }
    const data = { category, description: description.trim(), ...(includeContext ? { context: { screenName, roomName, width: window.innerWidth, height: window.innerHeight } } : {}) };
    const signature = JSON.stringify([category, data.description, includeContext, screenName, roomName]);
    if (retry.current?.signature !== signature) retry.current = { signature, body: JSON.stringify({ requestId: crypto.randomUUID(), ...data }) };
    const body = retry.current.body;
    pending.current = true; setBusy(true); setError("");
    try {
      const result: Receipt = await backendFetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      setReceipt(result); setDescription(""); setIncludeContext(false); setCategory("screen"); retry.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "신고를 접수하지 못했습니다. 다시 시도해 주세요."); }
    finally { pending.current = false; setBusy(false); }
  };
  const close = () => { if (!pending.current) { setOpen(null); setReceipt(null); setError(""); } };
  const openFeedback = () => {
    if (!description.trim()) setCategory("other");
    setOpen("feedback");
  };
  const openReport = () => {
    if (!description.trim()) setCategory("screen");
    setOpen("report");
  };

  return <>
    {presentation === "settings" ? <div className="settings-support-rows">
      {([
        ["help", BookOpen, "이용 안내", "행사방, 캘린더, 설문과 차량 배정"],
        ["faq", HelpCircle, "자주 묻는 질문", "공유 범위, 휴대폰 일정, 답변 설정"],
        ["report", Siren, "오류 신고", "화면 오류나 사용 중 겪은 문제 접수"],
        ["contact", Headset, "관리자 문의", "가입과 접근 권한 도움"],
      ] as const).map(([target, Icon, label, detail]) => <button key={target} type="button" aria-label={label} onClick={() => setOpen(target)}>
        <span className="settings-support-symbol"><Icon size={24} aria-hidden="true" /></span><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight size={18} aria-hidden="true" />
      </button>)}
    </div> : presentation === "help-center" ? <div className="settings-help-report-actions">
      <Button type="button" variant="outline" onClick={openReport}><Siren size={16} aria-hidden="true" />문제 신고</Button>
      <Button type="button" variant="outline" onClick={openFeedback}><MessageSquare size={16} aria-hidden="true" />개선 제안</Button>
    </div> : <>
      <button type="button" className="workspace-icon-button support-open" aria-label="도움말" title="도움말" onClick={() => setOpen("help")}><HelpCircle size={18} /></button>
      <button type="button" className="workspace-icon-button support-open report-open" aria-label="문제 신고" title="문제 신고" onClick={openReport}><Siren size={18} /></button>
    </>}
    {open === "help" && <RoomDialog title="사용설명서" onClose={close}><div className="room-dialog-body support-body">
      {quickHelpTopics.map(([title, steps]) => <details className="support-topic" key={title}><summary>{title}</summary><ol className="ml-5 list-decimal space-y-2 py-2 text-sm text-muted-foreground">{steps.map(step => <li key={step}>{step}</li>)}</ol></details>)}
    </div></RoomDialog>}
    {open === "faq" && <RoomDialog title="자주 묻는 질문" onClose={close}><div className="room-dialog-body support-body">
      {helpFaqs.map(({ question, answer }) => <details className="support-topic" key={question}><summary>{question}</summary><p>{answer}</p></details>)}
    </div></RoomDialog>}
    {open === "contact" && <RoomDialog title="관리자 문의" onClose={close}><div className="room-dialog-body support-body">
      <p>가입이나 접근 권한을 확인하려면 초대코드를 발급한 관리자에게 문의해 주세요.</p>
      <SupportEmail />
    </div></RoomDialog>}
    {(open === "report" || open === "feedback") && <RoomDialog title={open === "feedback" ? "개선 제안" : "문제 신고"} onClose={close}>
      {receipt ? <div className="room-dialog-body support-body">
        <p className="support-saved" role="status">{open === "feedback" ? "개선 제안이 접수되었습니다." : "신고가 접수되었습니다."}</p>
        <p className="support-note">{receiptMessages[receipt.notification]}</p>
        <div className="support-actions"><Button type="button" onClick={close}>확인</Button></div>
      </div> : <form className="room-dialog-body support-body" onSubmit={submit} aria-busy={busy}>
        {error && <p role="alert" className="documents-error">{error}</p>}
        <Field label="문제 유형"><select className={inputClass} value={category} disabled={busy} onChange={event => setCategory(event.target.value as FeedbackCategory)}>{Object.entries(feedbackCategories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
        <Field label={open === "feedback" ? "어떤 점을 개선하면 좋을까요?" : "어떤 문제가 있었나요?"}><textarea className={inputClass} rows={5} maxLength={3000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></Field>
        <label className="support-context"><input type="checkbox" checked={includeContext} disabled={busy} onChange={event => setIncludeContext(event.target.checked)} />화면 정보 포함</label>
        {includeContext && <p className="support-context-info">{screenName}{roomName ? ` · ${roomName}` : ""} · 화면 크기</p>}
        <p className="support-note">대화 내용과 첨부파일은 자동으로 포함하지 않습니다.</p>
        <div className="support-actions"><Button type="submit" variant="primary" disabled={busy}><Send size={16} aria-hidden="true" />{busy ? "접수 중" : open === "feedback" ? "제안 접수" : "신고 접수"}</Button></div>
      </form>}
    </RoomDialog>}
  </>;
}
