# Source Inputs

Place raw exchange source files here before running the build script.

These files can be populated automatically by running:

- `node scripts/fetch-source-files.js`
- `node scripts/verify-source-freshness.js`

Expected files:

- `nasdaqlisted.txt`
- `otherlisted.txt`
- `tsx-listed.csv`

Notes:

- `nasdaqlisted.txt` and `otherlisted.txt` are expected to use pipe delimiters.
- `tsx-listed.csv` should include at least symbol, name, and exchange columns.
- `fetch-source-files.js` has built-in defaults for Nasdaq/NYSE sources and supports overrides with env vars:
	- `NASDAQ_SOURCE_URL`
	- `NYSE_SOURCE_URL`
	- `TSX_SOURCE_URL`
- `verify-source-freshness.js` fails when required files are older than `SOURCE_MAX_AGE_HOURS` (default `30`).
- If these files are missing, `scripts/build-universe.js` falls back to the committed seed universe.
