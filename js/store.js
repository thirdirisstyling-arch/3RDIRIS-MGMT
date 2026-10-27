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

  function blank() {
    return {
      version: 1,
      settings: { currency: "USD", ownerName: "", weekStart: 0 },
      categories: DEFAULT_CATEGORIES.map((c) => ({ id: uid(), ...c })),
      transactions: [],
      appointments: [],
      clients: [],
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
    if (record.id) {
      const i = list.findIndex((r) => r.id === record.id);
      if (i >= 0) list[i] = { ...list[i], ...record };
      else list.push(record);
    } else {
      list.push({ ...record, id: uid(), createdAt: new Date().toISOString() });
    }
    save();
  }

  function remove(collection, id) {
    data[collection] = data[collection].filter((r) => r.id !== id);
    if (collection === "clients") {
      data.appointments.forEach((a) => { if (a.clientId === id) a.clientId = ""; });
      data.transactions.forEach((t) => { if (t.clientId === id) t.clientId = ""; });
    }
    if (collection === "categories") {
      data.transactions.forEach((t) => { if (t.categoryId === id) t.categoryId = ""; });
    }
    save();
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
    ].map((c) => ({ ...c, id: uid(), createdAt: new Date().toISOString() }));
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
    ].map((t) => ({ categoryId: "", clientId: "", ...t, id: uid(), createdAt: new Date().toISOString() }));
    data.transactions.push(...tx);

    const appts = [
      { title: "Root touch-up", date: iso(1), start: "15:00", end: "17:00", clientId: morgana.id, location: "Studio", notes: "" },
      { title: "Bridal consult", date: iso(3), start: "11:00", end: "12:00", clientId: wren.id, location: "Café Nocturne", notes: "Bring the lookbook." },
      { title: "Shoot: the reading room", date: iso(6), start: "18:30", end: "21:00", clientId: elias.id, location: "Thorne Books", notes: "Golden hour into candlelight." },
      { title: "Supply run", date: iso(2), start: "10:00", end: "11:00", clientId: "", location: "", notes: "" },
      { title: "Tea with the coven", date: iso(-1), start: "19:00", end: "21:00", clientId: "", location: "Home", notes: "" },
    ].map((a) => ({ ...a, id: uid(), createdAt: new Date().toISOString() }));
    data.appointments.push(...appts);
    save();
  }

  window.Store = {
    get data() { return data; },
    uid,
    save,
    upsert,
    remove,
    seedSample,
    onChange: (fn) => listeners.add(fn),
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
