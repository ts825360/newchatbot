import { describe, expect, it } from "vitest";
import { sampleInviteKeys } from "../lib/mock-data";

import {
  confirmCalendarEvent,
  createInitialState,
  createInviteKey,
  handleAdminCommand,
  leaveRoom,
  selectRoom,
  sendChatMessage,
  toggleChecklistItem,
  toggleRoomPin,
  validateInviteKey
} from "../lib/prototype-state";

describe("church event assistant prototype state", () => {
  it("accepts the church invite key and exposes assigned role and room", () => {
    const state = createInitialState();
    const result = validateInviteKey(sampleInviteKeys.member, state.inviteKeys);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.profile.role).toBe("수련회 보조 관리자");
    expect(result.profile.roomIds).toContain("summer-retreat-2026");
  });

  it("rejects an unknown invite key with a Korean error message", () => {
    const state = createInitialState();
    const result = validateInviteKey("잘못된키", state.inviteKeys);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Unexpected valid invitation");
    expect(result.error).toBe("유효하지 않은 초대키입니다.");
  });

  it("clears unread room changes when a room is selected", () => {
    const state = createInitialState();
    const next = selectRoom(state, "summer-retreat-2026");

    expect(next.activeRoomId).toBe("summer-retreat-2026");
    expect(next.rooms.find((room) => room.id === "summer-retreat-2026")?.unreadChanges).toBe(0);
  });

  it("pins and unpins an event room", () => {
    const state = createInitialState();
    const pinned = toggleRoomPin(state, "christmas-2026");
    const unpinned = toggleRoomPin(pinned, "christmas-2026");

    expect(pinned.rooms.find((room) => room.id === "christmas-2026")?.pinned).toBe(true);
    expect(unpinned.rooms.find((room) => room.id === "christmas-2026")?.pinned).toBe(false);
  });

  it("removes access to a room when the user leaves it", () => {
    const state = createInitialState();
    const next = leaveRoom(state, "new-family-welcome");

    expect(next.rooms.some((room) => room.id === "new-family-welcome")).toBe(false);
    expect(next.activeRoomId).not.toBe("new-family-welcome");
  });

  it("adds a private user message and a mock assistant response", () => {
    const state = createInitialState();
    const next = sendChatMessage(state, "회의 없이 할 수 있는 일을 알려줘");
    const activeMessages = next.chatByRoom[next.activeRoomId];

    expect(activeMessages.at(-2)?.sender).toBe("user");
    expect(activeMessages.at(-1)?.sender).toBe("assistant");
    expect(activeMessages.at(-1)?.text).toContain("회의 없이");
  });

  it("allows admin mode only when the profile has the admin permission", () => {
    const state = createInitialState();
    const denied = handleAdminCommand(state, "/admin");
    const allowed = handleAdminCommand(
      {
        ...state,
        profile: {
          ...state.profile,
          permissions: [...state.profile.permissions, "admin"]
        }
      },
      "/admin"
    );

    expect(denied.canOpenAdmin).toBe(false);
    expect(denied.message).toBe("관리자 권한이 없습니다.");
    expect(allowed.canOpenAdmin).toBe(true);
  });

  it("cycles checklist status toward completion", () => {
    const state = createInitialState();
    const itemId = state.checklists["summer-retreat-2026"][0].id;
    const next = toggleChecklistItem(state, itemId);

    expect(next.checklists["summer-retreat-2026"][0].status).toBe("done");
  });

  it("confirms an AI candidate calendar event", () => {
    const state = createInitialState();
    const candidate = state.events["summer-retreat-2026"].find((event) => event.status === "candidate");
    const next = confirmCalendarEvent(state, candidate!.id);

    expect(next.events["summer-retreat-2026"].find((event) => event.id === candidate!.id)?.status).toBe("confirmed");
  });

  it("creates a configured invite key result", () => {
    const result = createInviteKey({
      label: "차량 담당 초대",
      key: "차량-2026",
      roomId: "summer-retreat-2026",
      role: "차량 담당자",
      permissions: ["viewRoom", "chat", "viewCalendar", "editChecklist"],
      maxUses: 2,
      expiresAt: "2026-08-10",
      memo: "차량 수요 조사 담당"
    });

    expect(result.key).toBe("차량-2026");
    expect(result.role).toBe("차량 담당자");
    expect(result.permissions).toContain("editChecklist");
  });
});
