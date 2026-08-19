/* 오프라인 캐시 서비스 워커
   문제은행을 수정한 뒤에는 아래 CACHE 버전을 반드시 올리세요. */
const CACHE = "jbg-v10";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./data/bank.js", "./data/subject1.js", "./data/subject2.js",
  "./data/subject3.js", "./data/subject4.js", "./data/subject5.js",
  "./icon-192.png", "./icon-512.png"
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
  e.respondWith(
    fetch(e.request)
      .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
