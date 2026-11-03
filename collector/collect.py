"""Stage 1 collector: Yahoo Finance prices + Google News RSS for the stocks in config.json.

Writes data/latest.json. Uses only Python's standard library (nothing to install).
Never invents data: if a source fails, the stock gets an "error" field instead of numbers.
"""
import json, sys, time, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

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
    gap = cfg.get("seconds_between_requests", 3)
    out = {"collected_at_kl": now.isoformat(timespec="minutes"), "stocks": []}
    for s in cfg["stocks"]:
        row = {k: s[k] for k in ("code", "name", "short", "sector")}
        row["klsescreener_url"] = f"https://www.klsescreener.com/v2/stocks/view/{s['code']}"
        try:
            row["quote"] = yahoo_price(s["code"])
        except Exception as e:
            row["quote"] = {"error": f"Price not available: {e}"}
        time.sleep(gap)
        try:
            row["news"] = google_news(s["news_query"], cfg.get("news_items_per_stock", 5))
        except Exception as e:
            row["news"] = []
            row["news_error"] = f"News not available: {e}"
        time.sleep(gap)
        out["stocks"].append(row)
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "latest.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"Saved {len(out['stocks'])} stocks at {out['collected_at_kl']}")


if __name__ == "__main__":
    main()
