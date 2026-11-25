"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BackendError, backendFetch, getBackendState, subscribeBackend } from "@/lib/backend-client";
import { devotionBodyLimit, devotionChanged, devotionDayLabel, devotionTitleLimit, type DevotionEntry, type DevotionFeed } from "@/lib/devotions";
import { usePrototypeTheme } from "@/lib/use-theme";
import { BrandLogo } from "./brand-logo";
import { RoomDialog } from "./room-dialog";
import { Button, Field, inputClass } from "./ui";
import "./devotions.css";

const feedPath = "/api/devotions";
type Editor = DevotionEntry;

export function DevotionsScreen() {
  const router = useRouter();
  const date = useSearchParams().get("date");
  const account = useSyncExternalStore(subscribeBackend, () => getBackendState().userId, () => null);
  const currentAccount = useRef(account);
  currentAccount.current = account;
  const { darkMode, toggleTheme } = usePrototypeTheme();
  const feedKey = JSON.stringify([account, date]);
  const [loaded, setLoaded] = useState<{ key: string; data: DevotionFeed } | null>(null);
  const feed = loaded?.key === feedKey ? loaded.data : null;
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [edit, setEdit] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<DevotionEntry | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [dialogAccount, setDialogAccount] = useState<string | null>(null);
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const activeFeedKey = useRef(feedKey);
  activeFeedKey.current = feedKey;

  useEffect(() => {
    if (!account) { router.replace("/login"); return; }
    const controller = new AbortController();
    setLoadError("");
    void backendFetch(`${feedPath}${query}`, { signal: controller.signal }).then((data: DevotionFeed) => {
      if (!controller.signal.aborted) { setLoaded({ key: feedKey, data }); setDenied(null); }
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof BackendError && [401, 403].includes(cause.status)) {
        setDenied(account); setLoaded(null);
        if (cause.status === 401) router.replace("/login");
      }
      setLoadError(feedback(cause));
    });
    return () => controller.abort();
  }, [account, feedKey, query, refresh, router]);

  function openEditor(entry?: DevotionEntry) {
    if (!feed || !account) return;
    setDialogAccount(account); setSaveError("");
    setEdit(entry ? { ...entry } : { date: feed.today, revision: 0, title: "", body: "" });
  }
  function changeDate(next?: string) {
    router.replace(next ? `/devotions?date=${encodeURIComponent(next)}` : "/devotions");
  }
  async function more() {
    if (!feed?.next || archiveBusy) return;
    const cursor = new URLSearchParams({ before: feed.next, ...(date && { date }) });
    setArchiveBusy(true); setLoadError("");
    try {
      const data: DevotionFeed = await backendFetch(`${feedPath}?${cursor}`);
      if (activeFeedKey.current !== feedKey) return;
      setLoaded(current => current?.key === feedKey ? { key: feedKey, data: { ...data,
        archive: [...new Map([...current.data.archive, ...data.archive].map(item => [item.date, item])).values()] } } : current);
    } catch (cause) {
      if (activeFeedKey.current !== feedKey) return;
      if (cause instanceof BackendError && [401, 403].includes(cause.status)) { setDenied(account); setLoaded(null); }
      setLoadError(feedback(cause));
    } finally { setArchiveBusy(false); }
  }
  async function save(method: "PUT" | "DELETE", entry: DevotionEntry) {
    if (!feed?.canPublish || saving || dialogAccount !== account) return;
    setSaving(true); setSaveError(""); setSaveNotice("");
    try {
      await backendFetch(feedPath, { method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "PUT" ? entry : { date: entry.date, revision: entry.revision }) });
      if (currentAccount.current !== account) return;
      setEdit(null); setRemoving(null);
      setSaveNotice(method === "PUT" ? "말씀을 게시했습니다." : "말씀을 삭제했습니다.");
      changeDate(method === "PUT" ? entry.date : undefined);
      setRefresh(value => value + 1);
      window.dispatchEvent(new Event(devotionChanged));
    } catch (cause) {
      if (currentAccount.current === account) setSaveError(feedback(cause));
    } finally { setSaving(false); }
  }

  if (!account) return <main className="lobby-loading" role="status">접속 확인 중…</main>;
  const entry = denied === account ? null : feed?.entry;
  const isPast = !!entry && entry.date !== feed?.today;
  return <main className="lobby-page devotion-page">
    <header className="lobby-header"><BrandLogo />
      <button className="lobby-icon-button" type="button" onClick={toggleTheme} aria-label={darkMode ? "라이트 모드" : "다크 모드"} title={darkMode ? "라이트 모드" : "다크 모드"}>
        {darkMode ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </header>
    <div className="devotions-content">
      <Link href="/rooms" className="devotion-back"><ArrowLeft size={16} aria-hidden="true" />행사방 목록</Link>
      <header className="devotion-heading">
        <h1><BookOpen size={22} aria-hidden="true" />오늘의 말씀</h1>
        {feed?.canPublish && denied !== account && <Button type="button" variant="primary" onClick={() => openEditor()}><Plus size={16} />말씀 등록</Button>}
      </header>
      {loadError && <p role="alert" className="auth-error-summary">{loadError}</p>}
      {saveNotice && <p role="status" className="lobby-notice">{saveNotice}</p>}
      {!feed && !loadError && <p className="devotion-muted" role="status">말씀을 불러오는 중…</p>}
      {feed && denied !== account && <div className="devotion-layout">
        <section className="devotion-reader" aria-label="말씀 본문">
          {(!entry || isPast) && !date && <p className="devotion-muted">오늘은 아직 등록된 말씀이 없습니다.</p>}
          {entry ? <>
            <div className="devotion-entry-heading"><div><time dateTime={entry.date}>{devotionDayLabel(entry.date)}</time>
              {isPast && !date && <span>최근 등록</span>}
            </div>{feed.canPublish && <div className="devotion-entry-tools">
              <button type="button" className="lobby-icon-button" title="말씀 수정" aria-label="말씀 수정" onClick={() => openEditor(entry)}><Pencil size={17} /></button>
              <button type="button" className="lobby-icon-button" title="말씀 삭제" aria-label="말씀 삭제" onClick={() => {
                setDialogAccount(account); setSaveError(""); setRemoving(entry);
              }}><Trash2 size={17} /></button>
            </div>}</div>
            {entry.title && <h2>{entry.title}</h2>}
            <p className="devotion-body">{entry.body}</p>
          </> : date && <p className="devotion-muted">이 날짜에 등록된 말씀이 없습니다.</p>}
        </section>
        <aside className="devotion-archive" aria-label="지난 말씀">
          <div><h2>지난 말씀</h2>{date && <button className="devotion-text-action" type="button" onClick={() => changeDate()}>최신 말씀</button>}</div>
          {!feed.archive.length ? <p className="devotion-muted">등록된 글이 없습니다.</p> :
            <ul>{feed.archive.map(item => <li key={item.date}><Link href={`/devotions?date=${item.date}`} aria-current={entry?.date === item.date ? "page" : undefined}>
              <time dateTime={item.date}>{devotionDayLabel(item.date)}</time>
              <span>{item.title || item.excerpt}</span>
            </Link></li>)}</ul>}
          {feed.next && <Button type="button" variant="outline" onClick={more} disabled={archiveBusy}>{archiveBusy ? "불러오는 중…" : "이전 글 더 보기"}</Button>}
        </aside>
      </div>}
    </div>
    {edit && dialogAccount === account && denied !== account && <RoomDialog title={edit.revision ? "말씀 수정" : "말씀 등록"} onClose={() => { if (!saving) setEdit(null); }}>
      <form onSubmit={event => { event.preventDefault(); void save("PUT", edit); }} aria-busy={saving}>
        <div className="room-dialog-body devotion-editor">
          <Field label="게시 날짜"><input className={inputClass} type="date" name="date" value={edit.date} max={feed?.today} min="1900-01-01"
            onChange={event => setEdit({ ...edit, date: event.target.value })} readOnly={edit.revision > 0} required disabled={saving} /></Field>
          <Field label="제목 (선택)"><input className={inputClass} value={edit.title} maxLength={devotionTitleLimit} disabled={saving} onChange={event => setEdit({ ...edit, title: event.target.value })} /></Field>
          <Field label="말씀 본문"><textarea className={inputClass} rows={8} value={edit.body} maxLength={devotionBodyLimit} required disabled={saving} onChange={event => setEdit({ ...edit, body: event.target.value })} /></Field>
          {saveError && <p className="auth-error-summary" role="alert">{saveError}</p>}
        </div>
        <footer className="room-dialog-footer"><Button type="button" variant="outline" disabled={saving} onClick={() => setEdit(null)}>취소</Button>
          <Button type="submit" variant="primary" disabled={saving || !edit.body.trim()}>{saving ? "게시 중…" : "게시"}</Button></footer>
      </form>
    </RoomDialog>}
    {removing && dialogAccount === account && denied !== account && <RoomDialog title="말씀 삭제" onClose={() => { if (!saving) setRemoving(null); }}>
      <div className="room-dialog-body"><p>{devotionDayLabel(removing.date)}에 게시한 말씀을 삭제할까요?</p>{saveError && <p className="auth-error-summary" role="alert">{saveError}</p>}</div>
      <footer className="room-dialog-footer"><Button type="button" variant="outline" autoFocus disabled={saving} onClick={() => setRemoving(null)}>취소</Button>
        <button className="lobby-danger" type="button" disabled={saving} onClick={() => void save("DELETE", removing)}>삭제</button></footer>
    </RoomDialog>}
  </main>;
}

function feedback(cause: unknown) {
  return cause instanceof Error ? cause.message : "말씀을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
