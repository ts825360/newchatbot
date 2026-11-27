import type { DatabaseSync } from "node:sqlite";
import { defaultNotificationPreferences, isNotificationPreferences, type NotificationCategory, type NotificationItem } from "../notification-preferences";
import { requireUser, type Actor } from "./auth";
import { getDatabase } from "./database";
import { ApiError, errorResponse, json, readJson } from "./http";

const kind = "notification-preferences";
const preferencesKey = (accountId: string) => `${kind}:${accountId}`;

function loadState(db: DatabaseSync, actor: Actor) {
  const row = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND kind=?").get(preferencesKey(actor.id), actor.id, kind);
  const preferences: unknown = row ? JSON.parse(String(row.data_json)) : defaultNotificationPreferences;
  const items = actor.permissions.includes("viewRoom") ? db.prepare(`
    SELECT n.id,n.kind,json_extract(r.data_json,'$.name') AS roomName,n.created_at AS createdAt
    FROM user_notifications n JOIN rooms r ON n.room_id=r.id
    WHERE n.user_id=? AND (n.kind<>'calendar' OR ?)
    ORDER BY n.id DESC LIMIT 30`).all(actor.id, Number(actor.permissions.includes("viewCalendar"))) as NotificationItem[] : [];
  return { settings: isNotificationPreferences(preferences) ? preferences : defaultNotificationPreferences, items };
}

// Call inside the transaction that accepts a real change, never while reading a feed.
export function notifyRoomChange(db: DatabaseSync, actor: Actor, roomId: string, category: NotificationCategory) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_notifications(user_id,room_id,kind,created_at)
    SELECT u.id,v.room_id,?,? FROM room_visits v
    JOIN users u ON u.id=v.user_id
    LEFT JOIN records p ON p.owner_id=u.id AND p.key='notification-preferences:'||u.id AND p.kind='notification-preferences'
    WHERE v.room_id=? AND u.id<>? AND u.suspended=0
      AND (u.access_expires_at IS NULL OR u.access_expires_at>?)
      AND EXISTS (SELECT 1 FROM json_each(u.permissions_json) WHERE value='viewRoom')
      AND (?<>'calendar' OR EXISTS (SELECT 1 FROM json_each(u.permissions_json) WHERE value='viewCalendar'))
      AND COALESCE(json_extract(p.data_json,'$.enabled'),1)=1
      AND COALESCE(json_extract(p.data_json,?),1)=1
  `).run(category, now, roomId, actor.id, now, category, `$.${category}`);
}

export async function handleNotifications(request: Request, db = getDatabase()): Promise<Response> {
  try {
    const actor = requireUser(request, db);
    const expected = request.headers.get("x-account-id");
    if (expected !== null && expected !== actor.id) throw new ApiError(409, "접속 계정이 변경되었습니다. 다시 확인해 주세요.");
    if (request.method === "GET") return json(loadState(db, actor));
    if (request.method !== "PUT") return json({ error: "지원하지 않는 알림 요청입니다." }, 405);
    const value = await readJson(request, 1024);
    if (!isNotificationPreferences(value)) throw new ApiError(400, "알림 설정을 확인해 주세요.");
    const current = requireUser(request, db);
    if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion) throw new ApiError(401, "다시 로그인해 주세요.");
    db.prepare(`INSERT INTO records(key,owner_id,kind,data_json,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1,updated_at=excluded.updated_at`)
      .run(preferencesKey(actor.id), actor.id, kind, JSON.stringify(value), new Date().toISOString());
    return json(loadState(db, current));
  } catch (cause) { return errorResponse(cause); }
}
