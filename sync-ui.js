/* 커미션 작업실 — 서버 연결·로그인·동기화 화면 (앱 본 스크립트 다음에 불러와요) */
(function () {
  "use strict";
  const Sync = window.CMStore.Sync;
  const LBL = {
    off: ["저장 위치 고르기", "mute"], local: ["이 기기에만 저장", "mute"], connecting: ["연결하는 중", "warn"],
    syncing: ["동기화 중", "warn"], ok: ["동기화됨", "ok"], offline: ["오프라인", "mute"],
    retry: ["다시 연결 중", "warn"], error: ["동기화 오류", "bad"], needlogin: ["다시 로그인", "bad"],
  };
  const FREE_BYTES = 1024 * 1024 * 1024;
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
  .syncCard b{font-size:1rem} .syncCard small{color:var(--ink-2);font-size:.8125rem;overflow-wrap:anywhere}
  .syncActs{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}
  .gbtn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;background:var(--pink);color:var(--on-accent);border:0;border-radius:.625rem;padding:.6875rem 1rem;font-weight:600}
  .gbtn:disabled{opacity:.6}
  .welcome p{margin:.25rem 0 .75rem;color:var(--ink-2);font-size:.875rem;line-height:1.6}
  .welcome ul{margin:0 0 1rem;padding-left:1.125rem;color:var(--ink-2);font-size:.8125rem;line-height:1.7}
  .welcome .choices{display:flex;flex-direction:column;gap:.5rem}
  .welcome .choices button,.welcome .choices a{width:100%;justify-content:center;text-align:center;padding:.6875rem;text-decoration:none}
  .cmf{display:flex;flex-direction:column;gap:.625rem;margin:.25rem 0 .75rem}
  .cmf label{display:flex;flex-direction:column;gap:.25rem;font-size:.75rem;color:var(--ink-2)}
  .cmf input{padding:.625rem .75rem;border:1px solid var(--rule);border-radius:.5625rem;background:var(--sheet);font-size:.9375rem;width:100%;min-width:0}
  .cmmsg{min-height:1.2em;font-size:.8125rem;line-height:1.5;color:var(--bad);margin:.25rem 0 .5rem}
  .cmmsg.ok{color:var(--ok)}
  .stepdots{display:flex;gap:.375rem;margin:-.25rem 0 .75rem;font-size:.75rem;color:var(--ink-2)}
  .stepdots span{padding:.125rem .5rem;border-radius:62rem;background:var(--mute-soft)} .stepdots span.on{background:var(--pink);color:var(--on-accent)}
  .meter{height:.5rem;border-radius:62rem;background:var(--mute-soft);overflow:hidden;margin-top:.25rem}
  .meter i{display:block;height:100%;background:var(--pink)}
  #syncPanel a.btn,.welcome .choices a{color:inherit;text-decoration:none;display:inline-flex;align-items:center}`;
  document.head.appendChild(css);

  /* 헤더 버튼 */
  const meta = document.querySelector(".brandmeta");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "themeBtn syncBtn"; btn.id = "syncBtn";
  btn.innerHTML = `<svg class="cl" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.2 4.4 4.4 0 0 0 7 18z"/></svg><span class="dot"></span><span class="t"></span>`;
  meta.insertBefore(btn, document.getElementById("themeBtn"));
  btn.onclick = () => openSync();

  const ago = (t) => { if (!t) return "아직 없음"; const s = Math.round((Date.now() - t) / 1000); if (s < 60) return "방금"; if (s < 3600) return Math.floor(s / 60) + "분 전"; if (s < 86400) return Math.floor(s / 3600) + "시간 전"; return new Date(t).toLocaleString("ko-KR"); };
  const mb = (b) => (b < 1048576 ? (b / 1024).toFixed(0) + "KB" : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + "MB");
  const host = (u) => { try { return new URL(u).host; } catch (e) { return u; } };
  const rerender = () => { if (typeof render === "function") render(); };

  Sync.on((s) => {
    const [t, k] = LBL[s] || LBL.off;
    btn.querySelector(".t").textContent = t; btn.dataset.k = k; btn.setAttribute("aria-label", "동기화: " + t);
    if (document.getElementById("syncPanel")) drawSync();
  });

  /* ---------- 서버 연결 → 로그인 (환영 화면과 저장·동기화 창이 함께 씀) ---------- */
  function serverForm(box, done) {
    box.innerHTML = `<div class="stepdots"><span class="on">1 서버 연결</span><span>2 로그인</span></div>
      <p class="hint" style="margin:0 0 .5rem">내 Supabase 프로젝트의 <b>Project URL</b>과 <b>Publishable key</b>(또는 예전 이름 anon public 키)를 붙여 넣어 주세요. 만드는 방법은 <a href="guide.html" target="_blank" rel="noopener">서버 만들기 안내</a>에 있어요.</p>
      <form class="cmf" id="srvF" autocomplete="off">
        <label>Project URL<input id="srvU" inputmode="url" placeholder="https://abcdefg.supabase.co" value="${esc(Sync.server().url)}"></label>
        <label>Publishable key<input id="srvK" placeholder="sb_publishable_… 로 시작하는 글자" value=""></label>
        <div class="cmmsg" id="srvM"></div>
        <button class="gbtn" type="submit" id="srvGo">연결하기</button>
      </form>`;
    document.getElementById("srvF").onsubmit = async (e) => {
      e.preventDefault();
      const m = document.getElementById("srvM"), go = document.getElementById("srvGo");
      m.className = "cmmsg"; m.textContent = ""; go.disabled = true; go.textContent = "확인하는 중…";
      try { await Sync.setServer(document.getElementById("srvU").value, document.getElementById("srvK").value); loginForm(box, done); }
      catch (er) { m.textContent = er.friendly || er.message || "연결하지 못했어요."; go.disabled = false; go.textContent = "연결하기"; }
    };
  }
  function loginForm(box, done) {
    box.innerHTML = `<div class="stepdots"><span>1 서버 연결 ✓</span><span class="on">2 로그인</span></div>
      <p class="hint" style="margin:0 0 .5rem">${esc(host(Sync.server().url))} 에 연결됐어요. 처음이면 <b>가입하기</b>, 이미 가입했으면 <b>로그인</b>을 눌러 주세요.</p>
      <form class="cmf" id="logF">
        <label>이메일<input id="logE" type="email" autocomplete="username" value="${esc(Sync.email())}"></label>
        <label>비밀번호 (6자 이상)<input id="logP" type="password" autocomplete="current-password"></label>
        <div class="cmmsg" id="logM"></div>
        <button class="gbtn" type="submit" id="logIn">로그인</button>
        <button class="btn" type="button" id="logUp" style="padding:.6875rem">처음이면 가입하기</button>
      </form>
      ${Sync.presetServer() ? "" : `<button class="btn" type="button" id="logBack" style="margin-top:.25rem">서버 주소 다시 넣기</button>`}`;
    const go = async (fn, b) => {
      const m = document.getElementById("logM"); m.className = "cmmsg"; m.textContent = "";
      const e = document.getElementById("logE").value, p = document.getElementById("logP").value;
      if (!e || !p) { m.textContent = "이메일과 비밀번호를 넣어 주세요."; return; }
      const label = b.textContent; b.disabled = true; b.textContent = "잠시만요…";
      try { await fn(e, p); toast("로그인했어요"); done(); }
      catch (er) { m.textContent = er.friendly || er.message || "로그인하지 못했어요."; b.disabled = false; b.textContent = label; }
    };
    document.getElementById("logF").onsubmit = (ev) => { ev.preventDefault(); go(Sync.signIn, document.getElementById("logIn")); };
    document.getElementById("logUp").onclick = () => go(Sync.signUp, document.getElementById("logUp"));
    const back = document.getElementById("logBack"); if (back) back.onclick = () => serverForm(box, done);
  }
  function startConnect(box, done) { if (Sync.hasServer()) loginForm(box, done); else serverForm(box, done); }

  /* ---------- 저장·동기화 창 ---------- */
  function drawSync() {
    const box = document.getElementById("syncBody"); if (!box || box.dataset.form === "1") return;
    const s = Sync.status(), on = Sync.mode() === "server";
    const [t] = LBL[s] || LBL.off;
    if (on && s !== "needlogin") {
      const u = Sync.usage(), pct = Math.min(100, (u.bytes / FREE_BYTES) * 100);
      box.innerHTML = `<div class="syncCard"><b>${esc(t)}</b><small>${esc(Sync.email() || "로그인됨")} · ${esc(host(Sync.server().url))}</small>
          <small>마지막 동기화: ${ago(Sync.lastSync())}${Sync.pending() ? ` · 올라갈 변경 ${Sync.pending()}개` : ""}</small>
          ${Sync.lastError() ? `<small style="color:var(--bad);line-height:1.5">${esc(Sync.lastError())}</small>` : ""}</div>
        <div class="syncCard" style="margin-top:.625rem"><small>이미지 ${u.n}장 · ${mb(u.bytes)} 사용 (무료 1GB 기준 ${pct < 1 ? pct.toFixed(1) : pct.toFixed(0)}%)</small><div class="meter"><i style="width:${Math.max(pct, .5)}%"></i></div>
          <small>이미지는 올릴 때 자동으로 줄어들어요 (보기용 1600px + 썸네일 600px). 원본은 내 기기에 그대로 있어요.</small></div>
        <div class="syncActs"><button class="btn pri" type="button" id="syNow">지금 동기화</button>
          <a class="btn" href="https://supabase.com/dashboard/projects" target="_blank" rel="noopener">Supabase 열기</a></div>
        <div id="syOut" style="margin-top:1.25rem;display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn danger" type="button" id="syLogout">로그아웃</button>${Sync.presetServer() ? "" : `<button class="btn" type="button" id="sySrv">서버 바꾸기</button>`}</div>
        <p class="hint" style="margin-top:.375rem">로그아웃하면 이 기기에 저장된 사본만 지워져요. 서버에 있는 자료는 그대로예요.</p>`;
      document.getElementById("syNow").onclick = () => Sync.run();
      const ask = (msg, fn) => { document.getElementById("syOut").innerHTML = `<div class="notice">${msg} <button class="btn danger" type="button" id="syYes">확인</button></div>`; document.getElementById("syYes").onclick = fn; };
      const warn = Sync.pending() ? ` 아직 서버에 못 올라간 변경 ${Sync.pending()}개가 사라져요.` : "";
      document.getElementById("syLogout").onclick = () => ask("이 기기에서 로그아웃할까요?" + warn, () => Sync.logout(false));
      const sv = document.getElementById("sySrv"); if (sv) sv.onclick = () => ask("다른 서버로 바꿀까요? 로그아웃하고 이 기기의 사본을 지워요." + warn, () => Sync.logout(true));
    } else if (on) {
      box.innerHTML = `<div class="syncCard"><b>${esc(t)}</b><small>로그인이 풀렸어요. 다시 로그인하면 이어서 동기화돼요. 그동안 고친 내용은 이 기기에 남아 있어요.</small></div><div id="syForm" style="margin-top:.75rem"></div>`;
      const f = document.getElementById("syForm"); box.dataset.form = "1";
      loginForm(f, () => { box.dataset.form = ""; drawSync(); rerender(); });
    } else {
      box.innerHTML = `<div class="syncCard"><b>${esc(t)}</b><small>지금은 이 기기(브라우저)에만 저장돼요. 브라우저 기록을 지우면 함께 사라질 수 있어요.</small></div>
        <p class="hint" style="margin-top:.625rem">내 Supabase 서버에 연결하면 자동으로 저장되고, 폰과 컴퓨터에서 같은 내용을 볼 수 있어요. 지금 이 기기에 있는 내용도 함께 올라가요.</p>
        <div class="syncActs"><button class="gbtn" type="button" id="syGo">서버 연결하기</button><a class="btn" href="guide.html" target="_blank" rel="noopener">서버 만들기 안내</a></div>`;
      document.getElementById("syGo").onclick = () => {
        box.dataset.form = "1"; box.innerHTML = `<div id="syForm"></div>`;
        startConnect(document.getElementById("syForm"), () => { box.dataset.form = ""; drawSync(); rerender(); });
      };
    }
  }
  function openSync() {
    shell(`<div id="syncPanel"><div class="bar"><h3>저장·동기화</h3><button class="btn" type="button" id="x">닫기</button></div><div id="syncBody"></div></div>`);
    document.getElementById("x").onclick = () => { close(); rerender(); }; drawSync();
  }
  window.openSync = openSync;

  /* ---------- 처음 열었을 때 ---------- */
  function welcome() {
    shell(`<div class="welcome" id="welcome"><div class="bar"><h3>커미션 작업실에 오신 걸 환영해요</h3></div>
      <p>커미션 일정, 작업물, 답장 템플릿을 한곳에서 관리해요. 예시 커미션 두 개를 넣어 두었으니 둘러보고 지우면 돼요.</p>
      <ul><li>자료는 <b>내 Supabase 서버</b>에 저장돼요. 다른 사람은 볼 수 없어요.</li><li>같은 계정으로 폰과 컴퓨터에서 함께 쓸 수 있어요.</li><li>작업물 이미지는 자동으로 줄여서 올라가요.</li><li>폰에서는 <b>홈 화면에 추가</b>로 앱처럼 쓸 수 있어요.</li></ul>
      <div class="choices"><button class="gbtn" type="button" id="wGo">내 서버 연결하기</button>
      <a class="btn" href="guide.html" target="_blank" rel="noopener">아직 서버가 없어요 (만드는 방법)</a>
      <button class="btn" type="button" id="wLocal">로그인 없이 이 기기에서만 쓰기</button></div>
      <p class="hint" style="margin-top:.75rem">나중에 오른쪽 위 구름 버튼에서 언제든 서버에 연결할 수 있어요.</p></div>`);
    document.getElementById("wGo").onclick = () => {
      const w = document.getElementById("welcome");
      w.innerHTML = `<div class="bar"><h3>내 서버 연결</h3><button class="btn" type="button" id="wX">나중에</button></div><div id="wForm"></div>`;
      document.getElementById("wX").onclick = () => { Sync.useLocal(); close(); rerender(); };
      startConnect(document.getElementById("wForm"), () => { close(); rerender(); });
    };
    document.getElementById("wLocal").onclick = () => { Sync.useLocal(); close(); rerender(); };
  }

  window.CMStore.ready.then(() => { if (!Sync.mode()) welcome(); });
})();
