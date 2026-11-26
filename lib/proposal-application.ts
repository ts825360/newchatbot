import { createPreparationStore, type ProposalDraft } from "./preparation-store";
import { createRoomMaterialsStore } from "./room-materials";
import type { CalendarEvent, ChecklistItem } from "./types";
import { privateToolKey, type ConversationScope } from "./conversation-scope";
import { privateCalendarSourceId } from "./chat-calendar";
import { dataStorage } from "./backend-client";
import { readTimetable } from "./timetable";
import { mergeChatTimetable } from "./chat-timetable-proposal";
import { writeBrowserRecord } from "./storage-status";

const checklistKey = (title: string) => title.normalize("NFKC").replace(/\s+/g, "");

export function applyReviewedProposal(storage: Pick<Storage, "getItem" | "setItem">, room: { id: string; location?: string }, nickname: string, draft: ProposalDraft, seeds: { events?: CalendarEvent[]; checklist?: ChecklistItem[] } = {}, scope?: ConversationScope): { ok: boolean; applied?: ProposalDraft; recovered?: boolean; error?: string } {
  try {
    if (scope && scope.roomId !== room.id) return { ok: false, error: "다른 행사방의 제안은 현재 행사방에 반영할 수 없습니다." };
    const id = scope && draft.kind === "calendar" ? privateCalendarSourceId("proposal", scope.accountId, scope.conversationId, draft.id) : `proposal:${draft.id}`;
    if (draft.kind === "timetable") {
      if (!scope || !draft.timetable) return { ok: false, error: "이 행사방의 타임테이블 초안을 확인해 주세요." };
      const target = dataStorage(storage), key = privateToolKey(scope, "timetable");
      const { plan, recovered } = mergeChatTimetable(readTimetable(target.getItem(key)), draft.timetable, draft.id);
      if (!recovered) {
        writeBrowserRecord(target, key, plan, "browser");
        if (typeof window !== "undefined") window.dispatchEvent(new StorageEvent("storage", { key }));
      }
      return { ok: true, recovered, applied: draft };
    } else if (draft.kind === "checklist") {
      const materials = createRoomMaterialsStore(storage, room.id, seeds.checklist, scope);
      if (draft.checklistItems) {
        const selected = draft.checklistItems.map(item => ({ ...item, title: item.title.trim() }));
        if (!scope || !selected.length || selected.length > 8 || selected.some(item => !item.title || item.title.length > 120)
          || new Set(selected.map(item => item.id)).size !== selected.length) return { ok: false, error: "반영할 체크리스트 항목을 확인해 주세요." };
        const previous = materials.loadChecklist();
        const names = new Set(previous.map(item => checklistKey(item.title)));
        const ids = new Set(previous.map(item => item.id));
        const additions = selected.flatMap<ChecklistItem>(item => {
          const key = checklistKey(item.title);
          if (ids.has(item.id) || names.has(key)) return [];
          names.add(key);
          return [{ id: item.id, title: item.title, status: "needsReview", due: "", owner: "", memo: "준비 점검 제안에서 추가" }];
        });
        if (additions.length) materials.updateChecklist(items => [...items, ...additions]);
        return { ok: true, recovered: !additions.length, applied: { ...draft, checklistItems: selected } };
      }
      const existing = materials.loadChecklist().find(item => item.id === id);
      if (existing) return { ok: true, recovered: true, applied: { ...draft, title: existing.title, date: existing.due } };
      materials.updateChecklist(items => [...items, { id, title: draft.title.trim(), status: "needsReview", owner: "", due: "", memo: `${draft.origin ? "대화 제안 반영" : "샘플 제안 반영"} · ${draft.sourceTitle}: ${draft.excerpt}` }]);
    } else {
      const preparation = createPreparationStore(storage, room.id, seeds.events);
      const existing = preparation.loadEvents().find(item => item.id === id);
      if (existing) return { ok: true, recovered: true, applied: { ...draft, title: existing.title, date: existing.date, ...(draft.time !== undefined && { time: existing.time }) } };
      preparation.saveEvent({ id, title: draft.title.trim(), date: draft.date, time: draft.time ?? "", endTime: "", location: scope ? "" : room.location || "", memo: scope ? "" : `샘플 제안 반영 · ${draft.sourceTitle}: ${draft.excerpt}`, status: "confirmed", author: nickname, lastEditor: nickname, changeLog: "검토 후 일정을 캘린더에 추가했습니다." });
    }
    return { ok: true, applied: { ...draft, title: draft.title.trim() } };
  } catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : "항목을 저장하지 못했습니다." }; }
}
