"use client";

import { BookOpen, ChevronRight, Headset, HelpCircle, Send, Siren } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { backendFetch, isBackendConnected } from "@/lib/backend-client";
import { DOCUMENT_DOWNLOAD_ONLY_EXTENSIONS, DOCUMENT_PREVIEW_EXTENSIONS, MAX_DOCUMENT_FILE_SIZE, MAX_ROOM_FILE_BYTES, MAX_ROOM_FILE_COUNT, MEBIBYTE } from "@/lib/document-files";
import { feedbackCategories, type FeedbackCategory } from "@/lib/feedback-store";
import { RoomDialog } from "./room-dialog";
import { Button, Field, inputClass } from "./ui";
import "./support-dialog.css";

const helpTopics = [
  ["행사방 시작", ["행사방을 만든 뒤 이름·기간을 설정합니다. 방의 연필 버튼으로 나중에 바꿀 수 있습니다.", "내 분류에 방을 넣어 목록을 정리합니다. 분류를 삭제해도 행사방은 남습니다."]],
  ["공유 범위와 권한", ["공동 캘린더는 같은 행사방에 입장한 구성원에게 보입니다. 로그인한 운영자는 일정 추가·수정이 가능하고 삭제는 권한이 필요합니다.", "대화, 체크리스트, 차량 배정, 장소, 자료, 제안 검토는 내 계정의 해당 대화에만 보입니다."]],
  ["공동 캘린더와 휴대폰", ["캘린더 → 일정 추가에서 제목과 날짜를 입력합니다. 두 시간을 비우면 00:00~22:00, 시작만 지정하면 한 시간 뒤에 종료됩니다.", "이전 일정은 일정 목록이나 날짜 칸에서 열어 수정합니다. 확정 일정만 연결된 개인 Google 캘린더로 전송됩니다.", "휴대폰 Google 캘린더에서 교회 행사 캘린더를 표시합니다. 공유 일정을 바꿀 때는 행사비서 웹에서 수정합니다."]],
  ["준비 점검과 체크리스트", ["수련회 방에서 준비 점검을 열어 행사 날짜, 대표 장소, 배정 승인 등 저장된 근거를 확인합니다. 이름에 ‘요람’ 또는 ‘과거 기록’ 등이 들어간 TXT·MD(256 KiB 이하)를 현재 대화에서 고정하면 관련 내용이 참고 근거로 나오며 올해 확정 정보와 구분됩니다.", "준비 현황에서 직접 입력하거나, 내 메시지의 준비 항목 버튼으로 편집창을 열고 저장합니다. 같은 메시지를 다시 선택하면 기존 항목이 열립니다.", "준비 점검에서 채팅으로 요약을 누르면 현재 대화에만 요약이 추가되며 외부 모델에 자료를 보내지 않습니다.", "물놀이는 관련 항목을 추가한 경우만 점검에 나타납니다. 진행을 확정했다면 안전 담당자를 지정하고 해당 항목을 완료로 바꿉니다."]],
  ["장소 저장과 지도", ["장소 탭에서 집합 장소, 행사장, 숙소처럼 여러 장소를 추가합니다. 별표로 대표 장소를 지정하면 준비 점검에 사용됩니다.", "장소를 선택하고 지도 또는 길찾기를 엽니다. 앱 안의 지도만 안 보이면 Google Maps에서 열기를 사용합니다."]],
  ["설문과 차량 배정", ["환경설정 → 보안 및 개인정보 → 외부 서비스 연결에서 Google 계정을 연결합니다. 캘린더 전송, 설문 읽기, 설문 생성 권한을 한 번에 연결할 수 있습니다.", "참가·이동 → 차량 배정에서 폼 불러오기를 눌러 Google 설문 응답이나 CSV를 확인하고 반영합니다. 사용 중인 팀은 연결된 참가자·차량을 먼저 변경한 뒤 삭제할 수 있습니다.", "배정 계산 → 결과 검토 → 배정안 승인 순서로 진행합니다. 확정 CSV는 승인 이후 다운로드합니다."]],
  ["자료 관리", [
    "파일 선택으로 자료를 추가하고, 이름을 누르면 미리보기 창이 열립니다. 미리보기를 지원하지 않는 문서는 내려받아 열 수 있습니다.",
    `미리보기: ${DOCUMENT_PREVIEW_EXTENSIONS.map(ext => ext === "DOCX" ? "DOCX(본문과 표)" : ext === "WEBP" ? "WebP" : ext).join(", ")}`,
    `다운로드 전용: ${DOCUMENT_DOWNLOAD_ONLY_EXTENSIONS.join(", ")}`,
    `파일당 최대 ${MAX_DOCUMENT_FILE_SIZE / MEBIBYTE} MiB입니다. 서버 저장 한도는 내 계정의 행사방 하나 기준 최대 ${MAX_ROOM_FILE_COUNT.toLocaleString("ko-KR")}개, 합계 ${MAX_ROOM_FILE_BYTES / MEBIBYTE} MiB입니다. 최대 크기 파일만 올리면 ${Math.floor(MAX_ROOM_FILE_BYTES / MAX_DOCUMENT_FILE_SIZE)}개까지 저장할 수 있습니다.`,
    "핀으로 중요한 자료를 상단에 고정하고, 순서 편집으로 자료 위치를 바꾼 뒤 저장합니다."
  ]],
  ["채팅 명단 가져오기", ["명단을 입력창에 붙여 넣고 전송 없이 참가자 가져오기 버튼을 누르면 외부 모델로 보내지 않고 검토합니다. 이전에 저장한 내 메시지에서도 열 수 있습니다.", "이름을 한 줄에 한 명씩 적거나 이름·소속·가족 ID·출발 팀·귀가편 열이 있는 CSV를 붙여 넣습니다. 미리보기에서 동명이인과 이동편을 확인한 뒤 추가합니다."]],
  ["제안 검토와 문제 신고", ["로그인한 행사방에서는 해당 대화의 행사비서 답변과 준비 점검에서 나온 제안을 검토합니다. 원문을 확인한 뒤 반영·보류·제외를 선택합니다. 회의록 샘플은 체험 자료이며 파일 분석 결과가 아닙니다.", "문제가 있으면 빨간 사이렌을 눌러 종류와 상황을 적어 주세요. 대화와 첨부파일은 신고에 자동으로 포함되지 않습니다."]],
] as const;

type Receipt = { notification: "queued" | "sent" | "failed" | "unconfigured" };
const receiptMessages: Record<Receipt["notification"], string> = {
  queued: "운영자 메일 알림은 발송 대기 중입니다.",
  sent: "메일 서비스가 운영자 알림을 접수했습니다.",
  failed: "메일 알림을 보내지 못했습니다. 신고는 서버에 저장되어 있습니다.",
  unconfigured: "운영자 메일 알림은 아직 설정되지 않았습니다. 신고는 서버에 저장되어 있습니다."
};

export function SupportButton({ screenName, roomName, presentation = "toolbar" }: { screenName: string; roomName?: string; presentation?: "toolbar" | "settings" }) {
  const [open, setOpen] = useState<"help" | "faq" | "report" | "contact" | null>(null);
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
    </div> : <>
      <button type="button" className="workspace-icon-button support-open" aria-label="도움말" title="도움말" onClick={() => setOpen("help")}><HelpCircle size={18} /></button>
      <button type="button" className="workspace-icon-button support-open report-open" aria-label="문제 신고" title="문제 신고" onClick={() => setOpen("report")}><Siren size={18} /></button>
    </>}
    {open === "help" && <RoomDialog title="사용설명서" onClose={close}><div className="room-dialog-body support-body">
      {helpTopics.map(([title, steps]) => <details className="support-topic" key={title}><summary>{title}</summary><ol className="ml-5 list-decimal space-y-2 py-2 text-sm text-muted-foreground">{steps.map(step => <li key={step}>{step}</li>)}</ol></details>)}
    </div></RoomDialog>}
    {open === "faq" && <RoomDialog title="자주 묻는 질문" onClose={close}><div className="room-dialog-body support-body">
      <details className="support-topic"><summary>다른 구성원도 제 대화를 볼 수 있나요?</summary><p>아니요. 같은 행사방에서는 공동 캘린더만 공유되며 대화는 각 계정에만 보입니다.</p></details>
      <details className="support-topic"><summary>휴대폰에서 일정을 못 찾겠어요.</summary><p>행사비서에서 일정이 확정 상태인지 확인하고, 휴대폰 캘린더에 연결한 Google 계정의 교회 행사 캘린더를 표시하세요.</p></details>
      <details className="support-topic"><summary>개인 답변 지침이 왜 반영되지 않나요?</summary><p>개인 답변 지침은 저장만 하며 외부 모델에 보내지 않습니다. 말투, 답변 길이, 이모티콘 설정은 적용됩니다.</p></details>
    </div></RoomDialog>}
    {open === "contact" && <RoomDialog title="관리자 문의" onClose={close}><div className="room-dialog-body support-body">
      <p>가입이나 접근 권한을 확인하려면 초대코드를 발급한 관리자에게 문의해 주세요.</p>
      <p className="support-note">공개 문의 연락처는 설정되어 있지 않습니다.</p>
    </div></RoomDialog>}
    {open === "report" && <RoomDialog title="문제 신고" onClose={close}>
      {receipt ? <div className="room-dialog-body support-body">
        <p className="support-saved" role="status">신고가 접수되었습니다.</p>
        <p className="support-note">{receiptMessages[receipt.notification]}</p>
        <div className="support-actions"><Button type="button" onClick={close}>확인</Button></div>
      </div> : <form className="room-dialog-body support-body" onSubmit={submit} aria-busy={busy}>
        {error && <p role="alert" className="documents-error">{error}</p>}
        <Field label="문제 유형"><select className={inputClass} value={category} disabled={busy} onChange={event => setCategory(event.target.value as FeedbackCategory)}>{Object.entries(feedbackCategories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
        <Field label="어떤 문제가 있었나요?"><textarea className={inputClass} rows={5} maxLength={3000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></Field>
        <label className="support-context"><input type="checkbox" checked={includeContext} disabled={busy} onChange={event => setIncludeContext(event.target.checked)} />화면 정보 포함</label>
        {includeContext && <p className="support-context-info">{screenName}{roomName ? ` · ${roomName}` : ""} · 화면 크기</p>}
        <p className="support-note">대화 내용과 첨부파일은 자동으로 포함하지 않습니다.</p>
        <div className="support-actions"><Button type="submit" variant="primary" disabled={busy}><Send size={16} />{busy ? "접수 중" : "신고 접수"}</Button></div>
      </form>}
    </RoomDialog>}
  </>;
}
