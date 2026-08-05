# CanadianStats

Financial dashboard for two tracked stocks: OTIS and STN.

## What it shows

- Live price and daily change percentage
- Market capitalization and beta
- Latest dividend and 52-week range
- Trading volume versus average volume
- Employees, listing country, and IPO date

## Data source

- Financial Modeling Prep API (client-side fetch)
- Symbols: OTIS, STN

## Custom universe workflow

The Top 20 section now expects a local exchange universe and a local scored cache rather than broad FMP discovery endpoints.

Files:

- `data/universe.json`: custom NYSE/Nasdaq/TSX universe
- `data/universe-meta.json`: metadata about the universe build
- `data/top20-cache.json`: cached scored output for the Top 20 section
- `data/api-budget.json`: offline budget ledger for the `200/day` Top 20 process
- `scripts/build-universe.js`: builds the universe from local source files
- `scripts/update-top20-cache.js`: refreshes ranked Top 20 results using FMP profile calls

Expected source files for a full universe build:

- `data/sources/nasdaqlisted.txt`
- `data/sources/otherlisted.txt`
- `data/sources/tsx-listed.csv`

Usage:

1. Add source files under `data/sources/`
2. Run `node scripts/build-universe.js`
3. Run `FMP_API_KEY=your_key node scripts/update-top20-cache.js`

If source files are missing, the repo falls back to the committed seed universe.

## Daily automation (no manual daily run)

This repository now includes a scheduler workflow at `.github/workflows/daily-universe-refresh.yml`.

What it runs every day:

1. `node scripts/fetch-source-files.js`
2. `node scripts/verify-source-freshness.js`
3. `node scripts/build-universe.js`
4. `node scripts/update-top20-cache.js`
5. `node scripts/write-health-report.js`
6. Commits and pushes refreshed data artifacts when files changed.

One-time setup required:

1. Add repository secret `FMP_API_KEY`.
2. Optional: add repository variables `NASDAQ_SOURCE_URL`, `NYSE_SOURCE_URL`, and `TSX_SOURCE_URL`.
3. Use the workflow's `workflow_dispatch` once to validate end-to-end execution.

Notes:

- Default source URLs are preconfigured for Nasdaq Trader files.
- `TSX_SOURCE_URL` is optional; if unset, TSX source fetch is skipped.
- Required source files (`nasdaqlisted.txt`, `otherlisted.txt`) must be fresher than 30 hours or the workflow fails.
- A run health snapshot is written to `data/automation-health.json` and uploaded as a workflow artifact.
- Scheduled runs are at `11:15 UTC` daily.
