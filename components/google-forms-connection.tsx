"use client";

import { FileSpreadsheet, Link2, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { backendFetch, dataStorage, flushBackendWrites, getBackendProfile, getBackendServerState, getBackendState, refreshBackendData, subscribeBackend } from "@/lib/backend-client";
import { privateToolKey, scopeId } from "@/lib/conversation-scope";
import { clearGoogleFormsRosterTarget, getGoogleFormsRosterTarget } from "@/lib/google-forms-roster-target";
import { googleFormsEndpoint, parseGoogleFormsPreview, type GoogleFormsPreview } from "@/lib/google-forms-preview";
import { validateTransportInput } from "@/lib/transport";
import { parseTransportSnapshot, type TransportSnapshot } from "@/lib/transport-snapshot";
import { analyzeSurvey, mergeGoogleSurvey } from "@/lib/transport-survey";
import { writeBrowserRecord } from "@/lib/storage-status";
import { GoogleFormDraftActions } from "./google-form-draft-actions";
import { BlankGoogleFormLink, GoogleFormsRespondentLink } from "./google-forms-sharing";
import { SurveyPreview } from "./transport-survey-form";
import { Button } from "./ui";

type Status = { configured: boolean; connected: boolean; needsReconnect?: boolean };
const endpoint = googleFormsEndpoint;
const post = (data: object) => backendFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export function GoogleFormsConnection() {
  const { userId } = useSyncExternalStore(subscribeBackend, getBackendState, getBackendServerState);
  return <GoogleFormsAccountControls key={userId} />;
}

function GoogleFormsAccountControls() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    void backendFetch(endpoint).then((value) => { if (mounted) setStatus(value); }).catch((cause) => {
      if (mounted) setError(cause instanceof Error ? cause.message : "연결 상태를 확인하지 못했습니다.");
    });
    return () => { mounted = false; };
  }, [refreshCount]);

  const action = async (type: "connect" | "disconnect") => {
    if (busy) return;
    if (type === "disconnect" && !window.confirm("구글폼 연결을 해제할까요? 이미 가져온 응답은 그대로 남습니다.")) return;
    setBusy(true); setError("");
    try {
      if (type === "connect") await flushBackendWrites();
      const result = await post({ action: type });
      if (type === "connect") { window.location.assign(result.url); return; }
      setStatus({ configured: status?.configured ?? false, connected: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 완료하지 못했습니다.");
    } finally { setBusy(false); }
  };
  const label = !status ? "" : !status.configured ? "서버 설정 필요" : status.needsReconnect ? "읽기 권한 재동의 필요" : status.connected ? "연결됨" : "연결 안 됨";
  return <section className="border-b border-border py-4" aria-label="Google Forms">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><FileSpreadsheet size={16} aria-hidden="true" />Google Forms</h3>
      <span className="text-xs text-muted-foreground">문항·응답 읽기 전용</span>
    </div>
    {status && <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {!status.connected && <Button type="button" variant="outline" disabled={busy || !status.configured} onClick={() => void action("connect")}><Link2 size={14} aria-hidden="true" />{busy ? "연결 중" : status.needsReconnect ? "읽기 권한으로 다시 연결" : "구글폼 연결"}</Button>}
      {(status.connected || status.needsReconnect) && <Button type="button" variant="outline" disabled={busy} onClick={() => void action("disconnect")}><Unplug size={14} aria-hidden="true" />구글폼 연결 해제</Button>}
    </div>}
    {!status && !error && <p className="mt-2 text-xs text-muted-foreground" role="status">연결 상태 확인 중...</p>}
    {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    {!status && error && <Button className="mt-2" type="button" variant="outline" onClick={() => { setError(""); setRefreshCount((count) => count + 1); }}><RefreshCw size={14} />다시 확인</Button>}
    <div className="mt-3"><BlankGoogleFormLink /></div>
    {status?.connected && <AccountFormsPreview disabled={busy} />}
    <GoogleFormDraftActions />
  </section>;
}

export function AccountFormsPreview({ disabled, allowConversationImport = false }: { disabled: boolean; allowConversationImport?: boolean }) {
  const [url, setUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<GoogleFormsPreview>();
  const [target, setTarget] = useState<ReturnType<typeof getGoogleFormsRosterTarget>>();
  const [roster, setRoster] = useState<{ raw: string; snapshot: TransportSnapshot }>();
  useEffect(() => {
    if (allowConversationImport) setTarget(getGoogleFormsRosterTarget(getBackendProfile()?.accountId));
  }, [allowConversationImport]);
  const read = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || reading || !url.trim()) return;
    setReading(true); setPreview(undefined); setRoster(undefined); setError(""); setNotice("");
    try {
      if (!target) {
        setPreview(parseGoogleFormsPreview(await post({ action: "account-preview", url: url.trim() })));
        return;
      }
      const scope = target.scope;
      const stillCurrent = () => getGoogleFormsRosterTarget(getBackendProfile()?.accountId)?.at === target.at;
      if (!stillCurrent()) throw new Error("가져올 대화가 바뀌었습니다. 참가자 명단에서 다시 열어 주세요.");
      await refreshBackendData(scope.roomId, scope.conversationId);
      if (!stillCurrent()) throw new Error("가져올 대화가 바뀌었습니다. 참가자 명단에서 다시 열어 주세요.");
      const raw = dataStorage(sessionStorage).getItem(privateToolKey(scope, "transport"));
      const snapshot = raw ? parseTransportSnapshot(raw) : undefined;
      const next = parseGoogleFormsPreview(await post({ action: "preview", ...scope, url: url.trim() }));
      if (!stillCurrent()) throw new Error("가져올 대화가 바뀌었습니다. 참가자 명단에서 다시 열어 주세요.");
      const prior = snapshot?.survey;
      if (next.survey && prior?.source && prior.source.formId === next.survey.source?.formId &&
        JSON.stringify(prior.data.headers) === JSON.stringify(next.survey.data.headers)) next.survey = { ...next.survey, mapping: prior.mapping };
      setPreview(next);
      if (raw && snapshot && !snapshot.demo && snapshot.input.vehicles.length) setRoster({ raw, snapshot });
      else if (next.survey) setNotice("미리보기는 가능하지만 명단에 반영하려면 실제 차량을 한 대 이상 등록해 주세요.");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "구글폼 응답을 불러오지 못했습니다."); }
    finally { setReading(false); }
  };
  const apply = async () => {
    if (!target || !roster || !preview?.survey || reading || disabled) return;
    const { scope } = target;
    const survey = preview.survey;
    setReading(true); setError(""); setNotice("");
    try {
      const currentTarget = () => getGoogleFormsRosterTarget(getBackendProfile()?.accountId);
      const hasTarget = () => {
        const current = currentTarget();
        return !!current && current.at === target.at && scopeId(current.scope) === scopeId(scope);
      };
      if (!hasTarget()) throw new Error("가져올 대화가 바뀌었습니다. 참가자 명단에서 다시 열어 주세요.");
      await flushBackendWrites();
      await refreshBackendData(scope.roomId, scope.conversationId);
      if (!hasTarget()) throw new Error("가져올 대화가 바뀌었습니다. 참가자 명단에서 다시 열어 주세요.");
      const key = privateToolKey(scope, "transport");
      const storage = dataStorage(sessionStorage);
      if (storage.getItem(key) !== roster.raw) throw new Error("참가자 명단이 바뀌었습니다. 응답을 다시 미리보기한 뒤 반영해 주세요.");
      if (!analyzeSurvey(survey.data, survey.mapping).canImport) throw new Error("설문 응답의 필수 정보를 확인해 주세요.");
      const input = mergeGoogleSurvey(roster.snapshot.input, survey);
      const problems = validateTransportInput(input, { draft: true });
      if (problems.length) throw new Error(problems.join(" "));
      writeBrowserRecord(storage, key, { ...roster.snapshot, input, survey, approved: input === roster.snapshot.input && roster.snapshot.approved }, "tab");
      await flushBackendWrites();
      if (!hasTarget()) return;
      clearGoogleFormsRosterTarget(); setTarget(undefined); setRoster(undefined); setPreview(undefined);
      const added = input.people.length - roster.snapshot.input.people.length;
      setNotice(added ? `이 대화의 참가자 명단에 ${added}명을 추가했습니다.` : "이 대화에 설문 응답을 저장했습니다. 새로 추가한 참가자는 없습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "명단에 저장하지 못했습니다."); }
    finally { setReading(false); }
  };
  return <div className="mt-4 grid min-w-0 gap-3">
    {target && <p className="break-words text-sm text-muted-foreground">가져올 대화: <strong>{target.label}</strong></p>}
    <form className="grid min-w-0 gap-2" onSubmit={(event) => void read(event)}>
      <label className="grid min-w-0 gap-1 text-sm font-medium">구글폼 편집 주소
        <input type="url" className="w-full min-w-0 rounded-md border border-border bg-panel px-3 py-2 text-sm"
          value={url} maxLength={1024} disabled={disabled || reading} placeholder="https://docs.google.com/forms/d/…/edit"
          onChange={(event) => { setUrl(event.target.value); setPreview(undefined); setError(""); }} />
      </label>
      <Button className="justify-self-start" type="submit" variant="outline" disabled={disabled || reading || !url.trim()}>
        <RefreshCw size={14} aria-hidden="true" />{reading ? "처리 중" : "응답 미리보기"}
      </Button>
    </form>
    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
    {preview && <>
      <GoogleFormsRespondentLink url={preview.respondentUrl} />
      {preview.notice && <p className="text-xs text-muted-foreground" role="status">{preview.notice}</p>}
      {preview.survey && <fieldset disabled={reading || disabled} className="min-w-0">
        <SurveyPreview survey={preview.survey} editable={!!roster} hasPeople={!!roster?.snapshot.input.people.length} people={roster?.snapshot.input.people}
          previous={roster?.snapshot.survey} onMapping={survey => setPreview({ ...preview, survey })} onImport={roster ? () => void apply() : undefined} />
      </fieldset>}
    </>}
  </div>;
}
