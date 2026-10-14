/* 커미션 작업실 — 계정·동기화 화면 (앱 본 스크립트 다음에 불러와요) */
(function () {
  "use strict";
  const Sync = window.CMStore.Sync;
  const LBL = {
    off: ["저장 위치 고르기", "mute"], local: ["이 기기에만 저장", "mute"], connecting: ["연결하는 중", "warn"],
    syncing: ["동기화 중", "warn"], ok: ["동기화됨", "ok"], offline: ["오프라인", "mute"],
    retry: ["다시 연결 중", "warn"], error: ["동기화 오류", "bad"], needlogin: ["다시 로그인", "bad"],
  };
  const css = document.createElement("style");
  css.textContent = `
  .syncBtn{white-space:nowrap;position:relative}
  .syncBtn svg.cl{width:.9375rem;height:.9375rem;fill:none;stroke:currentColor;stroke-width:1.8;flex:none}
  .syncBtn .dot{width:.4375rem;height:.4375rem;border-radius:50%;background:var(--ink-2);flex:none;position:absolute;left:1.125rem;top:.25rem;box-shadow:0 0 0 2px var(--sheet)}
  @media (max-width:599px){.syncBtn .t{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.syncBtn{padding:.25rem .5rem}}
  .syncBtn[data-k="ok"] .dot{background:var(--ok)} .syncBtn[data-k="warn"] .dot{background:var(--warn);animation:cmPulse 1s ease-in-out infinite alternate}
  .syncBtn[data-k="bad"] .dot{background:var(--bad)} .syncBtn[data-k="bad"]{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 45%,var(--rule))}
  @keyframes cmPulse{to{opacity:.3}}
  @media (min-width:900px){.brandmeta{flex-wrap:wrap;row-gap:.375rem}.brandmeta .today{width:100%}}
  @media (prefers-reduced-motion:reduce){.syncBtn .dot{animation:none!important}}
  .syncCard{background:var(--sheet);border:1px solid var(--rule);border-radius:.75rem;padding:.875rem;display:flex;flex-direction:column;gap:.375rem}
  .syncCard b{font-size:1rem} .syncCard small{color:var(--ink-2);font-size:.8125rem}
  .syncActs{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}
  .gbtn{display:inline-flex;align-items:center;gap:.5rem;background:var(--pink);color:var(--on-accent);border:0;border-radius:.625rem;padding:.6875rem 1rem;font-weight:600}
  .gbtn svg{width:1.125rem;height:1.125rem}
  .welcome p{margin:.25rem 0 .75rem;color:var(--ink-2);font-size:.875rem;line-height:1.6}
  .welcome ul{margin:0 0 1rem;padding-left:1.125rem;color:var(--ink-2);font-size:.8125rem;line-height:1.7}
  .welcome .choices{display:flex;flex-direction:column;gap:.5rem}
  .welcome .choices button{width:100%;justify-content:center}`;
  document.head.appendChild(css);

  const G = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="currentColor" opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="currentColor" opacity=".6" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="currentColor" opacity=".9" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9z"/></svg>`;

  /* 헤더 버튼 */
  const meta = document.querySelector(".brandmeta");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "themeBtn syncBtn"; btn.id = "syncBtn";
  btn.innerHTML = `<svg class="cl" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.2 4.4 4.4 0 0 0 7 18z"/></svg><span class="dot"></span><span class="t"></span>`;
  meta.insertBefore(btn, document.getElementById("themeBtn"));
  btn.onclick = () => openSync();

  const ago = (t) => { if (!t) return "아직 없음"; const s = Math.round((Date.now() - t) / 1000); if (s < 60) return "방금"; if (s < 3600) return Math.floor(s / 60) + "분 전"; if (s < 86400) return Math.floor(s / 3600) + "시간 전"; return new Date(t).toLocaleString("ko-KR"); };

  Sync.on((s) => {
    const [t, k] = LBL[s] || LBL.off;
    btn.querySelector(".t").textContent = t; btn.dataset.k = k; btn.setAttribute("aria-label", "동기화: " + t);
    const open = document.getElementById("syncPanel"); if (open) drawSync();
  });

  async function doConnect(fromWelcome) {
    try { await Sync.connect(); toast("구글 드라이브에 연결했어요"); if (fromWelcome) { close(); if (typeof render === "function") render(); } else drawSync(); }
    catch (e) {
      console.warn(e);
      const m = e.code === "no_client" ? "이 앱에 구글 로그인 설정이 아직 안 되어 있어요." : e.code === "gis_load" ? "구글 로그인을 불러오지 못했어요. 인터넷 연결을 확인해 주세요." : "로그인하지 못했어요. 다시 시도해 주세요.";
      toast(m); if (!fromWelcome) drawSync();
    }
  }

  function drawSync() {
    const box = document.getElementById("syncBody"); if (!box) return;
    const s = Sync.status(), drive = Sync.mode() === "drive";
    const [t] = LBL[s] || LBL.off;
    if (drive) {
      box.innerHTML = `<div class="syncCard"><b>${esc(t)}</b><small>${esc(Sync.email() || "구글 계정")}</small><small>마지막 동기화: ${ago(Sync.lastSync())}</small>${Sync.lastError() ? `<small style="color:var(--bad);line-height:1.5">${esc(Sync.lastError())}</small>` : ""}</div>
        <p class="hint" style="margin-top:.625rem">내 구글 드라이브의 <b>커미션 작업실</b> 폴더에 저장돼요. 같은 계정으로 로그인한 폰·컴퓨터끼리 자동으로 맞춰져요.</p>
        <div class="syncActs">
          ${s === "needlogin" ? `<button class="gbtn" type="button" id="syReconnect">${G}다시 로그인</button>` : `<button class="btn pri" type="button" id="syNow">지금 동기화</button>`}
          ${Sync.folderUrl() ? `<a class="btn" href="${Sync.folderUrl()}" target="_blank" rel="noopener">드라이브 폴더 열기</a>` : ""}
        </div>
        <div id="syOut" style="margin-top:1.25rem"><button class="btn danger" type="button" id="syLogout">로그아웃</button>
        <p class="hint" style="margin-top:.375rem">로그아웃하면 이 기기에 저장된 사본만 지워져요. 드라이브에 있는 자료는 그대로예요.</p></div>`;
      const n = document.getElementById("syNow"); if (n) n.onclick = () => Sync.run();
      const r = document.getElementById("syReconnect"); if (r) r.onclick = () => doConnect(false);
      document.getElementById("syLogout").onclick = () => {
        document.getElementById("syOut").innerHTML = `<div class="notice">이 기기에서 로그아웃할까요? 아직 드라이브에 못 올라간 변경이 있으면 사라질 수 있어요. <button class="btn danger" type="button" id="syYes">로그아웃</button></div>`;
        document.getElementById("syYes").onclick = () => Sync.logout();
      };
    } else {
      box.innerHTML = `<div class="syncCard"><b>${esc(t)}</b><small>지금은 이 기기(브라우저)에만 저장돼요. 브라우저 기록을 지우면 함께 사라질 수 있어요.</small></div>
        ${Sync.hasClient()
          ? `<p class="hint" style="margin-top:.625rem">구글 드라이브에 연결하면 내 드라이브에 자동 저장되고, 폰과 컴퓨터에서 같은 내용을 볼 수 있어요. 지금 이 기기에 있는 내용도 함께 올라가요.</p>
             <div class="syncActs"><button class="gbtn" type="button" id="syGo">${G}구글 드라이브 연결</button></div>`
          : `<p class="hint" style="margin-top:.625rem">이 앱에는 아직 구글 로그인 설정(클라이언트 ID)이 없어요. 앱을 배포한 사람에게 문의해 주세요.</p>`}`;
      const g = document.getElementById("syGo"); if (g) g.onclick = () => doConnect(false);
    }
  }
  function openSync() {
    shell(`<div id="syncPanel"><div class="bar"><h3>저장·동기화</h3><button class="btn" type="button" id="x">닫기</button></div><div id="syncBody"></div></div>`);
    document.getElementById("x").onclick = () => { close(); if (typeof render === "function") render(); }; drawSync();
  }
  window.openSync = openSync;

  function welcome() {
    shell(`<div class="welcome"><div class="bar"><h3>커미션 작업실에 오신 걸 환영해요</h3></div>
      <p>커미션 일정, 작업물, 답장 템플릿을 한곳에서 관리해요. 예시 커미션 두 개를 넣어 두었으니 둘러보고 지우면 돼요.</p>
      <ul><li>자료는 <b>내 구글 드라이브</b>에 저장돼요. 다른 사람은 볼 수 없어요.</li><li>같은 구글 계정으로 폰과 컴퓨터에서 함께 쓸 수 있어요.</li><li>폰에서는 브라우저 메뉴의 <b>홈 화면에 추가</b>로 앱처럼 쓸 수 있어요.</li></ul>
      <div class="choices"><button class="gbtn" type="button" id="wGo">${G}구글 드라이브로 시작하기</button>
      <button class="btn" type="button" id="wLocal" style="padding:.6875rem">로그인 없이 이 기기에서만 쓰기</button></div>
      <p class="hint" style="margin-top:.75rem">나중에 오른쪽 위 구름 버튼에서 언제든 드라이브에 연결할 수 있어요.</p></div>`);
    document.getElementById("wGo").onclick = () => doConnect(true);
    document.getElementById("wLocal").onclick = () => { Sync.useLocal(); close(); };
  }

  window.CMStore.ready.then(() => {
    if (!Sync.mode()) { if (Sync.hasClient()) welcome(); else Sync.useLocal(); }
  });
})();
