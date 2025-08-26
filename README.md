# Coldwell Banker Jacksonville Agents → Brevo CSV (Optimized v2)

Lean + fast Playwright/Apify actor that extracts **EMAIL, FIRSTNAME, LASTNAME, SMS** from Coldwell Banker Jacksonville agent profiles (and Contact pages).

**v2 optimizations**
- Conservatively set **concurrency=4** (prev CPU overload), **resource blocking** on by default.
- Short timeouts to prevent stalls; minimal waits; small auto-scroll only if anchors not found.
- Early-stop via **maxAgents** (default 120). Raise this only if you increase the run timeout.
- Optional **followContact** (default true). Set false to maximize throughput if emails are mostly on profile pages.

## Run locally
```bash
npm install
npm start
```

## Example Apify input
```json
{
  "startUrls": [
    {"url": "https://www.coldwellbanker.com/city/fl/jacksonville/agents"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/agents"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/offices/coldwell-banker-vanguard-realty/oid-P00400000FDdqREI4AhcDWyY6EmabUTiIbfCywM8"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/offices/coldwell-banker-vanguard-realty/oid-P00400000FDdqREI4AhcDWyY6EmabUSzAkjhivJ2"}
  ],
  "maxPages": 60,
  "maxConcurrency": 4,
  "maxAgents": 120,
  "blockResources": true,
  "followContact": true,
  "proxy": { "useApifyProxy": true }
}
```
