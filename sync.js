/* ═══════════════════════════════════════════════════════════════
   기기 간 학습기록 동기화 — 화면 동작
   보내는 쪽은 기록을 QR 여러 장으로 나눠 보여 주고,
   받는 쪽은 카메라로 모아 기존 기록과 합칩니다.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var S = window.JBSync;
  var PENDING = "jbg-sync-pending";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); };

  /* ── 작은 체크섬 (FNV-1a 32bit → 4자리 36진수) ── */
  function ck(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("000" + (h % 1679616).toString(36)).slice(-4);
  }
  function rid() {
    var s = "", c = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  /* ── 스크립트 지연 로딩 (필요할 때만 내려받습니다) ── */
  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { loaded[src] = null; no(new Error(src + " 를 불러오지 못했습니다")); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  /* ══════════ 탭 ══════════ */
  var panes = { send: ["tab-send", "pane-send"], recv: ["tab-recv", "pane-recv"], file: ["tab-file", "pane-file"] };
  function tab(name) {
    Object.keys(panes).forEach(function (k) {
      $(panes[k][0]).classList.toggle("on", k === name);
      $(panes[k][1]).classList.toggle("hide", k !== name);
    });
    if (name !== "recv") stopCam();
    if (name !== "send") stopPlay();
  }
  $("tab-send").onclick = function () { tab("send"); };
  $("tab-recv").onclick = function () { tab("recv"); renderPending(); };
  $("tab-file").onclick = function () { tab("file"); };

  /* ══════════ 요약 ══════════ */
  function renderSummary() {
    var p = S.collect();
    var box5 = p.concept.filter(function (r) { return r.box >= 5; }).length;
    $("summary").innerHTML =
      '<div class="s4"><b>' + p.concept.length + '</b><small>개념 문항</small></div>' +
      '<div class="s4"><b>' + p.exam.length + '</b><small>기출 문항</small></div>' +
      '<div class="s4"><b>' + p.days.length + '</b><small>학습한 날</small></div>' +
      '<div class="s4"><b>' + box5 + '</b><small>복습 5단계</small></div>';
    $("zipnote").innerHTML = S.hasCompression()
      ? "기록을 압축해 보냅니다."
      : '<span style="color:var(--mag)">이 브라우저는 압축을 지원하지 않아 QR 장수가 늘어납니다.</span>';
  }

  /* ══════════ 보내기 ══════════ */
  var parts = [], cur = 0, timer = null;

  function buildParts(code, chunkLen) {
    var sid = rid(), sum = ck(code), n = Math.ceil(code.length / chunkLen) || 1;
    var base = location.href.split("#")[0];
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(base + "#p=" + sid + "." + (i + 1) + "." + n + "." + sum + "." + code.substr(i * chunkLen, chunkLen));
    }
    return out;
  }

  function drawQR(text) {
    var q = qrcode(0, "M");
    q.addData(text, "Byte");
    q.make();
    var m = q.getModuleCount(), quiet = 4, total = m + quiet * 2;
    var cv = $("qrcv"), scale = Math.max(2, Math.floor(760 / total));
    cv.width = cv.height = total * scale;
    var g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#16233A";
    for (var r = 0; r < m; r++) for (var c = 0; c < m; c++) {
      if (q.isDark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
    return m;
  }

  function showPart(i) {
    if (!parts.length) return;
    cur = (i + parts.length) % parts.length;
    var mods = drawQR(parts[cur]);
    $("qrmeta").textContent = (cur + 1) + " / " + parts.length + " 번째 조각";
    $("qrsub").textContent = "QR 격자 " + mods + "×" + mods + " · 전체 " + parts.length + "장을 모두 읽어야 합니다";
    var d = "";
    for (var k = 0; k < parts.length; k++) d += '<span class="dt' + (k === cur ? " on" : "") + '"></span>';
    $("qrdots").innerHTML = d;
  }
  function startPlay() {
    stopPlay();
    if (parts.length < 2) return;
    timer = setInterval(function () { showPart(cur + 1); }, 1400);
    $("qr-play").textContent = "⏸ 자동넘김 끄기";
  }
  function stopPlay() {
    if (timer) { clearInterval(timer); timer = null; }
    $("qr-play").textContent = "▶ 자동넘김 켜기";
  }

  $("go-make").onclick = function () {
    var btn = this; btn.disabled = true; btn.textContent = "만드는 중…";
    var payload = S.collect({ days: $("opt-days").checked });
    S.encode(payload).then(function (code) {
      return loadScript("lib/qrgen.min.js").then(function () {
        parts = buildParts(code, +$("opt-chunk").value);
        $("qrarea").classList.remove("hide");
        showPart(0);
        startPlay();
      });
    }).catch(function (e) {
      $("qrarea").classList.remove("hide");
      $("qrarea").innerHTML = '<div class="bad">QR 을 만들지 못했습니다 — ' + esc(e.message) + "</div>";
    }).then(function () {
      btn.disabled = false; btn.textContent = "QR 다시 만들기";
    });
  };
  $("qr-prev").onclick = function () { stopPlay(); showPart(cur - 1); };
  $("qr-next").onclick = function () { stopPlay(); showPart(cur + 1); };
  $("qr-play").onclick = function () { timer ? stopPlay() : startPlay(); };

  /* ══════════ 조각 모으기 ══════════ */
  function readPending() {
    try { var s = localStorage.getItem(PENDING); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function writePending(p) {
    try { p ? localStorage.setItem(PENDING, JSON.stringify(p)) : localStorage.removeItem(PENDING); } catch (e) {}
  }

  /* 조각 하나를 받아 저장합니다. 다 모이면 합치기까지 진행합니다.
     반환: {state:'need'|'done'|'dup'|'bad', got, n} */
  function takeFragment(frag) {
    var m = /^([a-z0-9]{4})\.(\d+)\.(\d+)\.([a-z0-9]{4})\.([A-Za-z0-9_-]*)$/.exec(frag);
    if (!m) return { state: "bad" };
    var sid = m[1], i = +m[2], n = +m[3], sum = m[4], data = m[5];
    var p = readPending();
    if (!p || p.sid !== sid || p.n !== n) p = { sid: sid, n: n, ck: sum, parts: {} };
    var dup = p.parts[i] !== undefined;
    p.parts[i] = data;
    var got = Object.keys(p.parts).length;
    writePending(p);
    if (got < n) return { state: dup ? "dup" : "need", got: got, n: n };
    return { state: "done", got: got, n: n, code: assemble(p) };
  }
  function assemble(p) {
    var s = "";
    for (var i = 1; i <= p.n; i++) s += p.parts[i];
    return { code: s, ok: ck(s) === p.ck };
  }

  function applyCode(code, into) {
    return S.decode(code).then(function (obj) {
      var r = S.merge(obj);
      into.innerHTML =
        '<div class="ok"><b>합치기 완료.</b><br>' +
        "개념 " + r.conceptNew + "문항 새로 추가 · " + r.conceptUpd + "문항 갱신 · " +
        "기출 " + r.examNew + "문항 새로 추가 · " + r.examUpd + "문항 갱신" +
        (r.days ? " · 일별 통계 " + r.days + "일" : "") +
        '<br><a href="index.html">개념 학습으로</a> · <a href="gichul.html">기출 트레이너로</a></div>';
      renderSummary();
      return r;
    }).catch(function (e) {
      into.innerHTML = '<div class="bad">읽지 못했습니다 — ' + esc(e.message) + "</div>";
      throw e;
    });
  }

  function renderPending() {
    var p = readPending(), el = $("pending");
    if (!p) { el.innerHTML = '<div class="note" style="margin-top:0">모으는 중인 조각이 없습니다.</div>'; return; }
    var got = Object.keys(p.parts).length, d = "", miss = [];
    for (var i = 1; i <= p.n; i++) {
      var has = p.parts[i] !== undefined;
      d += '<span class="dt' + (has ? " on" : "") + '"></span>';
      if (!has) miss.push(i);
    }
    el.innerHTML =
      '<div class="prog">' + p.n + "장 중 " + got + "장 받음</div>" +
      '<div class="dots">' + d + "</div>" +
      (miss.length ? '<div class="note">아직 못 받은 조각: ' + miss.join(", ") + "번</div>" : "") +
      '<div class="row" style="margin-top:10px"><button class="btn btn-sm btn-mag" id="pd-clear">모은 조각 버리기</button></div>';
    var b = $("pd-clear");
    if (b) b.onclick = function () { writePending(null); renderPending(); };
  }

  function handleFragment(frag, box) {
    var r = takeFragment(frag);
    if (r.state === "bad") { box.innerHTML = '<div class="bad">알 수 없는 코드입니다.</div>'; return r; }
    if (r.state !== "done") {
      box.innerHTML = '<div class="warn">' + r.n + "장 중 " + r.got + "장 받았습니다. 남은 QR 을 계속 찍으세요.</div>";
      renderPending();
      return r;
    }
    if (!r.code.ok) {
      box.innerHTML = '<div class="bad">조각을 다 모았지만 검사값이 맞지 않습니다. [모은 조각 버리기] 후 다시 찍어 주세요.</div>';
      renderPending();
      return r;
    }
    applyCode(r.code.code, box).then(function () { writePending(null); renderPending(); },
      function () { renderPending(); });
    return r;
  }

  /* 주소창 해시로 들어온 조각 (기본 카메라 앱으로 찍은 경우)
     이미 이 화면이 열려 있으면 주소만 바뀌므로 hashchange 도 함께 듣습니다. */
  function checkHash() {
    var h = location.hash || "";
    if (h.indexOf("#p=") !== 0) return;
    var frag = h.slice(3);
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    tab("recv");
    handleFragment(frag, $("inbox"));
    renderPending();
  }
  window.addEventListener("hashchange", checkHash);
  checkHash();

  /* ══════════ 카메라 ══════════ */
  var stream = null, raf = null, scanning = false;

  function stopCam() {
    scanning = false;
    if (raf) { clearTimeout(raf); raf = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    $("camarea").classList.add("hide");
    $("cam-stop").classList.add("hide");
    $("cam-start").classList.remove("hide");
  }

  $("cam-stop").onclick = stopCam;
  $("cam-start").onclick = function () {
    var err = $("camerr"); err.innerHTML = "";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      err.innerHTML = '<div class="bad">이 브라우저에서는 카메라를 쓸 수 없습니다. 기본 카메라 앱으로 QR 을 찍거나 [코드 · 파일] 탭을 쓰세요.</div>';
      return;
    }
    var btn = this; btn.disabled = true; btn.textContent = "카메라 여는 중…";
    loadScript("lib/jsqr.min.js")
      .then(function () {
        // 뒷면 카메라를 먼저 청하고, 없으면 아무 카메라나 씁니다.
        // 화면에 뜬 QR 은 칸이 촘촘해서 해상도가 낮으면 안 읽힙니다. 되도록 크게 받습니다.
        var want = { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
        return navigator.mediaDevices.getUserMedia({ video: want, audio: false })
          .catch(function () { return navigator.mediaDevices.getUserMedia({ video: true, audio: false }); });
      })
      .then(function (st) {
        stream = st;
        var v = $("cam");
        v.srcObject = st;
        v.setAttribute("playsinline", "");
        return v.play();
      })
      .then(function () {
        $("camarea").classList.remove("hide");
        $("cam-stop").classList.remove("hide");
        btn.classList.add("hide");
        scanning = true;
        loop();
      })
      .catch(function (e) {
        err.innerHTML = '<div class="bad">카메라를 열지 못했습니다 — ' + esc(e.name || e.message) +
          '<br>아이폰 기본 카메라 앱으로 QR 을 찍거나 [코드 · 파일] 탭을 쓰세요.</div>';
      })
      .then(function () { btn.disabled = false; btn.textContent = "카메라로 찍기"; });
  };

  var cv = document.createElement("canvas"), seenFrag = {};
  function loop() {
    if (!scanning) return;
    var v = $("cam");
    if (v.readyState === v.HAVE_ENOUGH_DATA) {
      // 촘촘한 QR 도 읽히도록 해상도를 크게 유지합니다(최대 1600px 폭).
      var w = Math.min(1600, v.videoWidth || 0), h = v.videoHeight && v.videoWidth ? Math.round(v.videoHeight * (w / v.videoWidth)) : 0;
      if (w && h) {
        cv.width = w; cv.height = h;
        var g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(v, 0, 0, w, h);
        var img = g.getImageData(0, 0, w, h);
        var res = window.jsQR ? window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" }) : null;
        if (res && res.data) {
          var t = res.data, k = t.indexOf("#p=");
          var frag = k >= 0 ? t.slice(k + 3) : null;
          if (frag && !seenFrag[frag]) {
            seenFrag[frag] = 1;
            var r = handleFragment(frag, $("camerr"));
            if (r.state === "done") {
              $("camprog").textContent = "모두 받았습니다.";
              stopCam();
              return;
            }
            $("camprog").textContent = r.n ? (r.n + "장 중 " + r.got + "장 받음 — 계속 비춰 주세요") : "읽는 중…";
            var d = "";
            for (var i = 1; i <= r.n; i++) d += '<span class="dt' + (i <= r.got ? " on" : "") + '"></span>';
            $("camdots").innerHTML = d;
          }
        }
      }
    }
    raf = setTimeout(loop, 90);   // 초당 열 번쯤 살펴봅니다. 배터리를 아끼려는 간격입니다.
  }

  /* ══════════ 코드 · 파일 ══════════ */
  $("code-make").onclick = function () {
    var btn = this; btn.disabled = true;
    S.encode(S.collect({ days: $("opt-days").checked })).then(function (c) {
      $("code").value = c;
      $("codemsg").innerHTML = '<div class="ok">' + c.length + "자 코드가 만들어졌습니다. 전체를 복사해 다른 기기에 붙여넣으세요.</div>";
    }).catch(function (e) {
      $("codemsg").innerHTML = '<div class="bad">' + esc(e.message) + "</div>";
    }).then(function () { btn.disabled = false; });
  };
  $("code-copy").onclick = function () {
    var t = $("code");
    t.select(); t.setSelectionRange(0, 999999);
    var done = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t.value).then(function () {
        $("codemsg").innerHTML = '<div class="ok">복사했습니다.</div>';
      }, function () {});
      done = true;
    }
    if (!done) { try { document.execCommand("copy"); $("codemsg").innerHTML = '<div class="ok">복사했습니다.</div>'; } catch (e) {} }
  };
  $("code-load").onclick = function () {
    var v = $("code").value.trim();
    if (!v) return;
    var k = v.indexOf("#p=");
    if (k >= 0) { handleFragment(v.slice(k + 3), $("codemsg")); return; }
    applyCode(v, $("codemsg")).catch(function () {});
  };

  $("file-save").onclick = function () {
    S.encode(S.collect({ days: $("opt-days").checked })).then(function (c) {
      var body = JSON.stringify({ app: "jeongcheogi", kind: "sync", v: 1, at: new Date().toISOString(), code: c }, null, 1);
      var blob = new Blob([body], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "정처기-학습기록.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      $("filemsg").innerHTML = '<div class="ok">저장했습니다.</div>';
    });
  };
  $("file-open").onchange = function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var txt = String(fr.result).trim(), code = null;
      try { var j = JSON.parse(txt); code = j && j.code ? j.code : null; } catch (e) {}
      if (!code) code = txt;
      applyCode(code, $("filemsg")).catch(function () {});
    };
    fr.readAsText(f);
    this.value = "";
  };

  /* ══════════ 시작 ══════════ */
  renderSummary();
  renderPending();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
