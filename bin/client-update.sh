#!/bin/bash
# 맥북 같은 클라이언트에서 하루 한 번 돌린다. 서버 기기 원본을 받아오고, 바뀌었으면 close-agent를 다시 띄운다.
# 이 파일도 pull로 바뀔 수 있으니 전체를 { } 로 감싸 먼저 다 읽고 실행한다.
{
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
echo "[$(date '+%F %T')] 업데이트 확인: $repo"
before="$(git -C "$repo" rev-parse HEAD)"
if ! git -C "$repo" pull --ff-only --quiet; then
  echo "pull 실패. 로컬 변경이 있거나 서버 기기에 연결할 수 없어요."
  exit 1
fi
after="$(git -C "$repo" rev-parse HEAD)"
if [ "$before" = "$after" ]; then
  echo "바뀐 것 없음 ($after)"
  exit 0
fi
echo "업데이트: ${before:0:7} -> ${after:0:7}"
git -C "$repo" log --oneline "$before..$after"
# 새 이름을 먼저 시도하고, 아직 옛 이름으로 설치된 기기를 위해 옛 이름도 시도한다(옛 이름은 deprecated, 호환용).
for label in com.example.ai-office-close kr.seonggi.agent-floor-close; do
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/$label" && echo "close-agent 다시 띄움($label)"
    break
  fi
done
exit 0
}
