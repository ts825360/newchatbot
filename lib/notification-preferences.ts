export const notificationCategories = {
  calendar: { title: "공동 캘린더", description: "방문한 행사방에서 다른 구성원이 공동 일정을 추가, 변경 또는 삭제했을 때 받습니다." },
  room: { title: "행사방 활동", description: "방문한 행사방에서 다른 구성원이 이름, 기간 또는 기본 정보를 변경했을 때 받습니다." },
} as const;

export type NotificationCategory = keyof typeof notificationCategories;
export type NotificationPreferences = Record<NotificationCategory | "enabled", boolean>;
export type NotificationItem = { id: number; kind: NotificationCategory; roomName: string; createdAt: string };
export type NotificationState = { settings: NotificationPreferences; items: NotificationItem[] };

export const defaultNotificationPreferences: NotificationPreferences = { enabled: true, calendar: true, room: true };

export function isNotificationPreferences(value: unknown): value is NotificationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return Object.keys(settings).length === 3 && Object.keys(defaultNotificationPreferences).every(key => typeof settings[key] === "boolean");
}
