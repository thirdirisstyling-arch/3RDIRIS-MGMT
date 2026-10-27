/* Importer: turns pasted spreadsheet rows or CSV text into ledger entries.
   Pure functions only, so it can be tested outside the browser. */
(function (root) {
  const pad = (n) => String(n).padStart(2, "0");

  /* split text into rows of cells; tab-separated if the first line has a tab, else CSV */
  function splitRows(text) {
    const lines = text.replace(/\r\n?/g, "\n");
    const first = lines.split("\n").find((l) => l.trim()) || "";
    const delim = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < lines.length; i++) {
      const ch = lines[i];
      if (quoted) {
        if (ch === '"' && lines[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
      else if (ch === delim) { row.push(cell.trim()); cell = ""; }
      else if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    row.push(cell.trim());
    rows.push(row);
    return rows.filter((r) => r.some((c) => c !== ""));
  }

  /* YYYY-MM-DD, M/D/YYYY or M/D/YY → YYYY-MM-DD; bare M/D (no year) is not a date */
  function parseDate(s) {
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
    return null;
  }
  function valid(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    return dt.getMonth() === mo - 1 && dt.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }

  const MONEY = /^\(?\s*[-+]?\s*[$€£¥]?\s*[-+]?\s*\d[\d,]*(\.\d+)?\s*\)?$/;
  const hasSymbol = (s) => /[$€£¥]/.test(s);
  function parseMoney(s) {
    if (!s || !MONEY.test(s)) return null;
    const neg = /^\(.*\)$/.test(s) || s.includes("-");
    const n = parseFloat(s.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : neg ? -n : n;
  }

  const INCOME_WORDS = /^(income|deposit|credit|revenue|payment received)$/i;
  const TYPE_WORDS = /^(income|expense|expenses|deposit|credit|debit|revenue|payment received|withdrawal)$/i;
  const BARE_MONTH_DAY = /^\d{1,2}\/\d{1,2}$/;

  const HEADER_ALIASES = {
    date: ["date", "transaction date", "posted", "posted date"],
    amount: ["amount", "total", "value", "sum"],
    type: ["type", "kind", "income/expense"],
    description: ["description", "name", "payee", "merchant", "memo", "item", "details", "transaction"],
    category: ["category", "categories"],
    scope: ["purse", "scope"],
    client: ["client", "customer"],
    notes: ["notes", "note"],
  };

  function headerMap(row) {
    const lower = row.map((c) => c.toLowerCase());
    if (!lower.includes("date") || !lower.some((c) => HEADER_ALIASES.amount.includes(c))) return null;
    const map = {};
    lower.forEach((c, i) => {
      for (const [key, names] of Object.entries(HEADER_ALIASES)) {
        if (names.includes(c) && map[key] === undefined) { map[key] = i; return; }
      }
    });
    return map;
  }

  /* one row without headers: recognise cells by what they look like */
  function guessRow(cells) {
    const used = new Set();
    const dateIdx = cells.findIndex((c) => parseDate(c));
    if (dateIdx >= 0) used.add(dateIdx);

    let amtIdx = -1;
    for (let i = cells.length - 1; i >= 0; i--) if (!used.has(i) && hasSymbol(cells[i]) && parseMoney(cells[i]) !== null) { amtIdx = i; break; }
    if (amtIdx < 0) for (let i = cells.length - 1; i >= 0; i--) if (!used.has(i) && parseMoney(cells[i]) !== null) { amtIdx = i; break; }
    if (amtIdx >= 0) used.add(amtIdx);

    const typeIdx = cells.findIndex((c, i) => !used.has(i) && TYPE_WORDS.test(c));
    if (typeIdx >= 0) used.add(typeIdx);

    const isText = (i) => !used.has(i) && cells[i] && !BARE_MONTH_DAY.test(cells[i]) && parseMoney(cells[i]) === null;
    let descIdx = -1;
    for (let i = 0; i < cells.length; i++) if (isText(i)) { descIdx = i; break; }
    if (descIdx >= 0) used.add(descIdx);

    const catIdx = typeIdx >= 0 && isText(typeIdx + 1) ? typeIdx + 1 : -1;
    if (catIdx >= 0) used.add(catIdx);

    const notes = cells.filter((c, i) => !used.has(i) && c && !BARE_MONTH_DAY.test(c));
    return {
      date: dateIdx >= 0 ? cells[dateIdx] : "",
      amount: amtIdx >= 0 ? cells[amtIdx] : "",
      type: typeIdx >= 0 ? cells[typeIdx] : "",
      description: descIdx >= 0 ? cells[descIdx] : "",
      category: catIdx >= 0 ? cells[catIdx] : "",
      notes: notes.join(" · "),
    };
  }

  /**
   * parse(text) → [{ ok, error, date, description, type, amount, category, scope, client, notes, raw }]
   * amount is always positive; type is "income" or "expense".
   */
  function parse(text) {
    const rows = splitRows(text || "");
    if (!rows.length) return [];
    const map = headerMap(rows[0]);
    const body = map ? rows.slice(1) : rows;

    const fields = body.map((cells) => {
      if (!map) return { ...guessRow(cells), raw: cells };
      const get = (k) => (map[k] !== undefined ? cells[map[k]] || "" : "");
      const known = new Set(Object.values(map));
      const extra = cells.filter((c, i) => !known.has(i) && c);
      return {
        date: get("date"), amount: get("amount"), type: get("type"), description: get("description"),
        category: get("category"), scope: get("scope").toLowerCase(), client: get("client"),
        notes: [get("notes"), ...extra].filter(Boolean).join(" · "), raw: cells,
      };
    });

    // with no type column, a batch containing negatives reads as a bank statement: negative = spent
    const anyNegative = fields.some((f) => !f.type && (parseMoney(f.amount) || 0) < 0);

    return fields.map((f) => {
      const date = parseDate(f.date);
      const amt = parseMoney(f.amount);
      const out = {
        ok: true, error: "", date: date || "", description: f.description, amount: amt === null ? 0 : Math.round(Math.abs(amt) * 100) / 100,
        type: f.type ? (INCOME_WORDS.test(f.type) ? "income" : "expense") : anyNegative && amt > 0 ? "income" : "expense",
        category: f.category, scope: f.scope === "business" || f.scope === "personal" ? f.scope : "",
        client: f.client || "", notes: f.notes, raw: f.raw,
      };
      if (!date) out.error = f.date ? `Unreadable date “${f.date}”` : "No date found";
      else if (amt === null || amt === 0) out.error = f.amount ? `Unreadable amount “${f.amount}”` : "No amount found";
      else if (!f.description) out.error = "No description";
      out.ok = !out.error;
      return out;
    });
  }

  const api = { parse, splitRows, parseDate, parseMoney };
  if (typeof module !== "undefined") module.exports = api;
  else root.Importer = api;
})(typeof window !== "undefined" ? window : globalThis);
