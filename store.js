/* =====================================================================
   커미션 작업실 — 저장소 (Supabase 개인 서버)
   - 이 기기(IndexedDB)에 먼저 저장하고, 각자의 Supabase 서버와 동기화해요.
   - 앱 코드가 쓰던 claude.use("db" | "assets" | "downloads") 모양을 그대로 흉내 내요.
   - 서버: cm_docs 표 하나 + cm-images 이미지 보관함 (setup.sql 참고)
   - 이미지는 올리기 전에 줄여요: 보기용(긴 변 1600px) + 썸네일(긴 변 600px)
   ===================================================================== */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
  const BUCKET = "cm-images";
  const COLS = ["commissions", "templates", "settings"];
  const ASSET_COL = "_assets";
  const VIEW_MAX = 1600, THUMB_MAX = 600;

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
        const r = indexedDB.open("commission-app-sb", 1);
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
     docs[col][id] = { d: data, u: updatedAt(ms), x: deleted? }
     assets[id]    = { n: name, t: type, tt: thumbType, sz, tsz, up: uploaded?, u, x }   */
  let ST = emptyState();
  let pendingDocs = new Set();   // "col/id" — 서버에 아직 안 올라간 변경
  let pendingUploads = [];       // asset ids
  let pendingDeletes = [];       // storage paths
  function emptyState() { return { v: 2, docs: { commissions: {}, templates: {}, settings: {} }, assets: {}, pristine: false, cursor: null }; }

  async function loadLocal() {
    const s = await kvGet("state");
    if (s && s.docs) { ST = s; COLS.forEach((c) => (ST.docs[c] = ST.docs[c] || {})); ST.assets = ST.assets || {}; }
    pendingDocs = new Set((await kvGet("pendingDocs")) || []);
    pendingUploads = (await kvGet("pendingUploads")) || [];
    pendingDeletes = (await kvGet("pendingDeletes")) || [];
    return !!(s && s.docs);
  }
  let saveT = null;
  function saveLocal() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { kvSet("state", ST); kvSet("pendingDocs", [...pendingDocs]); kvSet("pendingUploads", pendingUploads); kvSet("pendingDeletes", pendingDeletes); }, 120);
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
    ["commissions/demo-1", "commissions/demo-2", "templates/demo-t1", "templates/demo-t2"].forEach((k) => pendingDocs.add(k));
    ST.pristine = true;
  }

  /* ---------------- listeners ---------------- */
  const colListeners = { commissions: new Set(), templates: new Set(), settings: new Set() };
  const docListeners = new Map();
  let emitQ = null;
  function emitSoon() { if (emitQ) return; emitQ = Promise.resolve().then(() => { emitQ = null; emitAll(); }); }
  function colSnap(col, orderField) {
    let docs = Object.entries(ST.docs[col] || {}).filter(([, r]) => !r.x).map(([id, r]) => ({ id, _d: r.d }));
    if (orderField) docs.sort((a, b) => ((a._d[orderField] ?? 0) > (b._d[orderField] ?? 0) ? 1 : -1));
    return { size: docs.length, empty: !docs.length, docs: docs.map((x) => ({ id: x.id, exists: true, data: () => clone(x._d) })) };
  }
  function docSnap(col, id) {
    const r = (ST.docs[col] || {})[id]; const ok = !!(r && !r.x);
    return { id, exists: ok, data: () => (ok ? clone(r.d) : undefined) };
  }
  function emitAll() {
    COLS.forEach((col) => colListeners[col].forEach((l) => { try { l.cb(colSnap(col, l.order)); } catch (e) { console.error(e); } }));
    docListeners.forEach((set, key) => { const [col, id] = key.split("/"); set.forEach((cb) => { try { cb(docSnap(col, id)); } catch (e) { console.error(e); } }); });
  }
  function touch(key) { if (key) pendingDocs.add(key); ST.pristine = false; saveLocal(); emitSoon(); Sync.schedule(); }

  /* ---------------- db shim ---------------- */
  function docRef(col, id) {
    if (!ST.docs[col]) ST.docs[col] = {};
    const key = col + "/" + id;
    return {
      id,
      async get() { return docSnap(col, id); },
      async set(data, opt) {
        const r = ST.docs[col][id];
        const base = opt && opt.merge && r && !r.x ? r.d : {};
        ST.docs[col][id] = { d: { ...clone(base), ...clone(data) }, u: now() }; touch(key);
      },
      async update(patch) {
        const r = ST.docs[col][id];
        if (!r || r.x) throw err("not_found", "문서가 없어요");
        ST.docs[col][id] = { d: { ...r.d, ...clone(patch) }, u: now() }; touch(key);
      },
      async delete() { ST.docs[col][id] = { x: true, u: now() }; touch(key); },
      onSnapshot(cb) {
        if (!docListeners.has(key)) docListeners.set(key, new Set());
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

  /* =====================================================================
     이미지 줄이기
     ===================================================================== */
  function canvasBlob(cv, type, q) { return new Promise((res) => cv.toBlob((b) => res(b), type, q)); }
  async function hasAlpha(bmp) {
    try {
      const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
      const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, 64, 64);
      const d = cx.getImageData(0, 0, 64, 64).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) {}
    return false;
  }
  async function encode(bmp, max, q, alpha) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.imageSmoothingQuality = "high";
    let b = await canvasBlob((cx.drawImage(bmp, 0, 0, w, h), cv), "image/webp", q);
    if (b && b.type === "image/webp") return b;
    /* 아이폰 사파리는 webp로 못 만들어서: 투명하면 png, 아니면 jpg */
    if (alpha) return canvasBlob(cv, "image/png");
    cx.globalCompositeOperation = "destination-over"; cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
    return canvasBlob(cv, "image/jpeg", Math.min(0.9, q + 0.04));
  }
  async function shrink(file) {
    if (!/^image\/(png|jpe?g|webp|bmp|heic|heif|avif)$/i.test(file.type || "")) return null;
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { return null; }
    try {
      const alpha = /png|webp|avif/i.test(file.type) ? await hasAlpha(bmp) : false;
      let view = await encode(bmp, VIEW_MAX, 0.82, alpha);
      const thumb = await encode(bmp, THUMB_MAX, 0.74, alpha);
      if (view && Math.max(bmp.width, bmp.height) <= VIEW_MAX && file.size <= view.size) view = file;
      return view && thumb ? { view, thumb } : null;
    } finally { bmp.close && bmp.close(); }
  }
  const extOf = (t) => ({ "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/svg+xml": "svg" }[t] || "bin");
  const pathOf = (id, thumb, a) => `${Sync.uid()}/${id}${thumb ? "_t" : ""}.${extOf(thumb ? a.tt || a.t : a.t)}`;

  /* ---------------- images: load & show ---------------- */
  const blobURLs = new Map();
  const inflight = new Map();
  async function getBlob(id, thumb) {
    const key = thumb ? id + "_t" : id;
    let b = await blobGet(key);
    if (b) return b;
    const a = ST.assets[id];
    if (!a || a.x) return null;
    if (thumb && !a.tt) return getBlob(id, false);
    if (!a.up || !Sync.uid()) return thumb ? blobGet(id) : null;
    try {
      const sb = await Sync.client();
      const r = await sb.storage.from(BUCKET).download(pathOf(id, thumb, a));
      if (r.error || !r.data) return thumb ? getBlob(id, false) : null;
      b = r.data; await blobSet(key, b); return b;
    } catch (e) { return null; }
  }
  function blobURL(id, thumb) {
    const key = thumb ? id + "_t" : id;
    if (blobURLs.has(key)) return Promise.resolve(blobURLs.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const p = getBlob(id, thumb).then((b) => { inflight.delete(key); if (!b) return null; const u = URL.createObjectURL(b); blobURLs.set(key, u); return u; });
    inflight.set(key, p); return p;
  }
  /* <img src="cmimg:ID"> 또는 "cmimg:t:ID"(썸네일)은 바로 실패하고, 그때 진짜 이미지를 채워 넣어요 */
  window.cmImgSrc = (id, thumb) => blobURLs.get(thumb ? id + "_t" : id) || (thumb ? "cmimg:t:" : "cmimg:") + id;
  document.addEventListener("error", (e) => {
    const im = e.target; if (!(im instanceof HTMLImageElement)) return;
    const s = im.getAttribute("src") || ""; if (!s.startsWith("cmimg:")) return;
    if (im.dataset.cmTry === s) return; im.dataset.cmTry = s;
    const thumb = s.startsWith("cmimg:t:"); const id = s.slice(thumb ? 8 : 6);
    blobURL(id, thumb).then((u) => { if (u && im.getAttribute("src") === s) im.src = u; });
  }, true);
  function retryBrokenImages() {
    document.querySelectorAll('img[src^="cmimg:"]').forEach((im) => { delete im.dataset.cmTry; const s = im.getAttribute("src"); im.src = ""; im.src = s; });
  }

  const assets = {
    async upload(file, opt) {
      const id = rid("a");
      const type = (opt && opt.type) || file.type || "application/octet-stream";
      const src = file instanceof Blob ? file : new Blob([file], { type });
      const small = await shrink(src.type ? src : new Blob([src], { type }));
      const view = small ? small.view : src;
      await blobSet(id, view);
      if (small) await blobSet(id + "_t", small.thumb);
      const base = (file.name || id).replace(/\.[^.]+$/, "");
      ST.assets[id] = { n: base + "." + extOf(view.type || type), t: view.type || type, sz: view.size,
        tt: small ? small.thumb.type : null, tsz: small ? small.thumb.size : 0, u: now() };
      pendingUploads.push(id); touch(ASSET_COL + "/" + id);
      return { id, url: window.cmImgSrc(id) };
    },
    async delete(id) {
      const a = ST.assets[id];
      if (a && a.up && Sync.uid()) { pendingDeletes.push(pathOf(id, false, a)); if (a.tt) pendingDeletes.push(pathOf(id, true, a)); }
      ST.assets[id] = { x: true, u: now() };
      pendingUploads = pendingUploads.filter((x) => x !== id);
      for (const k of [id, id + "_t"]) { await blobDel(k); const u = blobURLs.get(k); if (u) { URL.revokeObjectURL(u); blobURLs.delete(k); } }
      touch(ASSET_COL + "/" + id);
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
     Supabase 동기화
     ===================================================================== */
  const Sync = (() => {
    let sb = null, sbFor = "", user = null, channel = null, libP = null;
    let status = "off", lastErr = "";
    let lastSync = Number(ls.get("lastSync")) || 0;
    let timer = null, running = false, again = false, netFails = 0;
    const subs = new Set();
    const mode = () => ls.get("mode") || ""; // "" | "server" | "local"
    const server = () => ({ url: (ls.get("srvUrl") || CFG.supabaseUrl || "").trim().replace(/\/+$/, ""), key: (ls.get("srvKey") || CFG.supabaseKey || "").trim() });
    function set(s, msg) { status = s; lastErr = s === "error" ? (msg || "") : ""; subs.forEach((f) => { try { f(status, msg); } catch (e) {} }); }

    function loadLib() {
      if (window.supabase && window.supabase.createClient) return Promise.resolve();
      if (libP) return libP;
      libP = new Promise((res, rej) => {
        const s = document.createElement("script"); s.src = SB_LIB; s.async = true;
        s.onload = () => res(); s.onerror = () => { libP = null; rej(err("lib", "Supabase 도구를 불러오지 못했어요")); };
        document.head.appendChild(s);
      });
      return libP;
    }
    async function client() {
      const { url, key } = server();
      if (!url || !key) throw err("no_server");
      if (sb && sbFor === url + key) return sb;
      await loadLib();
      sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "cm-auth" } });
      sbFor = url + key;
      const { data } = await sb.auth.getSession();
      user = data && data.session ? data.session.user : null;
      sb.auth.onAuthStateChange((ev, session) => {
        user = session ? session.user : null;
        if (user) { ls.set("email", user.email || ""); ls.set("uid", user.id); }
        if (ev === "SIGNED_OUT" && mode() === "server") set("needlogin");
      });
      return sb;
    }

    /* ---- 오류를 한글로 ---- */
    const isNetMsg = (m) => /load failed|failed to fetch|networkerror|network connection|fetch failed|aborted|timed? ?out/i.test(String(m || ""));
    function toErr(e) {
      if (!e) return err("unknown");
      if (e.code && typeof e.code === "string" && e.code !== "") { const x = err(e.code, e.message); x.status = e.status || e.statusCode; return x; }
      const x = err(isNetMsg(e.message) ? "net" : (e.statusCode || e.status ? "http_" + (e.statusCode || e.status) : "sb"), e.message || e.error || "");
      return x;
    }
    function chk(r) { if (r && r.error) throw toErr(r.error); return r ? r.data : null; }
    function explain(e) {
      const c = String(e.code || ""), m = String(e.message || "");
      if (c === "net" || isNetMsg(m)) return "서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요. 오래 안 썼다면 Supabase에서 프로젝트가 일시 정지됐는지 확인해 주세요.";
      if (c === "PGRST205" || c === "42P01" || /cm_docs/.test(m) && /not find|does not exist/i.test(m)) return "서버에 설정 스크립트가 아직 실행되지 않았어요. 안내서의 'SQL 붙여 넣기' 단계를 해 주세요.";
      if (/bucket not found/i.test(m)) return "이미지 보관함(cm-images)이 없어요. 설정 스크립트를 다시 실행해 주세요.";
      if (c === "42501" || /row-level security|violates row/i.test(m)) return "서버 권한 설정이 맞지 않아요. 설정 스크립트를 다시 실행해 주세요.";
      if (/payload too large|exceeded|quota|413/i.test(m + c)) return "저장 공간이 가득 찼거나 파일이 너무 커요.";
      if (/invalid api key|jwt|no api key/i.test(m)) return "서버 키가 맞지 않아요. 저장·동기화 → 서버 바꾸기에서 Publishable key를 다시 넣어 주세요.";
      if (c === "no_server") return "서버 주소와 키가 아직 없어요.";
      if (c === "lib") return m;
      return "오류: " + (m || c || "알 수 없음").slice(0, 160);
    }

    /* ---- 서버 → 기기 ---- */
    function mergeRow(r) {
      const u = Date.parse(r.updated_at) || 0;
      if (r.col === ASSET_COL) {
        const l = ST.assets[r.id];
        if (pendingDocs.has(ASSET_COL + "/" + r.id) && l && (l.u || 0) >= u) return false;
        if (!l || u > (l.u || 0)) { ST.assets[r.id] = r.deleted ? { x: true, u } : { ...(r.data || {}), u }; return true; }
        return false;
      }
      if (!ST.docs[r.col]) ST.docs[r.col] = {};
      const l = ST.docs[r.col][r.id];
      if (pendingDocs.has(r.col + "/" + r.id) && l && (l.u || 0) >= u) return false;
      if (!l || u > (l.u || 0)) { ST.docs[r.col][r.id] = r.deleted ? { x: true, u } : { d: r.data || {}, u }; return true; }
      return false;
    }
    async function pull() {
      const c = await client(); let changed = false, newA = false, more = true, guard = 0;
      while (more && guard++ < 50) {
        let q = c.from("cm_docs").select("col,id,data,deleted,updated_at,synced_at").order("synced_at", { ascending: true }).limit(500);
        if (ST.cursor) q = q.gt("synced_at", ST.cursor);
        const rows = chk(await q) || [];
        for (const r of rows) { if (mergeRow(r)) { changed = true; if (r.col === ASSET_COL) newA = true; } ST.cursor = r.synced_at; }
        more = rows.length === 500;
      }
      if (changed) { saveLocal(); emitSoon(); if (newA) setTimeout(retryBrokenImages, 50); }
      return changed;
    }
    /* ---- 기기 → 서버 ---- */
    async function pushImages() {
      const c = await client();
      for (const id of [...pendingUploads]) {
        const a = ST.assets[id]; if (!a || a.x) { pendingUploads = pendingUploads.filter((x) => x !== id); continue; }
        const v = await blobGet(id); if (!v) { pendingUploads = pendingUploads.filter((x) => x !== id); continue; }
        chk(await c.storage.from(BUCKET).upload(pathOf(id, false, a), v, { upsert: true, contentType: a.t, cacheControl: "31536000" }));
        if (a.tt) { const t = await blobGet(id + "_t"); if (t) chk(await c.storage.from(BUCKET).upload(pathOf(id, true, a), t, { upsert: true, contentType: a.tt, cacheControl: "31536000" })); }
        ST.assets[id] = { ...ST.assets[id], up: true, u: now() }; pendingDocs.add(ASSET_COL + "/" + id);
        pendingUploads = pendingUploads.filter((x) => x !== id); saveLocal();
      }
      if (pendingDeletes.length) {
        const list = [...pendingDeletes];
        const r = await c.storage.from(BUCKET).remove(list);
        if (!r.error) { pendingDeletes = pendingDeletes.filter((p) => !list.includes(p)); saveLocal(); }
      }
    }
    async function pushDocs() {
      if (!pendingDocs.size) return;
      const c = await client(); const keys = [...pendingDocs];
      for (let i = 0; i < keys.length; i += 200) {
        const part = keys.slice(i, i + 200);
        const rows = part.map((k) => {
          const j = k.indexOf("/"); const col = k.slice(0, j), id = k.slice(j + 1);
          const r = col === ASSET_COL ? ST.assets[id] : (ST.docs[col] || {})[id];
          if (!r) return null;
          const data = col === ASSET_COL ? (r.x ? null : (({ u, ...rest }) => rest)(r)) : (r.x ? null : r.d);
          return { owner: user.id, col, id, data, deleted: !!r.x, updated_at: new Date(r.u || now()).toISOString() };
        }).filter(Boolean);
        if (rows.length) chk(await c.from("cm_docs").upsert(rows, { onConflict: "owner,col,id" }));
        part.forEach((k) => pendingDocs.delete(k)); saveLocal();
      }
    }
    function listen(c) {
      if (channel) return;
      try {
        channel = c.channel("cm-docs-" + user.id)
          .on("postgres_changes", { event: "*", schema: "public", table: "cm_docs", filter: "owner=eq." + user.id }, (p) => {
            if (p.new && p.new.col && mergeRow(p.new)) { saveLocal(); emitSoon(); if (p.new.col === ASSET_COL) setTimeout(retryBrokenImages, 50); }
          })
          .subscribe();
      } catch (e) { channel = null; }
    }

    async function run() {
      if (mode() !== "server") return;
      if (running) { again = true; return; }
      if (!navigator.onLine) { set("offline"); return; }
      running = true; set("syncing");
      try {
        const c = await client();
        if (!user) { const { data } = await c.auth.getSession(); user = data && data.session ? data.session.user : null; }
        if (!user) { set("needlogin"); return; }
        if (ST.uid && ST.uid !== user.id) { await resetLocal(true); }
        ST.uid = user.id; ls.set("uid", user.id);
        await pull();
        await pushImages();
        await pushDocs();
        listen(c);
        lastSync = now(); ls.set("lastSync", String(lastSync)); netFails = 0; set("ok");
      } catch (e) {
        console.warn("sync", e);
        const net = e.code === "net" || isNetMsg(e.message) || e instanceof TypeError;
        if (!navigator.onLine) set("offline");
        else if (net && netFails < 4) { netFails++; set("retry"); again = false; clearTimeout(timer); timer = setTimeout(run, 3000 * netFails); }
        else set("error", explain(e));
      } finally {
        running = false;
        if (again) { again = false; schedule(300); }
      }
    }
    function schedule(ms) { if (mode() !== "server") return; clearTimeout(timer); timer = setTimeout(run, ms == null ? 1200 : ms); }
    function poke() { if (mode() !== "server") return; clearTimeout(timer); timer = setTimeout(run, 50); }

    /* ---- 서버 연결·로그인 ---- */
    async function setServer(url, key) {
      url = String(url || "").trim().replace(/\/+$/, ""); key = String(key || "").trim();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^https?:\/\//i.test(url)) throw err("bad_url", "서버 주소는 https://○○○.supabase.co 모양이에요.");
      if (key.length < 20) throw err("bad_key", "Publishable key를 통째로 붙여 넣어 주세요.");
      if (/^sb_secret_/i.test(key) || (() => { try { return JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role"; } catch (e) { return false; } })()) throw err("bad_key", "이건 비밀 키(secret)예요. 대신 Publishable key를 넣어 주세요.");
      ls.set("srvUrl", url); ls.set("srvKey", key); sb = null; sbFor = ""; channel = null;
      try {
        const c = await client();
        const r = await c.from("cm_docs").select("id", { head: true, count: "exact" }).limit(1);
        if (r.error) throw toErr(r.error);
      } catch (e) { ls.set("srvUrl", null); ls.set("srvKey", null); sb = null; sbFor = ""; e.friendly = explain(e); throw e; }
    }
    async function afterLogin() {
      user = (await (await client()).auth.getUser()).data.user;
      if (!user) throw err("auth", "로그인 정보를 확인하지 못했어요.");
      if (ST.uid && ST.uid !== user.id) await resetLocal(true);
      ls.set("email", user.email || ""); ls.set("uid", user.id); ls.set("mode", "server");
      /* 처음 설치해서 예시만 있는 상태인데 서버에 이미 자료가 있으면 → 서버 자료로 */
      if (ST.pristine) {
        const c = await client();
        const r = await c.from("cm_docs").select("id", { head: true, count: "exact" });
        if (!r.error && r.count > 0) { const keep = ST; ST = emptyState(); pendingDocs.clear(); pendingUploads = []; void keep; }
      }
      ST.uid = user.id; saveLocal(); netFails = 0; await run(); emitSoon();
    }
    async function signIn(email, pw) {
      const c = await client();
      const r = await c.auth.signInWithPassword({ email: String(email).trim(), password: pw });
      if (r.error) { const e = toErr(r.error); e.friendly = /invalid login/i.test(r.error.message) ? "이메일이나 비밀번호가 맞지 않아요." : /not confirmed/i.test(r.error.message) ? "이메일 인증이 아직 안 됐어요. 메일함의 인증 링크를 누르거나, 안내서대로 'Confirm email'을 꺼 주세요." : explain(e); throw e; }
      await afterLogin();
    }
    async function signUp(email, pw) {
      const c = await client();
      const r = await c.auth.signUp({ email: String(email).trim(), password: pw });
      if (r.error) { const e = toErr(r.error); e.friendly = /already registered/i.test(r.error.message) ? "이미 가입된 이메일이에요. 로그인을 눌러 주세요." : /password/i.test(r.error.message) ? "비밀번호는 6자 이상으로 해 주세요." : explain(e); throw e; }
      if (!r.data.session) { const e = err("confirm"); e.friendly = "가입은 됐어요. 메일함의 인증 링크를 누른 뒤 로그인해 주세요. (안내서대로 'Confirm email'을 끄면 이 단계가 없어져요)"; throw e; }
      await afterLogin();
    }
    async function resetLocal(keepServer) {
      await clearAll(); ST = emptyState(); pendingDocs = new Set(); pendingUploads = []; pendingDeletes = [];
      ["lastSync"].forEach((k) => ls.set(k, null)); lastSync = 0;
      blobURLs.forEach((u) => URL.revokeObjectURL(u)); blobURLs.clear();
      if (!keepServer) { ls.set("srvUrl", null); ls.set("srvKey", null); }
      emitSoon();
    }
    async function logout(alsoServer) {
      try { if (channel && sb) sb.removeChannel(channel); } catch (e) {}
      channel = null;
      try { const c = await client(); await c.auth.signOut(); } catch (e) {}
      await resetLocal(!alsoServer); ls.set("email", null); ls.set("uid", null); ls.set("mode", null);
      location.reload();
    }
    function useLocal() { ls.set("mode", "local"); set("local"); }
    function usage() {
      let bytes = 0, n = 0;
      for (const id in ST.assets) { const a = ST.assets[id]; if (a && !a.x) { bytes += (a.sz || 0) + (a.tsz || 0); n++; } }
      return { bytes, n };
    }

    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { netFails = 0; poke(); } });
    window.addEventListener("online", () => { netFails = 0; poke(); });
    window.addEventListener("offline", () => mode() === "server" && set("offline"));
    setInterval(() => { if (document.visibilityState === "visible" && !running && mode() === "server" && status !== "needlogin" && (pendingDocs.size || pendingUploads.length || !channel)) run(); }, 30000);

    return {
      client, uid: () => user && user.id, schedule, run: () => { netFails = 0; poke(); },
      setServer, signIn, signUp, logout, useLocal, mode, server, usage,
      hasServer: () => !!(server().url && server().key), presetServer: () => !!(CFG.supabaseUrl && CFG.supabaseKey),
      status: () => status, lastError: () => lastErr, lastSync: () => lastSync, email: () => ls.get("email") || "",
      pending: () => pendingDocs.size + pendingUploads.length,
      on: (f) => { subs.add(f); f(status); return () => subs.delete(f); },
      init() { if (mode() === "server") { set("connecting"); run(); } else set(mode() === "local" ? "local" : "off"); },
    };
  })();

  /* ---------------- boot ---------------- */
  const ready = (async () => {
    const had = await loadLocal();
    if (!had) { seed(); saveLocal(); }
    Sync.init();
  })();

  window.CMStore = { Sync, getBlob, blobURL, ready, shrink };
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
