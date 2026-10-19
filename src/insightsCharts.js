// Chart rendering for the Email & signup insights page (EmailInsightsPage.jsx).
//
// Ported near-verbatim from the one-off dashboard this replaces
// (docs/Atlas_Signup_Email_Insights.html in the Atlas repo root) — that was
// a static page with a hand-typed data snapshot; this is the same vanilla
// DOM/SVG-building code, just fed live data instead, and scoped to a
// container element instead of `document` so it can live inside a React
// component without touching global ids. Kept as plain JS (not JSX) on
// purpose: these are SVG builders, not component markup, and porting them
// 1:1 was far lower-risk than rewriting every chart as JSX from scratch.
//
// Dropped relative to the original: the pattern-fill colorblind/print
// toggle (a nicety for a possibly-public artifact, not needed for an
// internal admin tool used by one person) and the Resend-timestamp
// welcome->booking gap cross-check (superseded — the Firestore side now
// has a direct welcomeEmailSentAt timestamp, which is more accurate than
// reconstructing the same gap from Resend send times).

const NS = "http://www.w3.org/2000/svg";

function S(tag, attrs, kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  (kids || []).forEach((c) => c && e.appendChild(c));
  return e;
}
function H(tag, attrs, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
const F = (k) => `var(--${k})`;
const fmtDay = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDet = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Detroit" });
const fmtDetTime = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Detroit" });
function fmtLag(m) {
  if (m == null) return "—";
  if (m < 1) return "<1 min";
  if (m < 90) return Math.round(m) + " min";
  if (m < 2880) return (m / 60).toFixed(1).replace(/\.0$/, "") + " hr";
  return (m / 1440).toFixed(1).replace(/\.0$/, "") + " days";
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
const topRound = (x, y, w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};
const rightRound = (x, y, w, h, r) => {
  r = Math.max(0, Math.min(r, h / 2, w));
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
};
function niceMax(v, steps) {
  const raw = v / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const n = [1, 2, 5, 10].find((m) => m * mag >= raw) * mag;
  return { step: n, max: n * Math.ceil(v / n) };
}

/**
 * Builds and mounts every chart/stat block for the page into `container`
 * (a plain DOM element already holding the static skeleton markup — see
 * emailInsightsSkeleton() in EmailInsightsPage.jsx), driven by `D`:
 *   D.stats        — scalar funnel + email totals (see useAdminData.js's
 *                    `insights` plus the getEmailInsights() Cloud Function result)
 *   D.bookers      — one entry per player who's booked, fastest to slowest
 *                    (the dot strip re-sorts by x itself; the table uses this order)
 *   D.buckets      — D.bookers grouped into 6 lag buckets
 *   D.daily        — { d, signups, bookings } per day
 *   D.emailDaily   — { d, <type>: count, ... } per day
 *   D.emailSeries  — ordered list of email-type names
 * Call again whenever D changes (new fetch, or a resize) — it fully
 * replaces each card's content rather than patching it.
 */
export function mountInsights(container, D) {
  const S_ = D.stats;
  const $ = (id) => container.querySelector("#" + id);
  const tip = $("ei-tip");

  function placeTip(x, y) {
    const r = tip.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  function showTip(evt, el, title, rows) {
    tip.replaceChildren();
    tip.appendChild(H("div", { class: "ei-tip-h" }, title));
    rows.forEach((r) => {
      const d = H("div", { class: "ei-tip-r" });
      if (r.key) {
        const k = H("span", { class: "ei-tip-k" });
        k.style.background = `var(--${r.key})`;
        d.appendChild(k);
      }
      d.appendChild(H("strong", {}, r.value));
      d.appendChild(H("span", {}, " " + r.label));
      tip.appendChild(d);
    });
    tip.hidden = false;
    if (evt && evt.clientX != null && evt.type !== "focus") placeTip(evt.clientX, evt.clientY);
    else {
      const b = el.getBoundingClientRect();
      placeTip(b.left + b.width / 2, b.top + b.height / 2);
    }
  }
  const hideTip = () => {
    tip.hidden = true;
  };
  function bindTip(el, title, rows) {
    const show = (e) => showTip(e, el, title, rows);
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerenter", show);
    el.addEventListener("focus", show);
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("blur", hideTip);
  }

  function legend(id, items) {
    const el = $(id);
    el.replaceChildren();
    items.forEach((it) => {
      const s = H("span");
      const sw = H("i", { class: "ei-sw" });
      sw.style.background = `var(--${it.key})`;
      s.append(sw, document.createTextNode(it.name));
      el.appendChild(s);
    });
  }
  function table(cols, rows) {
    const wrap = H("div", { class: "ei-tbl-scroll" });
    const t = H("table", { class: "ei-dt" });
    const thead = H("thead");
    const tr = H("tr");
    cols.forEach((c) => tr.appendChild(H("th", c.n ? { class: "n", scope: "col" } : { scope: "col" }, c.h)));
    thead.appendChild(tr);
    t.appendChild(thead);
    const tb = H("tbody");
    rows.forEach((r) => {
      const row = H("tr");
      r.forEach((v, i) => row.appendChild(H("td", cols[i].n ? { class: "n" } : {}, String(v))));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function bucketsChart(w) {
    const rows = D.buckets;
    const n = rows.length;
    const labW = w < 520 ? 92 : 128;
    const rowH = 38;
    const top = 4;
    const h = top + n * rowH + 4;
    const maxLen = w - labW - 70;
    const maxC = Math.max(1, ...rows.map((r) => r.count));
    const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": "Players by time from sign-up to first booking: " + rows.map((r) => `${r.label}: ${r.count}`).join(", ") });
    svg.appendChild(S("line", { x1: labW, x2: labW, y1: top, y2: h - 4, style: "stroke:var(--axis)", "stroke-width": 1 }));
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      const cy = y + rowH / 2;
      const key = i < 3 ? "s2" : "gray";
      const g = S("g", { class: "ei-row", tabindex: 0, "aria-label": `${r.label}: ${r.count} of ${S_.bookers} players` });
      g.appendChild(S("rect", { class: "ei-band", x: 0, y, width: w, height: rowH, rx: 6 }));
      g.appendChild(S("text", { x: labW - 10, y: cy + 4, "text-anchor": "end", class: "ei-lab", text: r.label }));
      const len = (r.count / maxC) * maxLen;
      if (r.count > 0) g.appendChild(S("path", { class: "ei-mk", d: rightRound(labW + 1, cy - 9, len, 18, 4), style: `fill:${F(key)}` }));
      g.appendChild(S("text", { x: labW + 1 + len + 8, y: cy + 4, class: "ei-val", text: r.count }));
      bindTip(g, r.label, [{ key, value: `${r.count} of ${S_.bookers} players`, label: `(${pct(r.count, S_.bookers)})` }]);
      svg.appendChild(g);
    });
    return svg;
  }

  // One dot per player on a single time axis ("dot strip" / beeswarm).
  // Previously one ROW per player, sorted fastest->slowest and labeled with
  // the signup date -- which read like a timeline and made it look as if
  // players were booking faster over time. That slope was just the sort.
  // Now there's no vertical axis at all: dots pile upward where several
  // players took about the same time, so pile height = how many people.
  // Signup date lives in the tooltip.
  function dotsChart(w) {
    const B = D.bookers;
    const n = B.length;
    const L = 28;
    const R = w - 28;
    const r = 6;
    const step = 2 * r + 2;
    const lo = 0;
    const hi = Math.log10(43200);
    const X = (m) => L + ((Math.log10(Math.max(1, m)) - lo) / (hi - lo)) * (R - L);
    const ticks = w < 520 ? [[10, "10 min"], [60, "1 hr"], [1440, "1 day"], [43200, "30 d"]] : [[1, "1 min"], [10, "10 min"], [60, "1 hr"], [1440, "1 day"], [10080, "1 week"], [43200, "30 days"]];
    if (n === 0) {
      const svg = S("svg", { viewBox: `0 0 ${w} 60`, role: "img", "aria-label": "No bookers yet." });
      svg.appendChild(S("text", { x: w / 2, y: 32, "text-anchor": "middle", class: "ei-lab", text: "No one has booked yet." }));
      return svg;
    }
    // Greedy pile: each dot takes the lowest level with no horizontal overlap.
    const items = B.map((b) => ({ b, x: Math.min(R, X(b.lagMin)), lvl: 0 })).sort((a, b) => a.x - b.x);
    const placed = [];
    items.forEach((it) => {
      let lvl = 0;
      while (placed.some((p) => p.lvl === lvl && Math.abs(p.x - it.x) < step)) lvl++;
      it.lvl = lvl;
      placed.push(it);
    });
    const maxLvl = Math.max(...items.map((it) => it.lvl));
    const top = 40;
    const plotH = Math.max(56, (maxLvl + 1) * step + 8);
    const baseY = top + plotH;
    const h = baseY + 34;
    const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": `Time from account creation to first booking for ${n} players, one dot each. Median ${fmtLag(S_.medianLag)}.` });
    ticks.forEach(([m, t], i) => {
      const x = X(m);
      svg.appendChild(S("line", { x1: x, x2: x, y1: top - 8, y2: baseY, style: "stroke:var(--grid)", "stroke-width": 1 }));
      const anchor = i === 0 && w >= 520 ? "start" : i === ticks.length - 1 ? "end" : "middle";
      svg.appendChild(S("text", { x, y: baseY + 20, "text-anchor": anchor, class: "ei-tick", text: t }));
    });
    svg.appendChild(S("line", { x1: L, x2: R, y1: baseY, y2: baseY, style: "stroke:var(--axis)", "stroke-width": 1 }));
    const mx = X(S_.medianLag);
    svg.appendChild(S("line", { x1: mx, x2: mx, y1: top - 10, y2: baseY, style: "stroke:var(--ink2)", "stroke-dasharray": "3 3", "stroke-width": 1 }));
    svg.appendChild(S("text", { x: mx + 6, y: top - 14, class: "ei-lab", text: `Median ${fmtLag(S_.medianLag)}` }));
    const fast = B.filter((b) => b.lagMin <= 60);
    const slow = B.filter((b) => b.lagMin > 60);
    if (fast.length && slow.length) {
      const gapA = Math.max(...fast.map((b) => b.lagMin));
      const gapB = Math.min(...slow.map((b) => b.lagMin));
      const xa = X(gapA * 1.25);
      const xb = X(gapB * 0.8);
      if (xb - xa > 60) {
        const gy = baseY - r - 6;
        svg.appendChild(S("path", { d: `M${xa},${gy - 5}V${gy + 5}M${xa},${gy}H${xb}M${xb},${gy - 5}V${gy + 5}`, style: "stroke:var(--ink2);fill:none", "stroke-width": 1 }));
        // Only label the gap when the label fits inside the bracket, so it
        // never runs over the dots on either side (narrow screens).
        const gapText = `No one booked between ${fmtLag(gapA)} and ${fmtLag(gapB)}`;
        const label = xb - xa > gapText.length * 6.6 ? gapText : xb - xa > 110 ? "Nobody booked here" : null;
        if (label) svg.appendChild(S("text", { x: (xa + xb) / 2, y: gy - 10, "text-anchor": "middle", class: "ei-lab ei-halo", text: label }));
      }
    }
    items.forEach(({ b, x, lvl }) => {
      const cy = baseY - 3 - r - lvl * step;
      const key = b.lagMin <= 60 ? "s2" : "gray";
      const g = S("g", { class: "ei-row", tabindex: 0, "aria-label": `Booked after ${fmtLag(b.lagMin)}; account created ${fmtDet(b.createdAt)}` });
      g.appendChild(S("circle", { class: "ei-mk", cx: x, cy, r, style: `fill:${F(key)};stroke:var(--surface)`, "stroke-width": 2 }));
      bindTip(g, `${fmtLag(b.lagMin)} to first booking`, [
        { key, value: fmtDetTime(b.createdAt), label: "account created" },
        { value: fmtDetTime(b.booked), label: "booked" },
        { value: b.field || "—", label: `· ${b.event || ""}` },
      ]);
      svg.appendChild(g);
    });
    return svg;
  }

  function funnelChart(w) {
    const rows = [
      { name: "Accounts created", v: S_.realAccounts, key: "s1" },
      { name: "Finished onboarding", v: S_.onboarded, key: "s1" },
      { name: "Booked an event", v: S_.bookers, key: "s2" },
    ];
    const labW = w < 520 ? 110 : 150;
    const rowH = 46;
    const top = 4;
    const h = top + rows.length * rowH + 4;
    const maxLen = w - labW - 110;
    const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": rows.map((r) => `${r.name}: ${r.v}`).join(", ") });
    svg.appendChild(S("line", { x1: labW, x2: labW, y1: top, y2: h - 4, style: "stroke:var(--axis)", "stroke-width": 1 }));
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      const cy = y + rowH / 2;
      const len = rows[0].v ? (r.v / rows[0].v) * maxLen : 0;
      const g = S("g", { class: "ei-row", tabindex: 0, "aria-label": `${r.name}: ${r.v}` });
      g.appendChild(S("rect", { class: "ei-band", x: 0, y, width: w, height: rowH, rx: 6 }));
      g.appendChild(S("text", { x: labW - 10, y: cy + 4, "text-anchor": "end", class: "ei-lab", text: r.name }));
      g.appendChild(S("path", { class: "ei-mk", d: rightRound(labW + 1, cy - 11, len, 22, 4), style: `fill:${F(r.key)}` }));
      g.appendChild(S("text", { x: labW + 1 + len + 8, y: cy + 4, class: "ei-val", text: `${r.v}  ·  ${pct(r.v, rows[0].v)}` }));
      const rowsTip = [{ key: r.key, value: String(r.v), label: `(${pct(r.v, rows[0].v)} of accounts)` }];
      if (i > 0) rowsTip.push({ value: pct(r.v, rows[i - 1].v), label: `of ${rows[i - 1].name.toLowerCase()}` });
      bindTip(g, r.name, rowsTip);
      svg.appendChild(g);
    });
    return svg;
  }

  function columnChart(w, opt) {
    const { days, series, stacked, ariaLabel, tickEvery, labelTop } = opt;
    const n = days.length;
    const ml = 34;
    const mr = 8;
    const mt = 18;
    const mb = 28;
    const h = 250;
    const iw = w - ml - mr;
    const ih = h - mt - mb;
    const slot = n ? iw / n : iw;
    const totals = days.map((_, i) => (stacked ? series.reduce((s, x) => s + x.vals[i], 0) : Math.max(0, ...series.map((x) => x.vals[i]))));
    const { step, max } = niceMax(Math.max(...totals, 1), 4);
    const Y = (v) => mt + ih - (v / max) * ih;
    const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": ariaLabel });
    for (let v = 0; v <= max + 1e-9; v += step) {
      svg.appendChild(S("line", { x1: ml, x2: w - mr, y1: Y(v), y2: Y(v), style: `stroke:var(${v === 0 ? "--axis" : "--grid"})`, "stroke-width": 1 }));
      svg.appendChild(S("text", { x: ml - 8, y: Y(v) + 4, "text-anchor": "end", class: "ei-tick", text: v }));
    }
    days.forEach((d, i) => {
      if (i % tickEvery === 0 || i === n - 1) {
        if (i === n - 1 && (n - 1) % tickEvery !== 0 && n - 1 - Math.floor((n - 1) / tickEvery) * tickEvery < tickEvery * 0.6) return;
        svg.appendChild(S("text", { x: ml + slot * i + slot / 2, y: h - 8, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle", class: "ei-tick", text: fmtDay(d) }));
      }
    });
    days.forEach((d, i) => {
      const x0 = ml + slot * i;
      const g = S("g", { class: "ei-slot", tabindex: 0, "aria-label": `${fmtDay(d)}: ` + series.map((s) => `${s.name} ${s.vals[i]}`).join(", ") });
      g.appendChild(S("rect", { class: "ei-band", x: x0, y: mt, width: slot, height: ih }));
      if (stacked) {
        const bw = Math.min(16, slot - 6);
        const bx = x0 + (slot - bw) / 2;
        let acc = 0;
        const active = series.filter((s) => s.vals[i] > 0);
        active.forEach((s, k) => {
          const v = s.vals[i];
          const yBot = Y(acc);
          const hh = Math.max(1, yBot - Y(acc + v) - (k > 0 ? 2 : 0));
          const isTop = k === active.length - 1;
          g.appendChild(isTop ? S("path", { class: "ei-mk", d: topRound(bx, yBot - hh, bw, hh, 4), style: `fill:${F(s.key)}` }) : S("rect", { class: "ei-mk", x: bx, y: yBot - hh, width: bw, height: hh, style: `fill:${F(s.key)}` }));
          acc += v;
        });
      } else {
        const bw = Math.max(3, Math.min(11, (slot - 4) / series.length - 2));
        const tot = bw * series.length + 2 * (series.length - 1);
        const bx0 = x0 + (slot - tot) / 2;
        series.forEach((s, k) => {
          const v = s.vals[i];
          if (v <= 0) return;
          const hh = Y(0) - Y(v);
          const bx = bx0 + k * (bw + 2);
          g.appendChild(S("path", { class: "ei-mk", d: topRound(bx, Y(v), bw, hh, 3), style: `fill:${F(s.key)}` }));
        });
      }
      if (labelTop && labelTop(i, series)) {
        const v = totals[i];
        g.appendChild(S("text", { x: x0 + slot / 2, y: Y(v) - 6, "text-anchor": "middle", class: "ei-val", text: v }));
      }
      const rows = series.map((s) => ({ key: s.key, value: String(s.vals[i]), label: s.name }));
      if (stacked) rows.push({ value: String(totals[i]), label: "total" });
      bindTip(g, fmtDay(d), rows);
      svg.appendChild(g);
    });
    return svg;
  }

  const emailSeries = [
    { key: "s1", name: "Player welcome" },
    { key: "s2", name: "Booking confirmation" },
    { key: "s3", name: "Team officer" },
    { key: "s4", name: "Field & outreach" },
    { key: "gray", name: "Internal tests" },
  ];

  const cards = {
    buckets: {
      chart: bucketsChart,
      tbl: () => table([{ h: "Time to first booking" }, { h: "Players", n: 1 }, { h: "Share of bookers", n: 1 }], D.buckets.map((b) => [b.label, b.count, pct(b.count, S_.bookers)])),
    },
    dots: {
      chart: dotsChart,
      tbl: () => table([{ h: "Account created" }, { h: "Booked" }, { h: "Time to first booking", n: 1 }, { h: "Event" }], D.bookers.map((b) => [fmtDetTime(b.createdAt), fmtDetTime(b.booked), fmtLag(b.lagMin), `${b.field || "—"} · ${b.event || ""}`])),
    },
    funnel: {
      chart: funnelChart,
      tbl: () =>
        table([{ h: "Stage" }, { h: "Players", n: 1 }, { h: "Share of accounts", n: 1 }], [
          ["Accounts created", S_.realAccounts, "100%"],
          ["Finished onboarding", S_.onboarded, pct(S_.onboarded, S_.realAccounts)],
          ["Booked an event", S_.bookers, pct(S_.bookers, S_.realAccounts)],
        ]),
    },
    daily: {
      chart: (w) =>
        columnChart(w, {
          days: D.daily.map((d) => d.d),
          stacked: false,
          tickEvery: w < 560 ? 14 : 7,
          series: [
            { key: "s1", name: "Accounts created", vals: D.daily.map((d) => d.signups) },
            { key: "s2", name: "First bookings", vals: D.daily.map((d) => d.bookings) },
          ],
          ariaLabel: "Accounts created and first bookings per day.",
          labelTop: (i, series) => series[0].vals[i] === Math.max(...series[0].vals) && series[0].vals[i] > 0,
        }),
      tbl: () => table([{ h: "Day" }, { h: "Accounts created", n: 1 }, { h: "First bookings", n: 1 }], D.daily.map((d) => [fmtDay(d.d), d.signups, d.bookings])),
    },
    email: {
      chart: (w) =>
        columnChart(w, {
          days: D.emailDaily.map((d) => d.d),
          stacked: true,
          tickEvery: w < 560 ? 8 : 6,
          series: emailSeries.map((s) => ({ ...s, vals: D.emailDaily.map((d) => d[s.name] || 0) })),
          ariaLabel: `Emails sent per day by type, ${S_.emailTotal} in total.`,
        }),
      tbl: () =>
        table(
          [{ h: "Day" }, ...emailSeries.map((s) => ({ h: s.name, n: 1 })), { h: "Total", n: 1 }],
          D.emailDaily.map((d) => [fmtDay(d.d), ...emailSeries.map((s) => d[s.name] || 0), emailSeries.reduce((a, s) => a + (d[s.name] || 0), 0)])
        ),
    },
  };

  function renderCard(id, view) {
    const c = cards[id];
    const host = $("ei-ch-" + id);
    if (!host) return;
    const w = Math.max(280, Math.floor(host.clientWidth || host.parentElement.clientWidth - 40));
    host.replaceChildren();
    if (view === "table") host.appendChild(c.tbl());
    else host.appendChild(c.chart(w));
  }

  // ---- static text ----
  const hero = $("ei-hero");
  hero.replaceChildren();
  if (S_.bookers > 0) {
    const big = H("div", { class: "ei-big" }, `${S_.within60} of ${S_.bookers}`);
    big.appendChild(H("small", {}, "bookers booked within an hour of signing up"));
    hero.appendChild(big);
    hero.appendChild(H("p", {}, `Median time from account creation to first booking: ${fmtLag(S_.medianLag)}.`));
    hero.appendChild(H("p", { class: "ei-sub" }, `${S_.within24h} of ${S_.bookers} bookers booked within a day of signing up; ${S_.over7d} took more than a week.`));
  } else {
    hero.appendChild(H("div", { class: "ei-big" }, "No bookings yet"));
  }

  const tilesEl = $("ei-tiles");
  tilesEl.replaceChildren();
  [
    ["Accounts", S_.realAccounts, "every real sign-up"],
    ["Finished onboarding", S_.onboarded, pct(S_.onboarded, S_.realAccounts) + " of accounts"],
    ["Booked an event", S_.bookers, pct(S_.bookers, S_.realAccounts) + " of accounts"],
    ["Median time to book", fmtLag(S_.medianLag), "from account creation"],
  ].forEach((t) => {
    const d = H("div", { class: "ei-tile" });
    d.append(H("div", { class: "ei-l" }, t[0]), H("div", { class: "ei-v" }, String(t[1])), H("div", { class: "ei-d" }, t[2]));
    tilesEl.appendChild(d);
  });

  legend("ei-lg-buckets", [{ key: "s2", name: "Booked within the hour" }, { key: "gray", name: "Booked days later" }]);
  legend("ei-lg-dots", [{ key: "s2", name: "Booked within an hour" }, { key: "gray", name: "Took longer than an hour" }]);
  legend("ei-lg-funnel", [{ key: "s1", name: "Sign-up stages" }, { key: "s2", name: "Booking" }]);
  legend("ei-lg-daily", [{ key: "s1", name: "Accounts created" }, { key: "s2", name: "First bookings" }]);
  legend("ei-lg-email", emailSeries);

  const slow = D.bookers.filter((b) => b.lagMin > 60);
  $("ei-cap-buckets").textContent = S_.bookers
    ? `${slow.length} of ${S_.bookers} bookers took more than an hour to book.`
    : "";
  $("ei-cap-funnel").textContent = `${S_.onboardedNotBooked} players finished onboarding but haven't booked yet.`;
  if (D.daily.length) {
    const peak = D.daily.reduce((a, d) => (d.signups > a.signups ? d : a));
    $("ei-cap-daily").textContent = peak.signups > 0 ? `Sign-ups peak on ${fmtDay(peak.d)} (${peak.signups} accounts, ${peak.bookings} first booking${peak.bookings === 1 ? "" : "s"} that day).` : "";
  }
  const t = S_.emailByType || {};
  $("ei-cap-email").textContent = `${S_.emailTotal} emails: ${t["Player welcome"] || 0} player welcomes, ${t["Booking confirmation"] || 0} booking confirmations, ${t["Team officer"] || 0} team-officer emails, ${t["Field & outreach"] || 0} field and outreach emails, ${t["Internal tests"] || 0} internal tests.`;

  const statusEl = $("ei-status");
  statusEl.replaceChildren();
  const st = S_.emailStatus || {};
  const tot = S_.emailTotal || 0;
  const STATUS_META = {
    delivered: ["✓", "Delivered", "--good"],
    opened: ["◉", "Opened", "--good"],
    clicked: ["↗", "Clicked", "--good"],
    bounced: ["!", "Bounced", "--warn"],
    complained: ["!", "Marked as spam", "--bad"],
    suppressed: ["×", "Suppressed", "--bad"],
  };
  Object.entries(st).forEach(([key, count]) => {
    const [icon, label, color] = STATUS_META[key] || ["•", key, "--muted"];
    const d = H("div");
    const b = H("b");
    const ic = H("span", { class: "ei-ic" }, icon);
    ic.style.color = `var(${color})`;
    b.append(ic, document.createTextNode(String(count)));
    d.append(b, document.createTextNode(label + " · " + pct(count, tot) + " of all emails"));
    statusEl.appendChild(d);
  });
  const hasOpens = (st.opened || 0) + (st.clicked || 0) > 0;
  $("ei-cap-delivery").textContent = hasOpens
    ? `Open/click tracking was turned on recently — only emails sent since then can show an open or click, so this rate is a floor that rises over time, not a finished number yet.`
    : `No opens or clicks tracked yet. If tracking was just turned on in Resend's domain settings, give it a little more volume before reading too much into a 0%.`;

  const notesEl = $("ei-notes");
  notesEl.replaceChildren();
  [
    `Timing comes from Atlas's own account and booking timestamps, recomputed fresh every time this page loads — not a saved snapshot.`,
    `The sample size moves with real usage: ${S_.realAccounts} accounts, ${S_.bookers} bookers today. No accounts are excluded as "test" — there's no such flag in the data to filter on.`,
    `Timing alone can't prove why someone signed up — it shows people who book immediately after creating an account, which fits event-driven sign-ups, but doesn't confirm it.`,
    `${S_.onboardedNotBooked} players finished onboarding but haven't booked. Some may have joined to browse or for a team role — the data doesn't say which.`,
  ].forEach((n) => notesEl.appendChild(H("li", {}, n)));

  function renderAll() {
    Object.keys(cards).forEach((id) => renderCard(id, container.dataset["eiView" + id] === "table" ? "table" : "chart"));
  }

  container.querySelectorAll("button.ei-tv").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.card;
      const key = "eiView" + id;
      const on = container.dataset[key] !== "table";
      container.dataset[key] = on ? "table" : "chart";
      b.textContent = on ? "View as chart" : "View as table";
      b.setAttribute("aria-pressed", on);
      renderCard(id, on ? "table" : "chart");
    };
  });

  renderAll();

  let rt;
  const ro = new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(renderAll, 60);
  });
  const wrap = container.querySelector(".ei-wrap");
  if (wrap) ro.observe(wrap);
  return () => ro.disconnect();
}
