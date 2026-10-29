/* Sync: keeps an encrypted copy of the grimoire in a secret GitHub gist so every device can share it.
   Data is encrypted in the browser (AES-GCM, key from a passphrase via PBKDF2) before it leaves;
   GitHub only ever stores ciphertext. Each device pulls, merges record by record, then pushes. */
(function () {
  const CFG_KEY = "3rdiris.sync";
  const API = "https://api.github.com";
  const GIST_DESC = "3rd Iris Grimoire · encrypted sync";
  const FILE = "grimoire.enc.json";
  const IMG_DESC = "3rd Iris Grimoire · encrypted image";
  const IMG_FILE = "image.enc.json";
  const ITERATIONS = 310000;

  const loadCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; } };
  const saveCfg = (c) => { try { c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY); } catch {} };

  let cfg = loadCfg();
  let state = { status: cfg ? "idle" : "off", message: "", lastSync: cfg && cfg.lastSync };
  const listeners = new Set();
  const setState = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn(state)); };

  /* ── crypto ─────────────────────────────── */
  const enc = new TextEncoder(), dec = new TextDecoder();
  // in chunks: spreading a large buffer into a single call exceeds the browser's argument limit
  const b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const keyCache = new Map();

  async function deriveKey(passphrase, salt) {
    const k = `${passphrase}|${salt}`;
    if (keyCache.has(k)) return keyCache.get(k);
    const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: unb64(salt), iterations: ITERATIONS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
    keyCache.set(k, key);
    return key;
  }

  async function encrypt(obj, passphrase, salt) {
    salt = salt || b64(crypto.getRandomValues(new Uint8Array(16)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return { app: "3rd-iris", v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt, iv: b64(iv), data: b64(ct) };
  }

  async function decrypt(payload, passphrase) {
    const key = await deriveKey(passphrase, payload.salt);
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(payload.iv) }, key, unb64(payload.data));
      return JSON.parse(dec.decode(pt));
    } catch {
      throw new SyncError("That passphrase doesn't open the synced data. Use the same passphrase as on your other device.", "passphrase");
    }
  }

  /* ── GitHub ─────────────────────────────── */
  class SyncError extends Error {
    constructor(message, kind) { super(message); this.kind = kind; }
  }

  async function api(path, { method = "GET", body, token = cfg && cfg.token } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch {
      throw new SyncError("Can't reach GitHub. Changes are kept on this device and will sync when you're back online.", "offline");
    }
    if (res.status === 401) throw new SyncError("GitHub didn't accept the token. It may have expired; reconnect with a new one.", "auth");
    if (res.status === 403 || res.status === 404) {
      const scopes = res.headers.get("x-oauth-scopes");
      if (scopes !== null && !/\bgist\b/.test(scopes)) throw new SyncError("The token needs the “gist” permission.", "auth");
      throw new SyncError(res.status === 404 ? "The sync gist wasn't found. Reconnect to set it up again." : "GitHub refused the request (it may be rate limiting). Try again shortly.", res.status === 404 ? "missing" : "http");
    }
    if (!res.ok) throw new SyncError(`GitHub returned an error (${res.status}). Try again shortly.`, "http");
    return res.status === 204 ? null : res.json();
  }

  /* every sync copy on the account, oldest first. Normally one; two devices that connected
     before either could see the other's copy each made their own, and those get folded together. */
  async function listGists(token) {
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`, { token });
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }
  const byAge = (a, b) => (a.created_at || "").localeCompare(b.created_at || "") || a.id.localeCompare(b.id);
  const mainGists = (all) => all.filter((g) => g.description === GIST_DESC && g.files && g.files[FILE]).sort(byAge);
  const findGists = async (token) => mainGists(await listGists(token));
  const findGist = async (token) => ((await findGists(token))[0] || {}).id || null;

  async function readGist(id, token, file = FILE) {
    const g = await api(`/gists/${id}`, { token });
    const f = g.files && g.files[file];
    if (!f) throw new SyncError("The sync gist is missing its data file. Reconnect to set it up again.", "missing");
    let content = f.content;
    if (f.truncated) {
      const r = await fetch(f.raw_url, { cache: "no-store" });
      content = await r.text();
    }
    return JSON.parse(content);
  }

  const writeGist = (id, payload) => api(`/gists/${id}`, { method: "PATCH", body: { files: { [FILE]: { content: JSON.stringify(payload) } } } });

  /* ── sync cycle ─────────────────────────── */
  let running = null, again = false, applyingRemote = false, lastScan = 0;
  const SCAN_EVERY = 10 * 60000;

  const mergeIn = (remote) => {
    applyingRemote = true;
    try { Store.mergeFrom(remote); } finally { applyingRemote = false; }
  };

  /* settle on the oldest sync copy, folding any others into this device's data */
  async function consolidate() {
    lastScan = Date.now();
    const everything = await listGists(cfg.token);
    const all = mainGists(everything);
    // image copies more than an hour old; any no record refers to once merged get removed.
    // The hour spares an image another device has just uploaded but not yet referenced.
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const oldImages = everything.filter((g) => g.description === IMG_DESC && (g.created_at || "") < hourAgo).map((g) => g.id);
    // GitHub's list can lag behind a copy made moments ago; ask for this device's copy directly
    if (cfg.gistId && !all.some((g) => g.id === cfg.gistId)) {
      const own = await api(`/gists/${cfg.gistId}`).catch((e) => { if (e.kind === "missing") return null; throw e; });
      if (own) {
        all.push(own);
        all.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "") || a.id.localeCompare(b.id));
      }
    }
    if (!all.length) {
      // the copy was deleted on GitHub; start a new one from what this device holds
      const g = await api("/gists", { method: "POST", body: { description: GIST_DESC, public: false, files: { [FILE]: { content: JSON.stringify(await encrypt(Store.data, cfg.passphrase)) } } } });
      cfg.gistId = g.id;
      saveCfg(cfg);
      return { extras: [], locked: 0, oldImages: [] };
    }
    const extras = [];
    let locked = 0;
    for (const g of all.slice(1)) {
      try {
        mergeIn(await decrypt(await readGist(g.id, cfg.token), cfg.passphrase));
        extras.push(g.id);
      } catch (e) {
        // a copy made with a different passphrase can't be read; leave it alone
        if (e.kind === "passphrase") locked++;
        else throw e;
      }
    }
    if (cfg.gistId !== all[0].id) { cfg.gistId = all[0].id; saveCfg(cfg); }
    return { extras, locked, oldImages };
  }

  const summarize = (d) => ({ tx: d.transactions.length, tasks: d.tasks.length, clients: d.clients.length, appts: d.appointments.length, ideas: (d.ideas || []).length });

  /* images travel separately: one small encrypted gist each, uploaded once by the device that has
     it and fetched once by each device that doesn't, so the main sync stays light */
  async function syncImages(salt) {
    if (!window.Images) return;
    for (const it of Store.data.ideas || []) {
      if (!it.imageId) continue;
      if (!it.imageGist) {
        const blob = await Images.get(it.imageId);
        if (!blob) continue;
        const payload = await encrypt({ type: blob.type, data: await Images.toBase64(blob) }, cfg.passphrase, salt);
        const g = await api("/gists", { method: "POST", body: { description: IMG_DESC, public: false, files: { [IMG_FILE]: { content: JSON.stringify(payload) } } } });
        // saving the reference schedules a follow-up sync that shares it
        Store.upsert("ideas", { id: it.id, imageGist: g.id });
      } else if (!(await Images.has(it.imageId))) {
        const payload = await readGist(it.imageGist, cfg.token, IMG_FILE).catch((e) => { if (e.kind === "missing") return null; throw e; });
        if (!payload) continue;
        const img = await decrypt(payload, cfg.passphrase);
        await Images.put(it.imageId, Images.fromBase64(img.data, img.type));
      }
    }
  }

  async function syncNow({ rescan = false } = {}) {
    if (!cfg) return;
    if (running) { again = true; return running; }
    running = (async () => {
      setState({ status: "syncing", message: "" });
      try {
        let scan = rescan || Date.now() - lastScan > SCAN_EVERY ? await consolidate() : null;
        let remotePayload;
        try {
          remotePayload = await readGist(cfg.gistId, cfg.token);
        } catch (e) {
          // another device may have folded this copy into the main one; find it
          if (e.kind !== "missing" || scan) throw e;
          scan = await consolidate();
          remotePayload = await readGist(cfg.gistId, cfg.token);
        }
        const remote = await decrypt(remotePayload, cfg.passphrase);
        mergeIn(remote);
        // only write back when this device has something the gist lacks
        if (canonical(Store.data) !== canonical(remote)) {
          await writeGist(cfg.gistId, await encrypt(Store.data, cfg.passphrase, remotePayload.salt));
        }
        // extra copies are only removed once their contents are safely in the main one
        if (scan) {
          // decided only now, after merging, so a reference from another device is never missed
          const referenced = new Set((Store.data.ideas || []).map((i) => i.imageGist).filter(Boolean));
          const stale = scan.oldImages.filter((id) => !referenced.has(id));
          for (const id of [...scan.extras, ...stale]) await api(`/gists/${id}`, { method: "DELETE" }).catch(() => {});
        }
        await syncImages(remotePayload.salt);
        cfg.lastSync = new Date().toISOString();
        saveCfg(cfg);
        setState({
          status: "ok", lastSync: cfg.lastSync, summary: summarize(Store.data),
          message: scan && scan.locked ? "Another sync copy on your GitHub account uses a different passphrase, so it was left alone." : "",
        });
      } catch (e) {
        setState({ status: e.kind === "offline" ? "offline" : "error", message: e.message || String(e) });
      } finally {
        running = null;
        if (again) { again = false; syncNow(); }
      }
    })();
    return running;
  }

  // compare data by content regardless of key order or record order
  function canonical(d) {
    const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
      : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
    const copy = JSON.parse(JSON.stringify(d));
    ["categories", "transactions", "appointments", "clients", "tasks", "ideas", "projects", "content", "partners"].forEach((c) => (copy[c] || []).sort((a, b) => String(a.id).localeCompare(String(b.id))));
    (copy.deleted || []).sort((a, b) => `${a.c}|${a.id}`.localeCompare(`${b.c}|${b.id}`));
    return JSON.stringify(sortKeys(copy));
  }

  /* first connection on a device: find this account's gist (or make one) and merge with it */
  async function connect(token, passphrase) {
    token = token.trim();
    if (!token) throw new SyncError("Paste your GitHub token.", "input");
    if (passphrase.length < 8) throw new SyncError("Choose a passphrase of at least 8 characters.", "input");
    setState({ status: "syncing", message: "" });
    try {
      await api("/user", { token });
      let gistId = await findGist(token);
      const created = !gistId;
      if (gistId) {
        // check the passphrase before saving anything
        await decrypt(await readGist(gistId, token), passphrase);
      } else {
        const g = await api("/gists", { method: "POST", token, body: { description: GIST_DESC, public: false, files: { [FILE]: { content: JSON.stringify(await encrypt(Store.data, passphrase)) } } } });
        gistId = g.id;
      }
      cfg = { token, passphrase, gistId, lastSync: "" };
      saveCfg(cfg);
      await syncNow({ rescan: true });
      return { created };
    } catch (e) {
      setState({ status: cfg ? state.status : "off", message: e.message });
      throw e;
    }
  }

  function disconnect() {
    cfg = null;
    saveCfg(null);
    setState({ status: "off", message: "", lastSync: "" });
  }

  /* ── when to sync ───────────────────────── */
  let timer;
  Store.onChange(() => {
    if (!cfg || applyingRemote) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 2500);
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("online", () => syncNow());
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 120000);
  if (cfg) setTimeout(syncNow, 300);

  window.Sync = {
    get state() { return state; },
    get connected() { return !!cfg; },
    onChange: (fn) => listeners.add(fn),
    connect,
    disconnect,
    syncNow: () => syncNow({ rescan: true }),
  };
})();
