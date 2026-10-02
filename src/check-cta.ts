import { chromium } from 'playwright';

interface CTAResult {
  text: string;
  href: string;
  type: string;
  selector: string;
  status?: number;
  statusText?: string;
  is404: boolean;
  error?: string;
}

async function checkCTAs() {
  const targetUrl = 'https://smilesbydocford.com/';
  console.log(`🔍 Memeriksa CTA button pada: ${targetUrl}...\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Extract all possible CTA buttons and links
  const ctas = await page.evaluate(() => {
    const results: { text: string; href: string; type: string; selector: string; classes: string }[] = [];

    // Selectors that typically match CTA buttons
    const candidates = document.querySelectorAll<HTMLElement>(
      'a.btn, a.button, a[class*="btn"], a[class*="button"], a[role="button"], button, a.elementor-button, .cta a, a[class*="cta"]'
    );

    const seen = new Set<string>();

    candidates.forEach((el, index) => {
      let href = el.getAttribute('href') || (el as HTMLAnchorElement).href || '';
      let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');

      // If text is empty, check aria-label or title
      if (!text) {
        text = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      }

      const classes = el.className || '';
      const tagName = el.tagName.toLowerCase();

      // Check if button or link has onclick or form action
      if (!href && tagName === 'button') {
        const form = el.closest('form');
        if (form && form.action) {
          href = form.action;
        } else {
          href = 'javascript:void(0) [Form Button / JS Trigger]';
        }
      }

      // Key for deduplication
      const key = `${text}|${href}`;
      if (text && href && !seen.has(key)) {
        seen.add(key);
        results.push({
          text,
          href,
          type: tagName,
          selector: `${tagName}.${classes.split(' ').slice(0, 2).join('.')}`,
          classes,
        });
      }
    });

    // Also look for prominent hero / action links that look like buttons even without "btn" in class
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const text = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
      const style = window.getComputedStyle(a);
      const isButtonStyled =
        style.display !== 'inline' &&
        (style.borderRadius !== '0px' || style.paddingTop !== '0px') &&
        (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');

      const isCtaKeyword = /appointment|schedule|contact|consultation|call|book|get started|learn more|read more|explore|view/i.test(text);

      if ((isButtonStyled || isCtaKeyword) && text.length > 0 && text.length < 50) {
        const key = `${text}|${a.href}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            text,
            href: a.href,
            type: 'a (styled)',
            selector: `a.${a.className.split(' ').slice(0, 2).join('.')}`,
            classes: a.className,
          });
        }
      }
    });

    return results;
  });

  console.log(`Ditemukan ${ctas.length} CTA Button / Link pada halaman.\n`);

  const results: CTAResult[] = [];

  // Now verify each link destination HTTP status
  const requestContext = await browser.newContext();

  for (let i = 0; i < ctas.length; i++) {
    const cta = ctas[i];
    process.stdout.write(`[${i + 1}/${ctas.length}] Checking: "${cta.text}" -> ${cta.href}... `);

    // Skip tel: or mailto: or anchor hashes or javascript:
    if (cta.href.startsWith('tel:') || cta.href.startsWith('mailto:') || cta.href.startsWith('javascript:') || cta.href.startsWith('#')) {
      console.log(`⏩ Skipped (${cta.href.split(':')[0]})`);
      results.push({
        text: cta.text,
        href: cta.href,
        type: cta.type,
        selector: cta.selector,
        status: 200,
        statusText: 'Action Link (tel/mailto/hash)',
        is404: false,
      });
      continue;
    }

    try {
      // Resolve URL if relative
      const resolved = new URL(cta.href, targetUrl).toString();

      // Make HEAD or GET request
      const res = await requestContext.request.get(resolved, { timeout: 15000 });
      const status = res.status();
      const statusText = res.statusText();
      const is404 = status === 404;

      if (is404) {
        console.log(`❌ 404 NOT FOUND!`);
      } else if (status >= 400) {
        console.log(`⚠️ HTTP ${status} (${statusText})`);
      } else {
        console.log(`✅ HTTP ${status}`);
      }

      results.push({
        text: cta.text,
        href: resolved,
        type: cta.type,
        selector: cta.selector,
        status,
        statusText,
        is404,
      });
    } catch (err: any) {
      console.log(`❌ Request Error: ${err.message}`);
      results.push({
        text: cta.text,
        href: cta.href,
        type: cta.type,
        selector: cta.selector,
        is404: false,
        error: err.message,
      });
    }
  }

  await browser.close();

  // Summary
  console.log(`\n======================================================`);
  console.log(`📊 REKAPITULASI PEMERIKSAAN CTA BUTTON`);
  console.log(`======================================================`);
  console.log(`Total CTA Diperiksa : ${results.length}`);
  const notFound = results.filter((r) => r.is404);
  const errors = results.filter((r) => (r.status && r.status >= 400 && r.status !== 404) || r.error);
  const success = results.filter((r) => r.status && r.status < 400);

  console.log(`✅ Valid / Berhasil  : ${success.length}`);
  console.log(`❌ 404 Not Found    : ${notFound.length}`);
  console.log(`⚠️ Error Lainnya    : ${errors.length}`);
  console.log(`======================================================\n`);

  if (notFound.length > 0) {
    console.log(`🚨 DAFTAR CTA YANG MENGARAH KE 404:`);
    notFound.forEach((r, idx) => {
      console.log(`${idx + 1}. Teks: "${r.text}"`);
      console.log(`   URL: ${r.href}`);
      console.log(`   Selector: ${r.selector}\n`);
    });
  } else {
    console.log(`🎉 SEMUA CTA BUTTON MENGARAH KE HALAMAN VALID (TIDAK ADA 404)!\n`);
  }

  console.log(JSON.stringify(results, null, 2));
}

checkCTAs().catch(console.error);
