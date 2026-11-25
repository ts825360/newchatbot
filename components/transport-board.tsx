"use client";

import { ArrowRightLeft, BusFront, GripVertical, LockKeyhole, Search, Unlock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { companionFor, entryFor, transportVehicleSeatError, tripFor, type Direction, type TransportAssignment, type TransportInput, type TransportResult } from "@/lib/transport";

export function TransportBoard({ input, result, stale, direction, onDirection, onMove, onLock }: { input: TransportInput; result: TransportResult | null; stale: boolean; direction: Direction; onDirection: (d: Direction) => void; onMove: (a: TransportAssignment) => void; onLock: (a: TransportAssignment) => void }) {
  const [selectedTrip, setSelectedTrip] = useState(""); const [editing, setEditing] = useState(""); const [target, setTarget] = useState("");
  const [search, setSearch] = useState(""); const [jump, setJump] = useState<{ personId: string; tripId: string; vehicleId: string | null }>();
  const [dragging, setDragging] = useState(""); const [over, setOver] = useState<string | null>();
  const board = useRef<HTMLDivElement>(null);
  const destination = useRef<HTMLSelectElement>(null);
  const trips = input.trips.filter((t) => t.direction === direction);
  const tripId = trips.some((t) => t.id === selectedTrip) ? selectedTrip : direction === "outbound" ? input.extraOutboundTripId : input.extraReturnTripId;
  const passengers = input.people.filter((p) => tripFor(p, direction) === tripId);
  const assignments = result?.assignments.filter((a) => a.tripId === tripId) ?? [];
  const vehicles = input.vehicles.filter(v => v.enabled && v.tripIds.includes(tripId) && !transportVehicleSeatError(v));
  const nextVehicle = vehicles.some(v => v.id === target) ? target : target === "__unassigned" ? null : undefined;
  const available = result && ["optimal", "feasible", "manual"].includes(result.status) && !stale;
  const searchTerm = search.trim().normalize("NFC").toLowerCase();
  const matches = searchTerm ? input.people.filter(p => `${p.name} ${p.department}`.normalize("NFC").toLowerCase().includes(searchTerm)) : [];
  useEffect(() => {
    if (!jump || jump.tripId !== tripId) return;
    const rider = [...(board.current?.querySelectorAll<HTMLElement>("[data-person-id]") ?? [])].find(node => node.dataset.personId === jump.personId);
    if (rider) { rider.scrollIntoView?.({ block: "nearest", inline: "nearest" }); rider.focus({ preventScroll: true }); }
  }, [jump, tripId]);
  useEffect(() => { if (editing) destination.current?.focus(); }, [editing]);
  const locked = (id: string) => input.locks.some((a) => a.personId === id && a.tripId === tripId);
  const canMove = (id: string, vehicleId: string | null) => !!available && !locked(id)
    && passengers.some(p => p.id === id) && assignments.some(a => a.personId === id && a.vehicleId !== vehicleId);
  const move = (id: string, vehicleId: string | null) => { if (canMove(id, vehicleId)) onMove({ personId: id, tripId, vehicleId }); };
  const rows = (vehicleId: string | null) => assignments.filter((a) => a.vehicleId === vehicleId);
  const peopleList = (vehicleId: string | null) => <ul className="transport-riders">{rows(vehicleId).map((a) => {
    const p = input.people.find((p) => p.id === a.personId);
    if (!p) return null;
    const draggable = Boolean(available && !locked(p.id));
    return <li key={p.id} data-person-id={p.id} data-highlight={jump?.personId === p.id && jump.tripId === tripId} tabIndex={-1} draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) { e.preventDefault(); return; }
        e.dataTransfer.setData("application/x-church-person", p.id); e.dataTransfer.effectAllowed = "move"; setDragging(p.id); setEditing("");
      }} onDragEnd={() => { setDragging(""); setOver(undefined); }}>
      <GripVertical size={13} className="transport-grip" /><div><span>{p.name}</span><small>{p.department}{companionFor(p, direction) ? ` · 동반 ${companionFor(p, direction)}` : ""}</small></div>
      <button type="button" disabled={!available} aria-label={`${p.id} ${locked(p.id) ? "잠금 해제" : "배정 잠금"}`} title={locked(p.id) ? "잠금 해제" : "배정 잠금"} onClick={() => onLock(a)}>{locked(p.id) ? <LockKeyhole size={13} /> : <Unlock size={13} />}</button>
      <button type="button" disabled={!available || locked(p.id)} title="차량 변경" aria-label={`${p.name} 차량 변경`} onClick={() => {
        setEditing(editing === p.id ? "" : p.id); setTarget("");
      }}><ArrowRightLeft size={13} /></button>
      {editing === p.id && <div className="transport-rider-move"><label>옮길 차량<select ref={destination} aria-label="옮길 차량" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">차량 선택</option>{vehicleId !== null && <option value="__unassigned">미배정으로 이동</option>}{vehicles.filter(v => v.id !== vehicleId).map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
      </select></label><button type="button" disabled={nextVehicle === undefined || !canMove(p.id, nextVehicle)} onClick={() => { if (nextVehicle !== undefined) move(p.id, nextVehicle); }}>변경 검토</button></div>}
    </li>;
  })}</ul>;
  const drop = (vehicleId: string | null) => ({
    "data-drop": dragging && canMove(dragging, vehicleId) ? over === vehicleId ? "active" : "available" : undefined,
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || !canMove(dragging, vehicleId)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(vehicleId);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setOver(previous => previous === vehicleId ? undefined : previous);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("application/x-church-person");
      if (id && id === dragging) move(id, vehicleId);
      setDragging(""); setOver(undefined);
    },
  });
  const selectTrip = (id: string) => { setSelectedTrip(id); setEditing(""); setTarget(""); setJump(undefined); };
  return <div ref={board} className="transport-board"><div className="transport-board-toolbar"><div className="transport-segment" role="group" aria-label="이동 구간"><button type="button" aria-pressed={direction === "outbound"} onClick={() => { onDirection("outbound"); selectTrip(""); }}>출발</button><button type="button" aria-pressed={direction === "return"} onClick={() => { onDirection("return"); selectTrip(""); }}>귀가</button></div>
    <label className="transport-board-trip">{direction === "outbound" ? "출발 팀" : "귀가편"}<select aria-label={direction === "outbound" ? "배치 출발 팀" : "배치 귀가편"} value={tripId} onChange={(e) => selectTrip(e.target.value)}>{trips.map((t) => <option key={t.id} value={t.id}>{t.label} · {input.people.filter(p => tripFor(p, direction) === t.id).length}명</option>)}</select></label>
    <span>{input.vehicles.length}대 등록 · 개별 이동 {input.people.filter((p) => tripFor(p, direction) === null && !entryFor(p, direction)).length}명</span></div>
    <div className="transport-rider-search"><label className="transport-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="차량 배정 이름 검색" placeholder="이름으로 차량 찾기" value={search} onChange={e => { setSearch(e.target.value); setJump(undefined); }} /></label>
      {searchTerm && <div className="transport-search-results"><p role="status">{matches.length ? `검색 결과 ${matches.length}명 · ${direction === "outbound" ? "출발" : "귀가"}` : "이름과 일치하는 참가자가 없습니다."}</p>
        <ul>{matches.map(p => {
          const team = tripFor(p, direction);
          const entry = entryFor(p, direction);
          const assignment = !stale && team ? result?.assignments.find(a => a.personId === p.id && a.tripId === team) : undefined;
          const teamName = trips.find(t => t.id === team)?.label;
          const vehicle = input.vehicles.find(v => v.id === assignment?.vehicleId);
          const title = `${p.name}${p.department ? ` · ${p.department}` : ""}`;
          const detail = entry ? "이동편 확인 필요" : !team ? "개별 이동" : `${teamName ?? "이동편"} · ${assignment ? vehicle?.label ?? "미배정" : stale ? "재계산 필요" : "배정 계산 전"}`;
          return <li key={p.id}>{assignment ? <button type="button" onClick={() => { selectTrip(assignment.tripId); setJump(assignment); }}>
            <strong>{title}</strong><span>{detail}</span></button> : <div><strong>{title}</strong><span>{detail}</span></div>}</li>;
        })}</ul>
      </div>}
    </div>
    {!result && <p className="transport-footnote">배정 결과 없음 · 계산 후 차량별 탑승자가 표시됩니다.</p>}
    <div className="transport-vehicle-grid">
      {result && <article className="transport-vehicle is-unassigned" data-vehicle-id="unassigned" {...drop(null)}><header><strong>미배정</strong><span>{rows(null).length}명</span></header>{peopleList(null)}{rows(null).length === 0 && <p>미배정 인원 없음</p>}</article>}
      {input.vehicles.map((v) => {
        const count = rows(v.id).length; const reserved = result?.reservations.find((r) => r.tripId === tripId && r.vehicleId === v.id)?.count ?? 0;
        const eligible = vehicles.some(vehicle => vehicle.id === v.id);
        const assignedTrips = trips.filter(t => v.tripIds.includes(t.id));
        return <article key={v.id} data-vehicle-id={v.id} className={`transport-vehicle ${count + reserved > v.capacity ? "is-overfull" : ""}`} {...(eligible ? drop(v.id) : {})}><header><BusFront size={16} /><strong>{v.label}</strong><span>{v.rental ? "대여" : "등록 차량"}</span></header>
          <div className="transport-vehicle-trips">{assignedTrips.length ? assignedTrips.map(trip => <button key={trip.id} type="button" aria-pressed={trip.id === tripId} onClick={() => selectTrip(trip.id)}>{trip.label}</button>) : <span>{direction === "outbound" ? "출발 팀 미지정" : "귀가편 미지정"}</span>}</div>
          {eligible && result ? <>
          <div className="transport-capacity"><meter min={0} max={v.capacity} value={Math.min(v.capacity, count + reserved)} /><span>실제 {count} · 가상 {reserved} · 여유 {Math.max(0, v.capacity - count - reserved)}</span></div>
          {count > 0 && peopleList(v.id)}</> : <p>{!v.enabled ? "미사용 차량" : transportVehicleSeatError(v) ? "좌석 설정 확인 필요" : eligible ? "배정 계산 전" : "선택한 이동편에는 운행하지 않음"}</p>}
          <footer>{v.driverId ? `운전자 ${input.people.find((p) => p.id === v.driverId)?.name ?? v.driverId}` : v.externalDriverConfirmed ? v.driverName ? `외부 운전자 ${v.driverName}` : "외부 운전자 확인됨" : "운전자 미확정"}</footer></article>;
      })}</div>
  </div>;
}
