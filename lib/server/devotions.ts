import type { DatabaseSync } from "node:sqlite";
import { devotionBodyLimit, devotionTitleLimit, koreaDate, type DevotionEntry } from "../devotions";
import { validDate } from "../room-timing";
import { requirePermission, requireUser, type Actor } from "./auth";
import { dailyMeditation } from "./daily-meditation";
import { bumpRevision, getDatabase, transaction } from "./database";
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from "./http";
import { object, text } from "./record-schema";

const pageSize = 20;
const day = (date: unknown): date is string => typeof date === "string" && validDate(date) && date >= "1900-01-01";
const canPublish = (actor: Actor) => actor.grade <= 2 && actor.permissions.includes("editRoom");
const conflict = () => new ApiError(409, "이 날짜의 글이 이미 있거나 다른 곳에서 변경됐습니다. 최신 글을 확인해 주세요.");
const excerpt = (body: string) => body.trim().replace(/\s+/g, " ").slice(0, 140);
const asSummary = ({ date, title, body }: Pick<DevotionEntry, "date" | "title" | "body">) => ({ date, title, excerpt: excerpt(body) });
const columns = "day AS date,title,body,revision";

export async function handleDevotions(request: Request, db = getDatabase(), now = new Date()): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = requireUser(request, db);
    requirePermission(actor, "viewRoom");
    const today = koreaDate(now);
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams;
      const date = query.get("date"), before = query.get("before"), view = query.get("view");
      if ([...query].length !== new Set(query.keys()).size ||
          [...query.keys()].some(key => !["date", "before", "view"].includes(key)) ||
          (date !== null && !day(date)) || (before !== null && !day(before)) ||
          (view !== null && (!["preview", "meditation"].includes(view) || date !== null || before !== null))) throw new ApiError(400, "말씀 날짜를 확인해 주세요.");
      if (view === "meditation") return json(dailyMeditation(today));
      const latest = () => db.prepare(`SELECT ${columns} FROM daily_devotions WHERE day<=? ORDER BY day DESC LIMIT 1`).get(today) as DevotionEntry | undefined;
      if (view === "preview") {
        const entry = latest();
        return json({ today, latest: entry ? asSummary(entry) : null });
      }
      const current = date
        ? db.prepare(`SELECT ${columns} FROM daily_devotions WHERE day=? AND day<=?`).get(date, today) as DevotionEntry | undefined
        : latest();
      const rows = db.prepare("SELECT day AS date,title,body FROM daily_devotions WHERE day<=? AND (? IS NULL OR day<?) ORDER BY day DESC LIMIT ?")
        .all(today, before, before, pageSize + 1) as Pick<DevotionEntry, "date" | "title" | "body">[];
      return json({ today, entry: current ?? null, canPublish: canPublish(actor),
        archive: rows.slice(0, pageSize).map(asSummary), next: rows.length > pageSize ? rows[pageSize - 1].date : null });
    }
    if (request.method !== "PUT" && request.method !== "DELETE") return json({ error: "지원하지 않는 말씀 요청입니다." }, 405);
    if (!canPublish(actor)) throw new ApiError(403, "말씀 게시 권한이 없습니다.");
    const input = await readJson(request, 128 * 1024);
    const editing = request.method === "PUT";
    if (!object(input) || !day(input.date) || input.date > today || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
        Object.keys(input).some(key => !(editing ? ["date", "revision", "title", "body"] : ["date", "revision"]).includes(key))) {
      throw new ApiError(400, "게시할 날짜를 확인해 주세요. 미래 날짜는 등록할 수 없습니다.");
    }
    if (editing && (!text(input.title, devotionTitleLimit, true) || /[\x00-\x1f\x7f]/.test(input.title) ||
        !text(input.body, devotionBodyLimit) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.body))) {
      throw new ApiError(400, "제목은 한 줄, 말씀 본문은 1~16,000자로 입력해 주세요.");
    }
    const current = requireUser(request, db);
    requirePermission(current, "viewRoom");
    if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion || !canPublish(current))
      throw new ApiError(403, "말씀 게시 권한을 다시 확인해 주세요.");
    return transaction(db, () => {
      const { date, revision } = input;
      const stored = db.prepare("SELECT revision FROM daily_devotions WHERE day=?").get(date);
      if (Number(stored?.revision ?? 0) !== revision || !editing && !stored) throw conflict();
      if (!editing) {
        db.prepare("DELETE FROM daily_devotions WHERE day=?").run(date);
        bumpRevision(db);
        return json({ ok: true });
      }
      const next = bumpRevision(db);
      const entry = { date, title: input.title.trim(), body: input.body, revision: next };
      db.prepare(`INSERT INTO daily_devotions(day,title,body,revision,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET title=excluded.title,body=excluded.body,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(date, entry.title, entry.body, next, now.toISOString());
      return json({ entry });
    });
  } catch (error) { return errorResponse(error); }
}
