/* Company deep-dive page: company.html?code=5031 */
(async function () {
  const { esc, LS } = BM;
  const code = new URLSearchParams(location.search).get("code") || "";
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let all, s, daily = [], intra = [], chart, main, volS, sma20S, sma50S;
  let range = LS.get("chartRange", "6M");
  const RANGES = { "1D": 1, "5D": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252, "2Y": 520 };

  function klDate(ts) { return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10); }

  async function loadData() {
    all = await BM.loadAll();
    s = all.data.stocks.find(x => x.code === code);
    if (!s) throw new Error("Unknown stock code " + code);
    const [d, m] = await Promise.all([
      BM.getJSON(`history/${code}_1d.json`).catch(() => ({ bars: [] })),
      BM.getJSON(`history/${code}_5m.json`).catch(() => ({ bars: [] })),
    ]);
    daily = d.bars || [];
    intra = m.bars || [];
    // add today's candle from 5-minute bars if the daily file doesn't have it yet
    const q = s.quote || {};
    const today = BM.todayKL();
    const todays = intra.filter(b => klDate(b[0]) === today);
    if (todays.length && (!daily.length || daily[daily.length - 1].date < today) && !q.error) {
      daily.push({ date: today, open: todays[0][1], high: Math.max(...todays.map(b => b[2])), low: Math.min(...todays.map(b => b[3])),
                   close: q.price, volume: q.volume, partial: true });
    }
  }

  function sma(n) {
    const out = [];
    for (let i = n - 1; i < daily.length; i++) {
      let sum = 0; for (let j = i - n + 1; j <= i; j++) sum += daily[j].close;
      out.push({ time: daily[i].date, value: +(sum / n).toFixed(4) });
    }
    return out;
  }
  const ret = n => daily.length > n ? (daily[daily.length - 1].close / daily[daily.length - 1 - n].close - 1) * 100 : null;

  // ---------- render static parts ----------
  function renderHero() {
    const q = s.quote || {};
    document.title = `${s.short} (${s.code}) · Bursa Monitor`;
    document.getElementById("hero").innerHTML = `<div class="hero">
      <div><div class="small"><a href="sector.html?s=${encodeURIComponent(s.sector)}">${esc(s.sector)}</a> · ${s.code} · Main Market</div><h1>${esc(s.name)}</h1></div>
      ${q.error ? `<div class="warn">${esc(q.error)}</div>` : `<div><span class="big" style="font-size:28px;font-weight:800">RM ${q.price.toFixed(3)}</span>
        <span class="${BM.cls(q.change_pct)}" style="font-size:18px"> ${BM.pct(q.change_pct)}</span>
        <div class="small">As of ${BM.t(q.price_time_kl, true)} KL · ${esc(q.delayed)} (${esc(q.source)})</div></div>`}
      <div style="margin-left:auto;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        <a href="https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=${s.code}" target="_blank" rel="noopener">Bursa announcements ↗</a>
        <a href="${esc(s.klsescreener_url)}" target="_blank" rel="noopener">Open in KLSE Screener ↗</a></div></div>`;
    document.getElementById("status").innerHTML = `Market: <b>${BM.marketStatus()}</b> · Last update <b>${BM.t(all.data.collected_at_kl, true)}</b> KL`;
  }

  function renderStats() {
    const q = s.quote || {}, st = s.stats || {};
    const last252 = daily.slice(-252);
    const hi = last252.length ? Math.max(...last252.map(b => b.high ?? b.close)) : null;
    const lo = last252.length ? Math.min(...last252.map(b => b.low ?? b.close)) : null;
    const ytdBase = daily.filter(b => b.date < BM.todayKL().slice(0, 4) + "-01-01").pop();
    const ytd = ytdBase && daily.length ? (daily[daily.length - 1].close / ytdBase.close - 1) * 100 : null;
    const p = BM.pace(s);
    const row = (k, v) => `<div><span class="small">${k}</span><span>${v}</span></div>`;
    const r = v => `<span class="${BM.cls(v)}">${BM.pct(v)}</span>`;
    document.getElementById("stats").innerHTML = `<h2>Key numbers</h2><div class="statlist">` +
      row("Previous close", q.prev_close ?? "–") +
      row("Day range", q.day_low != null ? `${q.day_low} – ${q.day_high}` : "–") +
      row("Volume", BM.num(q.volume)) +
      row("20-day avg volume", st.error ? "n/a" : BM.num(st.avg_volume_20d)) +
      row("Volume vs normal pace", p == null ? "–" : p.toFixed(1) + "x") +
      row("Normal daily move", st.daily_move_sd_pct ? "±" + st.daily_move_sd_pct + "%" : "n/a") +
      row("52-week range", hi != null ? `${lo.toFixed(3)} – ${hi.toFixed(3)}` : "n/a") +
      row("From 52-week high", hi ? r((daily[daily.length - 1].close / hi - 1) * 100) : "n/a") +
      row("1 week", r(ret(5))) + row("1 month", r(ret(21))) + row("3 months", r(ret(63))) +
      row("6 months", r(ret(126))) + row("1 year", r(ret(252))) + row("Year to date", r(ytd)) +
      `</div><div class="small" style="margin-top:6px">Returns use daily closes from Yahoo Finance${daily.at(-1)?.partial ? " (today's close is the latest delayed price)" : ""}. Not adjusted for dividends.</div>`;
  }

  function renderFeeds() {
    const al = all.alerts.filter(a => a.code === code);
    document.getElementById("alerts").innerHTML = al.length ? `<div class="feed">${al.map(a => `<div class="item"><span class="tag ${a.type}">${a.type}</span>${BM.tagHtml(a.tags)}${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.text)}</a>` : esc(a.text)}<div class="small">${BM.t(a.time_kl, true)}</div></div>`).join("")}</div>` : '<div class="small">None in the last 5 days.</div>';
    const nw = all.news.filter(n => n.code === code);
    document.getElementById("news").innerHTML = nw.length ? `<div class="feed">${nw.map(n => `<div class="item">${BM.tagHtml(n.tags)}<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="small">${esc(n.source || "")} · ${n.date ? BM.ago(n.date) : ""}</div></div>`).join("")}</div>` : `<div class="small">${esc(s.news_error || "No headlines naming this company in the last 7 days.")}</div>`;
  }

  function renderPeers() {
    const peers = all.data.stocks.filter(x => x.sector === s.sector);
    document.getElementById("peers").innerHTML = `<h2><span>${esc(s.sector)} peers in my coverage</span><a href="sector.html?s=${encodeURIComponent(s.sector)}">Sector page →</a></h2><div class="tablewrap"><table><thead><tr><th>Code</th><th>Name</th><th>Price (RM)</th><th>Change</th><th>Vol vs normal</th><th>Today</th></tr></thead><tbody>` +
      peers.map(x => { const q = x.quote || {}; const p = BM.pace(x);
        return `<tr onclick="location.href='company.html?code=${x.code}'" style="${x.code === code ? "font-weight:700" : ""}"><td>${x.code}</td><td><a href="company.html?code=${x.code}">${esc(x.short)}</a></td>` +
          (q.error ? `<td colspan="4" class="warn">${esc(q.error)}</td>` : `<td>${q.price.toFixed(3)}</td><td class="${BM.cls(q.change_pct)}">${BM.pct(q.change_pct)}</td><td>${p == null ? "–" : p.toFixed(1) + "x"}</td><td>${BM.spark(q.spark, q.prev_close)}</td>`) + `</tr>`; }).join("") +
      `</tbody></table></div>`;
    document.getElementById("jump").innerHTML = all.data.stocks.map(x => `<option value="${x.code}" ${x.code === code ? "selected" : ""}>${x.code} ${esc(x.short)}</option>`).join("");
  }

  // ---------- notes (notes/<code>.md in the repo; edited on GitHub) ----------
  function md(text) {
    const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const lines = text.replace(/<!--[\s\S]*?-->/g, "").trim().split("\n");
    let html = "", inList = false;
    for (const l of lines) {
      const li = l.match(/^\s*[-*]\s+(.*)/), h = l.match(/^#+\s+(.*)/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      if (h) html += `<h3>${inline(h[1])}</h3>`; else if (l.trim()) html += `<p>${inline(l)}</p>`;
    }
    return html + (inList ? "</ul>" : "");
  }
  async function renderNotes() {
    document.getElementById("editNotes").href = `https://github.com/Asyrafcc99/bursa-monitor/edit/main/notes/${code}.md`;
    const text = await fetch(`notes/${code}.md?t=${Math.floor(Date.now() / 60000)}`).then(r => r.ok ? r.text() : "").catch(() => "");
    const html = md(text);
    document.getElementById("notes").innerHTML = html || '<div class="small">No notes yet. Tap "Edit on GitHub" to add some.</div>';
  }

  // ---------- chart ----------
  function buildChart() {
    const el = document.getElementById("chart");
    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--muted") },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line") },
      timeScale: { borderColor: css("--line"), timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chart.subscribeCrosshairMove(p => {
      const lg = document.getElementById("legend");
      if (!p || !p.time || !main) { lg.textContent = "Hover or tap the chart to see values."; return; }
      const v = p.seriesData.get(main), vv = volS ? p.seriesData.get(volS) : null;
      if (!v) return;
      const t = typeof p.time === "number" ? new Date(p.time * 1000).toISOString().slice(0, 16).replace("T", " ") + " KL" : p.time;
      const f = x => Number(x).toFixed(3);
      lg.textContent = v.open != null ? `${t}  O ${f(v.open)}  H ${f(v.high)}  L ${f(v.low)}  C ${f(v.close)}` + (vv ? `  Vol ${BM.num(vv.value)}` : "") : `${t}  ${f(v.value)}` + (vv ? `  Vol ${BM.num(vv.value)}` : "");
    });
  }

  function drawChart() {
    [main, volS, sma20S, sma50S].forEach(x => x && chart.removeSeries(x));
    main = volS = sma20S = sma50S = null;
    const intraday = range === "1D" || range === "5D";
    const up = css("--up"), dn = css("--down");
    let rows;
    if (intraday) {
      const days = [...new Set(intra.map(b => klDate(b[0])))].slice(-RANGES[range]);
      rows = intra.filter(b => days.includes(klDate(b[0]))).map(b => ({ time: b[0] + 8 * 3600, open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] }));
    } else {
      rows = daily.slice(-RANGES[range]).map(b => ({ time: b.date, open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close, volume: b.volume }));
    }
    const note = document.getElementById("chartNote");
    if (!rows.length) {
      note.innerHTML = `<span class="warn">${intraday ? "No 5-minute history saved yet (it builds up from today)." : "No daily history yet."}</span>`;
      return;
    }
    note.textContent = intraday ? "5-minute bars, KL time, delayed ~15 min" : "Daily bars" + (daily.at(-1)?.partial ? ", today's bar still forming" : "");
    if (document.getElementById("line").checked) {
      main = chart.addAreaSeries({ lineColor: css("--accent"), topColor: "rgba(76,154,255,.25)", bottomColor: "rgba(76,154,255,0)", lineWidth: 2 });
      main.setData(rows.map(r => ({ time: r.time, value: r.close })));
    } else {
      main = chart.addCandlestickSeries({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false });
      main.setData(rows);
    }
    main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: document.getElementById("vol").checked ? 0.25 : 0.05 } });
    if (document.getElementById("vol").checked) {
      volS = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
      volS.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volS.setData(rows.map(r => ({ time: r.time, value: r.volume || 0, color: r.close >= r.open ? "rgba(31,191,107,.45)" : "rgba(240,79,85,.45)" })));
    }
    if (!intraday) {
      const first = rows[0].time;
      if (document.getElementById("sma20").checked) { sma20S = chart.addLineSeries({ color: "#e3b341", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false }); sma20S.setData(sma(20).filter(x => x.time >= first)); }
      if (document.getElementById("sma50").checked) { sma50S = chart.addLineSeries({ color: "#b07cff", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false }); sma50S.setData(sma(50).filter(x => x.time >= first)); }
    }
    chart.applyOptions({ timeScale: { timeVisible: intraday } });
    chart.timeScale().fitContent();
  }

  function renderRanges() {
    document.getElementById("ranges").innerHTML = Object.keys(RANGES).map(r => `<button data-range="${r}" class="${r === range ? "on" : ""}">${r}</button>`).join("");
  }

  // ---------- go ----------
  document.getElementById("ranges").addEventListener("click", e => {
    const b = e.target.closest("[data-range]"); if (!b) return;
    range = b.dataset.range; LS.set("chartRange", range); renderRanges(); drawChart();
  });
  ["sma20", "sma50", "vol", "line"].forEach(id => {
    const el = document.getElementById(id);
    el.checked = LS.get("chart_" + id, el.checked);
    el.addEventListener("change", () => { LS.set("chart_" + id, el.checked); drawChart(); });
  });
  document.getElementById("jump").addEventListener("change", e => { location.href = "company.html?code=" + e.target.value; });

  async function refresh(first) {
    try { await loadData(); }
    catch (e) { document.getElementById("status").innerHTML = `<span class="warn">${esc(e.message)}. <a href="./">Back to dashboard</a></span>`; return; }
    renderHero(); renderStats(); renderFeeds(); renderPeers();
    if (first) { buildChart(); renderRanges(); renderNotes(); }
    drawChart();
  }
  await refresh(true);
  setInterval(() => { if (!document.hidden) refresh(false); }, 120000);
})();
