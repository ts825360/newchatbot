import type { DatabaseSync } from "node:sqlite";
import { defaultAssistantPreferences, isAssistantPreferences, maxAssistantInstructionsLength, normalizeStoredAssistantPreferences, type AssistantPreferences } from "../assistant-preferences";
import { requirePermission, requireUser } from "./auth";
import { getDatabase } from "./database";
import { ApiError, errorResponse, json, readJson } from "./http";

const key = (accountId: string) => `assistant-preferences:${accountId}`;
const kind = "assistant-preferences";

export function loadAssistantPreferences(db: DatabaseSync, accountId: string): AssistantPreferences {
  const row = db.prepare("SELECT data_json FROM records WHERE key=? AND owner_id=? AND kind=?").get(key(accountId), accountId, kind);
  if (!row) return defaultAssistantPreferences;
  const value: unknown = JSON.parse(String(row.data_json));
  return normalizeStoredAssistantPreferences(value);
}

export async function handleAssistantPreferences(request: Request, db = getDatabase()): Promise<Response> {
  try {
    if (request.method !== "GET" && request.method !== "PUT") return json({ error: "지원하지 않는 설정 요청입니다." }, 405);
    const actor = requireUser(request, db);
    requirePermission(actor, "chat");
    if (request.method === "GET") return json(loadAssistantPreferences(db, actor.id));
    const value = await readJson(request, 8192);
    if (!isAssistantPreferences(value)) throw new ApiError(400, `답변 스타일과 개인 지침(${maxAssistantInstructionsLength}자 이내)을 확인해 주세요.`);
    const current = requireUser(request, db);
    if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion) throw new ApiError(401, "다시 로그인해 주세요.");
    requirePermission(current, "chat");
    db.prepare(`INSERT INTO records(key,owner_id,kind,data_json,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,revision=revision+1,updated_at=excluded.updated_at`)
      .run(key(current.id), current.id, kind, JSON.stringify(value), new Date().toISOString());
    return json(value);
  } catch (cause) {
    return errorResponse(cause);
  }
}

export function assistantStyleInstruction({ tone, length, emoji }: AssistantPreferences): string {
  const toneRule = {
    standard: "",
    friendly: "친근하되 존댓말을 사용하고, 부담 없는 표현으로 답하세요.",
    direct: "인사나 부연보다 할 일과 결론을 먼저 직접적으로 말하세요.",
  }[tone];
  const lengthRule = {
    brief: "간결하게 답하고 필요한 핵심과 확인 질문은 생략하지 마세요.",
    balanced: "",
    detailed: "필요한 경우 근거와 단계, 확인할 조건을 나누어 자세하게 설명하세요.",
  }[length];
  const emojiRule = emoji === "off"
    ? "답변에 장식용 이모지나 문자 이모티콘을 사용하지 마세요."
    : "자연스러운 일상 대화에서만 가끔 이모지를 사용하고, 공식 안내나 안전 안내에서는 사용하지 마세요.";
  return [toneRule, lengthRule, emojiRule, "이 설정은 답변 표현에만 적용합니다. 확인되지 않은 사실을 채우거나 실행하지 않은 일을 완료했다고 말하지 마세요."].filter(Boolean).join(" ");
}

const emojiSequence = new RegExp("\\p{RGI_Emoji}( ?)", "gv");

export function formatAssistantReply(reply: string, emoji: AssistantPreferences["emoji"]): string {
  if (emoji !== "off") return reply;
  // Preserve the number or symbol underlying a keycap emoji.
  const plain = reply.replace(emojiSequence, (sequence: string, space: string) => /^[#*0-9]/.test(sequence) ? sequence[0] + space : "").trim();
  if (!plain) throw new ApiError(502, "표시할 수 있는 답변을 받지 못했습니다. 다시 요청해 주세요.");
  return plain;
}
