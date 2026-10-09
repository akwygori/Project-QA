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
  private ctaStatusCache = new Map<string, Promise<{
    status: number;
    initialStatus: number;
    statusText: string;
    isRedirect: boolean;
    redirectUrl?: string;
    condition: string;
    is404: boolean;
    error?: string;
  }>>();

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
    const opts = {
      annotate: this.config.annotateAlt ?? true,
      checkQuality: this.config.checkImageQuality ?? true,
      minHdRatio: this.config.minHdRatio ?? 1.9,
      maxOversizedRatio: this.config.maxOversizedRatio ?? 3.5,
      maxImageSizeKb: this.config.maxImageSizeKb ?? 500,
    };

    return await page.evaluate((options) => {
      // Polyfill esbuild __name helper if injected into browser context
      if (typeof (window as any).__name === 'undefined') {
        (window as any).__name = (fn: any) => fn;
      }

      const imgElements = Array.from(document.querySelectorAll('img'));
      const auditData: any[] = [];

      let withAltCount = 0;
      let missingAltCount = 0;
      let emptyAltCount = 0;

      let retinaHdCount = 0;
      let standardResCount = 0;
      let blurryCount = 0;
      let oversizedCount = 0;
      let distortedCount = 0;
      let missingDimensionsCount = 0;

      // Helper function to format bytes to string
      const formatBytes = (bytes: number): string => {
        if (!bytes || bytes <= 0) return '';
        if (bytes < 1024) return bytes + ' B';
        const kb = bytes / 1024;
        if (kb < 1024) return kb.toFixed(1) + ' KB';
        return (kb / 1024).toFixed(2) + ' MB';
      };

      // Remove previous overlays if any
      document.querySelectorAll('.playwright-qa-alt-overlay').forEach((el) => el.remove());

      const dpr = window.devicePixelRatio || 1;

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

        // 1. Image Graphic & Resolution Metrics
        const naturalWidth = img.naturalWidth || 0;
        const naturalHeight = img.naturalHeight || 0;
        const renderedWidth = Math.round(rect.width);
        const renderedHeight = Math.round(rect.height);
        const hasExplicitDimensions = img.hasAttribute('width') && img.hasAttribute('height');
        if (!hasExplicitDimensions) {
          missingDimensionsCount++;
        }

        const currentSrc = img.currentSrc || img.src || '';

        // Density Ratio (Sharpness factor)
        const densityRatio = renderedWidth > 0 && naturalWidth > 0
          ? Math.round(((naturalWidth / renderedWidth) + Number.EPSILON) * 100) / 100
          : 1;

        // Effective DPR factor
        const effectiveDprRatio = renderedWidth > 0 && naturalWidth > 0
          ? Math.round(((naturalWidth / (renderedWidth * dpr)) + Number.EPSILON) * 100) / 100
          : 1;

        // Aspect Ratio Delta
        let aspectRatioMismatch = false;
        let aspectRatioDeltaPct = 0;
        if (naturalWidth > 0 && naturalHeight > 0 && renderedWidth > 0 && renderedHeight > 0) {
          const natAR = naturalWidth / naturalHeight;
          const renAR = renderedWidth / renderedHeight;
          aspectRatioDeltaPct = Math.round(Math.abs((natAR - renAR) / natAR) * 100);
          if (aspectRatioDeltaPct > 8) {
            aspectRatioMismatch = true;
          }
        }

        // File size & format via Performance Resource Timing
        let fileSizeBytes: number | undefined = undefined;
        let fileFormat = 'unknown';

        if (currentSrc) {
          if (currentSrc.startsWith('data:image/svg') || currentSrc.includes('.svg')) {
            fileFormat = 'svg';
          } else if (currentSrc.includes('.webp')) {
            fileFormat = 'webp';
          } else if (currentSrc.includes('.avif')) {
            fileFormat = 'avif';
          } else if (currentSrc.includes('.png')) {
            fileFormat = 'png';
          } else if (currentSrc.includes('.jpg') || currentSrc.includes('.jpeg')) {
            fileFormat = 'jpg';
          } else if (currentSrc.includes('.gif')) {
            fileFormat = 'gif';
          }

          try {
            const perfEntries = window.performance.getEntriesByName(currentSrc);
            if (perfEntries && perfEntries.length > 0) {
              const latest = perfEntries[perfEntries.length - 1] as PerformanceResourceTiming;
              const size = latest.transferSize || latest.encodedBodySize || latest.decodedBodySize;
              if (size && size > 0) {
                fileSizeBytes = size;
              }
            }
          } catch {
            // Ignore performance timing access errors
          }
        }

        // Determine Quality Status based on Enterprise Standard
        let qualityStatus: 'HD' | 'SD' | 'BLURRY' | 'OVERSIZED' | 'DISTORTED' | 'VECTOR' = 'SD';
        if (fileFormat === 'svg' || currentSrc.endsWith('.svg')) {
          qualityStatus = 'VECTOR';
        } else if (!isVisible || renderedWidth === 0 || renderedHeight === 0 || naturalWidth === 0) {
          qualityStatus = 'SD';
        } else if (aspectRatioMismatch) {
          qualityStatus = 'DISTORTED';
          distortedCount++;
        } else if (densityRatio < 1.0) {
          qualityStatus = 'BLURRY';
          blurryCount++;
        } else if (densityRatio > options.maxOversizedRatio || (fileSizeBytes && fileSizeBytes > options.maxImageSizeKb * 1024)) {
          qualityStatus = 'OVERSIZED';
          oversizedCount++;
        } else if (densityRatio >= options.minHdRatio) {
          qualityStatus = 'HD';
          retinaHdCount++;
        } else {
          qualityStatus = 'SD';
          standardResCount++;
        }

        auditData.push({
          src: currentSrc,
          alt: altValue,
          hasAlt,
          isEmptyAlt: isEmpty,
          width: renderedWidth,
          height: renderedHeight,
          naturalWidth,
          naturalHeight,
          densityRatio,
          effectiveDprRatio,
          aspectRatioMismatch,
          aspectRatioDeltaPct,
          fileSizeBytes,
          fileFormat,
          hasExplicitDimensions,
          qualityStatus,
          elementId: img.id || undefined,
          className: img.className || undefined,
        });

        // 2. Visual Outline & Dual-Pill Badge Overlay on Screenshot
        if (options.annotate && isVisible) {
          // Outline styling priority
          if (isMissing) {
            img.style.outline = '4px solid #ef4444';
            img.style.outlineOffset = '-3px';
          } else if (qualityStatus === 'BLURRY') {
            img.style.outline = '4px solid #dc2626';
            img.style.outlineOffset = '-3px';
          } else if (qualityStatus === 'DISTORTED') {
            img.style.outline = '3px solid #8b5cf6';
            img.style.outlineOffset = '-3px';
          } else if (qualityStatus === 'OVERSIZED') {
            img.style.outline = '3px dashed #f59e0b';
            img.style.outlineOffset = '-3px';
          } else if (qualityStatus === 'HD') {
            img.style.outline = '3px solid #10b981';
            img.style.outlineOffset = '-3px';
          } else if (isEmpty) {
            img.style.outline = '3px dashed #f59e0b';
            img.style.outlineOffset = '-3px';
          } else {
            img.style.outline = '2px solid #059669';
            img.style.outlineOffset = '-2px';
          }

          // Container badge overlay on top of the image
          const badge = document.createElement('div');
          badge.className = 'playwright-qa-alt-overlay';
          badge.style.position = 'absolute';
          badge.style.top = `${rect.top + window.scrollY}px`;
          badge.style.left = `${rect.left + window.scrollX}px`;
          badge.style.zIndex = '2147483647';
          badge.style.display = 'flex';
          badge.style.flexDirection = 'column';
          badge.style.gap = '3px';
          badge.style.pointerEvents = 'none';
          badge.style.fontFamily = 'Consolas, Menlo, Monaco, "Courier New", monospace';
          badge.style.fontSize = '11px';
          badge.style.fontWeight = 'bold';
          badge.style.lineHeight = '1.3';
          badge.style.boxShadow = '0 4px 10px rgba(0,0,0,0.85)';
          badge.style.maxWidth = `${Math.min(Math.max(rect.width, 320), window.innerWidth - 40)}px`;

          // Pill 1: Alt Text Accessibility Status
          const altPill = document.createElement('div');
          altPill.style.padding = '3px 7px';
          altPill.style.borderRadius = '4px';
          altPill.style.whiteSpace = 'normal';
          altPill.style.wordBreak = 'break-word';
          altPill.style.color = '#ffffff';

          if (isMissing) {
            altPill.style.backgroundColor = '#dc2626'; // Red
            altPill.style.border = '1px solid #fecaca';
            altPill.innerText = `⚠️ [ALT MISSING!]`;
          } else if (isEmpty) {
            altPill.style.backgroundColor = '#d97706'; // Amber
            altPill.style.border = '1px solid #fef3c7';
            altPill.innerText = `🟡 alt="" (Decorative / Kosong)`;
          } else {
            altPill.style.backgroundColor = 'rgba(5, 150, 105, 0.96)'; // Green
            altPill.style.border = '1px solid #a7f3d0';
            altPill.innerText = `🟢 alt: "${altValue}"`;
          }
          badge.appendChild(altPill);

          // Pill 2: Image Graphic & Quality Status (HD / Blurry / Oversized)
          if (options.checkQuality) {
            const qualityPill = document.createElement('div');
            qualityPill.style.padding = '3px 7px';
            qualityPill.style.borderRadius = '4px';
            qualityPill.style.whiteSpace = 'normal';
            qualityPill.style.wordBreak = 'break-word';
            qualityPill.style.color = '#ffffff';

            const sizeLabel = fileSizeBytes ? ` • ${formatBytes(fileSizeBytes)}` : '';
            const dimLabel = `${naturalWidth}x${naturalHeight}`;

            if (qualityStatus === 'HD') {
              qualityPill.style.backgroundColor = '#047857'; // Crisp Green
              qualityPill.style.border = '1px solid #6ee7b7';
              qualityPill.innerText = `✨ [CRISP HD ${densityRatio}x • ${dimLabel}${sizeLabel}]`;
            } else if (qualityStatus === 'BLURRY') {
              qualityPill.style.backgroundColor = '#b91c1c'; // Deep Red
              qualityPill.style.border = '1px solid #fca5a5';
              qualityPill.innerText = `🔴 [BLURRY ${densityRatio}x • Asli ${naturalWidth}px ➔ Tampil ${renderedWidth}px PECAH!]`;
            } else if (qualityStatus === 'DISTORTED') {
              qualityPill.style.backgroundColor = '#7c3aed'; // Purple
              qualityPill.style.border = '1px solid #c4b5fd';
              qualityPill.innerText = `📐 [DISTORTED • Rasio Beda ${aspectRatioDeltaPct}%]`;
            } else if (qualityStatus === 'OVERSIZED') {
              qualityPill.style.backgroundColor = '#b45309'; // Amber/Orange
              qualityPill.style.border = '1px solid #fde68a';
              qualityPill.innerText = `⚠️ [OVERSIZED ${densityRatio}x • Terlalu Besar${sizeLabel}]`;
            } else if (qualityStatus === 'VECTOR') {
              qualityPill.style.backgroundColor = '#0284c7'; // Blue
              qualityPill.style.border = '1px solid #7dd3fc';
              qualityPill.innerText = `🔷 [SVG VECTOR • Sharp]`;
            } else {
              qualityPill.style.backgroundColor = 'rgba(51, 65, 85, 0.95)'; // Slate
              qualityPill.style.border = '1px solid #94a3b8';
              qualityPill.innerText = `🟡 [SD ${densityRatio}x • ${dimLabel}${sizeLabel}]`;
            }
            badge.appendChild(qualityPill);
          }

          document.body.appendChild(badge);
        }
      });

      // 3. Top Banner Rekapitulasi di Screenshot
      if (options.annotate && imgElements.length > 0) {
        const topBar = document.createElement('div');
        topBar.className = 'playwright-qa-alt-overlay';
        topBar.style.position = 'absolute';
        topBar.style.top = '0';
        topBar.style.left = '0';
        topBar.style.right = '0';
        topBar.style.zIndex = '2147483647';
        topBar.style.backgroundColor = 'rgba(15, 23, 42, 0.97)';
        topBar.style.color = '#f8fafc';
        topBar.style.padding = '8px 16px';
        topBar.style.fontSize = '12px';
        topBar.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        topBar.style.fontWeight = '600';
        topBar.style.display = 'flex';
        topBar.style.flexWrap = 'wrap';
        topBar.style.alignItems = 'center';
        topBar.style.gap = '14px';
        topBar.style.borderBottom = '2px solid #6366f1';
        topBar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.6)';

        topBar.innerHTML = `
          <span>🖼️ <strong>Images (${imgElements.length})</strong></span>
          <span style="color: #cbd5e1;">|</span>
          <span>Alt: <strong style="color: #34d399;">${withAltCount} Ok</strong> • <strong style="color: #fbbf24;">${emptyAltCount} Empty</strong> • <strong style="color: #f87171;">${missingAltCount} Missing</strong></span>
          <span style="color: #cbd5e1;">|</span>
          <span>Graphic: <strong style="color: #34d399;">${retinaHdCount} HD</strong> • <strong style="color: #94a3b8;">${standardResCount} SD</strong> • <strong style="color: #f87171;">${blurryCount} Blurry</strong> • <strong style="color: #fbbf24;">${oversizedCount} Heavy</strong>${distortedCount > 0 ? ` • <strong style="color: #c084fc;">${distortedCount} Distorted</strong>` : ''}</span>
        `;
        document.body.appendChild(topBar);
      }

      return {
        totalImages: imgElements.length,
        withAlt: withAltCount,
        missingAlt: missingAltCount,
        emptyAlt: emptyAltCount,
        retinaHdCount,
        standardResCount,
        blurryCount,
        oversizedCount,
        distortedCount,
        missingDimensionsCount,
        images: auditData,
      };
    }, opts);
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

  private async checkSingleCta(
    context: BrowserContext,
    targetUrl: string,
    rawHref: string
  ): Promise<{
    resolvedHref: string;
    status: number;
    initialStatus: number;
    statusText: string;
    isRedirect: boolean;
    redirectUrl?: string;
    condition: string;
    is404: boolean;
    error?: string;
  }> {
    const trimmedHref = (rawHref || '').trim();
    if (
      trimmedHref.startsWith('tel:') ||
      trimmedHref.startsWith('mailto:') ||
      trimmedHref.startsWith('javascript:') ||
      trimmedHref.startsWith('#')
    ) {
      return {
        resolvedHref: rawHref,
        status: 200,
        initialStatus: 200,
        statusText: 'Action Protocol',
        isRedirect: false,
        condition: '200 success (Action Protocol)',
        is404: false,
      };
    }

    let resolved = rawHref;
    try {
      resolved = new URL(rawHref, targetUrl).toString();
    } catch {
      return {
        resolvedHref: rawHref,
        status: 0,
        initialStatus: 0,
        statusText: 'Invalid URL',
        isRedirect: false,
        condition: 'URL tidak valid',
        is404: true,
        error: 'Invalid URL format',
      };
    }

    if (this.ctaStatusCache.has(resolved)) {
      const cached = await this.ctaStatusCache.get(resolved)!;
      return { ...cached, resolvedHref: resolved };
    }

    const checkPromise = (async () => {
      try {
        let initRes;
        try {
          initRes = await context.request.fetch(resolved, {
            method: 'HEAD',
            timeout: 10000,
            maxRedirects: 0,
          });
          if (initRes.status() === 405 || initRes.status() === 501) {
            initRes = await context.request.get(resolved, { timeout: 10000, maxRedirects: 0 });
          }
        } catch {
          initRes = await context.request.get(resolved, { timeout: 10000, maxRedirects: 0 });
        }

        const initStatus = initRes.status();
        const initStatusText = initRes.statusText();

        let finalStatus = initStatus;
        let finalStatusText = initStatusText;
        let isRedirect = false;
        let redirectUrl: string | undefined = undefined;
        let condition = '';
        let is404 = false;

        const isSocialOrProtected = /instagram\.com|facebook\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|pinterest\.com/i.test(resolved);
        if (isSocialOrProtected && (initStatus === 403 || initStatus === 999)) {
          return {
            status: 200,
            initialStatus: initStatus,
            statusText: 'Protected Platform OK',
            isRedirect: false,
            condition: '200 success (Protected External Platform)',
            is404: false,
          };
        }

        if (initStatus >= 300 && initStatus < 400) {
          isRedirect = true;
          try {
            const finalRes = await context.request.get(resolved, { timeout: 10000, maxRedirects: 5 });
            finalStatus = finalRes.status();
            finalStatusText = finalRes.statusText();
            redirectUrl = finalRes.url();
            is404 = finalStatus === 404;

            if (isSocialOrProtected && (finalStatus === 403 || finalStatus === 999)) {
              condition = '200 redirection (Protected External Platform)';
              is404 = false;
            } else if (finalStatus === 200) {
              condition = '200 redirection';
            } else if (finalStatus === 404) {
              condition = '404 gagal';
            } else if (finalStatus >= 400) {
              condition = `${initStatus} redirect -> ${finalStatus} gagal`;
            } else {
              condition = `${initStatus} redirect -> ${finalStatus}`;
            }
          } catch (redErr: any) {
            condition = `${initStatus} redirect error: ${redErr.message}`;
          }
        } else if (initStatus === 200) {
          finalStatus = 200;
          condition = '200 success';
          is404 = false;
        } else if (initStatus === 404) {
          finalStatus = 404;
          condition = '404 gagal';
          is404 = true;
        } else if (initStatus >= 400) {
          finalStatus = initStatus;
          condition = `HTTP ${initStatus} gagal`;
          is404 = false;
        } else {
          finalStatus = initStatus;
          condition = `HTTP ${initStatus}`;
          is404 = false;
        }

        return {
          status: finalStatus,
          initialStatus: initStatus,
          statusText: finalStatusText,
          isRedirect,
          redirectUrl,
          condition,
          is404,
        };
      } catch (err: any) {
        return {
          status: 0,
          initialStatus: 0,
          statusText: 'Error',
          isRedirect: false,
          condition: `Gagal (${err.message})`,
          is404: false,
          error: err.message,
        };
      }
    })();

    this.ctaStatusCache.set(resolved, checkPromise);
    const result = await checkPromise;
    return { ...result, resolvedHref: resolved };
  }

  private async auditPageCTAs(page: Page, context: BrowserContext, targetUrl: string): Promise<any> {
    try {
      const rawCtas = await page.evaluate(() => {
        if (typeof (window as any).__name === 'undefined') {
          (window as any).__name = (fn: any) => fn;
        }
        const candidates = document.querySelectorAll<HTMLElement>(
          'a.btn, a.button, a[class*="btn"], a[class*="button"], a[role="button"], button, a.elementor-button, .cta a, a[class*="cta"]'
        );
        const seen = new Set<string>();
        const list: {
          text: string;
          href: string;
          type: string;
          selector: string;
          classes: string;
          rel: string;
          followStatus: 'DOFOLLOW' | 'NOFOLLOW';
        }[] = [];

        candidates.forEach((el) => {
          let href = el.getAttribute('href') || (el as HTMLAnchorElement).href || '';
          let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
          if (!text) text = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          const tagName = el.tagName.toLowerCase();
          const classes = el.className || '';
          const rel = (el.getAttribute('rel') || '').trim();
          const isNofollow = /\bnofollow\b/i.test(rel);
          const followStatus: 'DOFOLLOW' | 'NOFOLLOW' = isNofollow ? 'NOFOLLOW' : 'DOFOLLOW';

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
              selector: `${tagName}.${classes.split(' ').slice(0, 2).join('.')}`,
              classes,
              rel,
              followStatus,
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
              const rel = (a.getAttribute('rel') || '').trim();
              const isNofollow = /\bnofollow\b/i.test(rel);
              const followStatus: 'DOFOLLOW' | 'NOFOLLOW' = isNofollow ? 'NOFOLLOW' : 'DOFOLLOW';

              list.push({
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

        return list;
      });

      const ctas: any[] = [];
      let brokenCount = 0;
      let validCount = 0;
      let dofollowCount = 0;
      let nofollowCount = 0;
      let success200Count = 0;
      let redirect200Count = 0;
      let failed404Count = 0;

      // Check CTAs concurrently in chunks of 6 to maximize speed and minimize latency
      const concurrencyChunkSize = 6;
      for (let i = 0; i < rawCtas.length; i += concurrencyChunkSize) {
        const chunk = rawCtas.slice(i, i + concurrencyChunkSize);
        const resolvedChunk = await Promise.all(
          chunk.map(async (item) => {
            const check = await this.checkSingleCta(context, targetUrl, item.href);
            return { item, check };
          })
        );

        for (const { item, check } of resolvedChunk) {
          if (item.followStatus === 'NOFOLLOW') {
            nofollowCount++;
          } else {
            dofollowCount++;
          }

          if (check.is404) {
            failed404Count++;
            brokenCount++;
          } else if (check.status >= 400 || check.error) {
            brokenCount++;
          } else if (check.condition.startsWith('200 redirection') || check.isRedirect) {
            redirect200Count++;
            validCount++;
          } else if (check.status === 200) {
            success200Count++;
            validCount++;
          } else {
            validCount++;
          }

          ctas.push({
            text: item.text,
            href: check.resolvedHref,
            type: item.type,
            selector: item.selector,
            rel: item.rel,
            followStatus: item.followStatus,
            status: check.status,
            initialStatus: check.initialStatus,
            statusText: check.statusText,
            isRedirect: check.isRedirect,
            redirectUrl: check.redirectUrl,
            condition: check.condition,
            is404: check.is404,
            error: check.error,
          });
        }
      }


      return {
        totalCTAs: ctas.length,
        validCTAs: validCount,
        brokenCTAs: brokenCount,
        dofollowCTAs: dofollowCount,
        nofollowCTAs: nofollowCount,
        success200CTAs: success200Count,
        redirect200CTAs: redirect200Count,
        failed404CTAs: failed404Count,
        ctas,
      };
    } catch {
      return {
        totalCTAs: 0,
        validCTAs: 0,
        brokenCTAs: 0,
        dofollowCTAs: 0,
        nofollowCTAs: 0,
        success200CTAs: 0,
        redirect200CTAs: 0,
        failed404CTAs: 0,
        ctas: [],
      };
    }
  }

  async scanPage(targetUrl: string, workerPrefix: string = ''): Promise<PageScanResult> {
    if (!this.browser) {
      throw new Error('Browser is not initialized. Call init() first.');
    }

    const maxRetries = this.config.maxRetries ?? 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const result = await this.executeScan(targetUrl);

        const isRateLimited = result.httpStatus === 429 || result.httpStatus === 503;
        const isFatalNavError =
          !result.isSuccess &&
          result.unhandledJSErrors.some((e) =>
            e.includes('Navigation failed') && (e.includes('timeout') || e.includes('net::ERR_'))
          );

        if ((isRateLimited || isFatalNavError) && attempt <= maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000;
          const reason = isRateLimited ? `HTTP ${result.httpStatus} Rate Limited` : 'Navigation Timeout / Network Failure';
          const prefix = workerPrefix ? `${workerPrefix} ` : '';
          console.warn(
            `${prefix}⚠️  [Retry ${attempt}/${maxRetries}] ${targetUrl} terdeteksi ${reason}. Menunggu ${delayMs / 1000}s sebelum mencoba ulang...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        return result;
      } catch (err: any) {
        if (attempt <= maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000;
          const prefix = workerPrefix ? `${workerPrefix} ` : '';
          console.warn(
            `${prefix}⚠️  [Retry ${attempt}/${maxRetries}] ${targetUrl} error: ${err.message}. Menunggu ${delayMs / 1000}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          throw err;
        }
      }
    }

    throw new Error(`Max retries exceeded for ${targetUrl}`);
  }

  private async executeScan(targetUrl: string): Promise<PageScanResult> {
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

    const hasDesktop = this.config.viewports.some((v) => v.name === 'desktop');
    const hasMobile = this.config.viewports.some((v) => v.name === 'mobile');
    const primaryIsDesktop = hasDesktop || !hasMobile;

    const primaryVp = primaryIsDesktop
      ? this.config.viewports.find((v) => v.name === 'desktop') || { width: 1920, height: 1080 }
      : this.config.viewports.find((v) => v.name === 'mobile') || { width: 375, height: 844, deviceScaleFactor: 2 };

    const primaryContextOptions: any = {
      viewport: { width: primaryVp.width, height: primaryVp.height },
      userAgent: primaryIsDesktop
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 PlaywrightQABot/1.0'
        : 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1 PlaywrightQABot/1.0',
    };

    if (!primaryIsDesktop) {
      primaryContextOptions.isMobile = true;
      primaryContextOptions.hasTouch = true;
      primaryContextOptions.deviceScaleFactor = primaryVp.deviceScaleFactor || 2;
    }

    const context: BrowserContext = await this.browser.newContext(primaryContextOptions);
    const page: Page = await context.newPage();

    // Setup listeners on primary page
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

    let initialHttpStatus = 0;

    page.on('pageerror', (error) => {
      unhandledJSErrors.push(error.stack || error.message || String(error));
    });

    page.on('response', (response) => {
      const status = response.status();
      const req = response.request();
      if (req.isNavigationRequest() && !initialHttpStatus) {
        initialHttpStatus = status;
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
      retinaHdCount: 0,
      standardResCount: 0,
      blurryCount: 0,
      oversizedCount: 0,
      distortedCount: 0,
      missingDimensionsCount: 0,
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

      if (navResponse) {
        mainHttpStatus = navResponse.status();
      } else if (initialHttpStatus) {
        mainHttpStatus = initialHttpStatus;
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

      // Primary Screenshot
      if (primaryIsDesktop) {
        const desktopFilename = `${pageName}-desktop.png`;
        const desktopFilePath = path.join(this.screenshotsDir, desktopFilename);
        screenshotPaths.desktop = await this.captureSafeScreenshot(page, desktopFilePath);
      } else {
        const mobileFilename = `${pageName}-mobile.png`;
        const mobileFilePath = path.join(this.screenshotsDir, mobileFilename);
        screenshotPaths.mobile = await this.captureSafeScreenshot(page, mobileFilePath);
      }

      // Extract internal links for crawler
      discoveredLinks = await extractLinksFromPage(page, this.config.baseUrl, this.config.excludePatterns);

      // Extract key textual content for typo & grammar checking
      pageTextSnippets = await page.evaluate(() => {
        if (typeof (window as any).__name === 'undefined') {
          (window as any).__name = (fn: any) => fn;
        }
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

    // Secondary Mobile Scan & Screenshot (only if BOTH desktop and mobile are configured)
    if (hasDesktop && hasMobile && this.browser) {
      const mobileVp = this.config.viewports.find((v) => v.name === 'mobile') || {
        width: 375,
        height: 844,
        deviceScaleFactor: 2,
      };
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
