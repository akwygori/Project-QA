import fs from 'fs';
import path from 'path';
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { CrawlConfig, PageScanResult, ConsoleLogEntry, NetworkErrorEntry } from './types.js';
import { extractLinksFromPage, urlToPageName } from './crawler.js';

export class PageScanner {
  private browser: Browser | null = null;
  private config: CrawlConfig;
  private screenshotsDir: string;
  private logsDir: string;

  constructor(config: CrawlConfig) {
    this.config = config;
    this.screenshotsDir = path.join(config.outputDir, 'screenshots');
    this.logsDir = path.join(config.outputDir, 'logs');

    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async auditAndAnnotateImages(page: Page): Promise<any> {
    return await page.evaluate((annotate: boolean) => {
      const imgElements = Array.from(document.querySelectorAll('img'));
      const auditData: any[] = [];

      let withAltCount = 0;
      let missingAltCount = 0;
      let emptyAltCount = 0;

      // Remove previous overlays if any
      document.querySelectorAll('.playwright-qa-alt-overlay').forEach((el) => el.remove());

      imgElements.forEach((img) => {
        const hasAlt = img.hasAttribute('alt');
        const altValue = img.getAttribute('alt');
        const isEmpty = hasAlt && (altValue === null || altValue.trim() === '');
        const isMissing = !hasAlt;

        if (isMissing) {
          missingAltCount++;
        } else if (isEmpty) {
          emptyAltCount++;
        } else {
          withAltCount++;
        }

        const rect = img.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(img).display !== 'none';

        auditData.push({
          src: img.currentSrc || img.src || '',
          alt: altValue,
          hasAlt,
          isEmptyAlt: isEmpty,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          elementId: img.id || undefined,
          className: img.className || undefined,
        });

        if (annotate && isVisible) {
          // Outline the image directly
          if (isMissing) {
            img.style.outline = '4px solid #ef4444';
            img.style.outlineOffset = '-3px';
          } else if (isEmpty) {
            img.style.outline = '3px dashed #f59e0b';
            img.style.outlineOffset = '-3px';
          } else {
            img.style.outline = '3px solid #10b981';
            img.style.outlineOffset = '-3px';
          }

          // Add badge overlay on top of the image
          const badge = document.createElement('div');
          badge.className = 'playwright-qa-alt-overlay';
          badge.style.position = 'absolute';
          badge.style.top = `${rect.top + window.scrollY}px`;
          badge.style.left = `${rect.left + window.scrollX}px`;
          badge.style.zIndex = '2147483647';
          badge.style.padding = '4px 8px';
          badge.style.borderRadius = '5px';
          badge.style.fontFamily = 'Consolas, Menlo, Monaco, "Courier New", monospace';
          badge.style.fontSize = '12px';
          badge.style.fontWeight = 'bold';
          badge.style.lineHeight = '1.35';
          badge.style.pointerEvents = 'none';
          badge.style.boxShadow = '0 3px 8px rgba(0,0,0,0.85)';
          badge.style.maxWidth = `${Math.min(Math.max(rect.width, 320), window.innerWidth - 40)}px`;
          badge.style.whiteSpace = 'normal';
          badge.style.wordBreak = 'break-word';
          badge.style.color = '#ffffff';

          if (isMissing) {
            badge.style.backgroundColor = '#dc2626'; // Red
            badge.style.border = '1px solid #fecaca';
            badge.innerText = `⚠️ [ALT MISSING!]`;
          } else if (isEmpty) {
            badge.style.backgroundColor = '#d97706'; // Amber
            badge.style.border = '1px solid #fef3c7';
            badge.innerText = `🟡 alt="" (Empty / Decorative)`;
          } else {
            badge.style.backgroundColor = 'rgba(5, 150, 105, 0.96)'; // Green
            badge.style.border = '1px solid #a7f3d0';
            badge.innerText = `🟢 alt: "${altValue}"`;
          }

          document.body.appendChild(badge);
        }
      });

      if (annotate && imgElements.length > 0) {
        // Sticky/top banner in the screenshot
        const topBar = document.createElement('div');
        topBar.className = 'playwright-qa-alt-overlay';
        topBar.style.position = 'absolute';
        topBar.style.top = '0';
        topBar.style.left = '0';
        topBar.style.right = '0';
        topBar.style.zIndex = '2147483647';
        topBar.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
        topBar.style.color = '#f8fafc';
        topBar.style.padding = '8px 16px';
        topBar.style.fontSize = '13px';
        topBar.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        topBar.style.fontWeight = '600';
        topBar.style.display = 'flex';
        topBar.style.alignItems = 'center';
        topBar.style.gap = '16px';
        topBar.style.borderBottom = '2px solid #6366f1';
        topBar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';

        topBar.innerHTML = `
          <span>🖼️ <strong>Image Alt Audit</strong> (${imgElements.length} images)</span>
          <span style="color: #34d399;">🟢 ${withAltCount} With Alt</span>
          <span style="color: #fbbf24;">🟡 ${emptyAltCount} Empty Alt</span>
          <span style="color: #f87171;">🔴 ${missingAltCount} Missing Alt</span>
        `;
        document.body.appendChild(topBar);
      }

      return {
        totalImages: imgElements.length,
        withAlt: withAltCount,
        missingAlt: missingAltCount,
        emptyAlt: emptyAltCount,
        images: auditData,
      };
    }, this.config.annotateAlt ?? true);
  }

  private async autoScroll(page: Page): Promise<void> {
    try {
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 300;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight || totalHeight > 15000) {
              clearInterval(timer);
              window.scrollTo(0, 0); // scroll back to top
              setTimeout(resolve, 300);
            }
          }, 100);
        });
      });
    } catch {
      // Ignore evaluation errors during scroll
    }
  }

  private async captureSafeScreenshot(page: Page, defaultPath: string): Promise<string> {
    try {
      await page.screenshot({
        path: defaultPath,
        fullPage: this.config.fullPageScreenshot,
      });
      return defaultPath;
    } catch (err: any) {
      // If locked by Windows, retry with alternate name
      const ext = path.extname(defaultPath);
      const base = defaultPath.slice(0, -ext.length);
      const altPath = `${base}-${Date.now()}${ext}`;
      try {
        await page.screenshot({
          path: altPath,
          fullPage: this.config.fullPageScreenshot,
        });
        return altPath;
      } catch (retryErr: any) {
        console.warn(`Failed to capture screenshot at ${defaultPath}:`, retryErr.message);
        return '';
      }
    }
  }

  private async auditPageCTAs(page: Page, context: BrowserContext, targetUrl: string): Promise<any> {
    try {
      const rawCtas = await page.evaluate(() => {
        const candidates = document.querySelectorAll<HTMLElement>(
          'a.btn, a.button, a[class*="btn"], a[class*="button"], a[role="button"], button, a.elementor-button, .cta a, a[class*="cta"]'
        );
        const seen = new Set<string>();
        const list: { text: string; href: string; type: string; selector: string }[] = [];

        candidates.forEach((el) => {
          let href = el.getAttribute('href') || (el as HTMLAnchorElement).href || '';
          let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
          if (!text) text = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          const tagName = el.tagName.toLowerCase();
          if (!href && tagName === 'button') {
            const form = el.closest('form');
            href = form?.action || 'javascript:void(0)';
          }
          const key = `${text}|${href}`;
          if (text && href && !seen.has(key)) {
            seen.add(key);
            list.push({
              text,
              href,
              type: tagName,
              selector: `${tagName}.${el.className.split(' ').slice(0, 2).join('.')}`,
            });
          }
        });

        // Also check action keyword links
        document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
          const text = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
          const style = window.getComputedStyle(a);
          const isButtonStyled =
            style.display !== 'inline' &&
            (style.borderRadius !== '0px' || style.paddingTop !== '0px') &&
            (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');
          const isCtaKeyword = /appointment|schedule|contact|consultation|call|book|get started|learn more|explore|view/i.test(text);

          if ((isButtonStyled || isCtaKeyword) && text.length > 0 && text.length < 50) {
            const key = `${text}|${a.href}`;
            if (!seen.has(key)) {
              seen.add(key);
              list.push({
                text,
                href: a.href,
                type: 'a (styled)',
                selector: `a.${a.className.split(' ').slice(0, 2).join('.')}`,
              });
            }
          }
        });

        return list;
      });

      const ctas: any[] = [];
      let brokenCount = 0;
      let validCount = 0;

      for (const item of rawCtas) {
        if (
          item.href.startsWith('tel:') ||
          item.href.startsWith('mailto:') ||
          item.href.startsWith('javascript:') ||
          item.href.startsWith('#')
        ) {
          validCount++;
          ctas.push({
            text: item.text,
            href: item.href,
            type: item.type,
            selector: item.selector,
            status: 200,
            statusText: 'Action Protocol',
            is404: false,
          });
          continue;
        }

        try {
          const resolved = new URL(item.href, targetUrl).toString();
          const res = await context.request.get(resolved, { timeout: 10000 });
          const status = res.status();
          const is404 = status === 404;

          if (is404 || status >= 400) {
            brokenCount++;
          } else {
            validCount++;
          }

          ctas.push({
            text: item.text,
            href: resolved,
            type: item.type,
            selector: item.selector,
            status,
            statusText: res.statusText(),
            is404,
          });
        } catch (err: any) {
          brokenCount++;
          ctas.push({
            text: item.text,
            href: item.href,
            type: item.type,
            selector: item.selector,
            is404: false,
            error: err.message,
          });
        }
      }

      return {
        totalCTAs: ctas.length,
        validCTAs: validCount,
        brokenCTAs: brokenCount,
        ctas,
      };
    } catch {
      return { totalCTAs: 0, validCTAs: 0, brokenCTAs: 0, ctas: [] };
    }
  }

  async scanPage(targetUrl: string): Promise<PageScanResult> {
    if (!this.browser) {
      throw new Error('Browser is not initialized. Call init() first.');
    }

    const pageName = urlToPageName(targetUrl);
    const consoleErrors: ConsoleLogEntry[] = [];
    const consoleWarnings: ConsoleLogEntry[] = [];
    const unhandledJSErrors: string[] = [];
    const failedRequests: NetworkErrorEntry[] = [];
    let mainHttpStatus = 0;
    let pageTitle = '';
    let discoveredLinks: string[] = [];
    let pageTextSnippets: string[] = [];
    const screenshotPaths: { desktop?: string; mobile?: string } = {};

    const startTime = Date.now();

    // 1. Desktop Scan & Full Error Capturing
    const desktopVp = this.config.viewports.find((v) => v.name === 'desktop') || {
      width: 1920,
      height: 1080,
    };

    const context: BrowserContext = await this.browser.newContext({
      viewport: { width: desktopVp.width, height: desktopVp.height },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 PlaywrightQABot/1.0',
    });

    const page: Page = await context.newPage();

    // Setup listeners
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      const location = msg.location() ? `${msg.location().url}:${msg.location().lineNumber}` : undefined;
      const timestamp = new Date().toISOString();

      if (type === 'error') {
        consoleErrors.push({ type: 'error', text, location, timestamp });
      } else if (type === 'warning') {
        consoleWarnings.push({ type: 'warning', text, location, timestamp });
      }
    });

    page.on('pageerror', (error) => {
      unhandledJSErrors.push(error.stack || error.message || String(error));
    });

    page.on('response', (response) => {
      const status = response.status();
      const req = response.request();
      if (req.isNavigationRequest() && req.url() === targetUrl) {
        mainHttpStatus = status;
      }
      if (status >= 400) {
        failedRequests.push({
          url: response.url(),
          status,
          statusText: response.statusText(),
          resourceType: req.resourceType(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    page.on('requestfailed', (request) => {
      failedRequests.push({
        url: request.url(),
        resourceType: request.resourceType(),
        failureReason: request.failure()?.errorText || 'Unknown failure',
        timestamp: new Date().toISOString(),
      });
    });

    let pageImageAudit: any = {
      totalImages: 0,
      withAlt: 0,
      missingAlt: 0,
      emptyAlt: 0,
      images: [],
    };
    let pageCtaAudit: any = {
      totalCTAs: 0,
      validCTAs: 0,
      brokenCTAs: 0,
      ctas: [],
    };

    try {
      // Navigate with timeout and fallback
      let navResponse = null;
      try {
        navResponse = await page.goto(targetUrl, {
          waitUntil: 'networkidle',
          timeout: this.config.timeoutMs,
        });
      } catch {
        // Fallback to domcontentloaded if networkidle timed out
        navResponse = await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeoutMs,
        });
      }

      if (navResponse && !mainHttpStatus) {
        mainHttpStatus = navResponse.status();
      }

      // Wait a moment for dynamic rendering
      await page.waitForTimeout(1000);

      pageTitle = await page.title().catch(() => '');

      // Trigger lazy loaded elements
      await this.autoScroll(page);

      // Audit and inject visual alt text badges before taking screenshot
      pageImageAudit = await this.auditAndAnnotateImages(page);

      // Audit CTA Buttons destination status
      pageCtaAudit = await this.auditPageCTAs(page, context, targetUrl);

      // Desktop Screenshot (will contain visual alt annotations)
      const desktopFilename = `${pageName}-desktop.png`;
      const desktopFilePath = path.join(this.screenshotsDir, desktopFilename);
      screenshotPaths.desktop = await this.captureSafeScreenshot(page, desktopFilePath);

      // Extract internal links for crawler
      discoveredLinks = await extractLinksFromPage(page, this.config.baseUrl, this.config.excludePatterns);

      // Extract key textual content for typo & grammar checking
      pageTextSnippets = await page.evaluate(() => {
        const sel = 'h1, h2, h3, h4, h5, h6, p, li, button, .cta, a.btn, [role="button"], [role="heading"]';
        const elements = Array.from(document.querySelectorAll(sel));
        const texts = elements
          .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' '))
          .filter((t) => t.length >= 8 && t.length <= 400 && !t.includes('{') && !t.includes('function('));
        return Array.from(new Set(texts)).slice(0, 80);
      });
    } catch (err: any) {
      unhandledJSErrors.push(`Navigation failed: ${err.message || String(err)}`);
    } finally {
      await context.close().catch(() => {});
    }

    // 2. Mobile Scan & Screenshot (if configured)
    const mobileVp = this.config.viewports.find((v) => v.name === 'mobile');
    if (mobileVp && this.browser) {
      const mobileContext = await this.browser.newContext({
        viewport: { width: mobileVp.width, height: mobileVp.height },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: mobileVp.deviceScaleFactor || 2,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1 PlaywrightQABot/1.0',
      });

      const mobilePage = await mobileContext.newPage();
      try {
        await mobilePage.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeoutMs,
        });
        await mobilePage.waitForTimeout(1000);
        await this.autoScroll(mobilePage);

        // Inject visual alt text badges on mobile view as well
        await this.auditAndAnnotateImages(mobilePage);

        const mobileFilename = `${pageName}-mobile.png`;
        const mobileFilePath = path.join(this.screenshotsDir, mobileFilename);
        screenshotPaths.mobile = await this.captureSafeScreenshot(mobilePage, mobileFilePath);
      } catch {
        // Mobile screenshot optional failure
      } finally {
        await mobileContext.close().catch(() => {});
      }
    }

    const loadTimeMs = Date.now() - startTime;
    const isSuccess = mainHttpStatus >= 200 && mainHttpStatus < 400 && unhandledJSErrors.length === 0;

    const result: PageScanResult = {
      url: targetUrl,
      pageName,
      path: new URL(targetUrl).pathname,
      title: pageTitle,
      httpStatus: mainHttpStatus || 200,
      isSuccess,
      loadTimeMs,
      consoleErrors,
      consoleWarnings,
      unhandledJSErrors,
      failedRequests,
      screenshots: screenshotPaths,
      discoveredLinks,
      imageAudit: pageImageAudit,
      ctaAudit: pageCtaAudit,
      pageTextSnippets,
    };

    // Save individual page log
    const logFilePath = path.join(this.logsDir, `${pageName}.json`);
    fs.writeFileSync(logFilePath, JSON.stringify(result, null, 2), 'utf-8');

    return result;
  }
}
