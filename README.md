# Coldwell Banker Jacksonville Agents → Brevo CSV (Apify Actor)

Scrapes **agent name, phone, and email** from Coldwell Banker Jacksonville and outputs a **Brevo-ready CSV** with columns:
`EMAIL,FIRSTNAME,LASTNAME,SMS`.

> **Email location:** Each agent’s **Contact** page typically exposes a `mailto:` address. The actor visits that page for each agent and extracts it.

## Quick start (locally)

1. **Install** Node 18+ and Docker (optional for parity with Apify).
2. Install deps:
   ```bash
   npm ci
   ```
3. Run:
   ```bash
   npm start
   ```
   This uses the defaults from `INPUT_SCHEMA.json` (Jacksonville agents index). Results go to Apify Dataset and also to Key-Value Store as `brevo.csv`.

## Run on Apify
1. Create a new Actor, then **Connect GitHub** and import this repo (or upload ZIP).
2. On the **Input** tab, keep default `startUrls` or add more list pages. Use Apify Proxy for stability.
3. **Run**. When finished:
   - Download `brevo.csv` from **Key-value store** (default) or export the dataset as CSV.

## Brevo CSV Format
The actor writes `brevo.csv` with headers:
- `EMAIL` (required by Brevo)
- `FIRSTNAME`
- `LASTNAME`
- `SMS` (E.164, e.g. `+19045551234` when possible)

## Notes & Tips
- The crawler follows **pagination** and each **agent profile**, then the **Contact** page.
- If the email is not present as `mailto:`, it tries to detect obfuscated emails in page HTML.
- Name parsing splits the last token as last name; edge cases are handled best-effort.
- Phone is normalized to E.164 if it looks like a US number.

## Project structure
```
.
├─ src/main.js            # Actor source
├─ package.json
├─ apify.json
├─ INPUT_SCHEMA.json
├─ Dockerfile
└─ README.md
```
