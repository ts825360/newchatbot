import { randomUUID } from "node:crypto";
import { requireUser, type Actor } from "./auth";
import { getDatabase, transaction } from "./database";
import { ApiError, errorResponse, json, readJson } from "./http";
import { feedbackCategories, type FeedbackContext } from "../feedback-store";

const minute = 60_000;
const maxMailAttempts = 6;
// Stay inside the provider's 24-hour idempotency window after an uncertain send.
const retryWindow = 22 * 60 * minute;
type MailStatus = "queued" | "sent" | "failed" | "unconfigured";
const email = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
function mailSettings() {
  const key = process.env.RESEND_API_KEY?.trim(), from = process.env.REPORT_EMAIL_FROM?.trim(), to = process.env.REPORT_EMAIL_TO?.trim();
  return key && from && to && email.test(from) && email.test(to) ? { key, from, to } : null;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function shortText(value: unknown) { return typeof value === "string" && !!value.trim() && value.length <= 100; }
function screenContext(value: unknown): FeedbackContext | null {
  if (value === undefined) return null;
  if (!object(value) || !shortText(value.screenName) || (value.roomName !== undefined && !shortText(value.roomName)) || ![value.width, value.height].every(size => typeof size === "number" && Number.isSafeInteger(size) && size > 0 && size < 20000)) {
    throw new ApiError(400, "첨부할 화면 정보를 확인해 주세요.");
  }
  return { screenName: value.screenName as string, ...(value.roomName ? { roomName: value.roomName as string } : {}), width: value.width as number, height: value.height as number };
}

export function acceptReport(actor: Actor, value: unknown, db = getDatabase()): { notification: MailStatus } {
  if (!object(value) || typeof value.requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.requestId)
    || typeof value.category !== "string" || !Object.hasOwn(feedbackCategories, value.category) || typeof value.description !== "string" || !value.description.trim() || value.description.length > 3000) {
    throw new ApiError(400, "문제 유형과 내용을 확인해 주세요. 내용은 3,000자까지 입력할 수 있습니다.");
  }
  const requestId = value.requestId.toLowerCase(), description = value.description.trim(), category = value.category;
  const context = screenContext(value.context), contextJson = context ? JSON.stringify(context) : null;
  return transaction(db, () => {
    const previous = db.prepare("SELECT category,description,context_json,mail_status FROM issue_reports WHERE user_id=? AND request_id=?").get(actor.id, requestId);
    if (previous) {
      if (previous.category !== category || previous.description !== description || previous.context_json !== contextJson) throw new ApiError(409, "같은 접수 번호에 다른 신고 내용이 있습니다. 내용을 확인해 주세요.");
      return { notification: previous.mail_status as MailStatus };
    }
    const since = new Date(Date.now() - 15 * minute).toISOString();
    if (Number(db.prepare("SELECT count(*) AS total FROM issue_reports WHERE user_id=? AND created_at>=?").get(actor.id, since)!.total) >= 5) throw new ApiError(429, "최근 신고가 많습니다. 잠시 후 다시 시도해 주세요.");
    const notification = mailSettings() ? "queued" : "unconfigured";
    db.prepare("INSERT INTO issue_reports(id,user_id,request_id,reporter,category,description,context_json,created_at,mail_status) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), actor.id, requestId, actor.name, category, description, contextJson, new Date().toISOString(), notification);
    return { notification };
  });
}

export async function reportPost(request: Request, db = getDatabase()) {
  try {
    requireUser(request, db);
    const input = await readJson(request, 16 * 1024);
    return json(acceptReport(requireUser(request, db), input, db), 201);
  } catch (error) { return errorResponse(error); }
}

export async function dispatchReportNotifications(db = getDatabase(), send: typeof fetch = fetch) {
  const settings = mailSettings();
  if (!settings) return;
  for (let index = 0; index < 5; index++) {
    const now = Date.now();
    const row = transaction(db, () => {
      db.prepare("UPDATE issue_reports SET mail_status='failed' WHERE mail_status='queued' AND mail_next_at<=? AND (mail_attempts>=? OR mail_first_at<=?)").run(now, maxMailAttempts, now - retryWindow);
      return db.prepare(`UPDATE issue_reports SET mail_attempts=mail_attempts+1, mail_first_at=COALESCE(mail_first_at,?), mail_next_at=?
        WHERE id=(SELECT id FROM issue_reports WHERE mail_status='queued' AND mail_next_at<=? ORDER BY mail_next_at,created_at LIMIT 1)
        RETURNING id,mail_attempts`).get(now, now + minute, now);
    });
    if (!row) return;
    const attempts = Number(row.mail_attempts);
    let status: MailStatus = attempts >= maxMailAttempts ? "failed" : "queued";
    try {
      const response = await send("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${settings.key}`, "Content-Type": "application/json", "Idempotency-Key": `issue-report/${row.id}` },
        body: JSON.stringify({ from: settings.from, to: [settings.to], subject: "문제 신고 확인", text: "새 문제 신고가 접수되었습니다. 행사비서 제1관리자 화면에서 확인해 주세요." })
      });
      if (response.ok) { const body = await response.json(); if (typeof body?.id === "string" && body.id) status = "sent"; }
      else if (response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)) status = "failed";
    } catch { /* No external response details or credentials enter application logs. */ }
    db.prepare("UPDATE issue_reports SET mail_status=?,mail_next_at=? WHERE id=? AND mail_attempts=?")
      .run(status, Date.now() + minute * 2 ** attempts, row.id!, attempts);
  }
}
