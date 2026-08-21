/* 오프라인 캐시 서비스 워커
   문제은행을 수정한 뒤에는 아래 CACHE 버전을 반드시 올리세요. */
const CACHE = "jbg-v20";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./data/bank.js", "./data/subject1.js", "./data/subject2.js",
  "./data/subject3.js", "./data/subject4.js", "./data/subject5.js",
  "./icon-192.png", "./icon-512.png",
  /* 기출 트레이너 */
  "./gichul.html", "./gichul.js",
  "./data/exam_bank.js", "./data/exam_expl.js",
  "./data/exam2022_1.js", "./data/exam2022_2.js", "./data/exam2022_3.js",
  "./data/exam2023_1.js", "./data/exam2023_2.js", "./data/exam2023_3.js",
  "./data/exam2024_1.js", "./data/exam2024_2.js", "./data/exam2024_3.js",
  "./data/exam2025_1.js", "./data/exam2025_2.js", "./data/exam2025_3.js",
  "./data/exam2026_1.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 네트워크 우선 → 실패 시 캐시. 오프라인에서도 항상 동작합니다. */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // 음성 파일은 캐시하지 않습니다. 과목 전체가 200MB가 넘어 기기 저장공간을 잡아먹습니다.
  if (/\.(mp3|m4a|aac|ogg)$/i.test(new URL(e.request.url).pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
