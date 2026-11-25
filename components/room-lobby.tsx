"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Church, CircleAlert, Flag, Gift, LayoutGrid, List, LockKeyhole, LogOut, MapPin, Moon, Pencil, Plus, Save, Search, SlidersHorizontal, Star, Sun, TentTree, Trash2, Trophy, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AUTH_CHANGED_EVENT, createBrowserAuth } from "@/lib/prototype-auth";
import { flushBackendWrites, isBackendConnected } from "@/lib/backend-client";
import { AccountMenu } from "./account-menu";
import { canManageRooms, createRoomCatalog, filterRooms, ROOM_CATEGORIES, validateRoomDraft, type LobbyRoom, type RoomCatalog, type RoomCategory, type RoomDraft, type RoomDraftErrors, type RoomSort } from "@/lib/room-catalog";
import { usePrototypeTheme } from "@/lib/use-theme";
import type { UserProfile } from "@/lib/types";
import { RoomDialog } from "./room-dialog";
import { PersonalCategoryBar } from "./personal-category-bar";
import { roomStage, roomStages, roomTiming, type RoomStage } from "@/lib/room-timing";
import { SaveStatus } from "./save-status";
import { SupportButton } from "./support-dialog";
import { DevotionLobbyPreview } from "./devotion-lobby-preview";
import { LobbyNavigation, LobbyOverview } from "./room-lobby-overview";
import { SettingsEntry } from "./settings-entry";

const categoryIcons = { retreat: TentTree, revival: Flag, sports: Trophy, worship: Church, celebration: Gift, other: UsersRound };
const emptyDraft: RoomDraft = { name: "", category: "retreat", otherDetail: "", date: "", endDate: "", location: "", description: "" };
const koreanLongDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });

export function RoomLobby() {
  const router = useRouter();
  const { darkMode, toggleTheme } = usePrototypeTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [catalog, setCatalog] = useState<RoomCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<RoomCategory | "all">("all");
  const [sort, setSort] = useState<RoomSort>("recent");
  const [listSettingsOpen, setListSettingsOpen] = useState(false);
  const [stage, setStage] = useState<RoomStage | "all">("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [today, setToday] = useState(() => new Date());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LobbyRoom | null>(null);
  const [draft, setDraft] = useState<RoomDraft>(emptyDraft);
  const [draftErrors, setDraftErrors] = useState<RoomDraftErrors>({});
  const [dialogError, setDialogError] = useState("");
  const [personalRoomIds, setPersonalRoomIds] = useState<string[] | null>(null);
  const [dateWarning, setDateWarning] = useState(false);
  const [filterReset, setFilterReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    const check = () => {
      setToday(new Date());
      try {
        const current = createBrowserAuth().currentProfile();
        if (!current) { setProfile(null); setCatalog(null); router.replace("/login"); return; }
        setProfile(current);
        const data = createRoomCatalog(sessionStorage, current).load();
        setCatalog(data);
        setSelectedId((previous) => data.rooms.some((room) => room.id === previous) ? previous : data.selectedRoomId);
      } catch (cause) { setError(errorMessage(cause)); }
    };
    check();
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    window.addEventListener(AUTH_CHANGED_EVENT, check);
    const timer = window.setInterval(check, 60_000);
    return () => { window.removeEventListener("focus", check); window.removeEventListener("storage", check); window.removeEventListener(AUTH_CHANGED_EVENT, check); window.clearInterval(timer); };
  }, [router]);

  const rooms = catalog?.rooms;
  const { timings, counts, ongoing, recent } = useMemo(() => {
    const timings = new Map<string, ReturnType<typeof roomTiming>>();
    const counts: Record<RoomStage, number> = { ongoing: 0, past: 0, undated: 0 };
    const ongoing: LobbyRoom[] = [];
    for (const room of rooms ?? []) {
      const timing = roomTiming(room, today);
      timings.set(room.id, timing);
      counts[roomStage(timing.key)]++;
      if (timing.key === "ongoing") ongoing.push(room);
    }
    return { timings, counts, ongoing, recent: filterRooms(rooms ?? [], "", "all", "recent").slice(0, 3) };
  }, [rooms, today]);
  const filtered = useMemo(() => {
    const matches = filterRooms(rooms ?? [], search, category, sort).filter(room =>
      (personalRoomIds === null || personalRoomIds.includes(room.id)) && (stage === "all" || roomStage(timings.get(room.id)!.key) === stage));
    const matchingPins = new Set(matches.filter(room => room.pinned).map(room => room.id));
    return [...(rooms ?? []).filter(room => matchingPins.has(room.id)), ...matches.filter(room => !room.pinned)];
  }, [rooms, search, category, sort, personalRoomIds, stage, timings]);
  const manageable = profile ? canManageRooms(profile) : false;
  const hasListSettings = category !== "all" || sort !== "recent" || personalRoomIds !== null;

  const enter = async (id: string) => {
    if (!profile || working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      setCatalog(createRoomCatalog(sessionStorage, profile).enter(id));
      setSelectedId(id);
      if (isBackendConnected()) await flushBackendWrites();
      router.push("/workspace");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { working.current = false; setBusy(false); }
  };
  const logout = async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (isBackendConnected()) await flushBackendWrites();
      const pending: unknown = createBrowserAuth().logout();
      if (pending) await pending;
      setProfile(null); setCatalog(null); router.replace("/login");
    }
    catch (cause) { setError(`로그아웃하지 못했습니다. ${errorMessage(cause)}`); }
    finally { working.current = false; setBusy(false); }
  };
  const togglePin = async (id: string) => {
    if (!profile || working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      setCatalog(createRoomCatalog(sessionStorage, profile).togglePin(id));
      if (isBackendConnected()) await flushBackendWrites();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { working.current = false; setBusy(false); }
  };
  const resetFilters = () => { setSearch(""); setCategory("all"); setStage("all"); setSort("recent"); setPersonalRoomIds(null); setFilterReset(value => value + 1); };
  const closeDialog = () => { setCreateOpen(false); setEditingId(null); setDeleteTarget(null); setDateWarning(false); setDialogError(""); };
  const editRoom = (room: LobbyRoom) => {
    setEditingId(room.id); setCreateOpen(true); setDialogError(""); setDraftErrors({});
    setDraft({ name: room.name, category: room.category, otherDetail: room.otherDetail, date: room.date ?? "", endDate: room.endDate ?? "", location: room.location, description: room.description });
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || working.current) return;
    const errors = validateRoomDraft(draft);
    setDraftErrors(errors);
    setDialogError("");
    if (errors.endDate) { setDialogError(errors.endDate); setDateWarning(true); return; }
    if (Object.keys(errors).length) { document.getElementById(`room-${Object.keys(errors)[0]}`)?.focus(); return; }
    working.current = true; setBusy(true); setNotice("");
    try {
      const store = createRoomCatalog(sessionStorage, profile);
      if (editingId) {
        setCatalog(store.update(editingId, draft));
        if (isBackendConnected()) await flushBackendWrites();
        setSelectedId(editingId); resetFilters(); closeDialog();
        setNotice(`‘${draft.name.trim()}’ 행사방 정보를 수정했습니다. 세부 일정은 유지됩니다.`);
        return;
      }
      const result = store.create(draft);
      setCatalog(result.catalog);
      setSelectedId(result.room.id);
      if (isBackendConnected()) await flushBackendWrites();
      resetFilters();
      closeDialog();
      setNotice(`‘${result.room.name}’ 행사방을 만들었습니다.`);
    } catch (cause) { setDialogError(errorMessage(cause)); }
    finally { working.current = false; setBusy(false); }
  };
  const deleteRoom = async () => {
    if (!profile || !deleteTarget || working.current) return;
    working.current = true; setBusy(true); setNotice(""); setDialogError("");
    try {
      setCatalog(createRoomCatalog(sessionStorage, profile).delete(deleteTarget.id));
      if (isBackendConnected()) await flushBackendWrites();
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setNotice(`‘${deleteTarget.name}’ 행사방을 삭제했습니다.`);
      closeDialog();
    } catch (cause) { setDialogError(errorMessage(cause)); }
    finally { working.current = false; setBusy(false); }
  };
  const updateDraft = (key: keyof RoomDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDraftErrors((current) => ({ ...current, [key]: undefined }));
    setDialogError("");
  };

  if (!profile) return <main className="lobby-loading" role={error ? "alert" : "status"}>{error || "접속 확인 중..."}{error && <Link href="/login">로그인 화면으로</Link>}</main>;

  return (
    <main className="lobby-page lobby-reference" id="lobby-home">
      <LobbyNavigation recent={recent} busy={busy} onEnter={enter} />
      <header className="lobby-header">
        <div className="lobby-account"><SaveStatus /><SupportButton screenName="행사방 목록" /><span className="lobby-mobile-settings"><SettingsEntry placement="toolbar" href="/settings" /></span><button className="lobby-icon-button" type="button" onClick={toggleTheme} aria-label={darkMode ? "라이트 모드" : "다크 모드"} title={darkMode ? "라이트 모드" : "다크 모드"}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button><span className="lobby-avatar" aria-hidden="true">{Array.from(profile.nickname.trim())[0] || "관"}</span><AccountMenu profile={profile} /><button className="lobby-logout lobby-icon-button" type="button" onClick={logout} disabled={busy} aria-label="로그아웃" title="로그아웃"><LogOut size={18} aria-hidden="true" /></button></div>
      </header>
      <div className="lobby-content">
        <header className="lobby-titlebar"><div><p className="lobby-local-date">{koreanLongDate.format(today)}</p><h1>안녕하세요, {profile.nickname}님</h1><p>참여 중인 행사방 <strong>{rooms?.length ?? 0}</strong>개</p></div></header>
        <div className="lobby-quick-actions"><span title={!manageable ? "제1·2관리자만 행사방을 만들 수 있습니다." : undefined}><button className="lobby-primary" type="button" disabled={!manageable || !catalog} onClick={() => { setDraft(emptyDraft); setDraftErrors({}); setDialogError(""); setCreateOpen(true); }}><Plus size={19} aria-hidden="true" />새 행사방</button></span><a className="lobby-secondary" href="#lobby-today"><CalendarDays size={17} aria-hidden="true" />오늘의 행사</a></div>

        {error && <div className="lobby-error" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span><button type="button" className="lobby-icon-button" onClick={() => setError("")} title="알림 닫기" aria-label="오류 알림 닫기"><X size={16} /></button></div>}
        {notice && <p className="lobby-notice" role="status">{notice}</p>}
        <div className="lobby-toolbar">
          <div className="lobby-stage-tabs" role="group" aria-label="진행 상태">
            <button type="button" aria-pressed={stage === "all"} onClick={() => setStage("all")}>전체<span aria-hidden="true">{rooms?.length ?? 0}</span></button>
            {roomStages.map(({ id, label }) => <button key={id} type="button" aria-pressed={stage === id} onClick={() => setStage(id)}>{label}<span aria-hidden="true">{counts[id]}</span></button>)}
          </div>
          <div className="lobby-list-controls"><div className="lobby-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="행사방 검색" placeholder="행사방 이름, 담당자 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="lobby-layout-picker" role="group" aria-label="목록 레이아웃"><button type="button" aria-label="카드 보기" title="카드 보기" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><LayoutGrid size={19} aria-hidden="true" /></button><button type="button" aria-label="목록 보기" title="목록 보기" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={20} aria-hidden="true" /></button></div>
            <button type="button" className="lobby-list-settings" aria-label="목록 설정" aria-haspopup="dialog" aria-expanded={listSettingsOpen} aria-description={hasListSettings ? "세부 설정이 적용되어 있습니다." : undefined} data-applied={hasListSettings} title={hasListSettings ? "목록 설정 적용 중" : "목록 설정"} onClick={() => setListSettingsOpen(true)}><SlidersHorizontal size={18} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="lobby-results"><span role="status">{filtered.length}개의 행사방</span><span><LockKeyhole size={12} aria-hidden="true" />초대 전용</span></div>

        <section id="rooms-panel" aria-label="행사방 목록" tabIndex={-1}>
          {filtered.length ? <div className="room-grid" data-layout={layout}>{filtered.map((room) => {
            const Icon = categoryIcons[room.category];
            const selected = selectedId === room.id;
            const timing = timings.get(room.id)!;
            const roomStatus = roomStages.find(entry => entry.id === roomStage(timing.key))!;
            const pinLabel = room.pinned ? "즐겨찾기 해제" : "즐겨찾기 추가";
            return <article key={room.id} className={`room-card ${selected ? "is-selected" : ""}`} data-category={room.category}>
              <button className="room-select" type="button" aria-label={`${room.name} 선택`} aria-description={[timing.key === "undated" ? "" : room.dateLabel, roomStatus.label, `담당 ${room.owner}`].filter(Boolean).join(" · ")} aria-pressed={selected} onClick={() => setSelectedId(room.id)} onDoubleClick={() => enter(room.id)}>
                <span className="room-cover"><Icon className="room-cover-icon" size={42} strokeWidth={1.25} aria-hidden="true" /><span className={`room-status timing-${roomStatus.id}`} title={timing.reason}><span aria-hidden="true" />{roomStatus.label}</span></span>
                <span className="room-card-info">
                  <span className="room-category-name">{room.category === "other" && room.otherDetail ? room.otherDetail : ROOM_CATEGORIES[room.category]}</span>
                  <span className="room-name">{room.name}</span>
                  <span className="room-info-line"><CalendarDays size={16} aria-hidden="true" /><span>{room.dateLabel}</span></span>
                  <span className="room-info-line"><MapPin size={16} aria-hidden="true" /><span>{room.location || "장소 미정"}</span></span>
                  <span className="room-info-line"><UserRound size={16} aria-hidden="true" /><span>담당 {room.owner}</span></span>
                </span>
              </button>
              <footer className="room-card-footer"><span className="room-member-count" title="참여 인원"><UsersRound size={16} aria-hidden="true" />{room.memberCount}명</span><div><button type="button" className="lobby-icon-button room-pin" title={pinLabel} aria-label={`${room.name} ${pinLabel}`} aria-pressed={room.pinned} disabled={busy} onClick={() => togglePin(room.id)}><Star size={16} fill={room.pinned ? "currentColor" : "none"} aria-hidden="true" /></button>{manageable && <><button type="button" className="lobby-icon-button" title="행사방 수정" aria-label={`${room.name} 수정`} onClick={() => editRoom(room)}><Pencil size={16} aria-hidden="true" /></button><button type="button" className="room-delete" title="행사방 삭제" aria-label={`${room.name} 삭제`} onClick={() => { setDialogError(""); setDeleteTarget(room); }}><Trash2 size={16} aria-hidden="true" /></button></>}<button type="button" className="room-enter" title="입장" aria-label={`${room.name} 입장`} disabled={busy} onClick={() => enter(room.id)}><ArrowRight size={19} aria-hidden="true" /></button></div></footer>
            </article>;
          })}</div> : <div className="lobby-empty"><LayoutGrid size={30} strokeWidth={1.5} aria-hidden="true" /><h2>{rooms?.length ? "조건에 맞는 행사방이 없습니다" : "참여 중인 행사방이 없습니다"}</h2>{rooms?.length ? <button type="button" className="lobby-secondary" onClick={resetFilters}>필터 초기화</button> : manageable ? <button type="button" className="lobby-primary" onClick={() => { setDraft(emptyDraft); setDraftErrors({}); setDialogError(""); setCreateOpen(true); }}><Plus size={16} aria-hidden="true" />첫 행사방 만들기</button> : <p>관리자에게 행사방 초대를 요청해 주세요.</p>}</div>}
        </section>
        {!isBackendConnected() && <footer className="lobby-footnote">프로토타입 · 참여 인원은 샘플 데이터이며, 변경사항은 현재 탭에만 저장됩니다.</footer>}
      </div>
      <aside className="lobby-overview" aria-label="행사 요약">
        <LobbyOverview stages={counts} total={rooms?.length ?? 0} today={ongoing} busy={busy} onEnter={enter} />
        {profile.accountId && isBackendConnected() && <DevotionLobbyPreview accountId={profile.accountId} />}
      </aside>

      <RoomDialog title="목록 설정" onClose={() => setListSettingsOpen(false)} open={listSettingsOpen}>
        <div className="room-dialog-body lobby-list-settings-body">
          <div className="room-form-row">
            <div className="auth-field"><label htmlFor="room-list-category">행사 종류 필터</label><select className="auth-input" id="room-list-category" value={category} onChange={event => setCategory(event.target.value as RoomCategory | "all")}><option value="all">모든 행사 종류</option>{Object.entries(ROOM_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
            <div className="auth-field"><label htmlFor="room-list-sort">정렬</label><select className="auth-input" id="room-list-sort" value={sort} onChange={event => setSort(event.target.value as RoomSort)}><option value="recent">최신순</option><option value="oldest">오래된순</option></select></div>
          </div>
          <PersonalCategoryBar key={`${profile.accountId ?? profile.nickname}:${filterReset}`} accountId={profile.accountId ?? profile.nickname} rooms={rooms ?? []} onFilter={setPersonalRoomIds} />
        </div>
        <footer className="room-dialog-footer">
          <button type="button" className="lobby-secondary" disabled={!hasListSettings} onClick={() => { setCategory("all"); setSort("recent"); setPersonalRoomIds(null); setFilterReset(value => value + 1); }}>설정 초기화</button>
          <button type="button" className="lobby-primary" onClick={() => setListSettingsOpen(false)}>완료</button>
        </footer>
      </RoomDialog>

      {createOpen && !dateWarning && <RoomDialog title={editingId ? "행사방 정보 수정" : "새 행사방"} onClose={() => { if (!working.current) closeDialog(); }}><form onSubmit={create} noValidate aria-busy={busy}>
        <div className="room-dialog-body">
          <RoomField field="name" label="행사방 이름" error={draftErrors.name}><input id="room-name" className="auth-input" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="예: 2027 여름 수련회" maxLength={60} aria-invalid={!!draftErrors.name} aria-describedby={draftErrors.name ? "room-error-name" : undefined} autoFocus /></RoomField>
          <RoomField field="category" label="행사 종류" error={draftErrors.category}><select id="room-category" className="auth-input" value={draft.category} onChange={(event) => updateDraft("category", event.target.value)}>{Object.entries(ROOM_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></RoomField>
          {draft.category === "other" && <RoomField field="otherDetail" label="기타 행사 설명" error={draftErrors.otherDetail}><input id="room-otherDetail" className="auth-input" value={draft.otherDetail ?? ""} onChange={event => updateDraft("otherDetail", event.target.value)} placeholder="예: 성가대 연습, 새가족 환영회" maxLength={40} /></RoomField>}
          <div className="room-form-row"><RoomField field="date" label="시작일" optional error={draftErrors.date}><input id="room-date" className="auth-input" type="date" aria-label="시작일" value={draft.date} onChange={(event) => updateDraft("date", event.target.value)} aria-invalid={!!draftErrors.date} aria-describedby={draftErrors.date ? "room-error-date" : undefined} /></RoomField><RoomField field="endDate" label="종료일" optional><input id="room-endDate" className="auth-input" type="date" aria-label="종료일" value={draft.endDate ?? ""} onChange={event => updateDraft("endDate", event.target.value)} aria-invalid={!!draftErrors.endDate} /></RoomField></div>
          <RoomField field="description" label="메모" optional error={draftErrors.description}><textarea id="room-description" className="auth-input room-memo" value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} maxLength={300} rows={3} /></RoomField>
          {dialogError && <p className="auth-error-summary" role="alert">{dialogError}</p>}
          {editingId && <p className="text-xs text-muted-foreground">행사 기간을 바꿔도 개별 세부 일정의 날짜는 유지됩니다.</p>}
        </div><footer className="room-dialog-footer"><button type="button" className="lobby-secondary" onClick={closeDialog} disabled={busy}>취소</button><button type="submit" className="lobby-primary" disabled={busy}>{editingId ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{editingId ? "저장" : "만들기"}</button></footer>
      </form></RoomDialog>}
      {dateWarning && <RoomDialog title="행사 기간 확인" onClose={() => setDateWarning(false)}><div className="room-dialog-body"><p role="alert" className="room-delete-copy">{dialogError}</p></div><footer className="room-dialog-footer"><button type="button" className="lobby-primary" autoFocus onClick={() => setDateWarning(false)}>날짜 수정</button></footer></RoomDialog>}
      {deleteTarget && <RoomDialog title="행사방 삭제" onClose={() => { if (!working.current) closeDialog(); }}><div className="room-dialog-body"><p className="room-delete-name">{deleteTarget.name}</p><p className="room-delete-copy">이 행사방을 삭제하시겠습니까? 삭제한 방은 목록에서 사라지며 되돌릴 수 없습니다.</p>{dialogError && <p className="auth-error-summary" role="alert">{dialogError}</p>}</div><footer className="room-dialog-footer"><button type="button" className="lobby-secondary" onClick={closeDialog} disabled={busy} autoFocus>취소</button><button type="button" className="lobby-danger" onClick={deleteRoom} disabled={busy}><Trash2 size={16} aria-hidden="true" />삭제하기</button></footer></RoomDialog>}
    </main>
  );
}

function RoomField({ field, label, optional, error, children }: { field: string; label: string; optional?: boolean; error?: string; children: React.ReactNode }) {
  return <div className="auth-field"><label htmlFor={`room-${field}`}>{label}{optional && <small className="room-optional" aria-hidden="true">선택</small>}</label>{children}{error && <p className="auth-field-error" id={`room-error-${field}`}>{error}</p>}</div>;
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요."; }
