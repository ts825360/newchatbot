"use client";

import { BedDouble, LockKeyhole, Plus, Sparkles, Unlock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { calculateLodging, initialLodgingPlan, lodgingPreference, moveLodgingPerson, reconcileLodging, roomKindLabel, summarizeLodging, type LodgingChoice, type LodgingPlan } from "@/lib/lodging-plan";
import type { TransportPerson } from "@/lib/transport";
import { TransportText } from "./transport-input";

export function TransportLodging({ people, demo, saved, onChange, onPeople }: {
  people: TransportPerson[]; demo?: boolean; saved?: LodgingPlan; onChange: (plan: LodgingPlan) => void; onPeople: () => void;
}) {
  const plan = saved ? reconcileLodging(people, saved) : initialLodgingPlan(people);
  const [selected, setSelected] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [error, setError] = useState("");
  const destination = useRef<HTMLSelectElement>(null);
  const focusMove = useRef(false);
  useEffect(() => {
    if (!focusMove.current) return;
    focusMove.current = false;
    destination.current?.scrollIntoView?.({ block: "nearest" });
    destination.current?.focus();
  }, [selected]);
  const { active, assigned, pending, numbered } = summarizeLodging(people, plan);
  const byId = new Map(people.map(p => [p.id, p]));
  const roomByPerson = new Map(plan.rooms.flatMap(room => room.people.map(id => [id, room] as const)));
  const overrides = new Map(plan.overrides.map(x => [x.id, x]));
  const preference = (person: TransportPerson) => lodgingPreference(person, overrides.get(person.id));
  const roomLabel = (room: LodgingPlan["rooms"][number]) => room.number || `${roomKindLabel[room.kind]}${room.kind === "group" ? room.group === "men" ? " · 남자" : " · 여자" : ""} ${plan.rooms.indexOf(room) + 1}`;
  const update = (next: LodgingPlan) => { setError(""); onChange(next); };
  const configure = (person: TransportPerson, choice: string) => {
    if (roomByPerson.has(person.id)) { setError("이미 방에 있는 참가자는 방에서 뺀 뒤 숙소 유형을 변경해 주세요."); return; }
    const key = choice === "men" || choice === "women" ? "group" : choice;
    const next = plan.overrides.filter(x => x.id !== person.id);
    if (key === "personal" || key === "family" || key === "group") next.push({ id: person.id, kind: key, ...(choice === "men" || choice === "women" ? { group: choice } : {}) });
    update({ ...plan, overrides: next });
  };
  const move = (id: string, to: string | null) => {
    try { update(moveLodgingPerson(people, plan, id, to)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "방을 옮기지 못했습니다."); }
  };
  const selectedPerson = byId.get(selected);
  const pick = selectedPerson ? preference(selectedPerson) : undefined;
  const current = roomByPerson.get(selected);
  const fit = pick && !pick.issue && !current?.locked ? plan.rooms.filter(r => !r.locked && r.id !== current?.id && r.kind === pick.kind && r.group === pick.group) : [];
  return <section className="transport-config transport-lodging" aria-label="참가자 숙소">
    <header><BedDouble size={20} aria-hidden="true" /><div><h3>방 배정 명단</h3><p>{demo ? "가상 명단 · " : ""}배정 {assigned}명 · 미배정 {pending}명 · 호수 지정 {numbered}실</p></div>
      <button type="button" onClick={onPeople}>참가자 명단 열기</button>
    </header>
    {!people.length ? <p className="transport-footnote">방을 배정할 참가자가 없습니다.</p> : <>
      <div className="lodging-controls">
        <label>가족방 정원 선택<TransportText label="가족방 정원 선택" maxLength={70} value={plan.familySizes.join(", ")} placeholder="예: 2, 4, 6"
          onCommit={raw => {
            const sizes = [...new Set(raw.split(",").map(v => Number(v.trim())))].sort((a, b) => a - b);
            if (!sizes.length || sizes.length > 20 || sizes.some(n => !Number.isInteger(n) || n < 1 || n > 250)) { setError("가족방 정원은 쉼표로 나눈 1~250 사이 정수로 입력해 주세요."); return false; }
            update({ ...plan, familySizes: sizes });
          }} /></label>
        <label>단체방 한 실 정원<TransportText label="단체방 한 실 정원" maxLength={3} value={String(plan.groupSize)} onCommit={raw => {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1 || n > 250) { setError("단체방 정원은 1~250명 사이로 입력해 주세요."); return false; }
          update({ ...plan, groupSize: n });
        }} /></label>
        <button type="button" className="transport-primary" onClick={() => { setSelected(""); update(calculateLodging(people, plan)); }}><Sparkles size={15} />객실 수 계산 · 자동 배정</button>
      </div>
      {!!error && <p className="transport-alert" role="alert">{error}</p>}
      <ul className="lodging-tally" aria-label="객실 수 요약">{(["personal", "family", "group", "existing"] as const).map(kind => {
        const rooms = active.filter(r => r.kind === kind);
        if (kind === "existing" && !rooms.length) return null;
        const sizes = new Map<number, number>();
        for (const room of rooms) if (room.capacity !== null) sizes.set(room.capacity, (sizes.get(room.capacity) ?? 0) + 1);
        return <li key={kind}><strong>{roomKindLabel[kind]} {rooms.length}실</strong><small>{[...sizes].sort(([a], [b]) => a - b).map(([capacity, count]) => `${capacity}인실 ${count}개`).join(" · ") || (rooms.length ? "정원 미기록" : "배정 없음")}</small></li>;
      })}</ul>
      <details className="lodging-roster"><summary>숙소 유형 및 미배정 확인 · {pending}명 미배정</summary>
        <label className="lodging-filter"><input type="checkbox" checked={pendingOnly} onChange={event => setPendingOnly(event.target.checked)} />미배정만 보기</label>
        <div className="transport-table-scroll" role="region" tabIndex={0} aria-label="참가자 숙소 유형"><table className="transport-lodging-table">
          <thead><tr>{["이름", "가족 ID", "설문 희망", "운영진 지정", "배정 상태"].map(name => <th key={name} scope="col">{name}</th>)}</tr></thead>
          <tbody>{people.filter(person => !pendingOnly || !roomByPerson.has(person.id)).map(person => {
            const chosen = overrides.get(person.id);
            const room = roomByPerson.get(person.id);
            const pref = preference(person);
            return <tr key={person.id}><th scope="row">{person.name}</th><td>{person.familyId || "미기록"}</td><td>{person.lodging || "미응답"}</td>
              <td><select aria-label={`${person.name} 숙소 유형`} value={chosen?.group ?? chosen?.kind ?? ""} disabled={!!room} onChange={event => configure(person, event.target.value)}>
                <option value="">설문 기준</option><option value="personal">개인방</option><option value="family">가족방</option><option value="men">단체방 · 남자</option><option value="women">단체방 · 여자</option>
              </select></td><td>{room ? roomLabel(room) : pref.issue || "미배정 · 정원 및 기존 방 확인"}</td></tr>;
          })}</tbody>
        </table></div>
      </details>
      <div className="lodging-controls">
          <label>옮길 참가자<select value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">참가자 선택</option>{people.map(p => <option key={p.id} value={p.id}>{p.name} · {roomByPerson.has(p.id) ? roomLabel(roomByPerson.get(p.id)!) : "미배정"}</option>)}
          </select></label>
          <label>배정할 방<select ref={destination} disabled={!selected || (!fit.length && (!current || current.locked))} value="" onChange={event => move(selected, event.target.value === "__none" ? null : event.target.value)}>
            <option value="">방 선택</option>{current && !current.locked && <option value="__none">방에서 빼기</option>}{fit.map(r => <option key={r.id} value={r.id}>{roomLabel(r)} · {r.people.length}/{r.capacity ?? "미정"}</option>)}
          </select></label>
          {selected && pick && !pick.issue && !current?.locked && plan.rooms.length < 500 && <button type="button" onClick={() => {
            const id = crypto.randomUUID();
            const familySize = pick.kind === "family" ? people.filter(p => {
              const candidate = preference(p);
              return candidate.kind === "family" && !candidate.issue && candidate.group === pick.group;
            }).length : 1;
            const capacity = pick.kind === "personal" ? 1 : pick.kind === "group" ? plan.groupSize : [...plan.familySizes].sort((a, b) => a - b).find(n => n >= familySize) ?? familySize;
            const next = { ...plan, rooms: [...plan.rooms, { id, kind: pick.kind, group: pick.group, number: "", capacity, locked: false, people: [] }] };
            try { update(moveLodgingPerson(people, next, selected, id)); }
            catch (cause) { setError(cause instanceof Error ? cause.message : "방을 추가하지 못했습니다."); }
          }}><Plus size={15} />새 방에 배정</button>}
      </div>
      {!!plan.rooms.length &&
        <div className="transport-vehicle-grid lodging-grid">{plan.rooms.map(room => <article key={room.id} className="transport-vehicle" aria-label={roomLabel(room)}>
          <header><BedDouble size={16} aria-hidden="true" /><strong>{roomLabel(room)}</strong><span>{room.people.length}/{room.capacity ?? "?"}명</span></header>
          <div className="lodging-room-body">
            <label>방 번호<TransportText label={`${roomLabel(room)} 방 번호`} placeholder="호수 미정" value={room.number} maxLength={80}
              onCommit={number => {
                const normalized = number.normalize("NFC");
                if (normalized && plan.rooms.some(r => r.id !== room.id && r.number === normalized)) { setError("같은 방 번호가 이미 있습니다."); return false; }
                update({ ...plan, rooms: plan.rooms.map(r => r.id === room.id ? { ...r, number: normalized } : r) });
              }} /></label>
            {room.kind !== "personal" && <label>정원<TransportText label={`${roomLabel(room)} 정원`} placeholder="정원 미정" value={room.capacity === null ? "" : String(room.capacity)} maxLength={3}
              onCommit={raw => {
                const capacity = Number(raw);
                if (!Number.isInteger(capacity) || capacity < Math.max(1, room.people.length) || capacity > 250) { setError("현재 배정 인원 이상, 최대 250명까지 정원을 입력해 주세요."); return false; }
                update({ ...plan, rooms: plan.rooms.map(r => r.id === room.id ? { ...r, capacity } : r) });
              }} /></label>}
            <button type="button" aria-pressed={room.locked} onClick={() => update({ ...plan, rooms: plan.rooms.map(r => r.id === room.id ? { ...r, locked: !r.locked } : r) })}>{room.locked ? <LockKeyhole size={15} /> : <Unlock size={15} />}{room.locked ? "고정 해제" : "배정 고정"}</button>
            <ul>{room.people.map(id => <li key={id}><button type="button" disabled={room.locked} onClick={() => {
              if (selected === id) { destination.current?.scrollIntoView?.({ block: "nearest" }); destination.current?.focus(); }
              else { focusMove.current = true; setSelected(id); }
            }}>{byId.get(id)?.name}</button></li>)}</ul>
          </div>
        </article>)}</div>}
    </>}
  </section>;
}
