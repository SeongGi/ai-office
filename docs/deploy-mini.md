# 서버 기기에 24시간 서버 두기 (ai-office.example.com)

서버는 서버 기기의 Docker(OrbStack)에서 돈다. 사람은 구글 로그인으로 `https://ai-office.example.com`에 들어온다. 기계(훅, seed, close-agent)는 구글 로그인을 못 하므로 같은 도메인의 정해진 세 길로만 접근한다.

```
사람   브라우저 -> nginx(/) -> 서버:8097 (oauth2-proxy) -> app:4317 (메인 포트, 밖으로 안 나감)
기계   훅 등 -> nginx(/events, /close-queue, /health) -> 서버:4318 (기계용 포트, Bearer 토큰 필수)
```

## 1. 구글 콘솔

기존 `homepage` OAuth 클라이언트를 쓴다.

1. 승인된 리디렉션 URI에 `https://ai-office.example.com/oauth2/callback`을 더한다.
2. 승인된 자바스크립트 원본에 `https://ai-office.example.com`을 더한다.
3. 클라이언트 ID와 보안 비밀은 직접 복사해서 `.env`에 붙여 넣는다. 보안 비밀은 화면, 채팅, 커밋에 남기지 않는다.

## 2. 서버 기기 준비

```bash
cd ai-office-src
cp .env.example .env
cp allowed-emails.txt.example allowed-emails.txt
```

- `.env`를 채운다. 토큰은 `openssl rand -hex 24`, 쿠키 비밀은 `openssl rand -base64 32 | tr -- '+/' '-_'`.
- `AI_OFFICE_ADMINS`에 제어 권한(닫기, 지시 보내기)을 줄 구글 계정을 쉼표로 적는다.
- `allowed-emails.txt`에 로그인을 허락할 구글 계정을 한 줄에 하나씩 적는다. 여기에 없으면 로그인 자체가 안 된다. 관리자가 아닌 사람은 보기만 한다.
- `.env`와 `allowed-emails.txt`는 커밋하지 않는다(`.gitignore`와 `.dockerignore`에 들어 있다).

```bash
docker compose up -d --build
curl http://127.0.0.1:4318/health      # {"ok":true} 만 나와야 한다
```

- 컨테이너 셋: `app`(서버), `auth`(oauth2-proxy v7.15.5), 볼륨 `audit`(감사 기록).
- 메인 포트(4317)는 호스트로 나가지 않는다. 호스트에 열리는 포트는 8097(로그인 프록시)과 4318(기계용)뿐이다.
- 메인 포트는 프록시가 로그인시킨 사람만 온다고 믿고 토큰을 묻지 않는다. 그래서 `AI_OFFICE_TRUST_PROXY_EMAIL=1`과 `AI_OFFICE_ADMINS`가 함께 있을 때만 그렇게 동작한다. 메인 포트를 호스트에 공개하면 안 된다.
- 컨테이너는 기기 이름이 `서버`다. 자기 안에서는 Orca를 못 쓰므로 닫기와 지시는 각 기기의 `close-agent`가 처리한다.

## 3. nginx (NPMplus)

포트 하나만 쓴다. `ai-office.example.com` 전체를 `http://<서버 기기 IP>:8097`로 보낸다(웹소켓 지원은 켜도 되고 꺼도 된다).

나누기는 oauth2-proxy가 한다(`docker-compose.yml`의 `OAUTH2_PROXY_UPSTREAMS`, `OAUTH2_PROXY_SKIP_AUTH_ROUTES`).

- `POST /events`, `GET /close-queue`, `GET /health`는 로그인 없이 app의 기계용 포트(4318)로 간다. 4318은 Bearer 토큰을 묻고 제어 권한이 없다.
- 나머지는 구글 로그인을 거쳐 메인 포트(4317)로 간다.
- `skip_auth_routes`의 CVE-2025-54576은 v7.11.0에서 고쳐졌다. 이 앱은 v7.15.5를 쓴다.
- `/stream`(SSE)이 지나가므로 NPMplus 고급 설정에 `proxy_buffering off;`와 `proxy_read_timeout 1h;`를 넣는 것이 좋다.
- 기계용 포트의 `/health`는 `{"ok":true}`만 답한다. 에이전트 수나 버전 같은 내용을 싣지 않는다.
- 호스트의 4318 포트는 되돌리기와 내부 확인용으로 남아 있다. nginx에는 넣지 않는다.

## 4. 각 기기(노트북, 서버 기기)의 환경

`~/.claude/settings.json`의 `env`에 아래 세 값을 넣는다(직접 고쳐 넣는다. 이 문서는 파일을 바꾸지 않는다). 훅, `seed`, `close-agent`가 모두 같은 값을 쓴다.

```json
{
  "env": {
    "AI_OFFICE_URL": "https://ai-office.example.com",
    "AI_OFFICE_TOKEN": "<토큰>",
    "AI_OFFICE_DEVICE": "맥북"
  }
}
```

기기마다 `AI_OFFICE_DEVICE`를 다르게 쓴다(예: `맥북`, `서버기기`). 방 이름 앞에 기기 이름이 붙는다.

옛 `AGENT_FLOOR_*` 환경변수도 당분간 읽는다(deprecated). 새 이름과 옛 이름이 둘 다 있으면 `AI_OFFICE_*`가 이긴다. 다만 docker compose의 `.env`는 새 이름(`AI_OFFICE_*`)으로 고쳐야 한다.

같은 값을 터미널에도 준 뒤 실행한다.

```bash
# 이미 열려 있는 Claude 세션을 서버에 올린다(마지막 대화도 같이)
node bin/ai-office.mjs seed

# 퇴사 버튼의 닫기 요청과 보낸 지시를 이 기기에서 실행한다(계속 켜 둔다)
node bin/ai-office.mjs close-agent
```

요청은 서버 큐에 60초만 머문다. `close-agent`는 2초마다 큐를 확인하고, 서버가 꺼져도 죽지 않고 다시 시도한다. 서버 쪽 기기 이름과 같은 기기의 세션은 서버가 바로 처리한다.

launchd로 상시 실행하는 예(`~/Library/LaunchAgents/com.example.ai-office-close.plist`, 설치는 직접 한다):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.ai-office-close</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/<사용자>/Desktop/PDS/dev/ai-office-src/bin/ai-office.mjs</string>
    <string>close-agent</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AI_OFFICE_URL</key><string>https://ai-office.example.com</string>
    <key>AI_OFFICE_TOKEN</key><string><토큰></string>
    <key>AI_OFFICE_DEVICE</key><string>맥북</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/ai-office-close.log</string>
  <key>StandardErrorPath</key><string>/tmp/ai-office-close.log</string>
</dict>
</plist>
```

`orca` 명령이 `PATH`에 있어야 한다.

## 5. 지시 보내기 안전장치

관리자가 직원 카드에서 보낸 지시는 그 세션의 터미널에 입력된다. 아래 장치가 막는다.

- 제어 권한은 `AI_OFFICE_ADMINS`에 든 구글 계정만 가진다. 기계용 포트에는 제어 권한이 없다.
- 이메일 헤더는 `AI_OFFICE_TRUST_PROXY_EMAIL=1`일 때만 믿는다. 켜지 않으면 위조 헤더는 무시한다.
- 메인 세션만, 일하는 중(생각, 작업, 대기)이 아닐 때만, 터미널을 알 때만 보낸다. 서브에이전트에는 보내지 않는다.
- 터미널이 아직 Claude인지 보내기 직전에 `orca terminal list`로 한 번 더 확인한다.
- 권한 확인 없이 도는 세션(`bypassPermissions`)에는 보내지 않는다. 정말 필요하면 `AI_OFFICE_ALLOW_BYPASS_SEND=1`.
- 지시는 1자 이상 2000자 이하. 같은 계정(없으면 IP)당 1분에 6번까지, 넘으면 429.
- 카드에서 보내기를 두 번 눌러야 나간다(첫 번째는 대상 이름을 보여 준다).
- 닫기와 지시 시도는 모두 감사 기록 `/data/audit.log`(볼륨 `audit`)에 한 줄씩 남는다: 시각, 이메일, 직원, 기기, 종류, 결과, 지시 글 500자. 서버 로그에는 지시 글을 남기지 않는다.

```bash
docker compose exec app tail -n 20 /data/audit.log
```

## 5-1. 외부 공개용 데모 (로그인 없음)

밖의 사람에게 보여 줄 데모는 별도 컨테이너 `demo`가 맡는다. pages 빌드(`npm run build:pages`)를 nginx로 내주는 정적 페이지이며, 가짜 에이전트가 브라우저 안에서만 돈다. 실제 오피스 서버, 토큰, 로그인 프록시와는 연결되지 않는다.

```bash
docker compose up -d --build demo
curl -I http://127.0.0.1:8099/          # 200
curl -I http://127.0.0.1:8099/stream    # 404 (실제 서버의 길은 없다)
```

- 호스트 포트는 8099다(8098은 다른 앱이 쓴다). 바꾸려면 `.env`에 `AI_OFFICE_DEMO_PORT`를 적는다.
- DNS에 하위 도메인 `office.example.com`을 더하고, NPMplus에서 그 도메인 전체를 `http://<서버 기기 IP>:8099`로 보낸다. SSL 인증서도 그 화면에서 발급한다. 로그인이나 웹소켓 설정은 필요 없다.
- 화면을 고친 뒤에는 `docker compose up -d --build demo`로 데모를 다시 빌드한다.
- 내리기: `docker compose stop demo` 후 NPMplus에서 그 호스트를 끈다.

## 6. 참고와 주의

- 서버 기기의 다른 앱이 쓰는 oauth2-proxy는 v7.10.0이다. 이 버전은 CVE-2025-54576에 해당한다(`skip_auth_routes`를 쓸 때만 문제가 된다). 이 앱은 `skip_auth_routes`를 쓰지 않고 기계용 포트를 따로 둔 것이 그 때문이다. 참고만 한다.
- 토큰이 새면 `.env`의 `AI_OFFICE_TOKEN`을 바꾸고 `docker compose up -d`, 각 기기의 설정도 바꾼다.

## 7. 되돌리기

- 기기 쪽: `AI_OFFICE_URL`을 `http://127.0.0.1:4317`로 돌리면(또는 값을 지우면) 이전처럼 그 기기 안에서만 돈다. `AI_OFFICE_TOKEN`과 `AI_OFFICE_DEVICE`도 지운다.
- 서버 쪽: `docker compose down`(감사 볼륨은 남는다. 지우려면 `docker compose down -v`).
- 포트 나누기: `docker-compose.yml`의 두 줄을 `OAUTH2_PROXY_UPSTREAMS: http://app:4317` 하나로 되돌리고 `docker compose up -d auth`.
