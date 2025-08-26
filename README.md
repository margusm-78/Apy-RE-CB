# Coldwell Banker Jacksonville Agents → Brevo CSV (Optimized v3)

Fast Apify/Playwright actor that extracts **EMAIL, FIRSTNAME, LASTNAME, SMS** from Coldwell Banker Jacksonville agent profiles.
**v3 adds robust numeric pagination** across `/city/.../agents?page=N` so you can crawl all 25 pages reliably.

## What’s new
- **Numeric pagination**: Detect highest `page=` in the DOM; if missing, enqueue `?page=2..N` (default N=25).
- **Resource blocking** + conservative concurrency to avoid CPU overload.
- **Early stop** via `maxAgents` so runs don’t hit the 300s timeout by default.
- Same field selectors (per your requirements).

## Example input (Apify)
```json
{
  "startUrls": [
    {"url": "https://www.coldwellbanker.com/city/fl/jacksonville/agents"}
  ],
  "listPageCount": 25,
  "maxPages": 60,
  "maxConcurrency": 4,
  "maxAgents": 200,
  "blockResources": true,
  "followContact": true,
  "proxy": { "useApifyProxy": true }
}
```

## Output
- Key-Value store: `brevo.csv` (EMAIL,FIRSTNAME,LASTNAME,SMS)
- Dataset items for inspection

Import this repo into GitHub, then Apify → Import from GitHub → Build → Run.
