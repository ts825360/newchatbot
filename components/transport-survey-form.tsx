"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, FileUp, Link2, RefreshCw, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { analyzeSurvey, defaultSurveyMapping, MAX_SURVEY_BYTES, parseSurveyCsv, surveyFields, type TransportSurvey } from "@/lib/transport-survey";
import { backendFetch, isBackendConnected } from "@/lib/backend-client";
import type { ConversationScope } from "@/lib/conversation-scope";
import { googleFormsEndpoint, parseGoogleFormsPreview } from "@/lib/google-forms-preview";
import { googleSettingsHref } from "@/lib/google-settings";
import type { TransportPerson } from "@/lib/transport";
import { GoogleFormDraftActions } from "./google-form-draft-actions";
import { BlankGoogleFormLink, GoogleFormsRespondentLink } from "./google-forms-sharing";
import "./transport-survey-form.css";

const endpoint = googleFormsEndpoint;
const post = (body: object) => backendFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function TransportSurveyForm({ hasPeople, onCancel, onImport, scope, previous, people, initialMode, onRegisterVehicle, csvOnly }: {
  hasPeople: boolean;
  onCancel?: () => void;
  onImport: (survey: TransportSurvey) => void;
  scope?: ConversationScope;
  previous?: TransportSurvey;
  people?: TransportPerson[];
  initialMode?: "csv" | "google";
  csvOnly?: boolean;
  onRegisterVehicle?: () => void;
}) {
  const [draft, setDraft] = useState<TransportSurvey>();
  const [filename, setFilename] = useState("");
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);
  const [mode, setMode] = useState<"csv" | "google">(csvOnly ? "csv" : initialMode ?? (previous?.source ? "google" : "csv"));
  const [editorUrl, setEditorUrl] = useState(previous?.source ? `https://docs.google.com/forms/d/${previous.source.formId}/edit` : "");
  const [googlePreview, setGooglePreview] = useState<{ respondentUrl?: string; notice?: string }>();
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean }>();
  const enabled = Boolean(scope && isBackendConnected());

  useEffect(() => {
    if (!enabled || mode !== "google") return;
    let active = true;
    void backendFetch(endpoint).then((value) => { if (active) setStatus(value); })
      .catch((cause) => { if (active) setReadError(cause.message); });
    return () => { active = false; };
  }, [enabled, mode]);

  const changeMode = (next: typeof mode) => {
    if (next === mode || reading) return;
    setMode(next); setDraft(undefined); setGooglePreview(undefined); setReadError(""); setFilename("");
  };
  const previewGoogle = async () => {
    if (!scope || reading) return;
    setReadError(""); setReading(true);
    setDraft(undefined); setGooglePreview(undefined);
    try {
      const { survey: result, ...metadata } = parseGoogleFormsPreview(await post({ action: "preview", ...scope, url: editorUrl.trim() }));
      setGooglePreview(metadata);
      if (!result) return;
      const matchingQuestions = previous?.source?.formId === result.source?.formId && JSON.stringify(previous?.data.headers) === JSON.stringify(result.data.headers);
      setDraft(matchingQuestions && previous ? { ...result, mapping: previous.mapping } : result);
    } catch (cause) { setReadError(cause instanceof Error ? cause.message : "구글폼 응답을 불러오지 못했습니다."); }
    finally { setReading(false); }
  };
  return <section className={onCancel ? "transport-survey" : "transport-survey transport-survey-page"}>
    <header><h3>설문 응답 불러오기</h3>{onCancel && <button type="button" title="가져오기 닫기" aria-label="가져오기 닫기" onClick={onCancel}><X size={16} /></button>}</header>
    {!csvOnly && <div className="transport-survey-actions" role="group" aria-label="가져오기 방식">
      <button type="button" aria-pressed={mode === "csv"} disabled={reading} onClick={() => changeMode("csv")}><FileUp size={15} />CSV 파일</button>
      <button type="button" aria-pressed={mode === "google"} disabled={reading} onClick={() => changeMode("google")}><Link2 size={15} />구글폼</button>
    </div>}
    {mode === "csv" && <label className="transport-survey-file"><FileUp size={16} /> Google Forms 응답 CSV
      <input type="file" accept=".csv,text/csv" disabled={reading} onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setDraft(undefined); setFilename(""); setReadError(""); setReading(true);
        try {
          if (!/\.csv$/i.test(file.name) || file.size > MAX_SURVEY_BYTES) throw new Error("128 KiB 이하의 CSV 파일을 선택해 주세요.");
          const utf8 = new TextDecoder("utf-8", { fatal: true });
          const bytes = await file.arrayBuffer();
          let csv: string;
          try { csv = utf8.decode(bytes); }
          catch { throw new Error("파일을 UTF-8 CSV로 다시 저장해 주세요."); }
          const data = parseSurveyCsv(csv);
          setDraft({ data, mapping: defaultSurveyMapping(data.headers) });
          setFilename(file.name);
        } catch (cause) { setReadError(cause instanceof Error ? cause.message : "CSV를 읽지 못했습니다."); }
        finally { setReading(false); }
      }} />
    </label>}
    {mode === "google" && <div className="transport-survey-google">
      <BlankGoogleFormLink />
      {enabled && scope && <GoogleFormDraftActions scope={{ roomId: scope.roomId, conversationId: scope.conversationId }}
        onUseEditorUrl={status?.connected && !reading ? (url) => {
          setEditorUrl(url); setDraft(undefined); setGooglePreview(undefined); setReadError("");
        } : undefined} />}
      {!enabled ? <p>로그인된 서버에서 구글폼을 불러올 수 있습니다.</p> : !status ? !readError && <p role="status">연결 확인 중</p>
        : !status.configured || !status.connected ? <>
          <p className="transport-footnote">{status.configured ? "구글폼 읽기 권한 연결이 필요합니다." : "구글폼 서버 설정이 필요합니다."}</p>
          <Link className="lobby-secondary" href={googleSettingsHref("forms")}><Settings2 size={14} aria-hidden="true" />환경설정에서 연결</Link>
        </>
        : <>
          <label>구글폼 편집 주소<input type="url" value={editorUrl} disabled={reading} maxLength={1024} placeholder="https://docs.google.com/forms/d/…/edit"
            onChange={(e) => { setEditorUrl(e.target.value); setDraft(undefined); setGooglePreview(undefined); setReadError(""); }} /></label>
          <p className="transport-footnote">응답자에게 보낸 링크가 아닌, 양식을 편집할 때 주소창에 보이는 주소입니다.</p>
          <div className="transport-survey-actions">
            <button type="button" className="transport-primary" disabled={reading || !editorUrl.trim()} onClick={() => void previewGoogle()}><RefreshCw size={15} />응답 미리보기</button>
          </div>
          {googlePreview && <>
            <GoogleFormsRespondentLink url={googlePreview.respondentUrl} />
            {googlePreview.notice && <p className="transport-footnote" role="status">{googlePreview.notice}</p>}
          </>}
        </>}
    </div>}
    {onRegisterVehicle && <div className="transport-survey-actions transport-survey-prerequisite">
      <p>차량 등록 후 응답을 참가자 명단에 반영할 수 있습니다.</p><button type="button" onClick={onRegisterVehicle}>차량 등록</button>
    </div>}
    {reading && <p role="status">요청 처리 중</p>}
    {readError && <p className="transport-warning" role="alert">{readError}</p>}
    {filename && <p role="status" className="transport-footnote transport-survey-filename">읽은 파일: {filename}</p>}
    {draft && <SurveyPreview survey={draft} editable onMapping={setDraft} hasPeople={hasPeople} people={people} previous={previous} onImport={onRegisterVehicle ? undefined : () => onImport(draft)} />}
  </section>;
}

const statusLabels = { attending: "참석", absent: "불참", unresolved: "확인 필요" };

export function SurveyPreview({ survey, editable, onMapping, hasPeople, onImport, people, previous }: {
  survey: TransportSurvey;
  editable?: boolean;
  onMapping?: (survey: TransportSurvey) => void;
  hasPeople?: boolean;
  onImport?: () => void;
  people?: TransportPerson[];
  previous?: TransportSurvey;
}) {
  const [filter, setFilter] = useState<"all" | keyof typeof statusLabels>("all");
  const [page, setPage] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const review = analyzeSurvey(survey.data, survey.mapping);
  const entries = review.entries.filter((entry) => filter === "all" || entry.status === filter);
  const pages = Math.max(1, Math.ceil(entries.length / 12));
  const current = Math.min(page, pages - 1);
  const ids = new Set(people?.map((p) => p.id));
  const matches = (index: number) => survey.source && ids.has(survey.source.personIds[index]);
  const sameNameInRoster = (entry: typeof review.entries[number]) => !!survey.source && entry.status === "attending" && !matches(entry.index)
    && !!people?.some(p => p.name.trim() === entry.name && p.department.trim() === entry.department);
  const duplicates = review.entries.some((entry) => entry.duplicate || sameNameInRoster(entry));
  const additions = survey.source ? review.entries.filter((entry) => entry.status === "attending" && !matches(entry.index)).length : 0;
  const oldRows = previous?.source?.formId === survey.source?.formId && previous?.source ? new Map(previous.source.personIds.map((id, index) => [id, previous.data.rows[index]])) : new Map<string, string[]>();
  const changedResponse = (index: number) => {
    if (!survey.source) return false;
    const old = oldRows.get(survey.source.personIds[index]);
    return old && JSON.stringify(old) !== JSON.stringify(survey.data.rows[index]);
  };

  return <div className="transport-survey-preview">
    {editable && <div className="transport-survey-mapping">{(Object.keys(surveyFields) as Array<keyof typeof surveyFields>).map((field) => <label key={field}>{surveyFields[field]}{["attendance", "name"].includes(field) ? " (필수)" : ""}
      <select value={survey.mapping[field] ?? -1} onChange={(event) => {
        setAcknowledged(false);
        onMapping?.({ ...survey, mapping: { ...survey.mapping, [field]: Number(event.target.value) } });
      }}><option value={-1}>열 선택 안 함</option>{survey.data.headers.map((header, index) => <option key={index} value={index}>{index + 1}. {header || "제목 없음"}</option>)}</select>
    </label>)}</div>}
    <div className="transport-survey-stats"><strong>전체 {survey.data.rows.length}건</strong><span>참석 {review.counts.attending}건</span><span>불참 {review.counts.absent}건</span>{editable && survey.source && <span>추가 대상 {additions}명</span>}{review.counts.unresolved > 0 && <span className="transport-warning">확인 필요 {review.counts.unresolved}건</span>}</div>
    {editable && <>
      {!review.canImport && <p className="transport-warning">참석 여부와 이름 열을 각각 지정해 주세요. 확인 필요 응답이 없어야 하고 참석은 최대 250명까지 반영할 수 있습니다.</p>}
      {duplicates && <label className="transport-check"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />이름·소속이 같은 응답을 확인했고 별도 인원으로 반영합니다.</label>}
      <p className="transport-footnote">출발·귀가 답변을 참가자 표에 가져옵니다. 빈 답변에는 기본 팀이 적용되며, 등록된 팀과 연결되지 않는 답변은 확인이 필요합니다.</p>
      <p className="transport-footnote">불참 응답과 특이사항도 설문 기록에 포함됩니다.</p>
      {hasPeople && (survey.source ? <p className="transport-footnote">기존 참가자는 그대로 두고 새 참석 응답만 추가합니다. 수정·취소된 응답은 아래에서 확인하세요.</p> : <p className="transport-warning">기존 명단을 교체합니다. 이전 배정·잠금과 참가자 운전자 지정은 초기화됩니다.</p>)}
      <button type="button" className="transport-primary" disabled={!onImport || !review.canImport || (duplicates && !acknowledged)} onClick={onImport}><Check size={16} /> {survey.source ? additions ? "신규 참석자 추가" : "설문 응답 저장" : review.counts.attending ? "참석자 반영" : "설문 응답 저장"}</button>
    </>}
    <label className="transport-survey-filter">응답 보기 <select value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(0); }}>
      <option value="all">전체</option>{(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
    </select></label>
    {!entries.length && <p className="transport-footnote">해당 응답이 없습니다.</p>}
    {entries.slice(current * 12, (current + 1) * 12).map((entry) => <details className="transport-survey-response" key={entry.index}>
      <summary>{entry.index + 1}. {entry.name || "응답"} · {statusLabels[entry.status]}{editable && matches(entry.index) && " · 이미 반영됨"}{changedResponse(entry.index) && " · 응답 변경"}{(entry.duplicate || sameNameInRoster(entry)) && " · 이름·소속 중복"}{entry.status === "attending" && entry.movementReview && " · 이동 확인"}</summary>
      <dl>{survey.data.headers.map((header, index) => <div key={index}><dt>{header || `질문 ${index + 1}`}</dt><dd>{entry.cells[index] || "응답 없음"}</dd></div>)}</dl>
    </details>)}
    {pages > 1 && <div className="transport-survey-pagination">
      <button type="button" aria-label="이전 응답 페이지" disabled={!current} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button>
      <span>{current + 1}/{pages}</span>
      <button type="button" aria-label="다음 응답 페이지" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button>
    </div>}
  </div>;
}
