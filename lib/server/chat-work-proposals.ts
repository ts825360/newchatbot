import type { DatabaseSync } from "node:sqlite";
import { hasObviousPrivateData } from "../assistant-privacy";
import { calendarWorkProposal, requestsAnonymousSurvey, type localWorkIntent } from "../chat-work-proposal";
import { buildChatTimetable } from "../chat-timetable-proposal";
import type { ConversationScope } from "../conversation-scope";
import type { ChatMessage } from "../types";
import type { Actor } from "./auth";
import { readParticipantCount } from "./chat-work-reads";
import { ApiError } from "./http";
import { object } from "./record-schema";

export function loadChatWork(db: DatabaseSync, actor: Actor, scope: ConversationScope, intent: NonNullable<ReturnType<typeof localWorkIntent>>, request: string): Pick<ChatMessage, "text" | "workProposal"> {
  if (intent === "headcount") {
    if (!actor.permissions.includes("viewChecklist")) return { text: "이 계정에는 참가 인원 집계를 확인할 권한이 없어요." };
    const count = readParticipantCount(db, actor, scope);
    return { text: count ? `이 행사방의 참가자 명단에 등록된 인원은 ${count.value}명입니다. 등록 인원 기준으로, 실제 참석이 모두 확정됐다는 뜻은 아닙니다.`
      : "현재 접근할 수 있는 참가자 명단에서 등록 인원을 확인하지 못했어요. 아직 0명으로 확정된 것은 아닙니다." };
  }
  if (intent === "calendar") {
    const proposal = calendarWorkProposal(request);
    if (!proposal || hasObviousPrivateData(proposal.title)) return { text: "공동 캘린더 초안을 만들 수 있도록 일정 제목과 날짜를 하나씩 명확히 알려주세요. 시간을 정하지 않았다면 날짜만 주셔도 됩니다." };
    return { text: `공동 캘린더에 추가할 일정 초안을 만들었어요.${proposal.inferredYear ? ` 한국 시각 기준 올해(${proposal.date.slice(0, 4)}년)로 작성했습니다.` : ""}${proposal.time ? "" : " 회의 시간이 지정되지 않아 날짜만 넣었습니다."}`, workProposal: proposal };
  }
  const row = db.prepare("SELECT data_json FROM rooms WHERE id=?").get(scope.roomId);
  const room: unknown = JSON.parse(String(row?.data_json ?? "null"));
  if (!object(room)) throw new ApiError(404, "행사방을 확인할 수 없습니다.");
  if (intent === "timetable") {
    const date = typeof room.date === "string" ? room.date : undefined;
    const endDate = typeof room.endDate === "string" ? room.endDate : undefined;
    const category = typeof room.category === "string" ? room.category : undefined;
    const plan = buildChatTimetable({ date, endDate, category }, request);
    const duration = plan.days === 1 ? "당일" : `${plan.days - 1}박 ${plan.days}일`;
    return { text: `${duration} 타임테이블 초안을 만들었어요. 프로그램과 시각은 검토용이며, 승인하면 이 행사방의 타임테이블에만 반영됩니다. 공동 캘린더는 변경하지 않습니다.`, workProposal: { kind: "timetable", plan } };
  }
  if (requestsAnonymousSurvey(request)) return { text: "기본 참가 설문에는 이름 문항이 있어 익명 요청에는 사용하지 않았어요. 익명 설문 초안은 ‘전체 만족도(1~5점)’, ‘좋았던 점’, ‘개선할 점’으로 구성할 수 있습니다. 현재는 기본 참가 양식만 Google Forms에 생성할 수 있습니다." };
  const name = typeof room.name === "string" ? room.name.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").trim().slice(0, 80) : "";
  const title = `${name && !hasObviousPrivateData(name) ? name : "행사"} 참가 설문`;
  return { text: "기존 참가 설문 양식으로 초안을 준비했어요. 문항을 확인한 뒤 Google Forms에 미게시 초안을 만들고 편집기에서 수정할 수 있습니다.", workProposal: { kind: "survey", title } };
}
