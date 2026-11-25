export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function roomTiming(room: { date: string | null; endDate?: string | null }, now = new Date()) {
  const start = room.date;
  if (!start) return { key: "undated", label: "날짜 미정", reason: "시작일이 정해지지 않았습니다." };
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = room.endDate || start;
  if (end < today) return { key: "past", label: "지난 일정", reason: "종료일이 한국 날짜 기준 오늘보다 이전입니다." };
  if (start <= today) return { key: "ongoing", label: "진행 중", reason: "한국 날짜 기준 오늘이 행사 시작일과 종료일 사이입니다." };
  const days = (Date.parse(`${start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (days <= 7) return { key: "soon", label: "일정 임박", reason: `시작까지 ${days}일 남았습니다. 시작 7일 전부터 표시합니다.` };
  return { key: "upcoming", label: "예정 일정", reason: "시작일까지 8일 이상 남았습니다." };
}

export function roomDateLabel(start: string | null, end?: string | null) {
  if (!start) return "날짜 미정";
  const from = start.replaceAll("-", ".");
  return end && end !== start ? `${from} ~ ${end.replaceAll("-", ".")}` : from;
}

export const roomStages = [
  { id: "past", label: "종료" },
  { id: "undated", label: "일정 미정" },
  { id: "ongoing", label: "진행 중" },
] as const;

export type RoomStage = (typeof roomStages)[number]["id"];

export function roomStage(key: string): RoomStage {
  return key === "past" || key === "undated" ? key : "ongoing";
}
