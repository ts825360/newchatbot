import {
  defaultProfile,
  prototypeChats,
  prototypeChecklists,
  prototypeEvents,
  prototypeInviteKeys,
  prototypeRisks,
  prototypeRooms
} from "./mock-data";
import type {
  AdminCommandResult,
  CalendarEvent,
  ChecklistItem,
  ChecklistStatus,
  EventRoom,
  InviteKey,
  InviteKeyDraft,
  InviteValidationResult,
  PrototypeState
} from "./types";

const cloneRooms = (rooms: EventRoom[]) => rooms.map((room) => ({ ...room }));
const cloneEvents = (events: Record<string, CalendarEvent[]>) =>
  Object.fromEntries(Object.entries(events).map(([roomId, items]) => [roomId, items.map((item) => ({ ...item }))]));
const cloneChecklist = (checklists: Record<string, ChecklistItem[]>) =>
  Object.fromEntries(Object.entries(checklists).map(([roomId, items]) => [roomId, items.map((item) => ({ ...item }))]));

export function createInitialState(): PrototypeState {
  return {
    profile: { ...defaultProfile, roomIds: [...defaultProfile.roomIds], permissions: [...defaultProfile.permissions] },
    activeRoomId: "summer-retreat-2026",
    rooms: cloneRooms(prototypeRooms),
    inviteKeys: prototypeInviteKeys.map((key) => ({ ...key, permissions: [...key.permissions] })),
    chatByRoom: Object.fromEntries(
      Object.entries(prototypeChats).map(([roomId, messages]) => [
        roomId,
        messages.map((message) => ({ ...message, actions: message.actions ? [...message.actions] : undefined }))
      ])
    ),
    events: cloneEvents(prototypeEvents),
    checklists: cloneChecklist(prototypeChecklists),
    risks: Object.fromEntries(
      Object.entries(prototypeRisks).map(([roomId, risks]) => [roomId, risks.map((risk) => ({ ...risk }))])
    )
  };
}

export function validateInviteKey(input: string, keys: InviteKey[]): InviteValidationResult {
  const normalized = input.trim();
  const invite = keys.find((key) => key.active && key.key === normalized && key.usedCount < key.maxUses);

  if (!invite) {
    return {
      ok: false,
      error: "유효하지 않은 초대키입니다."
    };
  }

  return {
    ok: true,
    invite,
    profile: {
      nickname: "",
      role: invite.role,
      roomIds: invite.id === "invite-default" ? [...defaultProfile.roomIds] : [invite.roomId],
      permissions: [...invite.permissions]
    }
  };
}

export function selectRoom(state: PrototypeState, roomId: string): PrototypeState {
  return {
    ...state,
    activeRoomId: roomId,
    rooms: state.rooms.map((room) => (room.id === roomId ? { ...room, unreadChanges: 0 } : room))
  };
}

export function toggleRoomPin(state: PrototypeState, roomId: string): PrototypeState {
  return {
    ...state,
    rooms: state.rooms.map((room) => (room.id === roomId ? { ...room, pinned: !room.pinned } : room))
  };
}

export function leaveRoom(state: PrototypeState, roomId: string): PrototypeState {
  const remainingRooms = state.rooms.filter((room) => room.id !== roomId);
  const nextActive = state.activeRoomId === roomId ? remainingRooms[0]?.id ?? "" : state.activeRoomId;

  return {
    ...state,
    activeRoomId: nextActive,
    rooms: remainingRooms,
    profile: {
      ...state.profile,
      roomIds: state.profile.roomIds.filter((id) => id !== roomId)
    }
  };
}

export function sendChatMessage(state: PrototypeState, text: string): PrototypeState {
  const trimmed = text.trim();
  if (!trimmed) {
    return state;
  }

  const roomId = state.activeRoomId;
  const existing = state.chatByRoom[roomId] ?? [];
  const sequence = existing.length + 1;
  const userMessage = {
    id: `${roomId}-user-${sequence}`,
    sender: "user" as const,
    text: trimmed,
    time: "방금 전"
  };
  const assistantMessage = {
    id: `${roomId}-assistant-${sequence}`,
    sender: "assistant" as const,
    text: createAssistantReply(trimmed),
    time: "방금 전",
    actions: ["체크리스트에 추가", "캘린더 후보로 추가", "문서 초안 만들기"]
  };

  return {
    ...state,
    chatByRoom: {
      ...state.chatByRoom,
      [roomId]: [...existing, userMessage, assistantMessage]
    }
  };
}

export function handleAdminCommand(state: PrototypeState, text: string): AdminCommandResult {
  if (text.trim() !== "/admin") {
    return {
      canOpenAdmin: false,
      message: "관리자 명령어가 아닙니다."
    };
  }

  const canOpenAdmin = state.profile.permissions.includes("admin");
  return {
    canOpenAdmin,
    message: canOpenAdmin ? "관리자 모드로 전환합니다." : "관리자 권한이 없습니다."
  };
}

export function toggleChecklistItem(state: PrototypeState, itemId: string): PrototypeState {
  const roomId = state.activeRoomId;
  const items = state.checklists[roomId] ?? [];

  return {
    ...state,
    checklists: {
      ...state.checklists,
      [roomId]: items.map((item) => (item.id === itemId ? { ...item, status: nextChecklistStatus(item.status) } : item))
    }
  };
}

export function confirmCalendarEvent(state: PrototypeState, eventId: string): PrototypeState {
  const roomId = state.activeRoomId;
  const events = state.events[roomId] ?? [];

  return {
    ...state,
    events: {
      ...state.events,
      [roomId]: events.map((event) =>
        event.id === eventId
          ? {
              ...event,
              status: "confirmed",
              lastEditor: state.profile.nickname || "체험 사용자",
              changeLog: `${state.profile.nickname || "체험 사용자"}님이 AI 후보 일정을 확정했습니다.`
            }
          : event
      )
    }
  };
}

export function createInviteKey(input: InviteKeyDraft): InviteKey {
  return {
    ...input,
    id: `invite-${input.key.replace(/\s+/g, "-")}`,
    usedCount: 0,
    active: true
  };
}

function nextChecklistStatus(status: ChecklistStatus): ChecklistStatus {
  if (status === "inProgress") {
    return "done";
  }
  if (status === "done") {
    return "needsReview";
  }
  return "inProgress";
}

export function createAssistantReply(text: string): string {
  if (text.includes("회의 없이")) {
    return "회의 없이 진행 가능한 일부터 정리하면 좋겠습니다. 지금은 참석자 조사 양식 만들기, 작년 수련회 체크리스트 확인, 차량 수요 조사 문구 작성이 가능합니다.";
  }

  if (text.includes("회의록") || text.includes("날짜")) {
    return "회의록에서 일정 후보 2건과 확인 필요 항목 3건을 찾았습니다. 후보는 바로 확정하지 않고 오른쪽 패널에 확인 필요 상태로 추가할 수 있습니다.";
  }

  if (text.includes("빠진") || text.includes("누락")) {
    return "현재 누락 위험은 차량 배정, 방 배정, 물놀이 안전 담당입니다. 각 항목은 담당자와 마감일을 먼저 지정하는 것이 좋습니다.";
  }

  return "입력한 내용을 기준으로 행사 준비 상태를 점검했습니다. 오른쪽 공동 패널에서 확정 일정, 체크리스트, 누락 위험을 함께 확인해 주세요.";
}
