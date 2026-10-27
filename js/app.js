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
  const relDay = (s) => {
    const diff = Math.round((parseYmd(s) - parseYmd(todayStr())) / 864e5);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff === -1) return "yesterday";
    return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
  };

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
      values: { type: "expense", date: todayStr(), scope: "personal", ...tx },
      fields: [
        { name: "type", label: "Kind", type: "segmented", options: [{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }], span2: true },
        { name: "description", label: "Description", required: true, placeholder: "e.g. beeswax candles", span2: true },
        { name: "amount", label: "Amount", type: "number", required: true, placeholder: "0.00" },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "scope", label: "Purse", type: "segmented", options: [{ value: "personal", label: "Personal" }, { value: "business", label: "Business" }] },
        { name: "categoryId", label: "Category", type: "select", options: categoryOptions() },
        { name: "clientId", label: "Client", type: "select", options: clientOptions(), span2: true },
        { name: "notes", label: "Notes", type: "textarea", span2: true },
      ],
      onChange: (v, root) => {
        // income doesn't need a budget category
        const cat = $('[name="categoryId"]', root).closest("label");
        cat.style.display = v.type === "income" ? "none" : "";
      },
      onSubmit: (v) => {
        if (!(v.amount > 0)) return "Amount must be more than zero.";
        if (v.type === "income") v.categoryId = "";
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
    coffersMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    almanacMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    almanacDay: todayStr(),
    codexStatus: "all",
    codexSearch: "",
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
    },
  };

  function txLi(x) {
    const c = catById(x.categoryId), cl = clientById(x.clientId);
    const sub = [fmtDate(x.date), x.type === "income" ? (cl ? cl.name : "income") : (c ? c.name : "uncategorized"), x.scope].filter(Boolean).join(" · ");
    return `<li data-tx="${x.id}" style="cursor:pointer"><span style="width:10px;height:10px;border-radius:50%;flex:none;background:${x.type === "income" ? "var(--sage)" : esc(c ? c.color : "#6f6774")}"></span>
      <div class="grow"><span class="title">${esc(x.description)}</span><span class="meta">${esc(sub)}</span></div>
      <span class="${x.type === "income" ? "pos" : ""}" style="font-variant-numeric:tabular-nums">${x.type === "income" ? "+" : "−"}${money(x.amount)}</span></li>`;
  }

  views.ledger = {
    title: "Ledger",
    actions: () => `<button class="btn" data-act="add-income">+ Income</button><button class="btn primary" data-act="add-expense">+ Expense</button>`,
    render() {
      const key = monthKey(ui.ledgerMonth);
      const q = ui.ledgerSearch.toLowerCase();
      const rows = D().transactions
        .filter((t) => inMonth(t.date, key))
        .filter((t) => ui.ledgerType === "all" || t.type === ui.ledgerType)
        .filter((t) => ui.ledgerScope === "all" || t.scope === ui.ledgerScope)
        .filter((t) => {
          if (!q) return true;
          const c = catById(t.categoryId), cl = clientById(t.clientId);
          return [t.description, t.notes, c && c.name, cl && cl.name].some((s) => s && s.toLowerCase().includes(q));
        })
        .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
      const inc = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
      const exp = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
      const seg = (name, cur, opts) => `<div class="segmented" data-ui="${name}">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-value="${v}">${l}</button>`).join("")}</div>`;

      return `
        <div class="toolbar">
          <div class="month-nav"><button class="icon-btn" data-month="-1" aria-label="Previous month">‹</button><span>${monthLabel(ui.ledgerMonth)}</span><button class="icon-btn" data-month="1" aria-label="Next month">›</button></div>
          ${seg("ledgerType", ui.ledgerType, [["all", "All"], ["expense", "Expenses"], ["income", "Income"]])}
          ${seg("ledgerScope", ui.ledgerScope, [["all", "Both purses"], ["personal", "Personal"], ["business", "Business"]])}
          <span class="spacer"></span>
          <input type="search" id="ledgerSearch" placeholder="Search the ledger…" value="${esc(ui.ledgerSearch)}" style="max-width:220px">
          <button class="btn ghost sm" data-act="csv">Export CSV</button>
        </div>
        <div class="grid cols-3 stats" style="margin-bottom:18px">
          <div class="card stat"><div class="label">Income</div><div class="value pos">${money(inc)}</div></div>
          <div class="card stat"><div class="label">Expenses</div><div class="value">${money(exp)}</div></div>
          <div class="card stat"><div class="label">Balance</div><div class="value ${inc - exp >= 0 ? "pos" : "neg"}">${money(inc - exp)}</div></div>
        </div>
        <div class="card">
          ${rows.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category / Client</th><th class="hide-sm">Purse</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows.map((t) => {
              const c = catById(t.categoryId), cl = clientById(t.clientId);
              const cat = t.type === "income" ? `<span class="tag"><span class="dot" style="background:var(--sage)"></span>income</span>` : `<span class="tag"><span class="dot" style="background:${esc(c ? c.color : "#6f6774")}"></span>${esc(c ? c.name : "uncategorized")}</span>`;
              return `<tr data-tx="${t.id}" style="cursor:pointer">
                <td style="white-space:nowrap">${fmtDate(t.date, { month: "short", day: "numeric" })}</td>
                <td>${esc(t.description)}${t.notes ? `<br><small><i>${esc(t.notes)}</i></small>` : ""}</td>
                <td class="hide-sm">${cat}${cl ? ` <small>· ${esc(cl.name)}</small>` : ""}</td>
                <td class="hide-sm"><span class="tag ${t.scope === "business" ? "biz" : ""}">${esc(t.scope)}</span></td>
                <td class="num ${t.type === "income" ? "pos" : ""}">${t.type === "income" ? "+" : "−"}${money(t.amount)}</td>
              </tr>`;
            }).join("")}</tbody></table></div>` : empty("✒", q || ui.ledgerType !== "all" || ui.ledgerScope !== "all" ? "No entries match." : "No entries for this month yet.")}
        </div>`;
    },
    bind(root) {
      $$("[data-month]", root).forEach((b) => b.addEventListener("click", () => { ui.ledgerMonth = addMonths(ui.ledgerMonth, +b.dataset.month); render(); }));
      bindSegments(root);
      const s = $("#ledgerSearch", root);
      s.addEventListener("input", () => { ui.ledgerSearch = s.value; render(); const n = $("#ledgerSearch"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      $$("[data-tx]", root).forEach((tr) => tr.addEventListener("click", () => editTransaction(D().transactions.find((t) => t.id === tr.dataset.tx))));
    },
  };

  function bindSegments(root) {
    $$("[data-ui]", root).forEach((seg) => seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      ui[seg.dataset.ui] = b.dataset.value;
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
            const state = b && spent > b ? "over" : b && spent > b * 0.8 ? "warn" : "";
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
            <p style="margin-top:0;color:var(--parchment)">Everything lives only in this browser. Keep a backup somewhere safe, and use it to move your grimoire to another device.</p>
            <div class="toolbar">
              <button class="btn" data-act="export">Download backup</button>
              <label class="btn ghost" style="display:inline-block">Restore from backup<input type="file" accept="application/json,.json" id="importFile" hidden></label>
              <button class="btn ghost" data-act="csv-all">All entries as CSV</button>
            </div>
            <p style="color:var(--ash);font-size:15px;margin:0"><i>${D().transactions.length} ledger entries · ${D().appointments.length} appointments · ${D().clients.length} clients · ${D().categories.length} categories</i></p>
          </div>
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
      $("#settingsForm", root).addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        Object.assign(D().settings, { ownerName: f.get("ownerName").trim(), currency: f.get("currency"), weekStart: +f.get("weekStart") });
        Store.save();
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
    const head = ["date", "type", "purse", "description", "category", "client", "amount", "notes"];
    const rows = txs.slice().sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t.type, t.scope, t.description, (catById(t.categoryId) || {}).name || "", (clientById(t.clientId) || {}).name || "", t.type === "expense" ? -t.amount : t.amount, t.notes || ""].map(q).join(","));
    return [head.join(","), ...rows].join("\n");
  }

  /* ── global actions ────────────────────────── */
  const actions = {
    "add-expense": () => editTransaction({ type: "expense" }),
    "add-income": () => editTransaction({ type: "income", scope: "business" }),
    "add-appt": () => editAppointment(),
    "add-appt-day": () => editAppointment({ date: ui.almanacDay }),
    "add-client": () => editClient(),
    "add-category": () => editCategory(),
    seed: () => { Store.seedSample(); toast("Sample pages summoned."); },
    export: () => download(`3rd-iris-backup-${todayStr()}.json`, Store.exportJSON(), "application/json"),
    csv: () => download(`3rd-iris-ledger-${monthKey(ui.ledgerMonth)}.csv`, toCSV(D().transactions.filter((t) => inMonth(t.date, monthKey(ui.ledgerMonth)))), "text/csv"),
    "csv-all": () => download(`3rd-iris-ledger-all.csv`, toCSV(D().transactions), "text/csv"),
    reset: () => openForm({
      title: "Burn the Grimoire?",
      fields: [{ name: "confirm", label: 'Type "burn" to erase every record in this browser', span2: true }],
      submitLabel: "Burn it",
      onSubmit: (v) => {
        if (v.confirm.toLowerCase() !== "burn") return 'Type "burn" to confirm.';
        Store.reset();
        toast("Ashes. A fresh page awaits.");
      },
    }),
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b && actions[b.dataset.act]) actions[b.dataset.act]();
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

  Store.onChange(render);
  renderChrome();
  render();
})();
