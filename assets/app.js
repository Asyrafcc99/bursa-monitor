/* Bursa Monitor dashboard core: loads data, keeps filters/layout, draws panels, stock drawer. */
(function () {
  // Data lives on the "data" branch so 5-minute updates don't rebuild the site.
  const DATA_URL = location.hostname.endsWith("github.io")
    ? "https://raw.githubusercontent.com/Asyrafcc99/bursa-monitor/data/"
    : "data/";
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const state = { data: null, alerts: [], news: [], sector: LS.get("sector", "ALL"), q: "" };
  const layout = LS.get("layout", { order: PANELS.map(p => p.id), hidden: [] });
  PANELS.forEach(p => { if (!layout.order.includes(p.id)) layout.order.push(p.id); });
  const seenNews = new Set(LS.get("seenNews", []));
  const lastAlertVisit = LS.get("lastAlertVisit", "");

  // ---------- helpers shared with panels ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const klNow = () => new Date(Date.now() + 8 * 3600e3); // use getUTC* on this for KL clock
  window.BM = {
    esc,
    sort: LS.get("sort", { key: "chg", dir: -1 }),
    newsLimit: 25,
    num: n => n == null ? "–" : Number(n).toLocaleString("en-MY"),
    pct: n => n == null || isNaN(n) ? "–" : (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%",
    cls: n => n > 0 ? "up" : n < 0 ? "down" : "",
    todayKL: () => klNow().toISOString().slice(0, 10),
    t(iso, withDate) {
      if (!iso) return "unknown time";
      const [d, tm] = iso.split("T"); const hm = tm.slice(0, 5);
      return withDate || d !== BM.todayKL() ? `${d.slice(8, 10)}/${d.slice(5, 7)} ${hm}` : hm;
    },
    ago(date) {
      const m = (Date.now() - date) / 60000;
      return m < 60 ? Math.round(m) + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
    },
    heat(c) {
      if (c == null) return "var(--flat)";
      const a = Math.min(Math.abs(c) / 3, 1);
      return c > 0 ? `rgba(31,191,107,${0.35 + a * 0.65})` : c < 0 ? `rgba(240,79,85,${0.35 + a * 0.65})` : "var(--flat)";
    },
    // volume vs 20-day average, scaled to how much of the trading day has passed (same rule as alerts)
    pace(s) {
      const q = s.quote, st = s.stats;
      if (!q || q.error || !st || st.error || !q.volume || !st.avg_volume_20d) return null;
      if (!(q.price_time_kl || "").startsWith(BM.todayKL())) return null;
      const k = klNow(), t = k.getUTCHours() * 60 + k.getUTCMinutes();
      const el = Math.max(0, Math.min(t, 750) - 540) + Math.max(0, Math.min(t, 1005) - 870);
      if (el < 30) return null;
      return q.volume / (st.avg_volume_20d * Math.min(el, 345) / 345);
    },
    spark(arr, base, w = 90, h = 24) {
      if (!arr || arr.length < 2) return '<span class="small">–</span>';
      const vals = base ? [...arr, base] : arr;
      const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
      const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - (v - mn) / r * h).toFixed(1)}`).join(" ");
      const col = arr[arr.length - 1] >= (base ?? arr[0]) ? "var(--up)" : "var(--down)";
      const by = base ? (h - (base - mn) / r * h).toFixed(1) : null;
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
        (by ? `<line x1="0" x2="${w}" y1="${by}" y2="${by}" stroke="var(--muted)" stroke-dasharray="2 3" stroke-width="1"/>` : "") +
        `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5"/></svg>`;
    },
    isNewNews: n => seenNews.size > 0 && !seenNews.has(n.link),
    isNewAlert: a => lastAlertVisit && a.time_kl > lastAlertVisit,
  };

  // ---------- market status ----------
  function marketStatus() {
    const k = klNow(), d = k.getUTCDay(), t = k.getUTCHours() * 60 + k.getUTCMinutes();
    if (d === 0 || d === 6) return "Closed (weekend)";
    if (t >= 540 && t < 750) return "Open (morning session)";
    if (t >= 750 && t < 870) return "Lunch break";
    if (t >= 870 && t < 1005) return "Open (afternoon session)";
    return t < 540 ? "Pre-open" : "Closed";
  }

  // ---------- load ----------
  async function load() {
    const bust = "?t=" + Math.floor(Date.now() / 60000);
    const [d, a] = await Promise.all([
      fetch(DATA_URL + "latest.json" + bust).then(r => r.ok ? r.json() : Promise.reject(new Error("latest.json " + r.status))),
      fetch(DATA_URL + "alerts.json" + bust).then(r => r.ok ? r.json() : { alerts: [] }).catch(() => ({ alerts: [] })),
    ]);
    const stats = await fetch(DATA_URL + "daily_stats.json" + bust).then(r => r.ok ? r.json() : {}).catch(() => ({}));
    d.stocks.forEach(s => { s.stats = s.stats || stats[s.code]; });
    state.data = d;
    state.alerts = a.alerts || [];
    const seen = new Set();
    state.news = d.stocks.flatMap(s => (s.news || []).map(n => ({ ...n, code: s.code, short: s.short, sector: s.sector, date: n.published ? new Date(n.published) : null })))
      .filter(n => !seen.has(n.link) && seen.add(n.link))
      .sort((x, y) => (y.date || 0) - (x.date || 0));
  }

  // ---------- render ----------
  function ctx() {
    const q = state.q.trim().toLowerCase();
    const all = state.data.stocks;
    const stocks = all.filter(s => (state.sector === "ALL" || s.sector === state.sector) &&
      (!q || (s.code + " " + s.short + " " + s.name).toLowerCase().includes(q) || state.news.some(n => n.code === s.code && n.title.toLowerCase().includes(q))));
    const bySector = all.filter(s => state.sector === "ALL" || s.sector === state.sector);
    return { data: state.data, all, stocks, alerts: state.alerts, news: state.news, q,
             codes: new Set(bySector.map(s => s.code)) };
  }

  function renderStatus() {
    const d = state.data;
    const age = Math.round((Date.now() - new Date(d.collected_at_kl)) / 60000);
    document.getElementById("status").innerHTML =
      `Market: <b>${marketStatus()}</b> · Last update <b>${BM.t(d.collected_at_kl, true)}</b> KL` +
      (age > 20 ? ` <span class="warn">(${age} min ago${marketStatus().startsWith("Open") ? ", data may be stale" : ""})</span>` : "") +
      ` · Prices delayed ~15 min`;
  }

  function renderChips() {
    const secs = ["ALL", ...new Set(state.data.stocks.map(s => s.sector))];
    document.getElementById("sectorChips").innerHTML = secs.map(s =>
      `<button class="chip ${state.sector === s ? "on" : ""}" data-sector="${esc(s)}">${s === "ALL" ? "All sectors" : esc(s)}</button>`).join("");
  }

  function render() {
    renderStatus(); renderChips();
    const c = ctx();
    document.getElementById("panels").innerHTML = layout.order
      .map(id => PANELS.find(p => p.id === id)).filter(p => p && !layout.hidden.includes(p.id))
      .map(p => {
        let body;
        try { body = p.render(c); } catch (e) { body = `<div class="warn">Panel error: ${esc(e.message)}</div>`; }
        return `<section class="panel w${p.width || 12}" id="panel-${p.id}"><h2>${esc(p.title)}</h2>${body}</section>`;
      }).join("");
  }

  // ---------- stock drawer ----------
  function openStock(code) {
    const s = state.data.stocks.find(x => x.code === code); if (!s) return;
    const q = s.quote || {}, st = s.stats || {};
    const p = BM.pace(s);
    const news = state.news.filter(n => n.code === code);
    const al = state.alerts.filter(a => a.code === code);
    document.getElementById("drawer").innerHTML = `
      <div class="head"><div><div class="small">${esc(s.sector)} · ${s.code}</div><h2 style="margin:2px 0">${esc(s.name)}</h2></div>
        <button data-action="close">✕</button></div>
      ${q.error ? `<p class="warn">${esc(q.error)}</p>` : `
      <div class="big">RM ${q.price.toFixed(3)} <span class="${BM.cls(q.change_pct)}" style="font-size:18px">${BM.pct(q.change_pct)}</span></div>
      <div class="small">As of ${BM.t(q.price_time_kl, true)} KL · ${esc(q.delayed)} (${esc(q.source)})</div>
      <div style="margin-top:8px">${BM.spark(q.spark, q.prev_close, 480, 90)}</div>
      <div class="small">Today, 5-minute prices. Dashed line = yesterday's close (RM ${q.prev_close})</div>
      <div class="grid2">
        <div><div class="small">Day range</div>${q.day_low ?? "–"} – ${q.day_high ?? "–"}</div>
        <div><div class="small">Volume</div>${BM.num(q.volume)}</div>
        <div><div class="small">20-day avg volume</div>${st.error ? "n/a" : BM.num(st.avg_volume_20d)}</div>
        <div><div class="small">Volume vs normal pace</div>${p == null ? "–" : p.toFixed(1) + "x"}</div>
        <div><div class="small">Normal daily move</div>${st.daily_move_sd_pct ? "±" + st.daily_move_sd_pct + "%" : "n/a"}</div>
        <div><div class="small">More detail</div><a href="${esc(s.klsescreener_url)}" target="_blank" rel="noopener">Open in KLSE Screener ↗</a></div>
      </div>`}
      <h3>Alerts</h3>${al.length ? `<div class="feed">${al.map(a => `<div class="item"><span class="tag ${a.type}">${a.type}</span>${esc(a.text)}<div class="small">${BM.t(a.time_kl, true)}</div></div>`).join("")}</div>` : '<div class="small">None in the last 5 days.</div>'}
      <h3>News</h3>${news.length ? `<div class="feed">${news.map(n => `<div class="item"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="small">${esc(n.source || "")} · ${n.date ? BM.ago(n.date) : ""}</div></div>`).join("")}</div>` : `<div class="small">${esc(s.news_error || "No headlines in the last 7 days.")}</div>`}`;
    document.getElementById("drawerOverlay").hidden = false;
  }

  // ---------- customize ----------
  function openCustomize() {
    document.getElementById("customDialog").innerHTML = `<h2 style="margin-top:0">Customize panels</h2>
      <div class="small" style="margin-bottom:8px">Tick to show, arrows to reorder. Saved in this browser.</div>` +
      layout.order.map((id, i) => {
        const p = PANELS.find(x => x.id === id); if (!p) return "";
        return `<div class="prow"><input type="checkbox" id="cb-${id}" data-toggle="${id}" ${layout.hidden.includes(id) ? "" : "checked"}>
          <label for="cb-${id}">${esc(p.title)}</label>
          <button data-move="${id}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑</button>
          <button data-move="${id}" data-dir="1" ${i === layout.order.length - 1 ? "disabled" : ""}>↓</button></div>`;
      }).join("") + `<div style="display:flex;gap:8px;margin-top:12px"><button data-action="resetLayout">Reset</button><span style="flex:1"></span><button data-action="closeCustom">Done</button></div>`;
    document.getElementById("customOverlay").hidden = false;
  }
  const saveLayout = () => { LS.set("layout", layout); render(); openCustomize(); };

  // ---------- events ----------
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-stock],[data-sector],[data-sort],[data-action],[data-move],[data-toggle]");
    if (e.target.id === "drawerOverlay") return (document.getElementById("drawerOverlay").hidden = true);
    if (e.target.id === "customOverlay") return (document.getElementById("customOverlay").hidden = true);
    if (!el) return;
    if (el.closest("a")) return;
    const ds = el.dataset;
    if (ds.stock) openStock(ds.stock);
    else if (ds.sector) { state.sector = ds.sector; LS.set("sector", ds.sector); render(); }
    else if (ds.sort !== undefined) {
      if (!ds.sort) return;
      BM.sort = BM.sort.key === ds.sort ? { key: ds.sort, dir: -BM.sort.dir } : { key: ds.sort, dir: -1 };
      LS.set("sort", BM.sort); render();
    }
    else if (ds.toggle) {
      layout.hidden = el.checked ? layout.hidden.filter(x => x !== ds.toggle) : [...layout.hidden, ds.toggle]; saveLayout();
    }
    else if (ds.move) {
      const i = layout.order.indexOf(ds.move), j = i + Number(ds.dir);
      [layout.order[i], layout.order[j]] = [layout.order[j], layout.order[i]]; saveLayout();
    }
    else if (ds.action === "close") document.getElementById("drawerOverlay").hidden = true;
    else if (ds.action === "closeCustom") document.getElementById("customOverlay").hidden = true;
    else if (ds.action === "resetLayout") { layout.order = PANELS.map(p => p.id); layout.hidden = []; saveLayout(); }
    else if (ds.action === "moreNews") { BM.newsLimit += 25; render(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".overlay").forEach(o => (o.hidden = true)); });
  let tmr;
  document.getElementById("search").addEventListener("input", e => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = e.target.value; render(); }, 200); });
  document.getElementById("customizeBtn").addEventListener("click", openCustomize);
  document.getElementById("refreshBtn").addEventListener("click", start);

  async function start() {
    try { await load(); render(); }
    catch (e) { document.getElementById("status").innerHTML = `<span class="warn">Could not load data: ${esc(e.message)}</span>`; return; }
    // remember what was seen, so next visit highlights only newer items
    LS.set("seenNews", [...new Set([...seenNews, ...state.news.map(n => n.link)])].slice(-800));
    if (state.alerts[0]) LS.set("lastAlertVisit", state.alerts[0].time_kl);
  }
  start();
  // refresh every 2 minutes while the page is open
  setInterval(() => { if (!document.hidden) start(); }, 120000);
})();
