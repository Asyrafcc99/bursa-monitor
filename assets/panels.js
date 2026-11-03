/* Dashboard panels.
   To add a new panel: copy one block below, give it a new id and title, and write render(ctx).
   ctx gives you: ctx.stocks (filtered by sector/search), ctx.all (all stocks), ctx.data (latest.json),
   ctx.alerts, ctx.news (all headlines merged), and helpers in BM (see app.js). Return an HTML string. */
window.PANELS = [
  {
    id: "market", title: "Market overview", width: 12,
    render(ctx) {
      const { pct, esc, cls } = BM;
      const ix = ctx.data.index || {};
      const q = ctx.all.map(s => s.quote).filter(q => q && !q.error);
      const avg = q.length ? q.reduce((a, b) => a + b.change_pct, 0) / q.length : null;
      const up = q.filter(x => x.change_pct > 0).length, dn = q.filter(x => x.change_pct < 0).length;
      const ixHtml = ix.error ? `<span class="warn">${esc(ix.error)}</span>`
        : `<div class="v">${ix.price?.toFixed(2) ?? "–"} <span class="${cls(ix.change_pct)}">${pct(ix.change_pct)}</span></div>
           <div class="small">as of ${BM.t(ix.price_time_kl)} KL · delayed ~15 min</div>`;
      return `<div class="kpis">
        <div class="kpi"><div class="small">FBM KLCI</div>${ixHtml}</div>
        <div class="kpi"><div class="small">My coverage, average move</div><div class="v ${cls(avg)}">${pct(avg)}</div><div class="small">${q.length} of ${ctx.all.length} stocks priced</div></div>
        <div class="kpi"><div class="small">Up / Down / Flat</div><div class="v"><span class="up">${up}</span> / <span class="down">${dn}</span> / ${q.length - up - dn}</div></div>
        <div class="kpi"><div class="small">Alerts today</div><div class="v">${ctx.alerts.filter(a => a.time_kl.startsWith(BM.todayKL())).length}</div><div class="small">see Alerts panel</div></div>
      </div>`;
    }
  },
  {
    id: "heatmap", title: "Heatmap by sector (tap a tile, or a sector name for its page)", width: 8,
    render(ctx) {
      const sectors = [...new Set(ctx.stocks.map(s => s.sector))];
      if (!sectors.length) return `<div class="small">No stocks match the filter.</div>`;
      return sectors.map(sec => `<div class="sector-row"><div class="lbl"><a class="sector-link" href="sector.html?s=${encodeURIComponent(sec)}">${BM.esc(sec)} →</a></div><div class="tiles">` +
        ctx.stocks.filter(s => s.sector === sec).map(s => {
          const c = s.quote && !s.quote.error ? s.quote.change_pct : null;
          return `<button class="tile" data-stock="${s.code}" style="background:${BM.heat(c)};color:${c != null && Math.abs(c) < 1.2 && c !== 0 ? "var(--fg)" : "#fff"}" title="${BM.esc(s.name)}">
            <div class="n">${BM.esc(s.short)}</div><div class="c">${c == null ? "n/a" : BM.pct(c)}</div></button>`;
        }).join("") + `</div></div>`).join("");
    }
  },
  {
    id: "movers", title: "Top movers", width: 4,
    render(ctx) {
      const priced = ctx.stocks.filter(s => s.quote && !s.quote.error);
      const row = (s, val) => `<div class="row" data-stock="${s.code}"><span>${BM.esc(s.short)}</span>${val}</div>`;
      const g = [...priced].sort((a, b) => b.quote.change_pct - a.quote.change_pct).slice(0, 5);
      const l = [...priced].sort((a, b) => a.quote.change_pct - b.quote.change_pct).slice(0, 5);
      const v = priced.filter(s => BM.pace(s) != null).sort((a, b) => BM.pace(b) - BM.pace(a)).slice(0, 5);
      return `<div class="movers">
        <div class="mlist"><div class="small">Gainers</div>${g.map(s => row(s, `<span class="${BM.cls(s.quote.change_pct)}">${BM.pct(s.quote.change_pct)}</span>`)).join("")}</div>
        <div class="mlist"><div class="small">Losers</div>${l.map(s => row(s, `<span class="${BM.cls(s.quote.change_pct)}">${BM.pct(s.quote.change_pct)}</span>`)).join("")}</div>
        <div class="mlist"><div class="small">Unusual volume (vs normal pace)</div>${v.map(s => row(s, `<span>${BM.pace(s).toFixed(1)}x</span>`)).join("")}</div>
      </div>`;
    }
  },
  {
    id: "table", title: "All stocks (click a column to sort, a name for its full page)", width: 12,
    render(ctx) {
      const cols = [
        ["code", "Code", s => s.code], ["short", "Name", s => s.short],
        ["price", "Price (RM)", s => s.quote?.price], ["chg", "Change", s => s.quote?.change_pct],
        ["vol", "Volume", s => s.quote?.volume], ["pace", "Vol vs normal", s => BM.pace(s)],
        ["spark", "Today", null], ["time", "As of (KL)", s => s.quote?.price_time_kl]];
      const st = BM.sort;
      const col = cols.find(c => c[0] === st.key) || cols[0];
      const rows = [...ctx.stocks].sort((a, b) => {
        const x = col[2](a), y = col[2](b);
        if (x == null) return 1; if (y == null) return -1;
        return (x > y ? 1 : x < y ? -1 : 0) * st.dir;
      });
      return `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th data-sort="${c[2] ? c[0] : ""}">${c[1]}${st.key === c[0] ? (st.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>` +
        rows.map(s => {
          const q = s.quote || {};
          if (q.error) return `<tr data-stock="${s.code}"><td>${s.code}</td><td>${BM.esc(s.short)}</td><td colspan="6" class="warn">${BM.esc(q.error)}</td></tr>`;
          const p = BM.pace(s);
          return `<tr data-stock="${s.code}"><td>${s.code}</td><td><a href="company.html?code=${s.code}">${BM.esc(s.short)}</a></td><td>${q.price.toFixed(3)}</td>
            <td class="${BM.cls(q.change_pct)}">${BM.pct(q.change_pct)}</td><td>${BM.num(q.volume)}</td>
            <td>${p == null ? "–" : p.toFixed(1) + "x"}</td><td>${BM.spark(q.spark, q.prev_close)}</td><td class="small">${BM.t(q.price_time_kl)}</td></tr>`;
        }).join("") + `</tbody></table></div>`;
    }
  },
  {
    id: "alerts", title: "Alerts (last 5 days)", width: 6,
    render(ctx) {
      const list = ctx.alerts.filter(a => ctx.codes.has(a.code)).filter(a => !ctx.q || a.text.toLowerCase().includes(ctx.q));
      if (!list.length) return `<div class="small">No alerts for this filter.</div>`;
      return `<div class="feed">` + list.slice(0, 40).map(a => `<div class="item ${BM.isNewAlert(a) ? "new" : ""}">
        <span class="tag ${a.type}">${a.type}</span>${a.link ? `<a href="${BM.esc(a.link)}" target="_blank" rel="noopener">${BM.esc(a.text)}</a>` : BM.esc(a.text)}
        <div class="small">${BM.t(a.time_kl, true)} · <button class="stockbtn" data-stock="${a.code}">open ${a.code}</button></div></div>`).join("") + `</div>`;
    }
  },
  {
    id: "news", title: "News, all stocks", width: 6,
    render(ctx) {
      const list = ctx.news.filter(n => ctx.codes.has(n.code)).filter(n => !ctx.q || (n.title + n.short).toLowerCase().includes(ctx.q));
      if (!list.length) return `<div class="small">No headlines for this filter.</div>`;
      const shown = list.slice(0, BM.newsLimit);
      return `<div class="feed">` + shown.map(n => `<div class="item ${BM.isNewNews(n) ? "new" : ""}">
        <a href="${BM.esc(n.link)}" target="_blank" rel="noopener">${BM.esc(n.title)}</a>
        <div class="small"><button class="stockbtn" data-stock="${n.code}">${BM.esc(n.short)}</button> · ${BM.esc(n.source || "")} · ${n.date ? BM.ago(n.date) : ""}</div></div>`).join("") +
        `</div>` + (list.length > shown.length ? `<button class="more" data-action="moreNews">Show more (${list.length - shown.length})</button>` : "");
    }
  },
];
