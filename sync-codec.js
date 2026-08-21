/* ═══════════════════════════════════════════════════════════════
   정처기 트레이너 — 기기 간 학습기록 동기화 코덱
   개념 학습(jbg_trainer_v1) + 기출 트레이너(jbg-exam-v1) 를
   하나의 작은 이진 묶음으로 만들고, QR 로 나눠 보낼 수 있게 합니다.

   설계 원칙
   - 같은 QR 을 두 번 읽어도 결과가 달라지지 않습니다(멱등).
   - 받는 기기의 기록은 지우지 않고 합칩니다(병합).
   - 기기마다 다른 설정(음성·오디오 경로 등)은 보내지 않습니다.
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var K_CONCEPT = "jbg_trainer_v1";
  var K_EXAM = "jbg-exam-v1";
  var EPOCH = Date.UTC(2020, 0, 1);            // 날짜를 2바이트로 줄이기 위한 기준일
  var MAGIC0 = 0x4a, MAGIC1 = 0x42;            // 'J','B'
  var VER = 1;
  var LASTC = { o: 1, g: 2, u: 3, w: 4 };      // 기출 마지막 응답 상태 코드
  var LASTS = [null, "o", "g", "u", "w"];

  /* ── 날짜 유틸 ── 앱은 'YYYY-MM-DD' 문자열을 씁니다 ── */
  function dayNum(key) {                        // 'YYYY-MM-DD' → 기준일로부터 일수
    if (!key || typeof key !== "string" || key.length < 10) return null;
    var y = +key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10);
    if (!y || !m || !d) return null;
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
  }
  function dayKey(n) {                           // 일수 → 'YYYY-MM-DD'
    var d = new Date(EPOCH + n * 86400000);
    var p = function (v) { return (v < 10 ? "0" : "") + v; };
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }
  function todayNum() {
    var t = new Date();
    return Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - EPOCH) / 86400000);
  }

  /* ── 바이트 버퍼 ── */
  function Writer() { this.b = []; }
  Writer.prototype.u8 = function (v) { this.b.push(v & 255); return this; };
  Writer.prototype.i8 = function (v) { v = Math.max(-128, Math.min(127, v | 0)); this.b.push(v < 0 ? v + 256 : v); return this; };
  Writer.prototype.u16 = function (v) { this.b.push(v & 255, (v >> 8) & 255); return this; };
  Writer.prototype.varint = function (v) {
    v = v < 0 ? 0 : v >>> 0;
    while (v > 127) { this.b.push((v & 127) | 128); v >>>= 7; }
    this.b.push(v);
    return this;
  };
  Writer.prototype.bytes = function () { return new Uint8Array(this.b); };

  function Reader(u8) { this.a = u8; this.i = 0; }
  Reader.prototype.u8 = function () { return this.a[this.i++]; };
  Reader.prototype.i8 = function () { var v = this.a[this.i++]; return v > 127 ? v - 256 : v; };
  Reader.prototype.u16 = function () { var v = this.a[this.i] | (this.a[this.i + 1] << 8); this.i += 2; return v; };
  Reader.prototype.varint = function () {
    var v = 0, s = 0, c;
    do { c = this.a[this.i++]; v |= (c & 127) << s; s += 7; } while (c & 128);
    return v >>> 0;
  };
  Reader.prototype.left = function () { return this.a.length - this.i; };

  var cap = function (v, m) { v = v | 0; return v < 0 ? 0 : (v > m ? m : v); };

  /* ── 로컬 기록 읽기 ── */
  function readLS(key) {
    try { var s = root.localStorage.getItem(key); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }
  function writeLS(key, obj) {
    try { root.localStorage.setItem(key, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  /* ══════════ 수집 ══════════
     로컬 저장소 → 동기화용 중립 객체 */
  function collect(opt) {
    opt = opt || {};
    var c = readLS(K_CONCEPT) || {}, g = readLS(K_EXAM) || {};
    var out = { base: todayNum(), concept: [], exam: [], days: [] };

    var stats = c.stats || {};
    Object.keys(stats).forEach(function (id) {
      var s = stats[id]; if (!s || !s.seen) return;
      out.concept.push({
        id: +id,
        seen: s.seen | 0, right: s.right | 0, wrong: s.wrong | 0,
        box: s.box | 0, lucky: s.lucky | 0, unsure: s.unsure | 0,
        due: dayNum(s.due), last: dayNum(s.last)
      });
    });
    out.concept.sort(function (a, b) { return a.id - b.id; });

    var hist = g.hist || {};
    Object.keys(hist).forEach(function (u) {
      var h = hist[u]; if (!h || !h.n) return;
      out.exam.push({
        u: +u, n: h.n | 0, w: h.w | 0, lucky: h.lucky | 0,
        unsure: h.unsure | 0, last: h.last || null, d: dayNum(h.d)
      });
    });
    out.exam.sort(function (a, b) { return a.u - b.u; });

    if (opt.days !== false) {
      var days = c.days || {};
      Object.keys(days).forEach(function (k) {
        var d = days[k], n = dayNum(k); if (n === null || !d) return;
        out.days.push({ d: n, solved: d.solved | 0, correct: d.correct | 0, solid: d.solid | 0, min: Math.round((d.sec || 0) / 60) });
      });
      out.days.sort(function (a, b) { return a.d - b.d; });
    }
    return out;
  }

  /* ══════════ 이진 직렬화 ══════════ */
  function serialize(o) {
    var w = new Writer(), prev, i, r;

    w.varint(o.concept.length);
    prev = 0;
    for (i = 0; i < o.concept.length; i++) {
      r = o.concept[i];
      w.varint(r.id - prev); prev = r.id;
      w.u8(cap(r.seen, 255));
      w.u8(cap(r.right, 255));
      w.u8((cap(r.wrong, 15) << 4) | cap(r.box, 15));
      w.u8((cap(r.lucky, 15) << 4) | cap(r.unsure, 15));
      w.i8(r.due === null ? 0 : r.due - o.base);
      w.i8(r.last === null ? -128 : r.last - o.base);
    }

    w.varint(o.exam.length);
    prev = 0;
    for (i = 0; i < o.exam.length; i++) {
      r = o.exam[i];
      w.varint(r.u - prev); prev = r.u;
      w.u8(cap(r.n, 255));
      w.u8((cap(r.w, 15) << 4) | cap(r.lucky, 15));
      w.u8((cap(r.unsure, 15) << 3) | (LASTC[r.last] || 0));
      w.i8(r.d === null || r.d === undefined ? -128 : r.d - o.base);
    }

    // 일별 통계 — 첫 항목은 기준일에서 거슬러 올라간 일수, 이후는 앞 항목과의 간격
    w.varint(o.days.length);
    for (i = 0; i < o.days.length; i++) {
      r = o.days[i];
      w.varint(i === 0 ? Math.max(0, o.base - r.d) : r.d - o.days[i - 1].d);
      w.varint(cap(r.solved, 65535));
      w.varint(cap(r.correct, 65535));
      w.varint(cap(r.solid, 65535));
      w.varint(cap(r.min, 65535));
    }
    return w.bytes();
  }

  function deserialize(u8, base) {
    var rd = new Reader(u8), o = { base: base, concept: [], exam: [], days: [] };
    var n, i, prev, id, b;

    n = rd.varint(); prev = 0;
    for (i = 0; i < n; i++) {
      id = prev + rd.varint(); prev = id;
      var seen = rd.u8(), right = rd.u8(), wb = rd.u8(), lu = rd.u8(), due = rd.i8(), last = rd.i8();
      o.concept.push({
        id: id, seen: seen, right: right, wrong: wb >> 4, box: wb & 15,
        lucky: lu >> 4, unsure: lu & 15,
        due: base + due, last: last === -128 ? null : base + last
      });
    }

    n = rd.varint(); prev = 0;
    for (i = 0; i < n; i++) {
      id = prev + rd.varint(); prev = id;
      var cnt = rd.u8(), wl = rd.u8(), ul = rd.u8(), dd = rd.i8();
      o.exam.push({
        u: id, n: cnt, w: wl >> 4, lucky: wl & 15,
        unsure: ul >> 3, last: LASTS[ul & 7] || null,
        d: dd === -128 ? null : base + dd
      });
    }

    n = rd.varint(); prev = base;
    for (i = 0; i < n; i++) {
      var gap = rd.varint();
      var day = (i === 0) ? base - gap : prev + gap;
      prev = day;
      o.days.push({ d: day, solved: rd.varint(), correct: rd.varint(), solid: rd.varint(), min: rd.varint() });
    }
    return o;
  }

  /* ══════════ 압축 · base64url ══════════ */
  function hasCompression() {
    return typeof root.CompressionStream === "function" && typeof root.DecompressionStream === "function";
  }
  function streamAll(u8, Ctor, fmt) {
    var s = new Ctor(fmt);
    var wr = s.writable.getWriter();
    wr.write(u8); wr.close();
    return new Response(s.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function b64u(u8) {
    var s = "", i, a, b, c;
    for (i = 0; i < u8.length; i += 3) {
      a = u8[i]; b = u8[i + 1]; c = u8[i + 2];
      s += B64[a >> 2];
      s += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
      if (b === undefined) break;
      s += B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
      if (c === undefined) break;
      s += B64[c & 63];
    }
    return s;
  }
  var B64R = (function () { var m = {}; for (var i = 0; i < 64; i++) m[B64[i]] = i; return m; })();
  function unb64u(s) {
    var out = [], i, n = s.length, v, bits = 0, acc = 0;
    for (i = 0; i < n; i++) {
      v = B64R[s[i]];
      if (v === undefined) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return new Uint8Array(out);
  }

  /* payload → 문자열(base64url). 앞 4바이트는 압축하지 않는 머리말입니다. */
  function encode(o) {
    var body = serialize(o);
    var doZip = hasCompression();
    var head = function (flags) {
      var w = new Writer();
      w.u8(MAGIC0).u8(MAGIC1).u8(VER).u8(flags).u16(o.base);
      return w.bytes();
    };
    var join = function (h, b) {
      var out = new Uint8Array(h.length + b.length);
      out.set(h, 0); out.set(b, h.length);
      return out;
    };
    if (!doZip) return Promise.resolve(b64u(join(head(0), body)));
    return streamAll(body, root.CompressionStream, "deflate-raw").then(function (z) {
      // 압축이 되레 커지면 원본을 씁니다.
      return z.length < body.length ? b64u(join(head(1), z)) : b64u(join(head(0), body));
    });
  }

  function decode(str) {
    var raw = unb64u(String(str).trim());
    if (raw.length < 7 || raw[0] !== MAGIC0 || raw[1] !== MAGIC1) return Promise.reject(new Error("형식이 다릅니다"));
    if (raw[2] !== VER) return Promise.reject(new Error("버전이 다릅니다 (v" + raw[2] + ")"));
    var flags = raw[3], base = raw[4] | (raw[5] << 8);
    var body = raw.subarray(6);
    if (!(flags & 1)) return Promise.resolve(deserialize(body, base));
    if (!hasCompression()) return Promise.reject(new Error("이 브라우저는 압축 해제를 지원하지 않습니다"));
    return streamAll(body, root.DecompressionStream, "deflate-raw").then(function (b) { return deserialize(b, base); });
  }

  /* ══════════ 병합 ══════════
     규칙
     - 횟수(푼 수·정답·오답·찍음·모름)는 양쪽의 큰 값을 취합니다.
       같은 QR 을 여러 번 읽어도 값이 부풀지 않습니다.
     - 복습 단계(box)·다음 복습일(due)은 마지막 학습일이 더 최근인 쪽을 따릅니다.
     - 일별 통계는 같은 날짜면 큰 값을 취합니다.
     - 받는 기기에만 있는 기록은 그대로 둡니다. */
  function merge(o) {
    var c = readLS(K_CONCEPT) || { v: 1, stats: {}, days: {}, sessions: [] };
    if (!c.stats) c.stats = {};
    if (!c.days) c.days = {};
    if (!c.sessions) c.sessions = [];
    var g = readLS(K_EXAM) || {};
    if (!g.hist) g.hist = {};
    if (!g.runs) g.runs = [];

    var r = { conceptNew: 0, conceptUpd: 0, examNew: 0, examUpd: 0, days: 0 };
    var mx = function (a, b) { return (a | 0) > (b | 0) ? (a | 0) : (b | 0); };

    o.concept.forEach(function (inc) {
      var cur = c.stats[inc.id];
      if (!cur) {
        c.stats[inc.id] = {
          seen: inc.seen, right: inc.right, wrong: inc.wrong, box: inc.box,
          lucky: inc.lucky, unsure: inc.unsure,
          due: dayKey(inc.due), last: inc.last === null ? null : dayKey(inc.last)
        };
        r.conceptNew++;
        return;
      }
      var curLast = dayNum(cur.last), incLast = inc.last;
      var newer = incLast !== null && (curLast === null || incLast > curLast);
      var before = JSON.stringify(cur);
      cur.seen = mx(cur.seen, inc.seen);
      cur.right = mx(cur.right, inc.right);
      cur.wrong = mx(cur.wrong, inc.wrong);
      cur.lucky = mx(cur.lucky, inc.lucky);
      cur.unsure = mx(cur.unsure, inc.unsure);
      if (newer) {
        cur.box = inc.box;
        cur.due = dayKey(inc.due);
        cur.last = dayKey(incLast);
      }
      if (JSON.stringify(cur) !== before) r.conceptUpd++;
    });

    o.exam.forEach(function (inc) {
      var cur = g.hist[inc.u];
      if (!cur) {
        g.hist[inc.u] = { n: inc.n, w: inc.w, lucky: inc.lucky, unsure: inc.unsure, last: inc.last, d: inc.d === null ? undefined : dayKey(inc.d) };
        r.examNew++;
        return;
      }
      var before = JSON.stringify(cur);
      var curD = dayNum(cur.d), incD = inc.d;
      var newer = incD !== null && (curD === null || incD > curD) ? true
        : (curD !== null && incD !== null && incD < curD) ? false
          : (inc.n | 0) >= (cur.n | 0);      // 날짜가 없으면 더 많이 푼 쪽의 상태를 씁니다
      cur.n = mx(cur.n, inc.n);
      cur.w = mx(cur.w, inc.w);
      cur.lucky = mx(cur.lucky, inc.lucky);
      cur.unsure = mx(cur.unsure, inc.unsure);
      if (newer && inc.last) { cur.last = inc.last; if (incD !== null) cur.d = dayKey(incD); }
      if (JSON.stringify(cur) !== before) r.examUpd++;
    });

    o.days.forEach(function (inc) {
      var k = dayKey(inc.d), cur = c.days[k];
      if (!cur) { c.days[k] = { solved: inc.solved, correct: inc.correct, solid: inc.solid, sec: inc.min * 60 }; r.days++; return; }
      var before = JSON.stringify(cur);
      cur.solved = mx(cur.solved, inc.solved);
      cur.correct = mx(cur.correct, inc.correct);
      cur.solid = mx(cur.solid, inc.solid);
      cur.sec = mx(cur.sec, inc.min * 60);
      if (JSON.stringify(cur) !== before) r.days++;
    });

    writeLS(K_CONCEPT, c);
    writeLS(K_EXAM, g);
    return r;
  }

  root.JBSync = {
    K_CONCEPT: K_CONCEPT, K_EXAM: K_EXAM,
    collect: collect, encode: encode, decode: decode, merge: merge,
    serialize: serialize, deserialize: deserialize,
    dayNum: dayNum, dayKey: dayKey, todayNum: todayNum,
    hasCompression: hasCompression, b64u: b64u, unb64u: unb64u
  };
})(typeof window !== "undefined" ? window : globalThis);
