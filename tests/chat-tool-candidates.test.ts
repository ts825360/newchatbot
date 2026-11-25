import { describe, expect, it } from "vitest";
import { buildChatChecklist, chatProposalCandidates, mergeChatRoster, parseChatRoster } from "@/lib/chat-tool-candidates";
import { createTransportDraft } from "@/lib/transport";

const scope = { accountId: "one", roomId: "room", conversationId: "talk" };

describe("chat tool candidates", () => {
  it("opens a stable checklist draft without inferring a relative deadline", () => {
    const text = "준비 항목: 안내문 작성\n담당자: 안내팀\n마감: 내일";
    const draft = buildChatChecklist(scope, { id: "message", text });
    expect(draft).toMatchObject({ title: "안내문 작성", owner: "안내팀", due: "", status: "needsReview" });
    expect(buildChatChecklist(scope, { id: "message", text: text.replace("내일", "2028-02-29") })).toMatchObject({ id: draft.id, due: "2028-02-29" });
  });

  it("takes marked proposals only from server assistant replies and rejects incomplete calendar dates", () => {
    const text = "[준비 제안] 차량 확인\n[일정 제안] 다음 주 | 집합\n[일정 제안] 2027-05-03 | 집합";
    const candidates = chatProposalCandidates([
      { id: "user", sender: "user", time: "", text: "[준비 제안] 이 줄은 사용자 원문이며 미반영\n집합 날짜: 2027-05-03" }, { id: `gemini-${"a".repeat(64)}`, sender: "assistant", time: "", text },
    ]);
    expect(candidates.map(item => [item.kind, item.title, item.date])).toEqual([["checklist", "차량 확인", ""], ["calendar", "집합", "2027-05-03"]]);
    expect(candidates.every(item => text.includes(item.excerpt))).toBe(true);
    expect(chatProposalCandidates([{ id: `gemini-${"a".repeat(64)}`, sender: "assistant", time: "", text }]).map(item => item.kind)).toEqual(["checklist"]);
  });

  it("keeps an existing roster and saved source IDs, and leaves missing travel data unresolved", () => {
    const input = createTransportDraft();
    const rows = parseChatRoster("이름,소속,출발 팀\n가상 참가자,청년부,본대\n가상 참가자2,,");
    const first = mergeChatRoster(input, scope, "msg", rows);
    expect(first.people[0]).toMatchObject({ name: "가상 참가자", department: "청년부", outboundTripId: "main", returnEntry: "미정" });
    expect(first.people[1]).toMatchObject({ department: "미분류", outboundEntry: "미정" });
    expect(mergeChatRoster(first, scope, "msg", rows)).toBe(first);
    expect(mergeChatRoster(first, scope, "another", parseChatRoster("별도 참가자")).people).toHaveLength(3);
    expect(() => parseChatRoster("이름,알수없는열\n나,가")).toThrow();
    expect(() => parseChatRoster("이름,소속\n" + "가상 참가자,청년부\n".repeat(501))).toThrow();
  });
});
