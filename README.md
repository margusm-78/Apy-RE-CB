# Coldwell Banker Jacksonville Agents → Brevo CSV (Apify Actor)

**Fix for 'cannot find any data':** This version targets the city-page URL and uses robust link discovery on the list page, including auto-scroll and broad href filtering (`/agents/` + `/aid-`). It also saves a screenshot (`list_page_debug.png`) if zero agent links are found on the first page.

Run → Download `brevo.csv` from Key-Value store.

## Defaults
- startUrls: https://www.coldwellbanker.com/city/fl/jacksonville/agents
- Extractors use:
  - Name: `h1[data-testid="office-name"]`
  - Email: `div[data-testid="emailDiv"] a[data-testid="emailLink"]` (mailto)
  - Phone: `a[href^="tel:"]` → fallback to `p.MuiTypography-body1.css-1p1owym` → regex

## Local
```bash
npm install
npm start
```
