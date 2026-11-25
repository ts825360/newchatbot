export function normalizeCalendarTime(value: string): string | null {
  const time = value.trim();
  if (!time || time === "미정") return "";
  const match = /^(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const [, meridiem, hour, minute] = match;
  const hours = Number(hour);
  if (Number(minute) > 59 || (meridiem ? hours < 1 || hours > 12 : hours > 23)) return null;
  const normalizedHour = meridiem ? hours % 12 + (meridiem === "오후" ? 12 : 0) : hours;
  return `${String(normalizedHour).padStart(2, "0")}:${minute}`;
}

type CalendarHours = { start: string; end: string; nextDay: boolean };

export function resolveCalendarHours(startValue: string, endValue: string): CalendarHours | null {
  const start = normalizeCalendarTime(startValue);
  const end = normalizeCalendarTime(endValue);
  if (start === null || end === null) return null;
  if (!start) return end ? null : { start: "00:00", end: "22:00", nextDay: false };
  if (end) return end > start ? { start, end, nextDay: false } : null;
  const hour = Number(start.slice(0, 2)) + 1;
  return { start, end: `${String(hour % 24).padStart(2, "0")}:${start.slice(3)}`, nextDay: hour === 24 };
}

export function formatCalendarHours({ start, end, nextDay }: CalendarHours): string {
  return `${start} ~ ${nextDay ? "다음 날 " : ""}${end}`;
}

export function storedCalendarHours(event: { time: string; endTime?: string }): string {
  const range = event.endTime === undefined ? null : resolveCalendarHours(event.time, event.endTime);
  return range ? formatCalendarHours(range) : normalizeCalendarTime(event.time) || "시간 미지정";
}
