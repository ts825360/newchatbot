export type Permission =
  | "viewRoom"
  | "chat"
  | "viewCalendar"
  | "createEvent"
  | "editEvent"
  | "deleteEvent"
  | "viewChecklist"
  | "editChecklist"
  | "uploadDocument"
  | "addLink"
  | "editLink"
  | "inviteMember"
  | "manageMembers"
  | "createRoom"
  | "editRoom"
  | "viewHistory"
  | "admin";

export type RoomStatus = "normal" | "needsPreparation" | "risk" | "needsDate";
export type ChecklistStatus = "done" | "inProgress" | "needsReview" | "risk";
export type EditableCalendarStatus = "confirmed" | "pending" | "other";
export type CalendarEventStatus = EditableCalendarStatus | "candidate" | "needsReview" | "changed";
export type ChatSender = "user" | "assistant";

export type EventRoom = {
  id: string;
  date?: string | null;
  endDate?: string | null;
  location?: string;
  placeId?: string;
  name: string;
  icon: string;
  dateLabel: string;
  dDay: string;
  status: RoomStatus;
  pinned: boolean;
  unreadChanges: number;
  riskCount: number;
  lastChange: string;
};

export type UserProfile = {
  accountId?: string;
  grade?: 1 | 2 | 3;
  duty?: string;
  nickname: string;
  role: string;
  roomIds: string[];
  permissions: Permission[];
};

export type InviteKey = {
  id: string;
  label: string;
  key: string;
  roomId: string;
  role: string;
  permissions: Permission[];
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  active: boolean;
  memo: string;
};

export type InviteKeyDraft = Omit<InviteKey, "id" | "usedCount" | "active">;

export type InviteValidationResult =
  | {
      ok: true;
      profile: UserProfile;
      invite: InviteKey;
    }
  | {
      ok: false;
      error: string;
    };

export type ChatMessageReference = { kind: "reply" | "edit"; messageId: string };

export type ChatMessage = {
  id: string;
  sender: ChatSender;
  text: string;
  time: string;
  replyElapsedMs?: number;
  reference?: ChatMessageReference;
  actions?: string[];
  advisor?: import("./chat-advisor").AdvisorPresentation;
  workProposal?: import("./chat-work-proposal").ChatWorkProposal;
  workResult?: import("./chat-work-result").ChatWorkResult;
  dining?: import("./chat-dining").DiningRecommendations;
  nearbyTask?: import("./chat-dining").NearbyTask;
  venueRoute?: import("./chat-venue-route").VenueRoute;
};

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  endTime?: string;
  location: string;
  memo: string;
  status: CalendarEventStatus;
  author: string;
  lastEditor: string;
  changeLog: string;
  linkLabel?: string;
  linkUrl?: string;
};

export type ChecklistItem = {
  id: string;
  title: string;
  status: ChecklistStatus;
  owner: string;
  due: string;
  memo: string;
};

export type RiskAlert = {
  id: string;
  title: string;
  detail: string;
  action: string;
  resolved: boolean;
};

export type PrototypeState = {
  profile: UserProfile;
  activeRoomId: string;
  rooms: EventRoom[];
  inviteKeys: InviteKey[];
  chatByRoom: Record<string, ChatMessage[]>;
  events: Record<string, CalendarEvent[]>;
  checklists: Record<string, ChecklistItem[]>;
  risks: Record<string, RiskAlert[]>;
};

export type AdminCommandResult = {
  canOpenAdmin: boolean;
  message: string;
};
