export type DevotionSummary = { date: string; title: string; excerpt: string };
export type DevotionEntry = { date: string; title: string; body: string; revision: number };
export type DevotionPreview = { today: string; latest: DevotionSummary | null };
export type DailyMeditation = { date: string; reference: string; verse: string; url: string };
export type DevotionFeed = {
  today: string;
  entry: DevotionEntry | null;
  archive: DevotionSummary[];
  next: string | null;
  canPublish: boolean;
};
export const devotionTitleLimit = 100;
export const devotionBodyLimit = 16_000;
export const devotionChanged = "church-devotion-changed";
export const koreaDate = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(now);
export const devotionDayLabel = (date: string) => new Intl.DateTimeFormat("ko-KR", {
  year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul",
}).format(new Date(`${date}T00:00:00+09:00`));
