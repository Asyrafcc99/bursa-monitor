# How to change your Bursa Monitor (no coding needed)

Everything is changed on the GitHub website, in your browser. Only you can save changes, because it needs your GitHub login. After you save, the site updates within about 2 minutes. New stock prices appear at the next collector run (every 5 minutes in market hours), or straight away if you press **Run workflow** (see step 4 of section A).

---

## A. Add a stock

1. Open **config.json** in the editor: https://github.com/Asyrafcc99/bursa-monitor/edit/main/config.json
2. Find the line `"stocks": [`. The stocks are listed below it, one block per stock, each block between `{` and `}`.
3. Go to the **last** stock block, the one that ends with `}` just before `]`.
   - Type a comma right after that `}`, so it becomes `},`
   - Press Enter, then paste this new block:

```json
  {
   "code": "5347",
   "name": "TENAGA NASIONAL BHD",
   "short": "Tenaga",
   "sector": "UTILITIES",
   "news_query": "\"Tenaga Nasional\"",
   "match": ["tenaga", "tnb"]
  }
```

   What each line means:
   - `code`: the Bursa stock code, the same 4 digits you see on KLSE Screener or Bursa. For REITs and ETFs, use the full code, e.g. `5235SS`.
   - `name`: the full company name. You can type anything.
   - `short`: the short name shown on tiles and tables.
   - `sector`: any name you like. A **new** sector name automatically gets its own button and sector page.
   - `news_query`: what to search on Google News. Keep `\"` around exact phrases.
   - `match`: lower-case words. A headline is only kept if its title contains one of them, which filters out unrelated news.
4. Scroll down and click the green **Commit changes…** button, then **Commit changes** again.
5. Optional, to see it now: open https://github.com/Asyrafcc99/bursa-monitor/actions/workflows/collect.yml, click **Run workflow**, then the green **Run workflow** button.

**If the site stops loading after your edit**, the file probably has a typing mistake: usually a missing comma or an extra comma after the last `}`. Open the file again and compare it with the example, or tell Claude and paste the error.

The stock above is just an example. I haven't checked Tenaga's code, so please confirm the code yourself on Bursa or KLSE Screener.

## B. Remove a stock

1. Open https://github.com/Asyrafcc99/bursa-monitor/edit/main/config.json
2. Delete that stock's whole block, from its `{` to its `},`.
3. If you deleted the **last** block, remove the comma after the new last `}` as well.
4. Commit changes, as in A, step 4.

## C. Change the alert rules

In config.json, find the `"alerts"` section:
- `volume_multiple`: 2.0 means "alert when volume is at least 2x its normal pace".
- `price_sigma`: 2.0 means "alert when today's move is at least 2x the stock's normal daily move".
- `price_min_pct`: 3.0 means "...and the move is at least 3%".

Raise a number for fewer alerts, or lower it for more. Then commit.

## D. Write notes on a company

1. On any company page, tap **✎ Edit on GitHub** in the "My notes" box. You can also open `notes/<code>.md` in the repo, e.g. https://github.com/Asyrafcc99/bursa-monitor/edit/main/notes/5031.md
2. Type below the first line. Simple formatting works:
   - `- point` for a bullet
   - `**bold**`
   - `# Heading`
   - `[link text](https://...)`
3. Commit changes. The notes appear on the company page within about 2 minutes.

**Notes are public.** Anyone who opens the website can read them, so don't write anything confidential.

## E. Market holidays

When Bursa is closed on a weekday, the collector still wakes up, but the data simply doesn't change. To skip those days completely, add the dates to **holidays.json**, e.g. `"dates": ["2026-12-25"]`. Take the dates from Bursa's official trading-holiday list.

## F. Turn Telegram alerts off or on

- **Off:** delete the `TELEGRAM_BOT_TOKEN` secret at https://github.com/Asyrafcc99/bursa-monitor/settings/secrets/actions
- **On:** add it again.
