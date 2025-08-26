import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

// --- helpers ---
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function cleanText(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

function splitName(full) {
  const name = cleanText(full)
    .replace(/,?\s*Realtor\u00AE?/i, '')
    .replace(/,?\s*Broker\s*Associate/i, '')
    .replace(/\b(Realtor\u00AE?|Broker\s*Associate|Team|Group)\b/gi, '')
    .trim();

  if (!name) return { firstName: '', lastName: '' };
  const parts = name.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const lastName = parts.pop();
  const firstName = parts.join(' ');
  return { firstName, lastName };
}

function toE164(usLike) {
  if (!usLike) return '';
  const digits = (usLike.match(/[0-9]+/g) || []).join('');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if ((usLike || '').trim().startsWith('+')) return usLike.trim();
  return digits;
}

async function extractName(page) {
  const el = page.locator('h1[data-testid="office-name"]').first();
  if (await el.count()) return cleanText(await el.textContent());
  return cleanText(await page.locator('h1, h2').first().textContent());
}

async function extractPhone(page) {
  const specific = page.locator('p.MuiTypography-body1.css-1p1owym').first();
  if (await specific.count()) return cleanText(await specific.textContent());
  const telLink = page.locator('a[href^="tel:"]').first();
  if (await telLink.count()) {
    const href = await telLink.getAttribute('href');
    if (href) return cleanText(href.replace(/^tel:/i, ''));
  }
  const texts = await page.$$eval('*', (els) => els.map((el) => el.textContent || ''));
  const joined = texts.join(' ');
  const m = joined.match(/\(?(?:\d{3})\)?[\s.-]?(?:\d{3})[\s.-]?(?:\d{4})/);
  return m ? m[0] : '';
}

async function extractEmail(page) {
  const emailA = page.locator('div[data-testid="emailDiv"] a[data-testid="emailLink"]').first();
  if (await emailA.count()) {
    const href = await emailA.getAttribute('href');
    if (href && /^mailto:/i.test(href)) return href.replace(/^mailto:/i, '').trim().toLowerCase();
  }
  const anyMailto = page.locator('a[href^="mailto:"]').first();
  if (await anyMailto.count()) {
    const href = await anyMailto.getAttribute('href');
    if (href) return href.replace(/^mailto:/i, '').trim().toLowerCase();
  }
  const html = await page.content();
  const m = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

// Auto-scroll for lazy-load content
async function autoScroll(page, maxSteps = 25) {
  let lastHeight = await page.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < maxSteps; i++) {
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }
}

// Try to discover the "next" page URL via common patterns
async function getNextHref(page) {
  // 1) rel="next"
  const rel = await page.locator('a[rel="next"]').first();
  if (await rel.count()) {
    const href = await rel.getAttribute('href');
    if (href) return new URL(href, page.url()).href;
  }
  // 2) aria-label contains Next
  const ariaNext = await page.evaluate(() => {
    const cand = Array.from(document.querySelectorAll('a[aria-label]'))
      .find(a => /next/i.test(a.getAttribute('aria-label') || ''));
    return cand ? (cand.getAttribute('href') || '') : '';
  });
  if (ariaNext) return new URL(ariaNext, page.url()).href;

  // 3) anchor text contains Next
  const textNext = await page.evaluate(() => {
    const cand = Array.from(document.querySelectorAll('a'))
      .find(a => /\bnext\b/i.test(a.textContent || ''));
    return cand ? (cand.getAttribute('href') || '') : '';
  });
  if (textNext) return new URL(textNext, page.url()).href;

  // 4) any link with page= param higher than current
  const paramNext = await page.evaluate((current) => {
    const links = Array.from(document.querySelectorAll('a[href*="page="]'));
    const tuples = links.map(a => {
      const u = new URL(a.getAttribute('href'), document.baseURI);
      const p = +(u.searchParams.get('page') || '0');
      return { href: u.href, p };
    }).filter(t => t.p > 0);
    if (!tuples.length) return '';
    tuples.sort((a,b) => a.p - b.p);
    return tuples[0].href;
  }, page.url());
  if (paramNext) return paramNext;

  return '';
}

Actor.main(async () => {
  const input = (await Actor.getInput()) || {};
  const {
    startUrls = [
      { url: 'https://www.coldwellbanker.com/city/fl/jacksonville/agents' },
      { url: 'https://www.coldwellbanker.com/fl/jacksonville/agents' }
    ],
    maxPages = 200,
    maxConcurrency = 5,
    proxy,
  } = input;

  const requestQueue = await Actor.openRequestQueue();
  for (const s of startUrls) {
    await requestQueue.addRequest({ url: s.url, userData: { label: 'LIST', pageNo: 1 } });
  }

  log.info('Starting crawler…');

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxConcurrency,
    headless: true,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 60,
    proxyConfiguration: proxy ? await Actor.createProxyConfiguration(proxy) : undefined,

    async requestHandler({ request, page, enqueueLinks }) {
      const { label } = request.userData || {};

      if (label === 'LIST') {
        await page.waitForLoadState('domcontentloaded');
        // Allow React/MUI to render
        await page.waitForTimeout(1200);
        await autoScroll(page, 20);

        // Collect agent profile links
        let hrefs = await page.$$eval('a[href*="/agents/"]', (as) => {
          const urls = as.map(a => a.getAttribute('href') || '').filter(Boolean);
          return urls.map(u => new URL(u, document.baseURI).href);
        });

        // Narrow to agent-like patterns
        hrefs = hrefs.filter(u => /\/agents\//.test(u) && (/\/aid-/.test(u) || /\/agent\//.test(u) || /\/agents\//.test(u)));

        // Unique
        hrefs = Array.from(new Set(hrefs));

        // Enqueue agent profiles
        for (const url of hrefs) {
          await requestQueue.addRequest({ url, userData: { label: 'AGENT' }, uniqueKey: url.split('?')[0] });
        }

        // Pagination (fix invalid selector bug by computing URL in JS):
        const nextHref = await getNextHref(page);

        // Guard against infinite pagination
        const nextPageNo = (request.userData.pageNo || 1) + 1;
        if (nextHref && nextPageNo <= maxPages) {
          await requestQueue.addRequest({ url: nextHref, userData: { label: 'LIST', pageNo: nextPageNo }, uniqueKey: nextHref.split('?')[0] });
        }

        // If nothing was enqueued and this is the first list page, save screenshot
        if ((request.userData.pageNo || 1) === 1 && hrefs.length === 0) {
          const buf = await page.screenshot({ fullPage: true });
          await Actor.setValue('list_page_debug.png', buf, { contentType: 'image/png' });
          log.warning('No agent links found on LIST page. Saved screenshot list_page_debug.png for debugging.');
        }
      }

      if (label === 'AGENT') {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(600);

        const name = await extractName(page);
        const phoneRaw = await extractPhone(page);
        const phone = toE164(phoneRaw);
        let email = await extractEmail(page);

        if (!email) {
          // Try contact page
          const contactHref = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('a, button'));
            const link = nodes.find((el) => /contact/i.test(el.textContent || '') && el.tagName === 'A');
            if (link) return link.getAttribute('href') || '';
            const btn = nodes.find((el) => /contact/i.test(el.textContent || '') && el.hasAttribute('data-href'));
            return btn ? btn.getAttribute('data-href') : '';
          });

          if (contactHref) {
            const url = new URL(contactHref, page.url()).href;
            await requestQueue.addRequest({
              url,
              userData: { label: 'CONTACT', partial: { name, phone, profileUrl: page.url() } },
              uniqueKey: url.split('?')[0],
            });
          } else if (email) {
            const parts = splitName(name);
            await Actor.pushData({
              EMAIL: email,
              FIRSTNAME: parts.firstName,
              LASTNAME: parts.lastName,
              SMS: phone,
              sourceProfile: page.url(),
              sourceContact: page.url(),
            });
          }
        } else {
          const parts = splitName(name);
          await Actor.pushData({
            EMAIL: email,
            FIRSTNAME: parts.firstName,
            LASTNAME: parts.lastName,
            SMS: phone,
            sourceProfile: page.url(),
            sourceContact: page.url(),
          });
        }
      }

      if (label === 'CONTACT') {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(400);

        const email = await extractEmail(page);
        const phone = toE164(await extractPhone(page));
        const { name, profileUrl } = request.userData.partial || {};
        const parts = splitName(name || '');

        if (email) {
          await Actor.pushData({
            EMAIL: email,
            FIRSTNAME: parts.firstName,
            LASTNAME: parts.lastName,
            SMS: phone || '',
            sourceProfile: profileUrl || '',
            sourceContact: page.url(),
          });
        }
      }
    },

    failedRequestHandler({ request, error }) {
      log.error(`Request failed: ${request.url} :: ${error?.message || error}`);
    },
  });

  await crawler.run();

  // Prepare Brevo CSV (manual writer)
  const dataset = await Actor.openDataset();
  const { items } = await dataset.getData({ clean: true });

  const deduped = [];
  const seen = new Set();
  for (const it of items) {
    const email = (it.EMAIL || '').toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    deduped.push({
      EMAIL: email,
      FIRSTNAME: it.FIRSTNAME || '',
      LASTNAME: it.LASTNAME || '',
      SMS: it.SMS || '',
    });
  }

  const headers = ['EMAIL', 'FIRSTNAME', 'LASTNAME', 'SMS'];
  const csvLines = [headers.join(',')];
  for (const row of deduped) {
    const vals = headers.map((h) => {
      const s = (row[h] ?? '').toString();
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    });
    csvLines.push(vals.join(','));
  }
  const csv = csvLines.join('\n');

  await Actor.setValue('brevo.csv', csv, { contentType: 'text/csv; charset=utf-8' });
  log.info(`Done. Records: ${deduped.length}. CSV saved as brevo.csv in Key-Value store.`);
});
