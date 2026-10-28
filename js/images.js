/* Images: pictures for the Cabinet live in IndexedDB, which holds far more than localStorage.
   They're shrunk on the way in, and records refer to them by id. */
(function () {
  const DB = "3rdiris-images", STORE = "images";
  const MAX_SIDE = 1600, QUALITY = 0.85;
  let dbPromise;

  function db() {
    return (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }

  const urls = new Map(); // id → object URL, so re-renders don't flicker
  const listeners = new Set();

  const get = (id) => run("readonly", (s) => s.get(id));
  const has = async (id) => !!(await run("readonly", (s) => s.getKey(id)));
  const keys = () => run("readonly", (s) => s.getAllKeys());

  async function put(id, blob) {
    await run("readwrite", (s) => s.put(blob, id));
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    listeners.forEach((fn) => fn(id));
  }

  async function del(id) {
    await run("readwrite", (s) => s.delete(id));
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  }

  async function urlFor(id) {
    if (urls.has(id)) return urls.get(id);
    const blob = await get(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  }

  async function decode(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // older browsers: go through an <img>
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  /* shrink a picked/pasted/dropped file to at most 1600px and store it */
  async function fromFile(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error("That isn't an image.");
    const src = await decode(file);
    const w0 = src.width, h0 = src.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0e0c10"; // transparent areas become the page's ink, not black or white
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    const id = "img-" + Store.uid();
    await put(id, blob);
    return { id, w, h };
  }

  /* blobs ⇄ base64, for backups and sync */
  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function fromBase64(b64, type = "image/jpeg") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  window.Images = {
    get, has, keys, put, del, urlFor, fromFile, toBase64, fromBase64,
    cachedUrl: (id) => urls.get(id) || "",
    onChange: (fn) => listeners.add(fn),
  };
})();
