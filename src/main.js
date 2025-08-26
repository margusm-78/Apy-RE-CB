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
  // Preferred selector from user: h1[data-testid="office-name"]
  const el = page.locator('h1[data-testid="office-name"]').first();
  if (await el.count()) return cleanText(await el.textContent());
  // Fallback: heading
  return cleanText(await page.locator('h1, h2').first().textContent());
}

async function extractPhone(page) {
  // Preferred selector from user
  const p = page.locator('p.MuiTypography-body1.css-1p1owym').first();
  if (await p.count()) return cleanText(await p.textContent());

  // tel: link
  const telLink = page.locator('a[href^="tel:"]').first();
  if (await telLink.count()) {
    const href = await telLink.getAttribute('href');
    if (href) return cleanText(href.replace(/^tel:/i, ''));
  }

  // Fallback: regex scan over visible text
  const texts = await page.$$eval('*', (els) => els.map((el) => el.textContent || ''));
  const joined = texts.join(' ');
  const m = joined.match(/\(?(?:\d{3})\)?[\s.-]?(?:\d{3})[\s.-]?(?:\d{4})/);
  return m ? m[0] : '';
}

async function extractEmail(page) {
  // Preferred selector from user: div[emailDiv] a[emailLink] -> mailto
  const emailA = page.locator('div[data-testid="emailDiv"] a[data-testid="emailLink"]').first();
  if (await emailA.count()) {
    const href = await emailA.getAttribute('href');
    if (href && /^mailto:/i.test(href)) {
      return href.replace(/^mailto:/i, '').trim().toLowerCase();
    }
  }

  // Generic mailto
  const anyMailto = page.locator('a[href^="mailto:"]').first();
  if (await anyMailto.count()) {
    const href = await anyMailto.getAttribute('href');
    if (href) return href.replace(/^mailto:/i, '').trim().toLowerCase();
  }

  // Fallback: search HTML for any email
  const html = await page.content();
  const m = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

Actor.main(async () => {
  const input = (await Actor.getInput()) || {};
  const {
    startUrls = [{ url: 'https://www.coldwellbanker.com/fl/jacksonville/agents' }],
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
    requestHandlerTimeoutSecs: 90,
    navigationTimeoutSecs: 45,
    proxyConfiguration: proxy ? await Actor.createProxyConfiguration(proxy) : undefined,

    async requestHandler({ request, page, enqueueLinks }) {
      const { label } = request.userData || {};

      if (label === 'LIST') {
        await page.waitForLoadState('domcontentloaded');

        // Enqueue agent profile links (various patterns on the site)
        await enqueueLinks({
          selector: 'a[href*="/real-estate-agents/"], a[href*="/agent/"], a[href*="/real-estate-agent/"]',
          strategy: 'same-domain',
          transformRequestFunction: (req) => {
            req.userData = { label: 'AGENT' };
            req.uniqueKey = req.url.split('?')[0];
            return req;
          },
        });

        // Pagination
        await enqueueLinks({
          selector: 'a[rel="next"], a[href*="page="], nav a[aria-label*="Next"]',
          strategy: 'same-domain',
          transformRequestFunction: (req) => {
            req.userData = { label: 'LIST' };
            return req;
          },
        });
      }

      if (label === 'AGENT') {
        await page.waitForLoadState('domcontentloaded');

        const name = await extractName(page);
        const phoneRaw = await extractPhone(page);
        const phone = toE164(phoneRaw);

        // If email is already present on the profile via the specified DOM, capture it
        let email = await extractEmail(page);

        if (!email) {
          // Otherwise, push to Contact page where that DOM is typically present
          const contactHref = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('a, button'));
            // prefer anchors containing "Contact"
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
          } else {
            // No contact link; still save row if we have an email from profile
            if (email) {
              const { firstName, lastName } = splitName(name);
              await Actor.pushData({
                EMAIL: email,
                FIRSTNAME: firstName,
                LASTNAME: lastName,
                SMS: phone,
                sourceProfile: page.url(),
                sourceContact: page.url(),
              });
            }
          }
        } else {
          // Email found on profile directly
          const { firstName, lastName } = splitName(name);
          await Actor.pushData({
            EMAIL: email,
            FIRSTNAME: firstName,
            LASTNAME: lastName,
            SMS: phone,
            sourceProfile: page.url(),
            sourceContact: page.url(),
          });
        }

        await sleep(250);
      }

      if (label === 'CONTACT') {
        await page.waitForLoadState('domcontentloaded');

        const email = await extractEmail(page);
        // Use the specific phone selector again; contact page may display a better phone
        const phoneRaw = await extractPhone(page);
        const phone = toE164(phoneRaw);

        const { name, profileUrl } = request.userData.partial || {};
        const { firstName, lastName } = splitName(name || '');

        if (email) {
          await Actor.pushData({
            EMAIL: email,
            FIRSTNAME: firstName,
            LASTNAME: lastName,
            SMS: phone || '',
            sourceProfile: profileUrl || '',
            sourceContact: page.url(),
          });
        }

        await sleep(200);
      }
    },

    failedRequestHandler({ request }) {
      log.error(`Request failed: ${request.url}`);
    },
  });

  await crawler.run();

  // Prepare Brevo CSV (manual writer)
  const dataset = await Actor.openDataset();
  const { items } = await dataset.getData({ clean: true });

  // Deduplicate by EMAIL
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
