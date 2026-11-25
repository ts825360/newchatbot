import { beforeEach, expect, it } from "vitest";
import { applyReviewedProposal } from "../lib/proposal-application";
import { createPreparationStore, sampleProposals } from "../lib/preparation-store";
import { createRoomMaterialsStore } from "../lib/room-materials";
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
