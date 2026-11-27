import { roomDateLabel, validDate } from "./room-timing";
import type { ChecklistItem, EventRoom } from "./types";

export function buildChecklistChatDraft(item: ChecklistItem, room: Pick<EventRoom, "date" | "endDate">) {
  const title = item.title.replace(/\s+/g, " ").trim();
  if (!title) return "";
  const task = `현재 행사의 준비 업무 「${title}」`;
  const period = room.date && validDate(room.date) ? ` 행사 기간은 ${roomDateLabel(room.date, room.endDate)}입니다.` : "";
  const due = item.due && validDate(item.due) ? ` 마감일은 ${item.due}입니다.` : "";
  const goal: Record<ChecklistItem["status"], string> = {
    needsReview: `${task}에 필요한 기존 기록을 확인하고, 지금 작성할 수 있는 초안이나 실행안을 준비해 줘.`,
    inProgress: `${task}를 이어서 진행해 줘. 확인된 작업은 유지하고 다음 단계에 필요한 결과물을 준비해 줘.`,
    risk: `${task}에서 행사 진행을 막는 요인과 선행 작업을 확인해 줘. 마감에 맞출 대응안과 우선순위를 제안해 줘.`,
    done: `${task}는 완료로 기록돼 있어. 이어지는 업무나 재확인이 필요한 부분이 있는지 검토해 줘.`,
  };
  return `${goal[item.status]}${period}${due} 확인이 꼭 필요한 내용만 따로 알려줘.`;
}
