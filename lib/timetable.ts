import { validDate } from "./room-timing";

export const timetableKinds = ["program", "meal", "travel"] as const;
export const timetableMaxDays = 14;
export const timetableMaxEntries = 1000;
export const timetableMinDuration = 15;
export const timetableMorning = 7 * 60;
export const timetableMidnight = 24 * 60;

export type TimetableKind = typeof timetableKinds[number];
export type TimetableEntry = { id: string; day: number; title: string; start: number; end: number; kind: TimetableKind };
export type Timetable = { version: 1; days: number; startDate: string; entries: TimetableEntry[] };

export const emptyTimetable = (): Timetable => ({ version: 1, days: 2, startDate: "", entries: [] });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integerBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

export function timetableDate(startDate: string, day: number): string {
  if (!validDate(startDate)) return "";
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + day - 1);
  return date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : "";
}

export function isTimetable(value: unknown): value is Timetable {
  if (!record(value) || value.version !== 1 || !integerBetween(value.days, 1, timetableMaxDays)
    || typeof value.startDate !== "string" || (value.startDate !== "" && !timetableDate(value.startDate, value.days))
    || !Array.isArray(value.entries) || value.entries.length > timetableMaxEntries) return false;
  const ids = new Set<string>();
  const days = value.days;
  return value.entries.every((entry: unknown) => {
    if (!record(entry) || typeof entry.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.id) || ids.has(entry.id)
      || !integerBetween(entry.day, 1, days) || typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 120
      || entry.title.includes("\u0000") || !timetableKinds.includes(entry.kind as TimetableKind)
      || !integerBetween(entry.start, 0, timetableMidnight - timetableMinDuration)
      || !integerBetween(entry.end, entry.start + timetableMinDuration, timetableMidnight)) return false;
    ids.add(entry.id);
    return true;
  });
}

export function readTimetable(raw: string | null): Timetable {
  if (raw === null) return emptyTimetable();
  const record: unknown = JSON.parse(raw);
  if (!isTimetable(record)) throw new Error("저장된 타임테이블을 읽을 수 없습니다.");
  return record;
}

export function timetableTime(minute: number) {
  const clock = minute % timetableMidnight;
  return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
}

type PlacedEntry = { entry: TimetableEntry; top: number; duration: number; lane: number; lanes: number };
export function placeTimetableEntries(entries: TimetableEntry[]): PlacedEntry[] {
  const placed: PlacedEntry[] = [];
  const sorted = entries.filter(entry => entry.end > timetableMorning).sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  let clusterStart = 0;
  let laneEnds: number[] = [];
  let clusterEnd = timetableMorning;
  const settle = () => {
    for (let index = clusterStart; index < placed.length; index++) placed[index].lanes = laneEnds.length;
    clusterStart = placed.length;
    laneEnds = [];
  };
  for (const entry of sorted) {
    const start = Math.max(entry.start, timetableMorning);
    if (start >= clusterEnd) settle();
    const available = laneEnds.findIndex(end => end <= start);
    const lane = available < 0 ? laneEnds.length : available;
    laneEnds[lane] = entry.end;
    clusterEnd = Math.max(clusterEnd, entry.end);
    placed.push({ entry, top: start - timetableMorning, duration: entry.end - start, lane, lanes: 0 });
  }
  settle();
  return placed;
}
