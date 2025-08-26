import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

// ==== helpers ====
const CLEAN = (t) => (t || '').replace(/\s+/g, ' ').trim();

function splitName(full) {
  const name = CLEAN(full)
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
  if (await el.count()) return CLEAN(await el.textContent());
  return CLEAN(await page.locator('h1, h2').first().textContent().catch(()=>'') || '');
}

async function extractPhone(page) {
  const p = page.locator('p.MuiTypography-body1.css-1p1owym').first();
  if (await p.count()) return CLEAN(await p.textContent());
  const tel = page.locator('a[href^="tel:"]').first();
  if (await tel.count()) {
    const href = await tel.getAttribute('href');
    if (href) return CLEAN(href.replace(/^tel:/i, ''));
  }
  const text = await page.textContent('body').catch(()=>'') || '';
  const m = text.match(/\(?(?:\d{3})\)?[\s.-]?(?:\d{3})[\s.-]?(?:\d{4})/);
  return m ? m[0] : '';
}

async function extractEmail(page) {
  const sel = 'div[data-testid="emailDiv"] a[data-testid="emailLink"]';
  const a = page.locator(sel).first();
  if (await a.count()) {
    const href = await a.getAttribute('href');
    if (href && /^mailto:/i.test(href)) return href.replace(/^mailto:/i, '').trim().toLowerCase();
  }
  const any = page.locator('a[href^="mailto:"]').first();
  if (await any.count()) {
    const href = await any.getAttribute('href');
    if (href) return href.replace(/^mailto:/i, '').trim().toLowerCase();
  }
  const html = await page.content();
  const m = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

// Minimal auto-scroll (only if needed)
async function autoScroll(page, steps = 5, pause = 250) {
  let last = await page.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    await page.waitForTimeout(pause);
    const next = await page.evaluate(() => document.body.scrollHeight);
    if (next === last) break;
    last = next;
  }
}

// Harvest agent links – anchors first; fallback to attributes/JSON-LD/regex
async function harvestAgentLinks(page, cap = 400) {
  const base = page.url();
  const out = new Set();

  const collectAnchors = async () => {
    const anchors = await page.$$eval('a[href*="/agents/"]', as => as.map(a => a.getAttribute('href') || ''));
    for (const u of anchors) {
      try {
        const abs = new URL(u, base).href;
        if (/\/agents\//i.test(abs) && !/\/offices\//i.test(abs)) out.add(abs);
      } catch {}
    }
  };

  await collectAnchors();
  if (out.size) return Array.from(out).slice(0, cap);

  await autoScroll(page, 5, 200);
  await collectAnchors();
  if (out.size) return Array.from(out).slice(0, cap);

  // data-* / React
  const attrSelectors = ['[data-href]', '[data-url]', '[to]'].join(', ');
  const attrs = await page.$$eval(attrSelectors, els => {
    const r = [];
    for (const el of els) {
      const v = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('to') || '';
      if (v) r.push(v);
    }
    return r;
  }).catch(()=>[]);
  for (const u of attrs) {
    try {
      const abs = new URL(u, base).href;
      if (/\/agents\//i.test(abs) && !/\/offices\//i.test(abs)) out.add(abs);
    } catch {}
  }

  // JSON-LD urls
  const ld = await page.$$eval('script[type="application/ld+json"]', els => els.map(el => el.textContent || ''));
  for (const block of ld) {
    try {
      const data = JSON.parse(block);
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        const url = obj && obj.url;
        if (typeof url === 'string') {
          const abs = new URL(url, base).href;
          if (/\/agents\//i.test(abs) && !/\/offices\//i.test(abs)) out.add(abs);
        }
        if (obj && obj.itemListElement && Array.isArray(obj.itemListElement)) {
          for (const it of obj.itemListElement) {
            const u = it && (it.url || (it.item && it.item.url));
            if (typeof u === 'string') {
              const abs = new URL(u, base).href;
              if (/\/agents\//i.test(abs) && !/\/offices\//i.test(abs)) out.add(abs);
            }
          }
        }
      }
    } catch {}
  }

  // Regex absolute + relative
  const html = await page.content();
  const abs = html.match(/https?:\/\/[^"'>\s]*\/agents\/[a-z0-9-]+\/aid-[A-Za-z0-9]+/gi) || [];
  const rel = html.match(/\/(?:[a-z]{2})\/[a-z0-9-]+\/agents\/[a-z0-9-]+\/aid-[A-Za-z0-9]+/gi) || [];
  for (const u of [...abs, ...rel]) {
    try {
      const absu = new URL(u, base).href;
      if (/\/agents\//i.test(absu) && !/\/offices\//i.test(absu)) out.add(absu);
    } catch {}
  }

  return Array.from(out).slice(0, cap);
}

// Dismiss OneTrust-like cookie banner
async function dismissBanners(page) {
  try {
    const sel = [
      '#onetrust-accept-btn-handler',
      'button#onetrust-accept-btn-handler',
      'button:has-text("Accept All")',
      'button:has-text("Accept")',
      'button[aria-label="Accept"]',
      'button[aria-label*="Accept"]',
    ].join(', ');
    const btn = page.locator(sel).first();
    if (await btn.count()) { await btn.click({ timeout: 0 }).catch(()=>{}); await page.waitForTimeout(200); }
  } catch {}
}

// Find "Next" quickly
async function getNextHref(page) {
  const rel = await page.locator('a[rel="next"]').first();
  if (await rel.count()) {
    const href = await rel.getAttribute('href');
    if (href) return new URL(href, page.url()).href;
  }
  const ariaNext = await page.evaluate(() => {
    const cand = Array.from(document.querySelectorAll('a[aria-label]')).find(a => /next/i.test(a.getAttribute('aria-label') || ''));
    return cand ? (cand.getAttribute('href') || '') : '';
  });
  if (ariaNext) return new URL(ariaNext, page.url()).href;
  return '';
}

// Module-scope state to seed numeric pagination only once
const GLOBAL_STATE = { numericSeeded: false };

Actor.main(async () => {
  const input = (await Actor.getInput()) || {};
  const defaults = [
    { url: 'https://www.coldwellbanker.com/city/fl/jacksonville/agents' },
    { url: 'https://www.coldwellbanker.com/fl/jacksonville/agents' },
  ];
  const startUrls = Array.isArray(input.startUrls) && input.startUrls.length ? [...input.startUrls, ...defaults] : defaults;

  const {
    listPageCount = 25,
    maxPages = 60,
    maxConcurrency = 4,
    maxAgents = 200,
    blockResources = true,
    followContact = true,
    proxy,
  } = input;

  const state = { pushed: 0, stop: false };

  const requestQueue = await Actor.openRequestQueue();
  for (const s of startUrls) {
    await requestQueue.addRequest({ url: s.url, userData: { label: 'LIST', pageNo: 1 } });
  }

  log.info('Starting crawler…');

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxConcurrency,
    headless: true,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 45,
    proxyConfiguration: proxy ? await Actor.createProxyConfiguration(proxy) : undefined,
    launchContext: {
      launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    },
    preNavigationHooks: [
      async ({ page }, gotoOptions) => {
        if (blockResources) {
          await page.route('**/*', (route) => {
            const req = route.request();
            const type = req.resourceType();
            const url = req.url();
            if (['image','font','media','stylesheet'].includes(type)) return route.abort();
            if (/googletagmanager|google-analytics|doubleclick|facebook|hotjar|optimizely|segment|intercom|zendesk|fullstory|youtube|vimeo/i.test(url))
              return route.abort();
            return route.continue();
          });
        }
        gotoOptions.waitUntil = 'domcontentloaded';
      },
    ],

    async requestHandler({ request, page }) {
      const { label } = request.userData || {};
      if (state.stop && label === 'LIST') return;

      if (label === 'LIST') {
        await dismissBanners(page);

        // Seed numeric pagination ONCE across run for city pages
        if (!GLOBAL_STATE.numericSeeded) {
          const url = new URL(page.url());
          const isCityList = /\/city\/[^/]+\/[^/]+\/agents/i.test(url.pathname);
          if (isCityList) {
            // read highest 'page=' present
            const maxFound = await page.$$eval('a[href*="page="]', (as) => {
              const nums = as.map(a => {
                try {
                  const u = new URL(a.getAttribute('href') || '', document.baseURI);
                  const n = parseInt(u.searchParams.get('page') || '0', 10);
                  return isNaN(n) ? 0 : n;
                } catch { return 0; }
              }).filter(n => n > 0);
              return nums.length ? Math.max(...nums) : 0;
            }).catch(()=>0);
            const targetLast = Math.min(maxFound || listPageCount, maxPages);

            // Base as page=1
            url.searchParams.set('page', '1');
            const base = url.href;

            let enq = 0;
            for (let p = 2; p <= targetLast; p++) {
              const u = new URL(base);
              u.searchParams.set('page', String(p));
              await requestQueue.addRequest({ url: u.href, userData: { label: 'LIST', pageNo: p }, uniqueKey: u.href });
              enq++;
            }
            log.info(`Numeric pagination seeded ${enq} pages (2..${targetLast}) for ${base}`);
            GLOBAL_STATE.numericSeeded = true;
          }
        }

        // Harvest profile links
        const links = await harvestAgentLinks(page, 500);
        let enqueued = 0;
        for (const url of links) {
          if (state.pushed >= maxAgents) { state.stop = true; break; }
          await requestQueue.addRequest({ url, userData: { label: 'AGENT' }, uniqueKey: url.split('?')[0] });
          enqueued++;
        }
        log.info(`LIST found ${enqueued} agent links on ${page.url()}`);

        // Fallback "next" discovery if we still need more
        if (!state.stop) {
          const nextHref = await getNextHref(page);
          const nextPageNo = (request.userData.pageNo || 1) + 1;
          if (nextHref && nextPageNo <= maxPages) {
            await requestQueue.addRequest({ url: nextHref, userData: { label: 'LIST', pageNo: nextPageNo }, uniqueKey: nextHref.split('?')[0] });
          }
        }

        if ((request.userData.pageNo || 1) === 1 && enqueued === 0) {
          const buf = await page.screenshot({ fullPage: true });
          await Actor.setValue('list_page_debug.png', buf, { contentType: 'image/png' });
          const html = await page.content();
          await Actor.setValue('list_page_debug.html', html, { contentType: 'text/html; charset=utf-8' });
          log.warning('No agent links found on LIST page. Saved list_page_debug artifacts.');
        }
      }

      if (label === 'AGENT') {
        await dismissBanners(page);

        const name = await extractName(page);
        const phoneRaw = await extractPhone(page);
        const phone = toE164(phoneRaw);
        let email = await extractEmail(page);

        if (!email && followContact) {
          const contactHref = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('a, button'));
            const link = nodes.find((el) => /contact/i.test(el.textContent || '') && el.tagName === 'A');
            if (link) return link.getAttribute('href') || '';
            const btn = nodes.find((el) => /contact/i.test(el.textContent || '') && el.hasAttribute('data-href'));
            return btn ? btn.getAttribute('data-href') : '';
          });
          if (contactHref) {
            const url = new URL(contactHref, page.url()).href;
            await requestQueue.addRequest({ url, userData: { label: 'CONTACT', partial: { name, phone, profileUrl: page.url() } }, uniqueKey: url.split('?')[0] });
            return;
          }
        }

        if (email) {
          const { firstName, lastName } = splitName(name);
          await Actor.pushData({ EMAIL: email, FIRSTNAME: firstName, LASTNAME: lastName, SMS: phone, sourceProfile: page.url(), sourceContact: page.url() });
          state.pushed++;
          if (state.pushed >= maxAgents) state.stop = true;
        }
      }

      if (label === 'CONTACT') {
        await dismissBanners(page);

        const email = await extractEmail(page);
        const phone = toE164(await extractPhone(page));
        const { name, profileUrl } = request.userData.partial || {};
        const { firstName, lastName } = splitName(name || '');

        if (email) {
          await Actor.pushData({ EMAIL: email, FIRSTNAME: firstName, LASTNAME: lastName, SMS: phone || '', sourceProfile: profileUrl || '', sourceContact: page.url() });
          state.pushed++;
          if (state.pushed >= maxAgents) state.stop = true;
        }
      }
    },

    failedRequestHandler({ request, error }) {
      log.error(`Request failed: ${request.url} :: ${error?.message || error}`);
    },
  });

  await crawler.run();

  // Build Brevo CSV
  const dataset = await Actor.openDataset();
  const { items } = await dataset.getData({ clean: true });

  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const email = (it.EMAIL || '').toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    deduped.push({ EMAIL: email, FIRSTNAME: it.FIRSTNAME || '', LASTNAME: it.LASTNAME || '', SMS: it.SMS || '' });
  }

  const headers = ['EMAIL','FIRSTNAME','LASTNAME','SMS'];
  const lines = [headers.join(',')];
  for (const row of deduped) {
    const esc = (v) => {
      const s = (v ?? '').toString();
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    lines.push(headers.map(h => esc(row[h])).join(','));
  }
  const csv = lines.join('\n');
  await Actor.setValue('brevo.csv', csv, { contentType: 'text/csv; charset=utf-8' });

  log.info(`Done. Records: ${deduped.length}. CSV saved as brevo.csv in Key-Value store.`);
});
