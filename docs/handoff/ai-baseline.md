# 행사비서 AI 런타임 인계: rc.25

## 목적과 감사 기준

프롬프트 수정 전의 비교 기준이다. 자연어 판단, 서버가 확인한 사실, 승인 후 실행의 경계를 먼저 고정한다. 기준은 `package.json`이 `0.2.0-rc.25`인 **현재 작업 트리**(2026-11-27, `codex/google-connection-diagnostics`, 기반 `7775593eb44832fb714e9bf743a08d280c194f0f`)다. `HEAD`의 패키지 버전은 rc.15이고 로컬에 `v0.2.0-rc.25` 태그가 없다. 따라서 아래는 배포 이미지나 태그의 재현 결과가 아니며, 기존 미커밋 변경과 추가 파일을 포함한 소스 정적 감사다. 새 브라우저·빌드·테스트 실행이나 실제 API 호출은 하지 않았다. [변경 이력](../../CHANGELOG.md), [요구사항 추적](../requirements/traceability.md), [이전 AI 로드맵](../assistant-improvement-roadmap.md)은 배경이며, 구현 판정은 아래 소스를 우선한다.

## 전체 구조

```text
개인 대화 → 사용자 메시지 저장/flush → POST /api/chat → 세션·권한·저장 턴 검증
  ├─ 서버 규칙 → 내부 상태 요약·집계·초안 (길찾기는 동의 시 공개 구간 검색)
  ├─ 주변 검색 → 필요 시 의도 해석 → 구조화된 공개 검색 → 후보/근거 검증
  └─ 일반 AI → 프롬프트 + 제한 문맥 → 허용 도구/결과 재주입 → 검증된 답변
       → 현재 기록·권한 재확인 → 개인 대화에 저장 → UI 재조회
       → 사용자가 반영 승인/실행 → 별도 저장 또는 외부 서비스 경로
```

[API 엔트리](../../app/api/chat/route.ts)는 Node.js 런타임이다. [EventWorkspace의 `sendChat`/`requestReply`](../../components/event-workspace.tsx)가 사용자 턴을 먼저 저장하고 `flushBackendWrites` 후 `roomId`, `conversationId`, `userMessageId`, `userMessageText`를 POST한다. 서버가 허용하는 추가 키는 선택적 `consent` 버전뿐이며 이 값만으로 동의가 생성되지 않는다. [서버 `handleChat`/`findTurn`](../../lib/server/chat.ts)은 `viewRoom`/`chat`, 대화 소유권, 저장된 사용자 ID·본문 일치, 그리고 미응답 턴이 마지막인지 확인한다. `readJson`은 요청 출처와 JSON을 검사한다. 응답은 스트림·모델 원문이 아닌 `{ ok: true }`이며, 클라이언트가 저장 결과를 다시 읽는다. [`saveRecord`](../../lib/server/records.ts)는 클라이언트가 AI 메시지를 새로 쓰거나 기존 내용을 바꾸는 것을 거부한다. 백엔드 미연결 때 [`createConversationStore`](../../lib/conversation-store.ts)가 넣는 목업 응답(`createAssistantReply`)은 이 런타임의 모델 결과가 아니다.

## 프롬프트 원본과 모델 경로

| 경로 | 정확한 소스와 조합 |
| --- | --- |
| 일반 채팅·준비 조언 | [`lib/server/chat-advisor-prompt.ts`](../../lib/server/chat-advisor-prompt.ts)의 `chatAdvisorPrompt`가 역할·침례교회 용어·근거/권한·상황별 판단을, `chatOutputInstruction`이 출력 계약을 정의한다. [`lib/server/chat.ts`](../../lib/server/chat.ts)의 `handleChat` 일반 분기에서 `chatAdvisorPrompt` → `continuityInstruction` → `surveyInstruction` → `chatOutputInstruction` → `assistantStyleInstruction(preferences)` → 대표 장소 도구가 있을 때만 장소 안내 한 줄 순으로 `\n\n` 결합해 Responses의 `instructions`로 보낸다. 사용자 발화/인용은 별도 `input`이다. [`lib/server/assistant-preferences.ts`](../../lib/server/assistant-preferences.ts)의 `assistantStyleInstruction`은 말투·길이·이모지의 서버 작성 규칙만 합친다. 저장된 개인 지침 문자열은 `instructionsEnabled`가 켜져 있어도 전송하지 않는다. `formatAssistantReply`는 적용 경로에서 이모지 끔을 후처리한다. |
| 모호한 주변 검색 후속 | [`lib/server/chat-interpretation.ts`](../../lib/server/chat-interpretation.ts) `interpretNearbyFollowUp` 내부 인라인 지침 + `format`(`nearby_task_intent`), 도구 없음. 현재 발화·작업 종류·후보 수만 전달. `revise`/`select`/`alternative`/`assess`/`unrelated`/`clarify`, 허용 순위 및 `traits`를 서버가 재검증한다. |
| 공개 웹 검색 | [`lib/server/chat-dining.ts`](../../lib/server/chat-dining.ts) `recommendDining`의 `instructions`/`format`(`sourced_nearby_places_v2`), [`lib/server/chat-travel.ts`](../../lib/server/chat-travel.ts) `answerVenueTravel`의 `instructions`/`format`(`public_journey_leg_estimates`). 공통 채팅 프롬프트를 사용하지 않는다. |
| 별도 준비 완료 검토 | [`app/api/preparation-progress/route.ts`](../../app/api/preparation-progress/route.ts) → [`lib/server/preparation-progress.ts`](../../lib/server/preparation-progress.ts) `handlePreparationProgress`, `instructions`, `modelFormat`(`preparation_verdict_v1`). 별도 요청 동의(`preparationProgressConsent`)와 검토 권한 사용. 서버에 남은 일/필수 근거 누락이 있으면 모델을 부르지 않는다. 익명 집계만 보내 `ready`/`remaining`/`uncertain`을 받고, 최신 근거 서명과 권한을 재검사한 뒤 서버만 `100%`를 결정한다. `get_preparation_status`나 단순 현황 요약과 다른 경로다. |

활성 외부 전송은 [`lib/server/chat-openai.ts`](../../lib/server/chat-openai.ts)의 `withOpenAI`/`generateOpenAIText`/`searchOpenAIWeb`에서 고정 `POST https://api.openai.com/v1/responses`를 쓴다. `AI_PROVIDER=openai` 및 서버 키 설정이 전제이며 `OPENAI_MODEL`은 기본 `gpt-6-luna`, 명시 허용 `gpt-6.2-sol`뿐이다. 일반 생성은 Luna `reasoning.effort=none`, Sol `low`, 검색은 `low` 고정이다. 구현에 명시된 모델명이지 실제 연결/가용성을 인증한 것이 아니다. [`generateGeminiText`](../../lib/server/chat-gemini.ts)(`gemini-3.8-flash`, `generateContent`)와 [`openLocalChat`](../../lib/server/chat-ollama.ts)(`qwen3:4b:local`, `/api/show` 및 `/api/chat`)은 소스에 남아 있지만 이 핸들러들의 호출 경로/폴백이 아니다. 여기서 ‘로컬 처리’는 서버 규칙이지 로컬 LLM을 뜻하지 않는다.

## 라우팅 우선순위

1. [`classifyContinuation`](../../lib/chat-continuity.ts)은 NFKC 후 `cancel` → 명시 `new` → `revise` → 순위/인용 `reference` → 조건 보충 `supplement` → `unknown`의 정규식 우선순위다. 별도로 [`localWorkIntent`](../../lib/chat-work-proposal.ts)는 공동 캘린더 명령 → 제한된 설문 표현 → 타임테이블 → 등록 인원 순이다. 긴 문장, 사용법·일부 부정 표현은 빠른 경로에서 제외된다. [`nearbySearchKind`](../../lib/server/chat-dining.ts)는 식당이 관광보다 우선이다. 명시 주변 검색이면 최초 길찾기 분류와 `headcount` 분기를 억제하지만 다른 로컬 업무는 여전히 앞선다.
2. 실제 `handleChat` 답변 분기는 **취소 → `loadChatWork` → 대표 장소/길찾기 또는 검증된 이동 후속 → 수련회 장소 이력 → 수련회 상세 준비 → 일반 로컬 준비 현황 → 주변 검색 → 일반 AI**. 취소는 `context-cancelled` 메시지만 남긴다. [`isPreparationChat`/`isPreparationStatusChat`](../../lib/chat-tool-candidates.ts)에서 정해진 요약 또는 짧은 상태 확인은 로컬로, ‘무엇부터/우선순위’가 섞인 질문은 모델 조언 쪽으로 보낸다. [`loadPreparationStatus`](../../lib/server/preparation-status.ts)는 저장 상태와 선택적 미완료 체크리스트 후보를, [`loadChatWork`](../../lib/server/chat-work-proposals.ts)는 인원 집계·일정·타임테이블·기본 설문 초안을 만든다. 등록 인원은 참석 확정이 아니다. 로컬 처리도 소유권과 공개 제한을 우회하지 않는다.
3. 주변 검색 상태는 같은 대화의 직전 답변 또는 명시 답장에서 서버가 계산한 해시 ID와 `nearbyTask`가 맞을 때만 앵커로 삼는다. 무참조이고 마지막 작업이 다른 `workProposal`이면 계승하지 않는다. 이전 주변 검색이 있고 `unknown`이며, 명시 답장·새 검색 패턴·장소 저장 요청·저장 인원 명시가 모두 없을 때만 `interpretNearbyFollowUp`을 한 번 시도한다. `unrelated`는 일반 AI로, `clarify`/파서의 `null`은 확인 질문으로 간다(전송 오류 자체는 HTTP 오류). 명시 요청을 전부 LLM으로 분류하는 구조가 아니다.
4. 주변 검색 안에서는 후보 저장 확인 카드/집계 누락/의도·장소·시간 확인을 먼저 처리하고, 조건이 같으면 기존 후보 선택·유지·마지막 순위 추가를 시도한다. 조건/장소 변경·만료·대안 요청이면 새 검색 또는 재검색 안내다. 방문 조건·대표 장소 지문이 일치하고 결과가 0~20분 이내의 비임시 결과일 때만 일반 후보 재사용이 가능하다. 순위 추가는 최대 3순위이며 기존 순서를 보존한다. 참조된 장소·행사 날짜·등록 인원은 해당 저장 경로에서 최신 값을 확인한다.

## 문맥·스코프·동의

- [`conversation-scope.ts`](../../lib/server/conversation-scope.ts): `records`의 대화 JSON은 계정×행사방(`canonicalConversationHistory`)에 묶이고 그 안의 선택 대화만 문맥에 사용한다. 설문 작업 버전·첨부자료는 계정×행사방×대화, 타임테이블·장소·체크리스트·차량 등 개인 작업 도구는 계정×행사방(`canonicalWorkspaceTool`), 공동 캘린더는 행사방(소유자 없음), 스타일·동의는 계정 단위다. 일부 로컬 조회는 `inheritWorkspaceRecords`로 기존 대화별 레코드의 호환 사본을 계정×행사방에 옮길 수 있다. 이를 승인된 업무 반영으로 해석하지 않는다.
- [`chat-consent.ts`](../../lib/server/chat-consent.ts), [`assistant-privacy.ts`](../../lib/assistant-privacy.ts): `/api/chat`의 GET/PUT/DELETE는 외부 AI(`openAIChatConsentVersion`) 또는 `?purpose=reply-context`(`openAIReplyContextConsentVersion`)의 계정별 동의를 관리한다. 자동 이전 답변 재사용은 외부 AI 동의가 전제이고, 외부 AI 동의 철회는 두 승인 모두 제거한다. 외부 일반/주변 분기에는 서버 동의가 필요하고, 길찾기 자체는 로컬이지만 공개 구간 검색은 동의가 있을 때만 시행한다. `local-only` 턴은 AI 답변 요청 대상으로 받지 않는다.
- `chatInput`/`confirmedOpenAITurn`: 자동 문맥은 저장된 질문과 바로 다음 서버 `openai-` 답변이 짝을 이룬 것만 사용한다. 최근 13개 메시지 범위(취소 경계 이후)에서 과거 질문 최대 3개, 과거 문맥 합계 2,400자다. 개인정보·요청 한정 조건·대체된 수정 턴을 제외한다. 질문 문맥은 기본 외부 AI 동의 범위이며, 과거 AI 답변 일부(본문+행 텍스트, 답변당 최대 1,000자)는 별도 동의가 있고 새 주제 경계 등을 통과해야 포함된다. 공개 대표 장소를 도구로 쓴 과거 답변과 작업 제안 답변은 재전송을 제한한다. **명시 답장**은 자동 답변 설정과 별개로, 자격 있는 단일 대상 최대 600자만 `{ selectedReply }`로 보내고 나머지 최근 문맥을 섞지 않는다. 부적격 인용은 `null`이다. 현재 질문은 과거 문맥 예산 때문에 잘리지 않는다.
- `NearbyTask`/`NearbyVisit`([`lib/chat-dining.ts`](../../lib/chat-dining.ts))는 출처·방문 기준·후보 메시지/순위·대표 장소 지문을 보관한다. [`WorkCondition`/`resolveWorkConditions`](../../lib/chat-work-state.ts)는 값·출처·범위·성격·확정 상태·개정값을 표현하며 `request` 패치는 지속 상태에서 제외한다. 저장 인원을 읽으라는 요청은 `readParticipantCount`에서 권한/최신 집계를 다시 확인한다. 범용 장기 메모리, 타 대화 벡터 검색 또는 서버가 임의로 행사 기록에 학습하는 기능은 없다.

## 일반 AI 함수 도구 계약

아래는 `handleChat`이 `generateOpenAIText`에 넘기는 허용 목록이다. 웹 검색 도구, SQL, 파일 경로, 자유 URL, 권한 변경 또는 외부 서비스를 이 목록으로 직접 실행할 수 없다.

| 도구 / 등록점 | 모델 입력 → 서버가 돌려주는 결과 |
| --- | --- |
| `get_current_event_venue` / [`eventVenueTool`, `readPublicEventVenue`](../../lib/server/chat-venue-tool.ts) | `{}` → 현재 작업 공간 대표 장소가 `verifiedPublicPlace` 목록과 일치할 때만 `name,address,source`. 확인된 장소가 있어야 도구가 등록된다. 사용 직전 재조회 및 저장 직전 변경 확인. 자유 기재 주소/메모나 최신 주변 정보는 반환하지 않는다. |
| `get_preparation_status` / [`preparationFactsTool`, `readPreparationFacts`](../../lib/server/chat-preparation-tool.ts) | `{}` → 행사 분류/날짜, 장소 분류별 수, 설문 상태 집계, 참가자·차량·숙소·타임테이블·공동 일정·체크리스트 수/상태, 현재 대화 파일 개수(`contentsRead:false`). 기록 없음·읽기 실패·권한 없음 또는 미조회 표지를 구분한다. `viewCalendar`/`viewChecklist`에 따라 일부 조회를 제한하고 개인명·메모·첨부 본문은 전달하지 않는다. 결과를 사용하면 저장 직전 다시 비교하고, 모델 제안과 같은 턴의 설문 반영을 억제한다. |
| `create_survey_draft` / [`createWorkSession`](../../lib/server/chat-work-store.ts) | `{}` → 서버가 현재 행사명과 기본 참가 설문 복사본으로 v1을 준비. 모델이 제목·템플릿을 직접 넘기지 않는다. |
| `get_work_draft` / `createWorkSession` | `{ mode: read\|show\|regenerate }` → 같은 대화의 인용 또는 최근 작업에 연결된 설문만 사용. `read`는 조회 버전, `show`는 현재 카드 재표시, `regenerate`는 기존 문항을 유지한 새 버전. 없으면 `{ found:false, kind:"survey" }`. |
| `update_survey_draft` / `createWorkSession` | `{ version, operation, number, title, required, options, other }` → 같은 턴에 읽은 최신 버전으로 문항 한 개 `update`/`remove`/`add`(1부터 시작, 추가는 해당 번호 앞). 해당 값의 `null`은 보존에 사용한다. 오래된 인용/버전과 보호된 출석·이름·기본 이동 분기에 대한 변경, 중복 및 비정상 문항은 거부한다. |

설문 도구의 성공 응답은 `found`, `kind`, `version`, `status:review_only`, 문항 번호/기본 라벨/종류/일부 `editable:false`인 [`surveyDraftOutline`](../../lib/chat-survey-draft.ts)이다. 사용자 문항은 일반 라벨로 투영하며 행사 제목·임의 문항 원문·설문 응답·DB 키는 결과에 넣지 않는다. 쓰기는 요청 내 최대 한 버전으로 스테이징한다. 검증된 최종 응답과 같은 SQLite 트랜잭션에서만 `chat_work_versions`와 응답을 저장한다. 버전 테이블은 `owner_id,room_id,conversation_id,work_id,version`을 기준으로 보며 현재 `kind`는 `survey`다. 예전 제목 전용 카드는 필요할 때 기본 미리보기를 버전으로 이관할 수 있다.

`generateOpenAIText`는 외부 호출 직전 콜백에서 동의·세션·대화 개정 확인, 도구 실행 직전에도 범위를 확인한다. `strict:true` 정의와 서버의 키/값 검사를 함께 사용한다. `parallel_tool_calls:false`, 응답당 정확히 한 함수 호출, 전체 성공 도구 호출 최대 3개(초회 포함 최대 4회 HTTP), 호출 ID는 중복 불가 및 영숫자/밑줄/하이픈 1~128자다. 인자는 객체 JSON 문자열 최대 3,200자, 결과 문자열 최대 8,000자이며 양쪽 개인정보 패턴도 검사한다. 최초 입력과 누적 `function_call`/같은 ID의 `function_call_output`을 다시 보낸다. Sol 도구 요청은 `reasoning.encrypted_content`도 요청하고, 반환된 암호화 추론 항목만 도구 이력에 이어 붙인다. 3번째 결과 다음에는 `tool_choice:"none"`; 미등록 도구·중복 ID·다중/초과 호출·형식 불일치는 실패 처리한다. `previous_response_id`에 의존하지 않는다.

## 공개 검색과 첨부자료의 경계

- `searchOpenAIWeb`: 구조화 입력 + 별도 지침/스키마, `web_search` 필수(최대 2개, `low` 검색 문맥, 대략 KR/Asia/Seoul, `action.sources` 요청). 주변 검색은 공개 장소명·주소, 서버 파싱 날짜/시간·범위/제외·이동·음식/관심·예산·허용 특성·인원 **구간**을 보낸다. 후보 제외 목록은 서버가 적용하고 모델에는 대안 검색 여부만 보낸다. 이동 검색은 검증된 공개 출발/도착 구간·수단만 보낸다. 두 웹 분기 모두 전체 채팅이나 파일을 검색 입력으로 보내지 않는다. 채팅에서 쓰는 이 검색은 별도 Google Maps UI/API와 다르다.
- `sourcedResults`/`routeEstimates`는 완료된 검색과 출처/인용 URL 일치, 후보 필드·시간·이동 수단 또는 정확한 구간 ID/출발·도착·수단·분 범위를 검사한다. 식당·관광은 최대 3곳, `evidence:"reported"`이며 근거 없는 값은 배제/비움 처리한다. 링크가 있다는 사실은 영업·예약·정확한 이동시간의 독립 검증이 아니다. 이동은 근거가 있는 구간과 계획용 환승 여유(5~15분)를 서버가 합산한다. 미확인 구간/열차 시각은 추정으로 채우지 않으며 실시간 교통이나 열차 편 조회가 아니다.
- [첨부 파일 경로](../../app/api/files/%5BroomId%5D/%5BdocumentId%5D/route.ts)와 [`lib/server/files.ts`](../../lib/server/files.ts)는 계정·행사방·대화 권한 아래 저장/미리보기/다운로드용이며 일반 AI는 파일명·바이트·본문에 접근할 도구가 없다. 사용자가 직접 붙여넣은 텍스트는 별도 파일이 아니라 입력이다. 제한된 예외인 [`handleRetreatVenueHistory`](../../lib/server/retreat-venue-history.ts)는 `editRoom` 사용자가 지정한 같은 대화의 최대 256 KiB TXT/MD 결과 보고서를 **로컬**에서 읽어 장소와 연도 일치 여부를 확인하고 선택된 이력 필드만 별도 색인에 등록한다. 수련회 접근 권한 아래 등록 이력·비교를 제공하며, 교차 행사 이력 조회는 개인 첨부 원문 공유나 LLM 문서 검색을 뜻하지 않는다.

## 출력·검토·반영

- [`advisorReplyFormat`/`parseAdvisorReply`](../../lib/chat-advisor.ts)의 `event_advisor_reply_v1`: `kind,summary,title,rows[{label,detail}],rationale,proposals[{kind,title,date}]`. `chat`은 요약(최대 1,200자) 외 빈 값, `plan`은 요약 240/제목 100/행 라벨 36·상세 180/근거 480자, 행·제안 각각 최대 4개, 제안 제목 120자다. 파서가 정확한 키·타입·제어문자·날짜를 검증한다. 모델 캘린더 후보는 이번 질문에서 추출한 유일한 명시 날짜와 같은 것만 남고, 체크리스트 날짜는 빈 값이다. 로컬 `calendarWorkProposal`만 조건에 맞는 월/일에 한국 시각 올해를 유추해 표시하며 미지정 시간은 비워 둔다. 타임테이블은 공동 일정과 분리한다.
- [`ChatMessage`](../../lib/types.ts)는 본문과 `advisor`, `workProposal`, `dining`, `nearbyTask`, `venueRoute`, `reference`, `actions`, `replyElapsedMs`를 분리한다. `ChatWorkProposal`은 `calendar | checklist | timetable | survey`이며 `validateRecord("conversations", …)`에서 저장 계약을 검증한다. `chatProposalCandidates`는 일반 AI 제안을 별도 검토용으로 변환하며 과거 태그 형식은 호환 경로일 뿐 현재 출력 프롬프트가 아니다.
- [`ChatWorkCard`](../../components/chat-work-card.tsx)·[`ProposalPanel`](../../components/proposal-panel.tsx) → [`applyProposal`](../../app/prototype-app.tsx) → [`applyReviewedProposal`](../../lib/proposal-application.ts) → `/api/data`의 권한·스코프·개정 검사. 확인 동작 후 공동 일정 또는 내 체크리스트/타임테이블에 적용한다. UI 승인 조건은 공동 일정 `createEvent`와 `editEvent`, 체크리스트/타임테이블 `editChecklist`. 적용은 중복 ID/이름을 처리하고 타임테이블은 기존 안에 병합 검사를 거친다. 서버 연결 시 flush 성공을 기다려 ‘반영됨’을 표시한다. 실제 저장과 검토 결정 저장은 별개로, 후자만 실패하면 별도 안내한다. 장소 후보는 별도 확인 동작이 최신 장소 목록을 읽고 버전 붙여 저장한다.
- [`ChatSurveyProposal`](../../components/chat-survey-proposal.tsx) → [`POST /api/integrations/google-form-drafts`](../../app/api/integrations/google-form-drafts/route.ts) `create-version` → [`createGoogleFormDraft`](../../lib/server/google-form-drafts.ts). 사용자가 연결 계정으로 실행해야 하며 서버가 OAuth 연결·권한·대화·작업 버전을 검증한다. 신규 생성은 시작 시 최신 승인 스냅샷을 고정하고 계정/Google 주체/대화/버전 기준으로 중복을 막는다. Google에는 `unpublished=true`로 만들고 revision이 맞을 때만 문항을 적용한다. 이미 완료한 동일 버전은 편집 링크를 재사용할 수 있고 원격 결과 불명은 자동 재생성하지 않는다. 내부 초안은 Google 생성·게시·응답 접수·캘린더 전송의 증거가 아니다.

## 실패·관측·개인정보

- 요청 JSON 최대 64 KiB, 본문 읽기 10초, 사용자 질문 8,000자, 미응답 시 대화 1,000 메시지와 저장 히스토리 JSON 2,000,000자 한도. 같은 계정×행사방 히스토리는 프로세스 내 `pendingHistories`로 겹치는 답변을 막고(`429`), 응답 ID는 스코프·턴·본문·참조 해시 기반이다. 동일 완료 턴 재시도는 새 답변을 추가하지 않는다. 트랜잭션에서 최신 세션·권한·동의·근거와 레코드 개정/원문을 재확인한다. 충돌은 `409`, 취소 `408`, 미동의 `423`, 개인정보 위반/내부 전용 전송 `422`, 초과 `413`이다. 실패한 일반 AI 답변은 저장하지 않고 질문은 보존해 다시 요청할 수 있다. UI는 423 동의 안내·404/409 재조회 및 현재 요청의 오류를 처리한다.
- OpenAI는 `store:false`, no-store fetch, 프로세스 동시 호출 4개, 응답 body 256 KiB 한도다. 일반 생성 45초는 재주입을 합친 호출 묶음 기준이며 회당 `max_output_tokens:1200`, 최종 텍스트 16,000자 제한이다. 웹 검색은 30초와 2,400 출력 토큰이다. `429`는 속도 제한, 잔액/쿼터 코드는 `503`, 연결/인증·상류 장애도 정제된 `503`, 시간 초과 `504`, 무효/거절/토큰 제한으로 불완전한 응답은 `502`다. 길찾기는 근거 미확인과 링크로, 주변 검색은 실패/근거 부족 안내로 일부 상류 오류를 변환하므로 HTTP 성공이 곧 검색 성공은 아니다. 모호한 후속 해석과 뒤이은 검색/생성은 각각 별도 호출 묶음이다.
- `http.ts`의 `errorResponse`는 통제된 메시지 또는 일반 `500`만 반환한다. 검토한 채팅/Responses 경로에는 원문·키·상류 원본 오류를 기록하는 명시적 런타임 로그나 `usage` 저장이 없다. 저장하는 `replyElapsedMs`는 서버 핸들러 경과 시간이지 모델 전용 지연/비용이 아니다. 계정별 토큰 예산·사용량/비용 집계·분산 제한도 이 경로에 없다. 인프라 로그, 공급자 보존 정책 또는 `store:false` 이상의 보장은 이 감사 범위 밖이다.
- `hasObviousPrivateData`/`requestsPersonalDisclosure`는 정규화 후 패턴 검사이며 공개 검증 주소의 예외가 있다. 일반 입력/문맥, 도구 인자·결과, 채팅의 표시 필드와 일부 웹 결과에 경계별 검사가 있다. 모든 개인정보(예: 표지가 없는 이름/자유문)가 검출된다는 뜻은 아니다. 명단 집계나 원문을 허용하지 않는 서버 투영을 함께 유지하고, 실제 채팅·첨부·로그·키는 평가 자료에 사용하지 않는다.

## 기술 부채와 직접 검증 위치

- **우선 확인:** 프런트 `isLocalQuestion`과 서버 우선순위가 따로 있어 겹치는 의도와 동의 안내를 동일 fixture로 대조해야 한다. 취소는 다음 답변의 문맥 경계이지 모든 작업 삭제가 아니다. `chatInput`은 `event-public-venue-used`는 제외하지만 `preparation-facts-used`는 따로 제외하지 않는다. 준비 집계에서 파생된 이전 답변이 답장/자동 문맥에 다시 들어갈 수 있는지 정책과 회귀 사례를 확인한다. 검색·분류와 일반 도구는 호출 예산 및 재검증 지점이 다르므로 전체 턴 단위 한도/철회 경계를 따로 평가한다.
- **확장 전 확인:** 런타임은 정규식과 제한된 도구의 조합이다. 범용 복합 일정·차량·숙소 작업 계획/동시 조회, 문서 검색, 다중 승인 거래, 일반 작업 상태 버저닝은 확인되지 않았다. 설문은 보호된 기본 템플릿 및 한 문항 패치 중심이다. 사전/직후 근거 검사·응답 서명·범위 경계가 새 도구에도 유지되는지 검증하고, 답변 형식 통과를 사실 정확성/실행 성공으로 해석하지 않는다.

| 확인 대상 | 바로 볼 테스트(소스 위치, 이번에는 미실행) |
| --- | --- |
| 진입·실행 우선순위·전송 경계·재시도 | [`tests/server-chat.test.ts`](../../tests/server-chat.test.ts): `grounds planning advice…`, `selects survey creation…`, `does not save a staged work version…`, `bounds recent context…`, `uses only an explicitly selected eligible reply…`, `rejects wrong permissions…`, `explains when the model reaches its token limit…`. |
| 도구·웹 검색·상태 | 같은 서버 테스트의 `looks up the same room's public venue…`, `looks up both connections…`, `patches a nearby task…`, `uses a request-only override…`, `uses bounded model interpretation…`, `does not persist estimates when…`; [`tests/chat-continuity.test.ts`](../../tests/chat-continuity.test.ts), [`tests/chat-work-state.test.ts`](../../tests/chat-work-state.test.ts), [`tests/chat-survey-draft.test.ts`](../../tests/chat-survey-draft.test.ts). |
| 전송 설정·장애·준비 완료 | [`tests/chat-openai.test.ts`](../../tests/chat-openai.test.ts)(가짜 fetch, 기본 Luna/명시 Sol/미설정/쿼터); [`tests/preparation-progress.test.ts`](../../tests/preparation-progress.test.ts)(모의 집계, 미호출·100% 제한·근거 변경·복원). |
| 저장·승인·파일 | [`tests/chat-panel.test.tsx`](../../tests/chat-panel.test.tsx), [`tests/event-workspace.test.tsx`](../../tests/event-workspace.test.tsx), [`tests/proposal-panel.test.tsx`](../../tests/proposal-panel.test.tsx), [`tests/proposal-application.test.ts`](../../tests/proposal-application.test.ts), [`tests/chat-calendar-capture.test.tsx`](../../tests/chat-calendar-capture.test.tsx), [`tests/google-form-drafts.test.ts`](../../tests/google-form-drafts.test.ts), [`tests/server-records.test.ts`](../../tests/server-records.test.ts), [`tests/server-file-route.test.ts`](../../tests/server-file-route.test.ts), [`tests/retreat-venue-history.test.ts`](../../tests/retreat-venue-history.test.ts). |

## 후속 기준선 레시피 (#35 / #36 / #40, 미실행)

[로컬 이슈 로드맵](issue-roadmap.md)에 맞춰 #35 감사 → #40 현행 동결 → #36 변경 검증 → #40 회귀 → #35 인수 검수 순으로 진행한다. 새 의존성 없이 기존 `pnpm`/Vitest·인메모리 SQLite·가짜 `fetch`와 Node.js 표준 기능을 재사용한다.

1. **#35 인수인계 / #40 현행 동결.** 합의한 소스의 SHA뿐 아니라 관련 파일 해시(추적되지 않은 AI 모듈 포함), 모델명, 조합된 지침/스키마 버전, 동의·스타일, 도구 목록과 상한, 합성 fixture ID, 고정 시각/시간대 및 초기 DB 상태를 남긴다. 프롬프트 수정 전 현행 코드로 예상 분기와 금지 동작을 기록한다. 로컬 0회, 준비 조언, 설문 생성→표시→패치/낡은 인용, 주변 검색→조건 변경/취소, 출처 빈 결과, 날짜 모호성, 스코프 교차, 동의 철회, 형식·타임아웃, 승인 전후 쓰기를 포함한다. 예: `pnpm exec vitest run tests/server-chat.test.ts tests/chat-openai.test.ts tests/chat-continuity.test.ts tests/chat-work-state.test.ts tests/preparation-progress.test.ts` (후속의 표적 모의 실행 예시).
2. **#36 프롬프트·문맥·도구.** 동일 모델·합성 입력/문맥·스키마·도구/모의 근거·옵션에서 지침만 A/B로 바꾸는 비교를 먼저 설계한다. 정답·날짜/계산 방향, 불확실성, 근거 적합성, 도구 선택, 확인 질문 수, 금지 정보 및 무단 실행 주장 여부를 질문별로 채점한다. 서버 변경은 별도 비교한다. 첫 복합 검수는 준비 누락 또는 타임테이블 식사 구간처럼 좁은 읽기 사례에서 최신 근거·권한·승인 경계를 대조한다. 문맥·도구·서버 동작까지 바뀐 결과를 프롬프트 단독 효과로 계산하지 않는다.
3. **#40 평가·회귀 / #35 인수 검수.** 같은 입력 묶음을 저장 턴→라우팅→도구/재주입→저장→별도 승인까지 재생한다. 케이스별 예상/실제 분기·도구·출처 상태, 호출 순서/횟수·오류 분류·저장 전후·재시도/사용자 개입 수를 기록한다. 권한 누출·승인 없는 쓰기는 0건이 통과 조건이다. 지연은 턴과 모델 라운드를 분리해 표본 수와 중앙값/상위 지연을 보고한다. 승인된 실제 평가에서만 입력/출력 토큰을 라운드별 합산하고(없으면 `미측정`) 비용은 적용 시점의 단가와 함께 기록한다. 관측 자료에는 케이스 ID·모델·경로·시간·토큰·정제 오류만 남긴다. 모의 계약·모델 품질·실제 통합·사용자 확인은 별도로 보고하며, 사용자 피드백은 비식별화해 회귀 케이스로 남긴다.

[`tests/chat-advisor-live.test.ts`](../../tests/chat-advisor-live.test.ts)는 기본 비활성인 과거 평가 진입점이다. 두 공통 문자열만 결합해 Luna에 가상 8문항을 직접 호출하고, 합성 답변과 시간·사용량을 로컬 결과에 남긴다. rc.25 전체 지침·라우팅·도구 기준선이 아니므로 [이전 파일럿 수치](../assistant-pilot-evaluation.md)를 현재 실측치로 재사용하지 않는다. 실제 A/B는 별도 승인·격리 계정·호출/비용 한도를 결정한 뒤에만 시행한다.
