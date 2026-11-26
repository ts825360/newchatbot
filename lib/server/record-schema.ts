import type { CalendarEvent, ChecklistItem } from "../types";
import { isCalendarStatus } from "../calendar-status";
import { isConversationPlaceRecord } from "../conversation-places";
import { resolveCalendarHours } from "../calendar-time";
import { isDocumentFileMetadata } from "../document-files";
import { validDate } from "../room-timing";
import { isTransportResult, validateTransportInput, validateTransportResult } from "../transport";
import { isTransportComparison } from "../transport-comparison";
import { isTransportSurvey } from "../transport-survey";
import { isLodgingPlan } from "../lodging-plan";
import { isTimetable } from "../timetable";
import { isAdvisorPresentation } from "../chat-advisor";
import { ApiError } from "./http";
import { internalChatAction } from "../assistant-privacy";

export const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
export const text = (v: unknown, max = 300, empty = false): v is string => typeof v === "string" && v.length <= max && (empty || !!v.trim()) && !v.includes("\u0000");
export const id = (v: unknown): v is string => text(v, 128) && !/[\x00-\x1f\x7f/\\]/.test(v);
export const items = (v: unknown, check: (v: any) => boolean, max = 1000) => Array.isArray(v) && v.length <= max && v.every((item) => object(item) && id(item.id) && check(item)) && new Set(v.map((i) => i.id)).size === v.length;
export const permissionFields = ["id", "title", "date", "time", "location", "memo", "author", "lastEditor", "changeLog"];
export const eventValid = (v: any): v is CalendarEvent => object(v)
  && permissionFields.every((k) => text(v[k], k === "memo" ? 8000 : k === "title" ? 120 : 500, !["id", "title", "date"].includes(k)))
  && validDate(v.date) && isCalendarStatus(v.status)
  && (v.endTime === undefined || text(v.endTime, 20, true) && !!resolveCalendarHours(v.time, v.endTime))
  && (v.linkLabel === undefined || text(v.linkLabel, 100, true)) && (v.linkUrl === undefined || v.linkUrl === "" || url(v.linkUrl));
export const checklistValid = (v: any): v is ChecklistItem => object(v) && text(v.title, 120) && text(v.owner, 100, true) && text(v.memo, 8000, true) && text(v.due, 10, true) && (!v.due || validDate(v.due)) && ["done", "inProgress", "needsReview", "risk"].includes(v.status);
export function url(v: unknown): boolean { try { return typeof v === "string" && v.length <= 2000 && ["https:", "http:"].includes(new URL(v).protocol); } catch { return false; } }
function validConversationMessages(value: unknown) {
  const seen = new Map<string, string>();
  return items(value, m => {
    if (!["user", "assistant"].includes(m.sender) || !text(m.text, 16000) || !text(m.time, 80)) return false;
    if (m.actions !== undefined && (!Array.isArray(m.actions) || m.actions.length > 20 || !m.actions.every((a: unknown) => text(a, 100)))) return false;
    if (m.advisor !== undefined && (m.sender !== "assistant" || !isAdvisorPresentation(m.advisor))) return false;
    if (m.replyElapsedMs !== undefined && (m.sender !== "assistant" || !Number.isSafeInteger(m.replyElapsedMs) || m.replyElapsedMs < 0)) return false;
    if (m.reference !== undefined) {
      if (m.sender !== "user" || !object(m.reference) || Object.keys(m.reference).length !== 2 || !id(m.reference.messageId)) return false;
      const source = seen.get(m.reference.messageId);
      if (!source || !["reply", "edit"].includes(m.reference.kind)) return false;
      if (m.reference.kind === "edit" && (source !== "user" || m.actions?.includes(internalChatAction))) return false;
    }
    seen.set(m.id, m.sender);
    return true;
  });
}

export function validateRecord(kind: string, value: unknown): void {
  let valid = false;
  switch (kind) {
    case "documents": valid = object(value) && value.version === 1 && items(value.items, (v) => text(v.title, 260) && typeof v.pinned === "boolean" && ["minutes", "sample", "file"].includes(v.kind) && (v.kind === "file" ? isDocumentFileMetadata(v.file) : v.file === undefined)); break;
    case "checklist": valid = object(value) && value.version === 1 && items(value.items, checklistValid); break;
    case "events": valid = object(value) && value.version === 1 && items(value.items, eventValid); break;
    case "location": valid = isConversationPlaceRecord(value); break;
    case "timetable": valid = isTimetable(value); break;
    case "decisions": valid = object(value) && value.version === 1 && items(value.items, (v) => ["pending", "accepted", "deferred", "excluded"].includes(v.status) && text(v.reason, 300, v.status !== "excluded") && (v.title === undefined || text(v.title, 120, true)) && (v.date === undefined || v.date === "" || validDate(v.date))); break;
    case "risks": valid = object(value) && value.version === 1 && items(value.items, (v) => ["title", "detail", "action"].every((k) => text(v[k], 1000)) && typeof v.resolved === "boolean"); break;
    case "categories": valid = items(value, (v) => text(v.name, 20) && Array.isArray(v.roomIds) && v.roomIds.length <= 500 && v.roomIds.every(id) && new Set(v.roomIds).size === v.roomIds.length, 50); break;
    case "conversations": valid = object(value) && items(value.conversations, (v) => text(v.title, 60) && text(v.draft, 8000, true) && text(v.createdAt, 40) && text(v.updatedAt, 40) && Number.isFinite(Date.parse(v.createdAt)) && Number.isFinite(Date.parse(v.updatedAt)) && validConversationMessages(v.messages), 100) && (value.activeId === null || value.conversations.some((v: any) => v.id === value.activeId)); break;
    case "transport": {
      if (!object(value) || validateTransportInput(value.input, { draft: true }).length || typeof value.approved !== "boolean") break;
      if ((value.demo !== undefined && typeof value.demo !== "boolean") || (value.survey !== undefined && (value.demo || !isTransportSurvey(value.survey)))) break;
      if (value.result !== null && !isTransportResult(value.result)) break;
      if (value.baseline !== null && value.baseline !== undefined && !isTransportResult(value.baseline)) break;
      if (value.comparison !== undefined && !isTransportComparison(value.comparison)) break;
      if (value.lodgingPlan !== undefined && !isLodgingPlan(value.lodgingPlan)) break;
      if (value.rosterConfirmation !== undefined && !text(value.rosterConfirmation, 65_000)) break;
      valid = !value.approved || !!value.result && validateTransportResult(value.input, value.result).length === 0;
      break;
    }
  }
  if (!valid) throw new ApiError(400, "저장할 자료 형식이나 입력 범위를 확인해 주세요.");
}
