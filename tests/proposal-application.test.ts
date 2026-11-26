import { beforeEach, expect, it } from "vitest";
import { applyReviewedProposal } from "../lib/proposal-application";
import { createPreparationStore, sampleProposals } from "../lib/preparation-store";
import { createRoomMaterialsStore } from "../lib/room-materials";
import { privateToolKey } from "../lib/conversation-scope";
import { readTimetable } from "../lib/timetable";
beforeEach(() => localStorage.clear());
const room = { id: "a", date: "2026-11-16", location: "교회" };
it("recovers a partially saved calendar proposal without replacing the committed values", () => {
  const draft = { ...sampleProposals(room)[1], title: "사용자가 검토한 집합", date: "2026-11-20" };
  const storage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => { if (key.endsWith(":decisions")) throw Error("quota"); localStorage.setItem(key, value); } };
  expect(applyReviewedProposal(storage, room, "담당자", draft).ok).toBe(true);
  expect(() => createPreparationStore(storage, room.id).decide(draft.id, "accepted")).toThrow("저장");
  const retry = applyReviewedProposal(localStorage, room, "담당자", sampleProposals(room)[1]);
  expect(retry).toMatchObject({ ok: true, recovered: true, applied: { title: draft.title, date: draft.date } });
  expect(createPreparationStore(localStorage, room.id).loadEvents()).toMatchObject([{ title: draft.title, date: draft.date }]);
});
it("preserves existing checklist edits during a retry and reports failed writes", () => {
  const draft = sampleProposals(room)[0];
  expect(applyReviewedProposal(localStorage, room, "담당자", draft).ok).toBe(true);
  const materials = createRoomMaterialsStore(localStorage, room.id);
  materials.updateChecklist(items => items.map(item => ({ ...item, title: "수동으로 확인한 차량", status: "done" })));
  expect(applyReviewedProposal(localStorage, room, "담당자", draft)).toMatchObject({ ok: true, recovered: true, applied: { title: "수동으로 확인한 차량" } });
  expect(materials.loadChecklist()).toMatchObject([{ status: "done", title: "수동으로 확인한 차량" }]);
  const blocked = { getItem: () => null, setItem: () => { throw Error("quota"); } };
  expect(applyReviewedProposal(blocked, room, "담당자", draft).ok).toBe(false);
});

const scope = { accountId: "a", roomId: room.id, conversationId: "private" };

it("adds only the selected checklist batch and keeps it private and idempotent", () => {
  const draft = { ...sampleProposals(room)[0], checklistItems: [{ id: "first", title: "미완료 항목" }] };
  expect(applyReviewedProposal(localStorage, room, "담당자", draft, {}, scope).ok).toBe(true);
  expect(applyReviewedProposal(localStorage, room, "담당자", draft, {}, scope)).toMatchObject({ ok: true, recovered: true });
  expect(createRoomMaterialsStore(localStorage, room.id, [], scope).loadChecklist()).toMatchObject([{ title: "미완료 항목", status: "needsReview" }]);
  expect(createRoomMaterialsStore(localStorage, room.id).loadChecklist()).toEqual([]);
});

it("applies a timetable without touching the shared calendar and preserves existing appointments", () => {
  const key = privateToolKey(scope, "timetable");
  const existing = { id: "existing", title: "기존 프로그램", day: 2, start: 540, end: 600, kind: "program" as const };
  localStorage.setItem(key, JSON.stringify({ version: 1, days: 2, startDate: "2026-11-16", entries: [existing] }));
  const draft = { ...sampleProposals(room)[0], kind: "timetable" as const, timetable: { version: 1 as const, days: 2, startDate: "2026-11-16",
    entries: [{ id: "travel", title: "이동", day: 1, start: 630, end: 720, kind: "travel" as const }] } };
  const applied = () => applyReviewedProposal(localStorage, room, "담당자", draft, {}, scope);
  expect(applied().ok).toBe(true);
  expect(applied()).toMatchObject({ ok: true, recovered: true });
  expect(readTimetable(localStorage.getItem(key)).entries).toEqual(expect.arrayContaining([existing, expect.objectContaining({ title: "이동" })]));
  expect(readTimetable(localStorage.getItem(key)).entries).toHaveLength(2);
  expect(createPreparationStore(localStorage, room.id).loadEvents()).toEqual([]);
});

it("keeps the approved calendar time and doesn't copy private proposal memo text", () => {
  const draft = { ...sampleProposals(room)[1], time: "14:30", excerpt: "PRIVATE_SOURCE" };
  expect(applyReviewedProposal(localStorage, room, "담당자", draft, {}, scope).ok).toBe(true);
  expect(createPreparationStore(localStorage, room.id).loadEvents()).toMatchObject([{ time: "14:30", memo: "" }]);
});
