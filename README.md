# Coldwell Banker Jacksonville Agents → Brevo CSV (Apify Actor)

**Ultimate hardening for zero-results cases:**
- Dismisses cookie/consent banners.
- Auto-scroll + optional "Load More" clicks.
- Harvests agent links from **anchors**, **JSON-LD**, and **raw HTML regex** (`/agents/.../aid-...`).
- Adds fallback **office-directory pages** as seeds.
- Saves **list_page_debug.png** and **list_page_debug.html** if still no links after first page.

## Run locally
npm install
npm start

## Apify input (example)
{
  "startUrls": [
    {"url": "https://www.coldwellbanker.com/city/fl/jacksonville/agents"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/agents"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/offices/coldwell-banker-vanguard-realty/oid-P00400000FDdqREI4AhcDWyY6EmabUTiIbfCywM8"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/offices/coldwell-banker-vanguard-realty/oid-P00400000FDdqREI4AhcDWyY6EmabUSzAkjhivJ2"}
  ],
  "maxPages": 200,
  "maxConcurrency": 5,
  "proxy": { "useApifyProxy": true }
}
