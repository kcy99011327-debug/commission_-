/* 예전 버전이 등록해 둔 서비스 워커를 정리하는 파일이에요. 지우지 마세요.
   옛 화면이 폰에 저장돼 새 화면으로 안 바뀌는 문제를 막아요. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try { for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url); } catch (_) {}
  })());
});
