import { privateCalendarSourceId } from "./chat-calendar";
import { validDate } from "./room-timing";
import {
  emptyTimetable, isTimetable, timetableDate, timetableMaxDays, timetableMaxEntries, timetableTime,
  type Timetable, type TimetableEntry, type TimetableKind,
} from "./timetable";

type Slot = readonly [startHour: number, endHour: number, title: string, kind?: TimetableKind];

const opening: Slot[] = [[10, 10.5, "접수 및 준비"], [10.5, 11.5, "일정 안내 및 모임"]];
const firstTravel: Slot[] = [[8.5, 10, "집결 및 행사장 이동", "travel"]];
const evening: Slot[] = [[17.5, 18.5, "저녁 식사", "meal"], [19, 20.5, "저녁 교류 프로그램"]];
const activities: Slot[] = [[9, 9.5, "하루 일정 안내"], [9.5, 11.5, "오전 활동"]];
const afternoon: Slot[] = [[12, 13, "점심 및 휴식", "meal"], [13.5, 15, "공동 활동"], [15.5, 16, "일과 정리"]];
const closing: Slot[] = [[9, 10, "진행 내용 돌아보기"], [10.5, 11, "마무리 안내 및 정리"], [11, 12, "귀가 이동", "travel"]];
const worship: Slot[] = [[10, 10.5, "예배 준비 및 안내"], [10.5, 11.5, "예배"], [11.5, 12, "마무리 안내"]];
const meeting: Slot[] = [[10, 10.25, "안건 확인"], [10.25, 11.25, "안건 논의"], [11.25, 11.5, "논의 내용 및 다음 단계 정리"]];

function explicitDays(request: string): number | undefined {
  // Bare dates, ordinal days, alternatives, and bounds are not exact durations.
  const mentions = [...request.matchAll(/(\d+)\s*박\s*(\d+)\s*일|(\d+)\s*일\s*(?:간|동안)|당일(?:치기)?/g)];
  if (mentions.length !== 1) return;
  const [match] = mentions;
  const before = request.slice(0, match.index);
  const after = request.slice(match.index + match[0].length);
  const ambiguousBefore = /(?:[\p{L}\d]|[+\-−~～–—]\s*|\d[.,/]\s*|(?:최소|최대|또는|혹은|아니면)\s*)$/u;
  const ambiguousAfter = /^(?:차|째|\d|[.,]\d|\s*(?:[~～–—-]\s*\d|(?:은|는|을|를|이|가)?\s*(?:말고|아니|제외|빼고|이내|이상|이하|미만|또는|혹은)))/;
  if (ambiguousBefore.test(before) || ambiguousAfter.test(after)) return;
  const days = Number(match[2] ?? match[3] ?? 1);
  return Number.isSafeInteger(days) && days >= 1 && (match[1] === undefined || Number(match[1]) === days - 1) ? days : undefined;
}

export function buildChatTimetable(room: { date?: string | null; endDate?: string | null; category?: string }, request: string): Timetable {
  const startDate = room.date && validDate(room.date) ? room.date : "";
  const endDate = room.endDate;
  const category = room.category?.trim().toLowerCase() ?? "";
  const eventDays = startDate && endDate && validDate(endDate) && endDate >= startDate
    ? (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1
    : explicitDays(request) ?? (!startDate && category === "retreat" ? emptyTimetable().days : 1);
  let days = Math.min(eventDays, timetableMaxDays);
  while (days > 1 && startDate && !timetableDate(startDate, days)) days--;

  const entries: TimetableEntry[] = [];
  for (let day = 1; day <= days; day++) {
    let slots: Slot[];
    if (days === 1 && (/\bmeeting\b|회의(?!실)|간담회/i.test(request) || /^(?:meeting|회의)$/.test(category))) slots = meeting;
    else if (days === 1 && (/\bworship\b|예배|부흥회/i.test(request) || /^(?:worship|revival|예배|부흥회)$/.test(category))) slots = worship;
    else if (day === 1) slots = days > 1 ? [...firstTravel, ...opening, ...afternoon, ...evening] : [...opening, ...afternoon];
    else if (day === eventDays) slots = closing;
    else slots = [...activities, ...afternoon, ...evening];
    slots.forEach(([start, end, title, kind = "program"], index) => {
      entries.push({ id: "draft-" + day + "-" + (index + 1), day, title: "[초안] " + title, start: start * 60, end: end * 60, kind });
    });
  }
  const draft: Timetable = { version: 1, startDate, days, entries };
  if (!isTimetable(draft)) throw new Error("타임테이블 초안의 날짜 또는 시간 범위를 확인해 주세요.");
  return draft;
}

export function mergeChatTimetable(current: Timetable, draft: Timetable, proposalId: string): { plan: Timetable; recovered: boolean } {
  if (!proposalId.trim()) throw new Error("타임테이블 제안 식별자가 필요합니다.");
  if (!isTimetable(current)) throw new Error("기존 타임테이블 형식을 확인해 주세요.");
  if (!isTimetable(draft) || !draft.entries.length) throw new Error("타임테이블 초안 형식과 일정을 확인해 주세요.");

  const currentIds = new Set(current.entries.map(entry => entry.id));
  const additions = draft.entries.map(entry => ({
    ...entry, id: privateCalendarSourceId("chat-timetable", proposalId, entry.id).replaceAll(":", "-"),
  })).filter(entry => !currentIds.has(entry.id));
  // A retry after the timetable was saved must leave any subsequent user edits alone.
  if (!additions.length) return { plan: current, recovered: true };

  if (current.startDate && draft.startDate && current.startDate !== draft.startDate) {
    throw new Error("기존 타임테이블과 초안의 시작일이 다릅니다.");
  }
  const startDate = current.startDate || draft.startDate;
  const pristine = !current.startDate && !current.entries.length && current.days === emptyTimetable().days;
  const days = pristine ? draft.days : Math.max(current.days, draft.days);
  if (startDate && !timetableDate(startDate, days)) throw new Error("합친 타임테이블의 날짜 범위를 확인해 주세요.");
  if (current.entries.length + additions.length > timetableMaxEntries) throw new Error("타임테이블에 추가할 수 있는 일정 수를 초과했습니다.");

  const entries = [...current.entries];
  for (const entry of additions) {
    if (entries.some(other => other.day === entry.day && entry.start < other.end && other.start < entry.end)) {
      throw new Error(entry.day + "일차 " + timetableTime(entry.start) + "부터의 초안 일정이 다른 일정과 겹칩니다.");
    }
    entries.push(entry);
  }
  const plan: Timetable = { ...current, startDate, days, entries };
  if (!isTimetable(plan)) throw new Error("합친 타임테이블의 형식을 확인해 주세요.");
  return { plan, recovered: false };
}
