import { createInitialState } from "./prototype-state";
import type { EventRoom, UserProfile } from "./types";
import { validDate, roomDateLabel } from "./room-timing";
import { writeBrowserRecord } from "./storage-status";
import { dataStorage } from "./backend-client";

export const ROOM_CATEGORIES = {
  retreat: "수련회",
  revival: "부흥회",
  sports: "체육대회",
  worship: "예배",
  celebration: "절기 행사",
  other: "기타"
} as const;
export type RoomCategory = keyof typeof ROOM_CATEGORIES;
export type RoomDraft = { name: string; category: RoomCategory; otherDetail?: string; date: string; endDate?: string; location: string; description: string };
export type RoomDraftErrors = Partial<Record<keyof RoomDraft, string>>;
export type LobbyRoom = EventRoom & {
  category: RoomCategory;
  date: string | null;
  endDate: string | null;
  otherDetail: string;
  location: string;
  description: string;
  memberCount: number;
  owner: string;
  ownerId: string;
  createdAt: string;
};
export type RoomCatalog = { rooms: LobbyRoom[]; selectedRoomId: string | null };
export type RoomSort = "recent" | "oldest" | "date" | "name";
type BrowserStorage = Pick<Storage, "getItem" | "setItem">;
const PREFIX = "church-planner-room-catalog-v1:";

export function canManageRooms(profile: UserProfile) {
  return profile.permissions.includes("admin") || profile.permissions.includes("createRoom");
}

export function validateRoomDraft(input: RoomDraft): RoomDraftErrors {
  const errors: RoomDraftErrors = {};
  if (!input.name.trim() || input.name.trim().length > 60) errors.name = "행사방 이름은 1~60자로 입력해 주세요.";
  if (!Object.hasOwn(ROOM_CATEGORIES, input.category)) errors.category = "행사 종류를 선택해 주세요.";
  if (input.category === "other" && (!input.otherDetail?.trim() || input.otherDetail.trim().length > 40)) errors.otherDetail = "기타 행사 설명은 1~40자로 입력해 주세요.";
  if (input.date && !validDate(input.date)) errors.date = "올바른 행사 날짜를 입력해 주세요.";
  if (input.endDate && !input.date) errors.date = "종료일을 지정하려면 시작일도 입력해 주세요.";
  if (input.endDate && !validDate(input.endDate)) errors.endDate = "올바른 종료일을 입력해 주세요.";
  else if (input.date && input.endDate && input.endDate < input.date) errors.endDate = "종료일은 시작일보다 이전일 수 없습니다.";
  if (input.location.trim().length > 100) errors.location = "장소는 100자 이내로 입력해 주세요.";
  if (input.description.trim().length > 300) errors.description = "메모는 300자 이내로 입력해 주세요.";
  return errors;
}

function seedRooms(profile: UserProfile): LobbyRoom[] {
  const categories: Record<string, RoomCategory> = {
    "summer-retreat-2026": "retreat", "christmas-2026": "celebration",
    "easter-2027": "worship", "outdoor-worship-2026": "worship", "new-family-welcome": "other"
  };
  return createInitialState().rooms.filter((room) => profile.roomIds.includes(room.id)).map((room, index) => ({
    ...room,
    pinned: false,
    category: categories[room.id] ?? "other",
    date: room.status === "needsDate" ? null : room.dateLabel.replaceAll(".", "-"),
    dateLabel: room.status === "needsDate" ? "날짜 미정" : room.dateLabel,
    endDate: room.status === "needsDate" ? null : room.dateLabel.replaceAll(".", "-"),
    otherDetail: "",
    location: index === 0 ? "장소 협의 중" : "예시 교회",
    description: "",
    memberCount: [6, 4, 3, 5, 2][index] ?? 1,
    owner: "행사 운영팀",
    ownerId: "demo-event-team",
    createdAt: `2026-01-0${index + 1}T00:00:00.000Z`
  }));
}

function isRoom(value: unknown): value is LobbyRoom {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "name", "icon", "dateLabel", "dDay", "lastChange", "location", "description", "owner", "ownerId", "createdAt"]
    .every((key) => typeof item[key] === "string")
    && typeof item.category === "string" && Object.hasOwn(ROOM_CATEGORIES, item.category)
    && ["normal", "needsPreparation", "risk", "needsDate"].includes(item.status as string)
    && typeof item.pinned === "boolean"
    && ["memberCount", "unreadChanges", "riskCount"].every((key) => typeof item[key] === "number" && Number.isFinite(item[key]) && (item[key] as number) >= 0)
    && (item.date === null || (typeof item.date === "string" && !validateRoomDraft({ name: item.name as string, category: item.category as RoomCategory, date: item.date, location: "", description: "" }).date))
    && (item.endDate === undefined || item.endDate === null || (typeof item.endDate === "string" && validDate(item.endDate) && typeof item.date === "string" && item.endDate >= item.date))
    && (item.otherDetail === undefined || typeof item.otherDetail === "string")
    && Number.isFinite(Date.parse(item.createdAt as string));
}

export function createRoomCatalog(storage: BrowserStorage, profile: UserProfile) {
  storage = dataStorage(storage);
  const storageKey = PREFIX + (profile.accountId ?? profile.nickname);
  const load = (): RoomCatalog => {
    try {
      const raw = storage.getItem(storageKey);
      if (raw === null) return { rooms: seedRooms(profile), selectedRoomId: null };
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") throw new Error("Invalid catalog");
      const data = value as Record<string, unknown>;
      if (!Array.isArray(data.rooms) || !data.rooms.every(isRoom)) throw new Error("Invalid rooms");
      const selectedRoomId = typeof data.selectedRoomId === "string" && data.rooms.some((room) => room.id === data.selectedRoomId)
        ? data.selectedRoomId : null;
      const rooms = data.rooms.map(room => ({ ...room, endDate: room.endDate ?? room.date, otherDetail: room.otherDetail ?? "", dateLabel: roomDateLabel(room.date, room.endDate) }));
      return { rooms, selectedRoomId };
    } catch {
      throw new Error("행사방 정보를 읽지 못했습니다. 브라우저의 사이트 저장소 설정을 확인해 주세요.");
    }
  };
  const save = (catalog: RoomCatalog) => {
    try { writeBrowserRecord(storage, storageKey, catalog, "tab"); }
    catch { throw new Error("행사방을 저장하지 못했습니다. 사이트 저장소를 허용하거나 저장 공간을 확인해 주세요."); }
    return catalog;
  };
  const remove = (id: string) => {
    const data = load();
    if (!data.rooms.some((room) => room.id === id)) throw new Error("행사방을 찾을 수 없습니다.");
    return save({ rooms: data.rooms.filter((room) => room.id !== id), selectedRoomId: data.selectedRoomId === id ? null : data.selectedRoomId });
  };
  return {
    load,
    update(id: string, input: RoomDraft) {
      if (!canManageRooms(profile)) throw new Error("행사방을 수정할 권한이 없습니다.");
      const errors = validateRoomDraft(input);
      if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
      const data = load();
      if (!data.rooms.some(room => room.id === id)) throw new Error("행사방을 찾을 수 없습니다.");
      if (data.rooms.some(room => room.id !== id && room.name.toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) throw new Error("같은 이름의 행사방이 있습니다. 다른 이름을 입력해 주세요.");
      return save({ ...data, rooms: data.rooms.map(room => room.id === id ? {
        ...room, name: input.name.trim(), category: input.category,
        icon: ROOM_CATEGORIES[input.category].slice(0, 1),
        otherDetail: input.category === "other" ? input.otherDetail!.trim() : "",
        date: input.date || null, endDate: input.date ? input.endDate || input.date : null,
        dateLabel: roomDateLabel(input.date || null, input.endDate),
        location: input.location.trim(), description: input.description.trim(),
        lastChange: `${profile.nickname}님이 행사방 기본정보를 수정했습니다.`
      } : room) });
    },
    create(input: RoomDraft) {
      if (!canManageRooms(profile)) throw new Error("행사방을 만들 권한이 없습니다.");
      const errors = validateRoomDraft(input);
      if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
      const data = load();
      if (data.rooms.some((room) => room.name.toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) {
        throw new Error("같은 이름의 행사방이 있습니다. 다른 이름을 입력해 주세요.");
      }
      const room: LobbyRoom = {
        id: `room-${globalThis.crypto.randomUUID()}`,
        name: input.name.trim(), category: input.category, icon: ROOM_CATEGORIES[input.category].slice(0, 1),
        otherDetail: input.category === "other" ? input.otherDetail!.trim() : "",
        date: input.date || null, endDate: input.date ? input.endDate || input.date : null, dateLabel: roomDateLabel(input.date || null, input.endDate), dDay: "",
        location: input.location.trim(), description: input.description.trim(),
        memberCount: 1, owner: profile.nickname, ownerId: profile.accountId ?? profile.nickname,
        createdAt: new Date().toISOString(), status: input.date ? "needsPreparation" : "needsDate",
        pinned: false, unreadChanges: 0, riskCount: 0, lastChange: `${profile.nickname}님이 행사방을 만들었습니다.`
      };
      return { room, catalog: save({ ...data, rooms: [room, ...data.rooms] }) };
    },
    enter(id: string) {
      const data = load();
      if (!data.rooms.some((room) => room.id === id)) throw new Error("행사방을 찾을 수 없습니다.");
      return save({ ...data, selectedRoomId: id, rooms: data.rooms.map((room) => room.id === id ? { ...room, unreadChanges: 0 } : room) });
    },
    togglePin(id: string) {
      const data = load();
      const room = data.rooms.find(item => item.id === id);
      if (!room) throw new Error("행사방을 찾을 수 없습니다.");
      const pinned = data.rooms.filter(item => item.pinned && item.id !== id);
      const unpinned = data.rooms.filter(item => !item.pinned && item.id !== id);
      const updated = { ...room, pinned: !room.pinned };
      return save({ ...data, rooms: updated.pinned ? [...pinned, updated, ...unpinned] : [...pinned, ...unpinned, updated] });
    },
    savePreferences(rooms: EventRoom[]) {
      const data = load();
      const byId = new Map(data.rooms.map((room) => [room.id, room]));
      if (rooms.length !== data.rooms.length || new Set(rooms.map((room) => room.id)).size !== rooms.length || rooms.some((room) => !byId.has(room.id))) {
        throw new Error("행사방 목록이 변경되었습니다. 목록으로 돌아가 다시 시도해 주세요.");
      }
      return save({ ...data, rooms: rooms.map((room) => ({ ...byId.get(room.id)!, pinned: room.pinned, unreadChanges: room.unreadChanges })) });
    },
    delete(id: string) {
      if (!canManageRooms(profile)) throw new Error("행사방을 삭제할 권한이 없습니다.");
      return remove(id);
    },
    leave: remove
  };
}

export function filterRooms(rooms: LobbyRoom[], search: string, category: RoomCategory | "all", sort: RoomSort): LobbyRoom[] {
  const term = search.trim().toLocaleLowerCase();
  return rooms.filter((room) => (category === "all" || room.category === category)
    && (!term || [room.name, room.location, room.owner, room.otherDetail ?? "", ROOM_CATEGORIES[room.category]].some((value) => value.toLocaleLowerCase().includes(term))))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ko");
      if (sort === "date") return (a.date ?? "9999").localeCompare(b.date ?? "9999");
      const order = Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);
      return sort === "oldest" ? -order : order;
    });
}
