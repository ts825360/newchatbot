import { createPreparationStore, type ProposalDraft } from "./preparation-store";
import { createRoomMaterialsStore } from "./room-materials";
import type { CalendarEvent, ChecklistItem } from "./types";
import type { ConversationScope } from "./conversation-scope";
import { privateCalendarSourceId } from "./chat-calendar";

export function applyReviewedProposal(storage: Pick<Storage, "getItem" | "setItem">, room: { id: string; location?: string }, nickname: string, draft: ProposalDraft, seeds: { events?: CalendarEvent[]; checklist?: ChecklistItem[] } = {}, scope?: ConversationScope): { ok: boolean; applied?: ProposalDraft; recovered?: boolean; error?: string } {
  try {
    const id = scope && draft.kind === "calendar" ? privateCalendarSourceId("proposal", scope.accountId, scope.conversationId, draft.id) : `proposal:${draft.id}`;
    if (draft.kind === "checklist") {
      const materials = createRoomMaterialsStore(storage, room.id, seeds.checklist, scope);
      const existing = materials.loadChecklist().find(item => item.id === id);
      if (existing) return { ok: true, recovered: true, applied: { ...draft, title: existing.title, date: existing.due } };
      materials.updateChecklist(items => [...items, { id, title: draft.title.trim(), status: "needsReview", owner: "", due: "", memo: `${draft.origin ? "대화 제안 반영" : "샘플 제안 반영"} · ${draft.sourceTitle}: ${draft.excerpt}` }]);
    } else {
      const preparation = createPreparationStore(storage, room.id, seeds.events);
      const existing = preparation.loadEvents().find(item => item.id === id);
      if (existing) return { ok: true, recovered: true, applied: { ...draft, title: existing.title, date: existing.date } };
      preparation.saveEvent({ id, title: draft.title.trim(), date: draft.date, time: "", endTime: "", location: scope ? "" : room.location || "", memo: scope ? "" : `샘플 제안 반영 · ${draft.sourceTitle}: ${draft.excerpt}`, status: "confirmed", author: nickname, lastEditor: nickname, changeLog: "검토 후 일정을 캘린더에 추가했습니다." });
    }
    return { ok: true, applied: { ...draft, title: draft.title.trim() } };
  } catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : "항목을 저장하지 못했습니다." }; }
}
