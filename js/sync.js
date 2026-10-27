/* Sync: keeps an encrypted copy of the grimoire in a secret GitHub gist so every device can share it.
   Data is encrypted in the browser (AES-GCM, key from a passphrase via PBKDF2) before it leaves;
   GitHub only ever stores ciphertext. Each device pulls, merges record by record, then pushes. */
(function () {
  const CFG_KEY = "3rdiris.sync";
  const API = "https://api.github.com";
  const GIST_DESC = "3rd Iris Grimoire · encrypted sync";
  const FILE = "grimoire.enc.json";
  const ITERATIONS = 310000;

  const loadCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; } };
  const saveCfg = (c) => { try { c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY); } catch {} };

  let cfg = loadCfg();
  let state = { status: cfg ? "idle" : "off", message: "", lastSync: cfg && cfg.lastSync };
  const listeners = new Set();
  const setState = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn(state)); };

  /* ── crypto ─────────────────────────────── */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
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

  async function findGist(token) {
    for (let page = 1; page <= 10; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`, { token });
      const hit = list.find((g) => g.description === GIST_DESC && g.files && g.files[FILE]);
      if (hit) return hit.id;
      if (list.length < 100) return null;
    }
    return null;
  }

  async function readGist(id, token) {
    const g = await api(`/gists/${id}`, { token });
    const f = g.files && g.files[FILE];
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
  let running = null, again = false, applyingRemote = false;

  async function syncNow() {
    if (!cfg) return;
    if (running) { again = true; return running; }
    running = (async () => {
      setState({ status: "syncing", message: "" });
      try {
        const remotePayload = await readGist(cfg.gistId, cfg.token);
        const remote = await decrypt(remotePayload, cfg.passphrase);
        applyingRemote = true;
        try { Store.mergeFrom(remote); } finally { applyingRemote = false; }
        // only write back when this device has something the gist lacks
        if (canonical(Store.data) !== canonical(remote)) {
          await writeGist(cfg.gistId, await encrypt(Store.data, cfg.passphrase, remotePayload.salt));
        }
        cfg.lastSync = new Date().toISOString();
        saveCfg(cfg);
        setState({ status: "ok", message: "", lastSync: cfg.lastSync });
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
    ["categories", "transactions", "appointments", "clients", "tasks"].forEach((c) => (copy[c] || []).sort((a, b) => String(a.id).localeCompare(String(b.id))));
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
      await syncNow();
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
    syncNow,
  };
})();
