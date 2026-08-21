#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 음성 MP3 를 GitHub Releases 로 올립니다.
#
#   bash tools/upload_audio_release.sh                    # 60트랙 전부
#   bash tools/upload_audio_release.sh --only "1과목_01_001-010.mp3,3과목_05_041-050.mp3"
#   bash tools/upload_audio_release.sh --tag audio-v2     # 다른 태그로
#   bash tools/upload_audio_release.sh --stage-only       # 올리지 않고 파일만 준비
#
# 왜 릴리스인가
#   · 저장소와 GitHub Pages 용량(사이트 1GB 한도)을 전혀 쓰지 않습니다.
#   · git 히스토리가 무거워지지 않습니다. 음성을 다시 만들어도 누적되지 않습니다.
#   · 구간 탐색(Range 요청)이 동작합니다. 실측 확인 완료.
#
# 한글 파일명은 릴리스 자산에서 그대로 보존되지 않으므로
# s1_01_001-010.mp3 처럼 ASCII 이름으로 바꿔 올립니다.
# 앱은 audio-manifest.json 의 rfile 필드로 이 이름을 찾습니다.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

TAG="audio-v1"
ONLY=""
STAGE_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)        TAG="$2"; shift 2 ;;
    --only)       ONLY="$2"; shift 2 ;;
    --stage-only) STAGE_ONLY=1; shift ;;
    -h|--help)    sed -n '2,18p' "$0"; exit 0 ;;
    *)            TAG="$1"; shift ;;          # 예전 방식(첫 인자가 태그)도 계속 받습니다
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/audio"
STAGE="$ROOT/.release_audio"

[ -d "$SRC" ] || { echo "audio/ 폴더가 없습니다: $SRC" >&2; exit 1; }

if [ "$STAGE_ONLY" -eq 0 ] && ! command -v gh >/dev/null 2>&1; then
  echo "gh(GitHub CLI)가 없습니다.  brew install gh  로 설치한 뒤 gh auth login 하세요." >&2
  echo "설치가 어려우면 --stage-only 로 파일만 만들고 릴리스 페이지에 끌어다 놓아도 됩니다." >&2
  exit 1
fi

echo "▶ 1/3  릴리스용 ASCII 이름으로 복사합니다."
[ -n "$ONLY" ] && echo "        지정한 트랙만 처리합니다."
rm -rf "$STAGE"; mkdir -p "$STAGE"
n=0
while IFS= read -r f; do
  b="$(basename "$f")"                       # 1과목_01_001-010.mp3
  if [ -n "$ONLY" ] && ! printf '%s' ",$ONLY," | grep -q ",$b,"; then
    continue
  fi
  s="${b%%과목_*}"                            # 1
  rest="${b#*과목_}"                          # 01_001-010.mp3
  cp "$f" "$STAGE/s${s}_${rest}"
  n=$((n+1))
done < <(find "$SRC" -mindepth 2 -name '*.mp3' | sort)
echo "   $n 개 · $(du -sh "$STAGE" | cut -f1)"

if [ "$n" -eq 0 ]; then
  echo "   올릴 파일이 없습니다. --only 로 준 이름이 audio/ 안의 파일명과 같은지 확인하세요." >&2
  exit 1
fi
if [ -z "$ONLY" ] && [ "$n" -ne 60 ]; then
  echo "   ⚠️  60개가 아닙니다. 음성 생성이 덜 됐는지 확인하세요."
fi

if [ "$STAGE_ONLY" -eq 1 ]; then
  echo "▶ 완료.  $STAGE 안의 파일을 릴리스 페이지에 끌어다 놓으세요."
  exit 0
fi

echo "▶ 2/3  릴리스 $TAG 를 확인합니다."
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "   이미 있습니다. 같은 이름 파일은 덮어씁니다."
else
  gh release create "$TAG" \
    --title "듣기용 음성 파일 ($TAG)" \
    --notes "정보처리기사 필기 개념학습 611문항 듣기용 MP3 60트랙 (약 9시간, 24kHz 모노 48kbps).
앱의 [음성 듣기 → 릴리스에서 듣기] 로 바로 재생됩니다."
fi

echo "▶ 3/3  업로드합니다. 회선에 따라 몇 분 걸립니다."
gh release upload "$TAG" "$STAGE"/*.mp3 --clobber

echo
echo "✅ 끝났습니다. ($n 개)"
echo "   주소: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/download/$TAG/"
echo "   이 주소가 index.html 의 AP_RELEASE 와 같은지 확인하세요."
rm -rf "$STAGE"
