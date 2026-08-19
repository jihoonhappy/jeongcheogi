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
  python3 tools/make_audio.py --sample             # 목소리별 30초 맛보기 만들기
  python3 tools/make_audio.py --subject 1          # 1과목 전체 만들기
  python3 tools/make_audio.py --subject 1 --voice ko-KR-InJoonNeural
  python3 tools/make_audio.py --all                # 5과목 전부

필요한 것
  - Python 3.8 이상
  - ffmpeg          (맥: brew install ffmpeg)
  - edge-tts 쓸 때  (pip3 install edge-tts)
"""

import argparse, asyncio, json, os, re, shutil, subprocess, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
INDEX = os.path.join(ROOT, "index.html")
OUT_ROOT = os.path.join(ROOT, "audio")

SUBJ = {1: "소프트웨어 설계", 2: "소프트웨어 개발", 3: "데이터베이스 구축",
        4: "프로그래밍 언어 활용", 5: "정보시스템 구축관리"}

# edge-tts 한국어 신경망 음성. 이름 뒤 설명은 골라 쓰실 때 참고용입니다.
EDGE_VOICES = [
    ("ko-KR-SunHiNeural",  "여성 · 차분하고 또렷함 · 기본값으로 권장"),
    ("ko-KR-InJoonNeural", "남성 · 낮고 안정적 · 자기 전 듣기 좋음"),
    ("ko-KR-HyunsuMultilingualNeural", "남성 · 최신 모델 · 영어 섞인 문장에 강함"),
]

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

def say_text(s):
    t = str(s)
    t = t.replace("V(G)", "브이지")
    # 한글 뒤 괄호 안이 영문뿐이면 통째로 뺍니다: 캡슐화(Encapsulation) → 캡슐화
    t = re.sub(r"\(([^()]*)\)",
               lambda m: "" if re.fullmatch(r"[A-Za-z0-9 .,'’/&+\-_]+", m.group(1)) else " " + m.group(1) + " ",
               t)
    t = re.sub(r"[→⇒]", " 다음 ", t).replace("↔", " 그리고 ")
    t = t.replace("&", " 앤 ").replace("×", " 곱하기 ").replace("÷", " 나누기 ")
    for i, ch in enumerate("①②③④"):
        t = t.replace(ch, " %d번 " % (i + 1))
    t = re.sub(r"\n+", ". ", t)
    if ABBR_RE:
        t = ABBR_RE.sub(lambda m: ABBR.get(m.group(0), m.group(0)), t)
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

def parts_for(q, n):
    """한 문항을 (앞부분, 뒷부분)으로 나눕니다. 그 사이에 생각할 시간을 넣습니다."""
    head = "%d번 문제. %s " % (n, say_text(q["q"]))
    for i, c in enumerate(q["c"]):
        head += "%d번, %s. " % (i + 1, say_text(c))
    head += "정답을 생각해 보세요."
    tail = "정답은 %d번, %s. 해설. %s" % (q["a"] + 1, say_text(q["c"][q["a"]]), say_text(q["e"]))
    return head, tail

# ─────────────────────────────────────────────────────────────
# 3. 음성 합성
# ─────────────────────────────────────────────────────────────

def have(cmd):
    return shutil.which(cmd) is not None

HAS_FFMPEG = False
SILENCE_UNIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "silence-0.5s.mp3")

def ffmpeg(args, **kw):
    return subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args,
                          check=True, **kw)

def make_silence(path, seconds):
    """ffmpeg 이 있으면 만들고, 없으면 함께 들어 있는 0.5초 무음을 이어 붙입니다."""
    if os.path.exists(path):
        return path
    if HAS_FFMPEG:
        ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                "-t", "%.2f" % seconds, "-c:a", "libmp3lame", "-b:a", "48k", path])
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
                "-c:a", "libmp3lame", "-b:a", "48k", "-ac", "1", "-ar", "24000"] + margs + [out])
        os.remove(lst)
    else:
        with open(out, "wb") as w:
            for p in seq:
                with open(p, "rb") as r:
                    shutil.copyfileobj(r, w)

async def edge_say(text, out, voice, rate):
    import edge_tts
    kw = {"voice": voice}
    if rate:
        kw["rate"] = rate
    c = edge_tts.Communicate(text, **kw)
    await c.save(out)

def mac_say(text, out, voice):
    if not HAS_FFMPEG:
        sys.exit("macOS 내장 음성(say)으로 만들려면 ffmpeg 이 필요합니다.  brew install ffmpeg")
    aiff = out + ".aiff"
    cmd = ["say", "-o", aiff, "--data-format=LEF32@22050"]
    if voice:
        cmd += ["-v", voice]
    cmd += [text]
    subprocess.run(cmd, check=True)
    ffmpeg(["-i", aiff, "-c:a", "libmp3lame", "-b:a", "48k", "-ac", "1", "-ar", "24000", out])
    os.remove(aiff)

# ─────────────────────────────────────────────────────────────
# 4. 만들기
# ─────────────────────────────────────────────────────────────

def group_name(s, gi, lo, hi):
    return "%d과목_%02d_%03d-%03d.mp3" % (s, gi, lo, hi)

async def build_subject(s, args):
    bank = [q for q in load_bank() if q["s"] == s]
    total_before = len(bank)
    bank = [q for q in bank if not is_mono(q["q"])]
    skipped = total_before - len(bank)
    if not bank:
        print("  %d과목: 읽을 문항이 없습니다." % s)
        return

    out_dir = os.path.join(OUT_ROOT, "%d과목_%s" % (s, SUBJ[s].replace(" ", "")))
    tmp_dir = os.path.join(out_dir, ".tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    gap = make_silence(os.path.join(tmp_dir, "_gap.mp3"), args.gap)
    tail_gap = make_silence(os.path.join(tmp_dir, "_tail.mp3"), 1.2)

    print("  %d과목 %s — %d문항 (코드·표 %d문항 제외), %d문항씩 묶음"
          % (s, SUBJ[s], len(bank), skipped, args.group))

    sem = asyncio.Semaphore(args.jobs)

    async def synth(text, path):
        if os.path.exists(path) and os.path.getsize(path) > 500:
            return path                      # 이미 만든 것은 건너뜁니다 (중단 후 이어하기)
        async with sem:
            for attempt in range(3):
                try:
                    if args.engine == "edge":
                        await edge_say(text, path, args.voice, args.rate)
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

    groups = [bank[i:i + args.group] for i in range(0, len(bank), args.group)]
    made = []
    for gi, grp in enumerate(groups, 1):
        lo, hi = (gi - 1) * args.group + 1, (gi - 1) * args.group + len(grp)
        out = os.path.join(out_dir, group_name(s, gi, lo, hi))
        if os.path.exists(out) and not args.force:
            print("    %s — 이미 있음, 건너뜀" % os.path.basename(out))
            made.append(out); continue

        intro_txt = "%d과목, %s. %d번부터 %d번까지." % (s, SUBJ[s], lo, hi)
        jobs, seq = [], []
        intro = os.path.join(tmp_dir, "g%02d_intro.mp3" % gi)
        jobs.append(synth(intro_txt, intro)); seq.append(intro)
        for k, q in enumerate(grp, 1):
            head, tail = parts_for(q, lo + k - 1)
            hp = os.path.join(tmp_dir, "q%05d_a.mp3" % q["id"])
            tp = os.path.join(tmp_dir, "q%05d_b.mp3" % q["id"])
            jobs.append(synth(head, hp)); jobs.append(synth(tail, tp))
            seq += [hp, gap, tp, tail_gap]

        print("    %s 합성 중… (%d문항)" % (os.path.basename(out), len(grp)), flush=True)
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
    bank = [q for q in load_bank() if q["s"] == 1 and not is_mono(q["q"])]
    q = bank[0]
    head, tail = parts_for(q, 1)
    text = head + " ... " + tail
    text = text[:600]
    outs = []
    if args.engine == "edge":
        cands = [v for v, _ in EDGE_VOICES]
    else:
        cands = mac_korean_voices() or [None]
    for v in cands:
        name = (v or "기본").replace(" ", "")
        out = os.path.join(OUT_ROOT, "샘플_%s.mp3" % name)
        print("  %s 만드는 중…" % name, flush=True)
        try:
            if args.engine == "edge":
                await edge_say(text, out, v, args.rate)
            else:
                mac_say(text, out, v)
            outs.append(out)
        except Exception as e:
            print("   ! %s 실패: %s" % (name, str(e)[:90]))
    print("\n샘플 %d개를 만들었습니다:" % len(outs))
    for o in outs:
        print("  " + o)
    print("\n들어 보시고 마음에 드는 것으로 만드세요:")
    print("  python3 tools/make_audio.py --subject 1 --voice <목소리이름>")

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
    print("\n■ edge-tts 신경망 음성 — 품질이 가장 좋습니다")
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
    ap.add_argument("--all", action="store_true", help="5과목 전부")
    ap.add_argument("--sample", action="store_true", help="목소리별 맛보기만 만들기")
    ap.add_argument("--list-voices", action="store_true", help="쓸 수 있는 목소리 보기")
    ap.add_argument("--voice", default=None, help="목소리 이름")
    ap.add_argument("--engine", choices=["edge", "say"], default=None, help="음성 엔진")
    ap.add_argument("--rate", default=None, help="말 빠르기 (예: +10%%)")
    ap.add_argument("--gap", type=float, default=5.0, help="생각할 시간(초). 기본 5")
    ap.add_argument("--group", type=int, default=10, help="한 파일에 담을 문항 수. 기본 10")
    ap.add_argument("--jobs", type=int, default=4, help="동시 합성 수. 기본 4")
    ap.add_argument("--force", action="store_true", help="이미 만든 파일도 다시 만들기")
    ap.add_argument("--keep-tmp", action="store_true", help="중간 파일 남기기")
    args = ap.parse_args()

    global HAS_FFMPEG
    HAS_FFMPEG = have("ffmpeg")
    if not HAS_FFMPEG:
        print("알림: ffmpeg 이 없어 단순 이어붙이기로 만듭니다. 재생에는 문제가 없지만,")
        print("      곡 정보(제목·앨범)가 붙지 않습니다. 원하시면: brew install ffmpeg\n")

    if args.engine is None:
        try:
            import edge_tts  # noqa
            args.engine = "edge"
        except ImportError:
            args.engine = "say" if have("say") else None
        if args.engine is None:
            sys.exit("음성 엔진이 없습니다.  pip3 install edge-tts  를 먼저 실행해 주세요.")

    if args.engine == "edge" and args.voice is None:
        args.voice = EDGE_VOICES[0][0]

    init_abbr()

    if args.list_voices:
        asyncio.run(list_voices(args)); return
    if args.sample:
        print("맛보기 만드는 중 (엔진: %s)" % args.engine)
        asyncio.run(make_samples(args)); return

    subs = [1, 2, 3, 4, 5] if args.all else ([args.subject] if args.subject else [1])
    print("음성 엔진: %s / 목소리: %s / 생각할 시간: %.0f초"
          % (args.engine, args.voice or "기본", args.gap))
    os.makedirs(OUT_ROOT, exist_ok=True)
    for s in subs:
        asyncio.run(build_subject(s, args))
    print("\n끝났습니다. audio/ 폴더를 음악 앱이나 휴대폰으로 옮겨 들으시면 됩니다.")

if __name__ == "__main__":
    main()
