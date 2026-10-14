/* 앱 화면 파일을 기기에 담아 두어, 인터넷이 약해도 바로 열리게 해요.
   앱을 고쳐서 다시 올릴 때는 VERSION 숫자를 하나 올려 주세요. */
const VERSION = "cm-v2";
const SHELL = ["./", "index.html", "store.js", "sync-ui.js", "config.js", "manifest.webmanifest",
  "fonts/PretendardVariable.woff2", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  /* 구글 API·로그인은 항상 네트워크로 */
  if (/^(www|oauth2)\.googleapis\.com$|accounts\.google\.com/.test(u.host)) return;
  if (u.origin === location.origin) {
    /* 화면 파일: 항상 서버에 최신인지 확인하고(브라우저에 남은 옛 사본 무시), 인터넷이 안 되면 저장해 둔 것 */
    const fresh = /\.(woff2|png)$/.test(u.pathname) ? e.request : new Request(e.request, { cache: "no-cache" });
    e.respondWith(fetch(fresh).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
  } else if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); return r; })));
  }
});
