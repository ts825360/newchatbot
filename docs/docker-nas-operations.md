# 행사비서 Docker 운영 안내

## 이미지, 컨테이너, 데이터

| 구분 | 행사비서에서 하는 일 |
| --- | --- |
| 이미지 | 앱 코드와 Node·Python 실행 환경. 빌드 또는 NAS 전송의 대상이다. |
| 컨테이너 | 이미지를 실행한 앱. 새 버전이나 환경변수를 적용할 때 다시 생성한다. |
| 볼륨 | 계정, 대화, 일정, 첨부파일, 설정이 저장되는 `/data`. 현재 프로젝트 이름을 유지하면 같은 볼륨을 쓴다. |
| 키 파일 | 로컬은 `.env.local`, NAS는 NAS 전용 개인 폴더의 `.env.openai`. Git·이미지·공개 공유 폴더에 넣지 않는다. |

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

환경설정의 보안 및 개인정보에서 Google 계정을 연결한 뒤 **연결 테스트**를 실행한다. 이 테스트는 OAuth 갱신과 세부 권한만 확인하므로, 일정 전송·설문 읽기·초안 생성은 승인된 테스트 계정과 자료로 따로 확인한다. OAuth 키와 실제 토큰은 공개하거나 커밋하지 않는다.

## 버전 업데이트와 백업

1. **백업:** 현재 앱이 켜진 상태에서 `docker compose -p nowchatbot exec -T app node scripts/backup-server.mjs --backup`을 실행한다. SQLite 백업은 볼륨 내부의 `/data/backups`에 생긴다. 같은 디스크 장애에 대비해 접근 권한을 제한한 별도 저장소에도 백업을 보관한다. 이 파일에는 계정과 첨부파일이 들어 있으니 배포용 TAR과 섞지 않는다.
2. **새 이미지 빌드:** 새 태그를 붙인다. 예시: `docker build -t nowchatbot:2026-11-26-r2 .`. 검증된 OR-Tools 휠 캐시가 있다면 `--build-context transport-wheels=.local/docker-wheelhouse`를 추가할 수 있다.
3. **앱만 교체:** PowerShell에서 `$env:CHURCH_IMAGE = 'nowchatbot:2026-11-26-r2'`를 설정하고 위의 OpenAI 실행 명령을 다시 실행한다. 이후 실행에도 같은 태그가 선택되도록 해당 호스트의 비밀 설정 파일에 `CHURCH_IMAGE`도 기록한다. `ps`에서 이미지와 상태를, 사이트에서 로그인과 기존 기록을 확인한다.
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

공식 문서: [Docker Compose 환경변수](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [Docker Compose 업데이트](https://docs.docker.com/reference/cli/docker/compose/up/), [Docker 이미지·볼륨 백업](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/), [Synology 이미지 가져오기](https://kb.synology.com/index.php/en-us/DSM/help/ContainerManager/docker_image?version=7), [Synology 프로젝트](https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project), [Synology 역방향 프록시](https://kb.synology.com/en-in/DSM/help/DSM/AdminCenter/system_login_portal_advanced).
