# 행사비서 릴리스 절차

Git 태그 `vX.Y.Z`, `package.json` 버전 `X.Y.Z`, Docker 이미지 `nowchatbot:vX.Y.Z`를 같은 소스 커밋으로 맞춘다. 일반 기능 변경은 마이너, 호환되는 수정은 패치 버전을 사용한다. 안정 버전 전에 시험 배포할 때는 `-rc.N`을 붙인다. 배포한 태그는 덮어쓰지 않는다.

1. 작업 브랜치에서 테스트를 실행하고 변경 이력과 기본 Compose 이미지 태그를 갱신한다. 운영 데이터, 환경 파일, API 키, 사적 문서나 캡처는 커밋하지 않는다.
2. 깨끗한 릴리스 후보 커밋으로 이미지를 빌드한다. 버전과 커밋을 이미지 라벨의 `org.opencontainers.image.version`, `org.opencontainers.image.revision`에 기록한다.
3. 임시 볼륨과 외부 키 없는 컨테이너에서 먼저 확인한다. 호스트 운영 볼륨을 백업한 뒤 앱 컨테이너만 교체한다. 계정·일정·대화가 저장된 볼륨은 교체 대상이 아니다.
4. 같은 커밋에 Git 태그를 붙이고 GitHub PR에서 검토한다. PR과 태그에는 코드와 설명만 올린다. Docker 이미지 이관은 서버 운영 절차로 별도 진행한다.

```powershell
$version = node -p 'require("./package.json").version'
$revision = git rev-parse HEAD
docker build --label "org.opencontainers.image.version=$version" --label "org.opencontainers.image.revision=$revision" -t "nowchatbot:v$version" .
docker compose -p nowchatbot exec -T app node scripts/backup-server.mjs --backup
docker compose --env-file .env.local -p nowchatbot -f compose.yaml -f compose.openai.yaml up -d --no-deps --wait app
```

문제가 생기면 이전 `CHURCH_IMAGE`로 앱을 되돌린다. DB 형식이 바뀐 릴리스는 이전 이미지와의 호환 여부를 먼저 확인한다. 운영 볼륨을 지우거나 검증하지 않은 백업으로 덮어쓰지 않는다.
