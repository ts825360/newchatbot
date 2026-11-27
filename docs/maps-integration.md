# Google Maps 장소 연동

현재 로컬 rc.22를 조사했을 때 Maps Embed 키·Places 키·Routes 키가 컨테이너에 없었다. Google Calendar/Forms OAuth 연결과 별도이며, 기존 외부 Google Maps 링크는 키 없이 사용할 수 있다.

| 기능 | 설정 | 운영 확인 |
| --- | --- | --- |
| Maps URLs | 불필요 | URL만 생성. 현재 영업·경로를 앱이 읽지는 않음. |
| Places API (New) | `GOOGLE_PLACES_API_KEY` | `.env.google.local` 등 운영 환경에서만 설정. 서버 키를 Places API (New), 고정 서버 출구 IP 등에 제한. 사진·상세 필드는 별도 과금 대상이 될 수 있음. |
| Routes API | `GOOGLE_ROUTES_API_KEY` | 별도 서버 키를 Routes API에 제한. 도보·운전·대중교통. 주행은 실시간 교통 미반영. |
| 앱 내 지도 | `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` | 기존 Maps Embed API용 **브라우저 키**를 빌드 때 전달하고 서비스 주소 리퍼러 및 Embed API로 제한. 서버 키를 여기에 넣지 않음. Maps JavaScript API는 설치·호출하지 않음. |

- 조회는 사용자 동작으로만 시작한다. 장소 목록, 패널 전환, 새로고침에서 Google Places/Routes를 자동 호출하지 않는다. 기본 한도는 분당 계정당 12개 요청, 동시에 5개, 4.9초이며 한 요청에서 주변·사진은 최대 두 번 Google을 호출한다. Google Cloud의 프로젝트별 할당량과 예산 알림도 별도로 설정해야 한다.
- 주소·시설 안내·분류·비공개 메모는 운영자가 작성한 내용이다. Google 결과는 화면에서 출처와 함께 일시적으로 표시하고 API 결과 이름·주소·사진·평점·리뷰·경로를 DB에 복제하지 않는다. 선택한 공개 장소 ID만 사용자 입력 구분명과 저장한다. 사진은 저자 등의 출처를 확인할 수 있을 때 명시적 상세 조회에서만 제공한다.
- 비공개 메모, 사용자 명단, 대화 원문, 내부 파일을 Google Maps로 전송하지 않는다. 자유 검색은 공개 시설명 전송 확인이 필요하며 서버에서 개인정보 패턴과 주소 형식을 추가로 점검한다. 이 확인은 모든 자유 입력이 공개 자료임을 서버가 보증한다는 뜻은 아니다.
- AI 준비 조회는 저장 장소의 등록 상태·유형 집계만 읽는다. 기존 대표 장소 공개 정보, 웹 검색, 장소 반영 승인 및 수련회 이력 경로는 유지한다. Google Places/Routes 원본 결과와 장소별 비공개 메모는 GPT로 보내지 않는다. Google 제공 자료를 이용한 모델 내 종합이나 AI 근거 생성은 별도 허가된 방식 검토가 필요하다.
- 운영에 Maps 연동을 켜기 전에 API 활성화, 키 제한, 할당량, 예산, 공개 이용조건·개인정보 안내 및 실제 질의 성공을 확인한다. 이번 변경은 클라우드 프로젝트, 결제 또는 인증정보를 변경하지 않았다.

공식 근거: [Places 표시 및 저장 정책](https://developers.google.com/maps/documentation/places/web-service/policies), [Places 사진](https://developers.google.com/maps/documentation/places/web-service/place-photos), [Routes 표시 정책](https://developers.google.com/maps/documentation/routes/policies), [Maps 서비스별 이용조건](https://cloud.google.com/maps-platform/terms/maps-service-terms), [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started), [가격표](https://developers.google.com/maps/billing-and-pricing/pricing).
