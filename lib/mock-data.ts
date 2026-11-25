import type {
  CalendarEvent,
  ChatMessage,
  ChecklistItem,
  EventRoom,
  InviteKey,
  RiskAlert,
  UserProfile
} from "./types";

export const sampleInviteKeys = { member: "DEMO-RETREAT-GUEST", manager: "DEMO-RETREAT-MANAGER" } as const;

export const defaultProfile: UserProfile = {
  nickname: "체험 사용자",
  role: "수련회 보조 관리자",
  roomIds: [
    "summer-retreat-2026",
    "christmas-2026",
    "easter-2027",
    "outdoor-worship-2026",
    "new-family-welcome"
  ],
  permissions: ["viewRoom", "chat", "viewCalendar", "createEvent", "editEvent", "viewChecklist", "editChecklist"]
};

export const prototypeRooms: EventRoom[] = [
  {
    id: "summer-retreat-2026",
    name: "2026 여름 수련회",
    icon: "수",
    dateLabel: "2026.08.15",
    dDay: "D-13",
    status: "risk",
    pinned: true,
    unreadChanges: 3,
    riskCount: 3,
    lastChange: "일정 담당자가 집합 시간을 수정함"
  },
  {
    id: "christmas-2026",
    name: "성탄 발표회",
    icon: "성",
    dateLabel: "2026.12.24",
    dDay: "D-144",
    status: "needsPreparation",
    pinned: false,
    unreadChanges: 1,
    riskCount: 1,
    lastChange: "관리자가 리허설 후보를 추가함"
  },
  {
    id: "easter-2027",
    name: "부활절 예배 준비",
    icon: "부",
    dateLabel: "2027.04.04",
    dDay: "D-245",
    status: "normal",
    pinned: false,
    unreadChanges: 0,
    riskCount: 0,
    lastChange: "예배 담당자가 꽃 장식 담당을 완료 처리함"
  },
  {
    id: "outdoor-worship-2026",
    name: "전교인 야외예배",
    icon: "야",
    dateLabel: "2026.10.11",
    dDay: "D-70",
    status: "needsDate",
    pinned: false,
    unreadChanges: 2,
    riskCount: 2,
    lastChange: "행사비서가 날짜 확정 필요를 감지함"
  },
  {
    id: "new-family-welcome",
    name: "새가족 환영회",
    icon: "새",
    dateLabel: "2026.09.20",
    dDay: "D-49",
    status: "needsPreparation",
    pinned: false,
    unreadChanges: 0,
    riskCount: 1,
    lastChange: "장소 담당자가 장소 후보를 남김"
  }
];

export const prototypeInviteKeys: InviteKey[] = [
  {
    id: "invite-default",
    label: "기본 수련회 초대",
    key: sampleInviteKeys.member,
    roomId: "summer-retreat-2026",
    role: "수련회 보조 관리자",
    permissions: ["viewRoom", "chat", "viewCalendar", "createEvent", "editEvent", "viewChecklist", "editChecklist"],
    maxUses: 10,
    usedCount: 1,
    expiresAt: "2026-08-31",
    active: true,
    memo: "프로토타입 기본 입장 키"
  },
  {
    id: "invite-master",
    label: "마스터 관리자",
    key: sampleInviteKeys.manager,
    roomId: "summer-retreat-2026",
    role: "마스터 관리자",
    permissions: [
      "viewRoom",
      "chat",
      "viewCalendar",
      "createEvent",
      "editEvent",
      "deleteEvent",
      "viewChecklist",
      "editChecklist",
      "uploadDocument",
      "addLink",
      "editLink",
      "inviteMember",
      "createRoom",
      "editRoom",
      "viewHistory",
      "admin"
    ],
    maxUses: 2,
    usedCount: 1,
    expiresAt: "2026-12-31",
    active: true,
    memo: "관리자 대시보드 확인용 키"
  }
];

export const prototypeChats: Record<string, ChatMessage[]> = {
  "summer-retreat-2026": [
    {
      id: "chat-welcome-retreat",
      sender: "assistant",
      text:
        "2026 여름 수련회 기준으로 날짜와 장소는 확인되었습니다. 아직 차량 배정, 방 배정, 물놀이 안전 담당이 비어 있습니다.",
      time: "오후 1:12",
      actions: ["체크리스트 보기", "공지문 초안", "회의 없이 할 일"]
    }
  ],
  "christmas-2026": [
    {
      id: "chat-welcome-christmas",
      sender: "assistant",
      text: "성탄 발표회는 리허설 일정과 발표팀별 준비물 확인이 필요합니다.",
      time: "오전 10:05",
      actions: ["리허설 후보 만들기", "팀별 준비표"]
    }
  ],
  "easter-2027": [],
  "outdoor-worship-2026": [],
  "new-family-welcome": []
};

export const prototypeEvents: Record<string, CalendarEvent[]> = {
  "summer-retreat-2026": [
    {
      id: "retreat-meet",
      title: "수련회 집합",
      date: "2026-08-15",
      time: "오후 2:00",
      location: "예시 교회",
      memo: "차량 탑승 전 참석자 확인 필요",
      status: "confirmed",
      author: "일정 담당자",
      lastEditor: "일정 담당자",
      changeLog: "일정 담당자가 집합 시간을 오후 2시로 변경했습니다.",
      linkLabel: "공지문 초안",
      linkUrl: "https://example.com/notice"
    },
    {
      id: "retreat-arrive",
      title: "수련회 장소 도착",
      date: "2026-08-15",
      time: "오후 5:00",
      location: "수련회장",
      memo: "도착 후 방 배정표 공지",
      status: "confirmed",
      author: "현장 담당자",
      lastEditor: "현장 담당자",
      changeLog: "현장 담당자가 장소 도착 시간을 확인했습니다."
    },
    {
      id: "retreat-evening-service",
      title: "저녁 예배",
      date: "2026-08-15",
      time: "오후 8:00",
      location: "본관 예배실",
      memo: "회의록에서 추출된 후보 일정",
      status: "candidate",
      author: "행사비서",
      lastEditor: "행사비서",
      changeLog: "행사비서가 회의록에서 저녁 예배 시간을 추출했습니다."
    },
    {
      id: "retreat-water-safety",
      title: "물놀이 안전 점검",
      date: "2026-08-16",
      time: "오전 10:00",
      location: "수영장",
      memo: "안전 담당자가 지정되지 않았습니다.",
      status: "needsReview",
      author: "행사비서",
      lastEditor: "행사비서",
      changeLog: "행사비서가 물놀이 안전 담당 누락을 감지했습니다."
    },
    {
      id: "retreat-final-notice",
      title: "최종 공지 발송",
      date: "2026-08-08",
      time: "오후 7:00",
      location: "온라인 공지",
      memo: "행사 7일 전 공지 발송 후보",
      status: "needsReview",
      author: "행사비서",
      lastEditor: "행사비서",
      changeLog: "행사비서가 D-7 공지 필요를 제안했습니다."
    }
  ],
  "christmas-2026": [
    {
      id: "christmas-rehearsal",
      title: "성탄 발표회 리허설",
      date: "2026-12-21",
      time: "오후 7:30",
      location: "본당",
      memo: "발표팀별 순서 확인 필요",
      status: "candidate",
      author: "관리자",
      lastEditor: "관리자",
      changeLog: "관리자가 리허설 후보를 추가했습니다."
    }
  ],
  "easter-2027": [],
  "outdoor-worship-2026": [],
  "new-family-welcome": []
};

export const prototypeChecklists: Record<string, ChecklistItem[]> = {
  "summer-retreat-2026": [
    {
      id: "retreat-date",
      title: "날짜 확정",
      status: "inProgress",
      owner: "현장 담당자",
      due: "2026-08-02",
      memo: "회의록 기준 8월 15일 확정 예정"
    },
    {
      id: "retreat-place",
      title: "장소 예약",
      status: "done",
      owner: "현장 담당자",
      due: "2026-08-02",
      memo: "수련회장 예약 확인"
    },
    {
      id: "retreat-attendance",
      title: "참석자 조사",
      status: "needsReview",
      owner: "일정 담당자",
      due: "2026-08-05",
      memo: "청년부/학생부 포함 여부 확인 필요"
    },
    {
      id: "retreat-vehicle",
      title: "차량 배정",
      status: "risk",
      owner: "장소 담당자",
      due: "2026-08-08",
      memo: "차량 수요 조사 양식 필요"
    },
    {
      id: "retreat-room",
      title: "방 배정",
      status: "risk",
      owner: "미지정",
      due: "2026-08-10",
      memo: "성별/가족 단위 기준 확인 필요"
    },
    {
      id: "retreat-safety",
      title: "물놀이 안전 담당",
      status: "risk",
      owner: "미지정",
      due: "2026-08-12",
      memo: "안전 담당 2명 지정 필요"
    }
  ],
  "christmas-2026": [
    {
      id: "christmas-rehearsal-check",
      title: "리허설 일정 확정",
      status: "risk",
      owner: "일정 담당자",
      due: "2026-12-10",
      memo: "발표팀 전체 일정 확인 필요"
    }
  ],
  "easter-2027": [
    {
      id: "easter-flower",
      title: "꽃 장식 담당 확인",
      status: "done",
      owner: "현장 담당자",
      due: "2027-03-20",
      memo: "담당자 확인 완료"
    }
  ],
  "outdoor-worship-2026": [
    {
      id: "outdoor-date",
      title: "야외예배 날짜 확정",
      status: "needsReview",
      owner: "관리자",
      due: "2026-08-20",
      memo: "우천 예비일 필요"
    }
  ],
  "new-family-welcome": [
    {
      id: "welcome-place",
      title: "환영회 장소 확정",
      status: "needsReview",
      owner: "장소 담당자",
      due: "2026-09-01",
      memo: "소그룹실 또는 식당 후보"
    }
  ]
};

export const prototypeRisks: Record<string, RiskAlert[]> = {
  "summer-retreat-2026": [
    {
      id: "risk-vehicle",
      title: "차량 배정이 아직 없습니다.",
      detail: "참석자 조사와 차량 수요 조사를 먼저 열어야 합니다.",
      action: "담당자 지정",
      resolved: false
    },
    {
      id: "risk-room",
      title: "방 배정 문서가 업로드되지 않았습니다.",
      detail: "성별, 가족 단위, 교사 배치 기준을 확인해야 합니다.",
      action: "체크리스트로 이동",
      resolved: false
    },
    {
      id: "risk-safety",
      title: "물놀이 안전 담당자가 지정되지 않았습니다.",
      detail: "최소 2명의 담당자를 지정하고 비상연락망을 확인하세요.",
      action: "담당자 지정",
      resolved: false
    }
  ],
  "christmas-2026": [
    {
      id: "risk-rehearsal",
      title: "리허설 일정이 확정되지 않았습니다.",
      detail: "발표팀별 가능한 시간을 먼저 조사해야 합니다.",
      action: "일정 후보 만들기",
      resolved: false
    }
  ],
  "easter-2027": [],
  "outdoor-worship-2026": [
    {
      id: "risk-weather",
      title: "우천 예비일이 없습니다.",
      detail: "야외예배는 예비 장소나 예비일이 필요합니다.",
      action: "예비일 추가",
      resolved: false
    }
  ],
  "new-family-welcome": []
};
