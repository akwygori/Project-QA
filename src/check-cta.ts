import { chromium, Browser, BrowserContext } from 'playwright';
import dotenv from 'dotenv';
import { ensureAbsoluteUrl } from './config.js';

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

interface UrlCheckResult {
  status: number;
  initialStatus?: number;
  statusText?: string;
  isRedirect?: boolean;
  redirectUrl?: string;
  condition: string;
  is404: boolean;
  error?: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 PlaywrightQABot/1.0';

const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function auditSingleUrl(
  browser: Browser,
  requestContext: BrowserContext,
  targetUrl: string,
  urlCache: Map<string, UrlCheckResult>,
  pageIndex?: number,
  totalUrls?: number
) {
  const prefix = totalUrls && totalUrls > 1 ? `[Page ${pageIndex}/${totalUrls}] ` : '';

  console.log(`\n======================================================`);
  console.log(`🔍 [CTA Auditor] ${prefix}Memeriksa CTA button & link pada:`);
  console.log(`🌐 ${targetUrl}`);
  console.log(`======================================================\n`);

  const pageContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: DEFAULT_USER_AGENT,
    extraHTTPHeaders: DEFAULT_HEADERS,
  });

  const page = await pageContext.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Extract all possible CTA buttons and links
    const ctas = await page.evaluate(() => {
      if (typeof (window as any).__name === 'undefined') {
        (window as any).__name = (fn: any) => fn;
      }
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

      let resolved: string;
      try {
        resolved = new URL(cta.href, targetUrl).toString();
      } catch {
        console.log(`❌ Invalid URL`);
        results.push({
          text: cta.text,
          href: cta.href,
          type: cta.type,
          selector: cta.selector,
          rel: cta.rel,
          followStatus: cta.followStatus,
          condition: 'URL tidak valid',
          is404: true,
          error: 'Invalid URL format',
        });
        continue;
      }

      // Check URL Cache first (avoids duplicate requests across the page)
      if (urlCache.has(resolved)) {
        const cached = urlCache.get(resolved)!;
        const redirInfo = cached.redirectUrl ? ` -> ${cached.redirectUrl}` : '';
        console.log(`⚡ [Cached] ${cached.condition}${redirInfo}`);
        results.push({
          text: cta.text,
          href: resolved,
          type: cta.type,
          selector: cta.selector,
          rel: cta.rel,
          followStatus: cta.followStatus,
          ...cached,
        });
        continue;
      }

      try {
        // Check initial response with HEAD first to save bandwidth, fallback to GET
        let initRes;
        try {
          initRes = await requestContext.request.fetch(resolved, { method: 'HEAD', timeout: 15000, maxRedirects: 0 });
          if (initRes.status() === 405 || initRes.status() === 501) {
            initRes = await requestContext.request.get(resolved, { timeout: 15000, maxRedirects: 0 });
          }
        } catch {
          initRes = await requestContext.request.get(resolved, { timeout: 15000, maxRedirects: 0 });
        }

        const initStatus = initRes.status();
        const initStatusText = initRes.statusText();

        let finalStatus = initStatus;
        let finalStatusText = initStatusText;
        let isRedirect = false;
        let redirectUrl: string | undefined = undefined;
        let condition = '';
        let is404 = false;

        const isProtectedPlatform = /instagram\.com|facebook\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|pinterest\.com/i.test(resolved);
        if (isProtectedPlatform && (initStatus === 403 || initStatus === 999)) {
          console.log(`🛡️ 200 success (Protected Platform: HTTP ${initStatus})`);
          const checkRes: UrlCheckResult = {
            status: 200,
            initialStatus: initStatus,
            statusText: 'Protected Platform OK',
            isRedirect: false,
            condition: '200 success (Protected External Platform)',
            is404: false,
          };
          urlCache.set(resolved, checkRes);
          results.push({
            text: cta.text,
            href: resolved,
            type: cta.type,
            selector: cta.selector,
            rel: cta.rel,
            followStatus: cta.followStatus,
            ...checkRes,
          });
          continue;
        }

        if (initStatus >= 300 && initStatus < 400) {
          isRedirect = true;
          // Follow redirects to determine landing status
          const finalRes = await requestContext.request.get(resolved, { timeout: 15000, maxRedirects: 5 });
          finalStatus = finalRes.status();
          finalStatusText = finalRes.statusText();
          redirectUrl = finalRes.url();
          is404 = finalStatus === 404;

          if (isProtectedPlatform && (finalStatus === 403 || finalStatus === 999)) {
            condition = '200 redirection (Protected External Platform)';
            is404 = false;
            console.log(`🔀 200 redirection (${initStatus} -> Protected: ${redirectUrl})`);
          } else if (finalStatus === 200) {
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

        const checkRes: UrlCheckResult = {
          status: finalStatus,
          initialStatus: initStatus,
          statusText: finalStatusText,
          isRedirect,
          redirectUrl,
          condition,
          is404,
        };

        urlCache.set(resolved, checkRes);

        results.push({
          text: cta.text,
          href: resolved,
          type: cta.type,
          selector: cta.selector,
          rel: cta.rel,
          followStatus: cta.followStatus,
          ...checkRes,
        });
      } catch (err: any) {
        console.log(`❌ Request Error: ${err.message}`);
        const checkRes: UrlCheckResult = {
          status: 0,
          condition: `Gagal (${err.message})`,
          is404: false,
          error: err.message,
        };
        urlCache.set(resolved, checkRes);
        results.push({
          text: cta.text,
          href: cta.href,
          type: cta.type,
          selector: cta.selector,
          rel: cta.rel,
          followStatus: cta.followStatus,
          ...checkRes,
        });
      }
    }

    // Summary statistics for this page
    const dofollowCount = results.filter((r) => r.followStatus === 'DOFOLLOW').length;
    const nofollowCount = results.filter((r) => r.followStatus === 'NOFOLLOW').length;
    const success200 = results.filter((r) => r.condition.startsWith('200 success')).length;
    const redirect200 = results.filter((r) => r.condition.startsWith('200 redirection')).length;
    const failed404 = results.filter((r) => r.is404).length;
    const otherErrors = results.filter((r) => !r.is404 && r.condition.includes('gagal')).length;

    console.log(`\n======================================================`);
    console.log(`📊 REKAPITULASI PEMERIKSAAN CTA: ${targetUrl}`);
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

    return results;
  } catch (err: any) {
    console.error(`❌ Gagal memeriksa halaman ${targetUrl}: ${err.message}\n`);
    return [];
  } finally {
    await pageContext.close().catch(() => {});
  }
}

async function checkCTAs() {
  // Parse target URLs from command line arguments
  let targetUrls: string[] = [];

  const urlsIdx = process.argv.findIndex((a) => a === '--urls');
  if (urlsIdx !== -1) {
    const collected: string[] = [];
    for (let i = urlsIdx + 1; i < process.argv.length; i++) {
      if (process.argv[i].startsWith('-')) break;
      collected.push(process.argv[i]);
    }
    if (collected.length > 0) {
      targetUrls = collected;
    }
  }

  if (targetUrls.length === 0) {
    const urlIdx = process.argv.findIndex((a) => a === '-u' || a === '--url' || a === '-t' || a === '--target');
    if (urlIdx !== -1 && process.argv[urlIdx + 1]) {
      targetUrls = [process.argv[urlIdx + 1]];
    } else {
      const positional = process.argv.slice(2).filter((a) => !a.startsWith('-') && (a.includes('://') || a.includes('.') || a.includes('localhost')));
      if (positional.length > 0) {
        targetUrls = positional;
      }
    }
  }

  if (targetUrls.length === 0) {
    targetUrls = [process.env.TARGET_URL || 'https://example.com'];
  }

  targetUrls = targetUrls.map((u) => ensureAbsoluteUrl(u));

  console.log(`\n======================================================`);
  console.log(`🎯 [CTA Auditor Tool] Memulai Pemeriksaan CTA Button & Link`);
  console.log(`📄 Total Target : ${targetUrls.length} halaman`);
  targetUrls.forEach((u, i) => console.log(`   [${i + 1}] ${u}`));
  console.log(`======================================================`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });

    // Global RequestContext with realistic User-Agent and headers
    const requestContext = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      extraHTTPHeaders: DEFAULT_HEADERS,
    });

    // In-memory cache shared across the session
    const urlCache = new Map<string, UrlCheckResult>();

    for (let idx = 0; idx < targetUrls.length; idx++) {
      await auditSingleUrl(browser, requestContext, targetUrls[idx], urlCache, idx + 1, targetUrls.length);
    }
  } catch (err: any) {
    console.error(`❌ Terjadi kesalahan saat memeriksa CTA: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

checkCTAs().catch(console.error);
