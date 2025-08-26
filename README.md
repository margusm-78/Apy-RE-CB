# Coldwell Banker Jacksonville Agents → Brevo CSV (Apify Actor)

Scrapes **agent name, phone, and email** from Coldwell Banker Jacksonville and outputs a **Brevo-ready CSV** with columns:
`EMAIL,FIRSTNAME,LASTNAME,SMS`.

**Selectors per site DOM (as provided):**
- **Name:** `h1[data-testid="office-name"]`
- **Email:** `div[data-testid="emailDiv"] a[data-testid="emailLink"]` (extracts `href="mailto:..."`)
- **Phone:** `p.MuiTypography-body1.css-1p1owym` (fallback to `tel:` or regex if class changes)

The actor visits each agent profile and follows to the **Contact** page when needed.

## Local usage
```bash
npm install
npm start
```

## Apify
- Import this repo from GitHub, or upload the ZIP.
- Run with default input or add more start URLs.
- Download `brevo.csv` from the Key-Value store after the run.
