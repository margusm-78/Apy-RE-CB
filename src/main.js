import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';
import { Parser } from 'json2csv';

// --- helpers ---
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function cleanText(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

function splitName(full) {
  const name = cleanText(full)
    .replace(/,?\s*Realtor\u00AE?/i, '')
    .replace(/,?\s*Broker\s*Associate/i, '')
    .replace(/Team$|Group$/i, '')
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
  // Try to coerce US 10-digit number
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (usLike.trim().startsWith('+')) return usLike.trim();
  // Fallback: return raw digits
  return digits;
}

async function extractPhone(page) {
  // Prefer tel: links
  const telHref = await page.locator('a[href^="tel:"]').first();
  if (await telHref.count()) {
    const href = await telHref.getAttribute('href');
    return cleanText(href.replace('tel:', ''));
  }
  // Try common phone containers
  const candidates = await page.$$eval('*', els => els.map(el => el.textContent || ''));
  const joined = candidates.join(' ');
  const m = joined.match(/\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
  return m ? m[0] : '';
}

async function extractEmail(page) {
  // 1) direct mailto
  const emails = await page.$$eval('a[href^="mailto:"]', els =>
    els.map(a => a.getAttribute('href') || '').map(h => h.replace(/^mailto:/i, '')).filter(Boolean)
  );
  if (emails.length) return emails[0].toLowerCase();

  // 2) search the HTML for any email pattern
  const html = await page.content();
  const m = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (m) return m[0].toLowerCase();

  return '';
}

Actor.main(async () => {
  const input = (await Actor.getInput()) || {};
  const {
    startUrls = [{ url: 'https://www.coldwellbanker.com/fl/jacksonville/agents' }],
    maxPages = 200,
    maxConcurrency = 5,
    proxy
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
        // Enqueue agent profile links (various patterns)
        await enqueueLinks({
          selector: 'a[href*="/real-estate-agents/"], a[href*="/agent/"], a[href*="/real-estate-agent/"]',
          strategy: 'same-domain',
          transformRequestFunction: (req) => {
            req.userData = { label: 'AGENT' };
            req.uniqueKey = req.url.split('?')[0];
            return req;
          }
        });

        // Enqueue pagination (next / numbered pages)
        await enqueueLinks({
          selector: 'a[rel="next"], a[href*="page="], nav a[aria-label*="Next"]',
          strategy: 'same-domain',
          transformRequestFunction: (req) => {
            req.userData = { label: 'LIST' };
            return req;
          }
        });
      }

      if (label === 'AGENT') {
        await page.waitForLoadState('domcontentloaded');
        // Name from heading
        const name = cleanText(await page.locator('h1, h2').first().textContent());
        // Phone from profile
        const phoneRaw = await extractPhone(page);
        const phone = toE164(phoneRaw);

        // Find "Contact" link or button
        const contactHref = await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll('a, button'));
          const cand = nodes.find(el => /contact/i.test(el.textContent || '') && el.tagName === 'A');
          if (cand) return cand.getAttribute('href') || '';
          // if it's a button opening a contact route via data-attr
          const cand2 = nodes.find(el => /contact/i.test(el.textContent || '') && el.hasAttribute('data-href'));
          return cand2 ? cand2.getAttribute('data-href') : '';
        });

        if (contactHref) {
          const url = new URL(contactHref, page.url()).href;
          await requestQueue.addRequest({
            url,
            userData: { label: 'CONTACT', partial: { name, phone, profileUrl: page.url() } },
            uniqueKey: url.split('?')[0]
          });
        } else {
          // Try to extract email on profile if contact not found
          const email = await extractEmail(page);
          const { firstName, lastName } = splitName(name);
          if (email) {
            await Actor.pushData({
              EMAIL: email,
              FIRSTNAME: firstName,
              LASTNAME: lastName,
              SMS: phone,
              sourceProfile: page.url(),
              sourceContact: page.url()
            });
          }
        }

        // Gentle delay
        await sleep(250);
      }

      if (label === 'CONTACT') {
        await page.waitForLoadState('domcontentloaded');
        const email = await extractEmail(page);
        const { name, phone, profileUrl } = request.userData.partial || {};
        const { firstName, lastName } = splitName(name || '');

        if (email) {
          await Actor.pushData({
            EMAIL: email,
            FIRSTNAME: firstName,
            LASTNAME: lastName,
            SMS: phone || '',
            sourceProfile: profileUrl || '',
            sourceContact: page.url()
          });
        } else {
          // As fallback, try again from contact page content for phone/name if missing
          const phoneRaw = phone || await extractPhone(page);
          const phoneFmt = toE164(phoneRaw);
          const fallbackEmail = await extractEmail(page);
          if (fallbackEmail) {
            await Actor.pushData({
              EMAIL: fallbackEmail,
              FIRSTNAME: firstName,
              LASTNAME: lastName,
              SMS: phoneFmt,
              sourceProfile: profileUrl || '',
              sourceContact: page.url()
            });
          }
        }

        await sleep(200);
      }
    },
    failedRequestHandler({ request }) {
      log.error(`Request failed: ${request.url}`);
    }
  });

  await crawler.run();

  // Prepare Brevo CSV
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
      SMS: it.SMS || ''
    });
  }

  const parser = new Parser({ fields: ['EMAIL', 'FIRSTNAME', 'LASTNAME', 'SMS'] });
  const csv = parser.parse(deduped);
  await Actor.setValue('brevo.csv', csv, { contentType: 'text/csv; charset=utf-8' });

  log.info(`Done. Records: ${deduped.length}. CSV saved as brevo.csv in Key-Value store.`);
});
