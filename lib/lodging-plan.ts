import { transportUnnamedParticipant, type TransportPerson } from "./transport";

export type RoomKind = "personal" | "family" | "group" | "existing";
export type LodgingChoice = { id: string; kind: Exclude<RoomKind, "existing">; group?: "men" | "women" };
export type LodgingRoom = { id: string; kind: RoomKind; group: string; capacity: number | null; number: string; locked: boolean; people: string[] };
export type LodgingPlan = { familySizes: number[]; groupSize: number; overrides: LodgingChoice[]; rooms: LodgingRoom[] };
export const roomKindLabel: Record<RoomKind, string> = { personal: "개인방", family: "가족방", group: "단체방", existing: "기존 방" };
const kinds = Object.keys(roomKindLabel);
const size = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 250;
const text = (s: unknown, max: number): s is string => typeof s === "string" && s.length <= max && !s.includes("\u0000");

export function lodgingGroupLabel(group: string) {
  const [departmentOrGroup, genderGroup] = group.split(":");
  const gender = genderGroup ?? departmentOrGroup;
  const label = gender === "men" ? "남성" : gender === "women" ? "여성" : "그룹 확인 필요";
  return genderGroup ? `${departmentOrGroup} · ${label}` : label;
}

export function isLodgingPlan(raw: unknown): raw is LodgingPlan {
  if (!raw || typeof raw !== "object") return false;
  const plan = raw as LodgingPlan;
  return Array.isArray(plan.familySizes) && plan.familySizes.length >= 1 && plan.familySizes.length <= 20 && plan.familySizes.every(size) && size(plan.groupSize)
    && Array.isArray(plan.overrides) && plan.overrides.length <= 250 && plan.overrides.every(x => x && text(x.id, 80) && kinds.includes(x.kind) && x.kind !== ("existing" as RoomKind) && (x.group === undefined || ["men", "women"].includes(x.group)))
    && Array.isArray(plan.rooms) && plan.rooms.length <= 500 && plan.rooms.every(r => r && text(r.id, 100) && kinds.includes(r.kind) && text(r.group, 100) && (r.capacity === null || size(r.capacity)) && text(r.number, 80) && typeof r.locked === "boolean" && Array.isArray(r.people) && r.people.length <= 250 && r.people.every(id => text(id, 80)))
    && new Set(plan.rooms.map(r => r.id)).size === plan.rooms.length && new Set(plan.overrides.map(x => x.id)).size === plan.overrides.length
    && new Set(plan.rooms.flatMap(r => r.people)).size === plan.rooms.reduce((n, r) => n + r.people.length, 0);
}

export function initialLodgingPlan(people: TransportPerson[]): LodgingPlan {
  const rooms = new Map<string, LodgingRoom>();
  for (const person of people) {
    if (!person.roomAssignment?.trim()) continue;
    const number = person.roomAssignment.trim().normalize("NFC");
    const room = rooms.get(number) ?? { id: `existing-${rooms.size + 1}`, kind: "existing", capacity: null, group: "", number, locked: false, people: [] };
    room.people.push(person.id);
    rooms.set(number, room);
  }
  return { familySizes: [2, 4, 6], groupSize: 8, overrides: [], rooms: [...rooms.values()] };
}

export function lodgingPreference(person: TransportPerson, override?: LodgingChoice) {
  if (person.name === transportUnnamedParticipant) return { issue: "이름 확인 필요" } as const;
  const preference = (person.lodging ?? "").replace(/\s/g, "");
  const kind = override?.kind ?? (["가족방", "가족끼리"].includes(preference) ? "family" : ["단체방", "기관끼리"].includes(preference) ? "group" : undefined);
  if (kind === "personal") return { kind, group: person.id } as const;
  if (kind === "family") return person.familyId.trim() ? { kind, group: person.familyId.trim() } as const : { kind, issue: "가족 ID 확인 필요" } as const;
  if (kind === "group") {
    const department = person.department.normalize("NFKC").replace(/\s+/g, "");
    if (department === "청년부" || department === "청소년부") {
      const group = override?.group ?? (person.gender === "male" ? "men" : person.gender === "female" ? "women" : undefined);
      return group ? { kind, group: `${department}:${group}` } as const : { kind, issue: "성별 또는 운영진 지정 확인 필요" } as const;
    }
    // Older rosters used an explicit group label in the department column.
    const group = override?.group ?? (["남자", "남성", "남"].includes(department) ? "men" : ["여자", "여성", "여"].includes(department) ? "women" : undefined);
    return group ? { kind, group } as const : { kind, issue: "남자·여자 그룹 확인 필요" } as const;
  }
  return { issue: "숙소 유형 확인 필요" } as const;
}

export function reconcileLodging(people: TransportPerson[], plan: LodgingPlan): LodgingPlan {
  const ids = new Set(people.map(p => p.id));
  return { ...plan, overrides: plan.overrides.filter(x => ids.has(x.id)), rooms: plan.rooms.map(room => ({ ...room, people: room.people.filter(id => ids.has(id)) })) };
}

export function calculateLodging(people: TransportPerson[], base: LodgingPlan): LodgingPlan {
  const plan = reconcileLodging(people, base);
  const rooms = plan.rooms.filter(r => r.locked || r.number);
  const committed = rooms.flatMap(r => r.people);
  const assigned = new Set(committed);
  const groups = new Map<string, { kind: RoomKind; group: string; people: string[] }>();
  const coveredFamilies = new Set<string>();
  const overrides = new Map(plan.overrides.map(x => [x.id, x]));
  for (const p of people) {
    const choice = lodgingPreference(p, overrides.get(p.id));
    if (choice.kind === "family" && !choice.issue && assigned.has(p.id)) coveredFamilies.add(choice.group);
    if (choice.issue || assigned.has(p.id)) continue;
    const groupKey = `${choice.kind}:${choice.group}`;
    const group = groups.get(groupKey) ?? { ...choice, people: [] };
    group.people.push(p.id);
    groups.set(groupKey, group);
  }
  const used = new Set(rooms.map(room => room.id));
  let sequence = 0;
  for (const row of groups.values()) {
    if (row.kind === "family" && coveredFamilies.has(row.group)) continue;
    const capacity = row.kind === "personal" ? 1 : row.kind === "group" ? plan.groupSize : [...plan.familySizes].sort((a, b) => a - b).find(n => n >= row.people.length);
    if (!capacity) continue;
    for (let start = 0; start < row.people.length; start += capacity) {
      let id: string;
      do { id = `plan-${++sequence}`; } while (used.has(id));
      used.add(id);
      rooms.push({ id, kind: row.kind, group: row.group, capacity, number: "", locked: false, people: row.people.slice(start, start + capacity) });
    }
  }
  return { ...plan, rooms };
}

export function summarizeLodging(people: TransportPerson[], base: LodgingPlan) {
  const plan = reconcileLodging(people, base);
  const active = plan.rooms.filter(r => r.people.length || r.number || r.locked);
  const assigned = new Set(active.flatMap(r => r.people));
  return { active, assigned: assigned.size, pending: people.length - assigned.size, numbered: active.filter(r => r.number).length };
}

export function moveLodgingPerson(people: TransportPerson[], base: LodgingPlan, personId: string, destination: string | null): LodgingPlan {
  const plan = reconcileLodging(people, base);
  const person = people.find(p => p.id === personId);
  if (!person) throw new Error("참가자를 찾을 수 없습니다.");
  const current = plan.rooms.find(r => r.people.includes(personId));
  if (current?.id === destination) return plan;
  const target = plan.rooms.find(r => r.id === destination);
  if (destination && !target) throw new Error("옮길 방을 찾을 수 없습니다.");
  const overrides = new Map(plan.overrides.map(x => [x.id, x]));
  const pref = lodgingPreference(person, overrides.get(personId));
  const movers = pref.kind === "family" && !pref.issue && (target || current?.kind === "family") ? people.filter(p => {
    const option = lodgingPreference(p, overrides.get(p.id));
    return option.kind === "family" && !option.issue && option.group === pref.group;
  }).map(p => p.id) : [personId];
  if (target?.locked || plan.rooms.some(r => r.locked && r.people.some(id => movers.includes(id)))) throw new Error("잠근 방은 잠금을 해제해야 옮길 수 있습니다.");
  if (target) {
    if (pref.issue || target.kind !== pref.kind || target.group !== pref.group) throw new Error("같은 숙소 유형과 그룹의 방만 선택할 수 있습니다.");
    if (target.capacity === null || new Set([...target.people, ...movers]).size > target.capacity) throw new Error("이 방의 정원을 초과합니다.");
  }
  return { ...plan, rooms: plan.rooms.map(r => {
    const occupants = r.people.filter(id => !movers.includes(id));
    return { ...r, people: r.id === destination ? [...occupants, ...movers] : occupants };
  }).filter(r => r.people.length || r.number || r.locked || r.id === destination) };
}

export function rosterFingerprint(people: TransportPerson[]) {
  return JSON.stringify(people.map(p => [p.id, p.name, p.department]).sort(([a], [b]) => a.localeCompare(b)));
}
