import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hasObviousPrivateData } from "../assistant-privacy";
import { defaultSurveyItems, isSurveyDraft, isSurveyWorkId, isSurveyWorkVersion, surveyDraftOutline, surveyTemplateVersion, type SurveyDraft, type SurveyDraftItem } from "../chat-survey-draft";
import type { ConversationScope } from "../conversation-scope";
import type { ChatMessage } from "../types";
import type { ChatTool } from "./chat-openai";
import { requireOwnedConversation } from "./conversation-scope";
import { ApiError } from "./http";
import { object } from "./record-schema";

const scoped = (s: ConversationScope) => [s.accountId, s.roomId, s.conversationId] as const;
const where = "owner_id=? AND room_id=? AND conversation_id=?";
const unavailable = () => new ApiError(404, "이 대화에서 설문 초안을 찾을 수 없습니다.");
const stale = () => new ApiError(409, "설문 초안이 변경되었습니다. 최신 버전을 확인해 주세요.");
const invalid = () => new ApiError(422, "설문 수정 조건을 확인해 주세요. 참석 여부와 이름 문항은 유지해야 합니다.");
const toolError = () => new ApiError(502, "AI의 작업 도구 입력을 확인하지 못했습니다. 다시 요청해 주세요.");
const result = (s: SurveyDraft | null) => JSON.stringify(s ? { found: true, ...surveyDraftOutline(s) } : { found: false, kind: "survey" });

function findLatest(db: DatabaseSync, scope: ConversationScope, workId: string) {
  const row = db.prepare(`SELECT data_json FROM chat_work_versions WHERE ${where} AND work_id=? AND kind='survey' ORDER BY version DESC LIMIT 1`).get(...scoped(scope), workId);
  if (!row) return null;
  const draft: unknown = JSON.parse(String(row.data_json));
  if (!isSurveyDraft(draft)) throw new ApiError(500, "저장된 설문 버전을 읽을 수 없습니다.");
  return draft;
}

function latest(db: DatabaseSync, scope: ConversationScope, workId: string) {
  const draft = findLatest(db, scope, workId);
  if (!draft) throw unavailable();
  return draft;
}

export function requireSurveyWorkVersion(db: DatabaseSync, scope: ConversationScope, workId: unknown, version: unknown) {
  if (!isSurveyWorkId(workId) || !isSurveyWorkVersion(version)) throw new ApiError(400, "설문 초안 버전을 확인해 주세요.");
  requireOwnedConversation(db, scope);
  const draft = latest(db, scope, workId);
  if (draft.version !== version) throw stale();
  return draft;
}

export function readSurveyWorkVersion(db: DatabaseSync, scope: ConversationScope, workId: unknown, version: unknown) {
  if (!isSurveyWorkId(workId) || !isSurveyWorkVersion(version)) throw new ApiError(400, "설문 초안 버전을 확인해 주세요.");
  requireOwnedConversation(db, scope);
  const row = db.prepare(`SELECT data_json FROM chat_work_versions WHERE ${where} AND work_id=? AND version=? AND kind='survey'`).get(...scoped(scope), workId, version);
  if (!row) throw unavailable();
  const draft: unknown = JSON.parse(String(row.data_json));
  if (!isSurveyDraft(draft) || draft.id !== workId || draft.version !== version) throw new ApiError(500, "저장된 설문 버전을 읽을 수 없습니다.");
  return draft;
}

function newSurvey(db: DatabaseSync, scope: ConversationScope): SurveyDraft {
  const row = db.prepare("SELECT data_json FROM rooms WHERE id=?").get(scope.roomId);
  if (!row) throw unavailable();
  const value: unknown = JSON.parse(String(row.data_json));
  const name = object(value) && typeof value.name === "string" ? value.name.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").trim().slice(0, 80) : "";
  return { id: randomUUID(), version: 1, template: "retreat", templateVersion: surveyTemplateVersion,
    title: `${name && name.isWellFormed() && !hasObviousPrivateData(name) ? name : "행사"} 참가 설문`, description: "", items: defaultSurveyItems() };
}

function applySurveyPatch(draft: SurveyDraft, args: Record<string, unknown>): SurveyDraft {
  const { operation, number, title, required, options, other } = args;
  if (!Number.isSafeInteger(number) || Number(number) < 1 || operation !== "remove" && operation !== "update" && operation !== "add"
    || !(title === null || typeof title === "string") || !(required === null || typeof required === "boolean")
    || !(options === null || Array.isArray(options) && options.every(option => typeof option === "string")) || !(other === null || typeof other === "boolean")) throw toolError();
  const questions = draft.items.filter(item => item.kind !== "section");
  const target = questions[Number(number) - 1];
  const choices = (values: string[], freeEntry: boolean) => [...values.map(value => ({ value: value.trim() })), ...(freeEntry ? [{ value: "기타", isOther: true as const }] : [])];
  let items: SurveyDraftItem[];
  if (operation === "add") {
    if (!title || Number(number) < 3 || Number(number) > questions.length + 1) throw invalid();
    const base = { id: randomUUID(), title: title.trim(), required: required ?? false };
    const item: SurveyDraftItem = options === null && !other ? { ...base, kind: "text", paragraph: false }
      : { ...base, kind: "choice", options: choices(options ?? [], other ?? false) };
    const index = target ? draft.items.indexOf(target) : draft.items.length;
    items = [...draft.items.slice(0, index), item, ...draft.items.slice(index)];
  } else {
    if (!target || target.id === "attendance" || target.id === "name") throw invalid();
    items = operation === "remove" ? draft.items.filter(item => item.id !== target.id) : draft.items.map(item => {
      if (item.id !== target.id || item.kind === "section") return item;
      const changed = { ...item, ...(title !== null && { title: title.trim() }), ...(required !== null && { required }) };
      if (changed.kind === "choice") return options !== null || other !== null ? { ...changed,
        options: choices(options ?? changed.options.filter(option => !option.isOther).map(option => option.value), other ?? changed.options.some(option => option.isOther)) } : changed;
      if (options !== null || other !== null) throw invalid();
      return changed;
    });
  }
  const next = { ...draft, version: draft.version + 1, items };
  if (!isSurveyDraft(next)) throw invalid();
  return next;
}

export function createWorkSession(db: DatabaseSync, scope: ConversationScope, messages: readonly ChatMessage[], user: ChatMessage, recheck: () => void) {
  let write: SurveyDraft | undefined;
  let displayed: SurveyDraft | undefined;
  let readVersion: SurveyDraft | undefined;
  let operation: "create" | "show" | "regenerate" | "edit" | undefined;
  const refIndex = user.reference?.kind === "reply" ? messages.findIndex(item => item.id === user.reference?.messageId) : -1;
  const anchor = refIndex >= 0 ? messages[refIndex + (messages[refIndex].sender === "user" ? 1 : 0)]
    : messages.findLast(item => item.sender === "assistant" && (item.workProposal || item.nearbyTask));
  const previousSurvey = anchor?.workProposal?.kind === "survey" ? anchor.workProposal : undefined;
  let legacy: SurveyDraft | undefined;
  const assertQuotedVersion = (draft: SurveyDraft) => {
    if (refIndex >= 0 && (previousSurvey?.draft?.version ?? 1) !== draft.version) throw stale();
  };
  const selected = () => {
    if (previousSurvey?.draft) return latest(db, scope, previousSurvey.draft.id);
    if (!previousSurvey || !anchor) return null;
    // Title-only cards had no stored items; adopt the same default preview on first use.
    if (!legacy) {
      const hash = createHash("sha256").update(JSON.stringify([...scoped(scope), anchor.id])).digest("hex");
      legacy = { ...newSurvey(db, scope), id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`, title: previousSurvey.title };
    }
    return findLatest(db, scope, legacy.id) ?? legacy;
  };
  const stage = (draft: SurveyDraft, action: NonNullable<typeof operation>) => {
    if (write || !isSurveyDraft(draft)) throw invalid();
    write = displayed = draft;
    operation = action;
    return result(draft);
  };
  const tool = (name: string, description: string, properties: Record<string, object>, run: (args: Record<string, unknown>) => string): ChatTool => ({
    definition: { type: "function", name, description, strict: true, parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } },
    run(args) {
      recheck();
      if (!object(args) || Object.keys(args).length !== Object.keys(properties).length || Object.keys(args).some(key => !Object.hasOwn(properties, key))) throw toolError();
      return run(args);
    },
  });
  const create = () => stage(newSurvey(db, scope), "create");
  const tools: ChatTool[] = [
    tool("create_survey_draft", "현재 행사의 기본 참가 신청·참석 조사 양식 복사본을 새로 만듭니다. 참가 신청, 참석 여부 수집 의도를 표현에 상관없이 판단하세요. 새 작업일 때만 호출합니다. Google에 생성하거나 게시하지 않습니다.", {}, () => create()),
    tool("get_work_draft", "현재 대화에서 답장한 초안 또는 직전 작업을 조회합니다. 문항 번호 확인은 read, 기존안 재표시는 show, 기존 조건 그대로 새 검토 버전을 만드는 재생성은 regenerate를 사용합니다.",
      { mode: { type: "string", enum: ["read", "show", "regenerate"] } }, ({ mode }) => {
        if (mode !== "read" && mode !== "show" && mode !== "regenerate") throw toolError();
        const current = selected();
        if (!current) return result(null);
        readVersion = current;
        if (mode === "regenerate") {
          assertQuotedVersion(current);
          return stage({ ...current, version: current.version + 1 }, "regenerate");
        }
        if (mode === "show" && !write) {
          if (legacy === current) return stage(current, "show");
          displayed = current; operation = "show";
        }
        return result(current);
      }),
    tool("update_survey_draft", "get_work_draft의 버전과 문항 번호로 한 문항을 부분 수정합니다. null인 필드는 보존하고 add는 해당 번호 앞에 삽입합니다. 기타 직접입력은 other로만 지정합니다. 삭제 시 다른 필드는 null로 둡니다.", {
      version: { type: "integer" }, operation: { type: "string", enum: ["update", "remove", "add"] }, number: { type: "integer" },
      title: { type: ["string", "null"] }, required: { type: ["boolean", "null"] },
      options: { type: ["array", "null"], items: { type: "string" } }, other: { type: ["boolean", "null"] },
    }, args => {
      if (!readVersion) throw invalid();
      assertQuotedVersion(readVersion);
      if (args.version !== readVersion.version || selected()?.version !== args.version) throw stale();
      return stage(applySurveyPatch(readVersion, args), "edit");
    }),
  ];
  return {
    tools,
    hasPrevious: Boolean(previousSurvey),
    createLocal: create,
    pending: () => displayed && operation ? { draft: displayed, operation } : undefined,
    commit(sourceMessageId: string) {
      if (!displayed) return;
      if (!write) { if (latest(db, scope, displayed.id).version !== displayed.version) throw stale(); return; }
      const current = findLatest(db, scope, write.id);
      const save = (draft: SurveyDraft, messageId: string) => db.prepare(`INSERT INTO chat_work_versions(owner_id,room_id,conversation_id,work_id,version,kind,source_message_id,data_json,created_at)
        VALUES(?,?,?,?,?,'survey',?,?,?)`).run(...scoped(scope), draft.id, draft.version, messageId, JSON.stringify(draft), new Date().toISOString());
      if (!current && legacy?.id === write.id && write.version === 2 && anchor && isSurveyDraft(legacy)) save(legacy, anchor.id);
      else if ((current?.version ?? 0) + 1 !== write.version) throw stale();
      save(write, sourceMessageId);
    },
  };
}
