#!/bin/bash
# 정보처리기사 필기 — 듣기용 MP3 만들기
# 이 파일을 파인더에서 더블클릭하면 터미널이 열리면서 실행됩니다.
cd "$(dirname "$0")/.." || exit 1

echo "════════════════════════════════════════════"
echo "  정보처리기사 필기 — 듣기용 MP3 만들기"
echo "════════════════════════════════════════════"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 가 없습니다."
  echo "  터미널에서  xcode-select --install  을 실행해 설치해 주세요."
  echo; read -r -p "엔터를 누르면 닫힙니다..." _; exit 1
fi

# edge-tts (마이크로소프트 신경망 음성) 확인 — 없으면 설치를 제안합니다
if ! python3 -c "import edge_tts" >/dev/null 2>&1; then
  echo "고품질 음성 엔진(edge-tts)이 설치되어 있지 않습니다."
  echo "무료이고 계정·키가 필요 없습니다. 지금 설치할까요?"
  read -r -p "  설치하려면 y, 맥 내장 음성으로 진행하려면 n [y/n]: " yn
  if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
    echo "설치 중…"
    pip3 install --user edge-tts || python3 -m pip install --user edge-tts
    echo
  fi
fi

echo "먼저 여성 목소리 맛보기 4개를 만듭니다. (1분 정도)"
python3 tools/make_audio.py --sample || { echo; read -r -p "엔터를 누르면 닫힙니다..." _; exit 1; }

open audio 2>/dev/null
echo
echo "열린 폴더의 샘플 파일을 들어 보세요."
echo "그대로 진행하면 기본 목소리(ko-KR-SunHiNeural, 여성)로 만듭니다."
read -r -p "다른 목소리를 쓰시려면 이름을 붙여넣고, 아니면 그냥 엔터: " V
echo

ARGS=(--subject 1)
[ -n "$V" ] && ARGS+=(--voice "$V")

echo "1과목 소프트웨어 설계를 만듭니다. 20~40분쯤 걸립니다."
echo "중간에 멈춰도 다시 실행하면 이어서 만듭니다."
echo
python3 tools/make_audio.py "${ARGS[@]}"

echo
echo "audio/ 폴더가 열립니다. 파일을 음악 앱이나 휴대폰으로 옮겨 들으시면 됩니다."
open audio 2>/dev/null
echo
read -r -p "엔터를 누르면 닫힙니다..." _
