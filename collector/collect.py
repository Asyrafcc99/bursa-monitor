"""Stage 1 collector: Yahoo Finance prices + Google News RSS for the stocks in config.json.

Writes data/latest.json. Uses only Python's standard library (nothing to install).
Never invents data: if a source fails, the stock gets an "error" field instead of numbers.
"""
import json, sys, time, urllib.request, urllib.parse
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


def yahoo_price(code):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.KL?interval=5m&range=1d"
    meta = json.loads(get(url))["chart"]["result"][0]["meta"]
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    if price is None or prev in (None, 0):
        raise ValueError("Yahoo returned no price")
    return {
        "price": price,
        "prev_close": prev,
        "change_pct": round((price - prev) / prev * 100, 2),
        "volume": meta.get("regularMarketVolume"),
        "price_time_kl": kl_iso(meta.get("regularMarketTime")),
        "currency": meta.get("currency"),
        "source": "Yahoo Finance",
        "delayed": "Delayed about 15 min",
    }


def yahoo_daily(code):
    """About 3 months of daily bars (oldest first)."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.KL?interval=1d&range=3mo"
    r = json.loads(get(url))["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    return [{"date": datetime.fromtimestamp(ts, KL).strftime("%Y-%m-%d"), "close": c, "volume": v}
            for ts, c, v in zip(r.get("timestamp", []), q["close"], q["volume"])]


def load(path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def google_news(query, limit):
    q = urllib.parse.quote(query)
    url = f"https://news.google.com/rss/search?q={q}+when:7d&hl=en-MY&gl=MY&ceid=MY:en"
    root = ET.fromstring(get(url))
    items = []
    for it in root.iter("item"):
        items.append({
            "title": it.findtext("title"),
            "link": it.findtext("link"),
            "published": it.findtext("pubDate"),
            "source": it.findtext("source"),
        })
        if len(items) >= limit:
            break
    return items


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
    today = now.strftime("%Y-%m-%d")
    stats_all = load(data / "daily_stats.json", {})
    state = load(data / "state.json", {})
    alerts_list = load(data / "alerts.json", {"alerts": []})["alerts"]
    new_alerts = []
    out = {"collected_at_kl": now.isoformat(timespec="minutes"), "stocks": []}
    for s in cfg["stocks"]:
        code = s["code"]
        row = {k: s[k] for k in ("code", "name", "short", "sector")}
        row["klsescreener_url"] = f"https://www.klsescreener.com/v2/stocks/view/{code}"
        # daily history: once per day per stock
        st = stats_all.get(code)
        if not st or st.get("as_of") != today:
            try:
                st = AL.daily_stats(yahoo_daily(code), today) or {"error": "Not enough history"}
            except Exception as e:
                st = {"error": f"History not available: {e}"}
            st["as_of"] = today
            stats_all[code] = st
            time.sleep(gap)
        row["stats"] = st
        try:
            row["quote"] = yahoo_price(code)
        except Exception as e:
            row["quote"] = {"error": f"Price not available: {e}"}
        time.sleep(gap)
        try:
            row["news"] = google_news(s["news_query"], cfg.get("news_items_per_stock", 5))
        except Exception as e:
            row["news"] = []
            row["news_error"] = f"News not available: {e}"
        time.sleep(gap)
        AL.check(s, row["quote"], None if "error" in st else st, now, acfg, state, new_alerts)
        AL.check_news(s, row["news"], now, state, new_alerts)
        out["stocks"].append(row)
    alerts_list = AL.prune(state, alerts_list + new_alerts, now)
    (data / "latest.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    (data / "daily_stats.json").write_text(json.dumps(stats_all, indent=1))
    (data / "state.json").write_text(json.dumps(state, indent=1, ensure_ascii=False))
    (data / "alerts.json").write_text(json.dumps({"updated_kl": out["collected_at_kl"], "rules": acfg, "alerts": alerts_list}, indent=1, ensure_ascii=False))
    print(f"Saved {len(out['stocks'])} stocks at {out['collected_at_kl']}, {len(new_alerts)} new alerts")


if __name__ == "__main__":
    main()
