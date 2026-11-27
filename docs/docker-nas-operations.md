# 행사비서 Docker 운영 안내

## 이미지, 컨테이너, 데이터

| 구분 | 행사비서에서 하는 일 |
| --- | --- |
| 이미지 | 앱 코드와 Node·Python 실행 환경. 빌드 또는 NAS 전송의 대상이다. |
| 컨테이너 | 이미지를 실행한 앱. 새 버전이나 환경변수를 적용할 때 다시 생성한다. |
| 볼륨 | 계정, 대화, 일정, 첨부파일, 설정이 저장되는 `/data`. 현재 프로젝트 이름을 유지하면 같은 볼륨을 쓴다. |
| 키 파일 | 로컬은 `.env.local`, NAS는 관리자만 접근 가능한 전용 폴더의 `.env.openai`와 `.env.google`. Git·이미지·공개 공유 폴더에 넣지 않는다. |

아래 예시는 Compose 프로젝트 이름 `nowchatbot`, 기본 주소 `http://localhost:3020`, 그에 해당하는 기본 볼륨 이름 `nowchatbot_state`를 사용한다. NAS는 별도 호스트이며 이미지 파일만 가져가면 계정과 일정은 이동하지 않는다.

## 이 PC에서 실행

프로젝트 폴더에서 PowerShell을 연다.

```powershell
docker compose -p nowchatbot ps
docker compose -p nowchatbot logs --tail 60 app
docker compose -p nowchatbot stop app
```

로그는 필요한 오류 문구만 확인한다. 공유 전 주소, 세션 정보, 요청 본문 등 민감한 내용이 없는지 확인한다.

OpenAI 연결 시 `.env.local`에는 `OPENAI_API_KEY`를 넣는다. 이 파일에 이미 같은 이름이 있다면 중복으로 만들지 말고 교체한다. `OPENAI_MODEL`을 지정하지 않으면 현재 기본값은 `gpt-6-luna`다. 아래 명령은 키와 모델 선택값만 앱 컨테이너에 전달하고, `AI_PROVIDER=openai`로 실행한다.

```powershell
docker compose --env-file .env.local -p nowchatbot -f compose.yaml -f compose.openai.yaml up -d --no-deps app
docker compose --env-file .env.local -p nowchatbot -f compose.yaml -f compose.openai.yaml exec -T app node -e 'console.log({keySet:Boolean(process.env.OPENAI_API_KEY), provider:process.env.AI_PROVIDER, model:process.env.OPENAI_MODEL})'
```

`keySet: true`는 전달만 확인한다. 실제 권한·잔액은 개인정보 없는 질문을 앱에서 한 번 보내야 확인된다. `docker compose config`나 전체 `docker inspect` 출력에는 실제 키가 포함될 수 있으니 공유하지 않는다. 설정 변경은 `restart`가 아니라 같은 옵션으로 `up`을 실행해 반영한다. OpenAI 연결을 끄려면 `docker compose -p nowchatbot -f compose.yaml up -d --no-deps app`으로 기본 구성을 다시 적용한다.

### Google 연결 설정

로컬 전용 `.env.local`에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `APP_BASE_URL`을 설정한다. 콜백 경로는 `/api/integrations/google/callback`이며 앱 주소와 같은 출처여야 한다. Google OAuth 웹 애플리케이션의 승인된 리디렉션 URI에도 실제 콜백 전체 주소를 등록한다. 로컬과 운영 호스트는 각각의 설정을 사용한다. 아래는 OpenAI와 Google 연결을 함께 켜는 예시이며 OpenAI를 사용하지 않으면 `-f compose.openai.yaml`을 뺀다.

```powershell
docker compose --env-file .env.local -p nowchatbot -f compose.yaml -f compose.openai.yaml -f compose.google.yaml up -d --no-deps app
```

로컬 URL 두 개만 무시 대상인 `.env.google.local`에 분리했다면 매번 `--env-file .env.local --env-file .env.google.local` 순서로 전달한다. 이 파일에는 비밀값을 넣지 않는다. `--env-file`만 지정하면 컨테이너에 OAuth 값이 자동 전달되지 않으므로 `-f compose.google.yaml`도 필요하다. 로그인에 사용한 호스트와 콜백의 호스트를 동일하게 사용한다. `localhost`와 `127.0.0.1`은 서로 다른 출처이며 Cloud에도 브라우저가 사용하는 호스트·포트·경로를 그대로 등록한다.

환경설정의 보안 및 개인정보에서 Google 계정을 연결한 뒤 **연결 테스트**를 실행한다. 이 테스트는 OAuth 갱신과 세부 권한만 확인하므로, 일정 전송·설문 읽기·초안 생성은 승인된 테스트 계정과 자료로 따로 확인한다. OAuth 키와 실제 토큰은 공개하거나 커밋하지 않는다.

## 버전 업데이트와 백업

1. **백업:** 현재 앱이 켜진 상태에서 `docker compose -p nowchatbot exec -T app node scripts/backup-server.mjs --backup`을 실행한다. SQLite 백업은 볼륨 내부의 `/data/backups`에 생긴다. 같은 디스크 장애에 대비해 접근 권한을 제한한 별도 저장소에도 백업을 보관한다. 이 파일에는 계정과 첨부파일이 들어 있으니 배포용 TAR과 섞지 않는다.
2. **새 이미지 빌드:** 새 태그를 붙인다. 예시: `docker build -t nowchatbot:2026-11-26-r2 .`. 검증된 OR-Tools 휠 캐시가 있다면 `--build-context transport-wheels=.local/docker-wheelhouse`를 추가할 수 있다.
3. **앱만 교체:** PowerShell에서 `$env:CHURCH_IMAGE = 'nowchatbot:2026-11-26-r2'`를 설정하고 현재 호스트와 동일한 프로젝트명, `--env-file`, `-f` 옵션으로 `up`을 다시 실행한다. Google을 사용하는 앱을 OpenAI 전용 명령으로 갱신하면 Google 환경변수가 빠진다. 이후 실행에도 같은 태그가 선택되도록 해당 호스트의 비밀 설정 파일에 `CHURCH_IMAGE`도 기록한다. `ps`에서 이미지와 상태를, 사이트에서 로그인과 기존 기록을 확인한다.
4. **문제가 있으면:** 이전 이미지 태그로 앱만 다시 시작한다. DB 형식이 변경된 버전이라면 이전 이미지가 새 DB와 호환되는지 먼저 확인한다. 운영 DB에 바로 백업을 덮어쓰지 말고 격리된 볼륨에서 복구를 시험한다.

**금지:** 업데이트 목적으로 `docker compose down -v`, `docker volume rm`, DSM 프로젝트의 정리·삭제를 하지 않는다. 프로젝트 이름을 바꾸면 별도 데이터 볼륨으로 연결돼 기존 기록이 사라진 것처럼 보일 수 있다.

## 나중에 교회 NAS에서 처음 실행

1. **호환성 확인:** DSM의 Container Manager 설치 가능 여부와 CPU를 확인한다. SSH에서 `uname -m`이 `x86_64`면 현재 AMD64 이미지를 쓸 수 있다. `aarch64`면 ARM용 이미지를 따로 빌드·검증한다.
2. **이미지 가져오기:** PC에서 `docker image save -o nowchatbot-release.tar nowchatbot:배포태그`로 내보낸다. DSM **Container Manager → 이미지 → 작업 → 가져오기 → 파일**에서 TAR을 선택한다. 현재 Compose는 `pull_policy: never`라 이미지 태그가 NAS에 미리 있어야 한다.
3. **프로젝트 생성:** DSM **Container Manager → 프로젝트 → 생성**에서 이름 `nowchatbot`과 전용 폴더를 지정한다. `compose.yaml`을 사용하고 처음에는 자동 시작을 해제한다. OpenAI 연결을 원하면 같은 폴더에 `compose.openai.yaml`과 NAS 전용 `.env.openai`를 두고 파일 읽기 권한을 제한한다. PC의 비밀 파일 전체를 옮길 필요는 없다.
4. **첫 관리자와 앱:** 새 DB에서만 NAS SSH의 프로젝트 폴더에서 `docker compose -p nowchatbot run --rm --no-deps app node scripts/bootstrap-admin.mjs --create-owner`를 실행한다. 프롬프트에서 `CREATE_OWNER`를 확인하고 비밀번호는 화면에 표시되지 않는 입력란에 넣는다. 이미 같은 NAS 볼륨에 계정이 있다면 건너뛴다. OpenAI 없이 먼저 확인하려면 `docker compose -p nowchatbot up -d app`, 연결해서 실행하려면 아래 명령을 쓴다. DSM에서 올린 YAML 이름이 `docker-compose.yml`이라면 실제 파일명을 아래 `-f`에 사용한다.

   ```sh
   docker compose --env-file .env.openai -p nowchatbot -f compose.yaml -f compose.openai.yaml up -d --no-deps app
   ```

5. **HTTPS 접속:** 기본 앱 포트는 NAS의 `127.0.0.1:3020`에만 열려 있다. DSM **제어판 → 로그인 포털 → 고급 → 역방향 프록시**에서 행사비서용 HTTPS 도메인을 별도로 지정하고, 대상을 HTTP `127.0.0.1:3020`으로 연결한다. 유효한 인증서와 교회 접근 정책을 적용하고 기존 교회 홈페이지 규칙은 바꾸지 않는다. 운영 로그인 쿠키는 `Secure`이므로 다른 기기에서 NAS IP의 평문 HTTP 주소로 로그인하는 것을 운영 방식으로 삼지 않는다.
6. **운영 시작:** 관리자 로그인, 초대코드 발급, 다른 사용자의 로그인, 가상 행사 기록 저장·복원, 개인정보 없는 채팅 호출 순서로 확인한다. 기존 PC 데이터를 유지하려면 TAR과 별개로 DB 백업의 이관·복구를 승인받고 격리 환경에서 검증한다.

NAS의 실제 모델, CPU, 네트워크, 인증서 및 운영 DB 이전은 이 문서 작성 시 검증하지 않았다.

### NAS Google OAuth 적용

1. **주소 확정 전:** Google 설정 없이 앱부터 실행해도 된다. 운영 HTTPS 주소가 확정되고 사용자 브라우저에서 인증서 오류 없이 접속한 뒤 Google을 연결한다. 로컬 콜백이나 NAS 내부 IP를 임시 운영 주소로 사용하지 않는다.
2. **Google Cloud:** 운영 전용 **웹 애플리케이션** OAuth 클라이언트를 권장한다. 프로젝트에서 Google Calendar API와 Google Forms API를 활성화한다. 외부 앱이 **테스트 중**이면 실제 검증용 계정을 테스트 사용자에 등록한다. 테스트 중 발급된 권한은 7일 후 만료될 수 있으므로, 계속 운영하기 전에 앱의 대상 유형과 Google 검증 요건을 확인한다. 기존 로컬 클라이언트와 콜백은 유지한다.
3. **값 설정:** NAS의 `.env.google`에 운영용 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, 확정된 HTTPS 출처인 `APP_BASE_URL`, 해당 출처 뒤에 `/api/integrations/google/callback`을 붙인 `GOOGLE_OAUTH_REDIRECT_URI`를 지정한다. Google Cloud의 **승인된 리디렉션 URI**에 마지막 값을 그대로 등록한다. 스킴·호스트·포트·경로가 정확히 일치해야 한다. NAS SSH에서 파일 소유자가 실행 관리자임을 확인하고 `chmod 600 .env.google`을 적용한다. Windows 로컬 비밀 파일 전체를 복사하지 않는다.
4. **같은 프로젝트에서 반영:** 기존 볼륨은 그대로 두고 백업 후 앱만 교체한다. 이전 연결의 토큰은 기존 OAuth 비밀값으로 암호화되어 있으므로, 운영 클라이언트를 바꾸거나 PC DB를 옮긴 경우에는 기존 권한이 그대로 동작한다고 가정하지 말고 재연결을 확인한다. 아래는 두 연동을 모두 쓰는 예시다. OpenAI를 쓰지 않으면 `--env-file .env.openai`와 `-f compose.openai.yaml`만 뺀다. 이 경우에도 `CHURCH_IMAGE`는 NAS에 가져온 실제 이미지 태그를 선택해야 한다.

   ```sh
   docker compose --env-file .env.openai --env-file .env.google -p nowchatbot \
     -f compose.yaml -f compose.openai.yaml -f compose.google.yaml config --quiet
   docker compose --env-file .env.openai --env-file .env.google -p nowchatbot \
     -f compose.yaml -f compose.openai.yaml -f compose.google.yaml up -d --no-deps --wait app
   docker compose --env-file .env.openai --env-file .env.google -p nowchatbot \
     -f compose.yaml -f compose.openai.yaml -f compose.google.yaml exec -T app node -e \
     'for (const key of ["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_OAUTH_REDIRECT_URI","APP_BASE_URL"]) console.log(key, Boolean(process.env[key]))'
   ```

### 실제 Google 연동 검증

**실데이터가 없는 테스트 DB와 전용 Google 계정을 사용한다.** Calendar 권한 승인 직후 서버가 DB의 공동 캘린더 확정 일정을 자동으로 보낼 수 있다. 실제 교회 명단·일정이 들어 있는 DB에서 검증용으로 권한을 승인하지 않는다. 운영 연결 전에는 어떤 기존 일정이 Google로 전송되는지 확인한다.

| 검증 | 완료 기준 |
| --- | --- |
| OAuth | 테스트 사용자가 권한을 직접 승인하고 앱으로 돌아온 뒤, Calendar 전송·Forms 조회·Forms 생성 상태를 각각 확인한다. 연결 테스트와 실제 작업 결과는 따로 기록한다. |
| Forms 생성 | 가상 행사에서 초안을 생성·승인한다. Google 편집 화면에서 미게시 상태와 미리보기의 문항 순서, 유형, 필수 여부, 선택지 및 참석/불참 분기를 대조한다. |
| Forms 조회 | 미게시 검증용 설문과 별개인 접근 제한 테스트 양식에 가상 응답을 넣고, 앱에서 그 양식만 가져와 문항과 응답을 대조한다. |
| Calendar 전송 | 가상 일정 하나만 확정하고, 테스트 Google 계정의 앱 전용 캘린더에서 제목·날짜·시간대를 대조한다. 실제 참석자나 연락처를 사용하지 않는다. |
| 연결 해제·재연결 | 테스트 연결만 끊어 세 권한이 해제되었는지 확인한다. 다시 승인한 뒤 상태와 실제 동작을 확인하고, 기존 테스트 일정이 중복 전송되지 않았는지 검사한다. |

Google 공식 문서: [웹 서버 OAuth 및 콜백](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth 대상 및 테스트 사용자](https://support.google.com/cloud/answer/15549945), [Forms 게시 설정](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/setPublishSettings).

공식 문서: [Docker Compose 환경변수](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [Docker Compose 업데이트](https://docs.docker.com/reference/cli/docker/compose/up/), [Docker 이미지·볼륨 백업](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/), [Synology 이미지 가져오기](https://kb.synology.com/index.php/en-us/DSM/help/ContainerManager/docker_image?version=7), [Synology 프로젝트](https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project), [Synology 역방향 프록시](https://kb.synology.com/en-in/DSM/help/DSM/AdminCenter/system_login_portal_advanced).
