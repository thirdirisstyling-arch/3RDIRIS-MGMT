/* Store: all records live in localStorage under one key. */
(function () {
  const KEY = "3rdiris.grimoire.v1";

  const DEFAULT_CATEGORIES = [
    { name: "Hearth & Home", color: "#c3a568", budget: 1400, scope: "personal" },
    { name: "Provisions", color: "#93a98c", budget: 450, scope: "personal" },
    { name: "Apothecary", color: "#8b6a95", budget: 120, scope: "personal" },
    { name: "Travel", color: "#7f98a8", budget: 150, scope: "personal" },
    { name: "Indulgences", color: "#c07a80", budget: 200, scope: "personal" },
    { name: "Studio Supplies", color: "#b48a5a", budget: 300, scope: "business" },
    { name: "Software & Tools", color: "#6f8f9a", budget: 80, scope: "business" },
    { name: "Marketing", color: "#a07fa8", budget: 100, scope: "business" },
  ];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => new Date().toISOString();
  const COLLECTIONS = ["categories", "transactions", "appointments", "clients", "tasks"];
  // a record's last change; older data without timestamps counts as oldest
  const stamp = (r) => r.updatedAt || r.createdAt || "";

  function blank() {
    return {
      version: 1,
      settings: { currency: "USD", ownerName: "", weekStart: 0 },
      // fixed ids so every device starts with the same default categories
      categories: DEFAULT_CATEGORIES.map((c, i) => ({ id: `default-${i}`, ...c })),
      transactions: [],
      appointments: [],
      clients: [],
      tasks: [],
      deleted: [], // tombstones { c: collection, id, at } so deletions sync too
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn("Could not read saved data; starting fresh.", e);
      return blank();
    }
  }

  function normalize(d) {
    const base = blank();
    if (!d || typeof d !== "object") return base;
    return {
      version: 1,
      settings: { ...base.settings, ...(d.settings || {}) },
      categories: Array.isArray(d.categories) ? d.categories : base.categories,
      transactions: Array.isArray(d.transactions) ? d.transactions : [],
      appointments: Array.isArray(d.appointments) ? d.appointments : [],
      clients: Array.isArray(d.clients) ? d.clients : [],
      tasks: Array.isArray(d.tasks) ? d.tasks : [],
      deleted: Array.isArray(d.deleted) ? d.deleted : [],
    };
  }

  let data = load();
  const listeners = new Set();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Could not save data.", e);
    }
    listeners.forEach((fn) => fn(data));
  }

  /* generic collection helpers */
  function upsert(collection, record) {
    const list = data[collection];
    const at = now();
    if (record.id) {
      const i = list.findIndex((r) => r.id === record.id);
      if (i >= 0) list[i] = { ...list[i], ...record, updatedAt: at };
      else list.push({ ...record, updatedAt: at });
    } else {
      list.push({ ...record, id: uid(), createdAt: at, updatedAt: at });
    }
    save();
  }

  /* drop records (remembering them so other devices drop them too) and clear references to them */
  function dropRecords(collection, ids) {
    const gone = new Set(ids);
    if (!gone.size) return;
    const at = now();
    data[collection] = data[collection].filter((r) => !gone.has(r.id));
    gone.forEach((id) => data.deleted.push({ c: collection, id, at }));
    const unlink = (list, field) => list.forEach((r) => { if (gone.has(r[field])) { r[field] = ""; r.updatedAt = at; } });
    if (collection === "clients") ["appointments", "tasks", "transactions"].forEach((c) => unlink(data[c], "clientId"));
    if (collection === "categories") unlink(data.transactions, "categoryId");
  }

  function remove(collection, id) {
    dropRecords(collection, [id]);
    save();
  }

  function removeWhere(collection, pred) {
    const ids = data[collection].filter(pred).map((r) => r.id);
    dropRecords(collection, ids);
    save();
    return ids.length;
  }

  function setSettings(patch) {
    Object.assign(data.settings, patch, { updatedAt: now() });
    save();
  }

  /* fold another copy of the data (e.g. from another device) into this one.
     Per record, the most recently changed version wins; deletions win over older edits. */
  function mergeFrom(remoteRaw) {
    const remote = normalize(remoteRaw);
    const before = JSON.stringify(data);

    const tombs = new Map();
    [...data.deleted, ...remote.deleted].forEach((t) => {
      const k = `${t.c}|${t.id}`;
      if (!tombs.has(k) || t.at > tombs.get(k).at) tombs.set(k, t);
    });

    COLLECTIONS.forEach((c) => {
      const byId = new Map(data[c].map((r) => [r.id, r]));
      remote[c].forEach((r) => {
        const mine = byId.get(r.id);
        if (!mine || stamp(r) > stamp(mine)) byId.set(r.id, r);
      });
      data[c] = [...byId.values()].filter((r) => {
        const t = tombs.get(`${c}|${r.id}`);
        return !t || stamp(r) > t.at;
      });
    });

    if ((remote.settings.updatedAt || "") > (data.settings.updatedAt || "")) data.settings = remote.settings;

    // keep deletions for six months; long enough for any device to catch up
    const cutoff = new Date(Date.now() - 183 * 864e5).toISOString();
    data.deleted = [...tombs.values()].filter((t) => t.at > cutoff);

    dedupeCategories();
    const changed = JSON.stringify(data) !== before;
    if (changed) save();
    return changed;
  }

  /* devices that started separately each made their own default categories; fold same-named ones together */
  function dedupeCategories() {
    const groups = {};
    data.categories.forEach((c) => (groups[`${c.scope}|${c.name.trim().toLowerCase()}`] ||= []).push(c));
    Object.values(groups).filter((g) => g.length > 1).forEach((g) => {
      // the same choice on every device: the smallest id survives, with the latest edits
      g.sort((a, b) => a.id.localeCompare(b.id));
      const keep = g[0];
      const newest = g.reduce((a, b) => (stamp(b) > stamp(a) ? b : a));
      Object.assign(keep, { ...newest, id: keep.id });
      const drop = new Set(g.slice(1).map((c) => c.id));
      const at = now();
      data.transactions.forEach((t) => { if (drop.has(t.categoryId)) { t.categoryId = keep.id; t.updatedAt = at; } });
      data.categories = data.categories.filter((c) => !drop.has(c.id));
      drop.forEach((id) => data.deleted.push({ c: "categories", id, at }));
    });
  }

  /* sample data, relative to today so it always looks current */
  function seedSample() {
    const today = new Date();
    const iso = (offset) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const cat = (name) => (data.categories.find((c) => c.name === name) || {}).id || "";

    const clients = [
      { name: "Morgana Vale", email: "morgana@hollowmoon.co", phone: "555-0113", status: "active", rate: 85, notes: "Copper balayage, sensitive scalp. Prefers late afternoons and chamomile tea." },
      { name: "Elias Thorne", email: "elias@thornebooks.com", phone: "555-0147", status: "active", rate: 120, notes: "Brand shoot for his antiquarian bookshop. Loves candlelit sets." },
      { name: "Wren Ashcombe", email: "wren.ash@mail.com", phone: "555-0178", status: "lead", rate: 0, notes: "Asked about bridal styling for a Samhain wedding." },
      { name: "Ondine Blackwood", email: "ondine@blackwood.studio", phone: "", status: "past", rate: 95, notes: "Editorial work last spring. Send a holiday card." },
    ].map((c) => ({ ...c, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    data.clients.push(...clients);
    const [morgana, elias, wren] = clients;

    const tx = [
      { type: "income", amount: 340, date: iso(-12), description: "Color & cut", scope: "business", clientId: morgana.id },
      { type: "income", amount: 960, date: iso(-6), description: "Brand shoot, half day", scope: "business", clientId: elias.id },
      { type: "income", amount: 180, date: iso(-2), description: "Styling session", scope: "business", clientId: morgana.id },
      { type: "expense", amount: 1250, date: iso(-20), description: "Rent", scope: "personal", categoryId: cat("Hearth & Home") },
      { type: "expense", amount: 86.4, date: iso(-9), description: "Market haul", scope: "personal", categoryId: cat("Provisions") },
      { type: "expense", amount: 42.15, date: iso(-4), description: "Bakery & tea", scope: "personal", categoryId: cat("Provisions") },
      { type: "expense", amount: 38, date: iso(-7), description: "Herbal tinctures", scope: "personal", categoryId: cat("Apothecary") },
      { type: "expense", amount: 64, date: iso(-3), description: "Vintage tarot deck", scope: "personal", categoryId: cat("Indulgences") },
      { type: "expense", amount: 212.5, date: iso(-11), description: "Color stock & foils", scope: "business", categoryId: cat("Studio Supplies") },
      { type: "expense", amount: 29.99, date: iso(-15), description: "Booking software", scope: "business", categoryId: cat("Software & Tools") },
      { type: "expense", amount: 55, date: iso(-1), description: "Printed cards, wax seals", scope: "business", categoryId: cat("Marketing") },
    ].map((t) => ({ categoryId: "", clientId: "", ...t, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    data.transactions.push(...tx);

    const appts = [
      { title: "Root touch-up", date: iso(1), start: "15:00", end: "17:00", clientId: morgana.id, location: "Studio", notes: "" },
      { title: "Bridal consult", date: iso(3), start: "11:00", end: "12:00", clientId: wren.id, location: "Café Nocturne", notes: "Bring the lookbook." },
      { title: "Shoot: the reading room", date: iso(6), start: "18:30", end: "21:00", clientId: elias.id, location: "Thorne Books", notes: "Golden hour into candlelight." },
      { title: "Supply run", date: iso(2), start: "10:00", end: "11:00", clientId: "", location: "", notes: "" },
      { title: "Tea with the coven", date: iso(-1), start: "19:00", end: "21:00", clientId: "", location: "Home", notes: "" },
    ].map((a) => ({ ...a, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    data.appointments.push(...appts);

    const tasks = [
      { title: "Send Elias the shoot moodboard", due: iso(0), priority: "high", scope: "business", clientId: elias.id },
      { title: "Reorder foils & developer", due: iso(1), priority: "normal", scope: "business", clientId: "" },
      { title: "Follow up with Wren about the Samhain date", due: iso(-1), priority: "high", scope: "business", clientId: wren.id },
      { title: "Return library books", due: iso(4), priority: "low", scope: "personal", clientId: "" },
      { title: "Update portfolio with autumn work", due: "", priority: "normal", scope: "business", clientId: "" },
      { title: "Repot the moonflower", due: "", priority: "low", scope: "personal", clientId: "" },
      { title: "Invoice Morgana for the styling session", due: iso(-2), priority: "normal", scope: "business", clientId: morgana.id, done: true, doneAt: new Date().toISOString() },
    ].map((t) => ({ notes: "", done: false, doneAt: "", ...t, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    data.tasks.push(...tasks);
    save();
  }

  window.Store = {
    get data() { return data; },
    uid,
    save,
    upsert,
    remove,
    removeWhere,
    setSettings,
    mergeFrom,
    seedSample,
    onChange: (fn) => listeners.add(fn),
    /* add many entries (and any new categories), and patch existing ones, with a single save */
    bulkAdd(transactions, categories = [], updates = []) {
      const at = now();
      data.categories.push(...categories.map((c) => ({ ...c, createdAt: at, updatedAt: at })));
      updates.forEach(({ id, fields }) => {
        const t = data.transactions.find((x) => x.id === id);
        if (t) Object.assign(t, fields, { updatedAt: at });
      });
      data.transactions.push(...transactions.map((t) => ({ categoryId: "", clientId: "", notes: "", ...t, id: uid(), createdAt: at, updatedAt: at })));
      save();
    },
    exportJSON: () => JSON.stringify(data, null, 2),
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.transactions)) throw new Error("Not a 3rd Iris backup");
      data = normalize(parsed);
      save();
    },
    reset() { data = blank(); save(); },
  };
})();
