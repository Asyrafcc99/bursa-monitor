# bursa-monitor

Personal Bursa Malaysia monitoring dashboard (research only, not financial advice).

- `collector/collect.py`: fetches Yahoo Finance prices (delayed ~15 min) and Google News headlines, writes `data/latest.json`.
- `.github/workflows/collect.yml`: runs the collector every 5 min during Bursa hours (KL time), Mon-Fri.
- `index.html`: the dashboard, served by GitHub Pages.
- `config.json`: the stock list. `holidays.json`: Bursa market holidays.
