/* Charts: small, single-series SVG charts drawn at the container's real width.
   A line for things that accumulate (followers), columns for counts per period.
   Each has a hover/keyboard readout; the numbers are always in a table nearby too. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const INK = "#b5873a";        // series hue, validated against the card surface
  const INK_LIFT = "#cf9f4c";   // the same hue, a step lighter, for the hovered bar
  const SURFACE = "#1b1820";    // for rings and gaps around marks
  const GRID = "#2c2632";       // hairlines, one step off the surface
  const TEXT = "#a39a8c";       // axis text (a text token, never the series colour)
  const TEXT_STRONG = "#ece4d4";
  const PAD = { top: 18, right: 54, bottom: 28, left: 46 };

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
    return Math.round(n).toLocaleString();
  };

  // clean tick values covering [lo, hi]
  function ticks(lo, hi, count = 4) {
    if (hi === lo) { hi = lo + 1; lo = Math.max(0, lo - 1); }
    const raw = (hi - lo) / count;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || 10 * pow;
    const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
    const out = [];
    for (let v = start; v <= end + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }

  const fmtDay = (d) => new Date(d + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  /* shared frame: svg, scales, gridlines, y axis, tooltip, keyboard focus */
  function frame(box, { height = 220, yMin, yMax, format = compact }) {
    box.textContent = "";
    box.classList.add("chart");
    const width = Math.max(180, box.clientWidth);
    const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img" }, box);
    const plotW = width - PAD.left - PAD.right, plotH = height - PAD.top - PAD.bottom;
    const tv = ticks(yMin, yMax);
    const lo = tv[0], hi = tv[tv.length - 1];
    const y = (v) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
    for (const t of tv) {
      el("line", { x1: PAD.left, x2: PAD.left + plotW, y1: y(t), y2: y(t), stroke: GRID, "stroke-width": 1, "shape-rendering": "crispEdges" }, svg);
      const lab = el("text", { x: PAD.left - 8, y: y(t) + 4, "text-anchor": "end", fill: TEXT, "font-size": 12, "font-variant-numeric": "tabular-nums" }, svg);
      lab.textContent = format(t);
    }
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    box.appendChild(tip);
    box.tabIndex = 0;
    return { svg, width, height, plotW, plotH, y, lo, hi, tip };
  }

  function showTip(f, box, x, top, value, label) {
    f.tip.textContent = "";
    const v = document.createElement("strong");
    v.textContent = value;
    const l = document.createElement("span");
    l.textContent = label;
    f.tip.append(v, l);
    f.tip.hidden = false;
    const w = f.tip.offsetWidth;
    f.tip.style.left = Math.min(Math.max(4, x - w / 2), f.width - w - 4) + "px";
    f.tip.style.top = Math.max(0, top - f.tip.offsetHeight - 10) + "px";
  }

  function xAxis(f, labels) {
    // first, last, and the middle when there's room
    const picks = labels.length <= 2 ? labels.map((_, i) => i) : f.width > 420 ? [0, Math.floor((labels.length - 1) / 2), labels.length - 1] : [0, labels.length - 1];
    [...new Set(picks)].forEach((i, k, arr) => {
      const t = el("text", { x: labels[i].x, y: f.height - 8, fill: TEXT, "font-size": 12, "text-anchor": arr.length > 1 && k === 0 ? "start" : k === arr.length - 1 && arr.length > 1 ? "end" : "middle" }, f.svg);
      t.textContent = labels[i].text;
    });
  }

  /* line: points [{ date, value, label? }] in date order */
  function line(box, points, { label = "", format = compact, valueText = (p) => format(p.value) } = {}) {
    if (!points.length) { box.textContent = ""; return; }
    const vals = points.map((p) => p.value);
    const min = Math.min(...vals), max = Math.max(...vals);
    const spread = max - min || Math.max(1, max * 0.05);
    const f = frame(box, { yMin: Math.max(0, min - spread * 0.15), yMax: max + spread * 0.15, format });
    const t0 = new Date(points[0].date).getTime(), t1 = new Date(points[points.length - 1].date).getTime();
    const x = (d) => PAD.left + (t1 === t0 ? f.plotW / 2 : ((new Date(d).getTime() - t0) / (t1 - t0)) * f.plotW);
    const xy = points.map((p) => [x(p.date), f.y(p.value)]);
    if (xy.length > 1) {
      const d = xy.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
      el("path", { d: `${d}L${xy[xy.length - 1][0]},${f.y(f.lo)}L${xy[0][0]},${f.y(f.lo)}Z`, fill: INK, "fill-opacity": 0.1 }, f.svg);
      el("path", { d, fill: "none", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, f.svg);
    }
    // end marker with a surface ring, and the latest value beside it
    const [ex, ey] = xy[xy.length - 1];
    el("circle", { cx: ex, cy: ey, r: 4, fill: INK, stroke: SURFACE, "stroke-width": 2 }, f.svg);
    const endLab = el("text", { x: ex + 8, y: ey + 4, fill: TEXT_STRONG, "font-size": 13, "font-weight": 600 }, f.svg);
    endLab.textContent = format(points[points.length - 1].value);
    xAxis(f, points.map((p, i) => ({ x: xy[i][0], text: fmtDay(p.date) })));
    f.svg.setAttribute("aria-label", `${label}: ${points.length} readings, latest ${format(points[points.length - 1].value)}`);

    // crosshair snaps to the nearest reading
    const cross = el("line", { y1: PAD.top, y2: PAD.top + f.plotH, stroke: TEXT, "stroke-width": 1, visibility: "hidden" }, f.svg);
    const dot = el("circle", { r: 4, fill: INK, stroke: SURFACE, "stroke-width": 2, visibility: "hidden" }, f.svg);
    let at = -1;
    const select = (i) => {
      at = Math.max(0, Math.min(points.length - 1, i));
      const [cx, cy] = xy[at];
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
      showTip(f, box, cx, cy, valueText(points[at]), points[at].label || fmtDay(points[at].date));
    };
    const clear = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); f.tip.hidden = true; };
    const hit = el("rect", { x: PAD.left - 10, y: 0, width: f.plotW + 20, height: f.height, fill: "transparent" }, f.svg);
    hit.addEventListener("pointermove", (e) => {
      const px = e.clientX - f.svg.getBoundingClientRect().left;
      let best = 0;
      xy.forEach(([a], i) => { if (Math.abs(a - px) < Math.abs(xy[best][0] - px)) best = i; });
      select(best);
    });
    hit.addEventListener("pointerleave", clear);
    box.onkeydown = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); select(at < 0 ? points.length - 1 : at + (e.key === "ArrowRight" ? 1 : -1)); }
      if (e.key === "Escape") clear();
    };
    box.onblur = clear;
  }

  /* columns: bars [{ key, value, label }] in order; grow from zero */
  function columns(box, bars, { label = "", format = compact, valueText = (b) => format(b.value) } = {}) {
    if (!bars.length) { box.textContent = ""; return; }
    const max = Math.max(...bars.map((b) => b.value), 0);
    const f = frame(box, { yMin: 0, yMax: max || 1, format });
    const band = f.plotW / bars.length;
    const w = Math.max(2, Math.min(24, band - 2)); // capped thickness; the rest of the band is air
    const base = f.y(0);
    const centers = [], marks = [];
    bars.forEach((b, i) => {
      const cx = PAD.left + band * i + band / 2;
      centers.push(cx);
      const top = f.y(b.value), h = base - top, r = Math.min(4, w / 2, h);
      // rounded data end, square at the baseline; a zero draws nothing
      marks.push(h > 0.5 ? el("path", { d: `M${cx - w / 2},${base}V${top + r}Q${cx - w / 2},${top} ${cx - w / 2 + r},${top}H${cx + w / 2 - r}Q${cx + w / 2},${top} ${cx + w / 2},${top + r}V${base}Z`, fill: INK }, f.svg) : null);
    });
    xAxis(f, bars.map((b, i) => ({ x: centers[i], text: b.short || b.label })));
    f.svg.setAttribute("aria-label", `${label}: ${bars.length} values`);
    let at = -1;
    // the hovered bar lifts a little so it's clear which one the readout belongs to
    const select = (i) => {
      at = Math.max(0, Math.min(bars.length - 1, i));
      marks.forEach((m, k) => m && m.setAttribute("fill", k === at ? INK_LIFT : INK));
      showTip(f, box, centers[at], f.y(bars[at].value), valueText(bars[at]), bars[at].label);
    };
    const clear = () => { f.tip.hidden = true; marks.forEach((m) => m && m.setAttribute("fill", INK)); };
    // each band is the hit target, wider and taller than the bar itself
    bars.forEach((b, i) => {
      const hit = el("rect", { x: PAD.left + band * i, y: PAD.top, width: band, height: f.plotH, fill: "transparent" }, f.svg);
      hit.addEventListener("pointerenter", () => select(i));
      hit.addEventListener("pointerleave", clear);
    });
    box.onkeydown = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); select(at < 0 ? bars.length - 1 : at + (e.key === "ArrowRight" ? 1 : -1)); }
      if (e.key === "Escape") clear();
    };
    box.onblur = clear;
  }

  window.Charts = { line, columns, compact };
})();
