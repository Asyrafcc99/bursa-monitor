"""Stage 3 alerts: abnormal volume, abnormal price move, new headlines.

Rules (thresholds live in config.json under "alerts"):
- Volume: today's volume so far vs the 20-day average volume, scaled by how much of the
  trading day has passed ("pace"). Alert when pace >= volume_multiple, after the first
  30 trading minutes (too noisy before that).
- Price: today's % move vs the stock's normal daily move (standard deviation of the last
  20 daily % changes). Alert when |move| >= price_sigma x normal AND >= price_min_pct.
- News: a headline not seen in any earlier run. The very first run only records headlines.
Each stock gets at most one volume and one price alert per day.
"""
import json, statistics
from datetime import datetime

MORNING = ((9, 0), (12, 30))
AFTERNOON = ((14, 30), (16, 45))
TOTAL_MIN = 210 + 135


def _mins(hm):
    return hm[0] * 60 + hm[1]


def trading_minutes_elapsed(now_kl):
    t = now_kl.hour * 60 + now_kl.minute
    done = 0
    for start, end in (MORNING, AFTERNOON):
        s, e = _mins(start), _mins(end)
        done += max(0, min(t, e) - s)
    return done


def daily_stats(bars, today_str):
    """bars: list of {"date","close","volume"} oldest first. Uses the 20 completed days before today."""
    past = [b for b in bars if b["date"] < today_str and b["close"] and b["volume"] is not None]
    past = past[-21:]
    if len(past) < 11:
        return None
    vols = [b["volume"] for b in past[-20:]]
    rets = [(past[i]["close"] / past[i - 1]["close"] - 1) * 100 for i in range(1, len(past))]
    return {
        "days": len(vols),
        "avg_volume_20d": round(sum(vols) / len(vols)),
        "daily_move_sd_pct": round(statistics.pstdev(rets), 2) if len(rets) > 1 else None,
    }


def check(stock, quote, stats, now_kl, cfg, state, alerts):
    today = now_kl.strftime("%Y-%m-%d")
    done = state.setdefault("alerted", {}).setdefault(today, [])
    label = f"{stock['short']} ({stock['code']})"
    t = now_kl.isoformat(timespec="minutes")
    if not stats or "error" in quote:
        return
    # quote must be from today, otherwise yesterday's numbers would trigger alerts
    if not (quote.get("price_time_kl") or "").startswith(today):
        return
    elapsed = trading_minutes_elapsed(now_kl)
    vol, avg = quote.get("volume"), stats["avg_volume_20d"]
    if vol and avg and elapsed >= 30 and f"vol:{stock['code']}" not in done:
        pace = vol / (avg * min(elapsed, TOTAL_MIN) / TOTAL_MIN)
        if pace >= cfg["volume_multiple"]:
            done.append(f"vol:{stock['code']}")
            alerts.append({"time_kl": t, "code": stock["code"], "type": "Volume",
                           "text": f"{label}: volume {vol:,} is {pace:.1f}x the normal pace for this time of day "
                                   f"(20-day avg {avg:,}/day). Price {quote['change_pct']:+.2f}%."})
    sd, chg = stats.get("daily_move_sd_pct"), quote.get("change_pct")
    if sd and chg is not None and f"px:{stock['code']}" not in done:
        if abs(chg) >= cfg["price_sigma"] * sd and abs(chg) >= cfg["price_min_pct"]:
            done.append(f"px:{stock['code']}")
            alerts.append({"time_kl": t, "code": stock["code"], "type": "Price",
                           "text": f"{label}: {chg:+.2f}% today, {abs(chg)/sd:.1f}x its normal daily move "
                                   f"(about {sd:.2f}%). Last RM {quote['price']:.3f}."})


def check_news(stock, news, now_kl, state, alerts):
    seen = state.setdefault("seen_news", {})
    first_run = stock["code"] not in seen
    known = set(seen.get(stock["code"], []))
    for n in news:
        if n["link"] not in known and not first_run:
            alerts.append({"time_kl": now_kl.isoformat(timespec="minutes"), "code": stock["code"], "type": "News",
                           "tags": n.get("tags", []),
                           "text": f"{stock['short']} ({stock['code']}): {n['title']}", "link": n["link"]})
        known.add(n["link"])
    seen[stock["code"]] = list(known)[-60:]


def prune(state, alerts_list, now_kl, keep_days=5):
    today = now_kl.strftime("%Y-%m-%d")
    state["alerted"] = {d: v for d, v in state.get("alerted", {}).items() if d == today}
    alerts_list.sort(key=lambda a: a["time_kl"], reverse=True)
    cutoff = now_kl.timestamp() - keep_days * 86400
    return [a for a in alerts_list if datetime.fromisoformat(a["time_kl"]).timestamp() >= cutoff][:300]
