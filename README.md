# Coldwell Banker Jacksonville Agents → Brevo CSV (Apify Actor)

**Fixes applied:**
- Removed invalid CSS selector causing pagination error.
- Robust agent link capture (`/agents/` with `/aid-` or `/agent/` in href).
- Handles both list URL variants: `/city/fl/jacksonville/agents` and `/fl/jacksonville/agents`.
- Auto-scroll + multiple "Next" detection strategies.
- Saves `list_page_debug.png` if no agent links found on first list page.

## Run locally
npm install
npm start

## Apify input (example)
{
  "startUrls": [
    {"url": "https://www.coldwellbanker.com/city/fl/jacksonville/agents"},
    {"url": "https://www.coldwellbanker.com/fl/jacksonville/agents"}
  ],
  "maxPages": 200,
  "maxConcurrency": 5,
  "proxy": { "useApifyProxy": true }
}
