# Coldwell Banker Jacksonville Agents → Brevo CSV (Apify Actor)

**Further hardening to fix 'no records':**
- Dismisses cookie / consent banners (OneTrust-like).
- Auto-scroll + optional **Load More** clicks.
- Waits for `a[href*="/agents/"]` then collects all **/agents/** links (excludes offices).
- Stronger pagination detection (rel/aria/text/param).
- Dumps **list_page_debug.png** and **list_page_debug.html** if zero links on first page.

## Local run
npm install
npm start

## Apify example input
{
  "startUrls": [
    {"url": "https://www.coldwellbanker.com/city/fl/jacksonville/agents"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/agents"}
  ],
  "maxPages": 200,
  "maxConcurrency": 5,
  "proxy": { "useApifyProxy": true }
}
