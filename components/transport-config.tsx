"use client";

import { ChevronDown, Clock, Download, Plus, Search, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { companionFor, createTransportVehicle, defaultTransportVehicleName, driverOption, entryFor, hasRentalQuote, isTransportGender, surveyTripPending, transportGenderLabels, transportUnnamedParticipant, transportVehiclePresets, transportVehicleSeatError, tripFor, type TransportInput, type TransportPerson, type TransportTrip, type TransportVehicle, type TransportVehicleType } from "@/lib/transport";
import { TransportText } from "./transport-input";
import { RoomDialog } from "./room-dialog";
import { Button, Field } from "./ui";
import { applyTransportOffer, reviewTransportOffers, type TransportMovement } from "@/lib/transport-movement";

type ConfigProps = { input: TransportInput; onChange: (input: TransportInput) => void };
type VehicleSelection = { selectedVehicleIds: readonly string[]; onVehicleSelect: (id: string, selected: boolean) => void; onVehicleDelete: () => void };

export function TransportConfig(props: ConfigProps & VehicleSelection & { tab: "teams" | "vehicles" | "people"; onRosterExport: () => void; newParticipantId?: string }) {
  if (props.tab === "teams") return <TransportTeams {...props} />;
  if (props.tab === "vehicles") return <TransportVehicles {...props} />;
  return <TransportPeople {...props} />;
}

function TransportTeams({ input, onChange }: ConfigProps) {
  const [expanded, setExpanded] = useState<string | null>(input.trips.find(trip => trip.id === "main")?.id ?? input.trips[0]?.id ?? null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const change = (id: string, patch: Partial<TransportTrip>) => onChange({ ...input, trips: input.trips.map((trip) => trip.id === id ? { ...trip, ...patch } : trip) });
  const time = (minutes: number) => `${String(Math.floor(minutes % 1440 / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const inUse = (trip: TransportTrip) => input.people.some(person => tripFor(person, trip.direction) === trip.id)
    || input.vehicles.some(vehicle => vehicle.tripIds.includes(trip.id)) || input.locks.some(lock => lock.tripId === trip.id)
    || input.extraCount > 0 && [input.extraOutboundTripId, input.extraReturnTripId].includes(trip.id);
  const cannotRemove = (trip: TransportTrip) => input.trips.filter(item => item.direction === trip.direction).length <= 1
    ? "출발 팀과 귀가편을 각각 한 개 이상 남겨야 합니다." : inUse(trip) ? "이 팀을 사용 중인 참가자·차량 또는 가상 인원 설정을 먼저 바꿔 주세요." : "";
  const pending = input.trips.find(trip => trip.id === deleting);
  return <div className="transport-config transport-teams">
    {(["outbound", "return"] as const).map((direction) => <section key={direction} className="transport-trip-section">
      <header><h3>{direction === "outbound" ? "출발 팀 구성" : "귀가편 설정"}</h3>
        <button type="button" disabled={input.trips.length >= 8} onClick={() => {
          const count = input.trips.filter((trip) => trip.direction === direction).length;
          const start = direction === "outbound" ? 840 : 1980;
          const id = `trip-${crypto.randomUUID()}`;
          onChange({ ...input, trips: [...input.trips, { id, label: direction === "outbound" ? `기타 ${count + 1}` : `추가 귀가 ${count + 1}`, direction, start, end: start + 120, startUnknown: true, endUnknown: true }] });
          setExpanded(id);
        }}><Plus size={15} />{direction === "outbound" ? "출발 팀 추가" : "귀가편 추가"}</button>
      </header>
      <div>{input.trips.filter((trip) => trip.direction === direction).map((trip) => {
          const open = expanded === trip.id;
          const reason = cannotRemove(trip);
          return <div className="transport-trip-entry" key={trip.id}>
            <div className="transport-trip-row">
              <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : trip.id)}><ChevronDown size={15} className={open ? "rotate-180" : ""} aria-hidden="true" />{trip.label}</button>
              <small>{input.people.filter(person => tripFor(person, direction) === trip.id).length}명 · {trip.startUnknown ? "시각 미정" : time(trip.start)}</small>
              <button type="button" aria-label={`${trip.label} 삭제`} title={reason || "이동편 삭제"} disabled={!!reason} onClick={() => setDeleting(trip.id)}><Trash2 size={15} /></button>
            </div>
          {open && <div className="transport-trip-fields">
          <Field label={direction === "outbound" ? "팀 이름" : "귀가편 이름"}><TransportText label={`${trip.label} 이름`} value={trip.label} maxLength={80} onCommit={(label) => {
            if (!label) return false;
            change(trip.id, { label });
          }} /></Field>
          {([["purpose", "이동 목적"], ["origin", "출발 장소"], ["destination", "도착 장소"], ["pickup", "경유·픽업 장소"]] as const).map(([key, label]) =>
            <Field key={key} label={label}><TransportText label={`${trip.label} ${label}`} value={trip[key] ?? ""} maxLength={160} placeholder="미정" onCommit={value => change(trip.id, { [key]: value || undefined })} /></Field>)}
          <label className="transport-check"><input type="checkbox" checked={Boolean(trip.mandatoryTime)} onChange={event => change(trip.id, { mandatoryTime: event.target.checked })} />필수 운행 시각</label>
          {(["start", "end"] as const).map((edge) => <Fragment key={edge}>
            <Field label={edge === "start" ? "출발 일차" : "도착 일차"}><input aria-label={`${trip.label} ${edge === "start" ? "출발" : "도착"} 일차`} type="number" min={1} max={7} placeholder="미정" value={trip[`${edge}Unknown`] ? "" : Math.floor(trip[edge] / 1440) + 1}
              onChange={(e) => { const day = e.target.valueAsNumber; if (day >= 1 && day <= 7) change(trip.id, { [edge]: (day - 1) * 1440 + trip[edge] % 1440 }); }} /></Field>
            <div className="transport-clock-field"><span>{edge === "start" ? "출발 시각" : "도착 시각"}</span><TransportClock label={`${trip.label} ${edge === "start" ? "출발" : "도착"} 시각`} value={trip[edge]} formatted={trip[`${edge}Unknown`] ? "미정" : time(trip[edge])}
              onSelect={(minutes) => change(trip.id, { [edge]: Math.floor(trip[edge] / 1440) * 1440 + minutes, [`${edge}Unknown`]: false })} /></div>
            {!trip[`${edge}Unknown`] && <button type="button" onClick={() => change(trip.id, { [`${edge}Unknown`]: true })}>{edge === "start" ? "출발" : "도착"} 시각 미정으로</button>}
          </Fragment>)}
        </div>}</div>})}</div>
    </section>)}
    {pending && <RoomDialog title="이동편 삭제" onClose={() => setDeleting(null)}>
      <div className="room-dialog-body">{pending.label} 이동편을 삭제할까요?</div>
      <div className="room-dialog-footer"><Button type="button" variant="outline" onClick={() => setDeleting(null)}>취소</Button><Button type="button" variant="danger" disabled={!!cannotRemove(pending)} onClick={() => {
        const trips = input.trips.filter(trip => trip.id !== pending.id);
        const fallback = trips.find(trip => trip.direction === pending.direction);
        if (!fallback || cannotRemove(pending)) return;
        onChange({ ...input, trips,
          extraOutboundTripId: input.extraOutboundTripId === pending.id ? fallback.id : input.extraOutboundTripId,
          extraReturnTripId: input.extraReturnTripId === pending.id ? fallback.id : input.extraReturnTripId,
          previousAssignments: input.previousAssignments.filter(item => item.tripId !== pending.id),
        });
        if (expanded === pending.id) setExpanded(fallback.id);
        setDeleting(null);
      }}>삭제하기</Button></div>
    </RoomDialog>}
  </div>;
}

function TransportClock({ label, value, formatted, onSelect }: { label: string; value: number; formatted: string; onSelect: (minutes: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { dialog.current?.close(); setOpen(false); setHour(null); button.current?.focus(); };
  useLayoutEffect(() => { if (open) choices.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus(); }, [open, hour]);
  return <div className="transport-clock">
    <button type="button" ref={button} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => { dialog.current?.showModal(); setOpen(true); }}><Clock size={16} />{formatted}</button>
    <dialog ref={dialog} id={id} className="room-dialog transport-clock-dialog" aria-labelledby={`${id}-title`} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      {open && <div className="room-dialog-inner"><header className="room-dialog-header"><h2 id={`${id}-title`}>{label}</h2><button type="button" aria-label="시간 선택 닫기" title="닫기" onClick={close}><X size={17} /></button></header>
      <div className="transport-clock-options"><header>{hour === null ? <strong>시 선택</strong> : <button type="button" onClick={() => setHour(null)}>{hour}시 변경</button>}{hour !== null && <strong>분 선택</strong>}</header>
      <div ref={choices} className="transport-clock-grid" role="group" aria-label={hour === null ? "시 선택" : "분 선택"}>
        {Array.from({ length: hour === null ? 24 : 60 }, (_, n) => <button key={n} type="button" aria-label={`${n}${hour === null ? "시" : "분"}`}
          aria-pressed={n === (hour === null ? Math.floor(value % 1440 / 60) : value % 60)} onClick={() => {
            if (hour === null) setHour(n);
            else { close(); onSelect(hour * 60 + n); }
          }}>{String(n).padStart(2, "0")}</button>)}
      </div>
      </div></div>}
    </dialog>
  </div>;
}

const vehicleTypes = Object.keys(transportVehiclePresets) as TransportVehicleType[];

function TransportVehicles({ input, onChange, selectedVehicleIds, onVehicleSelect, onVehicleDelete }: ConfigProps & VehicleSelection) {
  const driverList = useId();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const offers = reviewTransportOffers(input);
  const offer = offers.find(item => item.providerId === reviewing);
  const change = (id: string, patch: Partial<TransportVehicle>) => onChange({ ...input, vehicles: input.vehicles.map((v) => v.id === id ? { ...v, ...patch } : v) });
  return <div className="transport-config"><header><h3>차량과 운전자</h3>
    <button type="button" className="transport-vehicle-delete" disabled={!selectedVehicleIds.length} onClick={onVehicleDelete}><Trash2 size={15} />선택 차량 삭제</button>
    <button type="button" disabled={input.vehicles.length >= 80} onClick={() => onChange({ ...input, vehicles: [...input.vehicles, createTransportVehicle(`vehicle-${crypto.randomUUID()}`)] })}><Plus size={15} />차량 추가</button>
  </header>
    {!!offers.length && <section className="transport-received" aria-label="설문 차량 제공">
      <h4>설문 차량 제공 <small>{offers.length}대</small></h4>
      <ul>{offers.map(item => <li key={item.id}>
        <div><strong>{item.providerName}</strong><small>{item.vehicle?.label ?? "차량 미연결"}</small></div>
        <div>{([["outbound", "출발"], ["return", "귀가"]] as const).map(([direction, label]) => {
          const leg = item.legs[direction];
          return leg && <small key={direction}>{label} · 탑승 약속 {leg.existingPersonIds.length}명 · 추가 {leg.reportedExtraSeats === null ? "미확인" : `${leg.reportedExtraSeats}석`}</small>;
        })}</div>
        {item.alreadyApplied ? <strong>반영됨</strong> : <button type="button" onClick={() => setReviewing(item.providerId)}>동승 약속 검토</button>}
      </li>)}</ul>
    </section>}
    {offer && <RoomDialog title="동승 약속 검토" onClose={() => setReviewing(null)}>
      <div className="room-dialog-body"><p><strong>{offer.providerName} · {offer.vehicle?.label ?? "차량 미연결"}</strong></p>
        {offer.reason ? <p className="transport-warning">{offer.reason}{offer.conflictCount ? ` 확인 필요 ${offer.conflictCount}건.` : ""}</p>
          : <p>약속된 탑승자를 고정하고 이 차량의 배정 한도를 {offer.capacity}석으로 적용합니다. 설문 원본과 기존 확정안은 바뀌지 않습니다.</p>}
      </div><div className="room-dialog-footer"><Button variant="outline" onClick={() => setReviewing(null)}>닫기</Button><Button disabled={!!offer.reason} onClick={() => {
        const next = applyTransportOffer(input, offer.providerId); if (next !== input) onChange(next); setReviewing(null);
      }}>배정 조건에 반영</Button></div>
    </RoomDialog>}
    <datalist id={driverList}>{input.people.map((p) => <option key={p.id} value={driverOption(p)} label={p.department} />)}</datalist>
    <div className="transport-table-scroll" role="region" aria-label="차량과 운전자 표" tabIndex={0}><table className="transport-vehicles-table"><caption className="sr-only">차량별 총 좌석, 배정 가능 좌석과 운행 가능한 팀</caption>
      <thead><tr>{["선택", "차종", "차량 이름", "총 좌석", "배정 가능 좌석", "운전자 이름", "차량 출처", "대여 견적 (원)", "견적 단위", "기타 비용 (원)"].map((column) => <th key={column} scope="col">{column}</th>)}{input.trips.map((t) => <th key={t.id} scope="col">{t.label}</th>)}</tr></thead>
      <tbody>{input.vehicles.map((v, index) => {
        const selected = selectedVehicleIds.includes(v.id);
        const seatsError = v.tripIds.length || (v.capacity > 0 && v.totalSeats !== undefined) ? transportVehicleSeatError(v) : undefined;
        const errorId = `${driverList}-${v.id}-seats`;
        const tripIds = v.enabled ? v.tripIds : [];
        const storedPreset = v.vehicleType ? transportVehiclePresets[v.vehicleType] : undefined;
        const name = v.label === defaultTransportVehicleName && storedPreset?.label ? storedPreset.label : v.label;
        return <tr key={v.id} className={selected ? "is-selected" : undefined}>
          <td><input aria-label={`${name} 선택`} type="checkbox" checked={selected} onChange={(e) => onVehicleSelect(v.id, e.target.checked)} /></td>
          <td><select aria-label={`${index + 1}번 차종`} value={v.vehicleType ?? ""} onChange={(e) => {
            const type = e.target.value as TransportVehicleType;
            const preset = transportVehiclePresets[type];
            if (!preset) return;
            change(v.id, {
              vehicleType: type, totalSeats: preset.totalSeats ?? v.totalSeats ?? 0,
              label: v.label === defaultTransportVehicleName || v.label === storedPreset?.label ? preset.label || defaultTransportVehicleName : v.label,
            });
          }}><option value="" disabled>차종 선택</option>
            {vehicleTypes.map((type) => <option key={type} value={type}>{transportVehiclePresets[type].label || "기타 차량"}</option>)}
          </select></td>
          <td><TransportText label={`${index + 1}번 차량 이름`} value={name === defaultTransportVehicleName ? "" : name} placeholder="선택 입력" maxLength={80}
            onCommit={(label) => change(v.id, { label: label || storedPreset?.label || defaultTransportVehicleName })} />
            {!v.enabled && <small className="transport-warning">기존 미사용 차량</small>}
          </td>
          <td><VehicleSeats label={`${name} 총 좌석`} value={v.totalSeats ?? 0} placeholder={v.totalSeats === undefined ? "미기록" : undefined}
            onChange={(totalSeats) => change(v.id, { totalSeats })} /></td>
          <td><VehicleSeats label={`${name} 배정 가능 좌석`} value={v.capacity} errorId={seatsError ? errorId : undefined}
            onChange={(capacity) => change(v.id, { capacity })} />
            {seatsError && <small className="transport-warning" id={errorId}>{seatsError}</small>}
          </td>
          <DriverCell value={v.driverName ?? input.people.find((p) => p.id === v.driverId)?.name ?? ""} list={driverList} vehicle={v} name={name} onChange={(patch) => change(v.id, patch)} />
          <td><select aria-label={`${name} 차량 출처`} value={v.rental ? "rental" : v.source ?? ""} onChange={event => {
            const source = event.target.value as TransportVehicle["source"] | "";
            change(v.id, { source: source || undefined, rental: source === "rental" });
          }}><option value="">미분류</option><option value="private">자차</option><option value="church">교회 차량</option><option value="rental">대여 차량</option></select></td>
          <td><input aria-label={`${name} 견적`} type="number" min={0} max={10000000} step={1} placeholder="미확인"
            value={hasRentalQuote(v) ? v.rentalCost : ""} onChange={(e) => {
              const amount = e.target.valueAsNumber;
              if (!e.target.value && !e.target.validity.badInput) change(v.id, { rentalCost: 0, rentalQuoteKnown: false });
              else if (Number.isInteger(amount) && amount >= 0 && amount <= 10000000) change(v.id, { rentalCost: amount, rentalQuoteKnown: true });
            }} disabled={!v.rental} /></td>
          <td><select aria-label={`${name} 대여 단위`} disabled={!v.rental} value={v.rentalCostUnit ?? "round-trip"} onChange={event => change(v.id, { rentalCostUnit: event.target.value as TransportVehicle["rentalCostUnit"] })}>
            <option value="round-trip">왕복 전체</option><option value="one-way">편도당</option><option value="day">일당</option></select>
            {v.rental && v.rentalCostUnit === "day" && <input type="number" min={1} max={30} aria-label={`${name} 대여 일수`} placeholder="일수 미정" value={v.rentalDays ?? ""} onChange={event => {
              const days = event.target.valueAsNumber; if (!event.target.value || Number.isInteger(days) && days >= 1 && days <= 30) change(v.id, { rentalDays: event.target.value ? days : null });
            }} />}</td>
          <td><input aria-label={`${name} 기타 비용`} type="number" min={0} max={10000000} step={1} placeholder="미입력" value={v.otherCost ?? ""} onChange={event => {
            const amount = event.target.valueAsNumber; if (!event.target.value || Number.isInteger(amount) && amount >= 0 && amount <= 10000000) change(v.id, { otherCost: event.target.value ? amount : null });
          }} /></td>
          {input.trips.map((t) => <td key={t.id}><input aria-label={`${name} ${t.label} 가용`} type="checkbox" checked={tripIds.includes(t.id)} onChange={(e) => change(v.id, { enabled: true, tripIds: e.target.checked ? [...tripIds, t.id] : tripIds.filter((id) => id !== t.id) })} /></td>)}
        </tr>;
      })}</tbody></table></div><p className="transport-footnote">배정 가능 좌석에는 참가자인 운전자를 포함하고 외부 기사 좌석과 짐 좌석은 제외합니다.</p></div>;
}

function VehicleSeats({ label, value, placeholder, errorId, onChange }: { label: string; value: number; placeholder?: string; errorId?: string; onChange: (value: number) => void }) {
  return <input aria-label={label} aria-invalid={errorId ? true : undefined} aria-describedby={errorId} type="number" inputMode="numeric" min={1} max={60} value={value || ""} placeholder={placeholder}
    onChange={(e) => {
      const seats = e.target.valueAsNumber;
      if (!e.target.value && !e.target.validity.badInput) onChange(0);
      else if (Number.isInteger(seats) && seats >= 1 && seats <= 60) onChange(seats);
    }} />;
}

function DriverCell({ value, list, vehicle, name, onChange }: { value: string; list: string; vehicle: TransportVehicle; name: string; onChange: (patch: Partial<TransportVehicle>) => void }) {
  const unresolved = !!value && !vehicle.driverId && !vehicle.externalDriverConfirmed;
  return <td><TransportText label={`${name} 운전자 이름`} value={value} listId={list} maxLength={140} invalid={unresolved}
      onCommit={(driverName) => onChange({ driverName, driverId: null, externalDriverConfirmed: false })} />
    {unresolved && <small className="transport-warning">운전자 확인 필요</small>}
    {vehicle.driverId === null && <label className="transport-check transport-driver-check"><input aria-label={`${name} 외부 운전자 확정`} type="checkbox" checked={vehicle.externalDriverConfirmed ?? false} onChange={(e) => onChange({ externalDriverConfirmed: e.target.checked })} />외부 운전자 확정</label>}
  </td>;
}

function TransportPeople({ input, onChange, onRosterExport, newParticipantId }: ConfigProps & { onRosterExport: () => void; newParticipantId?: string }) {
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<string | null>(null);
  const firstName = useRef<HTMLInputElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const appliedFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!newParticipantId || appliedFocus.current === newParticipantId) return;
    if (search) { setSearch(""); return; }
    if (firstName.current) {
      appliedFocus.current = newParticipantId;
      if (table.current) table.current.scrollLeft = 0;
      firstName.current.focus();
      firstName.current.select();
    }
  }, [newParticipantId, search]);
  const rows = input.people.filter((p) => `${p.name} ${p.department} ${p.familyId}`.includes(search.trim()));
  const selected = input.people.find(person => person.id === details);
  const change = (id: string, patch: Partial<TransportPerson>) => onChange({ ...input, people: input.people.map((p) => p.id === id ? { ...p, ...patch } : p) });
  const columns = ["이름", "소속", "성별", "가족 ID", "출발 팀", "귀가편", "출발 동반", "귀가 동반", "이동수단", "숙소 희망", "기타 특이사항"];
  return <div className="transport-config transport-people">
    <header><label className="transport-search"><Search size={16} /><input aria-label="참가자 검색" value={search} placeholder="이름, 소속, 가족 ID" onChange={(e) => setSearch(e.target.value)} /></label><span>{rows.length}명</span>
      <button type="button" disabled={!input.people.length} onClick={onRosterExport}><Download size={16} />참가자 CSV 내보내기</button>
    </header>
    <div className="transport-table-scroll" ref={table} role="region" aria-label="참가자 명단 표" tabIndex={0}><table className="transport-roster-table"><caption className="sr-only">입력 순서로 표시한 참가자 명단</caption><thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{rows.map((p) => <tr key={p.id}>
          <td><TransportText inputRef={p.id === newParticipantId ? firstName : undefined} label={`${p.id} 이름`} placeholder="이름 입력" value={p.name === transportUnnamedParticipant ? "" : p.name} maxLength={80} onCommit={(name) => name ? change(p.id, { name }) : false} />
          </td>
          <td><TransportText label={`${p.id} 소속`} placeholder="예: 청년부" value={p.department} maxLength={40} onCommit={(department) => change(p.id, { department: department || "미분류" })} /></td>
          <td><select aria-label={`${p.id} 성별`} value={p.gender ?? ""} onChange={event => {
            const value = event.target.value;
            change(p.id, { gender: isTransportGender(value) ? value : undefined });
          }}><option value="">미확인</option>{Object.entries(transportGenderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
          <td><TransportText label={`${p.id} 가족ID`} placeholder="같은 가족 코드" value={p.familyId} maxLength={40} onCommit={(familyId) => change(p.id, { familyId })} /></td>
          {(["outbound", "return"] as const).map((direction) => {
            const unresolved = entryFor(p, direction);
            return <td key={direction}><select aria-label={`${p.id} ${direction === "outbound" ? "출발" : "귀가"}`} value={unresolved ? "" : tripFor(p, direction) ?? "__independent"}
              aria-invalid={!!unresolved || undefined} disabled={input.locks.some((a) => a.personId === p.id && a.tripId === tripFor(p, direction))}
              onChange={(event) => {
                const id = event.target.value === "__independent" ? null : event.target.value;
                if (id !== null && !input.trips.some(t => t.id === id && t.direction === direction)) return;
                change(p.id, direction === "outbound" ? { outboundTripId: id, outboundEntry: undefined } : { returnTripId: id, returnEntry: undefined });
              }}>
              {unresolved && <option value="" disabled>{unresolved === surveyTripPending ? unresolved : `${unresolved} · 확인 필요`}</option>}
              {input.trips.filter(t => t.direction === direction).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              <option value="__independent">개별 이동</option>
            </select></td>;
          })}
          {(["outbound", "return"] as const).map((direction) => <td key={direction}><TransportText label={`${p.id} ${direction === "outbound" ? "출발" : "귀가"} 동반 묶음`} placeholder="같은 차량 그룹 코드" value={companionFor(p, direction)} maxLength={40}
            onCommit={(value) => change(p.id, direction === "outbound" ? { outboundCompanionGroup: value } : { returnCompanionGroup: value })} /></td>)}
          <td><TransportText label={`${p.id} 이동수단`} placeholder="예: 자차" value={p.movement ?? ""} maxLength={200} onCommit={(movement) => change(p.id, { movement })} /></td>
          <td><TransportText label={`${p.id} 숙소 희망`} placeholder="예: 가족끼리" value={p.lodging ?? ""} maxLength={200} onCommit={(lodging) => change(p.id, { lodging })} /></td>
          <td><TransportNotes label={`${p.id} 기타 특이사항`} value={p.notes ?? ""} onCommit={notes => change(p.id, { notes })} />
            {p.movementPlan && <button type="button" onClick={() => setDetails(p.id)} aria-label={`${p.name} 설문 이동 응답`}>설문 이동 응답</button>}
          </td>
        </tr>)}
      </tbody></table></div>
    {!rows.length && <p className="transport-footnote">{input.people.length ? "검색 결과가 없습니다." : "등록한 참가자가 없습니다."}</p>}
    {selected?.movementPlan && <RoomDialog title={`${selected.name} 설문 이동 응답`} onClose={() => setDetails(null)}>
      <dl className="room-dialog-body transport-movement-details"><dt>출발</dt><dd>{movementDescription(selected.movementPlan.outbound)}</dd>
        <dt>귀가</dt><dd>{movementDescription(selected.movementPlan.return)}</dd><dt>가족 ID</dt><dd>{selected.familyId || "미연결"}</dd></dl>
    </RoomDialog>}
  </div>;
}

function movementDescription(leg: TransportMovement) {
  switch (leg.kind) {
    case "provider": return `차량 제공 · 동승 ${leg.riderNames.join(", ") || "미기재"} · 추가 ${leg.extraSeats.kind === "reported" ? `${leg.extraSeats.seats}석` : "미확인"}`;
    case "rider": return `${leg.method === "family" ? "가족 차량" : "참가자 차량"} 동승 · 제공자 ${leg.providerName}`;
    case "group": return "단체 이동";
    case "independent": return leg.method === "train" ? "기차" : "개별 이동";
    case "pickup": return leg.method === "train" ? "기차 · 역 픽업" : "역 픽업";
    case "undecided": return "미정";
    case "unknown": return leg.answer ? `확인 필요 · ${leg.answer}` : "확인 필요";
  }
}

function TransportNotes({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.value = value; }, [value]);
  return <textarea ref={ref} aria-label={label} placeholder="선택 입력" defaultValue={value} maxLength={4000} rows={1}
    onBlur={event => { if (event.currentTarget.value !== value) onCommit(event.currentTarget.value); }} />;
}
