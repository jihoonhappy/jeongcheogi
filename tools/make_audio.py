#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
정보처리기사 필기 트레이너 — 듣기용 MP3 생성기

문제은행(data/subject*.js)을 읽어 과목별 오디오 파일을 만듭니다.
음악 앱에 넣어 화면을 끄거나 잠근 채로 들을 수 있습니다.

낭독 구성: 문제 → 보기 1~4 → 생각할 시간(무음) → 정답 → 해설

음성 엔진은 두 가지를 지원합니다.
  1) edge-tts  — 마이크로소프트 신경망 음성. 품질이 가장 좋습니다. (인터넷 필요, 무료, 키 불필요)
  2) macOS say — 맥 내장 음성. 인터넷 없이 됩니다. '고급' 음성을 설치하면 쓸 만합니다.

사용법
  python3 tools/make_audio.py --list-voices        # 어떤 목소리가 있는지 보기
  python3 tools/make_audio.py --sample             # 여성 목소리 맛보기 만들기
  python3 tools/make_audio.py --sample --multi     # 다국어 음성까지 포함해 비교
  python3 tools/make_audio.py --subject 1          # 1과목 전체 만들기
  python3 tools/make_audio.py --subject 1 --voice ko-KR-JiMinNeural
  python3 tools/make_audio.py --all                # 5과목 전부

필요한 것
  - Python 3.8 이상
  - ffmpeg          (맥: brew install ffmpeg)
  - edge-tts 쓸 때  (pip3 install edge-tts)
"""

import argparse, asyncio, glob, json, os, re, shutil, subprocess, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
INDEX = os.path.join(ROOT, "index.html")
OUT_ROOT = os.path.join(ROOT, "audio")

SUBJ = {1: "소프트웨어 설계", 2: "소프트웨어 개발", 3: "데이터베이스 구축",
        4: "프로그래밍 언어 활용", 5: "정보시스템 구축관리"}

# 무료 edge-tts 가 실제로 제공하는 한국어 음성은 많지 않습니다.
# (JiMin·SeoHyeon·YuJin 같은 이름은 유료 Azure 전용이라 여기서는 쓸 수 없습니다.)
# 실제 목록은 실행할 때 서버에서 받아 오며, 아래는 못 받았을 때 쓰는 최소 목록입니다.
EDGE_VOICES = [
    ("ko-KR-SunHiNeural", "Female", "여성 · 차분하고 또렷함 · 기본값"),
    ("ko-KR-InJoonNeural", "Male", "남성 · 낮고 안정적"),
    ("ko-KR-HyunsuMultilingualNeural", "Male", "남성 · 최신 모델 · 영어 섞인 문장에 강함"),
]
DEFAULT_VOICE = "ko-KR-SunHiNeural"

# 목소리가 하나뿐이어도 높낮이·빠르기를 바꾸면 과목마다 다른 느낌을 낼 수 있습니다.
# "이름@높낮이" 또는 "이름@높낮이@빠르기" 로 씁니다. 예: ko-KR-SunHiNeural@-12Hz
PITCH_PRESETS = [
    ("ko-KR-SunHiNeural",           "여성 · 기본"),
    ("ko-KR-SunHiNeural@-15Hz",     "여성 · 낮고 차분하게 (자기 전)"),
    ("ko-KR-SunHiNeural@+15Hz",     "여성 · 밝게"),
    ("ko-KR-SunHiNeural@+22Hz@+6%", "여성 · 밝고 또렷하게, 살짝 빠르게"),
    ("ko-KR-SunHiNeural@-8Hz@-8%",  "여성 · 낮고 느리게"),
]

# 다국어(Multilingual) 신경망 음성은 한국어도 읽습니다.
# 한국어 전용 음성이 몇 개 없을 때 목소리 선택지를 넓혀 줍니다.
# 이름에 Multilingual 이 들어간 것을 서버 목록에서 찾아 쓰므로 목록을 외워 둘 필요가 없습니다.
MULTI_HINT = {
    "en-US-AvaMultilingualNeural": "여성 · 밝고 또렷함",
    "en-US-EmmaMultilingualNeural": "여성 · 부드럽고 따뜻함",
    "de-DE-SeraphinaMultilingualNeural": "여성 · 차분하고 단정함",
    "fr-FR-VivienneMultilingualNeural": "여성 · 또렷하고 경쾌함",
    "en-US-AndrewMultilingualNeural": "남성 · 편안함",
    "en-US-BrianMultilingualNeural": "남성 · 또렷함",
}

_PITCH_RE = re.compile(r"^[+-]?\d+(Hz|st)$", re.I)
_RATE_RE = re.compile(r"^[+-]?\d+(%|pct)$", re.I)

def parse_voice(spec):
    """'이름@높낮이@빠르기' 를 (이름, 높낮이, 빠르기) 로 나눕니다.
       샘플 파일명에 쓰인 밑줄 표기(ko-KR-SunHiNeural_-15Hz)도 그대로 받습니다."""
    txt = str(spec).strip()
    if txt.lower().startswith("샘플_") or txt.lower().startswith("sample_"):
        txt = txt.split("_", 1)[1]
    if txt.lower().endswith(".mp3"):
        txt = txt[:-4]
    txt = re.sub(r"_?영문그대로", "", txt)   # 샘플 파일명에 붙는 표시

    if "@" not in txt and "_" in txt:
        # ko-KR-SunHiNeural_-15Hz / ..._p15Hz / ..._-8Hz_-8pct
        head, *tail = txt.split("_")
        conv = []
        for t in tail:
            t2 = t.replace("pct", "%")
            # 파일명에서는 '+' 를 쓸 수 없어 p 로 적습니다: p22Hz → +22Hz, p6pct → +6%
            if t2.startswith("p") and (_PITCH_RE.match(t2[1:]) or _RATE_RE.match(t2[1:])):
                t2 = "+" + t2[1:]
            if _PITCH_RE.match(t2) or _RATE_RE.match(t2):
                conv.append(t2)
            else:
                conv = None
                break
        if conv:
            txt = "@".join([head] + conv)
    parts = [x.strip() for x in txt.split("@")]
    name = parts[0]
    pitch, rate = None, None
    for x in parts[1:]:
        if not x:
            continue
        if _RATE_RE.match(x.replace("pct", "%")):
            rate = x.replace("pct", "%")
        else:
            pitch = x
    return name, pitch, rate

def voice_label(spec):
    return str(spec).replace("@", "_").replace("%", "pct").replace("+", "p")

# ─────────────────────────────────────────────────────────────
# 1. 문제은행 읽기
# ─────────────────────────────────────────────────────────────

def load_bank():
    """data/subject*.js 의 문항 객체를 파싱합니다. 앱과 같은 원본을 씁니다."""
    import subprocess as sp
    node = shutil.which("node")
    if node:
        script = (
            "const fs=require('fs'),vm=require('vm');const ctx={window:{},console};vm.createContext(ctx);"
            "['bank','subject1','subject2','subject3','subject4','subject5']"
            ".forEach(f=>vm.runInContext(fs.readFileSync(%r+'/'+f+'.js','utf8'),ctx));"
            "process.stdout.write(JSON.stringify(ctx.window.QUESTIONS));" % DATA
        )
        try:
            out = sp.check_output([node, "-e", script], text=True)
            return json.loads(out)
        except Exception:
            pass
    # node 가 없으면 정규식으로 읽습니다.
    qs = []
    for s in range(1, 6):
        p = os.path.join(DATA, "subject%d.js" % s)
        if not os.path.exists(p):
            continue
        src = open(p, encoding="utf-8").read()
        for line in src.split("\n"):
            line = line.strip().rstrip(",")
            if not line.startswith("{id:"):
                continue
            try:
                j = re.sub(r'([{,])([a-z]+):', r'\1"\2":', line)
                qs.append(json.loads(j))
            except Exception:
                pass
    if not qs:
        sys.exit("문제은행을 읽지 못했습니다. 저장소 최상위에서 실행해 주세요.")
    return qs

# ─────────────────────────────────────────────────────────────
# 2. 낭독 텍스트 만들기 — 앱의 sayText 와 같은 규칙
# ─────────────────────────────────────────────────────────────

def load_abbr():
    """약어 사전을 index.html 에서 그대로 가져옵니다. 규칙을 두 곳에 두지 않기 위해서입니다."""
    src = open(INDEX, encoding="utf-8").read()
    m = re.search(r"const ABBR = \{(.*?)\n\};", src, re.S)
    if not m:
        return {}
    d = {}
    for k, v in re.findall(r'"([^"]+)"\s*:\s*"([^"]*)"', m.group(1)):
        d[k] = v
    return d

ABBR = {}
ABBR_RE = None

def init_abbr():
    global ABBR, ABBR_RE
    ABBR = load_abbr()
    if not ABBR:
        return
    keys = sorted(ABBR, key=len, reverse=True)
    ABBR_RE = re.compile(
        r"(?<![A-Za-z0-9가-힣])(" + "|".join(re.escape(k) for k in keys) + r")(?![A-Za-z0-9])")

_SINO = "영일이삼사오육칠팔구"

def sino(n):
    """숫자를 한자어 읽기로. 1→일, 2→이, 37→삼십칠.
       TTS에 '1번'을 그대로 주면 '한 번'(횟수)으로 읽어 버리므로 한글로 바꿔 넣습니다."""
    n = int(n)
    if n == 0:
        return "영"
    out = ""
    if n >= 100:
        h = n // 100
        out += ("" if h == 1 else _SINO[h]) + "백"
        n %= 100
    if n >= 10:
        t = n // 10
        out += ("" if t == 1 else _SINO[t]) + "십"
        n %= 10
    if n:
        out += _SINO[n]
    return out

def beon(n):
    return sino(n) + "번"

SAY_EN = False          # True 면 영문을 한글로 바꾸지 않고 그대로 읽힙니다 (다국어 음성용)

def set_say_mode(voice, mode):
    """영문 처리 방식을 정합니다.
       ko   — 영문 괄호는 빼고 약어는 한글 발음으로 (한국어 전용 음성용)
       keep — 영문을 그대로 두어 음성이 영어로 읽게 함 (다국어 음성용)
       auto — 목소리 이름에 Multilingual 이 있으면 keep, 아니면 ko"""
    global SAY_EN
    if mode == "keep":
        SAY_EN = True
    elif mode == "ko":
        SAY_EN = False
    else:
        name = parse_voice(voice)[0] if voice else ""
        SAY_EN = "Multilingual" in str(name)
    return SAY_EN

def say_text(s):
    t = str(s)
    t = t.replace("V(G)", "브이지")
    # 한글 뒤 괄호 안이 영문뿐이면 통째로 뺍니다: 캡슐화(Encapsulation) → 캡슐화
    # SAY_EN 이면 괄호만 없애고 영문은 남겨 둡니다: 캡슐화, Encapsulation,
    t = re.sub(r"\(([^()]*)\)",
               lambda m: ((", " + m.group(1) + ", ") if SAY_EN else "")
                         if re.fullmatch(r"[A-Za-z0-9 .,'’/&+\-_]+", m.group(1))
                         else " " + m.group(1) + " ",
               t)
    t = re.sub(r"[→⇒]", ", 그다음 ", t).replace("↔", ", 그리고 ")
    t = t.replace("&", " 앤 ").replace("×", " 곱하기 ").replace("÷", " 나누기 ")
    for i, ch in enumerate("①②③④"):
        t = t.replace(ch, " " + beon(i + 1) + " ")
    t = re.sub(r"\n+", ". ", t)
    if ABBR_RE and not SAY_EN:
        t = ABBR_RE.sub(lambda m: ABBR.get(m.group(0), m.group(0)), t)
    # 숫자 + 번/과목은 한자어로 읽어야 합니다 (1번 → 한 번(X) / 일번(O))
    t = re.sub(r"(?<![0-9.])([0-9]{1,3})번(?![0-9])", lambda m: beon(m.group(1)), t)
    t = re.sub(r"(?<![0-9.])([1-5])과목", lambda m: sino(m.group(1)) + "과목", t)
    t = re.sub(r"(?<=[가-힣])\s*-\s*(?=[가-힣])", ", ", t)
    t = t.replace("·", ", ")
    t = re.sub(r"[~∼]", " 에서 ", t)
    t = re.sub(r"[\[\]\"']", " ", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\s+([.,])", r"\1", t)
    return t.strip()

def is_mono(q):
    """코드·표·ASCII 트리가 든 문항. 귀로 들어서는 알 수 없으므로 제외합니다."""
    if "\n" not in q:
        return False
    if re.search(r"\n\s{2,}\S", q):
        return True
    return bool(re.search(r"[{};]|\bSELECT\b|\bprintf\b|\bdef\b|\bint\b", q))

def segments_for(q, n, gap):
    """한 문항을 여러 조각으로 나눕니다. (읽을 말, 뒤에 넣을 무음 초)

    조각마다 따로 합성하고 사이에 정확한 길이의 무음을 넣습니다.
    한 번에 길게 읽히면 음성 엔진이 끊어 읽는 위치를 제멋대로 잡아
    부자연스러워지기 때문에, 끊어 읽는 지점을 이쪽에서 정합니다."""
    seg = [("%s 문제." % beon(n), 0.45),
           (say_text(q["q"]), 0.7)]
    for i, c in enumerate(q["c"]):
        seg.append(("%s, %s." % (beon(i + 1), say_text(c)), 0.45))
    seg.append(("정답을 생각해 보세요.", gap))
    seg.append(("정답은 %s, %s." % (beon(q["a"] + 1), say_text(q["c"][q["a"]])), 0.6))
    seg.append(("해설. %s" % say_text(q["e"]), 1.4))
    return seg

# ─────────────────────────────────────────────────────────────
# 3. 음성 합성
# ─────────────────────────────────────────────────────────────

def have(cmd):
    return shutil.which(cmd) is not None

HAS_FFMPEG = False
SILENCE_UNIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "silence-0.5s.mp3")

# ── 음질 설정 ────────────────────────────────────────────────
# 기본값은 edge-tts 가 내보내는 규격 그대로입니다.
#   edge-tts 는 출력 형식이 audio-24khz-48kbitrate-mono-mp3 로 고정돼 있어
#   (edge_tts/communicate.py 의 outputFormat) 재인코딩으로는 음질이 좋아지지 않습니다.
# --hq 는 Azure Speech(--engine azure, 키 필요) 나 macOS say 에서만 뜻이 있습니다.
BITRATE    = "48k"
SAMPLERATE = "24000"
AZURE_FMT  = "audio-24khz-48kbitrate-mono-mp3"
SAY_FMT    = "LEF32@22050"

def set_hq(on):
    """--hq: 48kHz 128kbps 로 올립니다. 원본을 그만큼 뽑아내는 엔진에서만 효과가 있습니다."""
    global BITRATE, SAMPLERATE, AZURE_FMT, SAY_FMT
    if not on:
        return
    BITRATE, SAMPLERATE = "128k", "48000"
    AZURE_FMT = "audio-48khz-192kbitrate-mono-mp3"
    SAY_FMT   = "LEF32@48000"


def ffmpeg(args, **kw):
    return subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args,
                          check=True, **kw)

def make_silence(path, seconds):
    """ffmpeg 이 있으면 만들고, 없으면 함께 들어 있는 0.5초 무음을 이어 붙입니다."""
    if os.path.exists(path):
        return path
    if HAS_FFMPEG:
        ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=%s:cl=mono" % SAMPLERATE,
                "-t", "%.2f" % seconds, "-c:a", "libmp3lame", "-b:a", BITRATE, path])
        return path
    if not os.path.exists(SILENCE_UNIT):
        sys.exit("무음 파일(tools/silence-0.5s.mp3)이 없습니다. ffmpeg 을 설치해 주세요.")
    unit = open(SILENCE_UNIT, "rb").read()
    n = max(1, int(round(seconds / 0.552)))
    with open(path, "wb") as f:
        f.write(unit * n)
    return path

def concat_mp3(seq, out, meta):
    """조각들을 하나로 잇습니다. ffmpeg 이 있으면 재인코딩 + 태그, 없으면 단순 이어붙이기."""
    if HAS_FFMPEG:
        lst = out + ".list.txt"
        with open(lst, "w", encoding="utf-8") as f:
            for p in seq:
                f.write("file '%s'\n" % os.path.abspath(p).replace("'", "'\\''"))
        margs = []
        for k, v in meta.items():
            margs += ["-metadata", "%s=%s" % (k, v)]
        ffmpeg(["-f", "concat", "-safe", "0", "-i", lst,
                "-c:a", "libmp3lame", "-b:a", BITRATE, "-ac", "1", "-ar", SAMPLERATE] + margs + [out])
        os.remove(lst)
    else:
        with open(out, "wb") as w:
            for p in seq:
                with open(p, "rb") as r:
                    shutil.copyfileobj(r, w)

async def edge_all_voices():
    try:
        import edge_tts
        return await edge_tts.list_voices()
    except Exception:
        return []

async def edge_ko_voices():
    """서버에서 실제 쓸 수 있는 한국어 음성 목록을 받아 옵니다. 실패하면 내장 목록을 씁니다."""
    vs = await edge_all_voices()
    ko = [(v["ShortName"], v.get("Gender", ""), v.get("FriendlyName", ""))
          for v in vs if v.get("Locale", "").startswith("ko")]
    if ko:
        ko.sort(key=lambda x: (x[1] != "Female", x[0]))
        return ko
    return EDGE_VOICES

async def edge_multi_voices(gender="Female"):
    """한국어도 읽는 다국어 음성. 이름에 Multilingual 이 들어간 것들입니다."""
    vs = await edge_all_voices()
    out = []
    for v in vs:
        n = v.get("ShortName", "")
        if "Multilingual" not in n:
            continue
        if n.startswith("ko-"):
            continue          # 한국어 전용 목록에서 이미 나옵니다
        g = v.get("Gender", "")
        if gender != "all" and g.lower() != gender.lower():
            continue
        out.append((n, g, MULTI_HINT.get(n, "")))
    # 힌트가 있는 것(검증된 것)을 앞으로
    out.sort(key=lambda x: (not x[2], x[0]))
    if not out:
        out = [(k, "Female" if "여성" in v else "Male", v)
               for k, v in MULTI_HINT.items() if "여성" in v]
    return out

async def edge_say(text, out, voice, rate):
    import edge_tts
    name, pitch, vrate = parse_voice(voice)
    kw = {"voice": name}
    r = vrate or rate
    if r:
        kw["rate"] = r
    if pitch:
        kw["pitch"] = pitch
    c = edge_tts.Communicate(text, **kw)
    await c.save(out)
    # 없는 목소리 이름을 주면 서버가 소리를 주지 않아 0바이트 파일이 만들어집니다.
    if os.path.getsize(out) < 500:
        os.remove(out)
        raise RuntimeError("소리가 만들어지지 않았습니다. 목소리 이름을 확인해 주세요: " + name)

# Azure Speech (유료 계정이지만 매달 50만 자까지 무료). 여성 음성이 여럿 있습니다.
AZURE_VOICES = ["ko-KR-SunHiNeural", "ko-KR-JiMinNeural", "ko-KR-SeoHyeonNeural",
                "ko-KR-YuJinNeural", "ko-KR-SoonBokNeural", "ko-KR-GaeulNeural",
                "ko-KR-InJoonNeural", "ko-KR-BongJinNeural", "ko-KR-GookMinNeural",
                "ko-KR-HyunsuNeural"]

def azure_say(text, out, voice, rate, key, region):
    """Azure Speech REST API. edge-tts 에 없는 목소리를 쓸 때 사용합니다."""
    import urllib.request
    name, pitch, vrate = parse_voice(voice)
    r = vrate or rate
    prosody_open = ""
    prosody_close = ""
    if r or pitch:
        attrs = ""
        if r:
            attrs += ' rate="%s"' % r
        if pitch:
            attrs += ' pitch="%s"' % pitch
        prosody_open = "<prosody%s>" % attrs
        prosody_close = "</prosody>"
    body = ('<speak version="1.0" xml:lang="ko-KR">'
            '<voice name="%s">%s%s%s</voice></speak>'
            % (name, prosody_open,
               text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"),
               prosody_close)).encode("utf-8")
    req = urllib.request.Request(
        "https://%s.tts.speech.microsoft.com/cognitiveservices/v1" % region,
        data=body,
        headers={"Ocp-Apim-Subscription-Key": key,
                 "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": AZURE_FMT,
                 "User-Agent": "jeongcheogi-audio"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if len(data) < 500:
        raise RuntimeError("소리가 만들어지지 않았습니다: " + name)
    with open(out, "wb") as f:
        f.write(data)

def mac_say(text, out, voice):
    if not HAS_FFMPEG:
        sys.exit("macOS 내장 음성(say)으로 만들려면 ffmpeg 이 필요합니다.  brew install ffmpeg")
    aiff = out + ".aiff"
    cmd = ["say", "-o", aiff, "--data-format=" + SAY_FMT]
    if voice:
        cmd += ["-v", voice]
    cmd += [text]
    subprocess.run(cmd, check=True)
    ffmpeg(["-i", aiff, "-c:a", "libmp3lame", "-b:a", BITRATE, "-ac", "1", "-ar", SAMPLERATE, out])
    os.remove(aiff)

# ─────────────────────────────────────────────────────────────
# 4. 만들기
# ─────────────────────────────────────────────────────────────

def build_manifest():
    """audio/ 를 훑어 트랙 목록을 만듭니다. 앱의 오디오 플레이어가 이 파일을 읽습니다.
       이미 만들어 둔 파일만 보므로 다시 합성하지 않습니다."""
    tracks = []
    for s in range(1, 6):
        name = "%d과목_%s" % (s, SUBJ[s].replace(" ", ""))
        d = os.path.join(OUT_ROOT, name)
        if not os.path.isdir(d):
            continue
        for f in sorted(x for x in os.listdir(d) if x.endswith(".mp3")):
            sec = 0
            if have("ffprobe"):
                try:
                    sec = int(float(subprocess.check_output(
                        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                         "-of", "default=nw=1:nk=1", os.path.join(d, f)], text=True).strip()))
                except Exception:
                    pass
            m = re.search(r"_(\d+)-(\d+)\.mp3$", f)
            size = os.path.getsize(os.path.join(d, f))
            if not sec:
                # CBR 이므로 파일 크기로 길이를 구할 수 있습니다 (48kbps = 6000 bytes/초).
                sec = round(size / (int(BITRATE.rstrip("k")) * 1000 / 8), 3)
            tracks.append({
                "s": s,
                "subject": SUBJ[s],
                "file": "%s/%s" % (name, f),
                "title": "%s %s-%s번" % (SUBJ[s], m.group(1), m.group(2)) if m else f[:-4],
                "from": int(m.group(1)) if m else 0,
                "to": int(m.group(2)) if m else 0,
                "sec": sec,
                "bytes": size,
                # 릴리스 자산용 ASCII 이름. GitHub Releases 는 한글 파일명을 보존하지 않습니다.
                "rfile": "s%d_%s" % (s, f.split("과목_", 1)[1]),
            })
    return tracks

def write_manifest():
    tracks = build_manifest()
    if not tracks:
        print("  audio/ 에 만들어 둔 파일이 없습니다.")
        return None
    data = {"version": 1, "tracks": tracks}
    inner = os.path.join(OUT_ROOT, "manifest.json")
    outer = os.path.join(ROOT, "audio-manifest.json")
    for p2 in (inner, outer):
        with open(p2, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    tot = sum(t["sec"] for t in tracks)
    mb = sum(t["bytes"] for t in tracks) / 1024 / 1024
    print("  트랙 %d개 · 약 %d시간 %d분 · %.0f MB" % (len(tracks), tot // 3600, (tot % 3600) // 60, mb))
    print("  %s" % outer)
    print("  이 파일(audio-manifest.json)은 작아서 저장소에 올려도 됩니다.")
    return data

def pack_zip(subs):
    """과목별로 zip 을 만듭니다. 폰·클라우드·다른 PC 로 옮길 때 씁니다."""
    import zipfile
    made = []
    for s in subs:
        d = os.path.join(OUT_ROOT, "%d과목_%s" % (s, SUBJ[s].replace(" ", "")))
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.endswith(".mp3"))
        if not files:
            continue
        z = os.path.join(OUT_ROOT, "%d과목_%s.zip" % (s, SUBJ[s].replace(" ", "")))
        with zipfile.ZipFile(z, "w", zipfile.ZIP_STORED) as zf:   # mp3 는 이미 압축본
            for f in files:
                zf.write(os.path.join(d, f), arcname=f)
        made.append(z)
        print("  %s  (%d개 · %.0f MB)" % (os.path.basename(z), len(files),
                                          os.path.getsize(z) / 1024 / 1024))
    return made

def copy_out(dest, subs):
    """만든 오디오를 다른 폴더로 복사합니다. iCloud Drive, 외장 디스크 등."""
    dest = os.path.expanduser(dest)
    os.makedirs(dest, exist_ok=True)
    n = 0
    for s in subs:
        name = "%d과목_%s" % (s, SUBJ[s].replace(" ", ""))
        src = os.path.join(OUT_ROOT, name)
        if not os.path.isdir(src):
            continue
        dst = os.path.join(dest, name)
        os.makedirs(dst, exist_ok=True)
        for f in sorted(os.listdir(src)):
            if f.endswith(".mp3"):
                shutil.copy2(os.path.join(src, f), os.path.join(dst, f))
                n += 1
    print("  %s 로 %d개 파일을 복사했습니다." % (dest, n))
    return n

def group_name(s, gi, lo, hi):
    return "%d과목_%02d_%03d-%03d.mp3" % (s, gi, lo, hi)

async def check_voice(args):
    """긴 작업을 시작하기 전에 목소리 이름이 실제로 있는지 확인합니다."""
    if args.engine != "edge":
        return True   # Azure·macOS 는 첫 조각 합성에서 바로 오류가 납니다
    name = parse_voice(args.voice)[0]
    vs = await edge_ko_voices()
    names = [v[0] for v in vs]
    if "Multilingual" in name:
        names += [v[0] for v in await edge_multi_voices("all")]
    if name in names:
        return True
    print("✗ '%s' 은(는) 무료 edge-tts 에 없는 목소리입니다." % name)
    print("  쓸 수 있는 한국어 목소리:")
    for v in vs:
        mark = "여성" if (v[1] or "").lower() == "female" else "남성"
        print("     %-36s %s" % (v[0], mark))
    mv = await edge_multi_voices("all")
    if mv:
        print("\n  한국어도 읽는 다국어 음성 (선택지를 넓혀 줍니다):")
        for v in mv[:8]:
            print("     %-40s %s" % (v[0], v[2] or v[1]))
    print("\n  JiMin·SeoHyeon·YuJin 같은 이름은 유료 Azure 전용이라 여기서는 쓸 수 없습니다.")
    print("  목소리 수가 적어도 높낮이를 바꾸면 느낌이 달라집니다. 예:")
    print("     --voice ko-KR-SunHiNeural@-15Hz")
    return False

async def build_subject(s, args):
    if not await check_voice(args):
        sys.exit(1)
    bank = [q for q in load_bank() if q["s"] == s]
    total_before = len(bank)
    bank = [q for q in bank if not is_mono(q["q"])]
    skipped = total_before - len(bank)
    if not bank:
        print("  %d과목: 읽을 문항이 없습니다." % s)
        return

    out_dir = os.path.join(OUT_ROOT, "%d과목_%s" % (s, SUBJ[s].replace(" ", "")))
    # 목소리마다 임시 폴더를 나눕니다. 같이 쓰면 목소리를 바꿔도 옛 조각을 재사용해 버립니다.
    tmp_dir = os.path.join(out_dir, ".tmp-" + voice_label(args.voice or "default"))
    os.makedirs(tmp_dir, exist_ok=True)

    sil_cache = {}
    def sil(sec):
        key = round(sec, 2)
        if key not in sil_cache:
            sil_cache[key] = make_silence(os.path.join(tmp_dir, "_sil_%s.mp3" % str(key).replace(".", "_")), key)
        return sil_cache[key]

    nm, pt, rt = parse_voice(args.voice or "")
    print("  %d과목 %s — %d문항 (코드·표 %d문항 제외), %d문항씩 묶음"
          % (s, SUBJ[s], len(bank), skipped, args.group))
    print("    목소리 %s%s%s"
          % (nm or "기본",
             (" · 높낮이 %s" % pt) if pt else "",
             (" · 빠르기 %s" % rt) if rt else ""))

    sem = asyncio.Semaphore(args.jobs)

    async def synth(text, path):
        if os.path.exists(path) and os.path.getsize(path) > 500:
            return path                      # 이미 만든 것은 건너뜁니다 (중단 후 이어하기)
        async with sem:
            for attempt in range(3):
                try:
                    if args.engine == "edge":
                        await edge_say(text, path, args.voice, args.rate)
                    elif args.engine == "azure":
                        azure_say(text, path, args.voice, args.rate, args.azure_key, args.azure_region)
                    else:
                        mac_say(text, path, args.voice)
                    if os.path.getsize(path) > 500:
                        return path
                except Exception as e:
                    if attempt == 2:
                        print("    ! 실패: %s (%s)" % (os.path.basename(path), str(e)[:80]))
                        return None
                    await asyncio.sleep(1.5 * (attempt + 1))
        return None

    redo = getattr(args, "_redo_ids", None)
    groups = [bank[i:i + args.group] for i in range(0, len(bank), args.group)]
    made = []
    for gi, grp in enumerate(groups, 1):
        lo, hi = (gi - 1) * args.group + 1, (gi - 1) * args.group + len(grp)
        out = os.path.join(out_dir, group_name(s, gi, lo, hi))

        # --redo: 지정한 문항이 들어 있는 묶음만 다시 만듭니다.
        hits = [q["id"] for q in grp if redo and q["id"] in redo]
        if redo is not None:
            if not hits:
                if os.path.exists(out):
                    made.append(out)
                continue
            # 바뀐 문항의 조각 캐시를 지웁니다. 남겨 두면 옛 음성을 그대로 재사용합니다.
            for qid in hits:
                for f in glob.glob(os.path.join(tmp_dir, "q%05d_*.mp3" % qid)):
                    os.remove(f)
            if os.path.exists(out):
                os.remove(out)
            print("    %s — 바뀐 문항 %s 때문에 다시 만듭니다"
                  % (os.path.basename(out), ", ".join(str(x) for x in hits)))
        elif os.path.exists(out) and not args.force:
            print("    %s — 이미 있음, 건너뜀" % os.path.basename(out))
            made.append(out); continue

        intro_txt = "%s. %s부터 %s까지." % (SUBJ[s], beon(lo), beon(hi))
        jobs, seq = [], []
        intro = os.path.join(tmp_dir, "g%02d_intro.mp3" % gi)
        jobs.append(synth(intro_txt, intro)); seq += [intro, sil(1.0)]
        for k, q in enumerate(grp, 1):
            for si, (text, pause) in enumerate(segments_for(q, lo + k - 1, args.gap)):
                sp = os.path.join(tmp_dir, "q%05d_%02d.mp3" % (q["id"], si))
                jobs.append(synth(text, sp))
                seq += [sp, sil(pause)]

        print("    %s 합성 중… (%d문항 · 조각 %d개)"
              % (os.path.basename(out), len(grp), len(jobs)), flush=True)
        await asyncio.gather(*jobs)

        seq = [p for p in seq if p and os.path.exists(p) and os.path.getsize(p) > 500]
        if not seq:
            print("    ! %s 건너뜀 — 만들어진 조각이 없습니다" % os.path.basename(out)); continue

        concat_mp3(seq, out, {
            "title": "%s %d-%d번" % (SUBJ[s], lo, hi),
            "album": "정보처리기사 필기 · %d과목 %s" % (s, SUBJ[s]),
            "artist": "정보처리기사 필기 트레이너",
            "track": "%d" % gi,
            "genre": "Education",
        })
        made.append(out)

    if not args.keep_tmp:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    tot = 0.0
    for p in made:
        if not have("ffprobe"):
            break
        try:
            d = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries",
                                         "format=duration", "-of",
                                         "default=nw=1:nk=1", p], text=True)
            tot += float(d.strip())
        except Exception:
            pass
    size = sum(os.path.getsize(p) for p in made if os.path.exists(p)) / 1024 / 1024
    if tot:
        print("  → %d개 파일 · 약 %d분 %d초 · %.1f MB" % (len(made), int(tot // 60), int(tot % 60), size))
    else:
        print("  → %d개 파일 · %.1f MB" % (len(made), size))
    print("     %s" % out_dir)

# ─────────────────────────────────────────────────────────────

async def make_samples(args):
    os.makedirs(OUT_ROOT, exist_ok=True)
    # 맛보기도 실제로 만들 과목의 문항으로 들려줍니다.
    sub = args.subject or 1
    bank = [q for q in load_bank() if q["s"] == sub and not is_mono(q["q"])]
    q = bank[0]
    sample_text = lambda: " ".join(t for t, _ in segments_for(q, 1, 0))[:600]
    outs = []
    if args.voice:
        # --voice 에 쉼표로 여러 개를 주면 그 목소리들만 비교해 만듭니다.
        cands = [v.strip() for v in str(args.voice).split(",") if v.strip()]
    elif args.engine == "azure":
        cands = AZURE_VOICES[:args.max_samples]
    elif args.engine == "edge":
        vs = await edge_ko_voices()
        names = [v[0] for v in vs]
        if args.gender != "all":
            f = [v for v in vs if (v[1] or "").lower() == args.gender.lower()]
            vs = f or vs
        cands = [v[0] for v in vs][:args.max_samples]
        # 한국어 음성이 적으면 ① 높낮이 변형 ② 한국어도 읽는 다국어 음성 을 함께 만듭니다.
        if len(cands) < 3 or args.multi:
            pitch_v = [c for c, _ in PITCH_PRESETS if parse_voice(c)[0] in names]
            multi_v = [v[0] for v in await edge_multi_voices(args.gender)][:args.max_samples]
            cands = (pitch_v or cands) + multi_v
    else:
        cands = mac_korean_voices() or [None]

    if args.engine == "edge":
        vs = await edge_ko_voices()
        names = [v[0] for v in vs] + [v[0] for v in await edge_multi_voices("all")]
        bad = [c for c in cands if parse_voice(c)[0] not in names]
        if bad:
            print("  ※ 유료 Azure 계정이 있으면 --engine azure 로 이 목소리들을 쓸 수 있습니다.")
        if bad:
            print("  ! 다음 이름은 무료 edge-tts 에 없어 건너뜁니다: %s" % ", ".join(bad))
            print("    쓸 수 있는 목소리: %s" % ", ".join(names))
            cands = [c for c in cands if parse_voice(c)[0] in names]
        if not cands:
            print("\n  높낮이를 바꾼 변형으로 대신 만듭니다.")
            cands = [c for c, _ in PITCH_PRESETS if parse_voice(c)[0] in names]
    print("  %d과목 %s 문항으로 만듭니다.\n" % (sub, SUBJ[sub]))
    desc = dict(PITCH_PRESETS)
    desc.update(MULTI_HINT)
    for v in cands:
        name = voice_label(v or "기본").replace(" ", "")
        en = set_say_mode(v, args.english)      # 목소리마다 영문 처리 방식을 다시 정합니다
        if en:
            name += "_영문그대로"
        text = sample_text()
        out = os.path.join(OUT_ROOT, "샘플_%s.mp3" % name)
        if desc.get(v):
            print("  (%s)" % desc[v])
        print("  %s 만드는 중…" % name, flush=True)
        try:
            if args.engine == "edge":
                await edge_say(text, out, v, args.rate)
            elif args.engine == "azure":
                azure_say(text, out, v, args.rate, args.azure_key, args.azure_region)
            else:
                mac_say(text, out, v)
            outs.append(out)
        except Exception as e:
            print("   ! %s 실패: %s" % (name, str(e)[:90]))
    print("\n샘플 %d개를 만들었습니다:" % len(outs))
    for o in outs:
        print("  " + o)
    print("\n들어 보시고, 마음에 드는 것의 명령을 그대로 복사해 쓰세요:")
    for v in cands:
        if not any(voice_label(v) in os.path.basename(o) for o in outs):
            continue
        print("  python3 tools/make_audio.py --subjects 2,3,4,5 --voice %s" % v)

def mac_korean_voices():
    try:
        out = subprocess.check_output(["say", "-v", "?"], text=True)
    except Exception:
        return []
    vs = []
    for line in out.split("\n"):
        m = re.match(r"^(\S[^#]*?)\s+(ko_KR)\s+#", line)
        if m:
            vs.append(m.group(1).strip())
    return vs

async def list_voices(args):
    print("■ macOS 내장 음성 (say)")
    vs = mac_korean_voices()
    if vs:
        for v in vs:
            print("   " + v)
        print("   ※ '고급/프리미엄' 음성은 설정 → 손쉬운 사용 → 말하기 → 시스템 음성에서 추가로 내려받습니다.")
    else:
        print("   (없거나 macOS가 아닙니다)")
    print("\n■ Azure Speech — 계정이 있으면(월 50만 자 무료) 한국어 여성 음성이 여럿입니다")
    for v in AZURE_VOICES:
        print("   " + v)
    print("   사용: --engine azure --azure-key <키>  (또는 환경변수 AZURE_SPEECH_KEY)")
    print("\n■ edge-tts 신경망 음성 — 계정 없이 바로 쓸 수 있습니다")
    for v, desc in EDGE_VOICES:
        print("   %-36s %s" % (v, desc))
    try:
        import edge_tts  # noqa
        print("\n   edge-tts 설치됨 ✓")
    except ImportError:
        print("\n   edge-tts 미설치 — 설치: pip3 install edge-tts")

def main():
    ap = argparse.ArgumentParser(description="정보처리기사 필기 듣기용 MP3 생성기")
    ap.add_argument("--subject", type=int, choices=[1, 2, 3, 4, 5], help="만들 과목")
    ap.add_argument("--subjects", default=None, help="여러 과목 (예: 2,3,4,5)")
    ap.add_argument("--all", action="store_true", help="5과목 전부")
    ap.add_argument("--sample", action="store_true", help="목소리별 맛보기만 만들기")
    ap.add_argument("--list-voices", action="store_true", help="쓸 수 있는 목소리 보기")
    ap.add_argument("--voice", default=None, help="목소리 이름")
    ap.add_argument("--gender", choices=["Female", "Male", "all"], default="Female",
                    help="맛보기로 만들 목소리 성별. 기본 Female")
    ap.add_argument("--max-samples", type=int, default=4, help="맛보기 개수. 기본 4")
    ap.add_argument("--multi", action="store_true",
                    help="한국어도 읽는 다국어 음성까지 맛보기에 포함합니다")
    ap.add_argument("--engine", choices=["edge", "azure", "say"], default=None, help="음성 엔진")
    ap.add_argument("--azure-key", default=os.environ.get("AZURE_SPEECH_KEY"),
                    help="Azure Speech 키 (환경변수 AZURE_SPEECH_KEY 로도 됩니다)")
    ap.add_argument("--azure-region", default=os.environ.get("AZURE_SPEECH_REGION", "koreacentral"),
                    help="Azure 지역. 기본 koreacentral")
    ap.add_argument("--english", choices=["auto", "ko", "keep"], default="auto",
                    help="영문 읽는 방식. auto=다국어 음성이면 영어 그대로, "
                         "ko=한글 발음으로(SQL→에스큐엘), keep=항상 영어 그대로")
    ap.add_argument("--rate", default=None, help="말 빠르기 (예: +10%%)")
    ap.add_argument("--pitch", default=None, help="목소리 높낮이 (예: -15Hz)")
    ap.add_argument("--gap", type=float, default=5.0, help="생각할 시간(초). 기본 5")
    ap.add_argument("--group", type=int, default=10, help="한 파일에 담을 문항 수. 기본 10")
    ap.add_argument("--jobs", type=int, default=4, help="동시 합성 수. 기본 4")
    ap.add_argument("--force", action="store_true", help="이미 만든 파일도 다시 만들기")
    ap.add_argument("--clean-samples", action="store_true",
                    help="맛보기 파일만 지웁니다 (과목 폴더는 건드리지 않습니다)")
    ap.add_argument("--manifest", action="store_true",
                    help="이미 만든 파일로 트랙 목록(audio-manifest.json)을 만듭니다")
    ap.add_argument("--zip", action="store_true",
                    help="만든 뒤 과목별 zip 으로 묶습니다 (폰·클라우드로 옮길 때)")
    ap.add_argument("--copy-to", default=None,
                    help="만든 뒤 이 폴더로 복사합니다 (예: ~/Library/Mobile Documents/com~apple~CloudDocs/정처기음성)")
    ap.add_argument("--redo", default=None,
                    help="바뀐 문항 id 가 들어 있는 묶음만 다시 만들기. "
                         "쉼표로 구분한 id 목록 또는 id 목록이 담긴 파일 경로 "
                         "(예: --redo 1006,1007,1019  /  --redo changed_ids.json)")
    ap.add_argument("--hq", action="store_true",
                    help="48kHz 128kbps 로 만들기. Azure(--engine azure) 나 say 에서만 효과가 있습니다. "
                         "edge-tts 는 24kHz 48kbps 고정입니다")
    ap.add_argument("--keep-tmp", action="store_true", help="중간 파일 남기기")
    args = ap.parse_args()

    global HAS_FFMPEG
    HAS_FFMPEG = have("ffmpeg")
    if not HAS_FFMPEG:
        print("알림: ffmpeg 이 없어 단순 이어붙이기로 만듭니다. 재생에는 문제가 없지만,")
        print("      곡 정보(제목·앨범)가 붙지 않습니다. 원하시면: brew install ffmpeg\n")

    if args.engine is None:
        if args.azure_key:
            args.engine = "azure"
        else:
            try:
                import edge_tts  # noqa
                args.engine = "edge"
            except ImportError:
                args.engine = "say" if have("say") else None
        if args.engine is None:
            sys.exit("음성 엔진이 없습니다.  pip3 install edge-tts  를 먼저 실행해 주세요.")

    if args.engine == "azure" and not args.azure_key:
        sys.exit("Azure 를 쓰려면 키가 필요합니다.  --azure-key 또는 환경변수 AZURE_SPEECH_KEY")

    args._redo_ids = None
    if args.redo:
        raw = args.redo
        if os.path.exists(raw):
            raw = open(raw, encoding="utf-8").read()
        ids = {int(x) for x in re.findall(r"\d{4,5}", raw)}
        if not ids:
            sys.exit("--redo 에서 문항 id 를 찾지 못했습니다.")
        args._redo_ids = ids
        args.force = True
        print("다시 만들 문항 %d개: %s\n" % (len(ids), ", ".join(str(i) for i in sorted(ids))))

    set_hq(args.hq)
    if args.hq and args.engine == "edge":
        print("알림: edge-tts 는 출력이 24kHz 48kbps 로 고정돼 있습니다 (edge_tts 소스에서 확인).")
        print("      --hq 로 다시 인코딩해도 음질은 좋아지지 않고 파일만 커집니다.")
        print("      음질을 올리려면 --engine azure (Azure Speech 키 필요) 를 쓰십시오.\n")
    if args.engine in ("edge", "azure") and args.voice is None and not args.sample:
        args.voice = DEFAULT_VOICE
    if args.pitch and args.voice and "@" not in str(args.voice):
        args.voice = "%s@%s" % (args.voice, args.pitch)

    # 샘플 파일명을 그대로 붙여넣은 경우, 그 샘플의 영문 처리 방식을 이어받습니다.
    if args.voice and "영문그대로" in str(args.voice) and args.english == "auto":
        args.english = "keep"

    init_abbr()
    if set_say_mode(args.voice, args.english):
        print("영문은 한글로 바꾸지 않고 그대로 읽힙니다 (다국어 음성).")

    if args.manifest:
        print("트랙 목록을 만듭니다.")
        write_manifest()
        return

    if args.clean_samples:
        n = 0
        if os.path.isdir(OUT_ROOT):
            for f in os.listdir(OUT_ROOT):
                if f.startswith("샘플_") and f.endswith(".mp3"):
                    os.remove(os.path.join(OUT_ROOT, f)); n += 1
        print("맛보기 %d개를 지웠습니다. 과목 폴더는 그대로입니다." % n)
        return

    if args.list_voices:
        asyncio.run(list_voices(args)); return
    if args.sample:
        print("맛보기 만드는 중 (엔진: %s)" % args.engine)
        asyncio.run(make_samples(args)); return

    picked = bool(args.subjects or args.all or args.subject)
    if args.subjects:
        subs = [int(x) for x in re.findall(r"[1-5]", args.subjects)]
    elif args.all:
        subs = [1, 2, 3, 4, 5]
    elif args.subject:
        subs = [args.subject]
    else:
        subs = [1]

    # 과목을 따로 지정하지 않고 --zip / --copy-to 만 주면,
    # 새로 만들지 않고 이미 만들어 둔 것만 묶거나 복사합니다.
    if (args.zip or args.copy_to) and not picked:
        have_subs = [x for x in range(1, 6)
                     if os.path.isdir(os.path.join(OUT_ROOT, "%d과목_%s" % (x, SUBJ[x].replace(" ", ""))))]
        if not have_subs:
            sys.exit("audio/ 에 만들어 둔 과목이 없습니다.")
        print("이미 만들어 둔 과목만 처리합니다: %s\n"
              % ", ".join("%d과목" % x for x in have_subs))
        if args.zip:
            pack_zip(have_subs)
        if args.copy_to:
            copy_out(args.copy_to, have_subs)
        print("\n끝났습니다.")
        return
    print("음성 엔진: %s / 목소리: %s / 생각할 시간: %.0f초"
          % (args.engine, args.voice or "기본", args.gap))
    os.makedirs(OUT_ROOT, exist_ok=True)
    done = []
    for s2 in range(1, 6):
        d = os.path.join(OUT_ROOT, "%d과목_%s" % (s2, SUBJ[s2].replace(" ", "")))
        if os.path.isdir(d) and any(f.endswith(".mp3") for f in os.listdir(d)):
            done.append(s2)
    if done:
        print("이미 만들어 둔 과목: %s (그대로 두고 건너뜁니다. 다시 만들려면 --force)"
              % ", ".join("%d과목" % x for x in done))
    print()
    for s in subs:
        asyncio.run(build_subject(s, args))

    print("\n트랙 목록을 만드는 중…")
    write_manifest()

    if args.zip:
        print("\nzip 으로 묶는 중…")
        pack_zip(subs)
    if args.copy_to:
        print("\n복사하는 중…")
        copy_out(args.copy_to, subs)

    print("\n끝났습니다.")
    print("  만든 위치: %s" % OUT_ROOT)
    print("  이 폴더는 git 에 올라가지 않으므로, 다른 기기에서도 들으시려면 옮겨 두세요:")
    print("    --zip           과목별 zip 으로 묶기")
    print("    --copy-to 경로   iCloud Drive 등 다른 폴더로 복사")

if __name__ == "__main__":
    main()
