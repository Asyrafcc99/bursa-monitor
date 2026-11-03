/* Sector page: sector.html?s=PLANTATION */
(async function () {
  const { esc, LS } = BM;
  const sector = new URLSearchParams(location.search).get("s") || "";
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COLORS = ["#4c9aff", "#e3b341", "#1fbf6b", "#f04f55", "#b07cff", "#2ec4d6", "#ff8c42", "#9aa3af", "#ff6fb5", "#7bd389"];
  const RANGES = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252, "2Y": 520 };
  let range = LS.get("sectorRange", "6M"), mode = LS.get("sectorMode", "sector");
  let all, members, hist = {}, klci = [], chart, series = [];
  let sort = LS.get("sectorSort", { key: "r", dir: -1 });

  const ret = (bars, n) => bars.length > n ? (bars.at(-1).close / bars.at(-1 - n).close - 1) * 100 : null;
  const ytd = bars => { const b = bars.filter(x => x.date < BM.todayKL().slice(0, 4) + "-01-01").pop(); return b && bars.length ? (bars.at(-1).close / b.close - 1) * 100 : null; };
  const offHigh = bars => { const l = bars.slice(-252); if (!l.length) return null; const h = Math.max(...l.map(b => b.high ?? b.close)); return (bars.at(-1).close / h - 1) * 100; };

  async function load() {
    all = await BM.loadAll();
    members = all.data.stocks.filter(s => s.sector === sector);
    if (!members.length) throw new Error("Unknown sector " + sector);
    const files = await Promise.all(members.map(s => BM.getJSON(`history/${s.code}_1d.json`).catch(() => ({ bars: [] }))));
    members.forEach((s, i) => {
      const bars = files[i].bars || [];
      const q = s.quote || {};
      // use the latest delayed price as today's close if the daily file doesn't have today yet
      if (!q.error && (q.price_time_kl || "").startsWith(BM.todayKL()) && (!bars.length || bars.at(-1).date < BM.todayKL()))
        bars.push({ date: BM.todayKL(), close: q.price, high: q.day_high, low: q.day_low, partial: true });
      else if (!q.error && bars.length && bars.at(-1).date === BM.todayKL()) bars.at(-1).close = q.price;
      hist[s.code] = bars;
    });
    klci = (await BM.getJSON("history/KLCI_1d.json").catch(() => ({ bars: [] }))).bars || [];
    const ix = all.data.index;
    if (ix && !ix.error && klci.length && (ix.price_time_kl || "").startsWith(BM.todayKL())) {
      if (klci.at(-1).date < BM.todayKL()) klci.push({ date: BM.todayKL(), close: ix.price }); else klci.at(-1).close = ix.price;
    }
  }

  // % change from the first day of the range
  function rebased(bars, startDate) {
    const b = bars.filter(x => x.date >= startDate);
    if (!b.length) return [];
    const base = b[0].close;
    return b.map(x => ({ time: x.date, value: +((x.close / base - 1) * 100).toFixed(2) }));
  }
  function rangeStart() {
    const dates = [...new Set(members.flatMap(s => hist[s.code].map(b => b.date)))].sort();
    return dates[Math.max(0, dates.length - RANGES[range])];
  }
  function sectorLine(start) {
    // equal-weighted average of each member's % change since start (members with a price on the start date)
    const lines = members.map(s => hist[s.code]).filter(b => b.length && b[0].date <= start).map(b => new Map(rebased(b, start).map(p => [p.time, p.value])));
    const dates = [...new Set(lines.flatMap(m => [...m.keys()]))].sort();
    return { n: lines.length, data: dates.map(d => { const v = lines.map(m => m.get(d)).filter(x => x != null); return { time: d, value: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) }; }) };
  }

  // ---------- chart ----------
  function buildChart() {
    chart = LightweightCharts.createChart(document.getElementById("chart"), {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--muted") },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") },
      localization: { priceFormatter: v => (v > 0 ? "+" : "") + v.toFixed(1) + "%" },
    });
    chart.subscribeCrosshairMove(p => {
      const lg = document.getElementById("legend");
      if (!p || !p.time) { lg.innerHTML = legendKey(); return; }
      lg.innerHTML = `<b>${p.time}</b> · ` + series.map(x => { const v = p.seriesData.get(x.s); return v ? `<span class="swatch" style="background:${x.color}"></span>${esc(x.name)} ${BM.pct(v.value)}` : ""; }).filter(Boolean).join(" · ");
    });
  }
  const legendKey = () => series.map(x => `<span class="swatch" style="background:${x.color}"></span>${esc(x.name)}`).join(" &nbsp; ") + `<div class="small">Hover or tap the chart for values on a date.</div>`;

  function drawChart() {
    series.forEach(x => chart.removeSeries(x.s)); series = [];
    const start = rangeStart();
    const add = (name, data, color, width = 2) => {
      if (!data.length) return;
      const s = chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: true, title: "" });
      s.setData(data); series.push({ s, name, color });
    };
    let note;
    if (mode === "sector") {
      const sl = sectorLine(start);
      add(`${sector} (${sl.n} stocks, equal-weighted)`, sl.data, css("--accent"), 3);
      add("FBM KLCI", rebased(klci, start), "#9aa3af", 2);
      note = klci.length ? "" : "KLCI history not saved yet";
    } else {
      members.forEach((m, i) => add(m.short, rebased(hist[m.code], start), COLORS[i % COLORS.length]));
    }
    series[0]?.s.createPriceLine({ price: 0, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    document.getElementById("chartNote").textContent = `% change since ${start}` + (note ? " · " + note : "");
    document.getElementById("legend").innerHTML = legendKey();
    chart.timeScale().fitContent();
    document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    document.getElementById("ranges").innerHTML = Object.keys(RANGES).map(r => `<button data-range="${r}" class="${r === range ? "on" : ""}">${r}</button>`).join("");
    renderRanking();
  }

  // ---------- tables ----------
  function rows() {
    return members.map(s => {
      const b = hist[s.code], q = s.quote || {};
      return { s, q, price: q.price, chg: q.error ? null : q.change_pct, w1: ret(b, 5), m1: ret(b, 21), m3: ret(b, 63), m6: ret(b, 126), y1: ret(b, 252), ytd: ytd(b), hi: offHigh(b), pace: BM.pace(s), r: ret(b, Math.min(RANGES[range], b.length - 1)) };
    });
  }
  function renderRanking() {
    const rs = rows().filter(r => r.r != null).sort((a, b) => b.r - a.r);
    const mx = Math.max(...rs.map(r => Math.abs(r.r)), 1);
    document.getElementById("rankNote").textContent = range + " return";
    document.getElementById("ranking").innerHTML = `<div class="rank">` + rs.map(r => `<div class="row"><div>
      <div class="lab"><a href="company.html?code=${r.s.code}">${esc(r.s.short)}</a><span class="${BM.cls(r.r)}">${BM.pct(r.r)}</span></div>
      <div class="bar" style="width:${Math.abs(r.r) / mx * 100}%;background:${r.r >= 0 ? "var(--up)" : "var(--down)"}"></div></div>
      <div>${BM.spark(r.q.spark, r.q.prev_close, 70, 20)}</div></div>`).join("") + `</div>`;
  }
  function renderMembers() {
    const cols = [["code", "Code"], ["name", "Name"], ["price", "Price"], ["chg", "Today"], ["w1", "1W"], ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["ytd", "YTD"], ["y1", "1Y"], ["hi", "From 52W high"], ["pace", "Vol vs normal"]];
    const val = (r, k) => k === "code" ? r.s.code : k === "name" ? r.s.short : r[k];
    const rs = rows().sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
    const p = v => `<td class="${BM.cls(v)}">${BM.pct(v)}</td>`;
    document.getElementById("members").innerHTML = `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th data-sort="${c[0]}">${c[1]}${sort.key === c[0] ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>` +
      rs.map(r => `<tr><td>${r.s.code}</td><td><a href="company.html?code=${r.s.code}">${esc(r.s.short)}</a></td>` +
        (r.q.error ? `<td colspan="10" class="warn">${esc(r.q.error)}</td>` :
        `<td>${r.price.toFixed(3)}</td>${p(r.chg)}${p(r.w1)}${p(r.m1)}${p(r.m3)}${p(r.m6)}${p(r.ytd)}${p(r.y1)}${p(r.hi)}<td>${r.pace == null ? "–" : r.pace.toFixed(1) + "x"}</td>`) + `</tr>`).join("") +
      `</tbody></table></div>`;
    if (!document.getElementById("rowsAvg")) {}
  }
  function renderRest() {
    const q = members.map(s => s.quote).filter(q => q && !q.error);
    const avg = q.length ? q.reduce((a, b) => a + b.change_pct, 0) / q.length : null;
    const up = q.filter(x => x.change_pct > 0).length, dn = q.filter(x => x.change_pct < 0).length;
    const codes = new Set(members.map(s => s.code));
    const al = all.alerts.filter(a => codes.has(a.code));
    document.title = `${sector} · Bursa Monitor`;
    document.getElementById("status").innerHTML = `Market: <b>${BM.marketStatus()}</b> · Last update <b>${BM.t(all.data.collected_at_kl, true)}</b> KL · Prices delayed ~15 min`;
    document.getElementById("hero").innerHTML = `<div class="small">Sector · ${members.length} stocks in my coverage</div><h1 style="margin:2px 0 10px;font-size:22px">${esc(sector)}</h1>
      <div class="kpis">
        <div class="kpi"><div class="small">Average move today</div><div class="v ${BM.cls(avg)}">${BM.pct(avg)}</div></div>
        <div class="kpi"><div class="small">Up / Down / Flat</div><div class="v"><span class="up">${up}</span> / <span class="down">${dn}</span> / ${q.length - up - dn}</div></div>
        <div class="kpi"><div class="small">FBM KLCI today</div><div class="v ${BM.cls(all.data.index?.change_pct)}">${BM.pct(all.data.index?.change_pct)}</div></div>
        <div class="kpi"><div class="small">Alerts today</div><div class="v">${al.filter(a => a.time_kl.startsWith(BM.todayKL())).length}</div></div>
      </div>`;
    document.getElementById("tiles").innerHTML = members.map(s => { const c = s.quote && !s.quote.error ? s.quote.change_pct : null;
      return `<a class="tile" href="company.html?code=${s.code}" style="text-decoration:none;background:${BM.heat(c)};color:${c != null && Math.abs(c) < 1.2 && c !== 0 ? "var(--fg)" : "#fff"}"><div class="n">${esc(s.short)}</div><div class="c">${c == null ? "n/a" : BM.pct(c)}</div></a>`; }).join("");
    document.getElementById("alerts").innerHTML = al.length ? `<div class="feed">${al.map(a => `<div class="item"><span class="tag ${a.type}">${a.type}</span>${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.text)}</a>` : esc(a.text)}<div class="small">${BM.t(a.time_kl, true)}</div></div>`).join("")}</div>` : '<div class="small">None in the last 5 days.</div>';
    const nw = all.news.filter(n => codes.has(n.code));
    document.getElementById("news").innerHTML = nw.length ? `<div class="feed">${nw.slice(0, 40).map(n => `<div class="item"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="small"><a href="company.html?code=${n.code}">${esc(n.short)}</a> · ${esc(n.source || "")} · ${n.date ? BM.ago(n.date) : ""}</div></div>`).join("")}</div>` : '<div class="small">No headlines in the last 7 days.</div>';
    const secs = [...new Set(all.data.stocks.map(s => s.sector))];
    document.getElementById("jump").innerHTML = secs.map(x => `<option value="${esc(x)}" ${x === sector ? "selected" : ""}>${esc(x)}</option>`).join("");
  }

  // ---------- events ----------
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-range],[data-mode],[data-sort]"); if (!b) return;
    if (b.dataset.range) { range = b.dataset.range; LS.set("sectorRange", range); drawChart(); renderMembers(); }
    else if (b.dataset.mode) { mode = b.dataset.mode; LS.set("sectorMode", mode); drawChart(); }
    else if (b.dataset.sort) { sort = sort.key === b.dataset.sort ? { key: sort.key, dir: -sort.dir } : { key: b.dataset.sort, dir: -1 }; LS.set("sectorSort", sort); renderMembers(); }
  });
  document.getElementById("jump").addEventListener("change", e => { location.href = "sector.html?s=" + encodeURIComponent(e.target.value); });

  async function refresh(first) {
    try { await load(); }
    catch (e) { document.getElementById("status").innerHTML = `<span class="warn">${esc(e.message)}. <a href="./">Back to dashboard</a></span>`; return; }
    renderRest(); renderMembers();
    if (first) buildChart();
    drawChart();
  }
  await refresh(true);
  setInterval(() => { if (!document.hidden) refresh(false); }, 120000);
})();
