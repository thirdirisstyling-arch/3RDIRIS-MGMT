/* 3rd Iris · Grimoire — views, forms and routing. */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const D = () => Store.data;

  /* ── formatting helpers ─────────────────────── */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => ymd(new Date());
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const inMonth = (dateStr, key) => typeof dateStr === "string" && dateStr.startsWith(key);
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthLabel = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  function money(n) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: D().settings.currency || "USD" }).format(n || 0);
    } catch {
      return "$" + (n || 0).toFixed(2);
    }
  }
  function fmtDate(s, opts = { weekday: "short", month: "short", day: "numeric" }) {
    if (!s) return "";
    return parseYmd(s).toLocaleDateString(undefined, opts);
  }
  function fmtTime(t) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const dateChip = (s) => {
    const d = parseYmd(s);
    return `<div class="date-chip"><span class="m">${MONTHS[d.getMonth()].slice(0, 3)}</span><span class="d">${d.getDate()}</span></div>`;
  };
  const stepDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const relDay = (s) => {
    const diff = Math.round((parseYmd(s) - parseYmd(todayStr())) / 864e5);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff === -1) return "yesterday";
    return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
  };

  /* ── frequency & recurrence ─────────────────── */
  const FREQUENCIES = [
    ["one-time", "One-time"], ["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["semimonthly", "Twice a month"],
    ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"],
  ];
  const freqLabel = (f) => (FREQUENCIES.find(([k]) => k === f) || [, ""])[1];
  const isRecurring = (f) => !!f && f !== "one-time";
  const lastOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  function stepDate(s, freq, n = 1) {
    const d = parseYmd(s);
    if (freq === "weekly") d.setDate(d.getDate() + 7 * n);
    else if (freq === "biweekly") d.setDate(d.getDate() + 14 * n);
    else {
      const months = { monthly: 1, quarterly: 3, annual: 12 }[freq] * n;
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + months);
      // the 31st in a 30-day month lands on the 30th, not the 1st of the next
      d.setDate(Math.min(day, lastOfMonth(d.getFullYear(), d.getMonth())));
    }
    return ymd(d);
  }

  /* the days of the month a twice-monthly entry falls on; without saved days, its own day and ~15 days apart */
  function payDays(t) {
    const saved = (t.days || []).map(Number).filter((n) => n >= 1 && n <= 31);
    if (saved.length) return [...new Set(saved)].sort((a, b) => a - b);
    const d = parseYmd(t.date).getDate();
    return d <= 15 ? [d, d + 15] : [d - 15, d];
  }
  const parseDays = (text) => [...new Set(String(text || "").split(/[^\d]+/).map(Number).filter((n) => n >= 1 && n <= 31))].sort((a, b) => a - b);

  /* scheduled dates after an entry's own date, up to `to` (inclusive) */
  function occurrencesAfter(t, to) {
    const out = [];
    if (t.frequency === "semimonthly") {
      const days = payDays(t);
      const d0 = parseYmd(t.date);
      for (let i = 0; i < 400; i++) {
        const y = d0.getFullYear(), m = d0.getMonth() + i;
        const yy = new Date(y, m, 1).getFullYear(), mm = new Date(y, m, 1).getMonth();
        if (ymd(new Date(yy, mm, 1)) > to) break;
        for (const day of days) {
          const s = ymd(new Date(yy, mm, Math.min(day, lastOfMonth(yy, mm))));
          if (s > t.date && s <= to) out.push(s);
        }
      }
      return [...new Set(out)];
    }
    for (let n = 1; n < 1000; n++) {
      const s = stepDate(t.date, t.frequency, n);
      if (s > to) break;
      out.push(s);
    }
    return out;
  }

  /* entries with the same kind and description form a series; its latest entry sets the schedule */
  const seriesKey = (t) => `${t.type}|${(t.description || "").trim().toLowerCase()}`;
  function latestBySeries() {
    const latest = {};
    D().transactions.forEach((t) => {
      const k = seriesKey(t), cur = latest[k];
      if (!cur || t.date > cur.date || (t.date === cur.date && (t.createdAt || "") > (cur.createdAt || ""))) latest[k] = t;
    });
    return latest;
  }

  /* projected copies of recurring series between from and to (inclusive) */
  function expectedEntries(from, to) {
    const out = [];
    Object.values(latestBySeries()).filter((t) => isRecurring(t.frequency)).forEach((t) => {
      occurrencesAfter(t, to).filter((d) => d >= from).forEach((date) => out.push({ source: t, date }));
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* when an entry is next due: a recurring series' next unrecorded date, or a one-time entry's due date */
  function nextDueOf(t, latest = latestBySeries()) {
    if (!isRecurring(t.frequency)) return t.dueDate || "";
    if (latest[seriesKey(t)] !== t) return "";
    const horizon = stepDate(t.date, "annual", 2);
    return occurrencesAfter(t, horizon)[0] || "";
  }

  function logExpected(e) {
    const t = e.source;
    editTransaction({
      type: t.type, description: t.description, amount: t.amount, scope: t.scope, categoryId: t.categoryId,
      clientId: t.clientId, frequency: t.frequency, days: t.days, date: e.date,
    });
  }

  function dueLabel(s, { next = false } = {}) {
    if (!s) return "";
    const diff = Math.round((parseYmd(s) - parseYmd(todayStr())) / 864e5);
    const word = next ? "next" : "due";
    if (diff < 0 && next) return `past due · ${fmtDate(s, { month: "short", day: "numeric" })}`;
    if (diff === 0) return `${word} today`;
    if (diff === 1) return `${word} tomorrow`;
    if (diff > 1 && diff <= 14) return `${word} in ${diff} days`;
    return `${word} ${fmtDate(s, { month: "short", day: "numeric" })}`;
  }
  const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  const dueClass = (s) => (!s ? "" : s < todayStr() ? "neg" : s <= stepDays(todayStr(), 14) ? "gold" : "");

  /* small per-browser view preferences */
  const PREFS_KEY = "3rdiris.prefs";
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

  const clientById = (id) => D().clients.find((c) => c.id === id);
  const catById = (id) => D().categories.find((c) => c.id === id);
  const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  /* ── moon phase (simple synodic approximation) ── */
  function moonPhase(date = new Date()) {
    const synodic = 29.53058867;
    const known = Date.UTC(2000, 0, 6, 18, 14);
    const age = (((date.getTime() - known) / 864e5) % synodic + synodic) % synodic;
    const phases = [
      ["New Moon", "Set intentions; begin quietly."],
      ["Waxing Crescent", "Plant seeds; send the first emails."],
      ["First Quarter", "Act decisively; push the work forward."],
      ["Waxing Gibbous", "Refine, edit, polish."],
      ["Full Moon", "Celebrate, invoice, take stock."],
      ["Waning Gibbous", "Share gratitude; follow up with clients."],
      ["Last Quarter", "Release what isn't working."],
      ["Waning Crescent", "Rest, reread, restore."],
    ];
    const idx = Math.floor(((age + synodic / 16) / synodic) * 8) % 8;
    return { name: phases[idx][0], hint: phases[idx][1], age, svg: moonSVG(age / synodic) };
  }

  // bone-coloured moon drawn from the phase fraction (0 new → .5 full → 1 new)
  function moonSVG(f, r = 18) {
    const lit = (1 - Math.cos(2 * Math.PI * f)) / 2;
    const rx = Math.abs(1 - 2 * lit) * r;
    const sweep = lit > 0.5 ? 1 : 0;
    const flip = f > 0.5 ? ` transform="scale(-1 1)"` : "";
    return `<svg width="${r * 2 + 8}" height="${r * 2 + 8}" viewBox="${-r - 4} ${-r - 4} ${r * 2 + 8} ${r * 2 + 8}" aria-hidden="true">
      <circle r="${r + 3}" fill="none" stroke="#8a7547" stroke-width=".6" stroke-dasharray="1 3"/>
      <circle r="${r}" fill="#26212c" stroke="#3a3340"/>
      <path${flip} d="M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx} ${r} 0 0 ${sweep} 0 ${-r}Z" fill="#ece4d4" style="filter:drop-shadow(0 0 6px rgba(236,228,212,.35))"/>
    </svg>`;
  }

  const QUOTES = [
    ["A room without books is like a body without a soul.", "Cicero"],
    ["I have always imagined that Paradise will be a kind of library.", "Jorge Luis Borges"],
    ["We are such stuff as dreams are made on.", "Shakespeare, The Tempest"],
    ["Hope is the thing with feathers that perches in the soul.", "Emily Dickinson"],
    ["The world is full of magic things, patiently waiting for our senses to grow sharper.", "W. B. Yeats"],
    ["One must still have chaos in oneself to be able to give birth to a dancing star.", "Nietzsche"],
    ["Beware; for I am fearless, and therefore powerful.", "Mary Shelley, Frankenstein"],
    ["Take care of the pence and the pounds will take care of themselves.", "Old proverb"],
  ];

  /* ── toast ─────────────────────────────────── */
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  /* ── modal forms ───────────────────────────── */
  const modal = $("#modal");
  let modalSubmit = null;

  function fieldHTML(f, value) {
    const v = value ?? f.default ?? "";
    const cls = `field${f.span2 ? " span-2" : ""}`;
    const req = f.required ? "required" : "";
    const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : "";
    if (f.type === "select") {
      const opts = f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`).join("");
      return `<label class="${cls}">${esc(f.label)}<select name="${f.name}" ${req}>${opts}</select></label>`;
    }
    if (f.type === "segmented") {
      const btns = f.options.map((o) => `<button type="button" data-value="${esc(o.value)}" class="${o.value === v ? "on" : ""}">${esc(o.label)}</button>`).join("");
      return `<div class="${cls}"><label class="field">${esc(f.label)}</label><div class="segmented" data-name="${f.name}">${btns}</div><input type="hidden" name="${f.name}" value="${esc(v)}"></div>`;
    }
    if (f.type === "textarea") {
      return `<label class="${cls}">${esc(f.label)}<textarea name="${f.name}" ${ph}>${esc(v)}</textarea></label>`;
    }
    const extra = f.type === "number" ? `step="${f.step || "0.01"}" min="${f.min ?? 0}" inputmode="decimal"` : "";
    return `<label class="${cls}">${esc(f.label)}<input type="${f.type || "text"}" name="${f.name}" value="${esc(v)}" ${ph} ${req} ${extra}></label>`;
  }

  /**
   * openForm({ title, fields, values, submitLabel, onSubmit(values) -> string|void, onDelete })
   * onSubmit may return an error message to keep the dialog open.
   */
  function openForm({ title, fields, values = {}, submitLabel = "Inscribe", onSubmit, onDelete, onChange }) {
    modal.classList.remove("wide");
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = `<div class="form-grid">${fields.map((f) => fieldHTML(f, values[f.name])).join("")}</div><p class="form-error" id="formError"></p>`;
    $("#modalFoot").innerHTML =
      (onDelete ? `<button type="button" class="btn danger" data-delete>Banish</button>` : "") +
      `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel)}</button>`;

    $$(".segmented", modal).forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        $$("button", seg).forEach((x) => x.classList.toggle("on", x === b));
        $(`input[name="${seg.dataset.name}"]`, modal).value = b.dataset.value;
        onChange && onChange(collect(fields), modal);
      });
    });
    // assigned (not added) so listeners don't pile up across opens
    $("#modalBody").oninput = onChange ? () => onChange(collect(fields), modal) : null;
    if (onChange) onChange(collect(fields), modal);

    modalSubmit = () => {
      const vals = collect(fields);
      for (const f of fields) {
        if (f.required && (vals[f.name] === "" || vals[f.name] == null || (f.type === "number" && isNaN(vals[f.name])))) {
          $("#formError").textContent = `${f.label} is required.`;
          return false;
        }
      }
      const err = onSubmit(vals);
      if (err) { $("#formError").textContent = err; return false; }
      return true;
    };
    const del = $("[data-delete]", modal);
    if (del) {
      del.addEventListener("click", () => {
        if (del.dataset.armed) { onDelete(); modal.close(); return; }
        del.dataset.armed = "1";
        del.textContent = "Truly banish?";
      });
    }
    modal.showModal();
    const first = $("input:not([type=hidden]), select, textarea", modal);
    if (first) first.focus();
  }

  function collect(fields) {
    const out = {};
    fields.forEach((f) => {
      const el = $(`[name="${f.name}"]`, modal);
      if (!el) return;
      out[f.name] = f.type === "number" ? (el.value === "" ? "" : parseFloat(el.value)) : el.value.trim();
    });
    return out;
  }

  $("#modalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (modalSubmit && modalSubmit()) modal.close();
  });
  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) modal.close();
    else if (e.target === modal) modal.close(); // backdrop click
  });

  /* ── record forms ──────────────────────────── */
  const clientOptions = (blankLabel = "— none —") => [{ value: "", label: blankLabel }, ...D().clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))];
  const categoryOptions = () => [{ value: "", label: "— uncategorized —" }, ...D().categories.map((c) => ({ value: c.id, label: `${c.name} · ${c.scope}` }))];

  function editTransaction(tx = {}) {
    const isNew = !tx.id;
    openForm({
      title: isNew ? (tx.type === "income" ? "Record Income" : "Record Expense") : "Amend Entry",
      values: { type: "expense", date: todayStr(), scope: "personal", frequency: "one-time", ...tx, days: (tx.days || []).join(", ") },
      fields: [
        { name: "type", label: "Kind", type: "segmented", options: [{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }], span2: true },
        { name: "description", label: "Description", required: true, placeholder: "e.g. beeswax candles", span2: true },
        { name: "amount", label: "Amount", type: "number", required: true, placeholder: "0.00" },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "scope", label: "Purse", type: "segmented", options: [{ value: "personal", label: "Personal" }, { value: "business", label: "Business" }] },
        { name: "categoryId", label: "Category", type: "select", options: categoryOptions() },
        { name: "frequency", label: "Frequency", type: "select", options: FREQUENCIES.map(([value, label]) => ({ value, label })) },
        { name: "dueDate", label: "Due date", type: "date" },
        { name: "days", label: "Days of the month", placeholder: "e.g. 3, 16" },
        { name: "clientId", label: "Client", type: "select", options: clientOptions(), span2: true },
        { name: "notes", label: "Notes", type: "textarea", span2: true },
      ],
      onChange: (v, root) => {
        // income doesn't need a budget category
        $('[name="categoryId"]', root).closest("label").style.display = v.type === "income" ? "none" : "";
        // recurring entries are scheduled from their date, so a fixed due date only applies to one-time entries
        const recurring = isRecurring(v.frequency);
        $('[name="dueDate"]', root).closest("label").style.display = recurring ? "none" : "";
        $('[name="days"]', root).closest("label").style.display = v.frequency === "semimonthly" ? "" : "none";
        let hint = $("#nextDueHint", root);
        if (!hint) {
          hint = document.createElement("p");
          hint.id = "nextDueHint";
          hint.className = "form-hint";
          $('[name="days"]', root).closest("label").after(hint);
        }
        const next = recurring && v.date ? occurrencesAfter({ date: v.date, frequency: v.frequency, days: parseDays(v.days) }, stepDate(v.date, "annual", 2))[0] : "";
        hint.style.display = next ? "" : "none";
        hint.innerHTML = next ? `↻ Next due <b>${esc(fmtDate(next, { weekday: "short", month: "long", day: "numeric" }))}</b>${v.frequency === "semimonthly" ? ` · on the ${esc(payDays({ date: v.date, days: parseDays(v.days) }).map(ordinal).join(" & "))}` : ""}` : "";
      },
      onSubmit: (v) => {
        if (!(v.amount > 0)) return "Amount must be more than zero.";
        if (v.type === "income") v.categoryId = "";
        const days = parseDays(v.days);
        if (v.frequency === "semimonthly" && v.days && days.length < 2) return "Give two days of the month, like 3, 16.";
        v.days = v.frequency === "semimonthly" ? (days.length ? days : payDays({ date: v.date })) : [];
        if (isRecurring(v.frequency)) v.dueDate = "";
        Store.upsert("transactions", { ...tx, ...v, amount: Math.round(v.amount * 100) / 100 });
        toast(isNew ? "Inscribed in the ledger." : "Entry amended.");
      },
      onDelete: isNew ? null : () => { Store.remove("transactions", tx.id); toast("Entry banished."); },
    });
  }

  function editAppointment(ap = {}) {
    const isNew = !ap.id;
    openForm({
      title: isNew ? "Summon an Appointment" : "Amend Appointment",
      values: { date: todayStr(), start: "10:00", end: "11:00", ...ap },
      fields: [
        { name: "title", label: "What", required: true, placeholder: "e.g. consultation", span2: true },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "clientId", label: "Client", type: "select", options: clientOptions() },
        { name: "start", label: "Begins", type: "time" },
        { name: "end", label: "Ends", type: "time" },
        { name: "location", label: "Where", placeholder: "Studio, online, the old library…", span2: true },
        { name: "notes", label: "Notes", type: "textarea", span2: true },
      ],
      onSubmit: (v) => {
        if (v.start && v.end && v.end < v.start) return "It must end after it begins.";
        Store.upsert("appointments", { ...ap, ...v });
        toast(isNew ? "Written into the almanac." : "Appointment amended.");
      },
      onDelete: isNew ? null : () => { Store.remove("appointments", ap.id); toast("Appointment banished."); },
    });
  }

  function editClient(c = {}) {
    const isNew = !c.id;
    openForm({
      title: isNew ? "New Client" : "Amend Client",
      values: { status: "active", ...c },
      fields: [
        { name: "name", label: "Name", required: true, span2: true },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Phone", type: "tel" },
        { name: "status", label: "Standing", type: "segmented", options: [{ value: "lead", label: "Lead" }, { value: "active", label: "Active" }, { value: "past", label: "Past" }] },
        { name: "rate", label: "Usual rate", type: "number", placeholder: "per session" },
        { name: "notes", label: "Notes & preferences", type: "textarea", span2: true },
      ],
      onSubmit: (v) => {
        Store.upsert("clients", { ...c, ...v, rate: v.rate === "" ? 0 : v.rate });
        toast(isNew ? "Added to the codex." : "Client amended.");
      },
      onDelete: isNew ? null : () => { Store.remove("clients", c.id); toast("Client removed from the codex."); },
    });
  }

  const PRIORITIES = [["high", "High"], ["normal", "Normal"], ["low", "Low"]];

  function editTask(task = {}) {
    const isNew = !task.id;
    openForm({
      title: isNew ? "New Task" : "Amend Task",
      values: { priority: "normal", scope: "personal", ...task },
      fields: [
        { name: "title", label: "What needs doing", required: true, placeholder: "e.g. send the invoice", span2: true },
        { name: "due", label: "Due", type: "date" },
        { name: "priority", label: "Priority", type: "select", options: PRIORITIES.map(([value, label]) => ({ value, label })) },
        { name: "scope", label: "Purse", type: "segmented", options: [{ value: "personal", label: "Personal" }, { value: "business", label: "Business" }] },
        { name: "clientId", label: "Client", type: "select", options: clientOptions() },
        { name: "notes", label: "Notes", type: "textarea", span2: true },
      ],
      onSubmit: (v) => {
        Store.upsert("tasks", { done: false, doneAt: "", ...task, ...v });
        toast(isNew ? "Added to the agenda." : "Task amended.");
      },
      onDelete: isNew ? null : () => { Store.remove("tasks", task.id); toast("Task banished."); },
    });
  }

  function toggleTask(id) {
    const t = D().tasks.find((x) => x.id === id);
    if (!t) return;
    Store.upsert("tasks", { id, done: !t.done, doneAt: t.done ? "" : new Date().toISOString() });
    toast(t.done ? "Back on the agenda." : "Done. ✦");
  }

  /* open tasks, soonest first: by due date (undated last), then priority, then when added */
  const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
  const byTaskOrder = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || (a.createdAt || "").localeCompare(b.createdAt || "");
  const pressingTasks = () => D().tasks.filter((t) => !t.done && t.due && t.due <= todayStr()).sort(byTaskOrder);

  function taskLi(t) {
    const cl = clientById(t.clientId);
    const today = todayStr();
    const when = t.done ? (t.doneAt ? `done ${esc(fmtDate(ymd(new Date(t.doneAt)), { month: "short", day: "numeric" }))}` : "done") : !t.due ? "" : t.due < today ? `<span class="neg">overdue · ${esc(fmtDate(t.due, { month: "short", day: "numeric" }))}</span>` : t.due === today ? `<span class="gold">today</span>` : esc(relDay(t.due) === "tomorrow" ? "tomorrow" : fmtDate(t.due));
    const meta = [when, cl ? esc(cl.name) : "", t.notes ? `<i>${esc(t.notes.length > 70 ? t.notes.slice(0, 70) + "…" : t.notes)}</i>` : ""].filter(Boolean).join(" · ");
    return `<li class="task ${t.done ? "done" : ""} prio-${esc(t.priority || "normal")}" data-task="${t.id}">
      <button class="check-btn" data-toggle-task="${t.id}" role="checkbox" aria-checked="${t.done ? "true" : "false"}" aria-label="${t.done ? "Mark not done" : "Mark done"}: ${esc(t.title)}"><span>✦</span></button>
      <div class="grow"><span class="title">${t.priority === "high" ? `<span class="prio" title="High priority">❖</span> ` : ""}${esc(t.title)}</span>${meta ? `<span class="meta">${meta}</span>` : ""}</div>
      <span class="tag ${t.scope === "business" ? "biz" : ""} hide-sm">${esc(t.scope || "personal")}</span>
    </li>`;
  }

  function editCategory(cat = {}) {
    const isNew = !cat.id;
    openForm({
      title: isNew ? "New Category" : "Amend Category",
      values: { scope: "personal", color: "#c3a568", ...cat },
      fields: [
        { name: "name", label: "Name", required: true, span2: true },
        { name: "budget", label: "Monthly budget", type: "number", placeholder: "0 for none" },
        { name: "color", label: "Colour", type: "color" },
        { name: "scope", label: "Purse", type: "segmented", options: [{ value: "personal", label: "Personal" }, { value: "business", label: "Business" }], span2: true },
      ],
      onSubmit: (v) => {
        Store.upsert("categories", { ...cat, ...v, budget: v.budget === "" ? 0 : v.budget });
        toast(isNew ? "Category added." : "Category amended.");
      },
      onDelete: isNew ? null : () => { Store.remove("categories", cat.id); toast("Category removed. Its entries are now uncategorized."); },
    });
  }

  /* ── bulk import ───────────────────────────── */
  const NEW_CAT_COLORS = ["#b48a5a", "#7f98a8", "#a07fa8", "#93a98c", "#c07a80", "#6f8f9a", "#c3a568", "#8b6a95"];
  let importDraft = { text: "", scope: "personal", yearlessAsDue: false };

  function openImport() {
    modal.classList.add("wide");
    $("#modalTitle").textContent = "Bulk Import";
    $("#modalBody").oninput = null;
    importStep1();
    modal.showModal();
    $(".import-text", modal).focus();
  }

  function importStep1() {
    $("#modalBody").innerHTML = `
      <p class="import-help">Paste rows copied from a spreadsheet, or choose a CSV file. Each row needs a <b>date</b>, a <b>description</b> and an <b>amount</b>.
        A column saying <code>Income</code> or <code>Expense</code> sets the kind, the column after it is read as the category, and words like <code>Monthly</code> or <code>Annual</code> set the frequency.
        Anything else (account, status) is kept in the notes. A header row such as <code>date,description,amount,category,frequency,due</code> also works.</p>
      <textarea class="import-text" spellcheck="false" placeholder="2026-10-07&#9;Canva Pro&#9;Expense&#9;Subscriptions&#9;$15.00">${esc(importDraft.text)}</textarea>
      <div class="toolbar" style="margin:12px 0 0">
        <label class="btn ghost sm" style="display:inline-block">Choose file…<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" id="importCsv" hidden></label>
        <label class="check"><input type="checkbox" id="importYearless" ${importDraft.yearlessAsDue ? "checked" : ""}> Read a date without a year (like <code>10/6</code>) as the due date</label>
        <span class="spacer"></span>
        <span style="color:var(--ash);font-family:var(--font-sc);font-size:15px">Purse</span>
        <div class="segmented" id="importScope">${["personal", "business"].map((v) => `<button type="button" data-value="${v}" class="${importDraft.scope === v ? "on" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
      </div>
      <p class="form-error" id="formError"></p>`;
    $("#modalFoot").innerHTML = `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Preview</button>`;
    const ta = $(".import-text", modal);
    ta.addEventListener("input", () => (importDraft.text = ta.value));
    $("#importYearless", modal).addEventListener("change", (e) => (importDraft.yearlessAsDue = e.target.checked));
    $("#importCsv", modal).addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (f) { ta.value = importDraft.text = await f.text(); }
    });
    $("#importScope", modal).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      importDraft.scope = b.dataset.value;
      $$("#importScope button", modal).forEach((x) => x.classList.toggle("on", x === b));
    });
    modalSubmit = () => {
      const rows = Importer.parse(importDraft.text, { yearlessAsDue: importDraft.yearlessAsDue })
        // oldest first; unreadable rows (no date) at the end
        .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
      if (!rows.length) { $("#formError").textContent = "Paste some rows first."; return false; }
      importStep2(rows);
      return false;
    };
  }

  function importStep2(rows) {
    const catByName = (n) => D().categories.find((c) => c.name.toLowerCase() === n.toLowerCase());
    const clientByName = (n) => D().clients.find((c) => c.name.toLowerCase() === n.toLowerCase());
    const key = (t) => [t.date, t.type, Math.round(t.amount * 100), (t.description || "").trim().toLowerCase()].join("|");
    const existing = new Map(D().transactions.map((t) => [key(t), t]));

    rows.forEach((r) => {
      r.scope = r.scope || importDraft.scope;
      const match = r.ok ? existing.get(key(r)) : null;
      r.duplicate = !!match;
      // a re-imported row can still fill in a frequency or due date the existing entry lacks
      r.update = null;
      if (match) {
        const fields = {};
        if (r.frequency && !match.frequency) fields.frequency = r.frequency;
        if (r.dueDate && !match.dueDate) fields.dueDate = r.dueDate;
        if (Object.keys(fields).length) r.update = { id: match.id, fields };
      }
      r.include = r.ok && (!r.duplicate || !!r.update);
      // income has no budget category; keep any label it carried as a note
      r.newCat = !r.duplicate && r.type === "expense" && r.category && !catByName(r.category);
    });
    const newCats = [...new Set(rows.filter((r) => r.newCat).map((r) => r.category.trim()))];

    const render = () => {
      const chosen = rows.filter((r) => r.include);
      const inc = chosen.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
      const exp = chosen.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
      const dupes = rows.filter((r) => r.duplicate).length, bad = rows.filter((r) => !r.ok).length;
      const updates = chosen.filter((r) => r.update).length;
      $(".import-summary", modal).innerHTML = `
        <span><b>${chosen.length}</b> of ${rows.length} rows selected</span>
        <span class="pos">+${money(inc)} income</span><span>−${money(exp)} expenses</span>
        ${dupes ? `<span class="neg">${dupes} already in the ledger${updates ? `, ${updates} will be filled in` : ""}</span>` : ""}
        ${bad ? `<span class="neg">${bad} unreadable</span>` : ""}
        ${newCats.length ? `<span>New categories: ${newCats.map((n) => `<span class="tag new">${esc(n)}</span>`).join(" ")}</span>` : ""}`;
      $("[data-import-go]", modal).textContent = updates === chosen.length && updates ? `Update ${updates}` : `Import ${chosen.length - updates}${updates ? ` + update ${updates}` : ""}`;
      $("[data-import-go]", modal).disabled = !chosen.length;
    };

    $("#modalBody").innerHTML = `
      <div class="import-summary"></div>
      <div class="import-preview"><table>
        <thead><tr><th><input type="checkbox" id="importAll" aria-label="Select all" style="width:auto"></th><th>Date</th><th>Description</th><th>Category</th><th class="hide-sm">Frequency</th><th class="hide-sm">Due</th><th class="num">Amount</th><th class="hide-sm">Notes</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="${r.include ? "" : "skip"}">
          <td><input type="checkbox" data-row="${i}" ${r.include ? "checked" : ""} ${r.ok ? "" : "disabled"} style="width:auto" aria-label="Include row ${i + 1}"></td>
          <td style="white-space:nowrap">${r.date ? fmtDate(r.date, { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
          <td>${esc(r.description || r.raw.join(" "))}${!r.ok ? ` <span class="tag err">${esc(r.error)}</span>` : r.update ? ` <span class="tag new">adds ${esc(Object.keys(r.update.fields).map((k) => (k === "dueDate" ? "due date" : k)).join(" & "))}</span>` : r.duplicate ? ` <span class="tag dupe">already imported</span>` : ""}</td>
          <td>${r.type === "income" ? `<span class="tag"><span class="dot" style="background:var(--sage)"></span>income</span>` : r.category ? `<span class="tag ${r.newCat ? "new" : ""}">${esc(r.category)}${r.newCat ? " · new" : ""}</span>` : `<small><i>uncategorized</i></small>`}</td>
          <td class="hide-sm">${r.frequency ? esc(freqLabel(r.frequency)) : "<small>—</small>"}</td>
          <td class="hide-sm" style="white-space:nowrap">${r.dueDate ? fmtDate(r.dueDate, { month: "short", day: "numeric" }) : "<small>—</small>"}</td>
          <td class="num ${r.type === "income" ? "pos" : ""}">${r.ok ? (r.type === "income" ? "+" : "−") + money(r.amount) : ""}</td>
          <td class="note hide-sm">${esc([r.type === "income" && r.category && !/^income$/i.test(r.category) ? r.category : "", r.notes].filter(Boolean).join(" · "))}</td>
        </tr>`).join("")}</tbody></table></div>
      <p class="form-error" id="formError"></p>`;
    $("#modalFoot").innerHTML = `<button type="button" class="btn ghost" data-import-back>← Back</button><span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary" data-import-go>Import</button>`;

    const all = $("#importAll", modal);
    const syncAll = () => { const ok = rows.filter((r) => r.ok); all.checked = ok.length > 0 && ok.every((r) => r.include); };
    $(".import-preview tbody", modal).addEventListener("change", (e) => {
      const i = e.target.dataset.row;
      if (i === undefined) return;
      rows[i].include = e.target.checked;
      e.target.closest("tr").classList.toggle("skip", !e.target.checked);
      syncAll(); render();
    });
    all.addEventListener("change", () => {
      rows.forEach((r, i) => {
        if (!r.ok) return;
        r.include = all.checked;
        const cb = $(`[data-row="${i}"]`, modal);
        cb.checked = all.checked;
        cb.closest("tr").classList.toggle("skip", !all.checked);
      });
      render();
    });
    $("[data-import-back]", modal).addEventListener("click", importStep1);
    syncAll(); render();

    modalSubmit = () => {
      const picked = rows.filter((r) => r.include);
      if (!picked.length) return false;
      const updates = picked.filter((r) => r.update).map((r) => r.update);
      const chosen = picked.filter((r) => !r.duplicate);
      const created = {};
      const cats = [];
      chosen.filter((r) => r.newCat).forEach((r) => {
        const name = r.category.trim();
        if (created[name.toLowerCase()]) return;
        const cat = { id: Store.uid(), name, color: NEW_CAT_COLORS[(D().categories.length + cats.length) % NEW_CAT_COLORS.length], budget: 0, scope: r.scope };
        created[name.toLowerCase()] = cat;
        cats.push(cat);
      });
      const txs = chosen.map((r) => {
        const cat = r.type === "expense" && r.category ? catByName(r.category) || created[r.category.trim().toLowerCase()] : null;
        const client = r.client ? clientByName(r.client) : null;
        const notes = [
          r.type === "income" && r.category && !/^income$/i.test(r.category) ? r.category : "",
          r.client && !client ? r.client : "",
          r.notes,
        ].filter(Boolean).join(" · ");
        return {
          type: r.type, amount: r.amount, date: r.date, description: r.description.trim(), scope: r.scope,
          categoryId: cat ? cat.id : "", clientId: client ? client.id : "", frequency: r.frequency || "", dueDate: r.dueDate || "", notes,
        };
      });
      const latest = picked.map((r) => r.date).sort().pop();
      ui.ledgerMonth = new Date(+latest.slice(0, 4), +latest.slice(5, 7) - 1, 1);
      importDraft = { ...importDraft, text: "" };
      Store.bulkAdd(txs, cats, updates);
      if (location.hash !== "#ledger") location.hash = "ledger";
      toast([
        txs.length ? `${txs.length} entries inscribed` : "",
        updates.length ? `${updates.length} updated` : "",
        cats.length ? `${cats.length} new categor${cats.length === 1 ? "y" : "ies"}` : "",
      ].filter(Boolean).join(", ") + ".");
      return true;
    };
  }

  /* ── shared computations ───────────────────── */
  function monthTotals(key) {
    const txs = D().transactions.filter((t) => inMonth(t.date, key));
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const spentBy = {};
    txs.filter((t) => t.type === "expense").forEach((t) => { spentBy[t.categoryId || ""] = (spentBy[t.categoryId || ""] || 0) + t.amount; });
    const budget = D().categories.reduce((s, c) => s + (Number(c.budget) || 0), 0);
    return { txs, income, expense, net: income - expense, spentBy, budget };
  }

  function ring(segments, size = 150) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const r = size / 2 - 12, c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = total
      ? segments.map((s) => {
          const len = (s.value / total) * c;
          const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${esc(s.color)}" stroke-width="14" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(s.label)}: ${money(s.value)}</title></circle>`;
          offset += len;
          return el;
        }).join("")
      : "";
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending by category">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#2a2430" stroke-width="14"/>
      ${arcs}
      <circle cx="${size / 2}" cy="${size / 2}" r="${r - 16}" fill="none" stroke="#3a3340" stroke-dasharray="2 4"/>
      <text x="50%" y="47%" text-anchor="middle" fill="#a39a8c" font-family="IM Fell English SC, serif" font-size="12" letter-spacing="1">SPENT</text>
      <text x="50%" y="61%" text-anchor="middle" fill="#ece4d4" font-family="Cormorant Garamond, serif" font-size="19">${esc(money(total))}</text>
    </svg>`;
  }

  const empty = (sigil, text) => `<div class="empty"><span class="sigil">${sigil}</span>${text}</div>`;

  /* ── views ─────────────────────────────────── */
  const ui = {
    ledgerMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ledgerType: "all",
    ledgerScope: "all",
    ledgerSearch: "",
    ledgerView: prefs.ledgerView === "calendar" ? "calendar" : "list",
    ledgerSort: prefs.ledgerSort && prefs.ledgerSort.key ? prefs.ledgerSort : { key: "date", dir: "desc" },
    ledgerDay: todayStr(),
    ledgerProjected: prefs.ledgerProjected !== false,
    coffersMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    almanacMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    almanacDay: todayStr(),
    codexStatus: "all",
    codexSearch: "",
    agendaScope: "all",
    agendaShowDone: prefs.agendaShowDone === true,
  };

  const views = {};

  views.sanctum = {
    title: "Sanctum",
    actions: () => `<button class="btn" data-act="add-expense">+ Expense</button><button class="btn" data-act="add-appt">+ Appointment</button>`,
    render() {
      const d = D();
      const key = monthKey(new Date());
      const t = monthTotals(key);
      const today = todayStr();
      const upcoming = d.appointments.filter((a) => a.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 6);
      const recent = d.transactions.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 6);
      const left = t.budget - Object.entries(t.spentBy).filter(([k]) => k && catById(k)).reduce((s, [, v]) => s + v, 0);
      const segs = Object.entries(t.spentBy).map(([id, v]) => {
        const c = catById(id);
        return { label: c ? c.name : "Uncategorized", color: c ? c.color : "#6f6774", value: v };
      }).sort((a, b) => b.value - a.value);
      const q = QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length];
      const horizon = stepDays(today, 14);
      const dueSoon = [
        ...d.transactions.filter((t) => !isRecurring(t.frequency) && t.dueDate && t.dueDate >= today && t.dueDate <= horizon).map((t) => ({ t, date: t.dueDate })),
        ...expectedEntries(stepDays(today, -31), horizon).map((e) => ({ t: e.source, date: e.date, expected: true })),
      ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
      const isEmpty = !d.transactions.length && !d.appointments.length && !d.clients.length;
      const name = d.settings.ownerName ? `, ${esc(d.settings.ownerName)}` : "";

      return `
        ${isEmpty ? `
        <div class="card" style="margin-bottom:18px">
          <div class="card-head"><h2>Welcome to the grimoire${name}</h2></div>
          <p class="quote" style="margin-bottom:14px">These pages are blank and waiting. Record an expense, add a client or book an appointment, or summon some sample pages to see how it all fits together.</p>
          <div class="toolbar" style="margin:0">
            <button class="btn primary" data-act="seed">Summon sample data</button>
            <button class="btn" data-act="add-client">+ First client</button>
          </div>
        </div>` : ""}

        <div class="grid cols-4 stats">
          <div class="card stat"><div class="label">Income · ${MONTHS[new Date().getMonth()]}</div><div class="value pos">${money(t.income)}</div><div class="sub">${t.txs.filter((x) => x.type === "income").length} payments received</div></div>
          <div class="card stat"><div class="label">Spent</div><div class="value">${money(t.expense)}</div><div class="sub">${t.txs.filter((x) => x.type === "expense").length} entries</div></div>
          <div class="card stat"><div class="label">Net</div><div class="value ${t.net >= 0 ? "pos" : "neg"}">${money(t.net)}</div><div class="sub">${t.net >= 0 ? "the coffers grow" : "the coffers thin"}</div></div>
          <div class="card stat"><div class="label">Budget remaining</div><div class="value ${left >= 0 ? "gold" : "neg"}">${money(left)}</div><div class="sub">of ${money(t.budget)} allotted</div></div>
        </div>

        <div class="grid split" style="margin-top:18px">
          <div class="card">
            <div class="card-head"><h2>On the horizon</h2><a href="#almanac">full almanac →</a></div>
            ${upcoming.length ? `<ul class="list">${upcoming.map((a) => {
              const c = clientById(a.clientId);
              return `<li data-appt="${a.id}" style="cursor:pointer">${dateChip(a.date)}<div class="grow"><span class="title">${esc(a.title)}</span><span class="meta">${relDay(a.date)}${a.start ? ` · ${fmtTime(a.start)}` : ""}${c ? ` · ${esc(c.name)}` : ""}${a.location ? ` · ${esc(a.location)}` : ""}</span></div></li>`;
            }).join("")}</ul>` : empty("☽", "Nothing scheduled. The evenings are yours.")}
          </div>
          <div class="card">
            <div class="card-head"><h2>Where it went</h2><a href="#coffers">coffers →</a></div>
            ${segs.length ? `<div class="ring-wrap">${ring(segs)}<ul class="legend">${segs.slice(0, 6).map((s) => `<li><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.label)}<span class="v">${money(s.value)}</span></li>`).join("")}</ul></div>` : empty("⚱", "No spending recorded this month.")}
          </div>
        </div>

        <div class="grid split" style="margin-top:18px">
          <div class="card">
            <div class="card-head"><h2>Lately in the ledger</h2><a href="#ledger">ledger →</a></div>
            ${recent.length ? `<ul class="list">${recent.map((x) => txLi(x)).join("")}</ul>` : empty("✒", "The ledger is empty.")}
          </div>
          <div class="grid" style="align-content:start">
            <div class="card">
              <div class="card-head"><h2>Today's agenda</h2><a href="#agenda">agenda →</a></div>
              ${(() => {
                const list = pressingTasks();
                return list.length
                  ? `<ul class="list tasks">${list.slice(0, 6).map(taskLi).join("")}</ul>${list.length > 6 ? `<p class="more-link"><a href="#agenda">${list.length - 6} more due</a></p>` : ""}`
                  : empty("☑", D().tasks.some((t) => !t.done) ? "Nothing due today." : "No tasks yet. Add one in the Agenda.");
              })()}
            </div>
            <div class="card">
              <div class="card-head"><h2>Due &amp; expected</h2><small>next 14 days</small></div>
              ${dueSoon.length ? `<ul class="list">${dueSoon.map((x) => `<li ${x.expected ? `data-expected="${x.t.id}@${x.date}"` : `data-tx="${x.t.id}"`} style="cursor:pointer">${dateChip(x.date)}
                <div class="grow"><span class="title">${x.expected ? "↻ " : ""}${esc(x.t.description)}</span><span class="meta">${x.date < today ? `<span class="neg">past due</span> · ` : ""}${esc([x.expected ? "" : dueLabel(x.date), relDay(x.date), isRecurring(x.t.frequency) ? freqLabel(x.t.frequency) : ""].filter(Boolean).join(" · "))}</span></div>
                <span class="${x.t.type === "income" ? "pos" : ""}" style="font-variant-numeric:tabular-nums">${x.t.type === "income" ? "+" : "−"}${money(x.t.amount)}</span></li>`).join("")}</ul>` : empty("⏳", "Nothing due in the next two weeks.")}
            </div>
            <div class="card">
              <div class="card-head"><h2>The codex</h2><a href="#codex">clients →</a></div>
              <div class="grid trio" style="gap:8px;text-align:center">
                ${["lead", "active", "past"].map((s) => `<div><div class="stat"><div class="value">${d.clients.filter((c) => c.status === s).length}</div><div class="label">${s}</div></div></div>`).join("")}
              </div>
            </div>
            <div class="card"><p class="quote">“${esc(q[0])}”<cite>— ${esc(q[1])}</cite></p></div>
          </div>
        </div>`;
    },
    bind(root) {
      $$("[data-appt]", root).forEach((li) => li.addEventListener("click", () => editAppointment(D().appointments.find((a) => a.id === li.dataset.appt))));
      $$("[data-tx]", root).forEach((li) => li.addEventListener("click", () => editTransaction(D().transactions.find((t) => t.id === li.dataset.tx))));
      $$("[data-expected]", root).forEach((li) => li.addEventListener("click", () => {
        const [id, date] = li.dataset.expected.split("@");
        logExpected({ source: D().transactions.find((t) => t.id === id), date });
      }));
    },
  };

  function txLi(x) {
    const c = catById(x.categoryId), cl = clientById(x.clientId);
    const sub = [fmtDate(x.date), x.type === "income" ? (cl ? cl.name : "income") : (c ? c.name : "uncategorized"), x.scope].filter(Boolean).join(" · ");
    return `<li data-tx="${x.id}" style="cursor:pointer"><span style="width:10px;height:10px;border-radius:50%;flex:none;background:${x.type === "income" ? "var(--sage)" : esc(c ? c.color : "#6f6774")}"></span>
      <div class="grow"><span class="title">${esc(x.description)}</span><span class="meta">${esc(sub)}</span></div>
      <span class="${x.type === "income" ? "pos" : ""}" style="font-variant-numeric:tabular-nums">${x.type === "income" ? "+" : "−"}${money(x.amount)}</span></li>`;
  }

  const SORTS = {
    date: (a, b) => a.date.localeCompare(b.date),
    due: (a, b) => (a._due || "9999").localeCompare(b._due || "9999"),
    description: (a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: "base" }),
    category: (a, b) => catName(a).localeCompare(catName(b)),
    frequency: (a, b) => freqRank(a) - freqRank(b),
    amount: (a, b) => a.amount - b.amount,
  };
  const catName = (t) => (t.type === "income" ? "income" : (catById(t.categoryId) || {}).name || "~");
  const freqRank = (t) => { const i = FREQUENCIES.findIndex(([k]) => k === t.frequency); return i < 0 ? 99 : i; };
  const signed = (t) => (t.type === "income" ? t.amount : -t.amount);

  function sortTx(rows) {
    const { key, dir } = ui.ledgerSort;
    const cmp = SORTS[key] || SORTS.date;
    const m = dir === "asc" ? 1 : -1;
    // ties fall back to date, newest first, then order of entry
    return rows.sort((a, b) => m * cmp(a, b) || b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  /* the ledger's kind, purse and search filters (not the month) */
  function passesFilters(t) {
    if (ui.ledgerType !== "all" && t.type !== ui.ledgerType) return false;
    if (ui.ledgerScope !== "all" && t.scope !== ui.ledgerScope) return false;
    const q = ui.ledgerSearch.toLowerCase();
    if (!q) return true;
    const c = catById(t.categoryId), cl = clientById(t.clientId);
    return [t.description, t.notes, c && c.name, cl && cl.name, freqLabel(t.frequency)].some((s) => s && s.toLowerCase().includes(q));
  }
  const ledgerFiltered = (key) => D().transactions.filter((t) => inMonth(t.date, key) && passesFilters(t));

  const catTag = (t) => {
    const c = catById(t.categoryId);
    return t.type === "income"
      ? `<span class="tag"><span class="dot" style="background:var(--sage)"></span>income</span>`
      : `<span class="tag"><span class="dot" style="background:${esc(c ? c.color : "#6f6774")}"></span>${esc(c ? c.name : "uncategorized")}</span>`;
  };

  views.ledger = {
    title: "Ledger",
    actions: () => `<button class="btn ghost" data-act="import">Import</button><button class="btn" data-act="add-income">+ Income</button><button class="btn primary" data-act="add-expense">+ Expense</button>`,
    render() {
      const key = monthKey(ui.ledgerMonth);
      const latest = latestBySeries();
      const rows = ledgerFiltered(key).map((t) => ({ ...t, _due: nextDueOf(t, latest) }));
      const projected = ui.ledgerProjected ? projectedRows(key) : [];
      const inc = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
      const exp = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
      const pInc = projected.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
      const pExp = projected.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
      const pSub = (v, label) => (projected.length ? `<div class="sub">${label} ${v}</div>` : "");
      const seg = (name, cur, opts) => `<div class="segmented" data-ui="${name}">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-value="${v}">${l}</button>`).join("")}</div>`;
      const filtered = ui.ledgerSearch || ui.ledgerType !== "all" || ui.ledgerScope !== "all";

      return `
        <div class="toolbar">
          <div class="month-nav"><button class="icon-btn" data-month="-1" aria-label="Previous month">‹</button><span>${monthLabel(ui.ledgerMonth)}</span><button class="icon-btn" data-month="1" aria-label="Next month">›</button></div>
          ${seg("ledgerView", ui.ledgerView, [["list", "List"], ["calendar", "Calendar"]])}
          ${seg("ledgerType", ui.ledgerType, [["all", "All"], ["expense", "Expenses"], ["income", "Income"]])}
          ${seg("ledgerScope", ui.ledgerScope, [["all", "Both purses"], ["personal", "Personal"], ["business", "Business"]])}
          <span class="spacer"></span>
          <input type="search" id="ledgerSearch" placeholder="Search the ledger…" value="${esc(ui.ledgerSearch)}" style="max-width:220px">
          <label class="check"><input type="checkbox" id="ledgerProjected" ${ui.ledgerProjected ? "checked" : ""}> Show projected</label>
          <button class="btn ghost sm" data-act="csv">Export CSV</button>
        </div>
        <div class="grid cols-3 stats" style="margin-bottom:18px">
          <div class="card stat"><div class="label">Income</div><div class="value pos">${money(inc)}</div>${pInc ? pSub(money(pInc), "+ projected") : ""}</div>
          <div class="card stat"><div class="label">Expenses</div><div class="value">${money(exp)}</div>${pExp ? pSub(money(pExp), "+ projected") : ""}</div>
          <div class="card stat"><div class="label">Balance</div><div class="value ${inc - exp >= 0 ? "pos" : "neg"}">${money(inc - exp)}</div>${pSub(`<b class="${inc + pInc - exp - pExp >= 0 ? "pos" : "neg"}">${money(inc + pInc - exp - pExp)}</b>`, "projected month end")}</div>
        </div>
        ${ui.ledgerView === "calendar" ? ledgerCalendar() : ledgerTable(sortTx([...rows, ...projected]), filtered)}`;
    },
    bind(root) {
      $$("[data-month]", root).forEach((b) => b.addEventListener("click", () => {
        ui.ledgerMonth = addMonths(ui.ledgerMonth, +b.dataset.month);
        ui.ledgerDay = monthKey(ui.ledgerMonth) === monthKey(new Date()) ? todayStr() : ymd(ui.ledgerMonth);
        render();
      }));
      bindSegments(root);
      const s = $("#ledgerSearch", root);
      s.addEventListener("input", () => { ui.ledgerSearch = s.value; render(); const n = $("#ledgerSearch"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      $$("[data-tx]", root).forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); editTransaction(D().transactions.find((t) => t.id === el.dataset.tx)); }));
      $("#ledgerProjected", root).addEventListener("change", (e) => { ui.ledgerProjected = prefs.ledgerProjected = e.target.checked; savePrefs(); render(); });
      $$("[data-sort]", root).forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.sort;
        // a new column starts newest/largest first, except text columns which start A→Z
        const firstDir = ["description", "category", "frequency"].includes(k) ? "asc" : "desc";
        ui.ledgerSort = ui.ledgerSort.key === k ? { key: k, dir: ui.ledgerSort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: firstDir };
        prefs.ledgerSort = ui.ledgerSort; savePrefs();
        render();
      }));
      $$("[data-lday]", root).forEach((b) => {
        b.addEventListener("click", () => {
          ui.ledgerDay = b.dataset.lday;
          if (b.dataset.lday.slice(0, 7) !== monthKey(ui.ledgerMonth)) ui.ledgerMonth = new Date(+b.dataset.lday.slice(0, 4), +b.dataset.lday.slice(5, 7) - 1, 1);
          render();
        });
        b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); } });
      });
      $$("[data-expected]", root).forEach((el) => el.addEventListener("click", (e) => {
        e.stopPropagation();
        const [id, date] = el.dataset.expected.split("@");
        logExpected({ source: D().transactions.find((t) => t.id === id), date });
      }));
    },
  };

  /* projected copies of recurring series that fall in a month, shaped like ledger rows */
  function projectedRows(key) {
    const [y, m] = key.split("-").map(Number);
    const from = `${key}-01`, to = `${key}-${pad(lastOfMonth(y, m - 1))}`;
    return expectedEntries(from, to).filter((e) => passesFilters(e.source)).map((e) => ({
      projected: true, source: e.source, id: `${e.source.id}@${e.date}`, date: e.date, _due: e.date,
      type: e.source.type, description: e.source.description, amount: e.source.amount, scope: e.source.scope,
      categoryId: e.source.categoryId, clientId: e.source.clientId, frequency: e.source.frequency, days: e.source.days,
    }));
  }

  function ledgerTable(rows, filtered) {
    if (!rows.length) return `<div class="card">${empty("✒", filtered ? "No entries match." : "No entries for this month yet.")}</div>`;
    const { key, dir } = ui.ledgerSort;
    const th = (k, label, cls = "") => `<th class="${cls}" aria-sort="${key === k ? (dir === "asc" ? "ascending" : "descending") : "none"}"><button class="sort ${key === k ? "on" : ""}" data-sort="${k}">${label}<span class="arrow">${key === k ? (dir === "asc" ? "▲" : "▼") : "◆"}</span></button></th>`;
    return `<div class="card"><div class="table-wrap"><table>
      <thead><tr>${th("date", "Date")}${th("description", "Description")}${th("category", "Category", "hide-sm")}${th("frequency", "Frequency", "hide-sm")}${th("due", "Next due", "hide-sm")}<th class="hide-sm">Purse</th>${th("amount", "Amount", "num")}</tr></thead>
      <tbody>${rows.map((t) => {
        const cl = clientById(t.clientId);
        const meta = t.projected
          ? `projected${t.date < todayStr() ? " · not recorded yet" : ""}`
          : [cl && cl.name, t.notes].filter(Boolean).map(esc).join(" · ");
        // recurring: when the series is next due; one-time: its own due date
        const due = t.projected
          ? `<span class="${dueClass(t.date)}">${esc(t.date < todayStr() ? "past due" : dueLabel(t.date))}</span>`
          : t._due
            ? `<span class="${isRecurring(t.frequency) ? dueClass(t._due) : t._due >= todayStr() ? dueClass(t._due) : ""}">${esc(dueLabel(t._due, { next: isRecurring(t.frequency) }))}</span>`
            : `<small>—</small>`;
        const freq = t.frequency ? `<span class="tag ${isRecurring(t.frequency) ? "freq" : ""}">${isRecurring(t.frequency) ? "↻ " : ""}${esc(freqLabel(t.frequency))}${t.frequency === "semimonthly" ? ` · ${esc(payDays(t).map(ordinal).join(" & "))}` : ""}</span>` : "";
        // on phones the hidden columns collapse into the description line
        const small = [isRecurring(t.frequency) ? freqLabel(t.frequency) : "", t.projected ? (t.date < todayStr() ? "past due" : "") : t._due ? dueLabel(t._due, { next: isRecurring(t.frequency) }) : ""].filter(Boolean).join(" · ");
        return `<tr ${t.projected ? `data-expected="${t.source.id}@${t.date}" class="projected" title="Projected from ${esc(freqLabel(t.frequency).toLowerCase())} ${esc(t.description)}. Select to record it."` : `data-tx="${t.id}"`} style="cursor:pointer">
          <td style="white-space:nowrap">${fmtDate(t.date, { month: "short", day: "numeric" })}</td>
          <td>${t.projected ? "↻ " : ""}${esc(t.description)}${meta ? `<br><small><i>${meta}</i></small>` : ""}${small ? `<small class="show-sm gold"><br>${esc(small)}</small>` : ""}</td>
          <td class="hide-sm">${catTag(t)}</td>
          <td class="hide-sm">${freq}</td>
          <td class="hide-sm" style="white-space:nowrap">${due}</td>
          <td class="hide-sm"><span class="tag ${t.scope === "business" ? "biz" : ""}">${esc(t.scope)}</span></td>
          <td class="num ${t.type === "income" ? "pos" : ""}">${t.type === "income" ? "+" : "−"}${money(t.amount)}</td>
        </tr>`;
      }).join("")}</tbody></table></div></div>`;
  }

  function ledgerCalendar() {
    const m = ui.ledgerMonth;
    const ws = Number(D().settings.weekStart) || 0;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() - ws + 7) % 7));
    const gridEnd = new Date(start); gridEnd.setDate(start.getDate() + 41);
    const byDate = {}, dueBy = {}, expBy = {};
    const push = (o, k, v) => (o[k] = o[k] || []).push(v);
    // leading/trailing days from neighbouring months show too, under the same filters
    D().transactions.filter(passesFilters).forEach((t) => {
      push(byDate, t.date, t);
      if (!isRecurring(t.frequency) && t.dueDate && t.dueDate !== t.date) push(dueBy, t.dueDate, t);
    });
    if (ui.ledgerProjected) expectedEntries(ymd(start), ymd(gridEnd)).filter((e) => passesFilters(e.source)).forEach((e) => push(expBy, e.date, e));

    const today = todayStr();
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i === 35 && d.getMonth() !== m.getMonth()) break;
      const s = ymd(d);
      const evs = byDate[s] || [], dues = dueBy[s] || [], exps = expBy[s] || [];
      const net = evs.reduce((a, t) => a + signed(t), 0);
      const chips = [
        ...dues.map((t) => `<span class="ev due" data-tx="${t.id}" title="Due: ${esc(t.description)}">⏳ ${esc(t.description)}</span>`),
        ...evs.map((t) => `<span class="ev ${t.type === "income" ? "inc" : "exp"}" data-tx="${t.id}" title="${esc(t.description)} ${t.type === "income" ? "+" : "−"}${esc(money(t.amount))}">${esc(t.description)}</span>`),
        ...exps.map((e) => `<span class="ev expected" data-expected="${e.source.id}@${e.date}" title="Projected: ${esc(e.source.description)} (${esc(freqLabel(e.source.frequency))}). Select to record it.">↻ ${esc(e.source.description)}</span>`),
      ];
      const cls = ["day", d.getMonth() !== m.getMonth() && "other", s === today && "today", s === ui.ledgerDay && "selected"].filter(Boolean).join(" ");
      cells += `<div class="${cls}" data-lday="${s}" role="button" tabindex="0" aria-label="${fmtDate(s, { weekday: "long", month: "long", day: "numeric" })}">
        <span class="num"><span>${d.getDate()}</span>${evs.length ? `<span class="net ${net >= 0 ? "pos" : ""}">${net >= 0 ? "+" : "−"}${money(Math.abs(net)).replace(/\.00$/, "")}</span>` : ""}</span>
        ${chips.slice(0, 3).join("")}
        ${chips.length > 3 ? `<span class="more">+${chips.length - 3} more</span>` : ""}
      </div>`;
    }
    const dows = Array.from({ length: 7 }, (_, i) => `<div class="dow">${DOW[(i + ws) % 7]}</div>`).join("");

    const day = ui.ledgerDay;
    const dayEvs = byDate[day] || [], dayDues = dueBy[day] || [], dayExp = expBy[day] || [];
    const li = (t, extra = "") => `<li data-tx="${t.id}" style="cursor:pointer"><span style="width:10px;height:10px;border-radius:50%;flex:none;background:${t.type === "income" ? "var(--sage)" : esc((catById(t.categoryId) || {}).color || "#6f6774")}"></span>
      <div class="grow"><span class="title">${esc(t.description)}</span><span class="meta">${[extra, catName(t) === "~" ? "uncategorized" : catName(t), isRecurring(t.frequency) ? freqLabel(t.frequency) : "", !extra && nextDueOf(t) ? dueLabel(nextDueOf(t), { next: isRecurring(t.frequency) }) : ""].filter(Boolean).map(esc).join(" · ")}</span></div>
      <span class="${t.type === "income" ? "pos" : ""}" style="font-variant-numeric:tabular-nums">${t.type === "income" ? "+" : "−"}${money(t.amount)}</span></li>`;
    const dayTotal = dayEvs.reduce((a, t) => a + signed(t), 0);

    return `<div class="grid split">
      <div class="card"><div class="calendar ledger-cal">${dows}${cells}</div>
        <p class="cal-key"><span class="ev exp">spent</span><span class="ev inc">received</span><span class="ev due">⏳ due</span><span class="ev expected">↻ projected</span></p></div>
      <div class="card" style="align-self:start">
        <div class="card-head"><h2>${fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}</h2><button class="btn sm" data-act="add-expense-day">+ Add</button></div>
        ${dayEvs.length ? `<ul class="list">${dayEvs.map((t) => li(t)).join("")}</ul><p style="text-align:right;margin:8px 0 0;color:var(--ash)">Day total <b class="${dayTotal >= 0 ? "pos" : ""}">${dayTotal >= 0 ? "+" : "−"}${money(Math.abs(dayTotal))}</b></p>` : ""}
        ${dayDues.length ? `<h3 class="sub-h">Due this day</h3><ul class="list">${dayDues.map((t) => li(t, `entered ${fmtDate(t.date, { month: "short", day: "numeric" })}`)).join("")}</ul>` : ""}
        ${dayExp.length ? `<h3 class="sub-h">Projected</h3><ul class="list">${dayExp.map((e) => `<li data-expected="${e.source.id}@${e.date}" style="cursor:pointer"><span class="gold">↻</span><div class="grow"><span class="title">${esc(e.source.description)}</span><span class="meta">${esc(freqLabel(e.source.frequency))} · select to record it</span></div><span style="color:var(--ash)">${e.source.type === "income" ? "+" : "−"}${money(e.source.amount)}</span></li>`).join("")}</ul>` : ""}
        ${!dayEvs.length && !dayDues.length && !dayExp.length ? empty("✒", "Nothing recorded this day.") : ""}
      </div>
    </div>`;
  }

  function bindSegments(root) {
    $$("[data-ui]", root).forEach((seg) => seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      ui[seg.dataset.ui] = b.dataset.value;
      if (seg.dataset.ui === "ledgerView") { prefs.ledgerView = b.dataset.value; savePrefs(); }
      render();
    }));
  }

  views.coffers = {
    title: "Coffers",
    actions: () => `<button class="btn primary" data-act="add-category">+ Category</button>`,
    render() {
      const key = monthKey(ui.coffersMonth);
      const t = monthTotals(key);
      const cats = D().categories;
      const budgetedSpent = cats.reduce((s, c) => s + (Number(c.budget) ? t.spentBy[c.id] || 0 : 0), 0);
      const unc = t.spentBy[""] || 0;
      const section = (scope, label) => {
        const list = cats.filter((c) => c.scope === scope);
        const totB = list.reduce((s, c) => s + (Number(c.budget) || 0), 0);
        const totS = list.reduce((s, c) => s + (t.spentBy[c.id] || 0), 0);
        return `<div class="card">
          <div class="card-head"><h2>${label}</h2><small>${money(totS)} of ${money(totB)}</small></div>
          ${list.length ? list.map((c) => {
            const spent = t.spentBy[c.id] || 0, b = Number(c.budget) || 0;
            const pct = b ? Math.min(100, (spent / b) * 100) : spent ? 100 : 0;
            const state = !b ? (spent ? "none" : "") : spent > b ? "over" : spent > b * 0.8 ? "warn" : "";
            const note = !b ? "no limit set" : spent > b ? `<span class="neg">${money(spent - b)} over</span>` : `${money(b - spent)} left`;
            return `<div class="budget-row" data-cat="${c.id}" style="cursor:pointer">
              <div class="top"><span class="name"><span class="swatch" style="background:${esc(c.color)}"></span>${esc(c.name)}</span><span class="amt">${money(spent)} / ${b ? money(b) : "—"}</span></div>
              <div class="bar ${state}"><span style="width:${pct}%"></span></div>
              <small><i>${note}</i></small>
            </div>`;
          }).join("") : empty("⚱", "No categories here yet.")}
        </div>`;
      };
      return `
        <div class="toolbar">
          <div class="month-nav"><button class="icon-btn" data-month="-1" aria-label="Previous month">‹</button><span>${monthLabel(ui.coffersMonth)}</span><button class="icon-btn" data-month="1" aria-label="Next month">›</button></div>
        </div>
        <div class="grid cols-4 stats">
          <div class="card stat"><div class="label">Allotted</div><div class="value">${money(t.budget)}</div><div class="sub">monthly budget</div></div>
          <div class="card stat"><div class="label">Spent against it</div><div class="value">${money(budgetedSpent)}</div><div class="sub">${t.budget ? Math.round((budgetedSpent / t.budget) * 100) : 0}% of the budget</div></div>
          <div class="card stat"><div class="label">Remaining</div><div class="value ${t.budget - budgetedSpent >= 0 ? "gold" : "neg"}">${money(t.budget - budgetedSpent)}</div><div class="sub">${unc ? `${money(unc)} uncategorized` : "all spending sorted"}</div></div>
          <div class="card stat"><div class="label">Income</div><div class="value pos">${money(t.income)}</div><div class="sub">net ${money(t.net)}</div></div>
        </div>
        <div class="grid cols-2" style="margin-top:18px">
          ${section("personal", "Personal purse")}
          ${section("business", "Business purse")}
        </div>
        <p style="color:var(--ash);font-style:italic;font-size:15px;margin-top:14px">Select any category to change its budget, colour or purse.</p>`;
    },
    bind(root) {
      $$("[data-month]", root).forEach((b) => b.addEventListener("click", () => { ui.coffersMonth = addMonths(ui.coffersMonth, +b.dataset.month); render(); }));
      $$("[data-cat]", root).forEach((r) => r.addEventListener("click", () => editCategory(catById(r.dataset.cat))));
    },
  };

  views.almanac = {
    title: "Almanac",
    actions: () => `<button class="btn primary" data-act="add-appt-day">+ Appointment</button>`,
    render() {
      const m = ui.almanacMonth;
      const ws = Number(D().settings.weekStart) || 0;
      const first = new Date(m.getFullYear(), m.getMonth(), 1);
      const start = new Date(first);
      start.setDate(1 - ((first.getDay() - ws + 7) % 7));
      const byDate = {};
      D().appointments.forEach((a) => (byDate[a.date] = byDate[a.date] || []).push(a));
      Object.values(byDate).forEach((l) => l.sort((a, b) => (a.start || "").localeCompare(b.start || "")));
      const today = todayStr();
      let cells = "";
      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        if (i === 35 && d.getMonth() !== m.getMonth()) break; // skip an all-next-month row
        const s = ymd(d), evs = byDate[s] || [];
        const cls = ["day", d.getMonth() !== m.getMonth() && "other", s === today && "today", s === ui.almanacDay && "selected"].filter(Boolean).join(" ");
        cells += `<button class="${cls}" data-day="${s}" aria-label="${fmtDate(s, { weekday: "long", month: "long", day: "numeric" })}, ${evs.length} appointments">
          <span class="num"><span>${d.getDate()}</span>${s === today ? "<span>✦</span>" : ""}</span>
          ${evs.slice(0, 3).map((a) => `<span class="ev" title="${esc(fmtTime(a.start))} ${esc(a.title)}">${esc(a.title)}</span>`).join("")}
          ${evs.length > 3 ? `<span class="more">+${evs.length - 3} more</span>` : ""}
        </button>`;
      }
      const dows = Array.from({ length: 7 }, (_, i) => `<div class="dow">${DOW[(i + ws) % 7]}</div>`).join("");
      const dayList = byDate[ui.almanacDay] || [];
      const upcoming = D().appointments.filter((a) => a.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 8);
      const apLi = (a, showDate) => {
        const c = clientById(a.clientId);
        return `<li data-appt="${a.id}" style="cursor:pointer">${showDate ? dateChip(a.date) : `<span class="gold" style="width:62px;flex:none;font-variant-numeric:tabular-nums">${a.start ? fmtTime(a.start) : "all day"}</span>`}
          <div class="grow"><span class="title">${esc(a.title)}</span><span class="meta">${[showDate ? relDay(a.date) : "", showDate && a.start ? fmtTime(a.start) : "", !showDate && a.end ? "until " + fmtTime(a.end) : "", c && c.name, a.location].filter(Boolean).map(esc).join(" · ")}</span></div></li>`;
      };
      return `
        <div class="toolbar">
          <div class="month-nav"><button class="icon-btn" data-month="-1" aria-label="Previous month">‹</button><span>${monthLabel(m)}</span><button class="icon-btn" data-month="1" aria-label="Next month">›</button></div>
          <button class="btn ghost sm" data-today>Today</button>
        </div>
        <div class="grid split">
          <div class="card"><div class="calendar">${dows}${cells}</div></div>
          <div class="grid" style="align-content:start">
            <div class="card">
              <div class="card-head"><h2>${fmtDate(ui.almanacDay, { weekday: "long", month: "long", day: "numeric" })}</h2><button class="btn sm" data-act="add-appt-day">+ Add</button></div>
              ${dayList.length ? `<ul class="list">${dayList.map((a) => apLi(a, false)).join("")}</ul>` : empty("☾", "An unwritten day.")}
            </div>
            <div class="card">
              <div class="card-head"><h2>Coming up</h2></div>
              ${upcoming.length ? `<ul class="list">${upcoming.map((a) => apLi(a, true)).join("")}</ul>` : empty("☉", "Nothing ahead.")}
            </div>
          </div>
        </div>`;
    },
    bind(root) {
      $$("[data-month]", root).forEach((b) => b.addEventListener("click", () => { ui.almanacMonth = addMonths(ui.almanacMonth, +b.dataset.month); render(); }));
      $("[data-today]", root).addEventListener("click", () => { const n = new Date(); ui.almanacMonth = new Date(n.getFullYear(), n.getMonth(), 1); ui.almanacDay = todayStr(); render(); });
      $$("[data-day]", root).forEach((b) => {
        b.addEventListener("click", () => {
          ui.almanacDay = b.dataset.day;
          const d = parseYmd(b.dataset.day);
          if (d.getMonth() !== ui.almanacMonth.getMonth()) ui.almanacMonth = new Date(d.getFullYear(), d.getMonth(), 1);
          render();
        });
        b.addEventListener("dblclick", () => editAppointment({ date: b.dataset.day }));
      });
      $$("[data-appt]", root).forEach((li) => li.addEventListener("click", () => editAppointment(D().appointments.find((a) => a.id === li.dataset.appt))));
    },
  };

  views.codex = {
    title: "Codex",
    actions: () => `<button class="btn primary" data-act="add-client">+ Client</button>`,
    render() {
      const q = ui.codexSearch.toLowerCase();
      const today = todayStr();
      const list = D().clients
        .filter((c) => ui.codexStatus === "all" || c.status === ui.codexStatus)
        .filter((c) => !q || [c.name, c.email, c.phone, c.notes].some((s) => s && s.toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name));
      const counts = (s) => D().clients.filter((c) => s === "all" || c.status === s).length;
      return `
        <div class="toolbar">
          <div class="segmented" data-ui="codexStatus">${[["all", "All"], ["lead", "Leads"], ["active", "Active"], ["past", "Past"]].map(([v, l]) => `<button class="${ui.codexStatus === v ? "on" : ""}" data-value="${v}">${l} (${counts(v)})</button>`).join("")}</div>
          <span class="spacer"></span>
          <input type="search" id="codexSearch" placeholder="Search clients…" value="${esc(ui.codexSearch)}" style="max-width:240px">
        </div>
        ${list.length ? `<div class="grid cols-3">${list.map((c) => {
          const earned = D().transactions.filter((t) => t.clientId === c.id && t.type === "income").reduce((s, t) => s + t.amount, 0);
          const next = D().appointments.filter((a) => a.clientId === c.id && a.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
          const visits = D().appointments.filter((a) => a.clientId === c.id && a.date < today).length;
          return `<div class="card client-card">
            <div class="who"><div class="monogram">${esc(initials(c.name))}</div><div style="min-width:0"><h3>${esc(c.name)}</h3><span class="tag ${esc(c.status)}">${esc(c.status)}</span></div></div>
            <div class="contact">${[c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, c.phone && `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`].filter(Boolean).join(" · ") || "<i>no contact details</i>"}</div>
            <div class="row"><small>Earned <b class="pos">${money(earned)}</b></small><small>· ${visits} past visit${visits === 1 ? "" : "s"}</small>${c.rate ? `<small>· rate ${money(c.rate)}</small>` : ""}</div>
            <small>${next ? `Next: <span class="gold">${esc(next.title)}</span>, ${fmtDate(next.date)}${next.start ? " " + fmtTime(next.start) : ""}` : "<i>no upcoming appointment</i>"}</small>
            ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}
            <div class="row" style="margin-top:auto;padding-top:6px"><button class="btn sm" data-book="${c.id}">Book</button><button class="btn sm" data-pay="${c.id}">Log payment</button><span class="spacer"></span><button class="btn ghost sm" data-client="${c.id}">Edit</button></div>
          </div>`;
        }).join("")}</div>` : `<div class="card">${empty("❦", D().clients.length ? "No clients match." : "The codex is empty. Add your first client.")}</div>`}`;
    },
    bind(root) {
      bindSegments(root);
      const s = $("#codexSearch", root);
      s.addEventListener("input", () => { ui.codexSearch = s.value; render(); const n = $("#codexSearch"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      $$("[data-client]", root).forEach((b) => b.addEventListener("click", () => editClient(clientById(b.dataset.client))));
      $$("[data-book]", root).forEach((b) => b.addEventListener("click", () => editAppointment({ clientId: b.dataset.book, title: "Session" })));
      $$("[data-pay]", root).forEach((b) => b.addEventListener("click", () => {
        const c = clientById(b.dataset.pay);
        editTransaction({ type: "income", scope: "business", clientId: c.id, amount: c.rate || "", description: `Payment · ${c.name}` });
      }));
    },
  };

  views.agenda = {
    title: "Agenda",
    actions: () => `${D().tasks.some((t) => t.done) ? `<button class="btn ghost" data-act="clear-done">Clear finished</button>` : ""}<button class="btn primary" data-act="add-task">+ Task</button>`,
    render() {
      const today = todayStr(), week = stepDays(today, 7);
      const all = D().tasks.filter((t) => ui.agendaScope === "all" || (t.scope || "personal") === ui.agendaScope);
      const open = all.filter((t) => !t.done).sort(byTaskOrder);
      const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
      const groups = [
        ["Overdue", "neg", open.filter((t) => t.due && t.due < today)],
        ["Today", "gold", open.filter((t) => t.due === today)],
        ["This week", "", open.filter((t) => t.due > today && t.due <= week)],
        ["Later", "", open.filter((t) => t.due > week)],
        ["Someday", "", open.filter((t) => !t.due)],
      ].filter(([, , list]) => list.length);
      const doneThisWeek = D().tasks.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) > stepDays(today, -7)).length;
      const seg = `<div class="segmented" data-ui="agendaScope">${[["all", "All"], ["personal", "Personal"], ["business", "Business"]].map(([v, l]) => `<button class="${ui.agendaScope === v ? "on" : ""}" data-value="${v}">${l}</button>`).join("")}</div>`;
      return `
        <form class="card quick-add" id="quickAdd" autocomplete="off">
          <input name="title" placeholder="Add a task and press Enter…" aria-label="New task" required>
          <input name="due" type="date" aria-label="Due date" title="Due date (optional)">
          <select name="priority" aria-label="Priority">${PRIORITIES.map(([v, l]) => `<option value="${v}" ${v === "normal" ? "selected" : ""}>${l}</option>`).join("")}</select>
          <button class="btn primary" type="submit">Add</button>
        </form>
        <div class="toolbar" style="margin-top:16px">
          ${seg}
          <span class="spacer"></span>
          <label class="check"><input type="checkbox" id="agendaShowDone" ${ui.agendaShowDone ? "checked" : ""}> Show finished</label>
        </div>
        <div class="grid cols-4 stats" style="margin-bottom:18px">
          <div class="card stat"><div class="label">Open</div><div class="value">${open.length}</div></div>
          <div class="card stat"><div class="label">Due today</div><div class="value gold">${open.filter((t) => t.due === today).length}</div></div>
          <div class="card stat"><div class="label">Overdue</div><div class="value ${open.some((t) => t.due && t.due < today) ? "neg" : ""}">${open.filter((t) => t.due && t.due < today).length}</div></div>
          <div class="card stat"><div class="label">Done this week</div><div class="value pos">${doneThisWeek}</div></div>
        </div>
        ${groups.length ? `<div class="grid">${groups.map(([label, cls, list]) => `
          <div class="card">
            <div class="card-head"><h2 class="${cls}">${label}</h2><small>${list.length}</small></div>
            <ul class="list tasks">${list.map(taskLi).join("")}</ul>
          </div>`).join("")}</div>` : `<div class="card">${empty("☑", all.length ? "Everything's done. Rest a while." : "No tasks yet. Add one above.")}</div>`}
        ${ui.agendaShowDone && done.length ? `<div class="card" style="margin-top:18px">
          <div class="card-head"><h2>Finished</h2><small>${done.length}</small></div>
          <ul class="list tasks">${done.slice(0, 50).map(taskLi).join("")}</ul>
          ${done.length > 50 ? `<p class="more-link">and ${done.length - 50} older</p>` : ""}
        </div>` : ""}`;
    },
    bind(root) {
      bindSegments(root);
      $("#agendaShowDone", root).addEventListener("change", (e) => { ui.agendaShowDone = prefs.agendaShowDone = e.target.checked; savePrefs(); render(); });
      $("#quickAdd", root).addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const title = String(f.get("title") || "").trim();
        if (!title) return;
        Store.upsert("tasks", {
          title, due: f.get("due") || "", priority: f.get("priority") || "normal",
          scope: ui.agendaScope === "business" ? "business" : "personal", clientId: "", notes: "", done: false, doneAt: "",
        });
        toast("Added to the agenda.");
        $("#quickAdd input[name=title]").focus();
      });
    },
  };

  /* ── sync across devices ──────────────────── */
  const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=3rd%20Iris%20sync";

  function syncAgo(iso) {
    if (!iso) return "not yet";
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    return hrs < 24 ? `${hrs} hr ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function syncCard() {
    const st = Sync.state;
    if (!Sync.connected) {
      return `<div class="card" id="syncCard">
        <div class="card-head"><h2>Sync across devices</h2><small>off</small></div>
        <p style="margin-top:0;color:var(--parchment)">Keep your phone, laptop and any other device in step. An encrypted copy is kept in a secret gist on your GitHub account; it's locked with a passphrase only you know, so GitHub can't read it.</p>
        <ol class="steps">
          <li><a href="${TOKEN_URL}" target="_blank" rel="noopener">Create a GitHub token</a> with only the <b>gist</b> box ticked (it's pre-ticked). Choose an expiry, generate it, and copy it.</li>
          <li>Paste it below and choose a passphrase. Write the passphrase down: if it's lost, the synced copy can't be opened.</li>
          <li>On your other devices, open this app, come here, and enter the <b>same token and passphrase</b>.</li>
        </ol>
        <form id="syncForm" class="form-grid" autocomplete="off">
          <label class="field">GitHub token<input name="token" type="password" placeholder="ghp_…" autocomplete="off" spellcheck="false" required></label>
          <label class="field">Passphrase<input name="passphrase" type="password" placeholder="at least 8 characters" autocomplete="new-password" required></label>
          <div class="span-2"><button class="btn primary" type="submit">Connect &amp; sync</button></div>
        </form>
        <p class="form-error" id="syncError">${st.message ? esc(st.message) : ""}</p>
      </div>`;
    }
    const label = { syncing: "Syncing…", ok: `Synced ${syncAgo(st.lastSync)}`, offline: "Offline · will sync when back online", error: "Sync problem", idle: `Last synced ${syncAgo(st.lastSync)}` }[st.status] || "";
    return `<div class="card" id="syncCard">
      <div class="card-head"><h2>Sync across devices</h2><small class="${st.status === "error" ? "neg" : st.status === "ok" ? "pos" : ""}">on</small></div>
      <p style="margin-top:0" class="${st.status === "error" ? "neg" : ""}">${esc(label)}</p>
      ${st.message ? `<p class="form-error" style="margin-top:-6px">${esc(st.message)}</p>` : ""}
      <p style="color:var(--ash);font-size:15px">Changes sync a few seconds after you make them, and whenever you open the app. To add another device, enter the same token and passphrase there.</p>
      <div class="toolbar" style="margin:0">
        <button class="btn" data-act="sync-now" ${st.status === "syncing" ? "disabled" : ""}>Sync now</button>
        <button class="btn ghost" data-act="sync-off">Turn off on this device</button>
      </div>
    </div>`;
  }

  function renderSyncStatus() {
    const el = $("#syncStatus");
    if (!el) return;
    const st = Sync.state;
    el.hidden = !Sync.connected;
    if (!Sync.connected) return;
    const [icon, text, cls] = {
      syncing: ["↻", "syncing…", ""],
      ok: ["☁", `synced ${syncAgo(st.lastSync)}`, "ok"],
      offline: ["☁", "offline", "warn"],
      error: ["!", "sync problem", "bad"],
      idle: ["☁", `synced ${syncAgo(st.lastSync)}`, ""],
    }[st.status] || ["☁", "sync", ""];
    el.className = `sync-status ${cls}`;
    el.innerHTML = `<span class="ic ${st.status === "syncing" ? "spin" : ""}">${icon}</span>${esc(text)}`;
    el.title = st.message || "Sync across devices";
  }

  views.archive = {
    title: "Archive",
    actions: () => "",
    render() {
      const s = D().settings;
      const currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY", "MXN", "CHF", "SEK"];
      if (!currencies.includes(s.currency)) currencies.push(s.currency);
      return `
        <div class="grid cols-2">
          <div class="card">
            <div class="card-head"><h2>Settings</h2></div>
            <form id="settingsForm" class="form-grid">
              <label class="field span-2">Your name<input name="ownerName" value="${esc(s.ownerName)}" placeholder="for the greeting"></label>
              <label class="field">Currency<select name="currency">${currencies.map((c) => `<option ${c === s.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
              <label class="field">Weeks begin on<select name="weekStart"><option value="0" ${+s.weekStart === 0 ? "selected" : ""}>Sunday</option><option value="1" ${+s.weekStart === 1 ? "selected" : ""}>Monday</option></select></label>
              <div class="span-2"><button class="btn primary" type="submit">Save settings</button></div>
            </form>
          </div>
          <div class="card">
            <div class="card-head"><h2>Backup &amp; restore</h2></div>
            <p style="margin-top:0;color:var(--parchment)">${Sync.connected ? "Your data lives in this browser and in your encrypted sync copy. A downloaded backup is still a good safety net." : "Everything lives only in this browser. Keep a backup somewhere safe, or turn on sync below to use it on other devices."}</p>
            <div class="toolbar">
              <button class="btn" data-act="export">Download backup</button>
              <label class="btn ghost" style="display:inline-block">Restore from backup<input type="file" accept="application/json,.json" id="importFile" hidden></label>
              <button class="btn ghost" data-act="csv-all">All entries as CSV</button>
              <button class="btn ghost" data-act="import">Import entries</button>
            </div>
            <p style="color:var(--ash);font-size:15px;margin:0"><i>${D().transactions.length} ledger entries · ${D().appointments.length} appointments · ${D().clients.length} clients · ${D().tasks.length} tasks · ${D().categories.length} categories</i></p>
          </div>
          ${syncCard()}
          <div class="card">
            <div class="card-head"><h2>Rituals</h2></div>
            <div class="toolbar" style="margin:0">
              <button class="btn" data-act="seed">Summon sample data</button>
              <button class="btn danger" data-act="reset">Burn it all &amp; begin anew</button>
            </div>
          </div>
        </div>`;
    },
    bind(root) {
      const sf = $("#syncForm", root);
      if (sf) sf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(sf);
        const btn = $("button[type=submit]", sf);
        btn.disabled = true;
        btn.textContent = "Connecting…";
        try {
          const { created } = await Sync.connect(String(f.get("token")), String(f.get("passphrase")));
          toast(created ? "Sync is on. Now connect your other devices." : "Connected. Your data is merged and in sync.");
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Connect & sync";
          const box = $("#syncError");
          if (box) box.textContent = err.message;
        }
      });
      $("#settingsForm", root).addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        Store.setSettings({ ownerName: f.get("ownerName").trim(), currency: f.get("currency"), weekStart: +f.get("weekStart") });
        toast("Settings saved.");
      });
      $("#importFile", root).addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          Store.importJSON(await file.text());
          toast("Grimoire restored.");
        } catch (err) {
          toast("That file isn't a 3rd Iris backup.");
        }
      });
    },
  };

  /* ── downloads ─────────────────────────────── */
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function toCSV(txs) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["date", "type", "purse", "description", "category", "client", "amount", "frequency", "due", "notes"];
    const rows = txs.slice().sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t.type, t.scope, t.description, (catById(t.categoryId) || {}).name || "", (clientById(t.clientId) || {}).name || "", t.type === "expense" ? -t.amount : t.amount, t.frequency || "", t.dueDate || "", t.notes || ""].map(q).join(","));
    return [head.join(","), ...rows].join("\n");
  }

  /* ── global actions ────────────────────────── */
  const actions = {
    "add-expense": () => editTransaction({ type: "expense" }),
    "add-income": () => editTransaction({ type: "income", scope: "business" }),
    "add-appt": () => editAppointment(),
    "add-appt-day": () => editAppointment({ date: ui.almanacDay }),
    "add-expense-day": () => editTransaction({ type: "expense", date: ui.ledgerDay }),
    "add-client": () => editClient(),
    "add-category": () => editCategory(),
    "add-task": () => editTask({ scope: ui.agendaScope === "business" ? "business" : "personal" }),
    "clear-done": () => {
      const n = Store.removeWhere("tasks", (t) => t.done);
      if (!n) return;
      toast(`${n} finished task${n === 1 ? "" : "s"} cleared.`);
    },
    import: () => openImport(),
    seed: () => { Store.seedSample(); toast("Sample pages summoned."); },
    "sync-now": () => Sync.syncNow(),
    "sync-off": () => { Sync.disconnect(); toast("Sync is off on this device. Your data stays here."); render(); },
    export: () => download(`3rd-iris-backup-${todayStr()}.json`, Store.exportJSON(), "application/json"),
    csv: () => download(`3rd-iris-ledger-${monthKey(ui.ledgerMonth)}.csv`, toCSV(D().transactions.filter((t) => inMonth(t.date, monthKey(ui.ledgerMonth)))), "text/csv"),
    "csv-all": () => download(`3rd-iris-ledger-all.csv`, toCSV(D().transactions), "text/csv"),
    reset: () => openForm({
      title: "Burn the Grimoire?",
      fields: [{ name: "confirm", label: Sync.connected ? 'Type "burn" to erase every record in this browser. Sync will be turned off here; your synced copy and other devices are untouched.' : 'Type "burn" to erase every record in this browser', span2: true }],
      submitLabel: "Burn it",
      onSubmit: (v) => {
        if (v.confirm.toLowerCase() !== "burn") return 'Type "burn" to confirm.';
        // otherwise the next sync would simply bring everything back
        if (Sync.connected) Sync.disconnect();
        Store.reset();
        toast("Ashes. A fresh page awaits.");
      },
    }),
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b && actions[b.dataset.act]) return actions[b.dataset.act]();
    // tasks behave the same wherever they're listed
    const tick = e.target.closest("[data-toggle-task]");
    if (tick) return toggleTask(tick.dataset.toggleTask);
    const task = e.target.closest("[data-task]");
    if (task && !e.target.closest("a")) editTask(D().tasks.find((t) => t.id === task.dataset.task));
  });

  /* ── chrome: router, sidebar, moon ─────────── */
  function currentView() {
    const v = location.hash.replace("#", "");
    return views[v] ? v : "sanctum";
  }

  function render() {
    const name = currentView();
    const v = views[name];
    $("#viewTitle").textContent = v.title;
    document.title = `${v.title} · 3rd Iris`;
    $("#topbarActions").innerHTML = v.actions();
    const root = $("#view");
    root.innerHTML = v.render();
    v.bind && v.bind(root);
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
    const due = pressingTasks().length, badge = $("#agendaBadge");
    badge.textContent = due;
    badge.hidden = !due;
    badge.title = `${due} task${due === 1 ? "" : "s"} due or overdue`;
  }

  function renderChrome() {
    const now = new Date();
    $("#todayLabel").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const m = moonPhase(now);
    $("#moonCard").innerHTML = `<div class="moon">${m.svg}</div><b>${m.name}</b><p>${m.hint}</p>`;
  }

  window.addEventListener("hashchange", () => {
    const root = $("#view");
    root.style.animation = "none";
    void root.offsetWidth;
    root.style.animation = "";
    render();
    $("#sidebar").classList.remove("open");
    window.scrollTo(0, 0);
  });
  $("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  document.addEventListener("click", (e) => {
    const sb = $("#sidebar");
    if (sb.classList.contains("open") && !sb.contains(e.target) && !e.target.closest("#menuBtn")) sb.classList.remove("open");
  });

  /* entries imported before frequency existed carry it in their notes ("Chime · Monthly"); lift it out */
  (function migrateFrequencies() {
    let changed = false;
    D().transactions.forEach((t) => {
      if (t.frequency || !t.notes) return;
      const parts = t.notes.split(" · ");
      const i = parts.findIndex((p) => Importer.normFrequency(p));
      if (i < 0) return;
      t.frequency = Importer.normFrequency(parts[i]);
      parts.splice(i, 1);
      t.notes = parts.join(" · ");
      changed = true;
    });
    if (changed) Store.save();
  })();

  Store.onChange(render);
  Sync.onChange(() => {
    renderSyncStatus();
    // refresh the Archive page, unless someone is mid-way through typing in it
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (currentView() === "archive" && !typing && !$("#modal").open) render();
  });
  setInterval(renderSyncStatus, 60000);
  renderSyncStatus();
  renderChrome();
  render();
})();
