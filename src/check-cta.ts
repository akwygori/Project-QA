import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

interface CTAResult {
  text: string;
  href: string;
  type: string;
  selector: string;
  classes?: string;
  rel?: string;
  followStatus: 'DOFOLLOW' | 'NOFOLLOW';
  status?: number;
  initialStatus?: number;
  statusText?: string;
  isRedirect?: boolean;
  redirectUrl?: string;
  condition: string;
  is404: boolean;
  error?: string;
}

async function checkCTAs() {
  const urlIdx = process.argv.findIndex((a) => a === '-u' || a === '--url' || a === '-t' || a === '--target');
  const targetArg = urlIdx !== -1 && process.argv[urlIdx + 1] ? process.argv[urlIdx + 1] : process.argv.slice(2).find((a) => !a.startsWith('-'));
  const targetUrl = targetArg || process.env.TARGET_URL || 'https://example.com';
  console.log(`\n======================================================`);
  console.log(`🔍 [CTA Auditor] Memeriksa CTA button & link pada:`);
  console.log(`🌐 ${targetUrl}`);
  console.log(`======================================================\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Extract all possible CTA buttons and links
  const ctas = await page.evaluate(() => {
    const results: {
      text: string;
      href: string;
      type: string;
      selector: string;
      classes: string;
      rel: string;
      followStatus: 'DOFOLLOW' | 'NOFOLLOW';
    }[] = [];

    // Selectors that typically match CTA buttons
    const candidates = document.querySelectorAll<HTMLElement>(
      'a.btn, a.button, a[class*="btn"], a[class*="button"], a[role="button"], button, a.elementor-button, .cta a, a[class*="cta"]'
    );

    const seen = new Set<string>();

    candidates.forEach((el) => {
      let href = el.getAttribute('href') || (el as HTMLAnchorElement).href || '';
      let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');

      // If text is empty, check aria-label or title
      if (!text) {
        text = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      }

      const classes = el.className || '';
      const tagName = el.tagName.toLowerCase();
      const rel = (el.getAttribute('rel') || '').trim();
      const isNofollow = /\bnofollow\b/i.test(rel);
      const followStatus: 'DOFOLLOW' | 'NOFOLLOW' = isNofollow ? 'NOFOLLOW' : 'DOFOLLOW';

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
          rel,
          followStatus,
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
          const rel = (a.getAttribute('rel') || '').trim();
          const isNofollow = /\bnofollow\b/i.test(rel);
          const followStatus: 'DOFOLLOW' | 'NOFOLLOW' = isNofollow ? 'NOFOLLOW' : 'DOFOLLOW';

          results.push({
            text,
            href: a.href,
            type: 'a (styled)',
            selector: `a.${a.className.split(' ').slice(0, 2).join('.')}`,
            classes: a.className,
            rel,
            followStatus,
          });
        }
      }
    });

    return results;
  });

  console.log(`Ditemukan ${ctas.length} CTA Button / Link pada halaman.\n`);

  const results: CTAResult[] = [];
  const requestContext = await browser.newContext();

  for (let i = 0; i < ctas.length; i++) {
    const cta = ctas[i];
    const followBadge = cta.followStatus === 'NOFOLLOW' ? '🟡 [NOFOLLOW]' : '🟢 [DOFOLLOW]';
    process.stdout.write(`[${i + 1}/${ctas.length}] ${followBadge} "${cta.text}" -> ${cta.href}... `);

    // Skip tel: or mailto: or anchor hashes or javascript:
    const trimmedHref = cta.href.trim();
    if (
      trimmedHref.startsWith('tel:') ||
      trimmedHref.startsWith('mailto:') ||
      trimmedHref.startsWith('javascript:') ||
      trimmedHref.startsWith('#')
    ) {
      console.log(`⏩ Action Protocol (${trimmedHref.split(':')[0]})`);
      results.push({
        text: cta.text,
        href: cta.href,
        type: cta.type,
        selector: cta.selector,
        rel: cta.rel,
        followStatus: cta.followStatus,
        status: 200,
        statusText: 'Action Protocol',
        condition: '200 success (Action Protocol)',
        is404: false,
      });
      continue;
    }

    try {
      const resolved = new URL(cta.href, targetUrl).toString();

      // Check initial response with maxRedirects: 0 to catch 301/302 redirects
      const initRes = await requestContext.request.get(resolved, { timeout: 15000, maxRedirects: 0 });
      const initStatus = initRes.status();
      const initStatusText = initRes.statusText();

      let finalStatus = initStatus;
      let finalStatusText = initStatusText;
      let isRedirect = false;
      let redirectUrl: string | undefined = undefined;
      let condition = '';
      let is404 = false;

      if (initStatus >= 300 && initStatus < 400) {
        isRedirect = true;
        // Follow redirects to determine landing status
        const finalRes = await requestContext.request.get(resolved, { timeout: 15000, maxRedirects: 5 });
        finalStatus = finalRes.status();
        finalStatusText = finalRes.statusText();
        redirectUrl = finalRes.url();
        is404 = finalStatus === 404;

        if (finalStatus === 200) {
          condition = '200 redirection';
          console.log(`🔀 200 redirection (${initStatus} -> ${redirectUrl})`);
        } else if (finalStatus === 404) {
          condition = '404 gagal';
          console.log(`❌ 404 gagal (redirect ${initStatus} -> 404: ${redirectUrl})`);
        } else if (finalStatus >= 400) {
          condition = `${initStatus} redirect -> ${finalStatus} gagal`;
          console.log(`⚠️ ${condition}`);
        } else {
          condition = `${initStatus} redirect -> ${finalStatus}`;
          console.log(`ℹ️ ${condition}`);
        }
      } else if (initStatus === 200) {
        finalStatus = 200;
        condition = '200 success';
        is404 = false;
        console.log(`✅ 200 success`);
      } else if (initStatus === 404) {
        finalStatus = 404;
        condition = '404 gagal';
        is404 = true;
        console.log(`❌ 404 gagal`);
      } else if (initStatus >= 400) {
        finalStatus = initStatus;
        condition = `HTTP ${initStatus} gagal`;
        is404 = false;
        console.log(`⚠️ HTTP ${initStatus} (${initStatusText})`);
      } else {
        finalStatus = initStatus;
        condition = `HTTP ${initStatus}`;
        is404 = false;
        console.log(`ℹ️ HTTP ${initStatus}`);
      }

      results.push({
        text: cta.text,
        href: resolved,
        type: cta.type,
        selector: cta.selector,
        rel: cta.rel,
        followStatus: cta.followStatus,
        status: finalStatus,
        initialStatus: initStatus,
        statusText: finalStatusText,
        isRedirect,
        redirectUrl,
        condition,
        is404,
      });
    } catch (err: any) {
      console.log(`❌ Request Error: ${err.message}`);
      results.push({
        text: cta.text,
        href: cta.href,
        type: cta.type,
        selector: cta.selector,
        rel: cta.rel,
        followStatus: cta.followStatus,
        condition: `Gagal (${err.message})`,
        is404: false,
        error: err.message,
      });
    }
  }

  await browser.close();

  // Summary statistics
  const dofollowCount = results.filter((r) => r.followStatus === 'DOFOLLOW').length;
  const nofollowCount = results.filter((r) => r.followStatus === 'NOFOLLOW').length;
  const success200 = results.filter((r) => r.condition.startsWith('200 success')).length;
  const redirect200 = results.filter((r) => r.condition.startsWith('200 redirection')).length;
  const failed404 = results.filter((r) => r.is404).length;
  const otherErrors = results.filter((r) => !r.is404 && r.condition.includes('gagal')).length;

  console.log(`\n======================================================`);
  console.log(`📊 REKAPITULASI PEMERIKSAAN CTA BUTTON & LINK`);
  console.log(`======================================================`);
  console.log(`Total CTA Diperiksa    : ${results.length}`);
  console.log(`------------------------------------------------------`);
  console.log(`🟢 DOFOLLOW Links      : ${dofollowCount}`);
  console.log(`🟡 NOFOLLOW Links      : ${nofollowCount}`);
  console.log(`------------------------------------------------------`);
  console.log(`✅ 200 Success         : ${success200}`);
  console.log(`🔀 200 Redirection     : ${redirect200}`);
  console.log(`❌ 404 Gagal           : ${failed404}`);
  if (otherErrors > 0) {
    console.log(`⚠️ Error / Gagal Lain  : ${otherErrors}`);
  }
  console.log(`======================================================\n`);

  if (failed404 > 0) {
    console.log(`🚨 DAFTAR CTA YANG MENGARAH KE 404 GAGAL:`);
    results
      .filter((r) => r.is404)
      .forEach((r, idx) => {
        console.log(`${idx + 1}. [${r.followStatus}] "${r.text}"`);
        console.log(`   URL      : ${r.href}`);
        console.log(`   Condition: ${r.condition}`);
        if (r.redirectUrl) console.log(`   Redirect : ${r.redirectUrl}`);
        console.log(`   Selector : ${r.selector}\n`);
      });
  } else {
    console.log(`🎉 SEMUA CTA BUTTON MENGARAH KE HALAMAN VALID (TIDAK ADA 404)!\n`);
  }

  if (redirect200 > 0) {
    console.log(`🔀 DAFTAR CTA DENGAN 200 REDIRECTION:`);
    results
      .filter((r) => r.condition.startsWith('200 redirection'))
      .forEach((r, idx) => {
        console.log(`${idx + 1}. [${r.followStatus}] "${r.text}"`);
        console.log(`   Origin URL: ${r.href}`);
        console.log(`   Target URL: ${r.redirectUrl}`);
        console.log(`   Flow      : HTTP ${r.initialStatus} -> Final HTTP ${r.status}\n`);
      });
  }
}

checkCTAs().catch(console.error);
