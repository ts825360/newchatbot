import { DOCUMENT_DOWNLOAD_ONLY_EXTENSIONS, DOCUMENT_PREVIEW_EXTENSIONS, MAX_DOCUMENT_FILE_SIZE, MAX_ROOM_FILE_BYTES, MAX_ROOM_FILE_COUNT, MEBIBYTE } from "./document-files";

const stepsByTopic = {
  room: [
    "행사방 목록에서 행사방을 만들고 이름과 행사 기간을 설정합니다. 만들기 버튼이 없다면 운영자에게 권한을 확인해 주세요.",
    "행사 이름이나 기간이 바뀌면 행사방의 연필 버튼을 눌러 수정합니다. 내 분류로 방을 정리할 수 있고, 분류를 지워도 행사방은 남습니다.",
  ],
  scope: [
    "공동 캘린더는 같은 행사방에서 볼 수 있습니다. 일정 추가·수정·삭제는 계정에 부여된 권한에 따라 가능합니다.",
    "대화와 올린 자료는 내 계정의 해당 대화에만 보입니다. 체크리스트·차량 배정·장소처럼 내 준비 기록은 같은 계정의 같은 행사방에서 이어서 사용할 수 있지만 다른 구성원에게 자동 공유되지 않습니다.",
  ],
  calendar: [
    "공동 캘린더에서 일정 추가를 누르고 제목과 날짜를 입력합니다. 시작·종료 시간을 비우면 00:00~22:00, 시작만 입력하면 한 시간 뒤에 끝나는 일정으로 저장됩니다.",
    "기존 일정은 일정 목록이나 날짜 칸에서 열어 수정합니다. 확정 일정만 연결된 개인 Google 캘린더로 전송됩니다.",
    "휴대폰 Google 캘린더에서 교회 행사 캘린더를 표시합니다. 공유 일정은 행사비서 웹에서 수정합니다.",
  ],
  prepare: [
    "수련회 방의 준비 점검에서 행사 날짜, 대표 장소, 배정 승인 등 저장된 근거를 확인합니다. 이름에 ‘요람’ 또는 ‘과거 기록’ 등이 들어간 TXT·MD(256 KiB 이하)를 현재 대화에서 고정하면 올해 확정 정보와 구분해 참고 근거로 표시합니다.",
    "준비 현황에서 직접 입력하거나 내 메시지의 준비 항목 버튼으로 편집창을 열어 저장합니다. 같은 메시지를 다시 선택하면 기존 항목이 열립니다.",
    "준비 점검에서 채팅으로 요약을 누르면 현재 대화에 요약이 추가됩니다. 이 요약은 외부 모델에 자료를 보내지 않습니다.",
    "물놀이는 관련 항목을 추가해야 점검에 나타납니다. 진행을 확정했다면 안전 담당자를 지정하고 해당 항목을 완료로 바꿉니다.",
  ],
  places: [
    "장소 탭에 집합 장소, 행사장, 숙소처럼 여러 장소를 추가합니다. 별표로 대표 장소를 지정하면 준비 점검에 사용됩니다.",
    "장소를 선택하고 지도 또는 길찾기를 엽니다. 앱 안의 지도만 안 보이면 Google Maps에서 열기를 사용합니다.",
  ],
  connection: "환경설정 → 보안 및 개인정보 → 외부 서비스 연결에서 Google 계정을 연결합니다. 캘린더 전송, 설문 읽기, 설문 생성 중 필요한 권한을 선택해 한 번에 연결할 수 있습니다.",
  import: "참가·이동 → 차량 배정에서 폼 불러오기를 눌러 Google 설문 응답이나 CSV를 확인하고 반영합니다.",
  transport: [
    "사용 중인 팀을 삭제하려면 연결된 참가자와 차량의 팀을 먼저 변경합니다.",
    "배정 계산 → 결과 검토 → 배정안 승인 순서로 진행합니다. 확정 CSV는 승인 이후 다운로드합니다.",
  ],
  materials: [
    "파일 선택으로 자료를 추가하고 이름을 눌러 미리봅니다. 미리보기를 지원하지 않는 문서는 내려받아 열 수 있습니다.",
    `미리보기: ${DOCUMENT_PREVIEW_EXTENSIONS.map(ext => ext === "DOCX" ? "DOCX(본문과 표)" : ext === "WEBP" ? "WebP" : ext).join(", ")}`,
    `다운로드 전용: ${DOCUMENT_DOWNLOAD_ONLY_EXTENSIONS.join(", ")}`,
    `파일당 최대 ${MAX_DOCUMENT_FILE_SIZE / MEBIBYTE} MiB입니다. 서버 저장 한도는 내 계정의 행사방 하나 기준 최대 ${MAX_ROOM_FILE_COUNT.toLocaleString("ko-KR")}개, 합계 ${MAX_ROOM_FILE_BYTES / MEBIBYTE} MiB입니다. 최대 크기 파일만 올리면 ${Math.floor(MAX_ROOM_FILE_BYTES / MAX_DOCUMENT_FILE_SIZE)}개까지 저장할 수 있습니다.`,
    "핀으로 중요한 자료를 상단에 고정하고, 순서 편집으로 자료 위치를 바꾼 뒤 저장합니다.",
  ],
  roster: [
    "명단을 입력창에 붙여 넣고 전송 대신 참가자 가져오기를 누르면 외부 모델에 보내지 않고 검토합니다. 이전에 저장한 내 메시지에서도 열 수 있습니다.",
    "이름을 한 줄에 한 명씩 적거나 이름·소속·가족 ID·출발 팀·귀가편 열이 있는 CSV를 붙여 넣습니다. 미리보기에서 동명이인과 이동편을 확인한 뒤 추가합니다.",
  ],
  proposal: "행사비서 답변과 준비 점검에서 나온 제안은 내용을 검토한 뒤 반영합니다. 제안함에서 보류하거나 제외할 수 있는 제안도 있습니다. 회의록 샘플은 체험 자료로, 올린 파일을 분석한 결과가 아닙니다.",
  report: "작업 화면의 빨간 사이렌 또는 환경설정의 문제 신고를 눌러 종류와 상황을 적습니다. 대화와 첨부파일은 신고에 자동으로 포함되지 않습니다.",
} as const;

export const quickHelpTopics = [
  ["행사방 시작", stepsByTopic.room],
  ["공유 범위와 권한", stepsByTopic.scope],
  ["공동 캘린더와 휴대폰", stepsByTopic.calendar],
  ["준비 점검과 체크리스트", stepsByTopic.prepare],
  ["장소 저장과 지도", stepsByTopic.places],
  ["설문과 차량 배정", [stepsByTopic.connection, stepsByTopic.import, ...stepsByTopic.transport]],
  ["자료 관리", stepsByTopic.materials],
  ["채팅 명단 가져오기", stepsByTopic.roster],
  ["제안 검토와 문제 신고", [stepsByTopic.proposal, stepsByTopic.report]],
] as const;

export const helpFaqs = [
  { question: "다른 구성원도 제 대화를 볼 수 있나요?", answer: "아니요. 공동 캘린더는 행사방 구성원과 공유하지만 대화는 내 계정에만 보입니다." },
  { question: "휴대폰에서 일정을 못 찾겠어요.", answer: "행사비서에서 일정이 확정 상태인지 확인하고, 휴대폰 Google 캘린더에서 연결한 계정의 교회 행사 캘린더를 표시하세요." },
  { question: "개인 답변 지침이 왜 반영되지 않나요?", answer: "개인 답변 지침은 저장만 하며 외부 모델에 보내지 않습니다. 말투, 답변 길이, 이모티콘 설정은 적용됩니다." },
] as const;

export type HelpGuideId = "start" | "assistant" | "schedule" | "prepare" | "survey" | "transport" | "materials" | "integrations" | "account";
type HelpGuide = {
  title: string;
  summary: string;
  steps: readonly string[];
  related: readonly HelpGuideId[];
  note?: string;
  examples?: readonly { prompt: string; context?: string }[];
};

export const helpGuides: Record<HelpGuideId, HelpGuide> = {
  start: {
    title: "시작 가이드", summary: "행사방을 만들고 기본 준비를 시작합니다.",
    steps: [
      ...stepsByTopic.room,
      "행사방에 입장해 공동 캘린더에 확정 일정을 추가합니다. 장소 탭에서 행사장이나 숙소를 등록하고 대표 장소를 지정합니다.",
      "새 대화에서 준비할 일을 확인하거나 준비 현황에 직접 체크리스트를 만듭니다. 필요하다면 참가 설문 초안을 만든 뒤 검토합니다.",
    ],
    related: ["prepare", "schedule", "account"],
  },
  assistant: {
    title: "AI 행사비서", summary: "질문, 답장, 작업 요청과 제안 검토",
    steps: [
      "행사방에 입장한 뒤 새 대화를 엽니다. 질문을 입력하고 전송합니다. 외부 AI가 필요한 질문은 이용 및 전송 동의 후 답변받을 수 있습니다.",
      "특정 메시지를 이어서 질문하려면 메시지의 답장 버튼을 눌러 대상을 지정합니다.",
      stepsByTopic.proposal,
    ],
    note: "이름, 연락처 또는 개인 주소가 담긴 명단은 채팅으로 전송하지 마세요. 참가자 가져오기를 사용하세요.",
    examples: [{ prompt: "우리 총 몇명이 가는거야?", context: "권한이 있는 계정에서 등록된 참가 인원만 집계합니다. 실제 참석 확정 인원과는 다릅니다." }],
    related: ["prepare", "survey", "transport"],
  },
  schedule: {
    title: "일정 관리", summary: "공동 캘린더, 타임테이블과 휴대폰 일정",
    steps: [
      ...stepsByTopic.calendar,
      "일정 도구에서 타임테이블 탭을 선택하고 행사 프로그램의 시작·종료 시간을 등록합니다. 채팅에서 검토용 타임테이블 초안을 받아 반영할 수도 있습니다.",
    ],
    note: "타임테이블은 내 준비 기록입니다. 반영해도 공동 캘린더에는 추가되지 않습니다.",
    examples: [{ prompt: "이번 행사의 기본 타임테이블을 작성해줘", context: "행사 정보를 바탕으로 검토용 초안을 만듭니다." }],
    related: ["integrations", "prepare"],
  },
  prepare: {
    title: "행사 준비", summary: "준비 점검, 체크리스트와 대표 장소",
    steps: [...stepsByTopic.prepare, ...stepsByTopic.places],
    examples: [
      { prompt: "현재 준비 현황을 알려줘", context: "현재 행사방에서 조회할 수 있는 저장 기록을 요약합니다." },
      { prompt: "현재 준비 현황을 체크리스트로 정리해줘", context: "초안을 확인한 뒤 필요한 항목만 선택해 반영합니다." },
    ],
    related: ["assistant", "materials"],
  },
  survey: {
    title: "참가 설문", summary: "설문 초안, 검토 버전과 응답 불러오기",
    steps: [
      "행사방 채팅에서 참가 설문을 요청하고 미리보기에서 문항과 선택지를 확인합니다.",
      "수정하려면 최신 초안에 답장하고 바꿀 문항 번호와 내용을 적습니다. 수정 결과는 새 검토 버전에 표시됩니다.",
      "Google 설문 생성 권한을 연결한 뒤, 검토한 최신 버전에서 승인하고 Google Forms에 생성을 누릅니다. 미게시 상태인 초안은 편집 링크에서 확인합니다.",
      stepsByTopic.import,
    ],
    note: "채팅에서 문항을 수정해도 Google에 이미 만든 설문은 바뀌지 않습니다. 채팅으로 부분 수정을 요청하려면 외부 AI 이용 동의가 필요합니다.",
    examples: [
      { prompt: "참가 설문을 만들어줘" },
      { prompt: "이동수단 문항의 제목만 ‘어떻게 이동하시나요?’로 바꿔줘", context: "최신 설문 초안에 답장해서 사용합니다." },
    ],
    related: ["integrations", "transport"],
  },
  transport: {
    title: "차량 및 숙소", summary: "참가자 명단, 이동편과 배정 검토",
    steps: [
      stepsByTopic.import,
      ...stepsByTopic.roster,
      ...stepsByTopic.transport,
      "숙소 배정에서 사용할 방과 배정된 인원을 확인합니다. 미배정 참가자와 아직 지정하지 않은 호수가 있는지 살펴봅니다.",
    ],
    related: ["survey", "prepare"],
  },
  materials: {
    title: "자료 관리", summary: "파일 등록, 미리보기, 고정과 저장 한도",
    steps: stepsByTopic.materials,
    note: "대화에 올린 자료는 자동 공유되지 않습니다. 다른 구성원에게 전달할 자료인지 먼저 확인하세요.",
    related: ["prepare", "account"],
  },
  integrations: {
    title: "외부 서비스 연동", summary: "Google Calendar와 Google Forms 연결",
    steps: [
      stepsByTopic.connection,
      "연결 테스트로 Google 인증과 선택한 권한을 확인합니다. 인증 만료나 권한 부족이 표시되면 다시 연결합니다.",
      "Calendar는 확정된 행사 일정을 전용 캘린더에 보냅니다. Forms 읽기 권한은 기존 설문과 응답 확인, 설문 생성 권한은 새 미게시 초안 생성에 사용합니다.",
    ],
    note: "연결 테스트는 인증과 권한 확인용입니다. 실제 일정 전송이나 설문 생성까지 확인하는 것은 아닙니다.",
    related: ["schedule", "survey"],
  },
  account: {
    title: "계정 및 권한", summary: "초대코드, 공유 범위와 개인정보",
    steps: [
      "가입하려면 운영자가 발급한 초대코드를 사용합니다. 초대코드나 접근 권한 문제는 발급한 관리자에게 문의합니다.",
      ...stepsByTopic.scope,
      "환경설정 → 보안 및 개인정보에서 외부 AI 전송 동의와 Google 연결을 확인합니다.",
      stepsByTopic.report,
    ],
    related: ["integrations", "assistant"],
  },
};
