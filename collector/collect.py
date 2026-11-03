"""Stage 1 collector: Yahoo Finance prices + Google News RSS for the stocks in config.json.

Writes data/latest.json. Uses only Python's standard library (nothing to install).
Never invents data: if a source fails, the stock gets an "error" field instead of numbers.
"""
import json, os, sys, time, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import alerts as AL

ROOT = Path(__file__).resolve().parent.parent
KL = timezone(timedelta(hours=8))
UA = "Mozilla/5.0 (personal bursa-monitor; low-rate)"

# Bursa sessions, KL time. We also allow 20 min after close for the final prices.
SESSIONS = [((9, 0), (12, 50)), ((14, 30), (17, 5))]


def market_window_open(now_kl):
    if now_kl.weekday() >= 5:
        return False
    holidays = json.loads((ROOT / "holidays.json").read_text()).get("dates", [])
    if now_kl.strftime("%Y-%m-%d") in holidays:
        return False
    hm = (now_kl.hour, now_kl.minute)
    return any(start <= hm <= end for start, end in SESSIONS)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def kl_iso(epoch):
    return datetime.fromtimestamp(epoch, KL).isoformat(timespec="minutes") if epoch else None


def yahoo_price(code, symbol=None):
    sym = urllib.parse.quote(symbol or f"{code}.KL")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=5m&range=1d"
    res = json.loads(get(url))["chart"]["result"][0]
    meta = res["meta"]
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    if price is None or prev in (None, 0):
        raise ValueError("Yahoo returned no price")
    qd = res.get("indicators", {}).get("quote", [{}])[0]
    bars = [[ts, o, h, l, c, v] for ts, o, h, l, c, v in zip(res.get("timestamp") or [], qd.get("open") or [], qd.get("high") or [],
                                                         qd.get("low") or [], qd.get("close") or [], qd.get("volume") or [])
            if c is not None and o is not None]
    closes = [b[4] for b in bars]
    step = max(1, len(closes) // 40)
    return {
        "price": price,
        "prev_close": prev,
        "change_pct": round((price - prev) / prev * 100, 2),
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "price_time_kl": kl_iso(meta.get("regularMarketTime")),
        "currency": meta.get("currency"),
        "spark": [round(c, 4) for c in closes[::step]] + ([round(closes[-1], 4)] if closes and (len(closes) - 1) % step else []),
        "source": "Yahoo Finance",
        "delayed": "Delayed about 15 min",
        "_bars": bars,
    }


def yahoo_daily(code, symbol=None):
    """About 2 years of daily bars (oldest first)."""
    sym = urllib.parse.quote(symbol or f"{code}.KL")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=2y"
    r = json.loads(get(url))["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    r4 = lambda x: round(x, 4) if x is not None else None
    return [{"date": datetime.fromtimestamp(ts, KL).strftime("%Y-%m-%d"), "open": r4(o), "high": r4(h), "low": r4(l), "close": r4(c), "volume": v}
            for ts, o, h, l, c, v in zip(r.get("timestamp", []), q["open"], q["high"], q["low"], q["close"], q["volume"])
            if c is not None]


def save_intraday(hist_dir, code, bars, keep_days=10):
    """Merge today's 5-minute bars into history/<code>_5m.json, keeping the last few trading days."""
    f = hist_dir / f"{code}_5m.json"
    old = load(f, {"bars": []})["bars"]
    merged = {b[0]: b for b in old}
    merged.update({b[0]: [b[0]] + [round(x, 4) if isinstance(x, float) else x for x in b[1:]] for b in bars})
    rows = sorted(merged.values())
    days = sorted({datetime.fromtimestamp(b[0], KL).strftime("%Y-%m-%d") for b in rows})[-keep_days:]
    rows = [b for b in rows if datetime.fromtimestamp(b[0], KL).strftime("%Y-%m-%d") in days]
    f.write_text(json.dumps({"code": code, "tz": "UTC timestamps; add 8h for KL", "source": "Yahoo Finance 5-minute, delayed ~15 min", "bars": rows}, separators=(",", ":")))


def load(path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


JUNK = ("seasonal returns chart", "stock price, news, quote", "stock quote", "stock forum", "company profile", "analyst ratings, stock forecast")


def news_ok(title, source, match):
    t = " " + (title or "").lower().replace("\u00ad", "") + " "
    if (source or "").lower().startswith("yahoo") or any(j in t for j in JUNK):
        return False
    return not match or any(m in t for m in match)


def google_news(query, limit, match=None):
    q = urllib.parse.quote(query)
    url = f"https://news.google.com/rss/search?q={q}+when:7d&hl=en-MY&gl=MY&ceid=MY:en"
    root = ET.fromstring(get(url))
    items = []
    for it in root.iter("item"):
        if not news_ok(it.findtext("title"), it.findtext("source"), match):
            continue
        items.append({
            "title": it.findtext("title"),
            "link": it.findtext("link"),
            "published": it.findtext("pubDate"),
            "source": it.findtext("source"),
        })
        if len(items) >= limit:
            break
    return items


def send_telegram(new_alerts, state):
    """Send new alerts to Telegram. Needs GitHub secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; skips quietly if absent."""
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not new_alerts:
        return
    chat = chat or state.get("telegram_chat")  # remembered from an earlier run
    if not chat:  # no chat ID secret: use whoever last messaged the bot
        try:
            ups = json.loads(urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getUpdates", timeout=20).read())["result"]
            chats = [u["message"]["chat"]["id"] for u in ups if "message" in u and u["message"]["chat"]["type"] == "private"]
            chat = str(chats[-1]) if chats else None
            if chat:
                state["telegram_chat"] = chat  # Telegram only keeps updates ~24h, so remember it
        except Exception as e:
            print(f"Telegram getUpdates failed: {type(e).__name__}")
        if not chat:
            print("Telegram: no chat found. Send your bot a message in Telegram first.")
            return
    lines = [f"[{a['type']}] {a['text']}" + (f"\n{a['link']}" if a.get("link") else "") for a in new_alerts]
    lines.append("(Yahoo data delayed ~15 min. Research only, not advice.)")
    text = "Bursa Monitor alerts\n\n" + "\n\n".join(lines)
    for i in range(0, len(text), 3900):  # Telegram limit is 4096 chars per message
        body = urllib.parse.urlencode({"chat_id": chat, "text": text[i:i + 3900], "disable_web_page_preview": "true"}).encode()
        try:
            urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", body, timeout=20).read()
        except Exception as e:
            print(f"Telegram send failed: {type(e).__name__}")  # never print the token


def main():
    force = "--force" in sys.argv
    now = datetime.now(KL)
    if not force and not market_window_open(now):
        print(f"{now:%Y-%m-%d %H:%M} KL: outside market hours, nothing collected.")
        return
    cfg = json.loads((ROOT / "config.json").read_text())
    acfg = cfg["alerts"]
    gap = cfg.get("seconds_between_requests", 3)
    data = ROOT / "data"
    data.mkdir(exist_ok=True)
    hist = data / "history"
    hist.mkdir(exist_ok=True)
    today = now.strftime("%Y-%m-%d")
    stats_all = load(data / "daily_stats.json", {})
    state = load(data / "state.json", {})
    alerts_list = load(data / "alerts.json", {"alerts": []})["alerts"]
    new_alerts = []
    out = {"collected_at_kl": now.isoformat(timespec="minutes"), "stocks": []}
    try:
        ix = yahoo_price(None, "^KLSE")
        ix.pop("_bars", None)
        out["index"] = {"name": "FBM KLCI", **ix}
        kf = hist / "KLCI_1d.json"
        if load(kf, {}).get("as_of") != today:
            time.sleep(gap)
            try:
                kf.write_text(json.dumps({"code": "KLCI", "source": "Yahoo Finance daily (^KLSE)", "as_of": today,
                                          "bars": yahoo_daily(None, "^KLSE")}, separators=(",", ":")))
            except Exception as e:
                print(f"KLCI history not available: {e}")
    except Exception as e:
        out["index"] = {"name": "FBM KLCI", "error": f"Index not available: {e}"}
    time.sleep(gap)
    for s in cfg["stocks"]:
        code = s["code"]
        row = {k: s[k] for k in ("code", "name", "short", "sector")}
        row["klsescreener_url"] = f"https://www.klsescreener.com/v2/stocks/view/{code}"
        # daily history: once per day per stock
        st = stats_all.get(code)
        if not st or st.get("as_of") != today or not (hist / f"{code}_1d.json").exists():
            try:
                daily = yahoo_daily(code)
                (hist / f"{code}_1d.json").write_text(json.dumps({"code": code, "source": "Yahoo Finance daily", "as_of": today, "bars": daily}, separators=(",", ":")))
                st = AL.daily_stats(daily, today) or {"error": "Not enough history"}
            except Exception as e:
                st = {"error": f"History not available: {e}"}
            st["as_of"] = today
            stats_all[code] = st
            time.sleep(gap)
        row["stats"] = st
        try:
            row["quote"] = yahoo_price(code)
            save_intraday(hist, code, row["quote"].pop("_bars"))
        except Exception as e:
            row["quote"] = {"error": f"Price not available: {e}"}
        time.sleep(gap)
        try:
            row["news"] = google_news(s["news_query"], cfg.get("news_items_per_stock", 5), s.get("match"))
        except Exception as e:
            row["news"] = []
            row["news_error"] = f"News not available: {e}"
        time.sleep(gap)
        AL.check(s, row["quote"], None if "error" in st else st, now, acfg, state, new_alerts)
        AL.check_news(s, row["news"], now, state, new_alerts)
        out["stocks"].append(row)
    send_telegram(state=state, new_alerts=new_alerts or ([{"type": "Test", "text": f"Telegram is connected. No new alerts at {out['collected_at_kl']}."}] if force else []))
    match = {x["code"]: x.get("match") for x in cfg["stocks"]}
    alerts_list = [a for a in alerts_list if a["type"] != "News" or
                   news_ok(a["text"].split(": ", 1)[-1].rsplit(" - ", 1)[0], a["text"].rsplit(" - ", 1)[-1], match.get(a["code"]))]
    alerts_list = AL.prune(state, alerts_list + new_alerts, now)
    (data / "latest.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    (data / "daily_stats.json").write_text(json.dumps(stats_all, indent=1))
    (data / "state.json").write_text(json.dumps(state, indent=1, ensure_ascii=False))
    (data / "alerts.json").write_text(json.dumps({"updated_kl": out["collected_at_kl"], "rules": acfg, "alerts": alerts_list}, indent=1, ensure_ascii=False))
    print(f"Saved {len(out['stocks'])} stocks at {out['collected_at_kl']}, {len(new_alerts)} new alerts")


if __name__ == "__main__":
    main()
