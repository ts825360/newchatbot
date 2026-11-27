# 행사 운영 기능 인수인계

**감사 기준: 2026-11-27, `0.2.0-rc.25` 작업 트리.** [package.json](../../package.json)과 [변경 이력](../../CHANGELOG.md)의 버전을 기준으로 현재 소스를 읽었다. 현재 브랜치는 `codex/google-connection-diagnostics`, `HEAD`는 `7775593`(`v0.2.0-rc.15`), 로컬에 rc.25 태그는 없었다. 따라서 아래는 rc.25 작업 트리의 감사이며, 태그·원격 소스·배포 이미지가 일치한다는 확인은 아니다. [요구사항 원문 P6·P7·P11·P14](../requirements/brief-v2.md)과 [요구사항 추적](../requirements/traceability.md)의 `SUR`, `CTX`, `ROST`, `VEH`, `P-11`, `P-13`을 대조했다.

## 운영 흐름과 저장 경계

```text
대화별 설문 초안 → 명시적 승인 → Google 미게시 초안 → Google에서 게시·공유
Google 응답 읽기 또는 CSV 선택 → 미리보기·검토 → 내 행사방 명단
  ├─ 출발/귀가 조건·차량·동승 검토 → 최초 초안 → CP-SAT 작업안 → 임시저장/확정 → CSV
  └─ 숙소 희망·가족 ID·객실 정원 → 규칙 배정 → 호수·이동·고정 → 저장
대화별 첨부 → 사적 파일 및 미리보기 → 일부 TXT/MD만 제한적 발췌 또는 이력 등록
```

| 범위 | 실제 저장·권한 경계 |
| --- | --- |
| 같은 계정의 같은 행사방 | 차량·명단·반영한 설문 응답·숙소는 `records(kind='transport')` 한 행의 `data_json`에 들어간다. 내부 키는 `room-work-v1:<계정>:<행사방>:transport`. 대화를 바꿔도 같은 계정·행사 자료를 사용하며, 다른 계정과 공유하는 공동 명단은 아니다. 기존 대화별 작업 기록은 새 키가 없을 때 유효한 스냅샷 하나를 선별해 승계한다. |
| 계정 + 행사방 + 대화 | 설문 작업 버전은 `chat_work_versions`, 첨부 목록은 `records(kind='documents')`, 파일 바이트는 `conversation_files`. 대화 소유권은 세션 계정으로 확인한다. 같은 행사방의 다른 대화나 다른 계정의 첨부를 열 수 없다. Google OAuth 연결 자체는 앱 계정별이다. |
| 공동 행사 자료 | 행사 기본정보의 `rooms`, 공동 캘린더의 `records(kind='events', owner_id=NULL)`는 위 개인 운영 기록과 별개다. 차량·숙소 저장으로 공동 일정이 자동 변경되지 않는다. |

[SQLite 스키마](../../lib/server/database.ts), [서버 스코프](../../lib/server/conversation-scope.ts)의 `canonicalWorkspaceTool()`·`requireOwnedConversation()`·`inheritWorkspaceRecords()`, [데이터 API](../../app/api/data/route.ts)의 `GET/POST /api/data`, [저장 로직](../../lib/server/records.ts)의 `readSnapshot()`·`writeBatch()`가 출발점이다. 개인 작업 읽기는 `viewRoom`·`chat` 및 소유 대화, 차량·숙소 쓰기는 여기에 `editChecklist`가 필요하다. 파일 쓰기는 `editChecklist` 대신 `uploadDocument`를 확인한다. `records.revision`은 동시 저장 충돌을 막는 토큰(불일치 시 `409`)이며, 차량 `input.revision`이나 설문·배정의 보관 버전 번호와 다르다.

## 설문과 Google Forms

**초안.** [채팅 서버](../../lib/server/chat.ts) `handleChat()`(`POST /api/chat`)의 빠른 경로와 모델 도구가 [작업 저장소](../../lib/server/chat-work-store.ts) `createWorkSession()`을 사용한다. 행사 이름을 서버가 적용하고, `chat_work_versions`에 `(owner_id, room_id, conversation_id, work_id, version)` 단위로 저장한다. 같은 대화의 초안 다시 열기·재생성, 한 문항 추가·변경·삭제를 지원한다. 문항 ID와 구버전 스냅샷을 보존한다. 제목·설명이나 임의의 분기 구조를 편집하는 화면, 전체 이력 UI, 범용 다단계 작업은 별도다.

**템플릿 차이.** [기본 설문](../../lib/retreat-survey-template.ts)의 `retreatSurveyTemplateV2`가 신규 초안이다. 참석·불참 중 불참은 즉시 제출하고, 참석자 정보는 소속 → 이름 → 선택 성별(응답하지 않음 포함) → 숙소 희망 순이다. 가족 ID는 묻지 않는다. 예전 단일 이동수단 문항은 선택지 세 개와 직접 입력 기타로 구성되지만, v2는 출발과 귀가를 분리한다. 각 방향에 자차·단체·가족 차량·다른 참가자 차량·기타가 있고, 귀가에는 명시적 ‘출발할 때와 동일’과 ‘미정’이 추가된다. 분기별로 제공자 여부, 기존 동승자, 제공자 이름, 추가 탑승 가능 인원, 기타 이동 방법을 필요한 경우에만 묻는다. 추가 좌석은 Google 쪽에서 숫자 전용이 아닌 단답형이고 가져올 때 해석한다. [채팅 카드](../../components/chat-survey-proposal.tsx)는 저장 버전의 문항과 분기를 그린다. 버전 없는 구 카드는 v1 표시용이며 그대로 직접 생성하지 않는다.

| 경로 | 실제 동작과 제한 |
| --- | --- |
| [`/api/integrations/google-form-drafts`](../../app/api/integrations/google-form-drafts/route.ts) `GET/POST` | 생성 연결은 `drive.file`·`openid`, 읽기 연결·Calendar와 분리된다. `viewRoom`이 필요하고 행사 대화 지정 시 `chat`과 소유권도 확인한다. 카드의 `create-version`은 `createGoogleFormDraft()`가 요청한 버전을 서버에서 다시 읽고 **처음 생성에 착수할 때 최신인지** 확인한다. `unpublished=true` 생성 후 문항·분기를 `requiredRevisionId`가 붙은 `batchUpdate`로 적용한다. 이미 착수한 뒤 편집돼도 승인한 스냅샷만 반영한다. 계정·Google 계정·스코프·작업 버전별 중복 생성 방지, 완료 URL 재사용, 원격 결과 불명확 시 자동 재호출 금지가 있다. 알려진 폼의 문항 쓰기가 실패하면 편집 링크와 경고로 넘긴다. 제목만 받는 별도 생성 경로는 현재 기본 v2를 사용한다. 앱에서 자동 게시·응답 접수 시작·공유 권한 부여를 하지 않는다. |
| [`/api/integrations/google-forms`](../../app/api/integrations/google-forms/route.ts) `GET/POST` | `forms.body.readonly`·`forms.responses.readonly`. `account-preview`는 `viewRoom`으로 본인 OAuth 연결에서 읽기만 한다. 행사 `preview`는 `chat`·`editChecklist`·소유 대화까지 검사하고, 조회 후 현재 세션·연결 세대도 확인한다. 실제 Google Forms 편집 URL만 받아 문항 ID로 답을 정렬한다. 자동 수집 이메일이나 파일 업로드 답을 가져오지 않지만, 사용자가 문항이나 자유 답변에 적은 개인정보까지 제거하는 기능은 아니다. 페이지네이션으로 최대 응답 500개, 문항 열 2~40개를 다룬다. 첨부하거나 명단을 곧바로 변경하지 않고 미리보기만 반환한다. 응답자 링크가 있으면 표시할 수 있으나 공유를 실행하지 않는다. |
| [`/api/preparation-surveys`](../../app/api/preparation-surveys/route.ts) `GET` | `readPreparationSurveyCounts()`가 해당 계정·행사·대화의 서로 다른 설문 작업 ID와 생성 완료된 Google 초안 건수만 세어 `{ drafts, forms }`를 반환한다. 응답자 수, 게시 여부 또는 폼 원문을 조회하는 API가 아니다. |

추적 함수: [생성](../../lib/server/google-form-drafts.ts)의 `createGoogleFormDraft()`·`templateRequests()`, [생성 OAuth](../../lib/server/google-form-drafts-auth.ts), [읽기](../../lib/server/google-forms.ts)의 `previewOwnGoogleForm()`·`previewConversationGoogleForm()`, [응답 정규화](../../lib/google-forms-import.ts)의 `formIdFromEditorUrl()`·`formResponseSurvey()`, [공통 OAuth 콜백](../../app/api/integrations/google/callback/route.ts). 읽기/생성 연결은 각각 `google_forms_auth`/`google_form_draft_auth`, 생성의 중복 방지·원격 폼 ID·완료 여부는 `google_form_drafts`에 들어간다. 실제 가져온 응답은 별도 Google 응답 테이블이 아니라 `transport.survey` 스냅샷에 저장된다. 연결 해제로 이미 가져온 데이터가 삭제되지는 않는다.

## 명단 식별, 가족, 이동 방향

- [가져오기 UI](../../components/transport-survey-form.tsx)와 [매핑·반영](../../lib/transport-survey.ts)의 `parseSurveyCsv()` → `defaultSurveyMapping()` → `analyzeSurvey()`로 열과 참석·불참·확인 필요를 구분한다. 이름·참석 여부가 필수 매핑이며, 확인 필요가 남으면 반영을 막는다. 불참 응답은 명단에 넣지 않는다. CSV는 UTF-8, UI 파일 한도 128 KiB, 데이터 한도 2~40열·500응답, 최종 배정 명단 최대 250명이다. 운영 화면은 실제 작업에 차량을 등록한 뒤 설문을 반영하도록 안내한다.
- `mergeGoogleSurvey()`는 `(폼 ID, 응답 ID)`의 해시로 `GF-…` 참가자 ID를 만들어 **신규 참석자만 추가**한다. 같은 응답 수정·취소는 미리보기에서 확인할 수 있지만 기존 참가자를 자동 수정·삭제하지 않는다(신규 추가 시 현재 확정 상태는 해제). CSV `surveyTransportInput()`은 새 참가자 ID로 명단을 교체하고 참가자 운전자 지정·잠금·이전 작업 배정을 초기화한다. 이미 보관한 배정 버전은 같은 운영 기록에 남는다. CSV를 다시 가져오더라도 별명/동명이인 병합이나 기존 `GF-…` ID 재사용은 하지 않는다.
- 정규화한 이름+소속 중복은 검토 표시이며 동일인 판정이 아니다. 미리보기에서 중복을 확인하고 별도 인원으로 반영한다는 체크가 필요하지만, 다른 응답 ID를 교회 기준 명단이나 가족 관계로 자동 합치지 않는다. `ROST-01/02`의 교회 비공개 기준 명단, 관리자 발급 영구 가족 ID, 다중 조건 신원 확정·안전한 임시 배정·정정 후 영향 재계산은 미구현이다. 이전 양식·CSV의 가족 ID는 v1 호환으로 읽는다. 방향별 문항을 인식한 새 응답의 가족 ID는 반영하지 않으며, 가족 동승 표기가 곧 가족 ID나 같은 방의 근거가 되지 않는다. 성별도 명시 응답만 사용한다.
- [방향별 해석](../../lib/transport-movement.ts)의 `readDirectionalSurveyMovement()`는 출발·귀가와 실제 답이 있는 분기를 따로 읽는다. 귀가는 ‘동일’을 선택할 때만 출발 응답을 복제한다. 명시적 개별 이동은 해당 방향의 차량 수요에서 제외하고, 명시한 단체편은 일치하는 이동편으로 연결한다. 제공자·동승 약속, 픽업, 분기 응답 충돌·모호한 좌석·미정은 자동으로 차량 배정하지 않는다. `importDirectionalLeg()`가 필요한 경우 확인 필요 상태로 두어 계산 전에 검토한다. 이전 양식의 왕복 자차·단체 이동 등과 기본편 매핑은 호환 경로다. ‘v2 미응답 미추정’과 ‘v1 기본편 호환’을 같은 규칙으로 설명하지 않는다.
- `projectTransportMovement()` → `reviewTransportOffers()` → `applyTransportOffer()`는 확인된 제공자 ID당 한 대, 방향별 기존 동승자와 신고 추가좌석을 분리한다. 정확한 이름 후보가 여럿이거나 동승 주장이 불일치하면 임의 연결하지 않는다. 운영자가 제공자를 운전자로 지정한 활성 개인 차량 한 대와 방향별 운행편을 준비해 검토해야 한다. 총좌석·운행 방향·기존 동승·잠금이 맞을 때만 이동편/동승 잠금과 한도를 적용한다. 차량 단일 `capacity`에는 방향별 한도 중 더 보수적인 값을 쓰므로, 방향별 여유 집계가 방향별 solver 정원 필드로 저장되는 것은 아니다.

## 차량: 계산, 보관, 비용, 내보내기

- **계산:** [차량 패널](../../components/transport-panel.tsx) `calculate()` → [`POST /api/transport`](../../app/api/transport/route.ts) → [Python solver](../../scripts/transport_solver.py) `solve()`. 세션·`editChecklist`·행사 존재를 검사하고 스코프 전달 시 `chat` 및 대화 소유권도 확인한다. Node가 로컬 Python/OR-Tools에 JSON을 stdin으로 전달하고 결과만 받으며, API 호출 자체는 저장·확정하지 않는다. 동일 프로세스 한 번에 한 건, 입력·출력 400,000바이트, 자식 프로세스 20초, CP-SAT 단계당 3초 제한이다. UI 요청에서 메모·숙소 배정·설문 이동 원문을 제외한다. GPT나 외부 길찾기 계산이 아니다.
- **조건과 우선순위:** 출발/귀가별 인원 수요와 가상 추가 좌석(0~50명), 차량 가용 편·정원, 운전자 탑승 또는 확인된 외부 운전자, 차량/운전자 재사용의 시각·장소 충돌, 방향별 필수 동반과 잠금을 제약으로 쓴다. 실제 미배정 최소화 → 가상 좌석 부족 최소화 → 이전 배치 변경 최소화(이전 배정 제공 시) → 선택한 소속 우선 분산 감소/대여비/동점 항목 순이다. 시간 내 찾은 `feasible`과 최적성 확인 `optimal`을 구분하며 `infeasible`·`unknown`도 반환한다. 등록한 출발·도착·픽업·시각은 실도로 소요 시간, 환승 가능성, 예약의 증거가 아니다.
- **이력과 확정:** [버전 로직](../../lib/transport-versions.ts) `buildTransportDraft()`는 잠금·알려진 운전자만 넣고 나머지는 미배정으로 둔다. 첫 실제 계산 전 저장하며 이후 재계산에서 최초본을 덮어쓰지 않는다. ‘최적화안’은 현재 편집·수동 이동·잠금 대상, ‘임시저장’은 그 작업안의 읽기 전용 복사본, ‘확정’은 별도 검토·저장 후의 버전이다. `drafts`/`saved`/`confirmed`는 각 20개 상한의 추가 전용 배열이며 옛 스냅샷에 없던 이력을 소급 생성하지 않는다. 수동 이동과 확정은 [검증](../../lib/transport.ts) `validateTransportResult()`를 거친다. 현재 버전 불일치, 미배정, 가상 좌석 부족, 필수 조건 위반 시 확정을 막고, 서버의 `checkTransportVersionWrite()`가 이력 변경·삭제·순서 변경을 `409`로 거절한다. 권한은 관리자 직급 전용이 아니라 해당 계정의 `editChecklist` 기준이다. ‘명단 확정’은 `rosterFingerprint()`의 ID·이름·소속 기준 표시이며 법적 신원 확인이나 차량 확정의 필수 승인 단계는 아니다.
- **비용과 비교:** [비교 로직](../../lib/transport-comparison.ts) `buildTransportComparisonSummaries()`는 현재안·최초 초안·임시저장본을 비교하고 방향별 여유 좌석·미배정·가상 좌석·차량 출처/차종·알 수 있는 변경 인원과 비용을 표시한다. 왕복은 이용 차량당, 편도는 실제 사용 편수, 일 단위는 등록 일수를 곱한다. `costMetrics()`는 대여 견적과 기타비를 분리하고 누락이 있으면 총액을 미확인 처리한다. solver는 활성 대여차 중 견적 미확인이 있으면 비용 순위를 목적식에서 제외하며 기타비는 최적화하지 않는다. `result.cost`는 사용 대여차의 기본 금액 합인 호환 필드로 단위 적용 견적이나 정산 총액과 다르다. A/B 대여 견적 순위는 수요 지문이 같고 두 안 모두 유효하고 두 견적이 알려질 때만 표시된다. 지문은 ID·소속·이동편/시각·동반·가상 수요·잠금 기준이므로 경로나 등록 장소의 동일성을 보증하지 않는다.
- **비교 설명과 CSV:** [`POST /api/transport/compare`](../../app/api/transport/compare/route.ts) `handleTransportComparison()`은 권한·스코프와 저장된 A/B 지표 일치를 재검증한다. [서버 구현](../../lib/server/transport-comparison.ts)은 이름/차량 라벨 대신 비교 사실을 사용해 문장을 조합하며 모델 호출·저장이 없다. CSV는 별도 API가 아니라 `transportWorkingCsv()`(초안/최적화안/확정, 방향별 전체·개별·차량), `transportReservationCsv()`(확정의 가상 좌석표), `transportRosterCsv()`(참가자 명단)로 브라우저에서 만든다. UTF-8 BOM, 인용과 스프레드시트 수식 방어를 적용한다. 확정 CSV만 가능한 것은 아니다. 배정 CSV에는 이름·소속·가족 ID가, 명단 CSV에는 특이사항도 들어갈 수 있으므로 공개 산출물로 취급하지 않는다.

VEH 요구와 차이가 큰 지점은 도로 이동 가능성 검증, 방향별 정원을 solver에 독립 적용하는 것, 기타비를 고려한 비용 최적화, 일정·숙소·명단 변화의 복합 AI 영향 분석이다. rc.25는 공통 내비게이션·패널 전환 상태를 정리한 버전이며 위 차량 저장·계산 핵심은 rc.24에서 이어진다.

## 숙소: 원본 요구와 현재 동작

| 원본 요구 및 세부 기준 | rc.25 구현과 남은 차이 |
| --- | --- |
| 기존 숙소 정보와 배정 기능 활용(P6) | [숙소 관리](../../components/transport-lodging.tsx) `TransportLodging`이 같은 `transport.input.people`를 사용한다. `initialLodgingPlan()`은 기존 `roomAssignment` 호수를 유지하되 정원을 추정하지 않는다. 자료의 장소 이력이나 외부 숙소 검색이 객실 재고·예약과 연결되는 것은 아니다. |
| 객실 수용 인원과 배정 조건 확인(P6, SUR-02) | [배정 규칙](../../lib/lodging-plan.ts) `lodgingPreference()`·`calculateLodging()`은 개인 1인실, 가족별 가능한 최소 정원(기본 2·4·6), 단체방 정원(기본 8)을 사용한다. 가족 ID가 없거나 숙소 유형·단체 그룹이 불명확하면 보류한다. 청년부·청소년부는 소속과 명시 성별 또는 운영진 지정으로 분리한다. 기존 호수·고정 방은 재계산에서 보존한다. 가용 객실 재고를 받아 최적화하는 것이 아니라 필요한 수와 배치를 규칙으로 계산한다. |
| 개인별 상세는 권한 있는 관리 기능에서 처리(P6·P11) | 운영 화면에서 미배정 확인 → 유형·그룹 지정 → 자동 배정/수동 이동 → 호수·정원·고정 순으로 처리할 수 있다. `moveLodgingPerson()`은 같은 유형·그룹과 정원, 잠금을 확인하고 가족을 함께 움직인다. 저장은 `lodgingPlan`과 참가자의 `roomAssignment`를 같은 `transport` 스냅샷에 반영한다. 전용 숙소 테이블·API·별도 확정 이력은 없고, 이름이나 성별/방 배정 원문을 준비 상담 모델에 제공하지 않는다. 잠금과 방 이동은 관리 UI/계산 규칙이며 서버는 `isLodgingPlan()`으로 구조·중복 제약을 확인한다. 차량 같은 과거 상태 대조나 모든 객실 운영 규칙을 서버에서 재검증하는 구조는 아니다. |
| 필요한 경우 대안 제안, 승인과 반영 구별(P6·P7, P-11·UI-02·ORC-02) | 객실 수·배정/미배정·호수 등록 수와 준비 상태 집계는 있다. UI에서 조건을 바꿔 다시 계산하는 것과, AI가 조건별 대안을 비교해 승인 카드로 적용하거나 실제·가상 차량/숙소 수요를 함께 시뮬레이션하는 것은 다르다. 후자는 연결되지 않았다. |

## 문서·산출물: 비공개 보관과 제한적 활용

- **파일 저장:** [자료 패널](../../components/documents-panel.tsx) `DocumentsPanel` → [저장 어댑터](../../lib/server-blob-store.ts) `createServerBlobStore()` → [`/api/files/{roomId}/{documentId}`](../../app/api/files/[roomId]/[documentId]/route.ts). `GET`은 파일·참조 여부·정리목록, `PUT`은 업로드, `POST`는 정리 의도 등록/해제, `DELETE`는 바이트 삭제다. 서버 연결에서는 SQLite `conversation_files`에 BLOB, 대화별 `records(kind='documents')`에 목록·제목·고정·파일 메타데이터를 보관한다. `files`는 기존 방 단위 스키마이며 이 비공개 경로의 저장소가 아니다. 브라우저 단독 모드의 IndexedDB는 별도이며 서버 저장 증거가 아니다.
- **파일 권한과 생명주기:** [파일 서비스](../../lib/server/files.ts) `requireFileScope()`는 세션 계정으로 `viewRoom`·`chat` 및 소유 대화를 확인하고 변경 시 `uploadDocument`를 추가한다. 파일당 5 MiB, 계정·행사방 전체 100 MiB/1,000개(대화 합산, 정리 대기 포함), 같은 ID 덮어쓰기 금지. `saveDocumentFile()`이 바이트를 임시 상태로 저장하고 메타데이터의 서버 확인 후 정리 표시를 해제한다. 실패 시 참조를 다시 확인하고, 참조가 남거나 검증 불가하면 삭제하지 않는다. 대화 삭제 시 첨부 목록과 BLOB을 함께 정리한다. 응답은 `attachment`, `private, no-store`, `nosniff`, 샌드박스 CSP로 내려준다. 공개 정적 파일·공유 링크·암호화된 파일 금고나 악성 파일 검사를 의미하지 않는다.
- **형식과 미리보기:** [형식·미리보기](../../lib/document-files.ts)의 `documentFileMetadata()`·`prepareDocumentPreview()` 기준, PDF·DOCX·TXT·MD·CSV·PNG/JPG/JPEG/GIF/WebP를 앱에서 미리 볼 수 있다. TXT·MD는 일반 텍스트, CSV는 제한된 표(파싱 실패 시 텍스트), [DOCX](../../lib/word-preview.ts)는 본문 문단·표를 구조화된 텍스트로 읽고, [PDF](../../components/pdf-document-preview.tsx)는 PDF.js로 렌더링한다. 이미지/PDF는 미리보기 전에 시그니처를 확인한다. HWP/HWPX/DOC/ODT/RTF, XLS/XLSX/ODS, PPT/PPTX/ODP는 다운로드 전용이다. 업로드 허용, 화면 미리보기, AI 추출 가능 여부는 서로 다른 기능이다.
- **추출과 이력:** [`GET /api/retreat-preparation`](../../app/api/retreat-preparation/route.ts)의 [참고 발췌](../../lib/server/retreat-references.ts) `readRetreatReferences()`는 같은 대화에 고정한 과거·요람·인수인계 계열 TXT/MD(파일당 256 KiB 이하) 중 과업 키워드에 맞는 줄을 제한적으로 표시한다. AI 채팅 이력·외부 모델 입력으로 원문을 넘기는 경로가 아니다. [`/api/retreat-venues`](../../app/api/retreat-venues/route.ts)는 수련회 결과 보고서 TXT/MD를 `editRoom` 권한자가 수동 등록할 때 `extractReportVenue()`로 일시/장소가 맞는지 확인해 장소명·연도·제한된 특징만 `retreat_report_venues`에 담는다. 수련회 조회에는 등록 요약이 행사방·계정을 넘어 표시될 수 있지만 원본 파일은 계속 비공개다. 원본 삭제/참조 해제 시 요약 조회에서도 제외된다. 첨부한 문서에 적힌 지시문이 권한을 얻거나 일정·체크리스트를 자동 생성하지 않는다. 연결되지 않은 브라우저 모드의 예시 회의록에서만 샘플 제안 동작이 있다.
- **산출물과 비범위:** 설문 카드·체크리스트/일정 제안은 구조화된 작업/제안이며 첨부 파일이 아니다. 차량 CSV는 내려받을 때 만드는 브라우저 산출물로 `conversation_files`에 자동 보관하지 않는다. 자료 탭에 올린 파일만 첨부 흐름을 따른다. 임의 PDF·DOCX·HWP의 서버 텍스트 추출, OCR, 전 문서 색인·임베딩·벡터 검색/범용 RAG, 자료를 외부 모델에 넘기는 자동 파이프라인은 확인되지 않았다. 현재 준비 상담은 [준비 근거 도구](../../lib/server/chat-preparation-tool.ts) `readPreparationFacts()`의 허용된 집계와 자료 존재 유무를 본다. 자유 형식에서 개인정보 검출이 완전하다는 보장은 아니다.

## 검증 근거와 인수 우선순위

| 구분 | 확인 범위 |
| --- | --- |
| 이번 감사에서 직접 실행 | 로컬 Python 환경으로 `python -X utf8 -B -m unittest discover -s tests -p transport_solver_test.py`: [합성 CP-SAT 테스트](../../tests/transport_solver_test.py) 20개 통과. 계산 규칙의 단위 테스트이며 Node API·저장·화면·실차 운행의 E2E가 아니다. |
| 설문/Google 테스트 소스 | `tests/chat-survey-draft.test.ts`, `chat-survey-proposal.test.tsx`, `server-chat.test.ts`: 초안/버전/카드·채팅. `google-form-drafts.test.ts`, `google-forms-account.test.ts`, `google-forms-import.test.ts`, `google-forms-preview.test.tsx`: 모의 OAuth/API, 분기, 구버전·타 스코프 거절, 중복 요청·부분 실패, 읽기와 반영의 분리. `transport-survey.test.ts`, `transport-movement.test.ts`: 구양식·방향별 미정·가족/동명이인/좌석 충돌. |
| 차량·숙소 테스트 소스 | `tests/transport-api.test.ts`: API 경계. `transport.test.ts`, `transport-versions.test.ts`, `transport-panel.test.tsx`, `transport-comparison.test.ts`, `transport-comparison-api.test.ts`, `server-records.test.ts`: 배치/이력/CSV, 스코프·버전·비용 비교. `lodging-plan.test.ts`와 `transport-panel.test.tsx`: 150명 합성 배정, 가족/단체 분리, 미배정·정원·잠금, 저장 및 차량 승인과 분리. |
| 문서 테스트 소스 | `tests/document-files.test.ts`, `documents-panel-server.test.tsx`, `server-blob-store.test.ts`, `server-files.test.ts`, `server-files-route.test.ts`, `server-file-route.test.ts`: 형식과 미리보기, BLOB/정리·실패 복구, 권한 경계. `retreat-preparation-read.test.ts`, `retreat-venue-history.test.ts`: 제한 발췌·등록 요약과 원문 외부 전송 제외. 위 TypeScript 테스트들은 이번 감사에서 재실행하지 않았다. |
| 저장소의 이전 검증 기록 | [요구사항 추적의 이전 결과](../requirements/traceability.md): rc.24 전체 Vitest 1,054 통과/실 OpenAI 1건 건너뜀, Python 20 및 Docker 빌드, 합성 브라우저에서 최초 초안·임시저장·확정 CSV·이력 변경 거절을 확인했다고 기록. rc.25는 Vitest 1,059 통과/실 OpenAI 1건 건너뜀, Docker/TypeScript와 Chrome 1440·1024·390px 내비게이션/상태 보존을 기록했다. 이번 감사에서 해당 빌드와 브라우저 결과를 재현하지 않았다. |

다음 검증은 실제 데이터를 쓰지 않는 격리 환경에서 진행한다. 우선 전용 테스트 Google 계정으로 OAuth 읽기·미게시 생성·편집/게시 후 재가져오기를 분리해 확인한다(`EXT-08`). 이어 같은 사람의 복수 응답·동명이인·가족 미확인·편도 충돌을 합성한 사례로 관리자 판정과 기존 잠금/확정 보존 기준(`ROST-01/02`)을 먼저 정한다. 숙소 대안 비교 및 문서 활용을 확장할 때는 개인별 배정과 원본 파일의 접근 범위를 유지하고, 화면 동작·서버 저장·외부 전송을 별도로 검증한다. 이번 감사는 비밀 파일·운영 DB·실제 응답을 열지 않았고 실제 Google/OpenAI 호출, 운영 배포, Git 커밋·푸시를 하지 않았다.
