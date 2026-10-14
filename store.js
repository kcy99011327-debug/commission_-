/* =====================================================================
   커미션 작업실 — 저장소
   - 이 기기(IndexedDB)에 먼저 저장하고, 구글 드라이브와 동기화해요.
   - 앱 코드가 쓰던 claude.use("db" | "assets" | "downloads") 모양을 그대로 흉내 내요.
   - 드라이브에는 "커미션 작업실" 폴더 안에 data.json 과 이미지 파일이 생겨요.
   ===================================================================== */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const CLIENT_ID = (CFG.googleClientId || "").trim();
  const SCOPES = "https://www.googleapis.com/auth/drive.file openid email";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const ROOT_NAME = "커미션 작업실";
  const COLS = ["commissions", "templates", "settings"];

  /* ---------------- small helpers ---------------- */
  const now = () => Date.now();
  const rid = (p) => p + now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const ls = {
    get(k) { try { return localStorage.getItem("cm." + k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem("cm." + k) : localStorage.setItem("cm." + k, v); } catch (e) {} },
  };
  function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

  /* ---------------- IndexedDB ---------------- */
  let idbP = null;
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise((res) => {
      try {
        const r = indexedDB.open("commission-app", 1);
        r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("blobs"); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return idbP;
  }
  async function idbDo(store, mode, fn) {
    const d = await idb(); if (!d) return null;
    return new Promise((res) => {
      try {
        const tx = d.transaction(store, mode); const st = tx.objectStore(store); const r = fn(st);
        tx.oncomplete = () => res(r && "result" in r ? r.result : null);
        tx.onerror = tx.onabort = () => res(null);
      } catch (e) { res(null); }
    });
  }
  const kvGet = (k) => idbDo("kv", "readonly", (s) => s.get(k));
  const kvSet = (k, v) => idbDo("kv", "readwrite", (s) => s.put(v, k));
  const blobGet = (k) => idbDo("blobs", "readonly", (s) => s.get(k));
  const blobSet = (k, v) => idbDo("blobs", "readwrite", (s) => s.put(v, k));
  const blobDel = (k) => idbDo("blobs", "readwrite", (s) => s.delete(k));
  const clearAll = async () => { await idbDo("kv", "readwrite", (s) => s.clear()); await idbDo("blobs", "readwrite", (s) => s.clear()); };

  /* ---------------- state ----------------
     docs[col][id] = { d: data, u: updatedAt, x: deleted? }
     assets[id]    = { f: driveFileId, n: name, t: type, u, x }               */
  let ST = emptyState();
  let pendingUploads = []; // asset ids waiting to go to Drive
  let pendingDeletes = []; // drive file ids waiting to be deleted
  function emptyState() { return { v: 1, docs: { commissions: {}, templates: {}, settings: {} }, assets: {}, pristine: false }; }

  async function loadLocal() {
    const s = await kvGet("state");
    if (s && s.docs) { ST = s; COLS.forEach((c) => (ST.docs[c] = ST.docs[c] || {})); ST.assets = ST.assets || {}; }
    pendingUploads = (await kvGet("pendingUploads")) || [];
    pendingDeletes = (await kvGet("pendingDeletes")) || [];
    return !!(s && s.docs);
  }
  let saveT = null;
  function saveLocal() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { kvSet("state", ST); kvSet("pendingUploads", pendingUploads); kvSet("pendingDeletes", pendingDeletes); }, 120);
  }

  /* ---------------- 예시 데이터 (처음 한 번만) ---------------- */
  function seed() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const day = (n) => { const d = new Date(t); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const u = now();
    const C = ST.docs.commissions, T = ST.docs.templates;
    C["demo-1"] = { u, d: { client: "예시 손님", seq: 1, nick: "예시 손님님", status: "러프", type: "포스터 타입", subtype: "②캐릭터 중심",
      source: "크레페", people: 1, due: day(5), doneDate: "", quoteBefore: 50000, price: 50000, quoteAfter: null,
      notes: "예시로 넣어 둔 커미션이에요. 눌러서 수정하거나 지워도 돼요.", images: [], order: u } };
    C["demo-2"] = { u, d: { client: "샘플 손님", seq: 1, nick: "샘플 손님님", status: "완성본 전송", type: "LD 전신", subtype: "①심플",
      source: "카톡", people: 2, due: day(-3), doneDate: day(-2), quoteBefore: 80000, price: 80000, quoteAfter: 90000,
      notes: "완료된 예시예요. 이번 달 수익에 잡혀요.", images: [], order: u + 1 } };
    T["demo-t1"] = { u, d: { title: "신청 확인", order: 1,
      body: "{닉네임}, 커미션 신청 확인했어요!\n입금 확인 후 작업 순서에 넣어 드릴게요.\n마감 예정일은 {마감일}이에요." } };
    T["demo-t2"] = { u, d: { title: "완성본 전송", order: 2,
      body: "{닉네임}, 완성본 보내 드려요.\n수정할 부분이 있으면 편하게 말씀해 주세요. 감사합니다!" } };
    ST.pristine = true;
  }

  /* ---------------- listeners ---------------- */
  const colListeners = { commissions: new Set(), templates: new Set(), settings: new Set() };
  const docListeners = new Map(); // "col/id" -> Set
  let emitQ = null;
  function emitSoon() { if (emitQ) return; emitQ = Promise.resolve().then(() => { emitQ = null; emitAll(); }); }
  function colSnap(col, orderField) {
    let docs = Object.entries(ST.docs[col]).filter(([, r]) => !r.x).map(([id, r]) => ({ id, _d: r.d }));
    if (orderField) docs.sort((a, b) => ((a._d[orderField] ?? 0) > (b._d[orderField] ?? 0) ? 1 : -1));
    return { size: docs.length, empty: !docs.length, docs: docs.map((x) => ({ id: x.id, exists: true, data: () => clone(x._d) })) };
  }
  function docSnap(col, id) {
    const r = ST.docs[col][id]; const ok = !!(r && !r.x);
    return { id, exists: ok, data: () => (ok ? clone(r.d) : undefined) };
  }
  function emitAll() {
    COLS.forEach((col) => colListeners[col].forEach((l) => { try { l.cb(colSnap(col, l.order)); } catch (e) { console.error(e); } }));
    docListeners.forEach((set, key) => { const [col, id] = key.split("/"); set.forEach((cb) => { try { cb(docSnap(col, id)); } catch (e) { console.error(e); } }); });
  }
  function touch() { ST.pristine = false; saveLocal(); emitSoon(); Sync.schedule(); }

  /* ---------------- db shim ---------------- */
  function docRef(col, id) {
    if (!ST.docs[col]) ST.docs[col] = {};
    return {
      id,
      async get() { return docSnap(col, id); },
      async set(data, opt) {
        const r = ST.docs[col][id];
        const base = opt && opt.merge && r && !r.x ? r.d : {};
        ST.docs[col][id] = { d: { ...clone(base), ...clone(data) }, u: now() }; touch();
      },
      async update(patch) {
        const r = ST.docs[col][id];
        if (!r || r.x) throw err("not_found", "문서가 없어요");
        ST.docs[col][id] = { d: { ...r.d, ...clone(patch) }, u: now() }; touch();
      },
      async delete() { ST.docs[col][id] = { x: true, u: now() }; touch(); },
      onSnapshot(cb) {
        const key = col + "/" + id; if (!docListeners.has(key)) docListeners.set(key, new Set());
        docListeners.get(key).add(cb); Promise.resolve().then(() => cb(docSnap(col, id)));
        return () => docListeners.get(key).delete(cb);
      },
    };
  }
  function colRef(col, order) {
    return {
      doc: (id) => docRef(col, id || rid("d")),
      async add(data) { const r = docRef(col, rid("d")); await r.set(data); return r; },
      orderBy: (f) => colRef(col, f),
      async get() { return colSnap(col, order); },
      onSnapshot(cb) { const l = { cb, order }; colListeners[col].add(l); Promise.resolve().then(() => cb(colSnap(col, order))); return () => colListeners[col].delete(l); },
    };
  }
  const db = {
    collection: (name) => colRef(name),
    doc: (path) => { const [c, i] = path.split("/"); return docRef(c, i); },
  };

  /* ---------------- images ---------------- */
  const blobURLs = new Map();
  const inflight = new Map();
  async function getBlob(id) {
    let b = await blobGet(id);
    if (b) return b;
    const a = ST.assets[id];
    if (!a || a.x || !a.f || !Sync.token()) return null;
    try {
      const r = await Sync.gfetch(`${API}/files/${a.f}?alt=media`);
      if (!r.ok) return null;
      b = await r.blob(); await blobSet(id, b); return b;
    } catch (e) { return null; }
  }
  function blobURL(id) {
    if (blobURLs.has(id)) return Promise.resolve(blobURLs.get(id));
    if (inflight.has(id)) return inflight.get(id);
    const p = getBlob(id).then((b) => { inflight.delete(id); if (!b) return null; const u = URL.createObjectURL(b); blobURLs.set(id, u); return u; });
    inflight.set(id, p); return p;
  }
  /* <img src="cmimg:ID"> 은 바로 실패하고, 그때 진짜 이미지를 채워 넣어요 */
  window.cmImgSrc = (id) => blobURLs.get(id) || "cmimg:" + id;
  document.addEventListener("error", (e) => {
    const im = e.target; if (!(im instanceof HTMLImageElement)) return;
    const s = im.getAttribute("src") || ""; if (!s.startsWith("cmimg:")) return;
    const id = s.slice(6); if (im.dataset.cmTry === id) return; im.dataset.cmTry = id;
    blobURL(id).then((u) => { if (u && im.getAttribute("src") === s) im.src = u; });
  }, true);
  /* 다른 기기에서 이미지 목록이 새로 들어오면, 아직 못 불러온 이미지를 다시 시도 */
  function retryBrokenImages() {
    document.querySelectorAll('img[src^="cmimg:"]').forEach((im) => { delete im.dataset.cmTry; const s = im.getAttribute("src"); im.src = ""; im.src = s; });
  }

  const assets = {
    async upload(file, opt) {
      const id = rid("a");
      const type = (opt && opt.type) || file.type || "application/octet-stream";
      const blob = file instanceof Blob ? file : new Blob([file], { type });
      await blobSet(id, blob);
      ST.assets[id] = { n: file.name || id, t: type, u: now() };
      pendingUploads.push(id); touch();
      return { id, url: window.cmImgSrc(id) };
    },
    async delete(id) {
      const a = ST.assets[id];
      if (a && a.f) pendingDeletes.push(a.f);
      ST.assets[id] = { x: true, u: now() };
      pendingUploads = pendingUploads.filter((x) => x !== id);
      await blobDel(id); const u = blobURLs.get(id); if (u) { URL.revokeObjectURL(u); blobURLs.delete(id); }
      touch();
    },
    url: (id) => window.cmImgSrc(id),
  };

  /* ---------------- downloads ---------------- */
  const downloads = {
    async save({ filename, data, type }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain;charset=utf-8" });
      const a = document.createElement("a"); const u = URL.createObjectURL(blob);
      a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
    },
  };

  /* =====================================================================
     구글 드라이브 동기화
     ===================================================================== */
  const Sync = (() => {
    let tok = null, tokExp = 0, tokenClient = null, gisReady = null;
    let rootId = ls.get("rootId"), imgFolderId = ls.get("imgId"), dataId = ls.get("dataId"), remoteVer = ls.get("dataVer");
    let status = "local"; // local | off | connecting | syncing | ok | offline | error | needlogin
    let lastSync = Number(ls.get("lastSync")) || 0;
    let timer = null, running = false, again = false;
    const subs = new Set();
    const mode = () => ls.get("mode") || ""; // "" (아직 안 고름) | "drive" | "local"
    let lastErr = "", scopeOk = true;
    function explain(e) {
      if (!e) return "";
      if (e.code === "scope") return "로그인할 때 드라이브 권한이 체크되지 않았어요. 로그아웃한 뒤 다시 연결하면서 드라이브 항목을 꼭 체크해 주세요.";
      let reason = "";
      try { const j = JSON.parse(e.message); const er = j.error || {}; reason = ((er.errors && er.errors[0] && er.errors[0].reason) || "") + " " + (er.status || "") + " " + JSON.stringify(er.details || ""); } catch (x) {}
      if (/accessNotConfigured|SERVICE_DISABLED/.test(reason)) return "구글 클라우드에서 Google Drive API가 꺼져 있어요. 'API 및 서비스 → 라이브러리'에서 사용으로 바꾸고 1~2분 뒤 다시 시도해 주세요.";
      if (/insufficientPermissions|SCOPE_INSUFFICIENT|PERMISSION_DENIED/.test(reason)) return "드라이브 권한이 없어요. 로그아웃한 뒤 다시 연결하면서 드라이브 항목을 체크해 주세요.";
      if (/storageQuotaExceeded/.test(reason)) return "구글 드라이브 용량이 가득 찼어요.";
      if (/rateLimit|userRateLimit/.test(reason)) return "요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.";
      if (!e.code) return "인터넷 연결이 불안정해서 동기화가 끊겼어요. 잠시 뒤 지금 동기화를 눌러 주세요." + (e.message ? " (" + String(e.message).slice(0, 80) + ")" : "");
      return "오류 코드: " + e.code + (reason.trim() ? " (" + reason.trim().slice(0, 120) + ")" : "");
    }
    function set(s, msg) { status = s; lastErr = s === "error" ? (msg || "") : ""; subs.forEach((f) => { try { f(status, msg); } catch (e) {} }); }

    function loadGIS() {
      if (gisReady) return gisReady;
      gisReady = new Promise((res, rej) => {
        if (window.google && google.accounts && google.accounts.oauth2) return res();
        const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
        s.onload = () => res(); s.onerror = () => { gisReady = null; rej(err("gis_load")); };
        document.head.appendChild(s);
      });
      return gisReady;
    }
    /* interactive=true 는 버튼을 눌렀을 때만 (팝업 차단 방지) */
    async function getToken(interactive) {
      if (tok && now() < tokExp - 60000) return tok;
      if (!CLIENT_ID) throw err("no_client");
      await loadGIS();
      return new Promise((res, rej) => {
        let done = false;
        const fin = (fn, v) => { if (!done) { done = true; fn(v); } };
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: SCOPES,
          callback: (r) => {
            if (r && r.access_token) { try { scopeOk = !google.accounts.oauth2.hasGrantedAllScopes || google.accounts.oauth2.hasGrantedAllScopes(r, "https://www.googleapis.com/auth/drive.file"); } catch (x) {} tok = r.access_token; tokExp = now() + (Number(r.expires_in) || 3600) * 1000; fin(res, tok); }
            else fin(rej, err("auth", r && r.error));
          },
          error_callback: (e) => fin(rej, err("auth", e && e.type)),
        });
        const hint = ls.get("email") || undefined;
        tokenClient.requestAccessToken({ prompt: interactive ? (hint ? "" : "consent") : "none", login_hint: hint });
        if (!interactive) setTimeout(() => fin(rej, err("auth_timeout")), 15000);
      });
    }
    async function gfetch(url, opt = {}, retried) {
      if (!tok || now() > tokExp - 60000) { try { await getToken(false); } catch (e) { set("needlogin"); throw e; } }
      const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + tok } });
      if (r.status === 401 && !retried) { tok = null; return gfetch(url, opt, true); }
      return r;
    }
    async function jfetch(url, opt) { const r = await gfetch(url, opt); if (!r.ok) throw err("http_" + r.status, await r.text().catch(() => "")); return r.status === 204 ? null : r.json(); }

    /* ---- drive files ---- */
    async function findOne(q) {
      const r = await jfetch(`${API}/files?spaces=drive&fields=files(id,version,modifiedTime)&q=${encodeURIComponent(q + " and trashed=false")}`);
      return r.files && r.files[0];
    }
    async function mkFolder(name, parent, tag) {
      const body = { name, mimeType: "application/vnd.google-apps.folder", appProperties: { cm: tag } };
      if (parent) body.parents = [parent];
      return (await jfetch(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).id;
    }
    async function ensureFolders() {
      if (rootId) { const ok = await gfetch(`${API}/files/${rootId}?fields=id,trashed`).then((r) => r.ok ? r.json() : null).catch(() => null); if (!ok || ok.trashed) rootId = imgFolderId = dataId = null; }
      if (!rootId) {
        const f = await findOne(`appProperties has { key='cm' and value='root' } and mimeType='application/vnd.google-apps.folder'`);
        rootId = f ? f.id : await mkFolder(ROOT_NAME, null, "root"); ls.set("rootId", rootId);
      }
      if (!imgFolderId) {
        const f = await findOne(`appProperties has { key='cm' and value='images' } and '${rootId}' in parents`);
        imgFolderId = f ? f.id : await mkFolder("이미지", rootId, "images"); ls.set("imgId", imgFolderId);
      }
      if (!dataId) {
        const f = await findOne(`appProperties has { key='cm' and value='data' } and '${rootId}' in parents`);
        dataId = f ? f.id : null; ls.set("dataId", dataId);
      }
    }
    async function multipart(meta, blob, method, url) {
      const fd = new FormData();
      fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
      fd.append("file", blob);
      return jfetch(url, { method, body: fd });
    }

    /* ---- merge: 더 나중에 바뀐 쪽이 이겨요 ---- */
    function mergeIn(remote) {
      let changed = false, newAssets = false;
      COLS.forEach((col) => {
        const R = (remote.docs && remote.docs[col]) || {}, L = ST.docs[col];
        for (const id in R) { if (!L[id] || (R[id].u || 0) > (L[id].u || 0)) { L[id] = R[id]; changed = true; } }
      });
      const RA = remote.assets || {};
      for (const id in RA) {
        const l = ST.assets[id], r = RA[id];
        if (!l || (r.u || 0) > (l.u || 0) || (!l.x && !l.f && r.f)) { ST.assets[id] = { ...l, ...r }; changed = true; if (!r.x) newAssets = true; }
      }
      return { changed, newAssets };
    }
    function exportState() { return { format: "commission-app", v: 1, savedAt: new Date().toISOString(), docs: ST.docs, assets: ST.assets }; }

    async function pull() {
      if (!dataId) return false;
      const meta = await jfetch(`${API}/files/${dataId}?fields=id,version,trashed`).catch((e) => { if (String(e.code) === "http_404") { dataId = null; ls.set("dataId", null); } throw e; });
      if (meta.trashed) { dataId = null; ls.set("dataId", null); return false; }
      if (meta.version === remoteVer) return false;
      const r = await gfetch(`${API}/files/${dataId}?alt=media`);
      if (!r.ok) throw err("http_" + r.status);
      const remote = await r.json();
      remoteVer = meta.version; ls.set("dataVer", remoteVer);
      const { changed, newAssets } = mergeIn(remote);
      if (changed) { saveLocal(); emitSoon(); if (newAssets) setTimeout(retryBrokenImages, 50); }
      return changed;
    }
    async function pushImages() {
      for (const id of [...pendingUploads]) {
        const a = ST.assets[id]; if (!a || a.x) { pendingUploads = pendingUploads.filter((x) => x !== id); continue; }
        const b = await blobGet(id); if (!b) { pendingUploads = pendingUploads.filter((x) => x !== id); continue; }
        const r = await multipart({ name: a.n || id, parents: [imgFolderId], appProperties: { cm: "img", cmId: id } }, b, "POST", `${UPLOAD}/files?uploadType=multipart&fields=id`);
        ST.assets[id] = { ...ST.assets[id], f: r.id, u: now() };
        pendingUploads = pendingUploads.filter((x) => x !== id); saveLocal();
      }
      for (const f of [...pendingDeletes]) {
        const r = await gfetch(`${API}/files/${f}`, { method: "DELETE" });
        if (r.ok || r.status === 404) { pendingDeletes = pendingDeletes.filter((x) => x !== f); saveLocal(); }
      }
    }
    async function pushData() {
      const blob = new Blob([JSON.stringify(exportState())], { type: "application/json" });
      let r;
      if (dataId) r = await multipart({}, blob, "PATCH", `${UPLOAD}/files/${dataId}?uploadType=multipart&fields=id,version`);
      else { r = await multipart({ name: "data.json", parents: [rootId], mimeType: "application/json", appProperties: { cm: "data" } }, blob, "POST", `${UPLOAD}/files?uploadType=multipart&fields=id,version`); dataId = r.id; ls.set("dataId", dataId); }
      remoteVer = r.version; ls.set("dataVer", remoteVer);
    }

    /* 통신이 잠깐 끊긴 경우(화면 전환, 약한 신호): 알아서 몇 번 다시 시도 */
    let netFails = 0;
    const isNetErr = (e) => !e.code && (e instanceof TypeError || /load failed|failed to fetch|networkerror|network connection|aborted|cancel/i.test(String(e.message)));
    let dirty = ls.get("dirty") === "1";
    function markDirty(v) { dirty = v; ls.set("dirty", v ? "1" : null); }

    async function run() {
      if (mode() !== "drive") return;
      if (running) { again = true; return; }
      if (!navigator.onLine) { set("offline"); return; }
      running = true; set("syncing");
      try {
        if (!tok) await getToken(false);
        if (!scopeOk) throw err("scope");
        await ensureFolders();
        await pull();
        if (dirty || pendingUploads.length || pendingDeletes.length || !dataId) {
          await pushImages();
          markDirty(false);
          await pushData();
        }
        lastSync = now(); ls.set("lastSync", String(lastSync)); netFails = 0; set("ok");
      } catch (e) {
        console.warn("sync", e);
        if (e.code === "auth" || e.code === "auth_timeout" || e.code === "no_client") set("needlogin");
        else if (!navigator.onLine) set("offline");
        else if (isNetErr(e) && netFails < 4) { netFails++; set("retry"); again = false; clearTimeout(timer); timer = setTimeout(run, 3000 * netFails); }
        else set("error", explain(e));
      } finally {
        running = false;
        if (again) { again = false; schedule(300); }
      }
    }
    function schedule(ms) { if (mode() !== "drive") return; markDirty(true); clearTimeout(timer); timer = setTimeout(run, ms == null ? 1500 : ms); }
    function poke() { if (mode() !== "drive") return; clearTimeout(timer); timer = setTimeout(run, 50); }

    /* 첫 연결: 처음 깔아서 예시만 있는 상태면 드라이브 내용으로 바꾸고, 아니면 합쳐요 */
    async function connect() {
      set("connecting");
      await getToken(true);
      try {
        const me = await jfetch("https://www.googleapis.com/oauth2/v3/userinfo");
        const prev = ls.get("email");
        if (prev && me.email && prev !== me.email) { await resetLocal(); }
        ls.set("email", me.email || "");
      } catch (e) {}
      ls.set("mode", "drive");
      await ensureFolders();
      if (dataId && ST.pristine) {
        const keepA = ST.assets; ST = emptyState(); ST.assets = keepA; remoteVer = null;
        COLS.forEach((c) => (ST.docs[c] = {}));
      }
      markDirty(true);
      await run();
      emitSoon();
    }
    async function resetLocal() {
      await clearAll(); ST = emptyState(); pendingUploads = []; pendingDeletes = [];
      ["rootId", "imgId", "dataId", "dataVer", "lastSync", "dirty"].forEach((k) => ls.set(k, null));
      rootId = imgFolderId = dataId = remoteVer = null; markDirty(false);
      blobURLs.forEach((u) => URL.revokeObjectURL(u)); blobURLs.clear();
    }
    async function logout() {
      try { if (tok && window.google) google.accounts.oauth2.revoke(tok, () => {}); } catch (e) {}
      tok = null; await resetLocal(); ls.set("email", null); ls.set("mode", null);
      location.reload();
    }
    function useLocal() { ls.set("mode", "local"); set("local"); }

    /* 다른 기기에서 바꾼 내용 가져오기 */
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { netFails = 0; poke(); } });
    window.addEventListener("online", poke);
    window.addEventListener("offline", () => mode() === "drive" && set("offline"));
    setInterval(() => { if (document.visibilityState === "visible" && !running && mode() === "drive" && status !== "needlogin") run(); }, 30000);

    return {
      gfetch, token: () => tok, schedule, run: () => { netFails = 0; poke(); }, connect, logout, useLocal, mode,
      hasClient: () => !!CLIENT_ID,
      status: () => status, lastError: () => lastErr, lastSync: () => lastSync, email: () => ls.get("email") || "",
      folderUrl: () => (rootId ? "https://drive.google.com/drive/folders/" + rootId : ""),
      on: (f) => { subs.add(f); f(status); return () => subs.delete(f); },
      init() { if (mode() === "drive") { set("connecting"); run(); } else set(mode() === "local" ? "local" : "off"); },
    };
  })();

  /* ---------------- boot ---------------- */
  const ready = (async () => {
    const had = await loadLocal();
    if (!had) { seed(); saveLocal(); }
    Sync.init();
  })();

  window.CMStore = { Sync, getBlob, blobURL, ready, exportState: () => clone({ docs: ST.docs, assets: ST.assets }) };
  /* 원래 앱이 부르던 모양 그대로 */
  window.claude = {
    async use(name) {
      await ready;
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "downloads") return downloads;
      return null;
    },
  };
})();
