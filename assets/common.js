/* Shared helpers for all pages (dashboard, company page). */
(function () {
  // Data lives on the "data" branch so 5-minute updates don't rebuild the site.
  const DATA_URL = location.hostname.endsWith("github.io")
    ? "https://raw.githubusercontent.com/Asyrafcc99/bursa-monitor/data/"
    : "data/";
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
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
    pct: n => { if (n == null || isNaN(n)) return "–"; const r = Math.round(n * 100) / 100; return (r > 0 ? "+" : "") + (r === 0 ? 0 : r).toFixed(2) + "%"; },
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
    tagHtml: tags => (tags || []).map(t => `<span class="tag ntag">${esc(t)}</span>`).join(""),
    newsTag: "",
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


  // load latest prices, alerts, stats and merged news
  async function loadAll() {
    const bust = "?t=" + Math.floor(Date.now() / 60000);
    const [d, a, stats] = await Promise.all([
      fetch(DATA_URL + "latest.json" + bust).then(r => r.ok ? r.json() : Promise.reject(new Error("latest.json " + r.status))),
      fetch(DATA_URL + "alerts.json" + bust).then(r => r.ok ? r.json() : { alerts: [] }).catch(() => ({ alerts: [] })),
      fetch(DATA_URL + "daily_stats.json" + bust).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);
    d.stocks.forEach(s => { s.stats = s.stats || stats[s.code]; });
    const seen = new Set();
    const news = d.stocks.flatMap(s => (s.news || []).map(n => ({ ...n, code: s.code, short: s.short, sector: s.sector, date: n.published ? new Date(n.published) : null })))
      .filter(n => !seen.has(n.link) && seen.add(n.link))
      .sort((x, y) => (y.date || 0) - (x.date || 0));
    return { data: d, alerts: a.alerts || [], news };
  }
  const getJSON = path => fetch(DATA_URL + path + "?t=" + Math.floor(Date.now() / 60000)).then(r => r.ok ? r.json() : Promise.reject(new Error(path + " " + r.status)));
  Object.assign(BM, { LS, DATA_URL, klNow, marketStatus, loadAll, getJSON, seenNews, lastAlertVisit });
})();
