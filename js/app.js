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

  /* images are stored in IndexedDB and filled in after each render */
  const imgTag = (id, alt = "") => {
    const url = window.Images ? Images.cachedUrl(id) : "";
    return `<img data-img="${esc(id)}" alt="${esc(alt)}" ${url ? `src="${url}"` : ""} loading="lazy">`;
  };
  function hydrateImages(root = document) {
    if (!window.Images) return;
    $$("img[data-img]:not([src])", root).forEach((img) => {
      Images.urlFor(img.dataset.img).then((url) => {
        if (url) img.src = url;
        else img.closest(".scrap-img, .img-preview")?.classList.add("arriving");
      }).catch(() => {});
    });
  }

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
    if (f.type === "steps") {
      const rows = (Array.isArray(v) ? v : []).map(stepRowHTML).join("");
      return `<div class="${cls}"><label class="field">${esc(f.label)}</label><div class="steps-edit" data-steps="${f.name}">${rows}</div>
        <button type="button" class="btn ghost sm" data-add-step>+ Add a step</button></div>`;
    }
    if (f.type === "note") return `<p class="form-hint" id="${f.name}"></p>`;
    if (f.type === "image") {
      const im = v && v.id ? v : null;
      return `<div class="${cls} img-field" data-image-field="${f.name}" data-image-id="${esc(im ? im.id : "")}" data-w="${im ? im.w : 0}" data-h="${im ? im.h : 0}">
        <label class="field">${esc(f.label)}</label>
        <div class="img-preview">${im ? imgTag(im.id) : `<span>No image</span>`}</div>
        <div class="toolbar" style="margin:8px 0 0">
          <label class="btn ghost sm" style="display:inline-block">${im ? "Replace" : "Add an image"}<input type="file" accept="image/*" data-image-input hidden></label>
          ${im ? `<button type="button" class="btn ghost sm" data-image-remove>Remove</button>` : ""}
        </div></div>`;
    }
    if (f.datalist) {
      return `<label class="${cls}">${esc(f.label)}<input type="text" name="${f.name}" value="${esc(v)}" ${ph} list="dl-${f.name}"><datalist id="dl-${f.name}">${f.datalist.map((o) => `<option value="${esc(o)}">`).join("")}</datalist></label>`;
    }
    const extra = f.type === "number" ? `step="${f.step || "0.01"}" min="${f.min ?? 0}" inputmode="decimal"` : "";
    return `<label class="${cls}">${esc(f.label)}<input type="${f.type || "text"}" name="${f.name}" value="${esc(v)}" ${ph} ${req} ${extra}></label>`;
  }

  /**
   * openForm({ title, fields, values, submitLabel, onSubmit(values) -> string|void, onDelete })
   * onSubmit may return an error message to keep the dialog open.
   */
  function openForm({ title, fields, values = {}, submitLabel = "Inscribe", onSubmit, onDelete, onChange, extra = [] }) {
    modal.classList.remove("wide");
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = `<div class="form-grid">${fields.map((f) => fieldHTML(f, values[f.name])).join("")}</div><p class="form-error" id="formError"></p>`;
    $("#modalFoot").innerHTML =
      (onDelete ? `<button type="button" class="btn danger" data-delete>Banish</button>` : "") +
      extra.map((x, i) => `<button type="button" class="btn ghost" data-extra="${i}">${esc(x.label)}</button>`).join("") +
      `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel)}</button>`;
    $$("[data-extra]", modal).forEach((b) => b.addEventListener("click", () => {
      // extra actions see the form as it stands; returning true closes the dialog
      if (extra[+b.dataset.extra].onClick(collect(fields))) modal.close();
    }));

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
    hydrateImages(modal);
    const first = $("input:not([type=hidden]):not([type=file]), select, textarea", modal);
    if (first) first.focus();
  }

  const stepRowHTML = (st = {}) => `<div class="step-row" data-step-id="${esc(st.id || "")}">
    <input type="checkbox" ${st.done ? "checked" : ""} aria-label="Step done">
    <input type="text" value="${esc(st.title || "")}" placeholder="A step…" aria-label="Step">
    <button type="button" class="icon-btn" data-remove-step aria-label="Remove step">✕</button></div>`;

  function collect(fields) {
    const out = {};
    fields.forEach((f) => {
      if (f.type === "image") {
        const box = $(`[data-image-field="${f.name}"]`, modal);
        out[f.name] = box && box.dataset.imageId ? { id: box.dataset.imageId, w: +box.dataset.w, h: +box.dataset.h } : null;
        return;
      }
      if (f.type === "steps") {
        out[f.name] = $$(".step-row", modal).map((row) => ({
          id: row.dataset.stepId || Store.uid(),
          title: $("input[type=text]", row).value.trim(),
          done: $("input[type=checkbox]", row).checked,
        })).filter((st) => st.title);
        return;
      }
      const el = $(`[name="${f.name}"]`, modal);
      if (!el) return;
      out[f.name] = f.type === "number" ? (el.value === "" ? "" : parseFloat(el.value)) : el.value.trim();
    });
    return out;
  }

  modal.addEventListener("change", async (e) => {
    const input = e.target.closest("[data-image-input]");
    if (!input || !input.files[0]) return;
    const box = input.closest("[data-image-field]");
    $(".img-preview", box).innerHTML = `<span>Shrinking…</span>`;
    try {
      const im = await Images.fromFile(input.files[0]);
      Object.assign(box.dataset, { imageId: im.id, w: im.w, h: im.h });
      $(".img-preview", box).innerHTML = imgTag(im.id);
      hydrateImages(box);
    } catch (err) {
      $(".img-preview", box).innerHTML = `<span class="neg">${esc(err.message || "Couldn't read that image.")}</span>`;
    }
  });

  modal.addEventListener("keydown", (e) => {
    const row = e.target.closest(".step-row");
    if (!row || e.key !== "Enter" || e.target.type !== "text") return;
    e.preventDefault();
    if (!e.target.value.trim()) return;
    row.insertAdjacentHTML("afterend", stepRowHTML());
    $("input[type=text]", row.nextElementSibling).focus();
  });

  $("#modalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (modalSubmit && modalSubmit()) modal.close();
  });
  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-add-step]")) {
      const list = $(".steps-edit", modal);
      list.insertAdjacentHTML("beforeend", stepRowHTML());
      $(".step-row:last-child input[type=text]", list).focus();
      return;
    }
    if (e.target.closest("[data-remove-step]")) { e.target.closest(".step-row").remove(); return; }
    if (e.target.closest("[data-image-remove]")) {
      const box = e.target.closest("[data-image-field]");
      Object.assign(box.dataset, { imageId: "", w: 0, h: 0 });
      $(".img-preview", box).innerHTML = "<span>No image</span>";
      e.target.closest("[data-image-remove]").remove();
      $("#modalBody").oninput && $("#modalBody").oninput();
      return;
    }
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
        { name: "clientId", label: "Client", type: "select", options: clientOptions() },
        { name: "projectId", label: "Project", type: "select", options: projectOptions(tx.projectId) },
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

  /* ── tasks: the four suits (an Eisenhower matrix) ── */
  // the four suits, keyed by quadrant (q1–q4); see js/tarot.js
  const SUIT_BY_Q = Object.fromEntries(Object.entries(Tarot.SUITS).map(([key, st]) => [st.q, { ...st, key }]));
  const UNTURNED = { key: "unturned", name: "Unturned", element: "", speed: "", axes: "Not yet placed", action: "Decide how much it matters" };
  const suitOf = (q) => SUIT_BY_Q[q] || UNTURNED;
  const suitIcon = (q, cls = "") => Tarot.icon(suitOf(q).key, cls);
  const URGENT_WITHIN = 2; // days; anything due this soon is urgent whatever was chosen

  // importance is the person's call; older tasks fall back on the priority they were given
  function isImportant(t) {
    if (t.important === true || t.important === false) return t.important;
    return t.priority === "high" ? true : t.priority === "low" ? false : undefined;
  }
  const dueSoon = (t) => !t.done && !!t.due && t.due <= stepDays(todayStr(), URGENT_WITHIN);
  const isUrgent = (t) => t.urgent === true || dueSoon(t);

  /* the suit a task sits in now: q1–q4, or "" while its importance is undecided */
  function quadrantOf(t) {
    const i = isImportant(t);
    if (i === undefined) return "";
    return i ? (isUrgent(t) ? "q1" : "q2") : isUrgent(t) ? "q3" : "q4";
  }
  /* the suit as chosen, before deadlines pull it into urgency */
  function chosenQuadrant(t) {
    const i = isImportant(t);
    if (i === undefined) return "";
    return i ? (t.urgent === true ? "q1" : "q2") : t.urgent === true ? "q3" : "q4";
  }
  const QUADRANT_FIELDS = {
    q1: { important: true, urgent: true }, q2: { important: true, urgent: false },
    q3: { important: false, urgent: true }, q4: { important: false, urgent: false },
    "": { important: null, urgent: null },
  };
  // priority is superseded once a suit is chosen
  const quadrantFields = (q) => ({ ...QUADRANT_FIELDS[q || ""], priority: "normal" });

  /* suggested order: Swords first, then Pentacles, Wands, Cups; sooner deadlines and work already
     begun go first within each. Undecided tasks wait after Wands unless they're due soon. */
  function suggestRank(t) {
    const q = quadrantOf(t);
    return { q1: 0, q2: 1, q3: 2, q4: 3 }[q] ?? (dueSoon(t) ? 0.5 : 2.5);
  }
  const progressOf = (t) => {
    const st = t.subtasks || [];
    return st.length ? st.filter((x) => x.done).length / st.length : 0;
  };
  const bySuggested = (a, b) =>
    suggestRank(a) - suggestRank(b) ||
    (a.due || "9999").localeCompare(b.due || "9999") ||
    progressOf(b) - progressOf(a) ||
    (a.createdAt || "").localeCompare(b.createdAt || "");

  function suggestReason(t) {
    const q = quadrantOf(t), today = todayStr();
    const when = !t.due ? "" : t.due < today ? "overdue" : t.due === today ? "due today" : relDay(t.due) === "tomorrow" ? "due tomorrow" : `due ${fmtDate(t.due, { month: "short", day: "numeric" })}`;
    const st = t.subtasks || [];
    const started = st.some((x) => x.done) && st.some((x) => !x.done) ? `${st.filter((x) => x.done).length} of ${st.length} steps done` : "";
    const why = {
      q1: "urgent and important",
      q2: t.due ? "important; get ahead of it" : "important, with no deadline to force it: make time before it becomes urgent",
      q3: "urgent but minor: a quick win, or hand it off",
      q4: "only once the rest is handled",
      "": dueSoon(t) ? "due soon: decide how much it matters" : "unplaced: decide how much it matters",
    }[q];
    return [suitOf(q).name, when, started, why].filter(Boolean).join(" · ");
  }

  const openTasks = () => D().tasks.filter((t) => !t.done);
  // what needs attention today: anything due by today, and everything in the Tower
  const pressingTasks = () => openTasks().filter((t) => (t.due && t.due <= todayStr()) || quadrantOf(t) === "q1").sort(bySuggested);

  function editTask(task = {}) {
    const isNew = !task.id;
    const suitOptions = [["", "Unturned · not yet placed"], ...Object.entries(SUIT_BY_Q).map(([q, a]) => [q, `${a.name} · ${a.element.toLowerCase()} · ${a.axes.toLowerCase()}`])];
    openForm({
      title: isNew ? "New Task" : "Amend Task",
      values: { scope: "personal", ...task, suit: task.suit ?? chosenQuadrant(task), subtasks: task.subtasks || [] },
      fields: [
        { name: "title", label: "What needs doing", required: true, placeholder: "e.g. send the invoice", span2: true },
        { name: "suit", label: "Suit", type: "select", options: suitOptions.map(([value, label]) => ({ value, label })), span2: true },
        { name: "suitHint", type: "note" },
        { name: "due", label: "Due", type: "date" },
        { name: "clientId", label: "Client", type: "select", options: clientOptions() },
        { name: "projectId", label: "Project", type: "select", options: projectOptions(task.projectId), span2: true },
        { name: "scope", label: "Purse", type: "segmented", options: [{ value: "personal", label: "Personal" }, { value: "business", label: "Business" }], span2: true },
        { name: "subtasks", label: "Steps", type: "steps", span2: true },
        { name: "notes", label: "Notes", type: "textarea", span2: true },
      ],
      onChange: (v, root) => {
        const hint = $("#suitHint", root);
        const lands = quadrantOf({ ...quadrantFields(v.suit), due: v.due });
        const a = suitOf(v.suit);
        hint.innerHTML = v.suit !== lands
          ? `Due within ${URGENT_WITHIN} days, so it sits in <b>${esc(suitOf(lands).name)}</b> until it's done.`
          : `${a.element ? `<span class="suit-line">${suitIcon(v.suit)} ${esc(a.element)}, ${esc(a.speed)}:</span> ` : ""}<b>${esc(a.action)}.</b> Anything due within ${URGENT_WITHIN} days counts as urgent.`;
      },
      onSubmit: (v) => {
        const { suit, suitHint, ...rest } = v;
        const { suit: _preset, ...base } = task;
        Store.upsert("tasks", { done: false, doneAt: "", ...base, ...rest, ...quadrantFields(suit) });
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

  /* steps (subtasks) live inside their task, so they sync with it */
  function updateSteps(taskId, fn) {
    const t = D().tasks.find((x) => x.id === taskId);
    if (!t) return null;
    const subtasks = fn((t.subtasks || []).map((st) => ({ ...st })));
    Store.upsert("tasks", { id: taskId, subtasks });
    return subtasks;
  }
  function toggleStep(taskId, stepId) {
    const after = updateSteps(taskId, (list) => list.map((st) => (st.id === stepId ? { ...st, done: !st.done } : st)));
    if (after && after.length && after.every((st) => st.done) && after.find((st) => st.id === stepId).done) toast("Every step done. Tick off the task? ✦");
  }
  function addStep(taskId, title) {
    title = title.trim();
    if (!title) return;
    ui.expandedTasks.add(taskId);
    updateSteps(taskId, (list) => [...list, { id: Store.uid(), title, done: false }]);
  }
  const removeStep = (taskId, stepId) => updateSteps(taskId, (list) => list.filter((st) => st.id !== stepId));

  function setQuadrant(taskId, q) {
    const t = D().tasks.find((x) => x.id === taskId);
    if (!t) return;
    Store.upsert("tasks", { id: taskId, ...quadrantFields(q) });
    const lands = quadrantOf(D().tasks.find((x) => x.id === taskId));
    toast(lands !== q && q ? `Due within ${URGENT_WITHIN} days, so it stays urgent. Change the due date to move it.` : `Moved to ${suitOf(q).name}.`);
  }

  function taskLi(t, { showArcana = true, reason = "", showProject = true } = {}) {
    const cl = clientById(t.clientId);
    const today = todayStr();
    const q = quadrantOf(t), a = suitOf(q);
    const when = t.done ? (t.doneAt ? `done ${esc(fmtDate(ymd(new Date(t.doneAt)), { month: "short", day: "numeric" }))}` : "done") : !t.due ? "" : t.due < today ? `<span class="neg">overdue · ${esc(fmtDate(t.due, { month: "short", day: "numeric" }))}</span>` : t.due === today ? `<span class="gold">today</span>` : esc(relDay(t.due) === "tomorrow" ? "tomorrow" : fmtDate(t.due));
    const meta = reason
      ? `<i>${esc(reason)}</i>`
      : [when, cl ? esc(cl.name) : "", showProject ? projectChip(t.projectId) : "", t.notes ? `<i>${esc(t.notes.length > 70 ? t.notes.slice(0, 70) + "…" : t.notes)}</i>` : ""].filter(Boolean).join(" · ");
    const steps = t.subtasks || [];
    const doneSteps = steps.filter((st) => st.done).length;
    const open = ui.expandedTasks.has(t.id);
    const arcanaTag = showArcana && !t.done ? `<span class="arcana-tag ${q || "unturned"}" title="${esc(a.name)}: ${esc(a.axes.toLowerCase())}">${suitIcon(q)}<span class="hide-sm">${esc(a.name)}</span></span>` : "";
    return `<li class="task ${t.done ? "done" : ""}" data-task="${t.id}" draggable="${t.done ? "false" : "true"}">
      <button class="check-btn" data-toggle-task="${t.id}" role="checkbox" aria-checked="${t.done ? "true" : "false"}" aria-label="${t.done ? "Mark not done" : "Mark done"}: ${esc(t.title)}"><span>✦</span></button>
      <div class="grow">
        <span class="title">${esc(t.title)}</span>${meta ? `<span class="meta">${meta}</span>` : ""}
        ${open ? `<ul class="steps-list">
            ${steps.map((st) => `<li class="${st.done ? "done" : ""}">
              <button class="check-btn sm" data-toggle-step="${t.id}:${st.id}" role="checkbox" aria-checked="${st.done}" aria-label="${st.done ? "Mark not done" : "Mark done"}: ${esc(st.title)}"><span>✦</span></button>
              <span class="step-title">${esc(st.title)}</span>
              <button class="step-x" data-remove-step-inline="${t.id}:${st.id}" aria-label="Remove step ${esc(st.title)}">✕</button></li>`).join("")}
            <li class="add"><input data-add-step-inline="${t.id}" placeholder="Add a step and press Enter…" aria-label="New step for ${esc(t.title)}"></li>
          </ul>` : ""}
      </div>
      <div class="task-side">
        ${arcanaTag}
        ${reason && !steps.length ? "" : `<button class="steps-chip ${steps.length && doneSteps === steps.length ? "all" : ""}" data-expand-task="${t.id}" aria-expanded="${open}" ${steps.length ? "" : 'aria-label="Add steps"'} title="${open ? "Hide steps" : steps.length ? "Show steps" : "Add steps"}">${steps.length ? `${doneSteps}/${steps.length} <span aria-hidden="true">${open ? "▴" : "▾"}</span><span class="sr">steps</span>` : `+<span class="hide-sm"> steps</span>`}</button>`}
        ${showArcana && !reason ? `<span class="tag ${t.scope === "business" ? "biz" : ""} hide-sm">${esc(t.scope || "personal")}</span>` : ""}
      </div>
    </li>`;
  }

  /* ── the draw: card of the day, or a fresh pull, pointing at a task of its suit ── */
  function tarotCardHTML(card, { fresh = false } = {}) {
    let art;
    if (card.major) art = `<img src="assets/icon-192.png" alt="">`;
    else if (["Page", "Knight", "Queen", "King"].includes(card.rank)) art = Tarot.icon(card.suit, "court");
    else {
      // numbered cards show their count of suit marks, like a real deck's pips
      const n = ["Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"].indexOf(card.rank) + 1;
      art = n === 1 ? Tarot.icon(card.suit, "ace") : `<span class="pips n${n}">${Tarot.icon(card.suit).repeat(n)}</span>`;
    }
    return `<div class="tarot-card ${card.major ? "major" : ""} ${card.suit} ${fresh ? "flip" : ""}" role="img" aria-label="${esc(card.name)}">
      <span class="tc-mark">${esc(Tarot.markOf(card))}</span>
      <span class="tc-corner">${Tarot.icon(card.suit)}</span>
      <span class="tc-art">${art}</span>
      <span class="tc-name">${esc(card.name)}</span>
    </div>`;
  }

  function drawnTask(card, taskId) {
    const q = Tarot.SUITS[card.suit].q;
    const pool = openTasks().filter((t) => ui.agendaScope === "all" || (t.scope || "personal") === ui.agendaScope).sort(bySuggested);
    const inSuit = pool.filter((t) => quadrantOf(t) === q);
    const kept = taskId && inSuit.find((t) => t.id === taskId);
    return { task: kept || inSuit[0] || pool[0] || null, inSuit: !!(kept || inSuit[0]) };
  }

  function drawPanel() {
    const card = ui.draw ? Tarot.DECK.find((c) => c.id === ui.draw.cardId) : Tarot.cardOfDay(todayStr());
    const st = Tarot.SUITS[card.suit];
    const { task, inSuit } = drawnTask(card, ui.draw && ui.draw.taskId);
    const fresh = !!(ui.draw && ui.draw.fresh);
    if (ui.draw) ui.draw.fresh = false;
    const suggestion = task
      ? `<p class="sub-h">${inSuit ? `The ${esc(st.name.toLowerCase())} suggest` : `No ${esc(st.name.toLowerCase())} to hand; the deck turns to`}</p>
         <ul class="list tasks">${taskLi(task, { reason: suggestReason(task) })}</ul>`
      : `<p class="advice">Nothing left to do. The cards say: rest.</p>`;
    return `<div class="card draw-panel">
      <div class="card-head"><h2>The draw</h2><small>${ui.draw ? "drawn just now" : "card of the day"}</small></div>
      <div class="draw">
        ${tarotCardHTML(card, { fresh })}
        <div class="reading">
          <h3>${esc(card.name)}</h3>
          <p class="element">${Tarot.icon(card.suit)} ${esc(st.element)} · ${esc(st.name)} · ${esc(st.speed)}</p>
          <p class="meaning">${esc(card.meaning)}</p>
          <p class="advice">${card.major ? `A major card, of ${esc(st.element.toLowerCase())}. ` : ""}${esc(st.name)} ask you to <i>${esc(st.action.charAt(0).toLowerCase() + st.action.slice(1))}</i>.</p>
          ${suggestion}
          <div class="toolbar" style="margin:12px 0 0">
            <button class="btn sm" data-act="draw-card">${ui.draw ? "Draw another" : "Draw a card"}</button>
            ${ui.draw ? `<button class="btn ghost sm" data-act="draw-reset">Card of the day</button>` : ""}
          </div>
        </div>
      </div>
    </div>`;
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
    cabinetShelf: "all",
    workTab: ["projects", "timeline", "content"].includes(prefs.workTab) ? prefs.workTab : "projects",
    workStatus: "active",
    timelineAll: false,
    contentView: prefs.contentView === "pipeline" ? "pipeline" : "calendar",
    contentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    contentDay: todayStr(),
    contentProject: "all",
    cabinetSearch: "",
    agendaView: prefs.agendaView === "list" ? "list" : "matrix",
    expandedTasks: new Set(),
    draw: null, // { cardId, taskId, fresh } after drawing; null shows the card of the day
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
                  ? `<ul class="list tasks">${list.slice(0, 6).map((t) => taskLi(t)).join("")}</ul>${list.length > 6 ? `<p class="more-link"><a href="#agenda">${list.length - 6} more</a></p>` : ""}`
                  : empty("☑", D().tasks.some((t) => !t.done) ? "Nothing due today." : "No tasks yet. Add one in the Agenda.");
              })()}
            </div>
            ${(() => {
              const soon = stepDays(today, 14);
              const items = [
                ...D().projects.filter((p) => ACTIVE_STATUS.has(p.status)).flatMap((p) => (p.milestones || []).filter((m) => !m.done && m.date && m.date <= soon).map((m) => ({ date: m.date, html: `<li data-goto="workings/${esc(p.id)}" style="cursor:pointer">${dateChip(m.date)}<div class="grow"><span class="title">◆ ${esc(m.title)}</span><span class="meta">${m.date < today ? `<span class="neg">past its date</span> · ` : ""}milestone · ${esc(p.name)}</span></div></li>` }))),
                ...D().content.filter((c) => c.status !== "posted" && c.date && c.date <= soon && c.date >= stepDays(today, -7)).map((c) => ({ date: c.date, html: contentLi(c) })),
              ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
              if (!items.length && !D().projects.length) return "";
              return `<div class="card">
                <div class="card-head"><h2>Workings</h2><a href="#workings">workings →</a></div>
                ${items.length ? `<ul class="list">${items.map((x) => x.html).join("")}</ul>` : empty("⚗", "No milestones or posts in the next two weeks.")}
              </div>`;
            })()}
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
      $$("[data-goto]", root).forEach((li) => li.addEventListener("click", () => (location.hash = li.dataset.goto)));
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
          : [cl && esc(cl.name), projectChip(t.projectId), t.notes && esc(t.notes)].filter(Boolean).join(" · ");
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
      if (["ledgerView", "agendaView", "workTab", "contentView"].includes(seg.dataset.ui)) { prefs[seg.dataset.ui] = b.dataset.value; savePrefs(); }
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
      const open = all.filter((t) => !t.done).sort(bySuggested);
      const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
      const doneThisWeek = D().tasks.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) > stepDays(today, -7)).length;
      const seg = (name, cur, opts) => `<div class="segmented" data-ui="${name}">${opts.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" data-value="${v}">${l}</button>`).join("")}</div>`;
      const next = open.slice(0, 3);

      return `
        <form class="card quick-add" id="quickAdd" autocomplete="off">
          <input name="title" placeholder="Add a task and press Enter…" aria-label="New task" required>
          <input name="due" type="date" aria-label="Due date" title="Due date (optional)">
          <select name="suit" aria-label="Suit">
            <option value="">Unturned</option>
            ${Object.entries(SUIT_BY_Q).map(([q, a]) => `<option value="${q}">${a.name} · ${a.axes.toLowerCase()}</option>`).join("")}
          </select>
          <button class="btn primary" type="submit">Add</button>
        </form>
        <div class="toolbar" style="margin-top:16px">
          ${seg("agendaView", ui.agendaView, [["matrix", "Suits"], ["list", "By date"]])}
          ${seg("agendaScope", ui.agendaScope, [["all", "All"], ["personal", "Personal"], ["business", "Business"]])}
          <span class="spacer"></span>
          <label class="check"><input type="checkbox" id="agendaShowDone" ${ui.agendaShowDone ? "checked" : ""}> Show finished</label>
        </div>
        <div class="grid cols-4 stats" style="margin-bottom:18px">
          <div class="card stat"><div class="label">Open</div><div class="value">${open.length}</div></div>
          <div class="card stat"><div class="label">In Swords</div><div class="value ${open.some((t) => quadrantOf(t) === "q1") ? "neg" : ""}">${open.filter((t) => quadrantOf(t) === "q1").length}</div></div>
          <div class="card stat"><div class="label">Overdue</div><div class="value ${open.some((t) => t.due && t.due < today) ? "neg" : ""}">${open.filter((t) => t.due && t.due < today).length}</div></div>
          <div class="card stat"><div class="label">Done this week</div><div class="value pos">${doneThisWeek}</div></div>
        </div>
        <div class="grid split-even">
          ${next.length ? `<div class="card next-up">
            <div class="card-head"><h2>Next up</h2><small>suggested order</small></div>
            <ol class="list tasks numbered">${next.map((t) => taskLi(t, { reason: suggestReason(t) })).join("")}</ol>
          </div>` : ""}
          ${drawPanel()}
        </div>
        ${!open.length ? `<div class="card">${empty("☑", all.length ? "Everything's done. Rest a while." : "No tasks yet. Add one above.")}</div>`
          : ui.agendaView === "list" ? agendaByDate(open, today, week) : agendaMatrix(open)}
        ${ui.agendaShowDone && done.length ? `<div class="card" style="margin-top:18px">
          <div class="card-head"><h2>Finished</h2><small>${done.length}</small></div>
          <ul class="list tasks">${done.slice(0, 50).map((t) => taskLi(t)).join("")}</ul>
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
          title, due: f.get("due") || "", scope: ui.agendaScope === "business" ? "business" : "personal",
          clientId: "", notes: "", done: false, doneAt: "", subtasks: [], ...quadrantFields(f.get("suit") || ""),
        });
        toast("Added to the agenda.");
        $("#quickAdd input[name=title]").focus();
      });
      // drag a task onto another suit to move it (pointer devices; on touch, use the form)
      $$("[data-quadrant]", root).forEach((zone) => {
        zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drop"); });
        zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drop"); });
        zone.addEventListener("drop", (e) => {
          e.preventDefault();
          zone.classList.remove("drop");
          const id = e.dataTransfer.getData("text/x-task");
          if (id) setQuadrant(id, zone.dataset.quadrant);
        });
      });
      $$("li.task[draggable=true]", root).forEach((li) => li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/x-task", li.dataset.task);
        e.dataTransfer.effectAllowed = "move";
      }));
    },
  };

  function agendaMatrix(open) {
    const by = { q1: [], q2: [], q3: [], q4: [], "": [] };
    open.forEach((t) => by[quadrantOf(t)].push(t));
    const cell = (q) => {
      const a = suitOf(q), list = by[q];
      return `<section class="card arcana ${q || "unturned"}" data-quadrant="${q}" aria-label="${esc(a.name)}: ${esc(a.axes)}">
        <header class="arcana-head">
          <span class="arcana-glyph">${suitIcon(q)}</span>
          <div class="grow"><h2>${esc(q ? a.name : "Unturned cards")}${a.element ? ` <span class="num">${esc(a.element)} · ${esc(a.speed)}</span>` : ""}</h2><small>${esc(a.axes)} · <i>${esc(a.action.toLowerCase())}</i></small></div>
          <span class="count">${list.length}</span>
          <button class="icon-btn add-to" data-add-task-q="${q}" aria-label="Add a task to ${esc(a.name)}">+</button>
        </header>
        ${list.length ? `<ul class="list tasks">${list.map((t) => taskLi(t, { showArcana: false })).join("")}</ul>` : `<p class="arcana-empty">${q === "q1" ? "No swords drawn. ✦" : "Empty. Drag a task here."}</p>`}
      </section>`;
    };
    return `${by[""].length ? cell("") : ""}
      <div class="matrix">
        <div class="axis top hide-sm"><span>Urgent</span><span>Not urgent</span></div>
        <div class="axis side hide-sm"><span>Important</span><span>Not important</span></div>
        <div class="matrix-grid">${cell("q1")}${cell("q2")}${cell("q3")}${cell("q4")}</div>
      </div>`;
  }

  function agendaByDate(open, today, week) {
    const groups = [
      ["Overdue", "neg", open.filter((t) => t.due && t.due < today)],
      ["Today", "gold", open.filter((t) => t.due === today)],
      ["This week", "", open.filter((t) => t.due > today && t.due <= week)],
      ["Later", "", open.filter((t) => t.due > week)],
      ["Someday", "", open.filter((t) => !t.due)],
    ].filter(([, , list]) => list.length);
    return `<div class="grid">${groups.map(([label, cls, list]) => `
      <div class="card">
        <div class="card-head"><h2 class="${cls}">${label}</h2><small>${list.length}</small></div>
        <ul class="list tasks">${list.map((t) => taskLi(t)).join("")}</ul>
      </div>`).join("")}</div>`;
  }

  /* ── the Cabinet: ideas, images, notes and links ── */
  const INKS = [["", "None"], ["gold", "Gold"], ["rose", "Rose"], ["plum", "Plum"], ["sage", "Sage"], ["blue", "Blue"]];
  const shelvesInUse = () => [...new Set(D().ideas.map((i) => (i.shelf || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const parseTags = (txt) => [...new Set(String(txt || "").split(/[,#]/).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const URL_RE = /^https?:\/\/\S+$/i;
  const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const currentShelf = () => (ui.cabinetShelf && ui.cabinetShelf !== "all" && ui.cabinetShelf !== "none" ? ui.cabinetShelf : "");

  function newIdea(fields) {
    Store.upsert("ideas", { title: "", text: "", link: "", imageId: "", imageW: 0, imageH: 0, imageGist: "", tags: [], ink: "", pinned: false, shelf: currentShelf(), ...fields });
  }

  async function addImageIdeas(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return;
    toast(imgs.length === 1 ? "Shrinking the image…" : `Shrinking ${imgs.length} images…`);
    let added = 0;
    for (const f of imgs) {
      try {
        const im = await Images.fromFile(f);
        newIdea({ imageId: im.id, imageW: im.w, imageH: im.h, title: (f.name && !/^image\.\w+$/i.test(f.name)) ? f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") : "" });
        added++;
      } catch { /* skip files the browser can't read */ }
    }
    toast(added ? `${added} image${added === 1 ? "" : "s"} added to the cabinet.` : "Couldn't read that image.");
  }

  function ideaToTask(v) {
    const firstLine = (v.text || "").split("\n").find((l) => l.trim()) || "";
    const title = (v.title || firstLine || domainOf(v.link) || "An idea from the cabinet").trim().slice(0, 120);
    const notes = [v.title ? v.text : v.text.split("\n").slice(1).join("\n"), v.link].map((x) => (x || "").trim()).filter(Boolean).join("\n");
    Store.upsert("tasks", { title, notes, due: "", scope: "personal", clientId: "", done: false, doneAt: "", subtasks: [], ...quadrantFields("") });
    toast("Added to the Agenda as an unturned card.");
  }

  function editIdea(idea = {}) {
    const isNew = !idea.id;
    function saveIdea(v, quiet = false) {
      if (!v.title && !v.text && !v.link && !v.image) return "Add a title, a note, a link or an image.";
      if (v.link && !URL_RE.test(v.link)) v.link = /^[\w-]+(\.[\w-]+)+/.test(v.link) ? `https://${v.link}` : v.link;
      const im = v.image;
      const record = {
        ...idea, title: v.title, text: v.text, link: v.link, shelf: v.shelf, tags: parseTags(v.tags), ink: v.ink, pinned: v.pinned === "yes",
        projectId: v.projectId || "",
        imageId: im ? im.id : "", imageW: im ? im.w : 0, imageH: im ? im.h : 0,
        // a new or removed picture needs a fresh upload; the old copy is cleaned up later
        imageGist: im && im.id === idea.imageId ? idea.imageGist || "" : "",
      };
      if (idea.imageId && (!im || im.id !== idea.imageId)) Images.del(idea.imageId).catch(() => {});
      Store.upsert("ideas", record);
      if (!quiet) toast(isNew ? "Added to the cabinet." : "Saved.");
    }
    openForm({
      title: isNew ? "New Curiosity" : "Curiosity",
      values: { ...idea, image: idea.imageId ? { id: idea.imageId, w: idea.imageW, h: idea.imageH } : null, tags: (idea.tags || []).join(", "), ink: idea.ink || "", pinned: idea.pinned ? "yes" : "no", shelf: idea.shelf ?? currentShelf() },
      fields: [
        { name: "title", label: "Title", placeholder: "optional", span2: true },
        { name: "image", label: "Image", type: "image", span2: true },
        { name: "text", label: "Notes", type: "textarea", placeholder: "the idea, in your own words…", span2: true },
        { name: "link", label: "Link", type: "url", placeholder: "https://…", span2: true },
        { name: "shelf", label: "Shelf", placeholder: "e.g. Salon, App ideas", datalist: shelvesInUse() },
        { name: "tags", label: "Tags", placeholder: "comma separated" },
        { name: "ink", label: "Ink", type: "segmented", options: INKS.map(([value, label]) => ({ value, label })), span2: true },
        { name: "pinned", label: "Pinned to the top", type: "segmented", options: [{ value: "no", label: "No" }, { value: "yes", label: "Pinned" }] },
        { name: "projectId", label: "Project", type: "select", options: projectOptions(idea.projectId) },
      ],
      extra: [
        { label: "Make it a task", onClick: (v) => {
          if (!v.title && !v.text && !v.link) { $("#formError").textContent = "Write something first."; return false; }
          ideaToTask(v);
          return true;
        } },
        ...(idea.projectId ? [] : [{ label: "Start a working", onClick: (v) => {
          if (!v.title && !v.text) { $("#formError").textContent = "Give it a title or a note first."; return false; }
          const firstLine = (v.text || "").split("\n").find((l) => l.trim()) || "";
          const id = Store.uid();
          Store.upsert("projects", {
            id, name: (v.title || firstLine).trim().slice(0, 80), description: v.text || "", status: "seed", ink: v.ink || "",
            start: todayStr(), target: "", budget: 0, milestones: [], createdAt: new Date().toISOString(),
          });
          const err = saveIdea({ ...v, projectId: id }, true);
          if (err) { $("#formError").textContent = err; return false; }
          toast("A new working begins. ✦");
          location.hash = `workings/${id}`;
          return true;
        } }]),
      ],
      onSubmit: (v) => saveIdea(v),
      onDelete: isNew ? null : () => {
        if (idea.imageId) Images.del(idea.imageId).catch(() => {});
        Store.remove("ideas", idea.id);
        toast("Removed from the cabinet.");
      },
    });
  }

  function ideaCard(i) {
    const ratio = i.imageW && i.imageH ? `${i.imageW} / ${i.imageH}` : "4 / 3";
    const text = (i.text || "").trim();
    return `<article class="scrap ${i.ink ? `ink-${esc(i.ink)}` : ""} ${i.pinned ? "pinned" : ""}" data-idea="${i.id}" tabindex="0" aria-label="${esc(i.title || text.slice(0, 60) || "Image")}">
      ${i.pinned ? `<span class="pin" title="Pinned">✦</span>` : ""}
      ${i.imageId ? `<div class="scrap-img" style="aspect-ratio:${ratio}">${imgTag(i.imageId, i.title)}</div>` : ""}
      ${i.title || text || i.link ? `<div class="scrap-body">
        ${i.title ? `<h3>${esc(i.title)}</h3>` : ""}
        ${text ? `<p class="scrap-text">${esc(text)}</p>` : ""}
        ${i.link ? `<a class="scrap-link" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">↗ ${esc(domainOf(i.link))}</a>` : ""}
      </div>` : ""}
      <div class="scrap-foot">
        ${projectChip(i.projectId)}
        ${i.shelf ? `<span class="tag shelf">${esc(i.shelf)}</span>` : ""}
        ${(i.tags || []).map((t) => `<span class="hashtag">#${esc(t)}</span>`).join("")}
        <span class="when">${esc(fmtDate(ymd(new Date(i.createdAt || Date.now())), { month: "short", day: "numeric" }))}</span>
      </div>
    </article>`;
  }

  views.cabinet = {
    title: "Cabinet",
    actions: () => `<button class="btn primary" data-act="add-idea">+ Curiosity</button>`,
    render() {
      const q = ui.cabinetSearch.toLowerCase();
      const shelves = shelvesInUse();
      const hasUnshelved = D().ideas.some((i) => !(i.shelf || "").trim());
      if (ui.cabinetShelf !== "all" && ui.cabinetShelf !== "none" && !shelves.includes(ui.cabinetShelf)) ui.cabinetShelf = "all";
      const list = D().ideas
        .filter((i) => ui.cabinetShelf === "all" || (ui.cabinetShelf === "none" ? !(i.shelf || "").trim() : (i.shelf || "").trim() === ui.cabinetShelf))
        .filter((i) => !q || [i.title, i.text, i.link, i.shelf, ...(i.tags || [])].some((x) => x && x.toLowerCase().includes(q)))
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || "").localeCompare(a.createdAt || ""));
      const chip = (v, label, n) => `<button class="shelf-chip ${ui.cabinetShelf === v ? "on" : ""}" data-shelf="${esc(v)}">${esc(label)}<span>${n}</span></button>`;
      return `
        <form class="card capture" id="capture" autocomplete="off">
          <textarea name="text" rows="1" placeholder="Jot down an idea, or paste a link…" aria-label="New idea"></textarea>
          <div class="capture-actions">
            <label class="btn ghost" title="Add images">Image<input type="file" accept="image/*" multiple id="captureImages" hidden></label>
            <button class="btn primary" type="submit">Keep it</button>
          </div>
          <p class="capture-hint hide-sm">On a computer you can also paste an image (Ctrl/⌘ V) or drop files anywhere on this page.</p>
        </form>
        <div class="toolbar" style="margin-top:16px">
          <div class="shelves">
            ${chip("all", "All", D().ideas.length)}
            ${shelves.map((sh) => chip(sh, sh, D().ideas.filter((i) => (i.shelf || "").trim() === sh).length)).join("")}
            ${hasUnshelved && shelves.length ? chip("none", "Unshelved", D().ideas.filter((i) => !(i.shelf || "").trim()).length) : ""}
          </div>
          <span class="spacer"></span>
          <input type="search" id="cabinetSearch" placeholder="Search the cabinet…" value="${esc(ui.cabinetSearch)}" style="max-width:240px">
        </div>
        ${list.length
          ? `<div class="board">${list.map(ideaCard).join("")}</div>`
          : `<div class="card">${empty("✧", D().ideas.length ? "Nothing on this shelf matches." : "The cabinet is empty. Keep ideas, images, links and notes here: for the business, for the future, for this app.")}</div>`}`;
    },
    bind(root) {
      const form = $("#capture", root), ta = $("textarea", form);
      const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 260) + "px"; };
      ta.addEventListener("input", grow);
      // Enter keeps it; Shift+Enter starts a new line
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        if (URL_RE.test(text)) newIdea({ link: text, title: domainOf(text) });
        else newIdea({ text });
        toast("Kept in the cabinet.");
        $("#capture textarea").focus();
      });
      $("#captureImages", root).addEventListener("change", (e) => addImageIdeas(e.target.files));
      $$("[data-shelf]", root).forEach((b) => b.addEventListener("click", () => { ui.cabinetShelf = b.dataset.shelf; render(); }));
      const s = $("#cabinetSearch", root);
      s.addEventListener("input", () => { ui.cabinetSearch = s.value; render(); const n = $("#cabinetSearch"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
      $$("[data-idea]", root).forEach((card) => {
        const open = () => editIdea(D().ideas.find((i) => i.id === card.dataset.idea));
        card.addEventListener("click", (e) => { if (!e.target.closest("a")) open(); });
        card.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      });
    },
  };

  // paste an image (or a link) anywhere on the Cabinet page
  document.addEventListener("paste", (e) => {
    if (currentView() !== "cabinet" || $("#modal").open) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); addImageIdeas(files); return; }
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    const text = (e.clipboardData?.getData("text") || "").trim();
    if (!typing && URL_RE.test(text)) { e.preventDefault(); newIdea({ link: text, title: domainOf(text) }); toast("Link kept in the cabinet."); }
  });
  // and drop image files onto it
  document.addEventListener("dragover", (e) => {
    if (currentView() !== "cabinet" || ![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    document.body.classList.add("dropping");
  });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
  document.addEventListener("drop", (e) => {
    document.body.classList.remove("dropping");
    if (currentView() !== "cabinet" || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addImageIdeas(e.dataTransfer.files);
  });

  /* ── Workings: projects, their timeline, and the content calendar ── */
  const PROJECT_STATUS = [
    ["seed", "Seed", "an idea, not yet begun"],
    ["brewing", "Brewing", "planning and gathering"],
    ["working", "Working", "in progress"],
    ["resting", "Resting", "paused for now"],
    ["complete", "Complete", "done"],
  ];
  const ACTIVE_STATUS = new Set(["seed", "brewing", "working"]);
  const CONTENT_STATUS = [["idea", "Idea"], ["drafting", "Drafting"], ["ready", "Ready"], ["scheduled", "Scheduled"], ["posted", "Posted"]];
  const PLATFORMS = ["Instagram", "TikTok", "Pinterest", "YouTube", "Facebook", "Threads", "Newsletter", "Blog", "Website"];
  const FORMATS = ["Post", "Carousel", "Reel", "Story", "Video", "Live", "Article", "Email", "Pin"];
  const labelOf = (list, k) => (list.find(([v]) => v === k) || [, k || ""])[1];
  const projectById = (id) => D().projects.find((p) => p.id === id);
  const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);

  // active projects first; a finished one still shows if the record is already linked to it
  function projectOptions(current = "") {
    const list = D().projects
      .filter((p) => ACTIVE_STATUS.has(p.status) || p.id === current)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [{ value: "", label: "— none —" }, ...list.map((p) => ({ value: p.id, label: p.name }))];
  }
  const projectChip = (id) => {
    const p = id && projectById(id);
    return p ? `<a class="proj-chip ink-${esc(p.ink || "")}" href="#workings/${esc(p.id)}" title="Project: ${esc(p.name)}">⚗ ${esc(p.name)}</a>` : "";
  };

  function projectStats(p) {
    const tasks = D().tasks.filter((t) => t.projectId === p.id);
    const ms = (p.milestones || []).slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    const content = D().content.filter((c) => c.projectId === p.id);
    const txs = D().transactions.filter((t) => t.projectId === p.id);
    const spent = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const earned = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const doneT = tasks.filter((t) => t.done).length, doneM = ms.filter((m) => m.done).length;
    const total = tasks.length + ms.length;
    const progress = p.status === "complete" ? 1 : total ? (doneT + doneM) / total : 0;
    const nextMs = ms.find((m) => !m.done);
    return { tasks, ms, content, txs, spent, earned, doneT, doneM, progress, nextMs };
  }

  const dateRange = (p) => {
    if (!p.start && !p.target) return "no dates yet";
    const f = (d) => fmtDate(d, { month: "short", day: "numeric", year: parseYmd(d).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
    if (p.start && p.target) return `${f(p.start)} → ${f(p.target)}`;
    return p.start ? `from ${f(p.start)}` : `by ${f(p.target)}`;
  };

  function editProject(p = {}) {
    const isNew = !p.id;
    openForm({
      title: isNew ? "Begin a Working" : "Amend the Working",
      values: { status: "seed", ink: "", start: todayStr(), ...p },
      fields: [
        { name: "name", label: "Name", required: true, placeholder: "e.g. The Iris Wrap Dress", span2: true },
        { name: "description", label: "Intention", type: "textarea", placeholder: "what it is, and why it matters", span2: true },
        { name: "status", label: "Stage", type: "select", options: PROJECT_STATUS.map(([value, label, hint]) => ({ value, label: `${label} · ${hint}` })), span2: true },
        { name: "start", label: "Begins", type: "date" },
        { name: "target", label: "Aiming for", type: "date" },
        { name: "budget", label: "Budget", type: "number", placeholder: "optional" },
        { name: "ink", label: "Ink", type: "segmented", options: INKS.map(([value, label]) => ({ value, label })), span2: true },
      ],
      onSubmit: (v) => {
        if (v.start && v.target && v.target < v.start) return "It has to end after it begins.";
        const id = p.id || Store.uid();
        Store.upsert("projects", { milestones: [], ...p, ...v, id, budget: v.budget === "" ? 0 : v.budget, ...(isNew ? { createdAt: new Date().toISOString() } : {}) });
        toast(isNew ? "A new working begins. ✦" : "Saved.");
        if (isNew) location.hash = `workings/${id}`;
      },
      onDelete: isNew ? null : () => {
        Store.remove("projects", p.id);
        toast("Working removed. Its tasks, ideas, posts and entries are kept, unlinked.");
        location.hash = "workings";
      },
    });
  }

  /* milestones live inside their project, like steps inside a task */
  function updateMilestones(projectId, fn) {
    const p = projectById(projectId);
    if (!p) return;
    Store.upsert("projects", { id: projectId, milestones: fn((p.milestones || []).map((m) => ({ ...m }))) });
  }
  function editMilestone(projectId, m) {
    openForm({
      title: "Milestone",
      values: { done: m.done ? "yes" : "no", ...m },
      fields: [
        { name: "title", label: "Milestone", required: true, span2: true },
        { name: "date", label: "When", type: "date" },
        { name: "done", label: "Reached", type: "segmented", options: [{ value: "no", label: "Not yet" }, { value: "yes", label: "Reached" }] },
      ],
      onSubmit: (v) => { updateMilestones(projectId, (list) => list.map((x) => (x.id === m.id ? { ...x, title: v.title, date: v.date, done: v.done === "yes" } : x))); },
      onDelete: () => { updateMilestones(projectId, (list) => list.filter((x) => x.id !== m.id)); toast("Milestone removed."); },
    });
  }

  function editContent(c = {}) {
    const isNew = !c.id;
    openForm({
      title: isNew ? "Plan a Post" : "Post",
      values: { status: "idea", date: "", ...c },
      fields: [
        { name: "title", label: "What it is", required: true, placeholder: "e.g. velvet swatch reveal", span2: true },
        { name: "date", label: "Goes out", type: "date" },
        { name: "time", label: "At", type: "time" },
        { name: "platform", label: "Where", placeholder: "Instagram, TikTok…", datalist: PLATFORMS },
        { name: "format", label: "Format", placeholder: "Reel, carousel…", datalist: FORMATS },
        { name: "status", label: "Stage", type: "select", options: CONTENT_STATUS.map(([value, label]) => ({ value, label })) },
        { name: "projectId", label: "Project", type: "select", options: projectOptions(c.projectId) },
        { name: "notes", label: "Caption & notes", type: "textarea", placeholder: "hook, caption, shot list, hashtags…", span2: true },
        { name: "link", label: "Link once it's posted", type: "url", placeholder: "https://…", span2: true },
      ],
      onSubmit: (v) => {
        Store.upsert("content", { ...c, ...v });
        toast(isNew ? "Added to the content calendar." : "Saved.");
      },
      onDelete: isNew ? null : () => { Store.remove("content", c.id); toast("Post removed."); },
    });
  }

  /* paste a plan into the content calendar: preview, pick what to keep, link it to a working */
  let postDraft = { text: "", projectId: "", status: "idea" };

  function openPostImport() {
    modal.classList.add("wide");
    $("#modalTitle").textContent = "Import Posts";
    $("#modalBody").oninput = null;
    if (!postDraft.projectId && ui.contentProject !== "all" && ui.contentProject !== "none") postDraft.projectId = ui.contentProject;
    postImportStep1();
    modal.showModal();
    $(".import-text", modal).focus();
  }

  function postImportStep1() {
    $("#modalBody").innerHTML = `
      <p class="import-help">Paste a plan, one post per row, from a spreadsheet or as comma-separated text. With a header row such as
        <code>date,platform,format,title,notes</code> the columns can come in any order (<code>time</code> and <code>status</code> work too);
        without one, they're read in that order. Dates can be <code>2026-11-02</code> or <code>11/2</code>; rows without a date land under “not yet scheduled”.</p>
      <textarea class="import-text" spellcheck="false" placeholder="date,platform,format,title,notes&#10;2026-11-02,Instagram,Carousel,Something is being made,Ask: follow along">${esc(postDraft.text)}</textarea>
      <div class="form-grid" style="margin-top:12px">
        <label class="field">Link every post to<select id="postProject">${projectOptions(postDraft.projectId).map((o) => `<option value="${esc(o.value)}" ${o.value === postDraft.projectId ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
        <label class="field">Stage, where none is given<select id="postStatus">${CONTENT_STATUS.map(([v, l]) => `<option value="${v}" ${v === postDraft.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <p class="form-error" id="formError"></p>`;
    $("#modalFoot").innerHTML = `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Preview</button>`;
    const ta = $(".import-text", modal);
    ta.addEventListener("input", () => (postDraft.text = ta.value));
    $("#postProject", modal).addEventListener("change", (e) => (postDraft.projectId = e.target.value));
    $("#postStatus", modal).addEventListener("change", (e) => (postDraft.status = e.target.value));
    modalSubmit = () => {
      const rows = Importer.parsePosts(postDraft.text, todayStr()).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
      if (!rows.length) { $("#formError").textContent = "Paste some rows first."; return false; }
      postImportStep2(rows);
      return false;
    };
  }

  function postImportStep2(rows) {
    const key = (c) => `${c.date}|${(c.title || "").trim().toLowerCase()}`;
    const existing = new Set(D().content.map(key));
    rows.forEach((r) => { r.duplicate = r.ok && existing.has(key(r)); r.include = r.ok && !r.duplicate; });
    const proj = projectById(postDraft.projectId);
    const render = () => {
      const n = rows.filter((r) => r.include).length;
      const dupes = rows.filter((r) => r.duplicate).length, bad = rows.filter((r) => !r.ok).length;
      $(".import-summary", modal).innerHTML = `<span><b>${n}</b> of ${rows.length} posts selected</span>
        ${proj ? `<span>linked to ${projectChip(proj.id)}</span>` : ""}
        ${dupes ? `<span class="neg">${dupes} already in the calendar</span>` : ""}${bad ? `<span class="neg">${bad} unreadable</span>` : ""}`;
      $("[data-import-go]", modal).textContent = `Import ${n}`;
      $("[data-import-go]", modal).disabled = !n;
    };
    $("#modalBody").innerHTML = `
      <div class="import-summary"></div>
      <div class="import-preview"><table>
        <thead><tr><th></th><th>Date</th><th>Post</th><th class="hide-sm">Where</th><th class="hide-sm">Notes</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="${r.include ? "" : "skip"}">
          <td><input type="checkbox" data-row="${i}" ${r.include ? "checked" : ""} ${r.ok ? "" : "disabled"} style="width:auto" aria-label="Include ${esc(r.title)}"></td>
          <td style="white-space:nowrap">${r.date ? fmtDate(r.date, { weekday: "short", month: "short", day: "numeric" }) : "<small>unscheduled</small>"}${r.time ? ` <small>${esc(fmtTime(r.time))}</small>` : ""}</td>
          <td>${esc(r.title || r.raw.join(" "))}${!r.ok ? ` <span class="tag err">${esc(r.error)}</span>` : r.duplicate ? ` <span class="tag dupe">already planned</span>` : ""}
            <small class="show-sm"><br>${esc([r.platform, r.format].filter(Boolean).join(" · "))}</small></td>
          <td class="hide-sm">${esc([r.platform, r.format].filter(Boolean).join(" · "))}${r.status ? ` <span class="tag cstatus ${esc(r.status)}">${esc(labelOf(CONTENT_STATUS, r.status))}</span>` : ""}</td>
          <td class="note hide-sm">${esc(r.notes)}</td>
        </tr>`).join("")}</tbody></table></div>
      <p class="form-error" id="formError"></p>`;
    $("#modalFoot").innerHTML = `<button type="button" class="btn ghost" data-import-back>← Back</button><span class="spacer"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary" data-import-go>Import</button>`;
    $(".import-preview tbody", modal).addEventListener("change", (e) => {
      const i = e.target.dataset.row;
      if (i === undefined) return;
      rows[i].include = e.target.checked;
      e.target.closest("tr").classList.toggle("skip", !e.target.checked);
      render();
    });
    $("[data-import-back]", modal).addEventListener("click", postImportStep1);
    render();
    modalSubmit = () => {
      const chosen = rows.filter((r) => r.include);
      if (!chosen.length) return false;
      // show the month the plan starts in (set first: each save redraws the page)
      const first = chosen.map((r) => r.date).filter(Boolean).sort()[0];
      if (first) { ui.contentMonth = new Date(+first.slice(0, 4), +first.slice(5, 7) - 1, 1); ui.contentDay = first; }
      chosen.forEach((r) => Store.upsert("content", {
        title: r.title, date: r.date, time: r.time, platform: r.platform, format: r.format,
        status: r.status || postDraft.status, projectId: postDraft.projectId, notes: r.notes, link: "",
      }));
      postDraft = { ...postDraft, text: "" };
      toast(`${chosen.length} post${chosen.length === 1 ? "" : "s"} added to the content calendar.`);
      return true;
    };
  }

  const contentLi = (c, { showProject = true } = {}) => `<li data-content="${c.id}" style="cursor:pointer">
      ${c.date ? dateChip(c.date) : `<div class="date-chip undated"><span class="m">—</span><span class="d">?</span></div>`}
      <div class="grow"><span class="title">${esc(c.title)}</span>
        <span class="meta">${[c.platform, c.format].filter(Boolean).map(esc).join(" · ") || "<i>platform not set</i>"}${c.time ? ` · ${esc(fmtTime(c.time))}` : ""}${showProject && c.projectId ? ` · ${projectChip(c.projectId)}` : ""}</span></div>
      <span class="tag cstatus ${esc(c.status || "idea")}">${esc(labelOf(CONTENT_STATUS, c.status || "idea"))}</span>
    </li>`;

  function projectCard(p) {
    const st = projectStats(p), pct = Math.round(st.progress * 100);
    return `<article class="card project-card ink-${esc(p.ink || "")}" data-open-project="${p.id}" tabindex="0">
      <div class="project-head"><h3>${esc(p.name)}</h3><span class="tag pstatus ${esc(p.status)}">${esc(labelOf(PROJECT_STATUS, p.status))}</span></div>
      ${p.description ? `<p class="project-desc">${esc(p.description)}</p>` : ""}
      <div class="bar"><span style="width:${pct}%"></span></div>
      <p class="project-meta"><b>${pct}%</b> · ${st.doneM}/${st.ms.length} milestones · ${st.doneT}/${st.tasks.length} tasks · ${st.content.length} post${st.content.length === 1 ? "" : "s"}</p>
      <p class="project-meta">${esc(dateRange(p))}${st.nextMs ? ` · next: <span class="${st.nextMs.date && st.nextMs.date < todayStr() ? "neg" : "gold"}">${esc(st.nextMs.title)}</span>${st.nextMs.date ? `, ${esc(relDay(st.nextMs.date))}` : ""}` : ""}</p>
      ${p.budget ? `<p class="project-meta">Spent ${money(st.spent)} of ${money(p.budget)}</p>` : st.spent ? `<p class="project-meta">Spent ${money(st.spent)}</p>` : ""}
    </article>`;
  }

  /* a project's own page */
  function projectPage(p) {
    const st = projectStats(p), pct = Math.round(st.progress * 100), today = todayStr();
    const openTasksOf = st.tasks.filter((t) => !t.done).sort(bySuggested);
    const doneTasks = st.tasks.filter((t) => t.done).length;
    const ideas = D().ideas.filter((i) => i.projectId === p.id);
    const content = st.content.slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    // the path: everything dated, in order, with today marked
    const path = [
      ...(p.start ? [{ date: p.start, kind: "start", title: "The working begins" }] : []),
      ...st.ms.filter((m) => m.date).map((m) => ({ date: m.date, kind: "ms", title: m.title, done: m.done, id: m.id })),
      ...content.filter((c) => c.date).map((c) => ({ date: c.date, kind: "post", title: c.title, sub: [c.platform, c.format].filter(Boolean).join(" · "), status: c.status, id: c.id })),
      ...st.tasks.filter((t) => t.due && !t.done).map((t) => ({ date: t.due, kind: "task", title: t.title, id: t.id })),
      ...(p.target ? [{ date: p.target, kind: "target", title: "Aiming to finish" }] : []),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const todayAt = path.findIndex((x) => x.date >= today);
    if (path.length) path.splice(todayAt < 0 ? path.length : todayAt, 0, { date: today, kind: "today", title: "Today" });
    const pathLi = (x) => {
      const mark = { start: "✦", target: "✧", ms: x.done ? "◆" : "◇", post: "✎", task: "☐", today: "☾" }[x.kind];
      const attrs = x.kind === "ms" ? `data-ms="${x.id}"` : x.kind === "post" ? `data-content="${x.id}"` : x.kind === "task" ? `data-task="${x.id}"` : "";
      return `<li class="path-${x.kind} ${x.done ? "done" : ""} ${x.date < today && x.kind !== "today" ? "past" : ""}" ${attrs}>
        <span class="path-mark">${mark}</span>
        <span class="path-date">${x.kind === "today" ? "" : esc(fmtDate(x.date, { month: "short", day: "numeric" }))}</span>
        <span class="path-title">${esc(x.title)}${x.sub ? ` <small>${esc(x.sub)}</small>` : ""}${x.kind === "post" ? ` <span class="tag cstatus ${esc(x.status)}">${esc(labelOf(CONTENT_STATUS, x.status))}</span>` : ""}</span>
      </li>`;
    };
    const remaining = p.target ? daysBetween(today, p.target) : null;
    return `
      <p style="margin:-10px 0 14px"><a href="#workings" class="back-link">← All workings</a></p>
      <div class="card project-hero ink-${esc(p.ink || "")}">
        <div class="card-head"><h2>${esc(labelOf(PROJECT_STATUS, p.status))}</h2><button class="btn sm" data-act="edit-project" data-id="${p.id}">Amend</button></div>
        ${p.description ? `<p class="hero-desc">${esc(p.description)}</p>` : ""}
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="hero-stats">
          <span><b>${pct}%</b> complete</span>
          <span>${esc(dateRange(p))}${remaining !== null && p.status !== "complete" ? ` · <span class="${remaining < 0 ? "neg" : ""}">${remaining < 0 ? `${-remaining} days past the aim` : `${remaining} days to go`}</span>` : ""}</span>
          <span>${p.budget ? `${money(st.spent)} of ${money(p.budget)} spent` : `${money(st.spent)} spent`}${st.earned ? ` · ${money(st.earned)} earned` : ""}</span>
        </div>
      </div>
      <div class="grid split" style="margin-top:18px">
        <div class="grid" style="align-content:start">
          <div class="card">
            <div class="card-head"><h2>The path</h2><small>milestones, posts & deadlines in order</small></div>
            ${path.length > 1 ? `<ol class="path">${path.map(pathLi).join("")}</ol>` : empty("✦", "Add milestones, posts or dated tasks and the path appears here.")}
          </div>
          <div class="card">
            <div class="card-head"><h2>Tasks</h2><small>${doneTasks}/${st.tasks.length} done</small></div>
            <form class="inline-add" id="projTaskAdd" autocomplete="off"><input name="title" placeholder="Add a task to this working…" aria-label="New task"><input name="due" type="date" aria-label="Due"><button class="btn sm" type="submit">Add</button></form>
            ${openTasksOf.length ? `<ul class="list tasks">${openTasksOf.map((t) => taskLi(t, { showProject: false })).join("")}</ul>` : `<p class="arcana-empty">${st.tasks.length ? "Every task is done. ✦" : "No tasks yet."}</p>`}
          </div>
        </div>
        <div class="grid" style="align-content:start">
          <div class="card">
            <div class="card-head"><h2>Milestones</h2><small>${st.doneM}/${st.ms.length}</small></div>
            ${st.ms.length ? `<ul class="list milestones">${st.ms.map((m) => `<li class="${m.done ? "done" : ""}">
                <button class="check-btn sm" data-toggle-ms="${m.id}" role="checkbox" aria-checked="${!!m.done}" aria-label="${m.done ? "Not reached" : "Reached"}: ${esc(m.title)}"><span>✦</span></button>
                <div class="grow" data-ms="${m.id}" style="cursor:pointer"><span class="title">${esc(m.title)}</span><span class="meta">${m.date ? `${esc(fmtDate(m.date))} · ${esc(relDay(m.date))}` : "no date"}</span></div>
              </li>`).join("")}</ul>` : ""}
            <form class="inline-add" id="msAdd" autocomplete="off"><input name="title" placeholder="Add a milestone…" aria-label="New milestone"><input name="date" type="date" aria-label="When"><button class="btn sm" type="submit">Add</button></form>
          </div>
          <div class="card">
            <div class="card-head"><h2>Content</h2><button class="btn sm" data-act="add-content-project" data-id="${p.id}">+ Post</button></div>
            ${content.length ? `<ul class="list">${content.map((c) => contentLi(c, { showProject: false })).join("")}</ul>` : `<p class="arcana-empty">Nothing planned yet.</p>`}
          </div>
          <div class="card">
            <div class="card-head"><h2>Curiosities</h2><button class="btn sm" data-act="add-idea-project" data-id="${p.id}">+ Add</button></div>
            ${ideas.length ? `<div class="mini-board">${ideas.map((i) => `<button class="mini-scrap ink-${esc(i.ink || "")}" data-idea-open="${i.id}" title="${esc(i.title || i.text.slice(0, 80))}">
                ${i.imageId ? `<span class="mini-img">${imgTag(i.imageId, i.title)}</span>` : ""}<span class="mini-text">${esc(i.title || i.text.split("\n")[0] || domainOf(i.link))}</span></button>`).join("")}</div>`
              : `<p class="arcana-empty">Link moodboard images and notes from the Cabinet, or add them here.</p>`}
          </div>
          <div class="card">
            <div class="card-head"><h2>Coffers</h2><button class="btn sm" data-act="add-expense-project" data-id="${p.id}">+ Expense</button></div>
            ${p.budget ? `<div class="bar ${st.spent > p.budget ? "over" : st.spent > p.budget * 0.8 ? "warn" : ""}"><span style="width:${Math.min(100, (st.spent / p.budget) * 100)}%"></span></div>
              <p class="project-meta">${money(st.spent)} of ${money(p.budget)} · ${st.spent > p.budget ? `<span class="neg">${money(st.spent - p.budget)} over</span>` : `${money(p.budget - st.spent)} left`}</p>` : ""}
            ${st.txs.length ? `<ul class="list">${st.txs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(txLi).join("")}</ul>` : `<p class="arcana-empty">Ledger entries linked to this working appear here.</p>`}
          </div>
        </div>
      </div>`;
  }

  /* every working on one timeline, month by month */
  function timelineView() {
    const projects = D().projects.filter((p) => p.status !== "complete" || ui.timelineAll).sort((a, b) => (a.start || a.target || "9999").localeCompare(b.start || b.target || "9999"));
    const today = todayStr();
    const datesOf = (p) => [p.start, p.target, ...(p.milestones || []).map((m) => m.date), ...D().content.filter((c) => c.projectId === p.id).map((c) => c.date)].filter(Boolean);
    const all = projects.flatMap(datesOf);
    if (!projects.length) return `<div class="card">${empty("⚗", "No workings yet. Begin one, or turn a curiosity into one from the Cabinet.")}</div>`;
    const min = [stepDays(today, -15), ...all].sort()[0], max = [stepDays(today, 45), ...all].sort().pop();
    let from = new Date(parseYmd(min).getFullYear(), parseYmd(min).getMonth(), 1);
    let to = new Date(parseYmd(max).getFullYear(), parseYmd(max).getMonth() + 1, 0);
    if ((to - from) / 864e5 > 730) to = new Date(from.getFullYear() + 2, from.getMonth(), 0); // keep it to two years
    const span = (to - from) / 864e5 + 1;
    const x = (d) => Math.max(0, Math.min(100, ((parseYmd(d) - from) / 864e5 / span) * 100));
    const months = [];
    for (let d = new Date(from); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
    const monthMarks = months.map((m) => `<span class="g-month" style="left:${x(ymd(m))}%">${m.getMonth() === 0 || m === months[0] ? `${MONTHS[m.getMonth()].slice(0, 3)} ${m.getFullYear()}` : MONTHS[m.getMonth()].slice(0, 3)}</span>`).join("");
    const gridLines = months.map((m) => `<span class="g-line" style="left:${x(ymd(m))}%"></span>`).join("") + `<span class="g-today" style="left:${x(today)}%" title="Today"></span>`;
    const rows = projects.map((p) => {
      const st = projectStats(p);
      const d = datesOf(p).sort();
      const a = p.start || d[0], b = p.target || d[d.length - 1];
      const bar = a ? `<a class="g-bar ink-${esc(p.ink || "")} ${esc(p.status)}" href="#workings/${esc(p.id)}" style="left:${x(a)}%;width:${Math.max(0.8, x(b || a) - x(a))}%" title="${esc(p.name)}: ${esc(dateRange(p))}"><span class="g-fill" style="width:${Math.round(st.progress * 100)}%"></span></a>` : "";
      const ms = st.ms.filter((m) => m.date).map((m) => `<span class="g-ms ${m.done ? "done" : ""} ${!m.done && m.date < today ? "late" : ""}" style="left:${x(m.date)}%" title="${esc(m.title)} · ${esc(fmtDate(m.date))}${m.done ? " · reached" : ""}"></span>`).join("");
      const posts = st.content.filter((c) => c.date).map((c) => `<span class="g-post ${esc(c.status)}" style="left:${x(c.date)}%" title="${esc(c.title)} · ${esc(fmtDate(c.date))} · ${esc(labelOf(CONTENT_STATUS, c.status))}"></span>`).join("");
      return `<div class="g-label"><a href="#workings/${esc(p.id)}">${esc(p.name)}</a><small>${esc(labelOf(PROJECT_STATUS, p.status))}${a ? "" : " · no dates"}</small></div>
        <div class="g-track">${gridLines}${bar}${ms}${posts}</div>`;
    }).join("");
    return `<div class="card timeline-card">
        <div class="gantt-wrap"><div class="gantt" style="min-width:${150 + months.length * 96}px">
          <div class="g-label g-corner"></div><div class="g-track g-head">${monthMarks}</div>
          ${rows}
        </div></div>
        <p class="cal-key"><span><span class="g-key bar"></span> working, filled as it progresses</span><span><span class="g-key ms"></span> milestone</span><span><span class="g-key ms done"></span> reached</span><span><span class="g-key post"></span> post</span><span><span class="g-key today"></span> today</span></p>
      </div>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="timelineAll" ${ui.timelineAll ? "checked" : ""}> Include completed workings</label>`;
  }

  /* the content calendar: a month of posts, or a pipeline by stage */
  function contentView() {
    const m = ui.contentMonth;
    const filter = (c) => ui.contentProject === "all" || (ui.contentProject === "none" ? !c.projectId : c.projectId === ui.contentProject);
    const items = D().content.filter(filter);
    const projOpts = [["all", "All workings"], ["none", "Not linked"], ...D().projects.filter((p) => ACTIVE_STATUS.has(p.status) || items.some((c) => c.projectId === p.id)).map((p) => [p.id, p.name])];
    const head = `<div class="toolbar">
        <div class="segmented" data-ui="contentView">${[["calendar", "Calendar"], ["pipeline", "Pipeline"]].map(([v, l]) => `<button class="${ui.contentView === v ? "on" : ""}" data-value="${v}">${l}</button>`).join("")}</div>
        ${ui.contentView === "calendar" ? `<div class="month-nav"><button class="icon-btn" data-cmonth="-1" aria-label="Previous month">‹</button><span>${monthLabel(m)}</span><button class="icon-btn" data-cmonth="1" aria-label="Next month">›</button></div>` : ""}
        <span class="spacer"></span>
        <button class="btn ghost sm" data-act="import-posts">Import posts</button>
        <select id="contentProject" aria-label="Filter by working" style="width:auto">${projOpts.map(([v, l]) => `<option value="${esc(v)}" ${ui.contentProject === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      </div>`;
    if (ui.contentView === "pipeline") {
      const cutoff = stepDays(todayStr(), -30);
      const cols = CONTENT_STATUS.map(([k, label]) => {
        const list = items.filter((c) => (c.status || "idea") === k && (k !== "posted" || !c.date || c.date >= cutoff)).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
        return `<div class="card pipe-col"><div class="card-head"><h2><span class="tag cstatus ${k}">${label}</span></h2><small>${list.length}</small></div>
          ${list.length ? `<ul class="list">${list.map((c) => contentLi(c)).join("")}</ul>` : `<p class="arcana-empty">—</p>`}</div>`;
      }).join("");
      return head + `<div class="pipeline">${cols}</div><p class="capture-hint">Posted items from the last 30 days are shown.</p>`;
    }
    const ws = Number(D().settings.weekStart) || 0;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() - ws + 7) % 7));
    const byDate = {};
    items.filter((c) => c.date).forEach((c) => (byDate[c.date] = byDate[c.date] || []).push(c));
    const msBy = {};
    D().projects.filter((p) => ACTIVE_STATUS.has(p.status) && (ui.contentProject === "all" || ui.contentProject === p.id))
      .forEach((p) => (p.milestones || []).filter((x) => x.date).forEach((x) => (msBy[x.date] = msBy[x.date] || []).push({ p, m: x })));
    const today = todayStr();
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i === 35 && d.getMonth() !== m.getMonth()) break;
      const s = ymd(d), evs = byDate[s] || [], mss = msBy[s] || [];
      const chips = [
        ...mss.map(({ p, m: x }) => `<span class="ev msev ${x.done ? "done" : ""}" title="Milestone: ${esc(x.title)} (${esc(p.name)})">◆ ${esc(x.title)}</span>`),
        ...evs.map((c) => `<span class="ev cs-${esc(c.status || "idea")}" data-content="${c.id}" title="${esc(c.title)} · ${esc([c.platform, c.format].filter(Boolean).join(" · "))} · ${esc(labelOf(CONTENT_STATUS, c.status))}">${esc(c.title)}</span>`),
      ];
      const cls = ["day", d.getMonth() !== m.getMonth() && "other", s === today && "today", s === ui.contentDay && "selected"].filter(Boolean).join(" ");
      cells += `<div class="${cls}" data-cday="${s}" role="button" tabindex="0" aria-label="${fmtDate(s, { weekday: "long", month: "long", day: "numeric" })}, ${evs.length} posts">
        <span class="num"><span>${d.getDate()}</span>${s === today ? "<span>✦</span>" : ""}</span>${chips.slice(0, 3).join("")}${chips.length > 3 ? `<span class="more">+${chips.length - 3} more</span>` : ""}</div>`;
    }
    const dows = Array.from({ length: 7 }, (_, i) => `<div class="dow">${DOW[(i + ws) % 7]}</div>`).join("");
    const day = ui.contentDay, dayItems = (byDate[day] || []), dayMs = msBy[day] || [];
    const undated = items.filter((c) => !c.date && c.status !== "posted");
    return head + `<div class="grid split">
        <div class="card"><div class="calendar content-cal">${dows}${cells}</div>
          <p class="cal-key">${CONTENT_STATUS.map(([k, l]) => `<span class="ev cs-${k}">${l}</span>`).join("")}<span class="ev msev">◆ milestone</span></p></div>
        <div class="grid" style="align-content:start">
          <div class="card">
            <div class="card-head"><h2>${fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}</h2><button class="btn sm" data-act="add-content-day">+ Post</button></div>
            ${dayMs.map(({ p, m: x }) => `<p class="ms-line">◆ <b>${esc(x.title)}</b> · ${projectChip(p.id)}</p>`).join("")}
            ${dayItems.length ? `<ul class="list">${dayItems.map((c) => contentLi(c)).join("")}</ul>` : dayMs.length ? "" : empty("✎", "Nothing planned this day.")}
          </div>
          ${undated.length ? `<div class="card"><div class="card-head"><h2>Not yet scheduled</h2><small>${undated.length}</small></div><ul class="list">${undated.map((c) => contentLi(c)).join("")}</ul></div>` : ""}
        </div>
      </div>`;
  }

  views.workings = {
    title: () => { const p = routeParam() && projectById(routeParam()); return p ? p.name : "Workings"; },
    actions: () => {
      if (routeParam() && projectById(routeParam())) return `<button class="btn" data-act="add-content-project" data-id="${esc(routeParam())}">+ Post</button>`;
      return ui.workTab === "content" ? `<button class="btn primary" data-act="add-content-day">+ Post</button>` : `<button class="btn primary" data-act="add-project">+ Working</button>`;
    },
    render() {
      const id = routeParam();
      if (id) {
        const p = projectById(id);
        return p ? projectPage(p) : `<div class="card">${empty("⚗", "That working isn't here any more. <a href=\"#workings\">See all workings</a>.")}</div>`;
      }
      const tabs = `<div class="toolbar"><div class="segmented" data-ui="workTab">${[["projects", "Projects"], ["timeline", "Timeline"], ["content", "Content calendar"]].map(([v, l]) => `<button class="${ui.workTab === v ? "on" : ""}" data-value="${v}">${l}</button>`).join("")}</div></div>`;
      if (ui.workTab === "timeline") return tabs + timelineView();
      if (ui.workTab === "content") return tabs + contentView();
      const groups = { active: (p) => ACTIVE_STATUS.has(p.status), resting: (p) => p.status === "resting", complete: (p) => p.status === "complete", all: () => true };
      const list = D().projects.filter(groups[ui.workStatus] || groups.active)
        .sort((a, b) => PROJECT_STATUS.findIndex(([k]) => k === b.status) - PROJECT_STATUS.findIndex(([k]) => k === a.status) || (a.target || "9999").localeCompare(b.target || "9999"));
      const chip = (v, label) => `<button class="shelf-chip ${ui.workStatus === v ? "on" : ""}" data-wstatus="${v}">${label}<span>${D().projects.filter(groups[v]).length}</span></button>`;
      return tabs + `<div class="toolbar"><div class="shelves">${chip("active", "Active")}${chip("resting", "Resting")}${chip("complete", "Complete")}${chip("all", "All")}</div></div>
        ${list.length ? `<div class="grid cols-2 project-grid">${list.map(projectCard).join("")}</div>`
          : `<div class="card">${empty("⚗", D().projects.length ? "None here." : "No workings yet. A working is an idea you've started to carry out: a collection, a launch, a new service. Begin one here, or from a curiosity in the Cabinet.")}</div>`}`;
    },
    bind(root) {
      bindSegments(root);
      $$("[data-wstatus]", root).forEach((b) => b.addEventListener("click", () => { ui.workStatus = b.dataset.wstatus; render(); }));
      $$("[data-open-project]", root).forEach((c) => {
        const go = () => (location.hash = `workings/${c.dataset.openProject}`);
        c.addEventListener("click", (e) => { if (!e.target.closest("a")) go(); });
        c.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      });
      const ta = $("#timelineAll", root);
      if (ta) ta.addEventListener("change", () => { ui.timelineAll = ta.checked; render(); });
      const cp = $("#contentProject", root);
      if (cp) cp.addEventListener("change", () => { ui.contentProject = cp.value; render(); });
      $$("[data-cmonth]", root).forEach((b) => b.addEventListener("click", () => {
        ui.contentMonth = addMonths(ui.contentMonth, +b.dataset.cmonth);
        ui.contentDay = monthKey(ui.contentMonth) === monthKey(new Date()) ? todayStr() : ymd(ui.contentMonth);
        render();
      }));
      $$("[data-cday]", root).forEach((d) => {
        d.addEventListener("click", () => {
          ui.contentDay = d.dataset.cday;
          if (d.dataset.cday.slice(0, 7) !== monthKey(ui.contentMonth)) ui.contentMonth = new Date(+d.dataset.cday.slice(0, 4), +d.dataset.cday.slice(5, 7) - 1, 1);
          render();
        });
        d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d.click(); } });
      });
      // on a project's page
      const id = routeParam();
      $$("[data-tx]", root).forEach((li) => li.addEventListener("click", () => editTransaction(D().transactions.find((t) => t.id === li.dataset.tx))));
      const msAdd = $("#msAdd", root);
      if (msAdd) msAdd.addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(msAdd), title = String(f.get("title") || "").trim();
        if (!title) return;
        updateMilestones(id, (list) => [...list, { id: Store.uid(), title, date: f.get("date") || "", done: false }]);
        $("#msAdd input[name=title]").focus();
      });
      const tAdd = $("#projTaskAdd", root);
      if (tAdd) tAdd.addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(tAdd), title = String(f.get("title") || "").trim();
        if (!title) return;
        Store.upsert("tasks", { title, due: f.get("due") || "", scope: "business", clientId: "", notes: "", done: false, doneAt: "", subtasks: [], projectId: id, ...quadrantFields("") });
        $("#projTaskAdd input[name=title]").focus();
      });
    },
  };

  // milestones, posts and linked curiosities open wherever they're listed
  document.addEventListener("click", (e) => {
    const tick = e.target.closest("[data-toggle-ms]");
    if (tick) {
      const pid = routeParam(), mid = tick.dataset.toggleMs;
      updateMilestones(pid, (list) => list.map((m) => (m.id === mid ? { ...m, done: !m.done } : m)));
      return;
    }
    const ms = e.target.closest("[data-ms]");
    if (ms) {
      const p = projectById(routeParam());
      const m = p && (p.milestones || []).find((x) => x.id === ms.dataset.ms);
      if (m) editMilestone(p.id, m);
      return;
    }
    if (e.target.closest("a")) return;
    const c = e.target.closest("[data-content]");
    if (c) { e.stopPropagation(); editContent(D().content.find((x) => x.id === c.dataset.content)); return; }
    const io = e.target.closest("[data-idea-open]");
    if (io) editIdea(D().ideas.find((x) => x.id === io.dataset.ideaOpen));
  });

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
      ${st.summary ? `<p class="sync-summary">The synced copy holds <b>${st.summary.tx}</b> ledger entries · <b>${st.summary.tasks}</b> tasks · <b>${st.summary.clients}</b> clients · <b>${st.summary.appts}</b> appointments.</p>` : ""}
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
            <p style="color:var(--ash);font-size:15px;margin:0"><i>${D().transactions.length} ledger entries · ${D().appointments.length} appointments · ${D().clients.length} clients · ${D().tasks.length} tasks · ${D().ideas.length} curiosities · ${D().categories.length} categories</i></p>
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
          const text = await file.text();
          const images = JSON.parse(text).images || {};
          for (const [id, im] of Object.entries(images)) await Images.put(id, Images.fromBase64(im.data, im.type));
          Store.importJSON(text);
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
    "add-idea": () => editIdea(),
    "add-project": () => editProject(),
    "edit-project": (b) => editProject(projectById(b.dataset.id)),
    "add-content-day": () => editContent({ date: ui.workTab === "content" && currentView() === "workings" ? ui.contentDay : "", projectId: ui.contentProject !== "all" && ui.contentProject !== "none" ? ui.contentProject : "" }),
    "add-content-project": (b) => editContent({ projectId: b.dataset.id }),
    "import-posts": () => openPostImport(),
    "add-idea-project": (b) => editIdea({ projectId: b.dataset.id, shelf: "" }),
    "add-expense-project": (b) => editTransaction({ type: "expense", scope: "business", projectId: b.dataset.id }),
    "draw-card": () => {
      const current = ui.draw ? ui.draw.cardId : Tarot.cardOfDay(todayStr()).id;
      const card = Tarot.draw(current);
      // a little chance in what's suggested too: any of the top three of that suit
      const q = Tarot.SUITS[card.suit].q;
      const top = openTasks().filter((t) => (ui.agendaScope === "all" || (t.scope || "personal") === ui.agendaScope) && quadrantOf(t) === q).sort(bySuggested).slice(0, 3);
      const pick = top[Math.floor(Math.random() * top.length)];
      ui.draw = { cardId: card.id, taskId: pick ? pick.id : "", fresh: true };
      render();
    },
    "draw-reset": () => { ui.draw = null; render(); },
    "clear-done": () => {
      const n = Store.removeWhere("tasks", (t) => t.done);
      if (!n) return;
      toast(`${n} finished task${n === 1 ? "" : "s"} cleared.`);
    },
    import: () => openImport(),
    seed: () => { Store.seedSample(); toast("Sample pages summoned."); },
    "sync-now": () => Sync.syncNow(),
    "sync-off": () => { Sync.disconnect(); toast("Sync is off on this device. Your data stays here."); render(); },
    export: async () => {
      // images live outside the main data, so they're gathered into the backup separately
      const backup = JSON.parse(Store.exportJSON());
      backup.images = {};
      for (const i of D().ideas.filter((x) => x.imageId)) {
        const blob = await Images.get(i.imageId).catch(() => null);
        if (blob) backup.images[i.imageId] = { type: blob.type, data: await Images.toBase64(blob) };
      }
      download(`3rd-iris-backup-${todayStr()}.json`, JSON.stringify(backup), "application/json");
    },
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
    if (b && actions[b.dataset.act]) return actions[b.dataset.act](b);
    // tasks behave the same wherever they're listed
    const tick = e.target.closest("[data-toggle-task]");
    if (tick) return toggleTask(tick.dataset.toggleTask);
    const step = e.target.closest("[data-toggle-step]");
    if (step) return toggleStep(...step.dataset.toggleStep.split(":"));
    const rm = e.target.closest("[data-remove-step-inline]");
    if (rm) return removeStep(...rm.dataset.removeStepInline.split(":"));
    const expand = e.target.closest("[data-expand-task]");
    if (expand) {
      const id = expand.dataset.expandTask;
      ui.expandedTasks.has(id) ? ui.expandedTasks.delete(id) : ui.expandedTasks.add(id);
      render();
      const input = $(`[data-add-step-inline="${id}"]`);
      if (input && !(D().tasks.find((t) => t.id === id).subtasks || []).length) input.focus();
      return;
    }
    const addQ = e.target.closest("[data-add-task-q]");
    if (addQ) return editTask({ scope: ui.agendaScope === "business" ? "business" : "personal", suit: addQ.dataset.addTaskQ });
    if (e.target.closest(".steps-list")) return;
    const task = e.target.closest("[data-task]");
    if (task && !e.target.closest("a")) editTask(D().tasks.find((t) => t.id === task.dataset.task));
  });
  document.addEventListener("keydown", (e) => {
    const input = e.target.closest && e.target.closest("[data-add-step-inline]");
    if (!input || e.key !== "Enter") return;
    e.preventDefault();
    const id = input.dataset.addStepInline;
    addStep(id, input.value);
    // the list re-renders; keep typing in the same place
    const again = $(`[data-add-step-inline="${id}"]`);
    if (again) again.focus();
  });

  /* ── chrome: router, sidebar, moon ─────────── */
  function currentView() {
    const v = location.hash.replace("#", "").split("/")[0];
    return views[v] ? v : "sanctum";
  }
  // the part after the view, e.g. a project's id in #workings/<id>
  const routeParam = () => decodeURIComponent(location.hash.replace("#", "").split("/")[1] || "");

  function render() {
    const name = currentView();
    const v = views[name];
    const title = typeof v.title === "function" ? v.title() : v.title;
    $("#viewTitle").textContent = title;
    document.title = `${title} · 3rd Iris`;
    $("#topbarActions").innerHTML = v.actions();
    const root = $("#view");
    root.innerHTML = v.render();
    v.bind && v.bind(root);
    hydrateImages(root);
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

  /* an installed app can stay open for days; when a newer version has been published,
     reload into it, but only at a quiet moment, and only once per version */
  const MY_VERSION = document.querySelector('meta[name="app-version"]')?.content || "";
  async function checkForUpdate() {
    if (!MY_VERSION || MY_VERSION === "__V__" || location.protocol === "file:") return;
    try {
      const res = await fetch(`version.txt?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const latest = (await res.text()).trim();
      if (!latest || latest === MY_VERSION) return;
      const busy = $("#modal").open || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      let tried = "";
      try { tried = sessionStorage.getItem("3rdiris.reloadedFor") || ""; } catch {}
      if (busy || tried === latest) return;
      try { sessionStorage.setItem("3rdiris.reloadedFor", latest); } catch {}
      location.reload();
    } catch { /* offline: try again later */ }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
  setInterval(checkForUpdate, 10 * 60000);
  setTimeout(checkForUpdate, 4000);

  // lets the app be installed on phones and open without a connection
  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // pictures arriving from another device fill in where they're shown
  Images.onChange(() => hydrateImages($("#view")));
  // images left behind by a cancelled form or a deleted curiosity
  setTimeout(async () => {
    try {
      const used = new Set(D().ideas.map((i) => i.imageId).filter(Boolean));
      for (const id of await Images.keys()) if (!used.has(id)) await Images.del(id);
    } catch { /* storage unavailable; nothing to tidy */ }
  }, 8000);

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
