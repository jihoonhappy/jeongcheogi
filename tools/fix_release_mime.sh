#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 릴리스 자산의 Content-Type 을 audio/mpeg 로 고쳐 다시 올립니다.
#
#   bash tools/fix_release_mime.sh              # 60개 전부
#   bash tools/fix_release_mime.sh --tag audio-v1
#
# 왜 필요한가
#   gh release upload 로 올린 자산은 GitHub 에 application/octet-stream 으로
#   저장되고, 내려받기 주소도 그 타입으로 응답합니다(실측 확인).
#   크롬은 내용을 보고 mp3 로 판단해 재생하지만, 사파리(WebKit)는
#   Content-Type 을 그대로 믿는 편이라 재생을 거부할 수 있습니다.
#
#   GitHub 업로드 API 는 요청의 Content-Type 헤더를 자산의 타입으로 저장하므로,
#   audio/mpeg 로 다시 올리면 내려받기 응답도 audio/mpeg 가 됩니다.
#
# 안전장치
#   파일 하나씩 [삭제 → 즉시 재업로드] 하므로 비어 있는 순간이 몇 초로 짧습니다.
#   중간에 멈춰도 다시 실행하면 남은 것만 이어서 고칩니다.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

TAG="audio-v1"
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag)  TAG="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *)      TAG="$1"; shift ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/audio"
STAGE="$ROOT/.release_audio"

command -v gh >/dev/null 2>&1 || { echo "gh 가 필요합니다." >&2; exit 1; }
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
TOKEN="$(gh auth token)"
RID="$(gh api "repos/$REPO/releases/tags/$TAG" --jq .id)"
echo "저장소 $REPO · 릴리스 $TAG (id $RID)"

echo "▶ 1/3  ASCII 이름으로 복사합니다."
rm -rf "$STAGE"; mkdir -p "$STAGE"
n=0
while IFS= read -r f; do
  b="$(basename "$f")"
  if [ -n "$ONLY" ] && ! printf '%s' ",$ONLY," | grep -q ",$b,"; then continue; fi
  s="${b%%과목_*}"; rest="${b#*과목_}"
  cp "$f" "$STAGE/s${s}_${rest}"
  n=$((n+1))
done < <(find "$SRC" -mindepth 2 -name '*.mp3' | sort)
echo "   $n 개"

echo "▶ 2/3  현재 자산 타입을 확인합니다."
gh api "repos/$REPO/releases/$RID/assets" --paginate \
  --jq '.[] | "\(.content_type)"' | sort | uniq -c

echo "▶ 3/3  audio/mpeg 로 다시 올립니다."
fixed=0; kept=0
for f in "$STAGE"/*.mp3; do
  nm="$(basename "$f")"
  info="$(gh api "repos/$REPO/releases/$RID/assets" --paginate \
          --jq ".[] | select(.name==\"$nm\") | \"\(.id) \(.content_type)\"" || true)"
  id="$(printf '%s' "$info" | awk '{print $1}')"
  ct="$(printf '%s' "$info" | awk '{print $2}')"

  if [ "$ct" = "audio/mpeg" ]; then
    kept=$((kept+1)); continue
  fi
  [ -n "$id" ] && gh api --method DELETE "repos/$REPO/releases/assets/$id" >/dev/null
  code=$(curl -sS -o /tmp/_up.json -w "%{http_code}" -X POST \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: audio/mpeg" \
        -H "Accept: application/vnd.github+json" \
        --data-binary @"$f" \
        "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=$nm")
  if [ "$code" = "201" ]; then
    fixed=$((fixed+1)); printf "   %-24s audio/mpeg\n" "$nm"
  else
    echo "   ! $nm 실패 (HTTP $code)"; head -c 300 /tmp/_up.json; echo
    echo "   이 파일은 지금 릴리스에서 빠져 있습니다. 스크립트를 다시 실행해 주세요." >&2
    exit 1
  fi
done

echo
echo "✅ 고침 $fixed 개 · 이미 정상 $kept 개"
echo "▶ 확인"
gh api "repos/$REPO/releases/$RID/assets" --paginate --jq '.[] | .content_type' | sort | uniq -c
rm -rf "$STAGE"
echo
echo "브라우저에서 아래 주소를 열어 바로 재생되는지 확인해 보세요."
echo "  https://github.com/$REPO/releases/download/$TAG/s1_01_001-010.mp3"
