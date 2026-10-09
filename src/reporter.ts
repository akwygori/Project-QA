import fs from 'fs';
import path from 'path';
import { CrawlConfig, PageScanResult, QAAuditSummary } from './types.js';

export class QAReporter {
  private config: CrawlConfig;
  private results: PageScanResult[] = [];

  constructor(config: CrawlConfig) {
    this.config = config;
  }

  addResult(result: PageScanResult): void {
    this.results.push(result);
  }

  generateSummary(): QAAuditSummary {
    const totalPages = this.results.length;
    const pagesWithErrors = this.results.filter(
      (r) =>
        r.consoleErrors.length > 0 ||
        r.unhandledJSErrors.length > 0 ||
        r.failedRequests.length > 0 ||
        r.httpStatus >= 400 ||
        (r.imageAudit && (
          r.imageAudit.missingAlt > 0 ||
          r.imageAudit.emptyAlt > 0 ||
          (r.imageAudit.blurryCount && r.imageAudit.blurryCount > 0) ||
          (r.imageAudit.distortedCount && r.imageAudit.distortedCount > 0)
        )) ||
        (r.ctaAudit && r.ctaAudit.brokenCTAs > 0)
    ).length;

    const totalConsoleErrors = this.results.reduce(
      (acc, r) => acc + r.consoleErrors.length + r.unhandledJSErrors.length,
      0
    );

    const totalNetworkErrors = this.results.reduce(
      (acc, r) => acc + r.failedRequests.length,
      0
    );

    const totalImages = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.totalImages || 0),
      0
    );

    const totalMissingAlt = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.missingAlt || 0),
      0
    );

    const totalEmptyAlt = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.emptyAlt || 0),
      0
    );

    const totalRetinaHdImages = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.retinaHdCount || 0),
      0
    );

    const totalStandardResImages = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.standardResCount || 0),
      0
    );

    const totalBlurryImages = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.blurryCount || 0),
      0
    );

    const totalOversizedImages = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.oversizedCount || 0),
      0
    );

    const totalDistortedImages = this.results.reduce(
      (acc, r) => acc + (r.imageAudit?.distortedCount || 0),
      0
    );

    const totalCTAs = this.results.reduce(
      (acc, r) => acc + (r.ctaAudit?.totalCTAs || 0),
      0
    );

    const totalBrokenCTAs = this.results.reduce(
      (acc, r) => acc + (r.ctaAudit?.brokenCTAs || 0),
      0
    );

    return {
      siteName: this.config.siteName,
      baseUrl: this.config.baseUrl,
      scannedAt: new Date().toISOString(),
      totalPages,
      pagesWithErrors,
      totalConsoleErrors,
      totalNetworkErrors,
      totalImages,
      totalMissingAlt,
      totalEmptyAlt,
      totalRetinaHdImages,
      totalStandardResImages,
      totalBlurryImages,
      totalOversizedImages,
      totalDistortedImages,
      totalCTAs,
      totalBrokenCTAs,
      sitemapFound: !!this.config.sitemapUrl,
      sitemapUrl: this.config.sitemapUrl,
      totalSitemapUrls: this.config.sitemapGroups
        ? this.config.sitemapGroups.reduce((acc, g) => acc + g.count, 0)
        : undefined,
      selectedSubSitemap: this.config.selectedSubSitemap,
      sitemapGroups: this.config.sitemapGroups,
      crawlMode: this.config.crawlMode,
      concurrency: this.config.concurrency,
      viewportMode: this.config.viewportMode,
      results: this.results,
    };
  }

  saveAllReports(durationSec?: number): {
    jsonPath: string;
    markdownPath: string;
    aiPromptPath: string;
    htmlReportPath: string;
    csvPath: string;
  } {
    const summary = this.generateSummary();
    if (durationSec !== undefined) {
      summary.durationSec = durationSec;
    }
    const outputDir = this.config.outputDir;
    fs.mkdirSync(outputDir, { recursive: true });

    // 1. summary.json
    const jsonPath = path.join(outputDir, 'summary.json');
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf-8');

    // 2. qa-summary.md
    const markdownPath = path.join(outputDir, 'qa-summary.md');
    fs.writeFileSync(markdownPath, this.generateMarkdown(summary), 'utf-8');

    // 3. ai-prompt.md (The exact prompt ready for QA Engineer / Claude / Gemini)
    const aiPromptPath = path.join(outputDir, 'ai-prompt.md');
    fs.writeFileSync(aiPromptPath, this.generateAIPrompt(summary), 'utf-8');

    // 4. index.html (Interactive Visual Dashboard)
    const htmlReportPath = path.join(outputDir, 'index.html');
    fs.writeFileSync(htmlReportPath, this.generateHtmlDashboard(summary), 'utf-8');

    // 5. issues.csv (Jira / Excel / Sheets importable format)
    const csvPath = path.join(outputDir, 'issues.csv');
    fs.writeFileSync(csvPath, this.generateIssuesCsv(summary), 'utf-8');

    return { jsonPath, markdownPath, aiPromptPath, htmlReportPath, csvPath };
  }

  private generateIssuesCsv(summary: QAAuditSummary): string {
    const rows: string[][] = [
      ['Page Name', 'Page URL', 'Issue Category', 'Severity', 'Description / Detail', 'Asset / Target URL', 'HTTP Status']
    ];

    const escapeCsv = (val: string | number | undefined) => {
      if (val === undefined || val === null) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    for (const page of summary.results) {
      // 1. Page HTTP Error
      if (page.httpStatus >= 400) {
        rows.push([
          page.pageName,
          page.url,
          'Page HTTP Error',
          'High',
          `Halaman mengembalikan status HTTP ${page.httpStatus}`,
          page.url,
          String(page.httpStatus),
        ]);
      }

      // 2. Broken CTAs
      if (page.ctaAudit && page.ctaAudit.ctas) {
        for (const cta of page.ctaAudit.ctas) {
          if (cta.is404 || (cta.status && cta.status >= 400) || cta.error) {
            rows.push([
              page.pageName,
              page.url,
              'Broken CTA / Link',
              'High',
              `Tombol/link "${cta.text}" gagal diarahkan (${cta.condition})`,
              cta.href,
              String(cta.status || 'ERR'),
            ]);
          }
        }
      }

      // 3. Image Audits
      if (page.imageAudit && page.imageAudit.images) {
        for (const img of page.imageAudit.images) {
          if (!img.hasAlt) {
            rows.push([
              page.pageName,
              page.url,
              'Missing Alt Text',
              'Medium',
              `Gambar tidak memiliki atribut alt (${img.width}x${img.height}px)`,
              img.src,
              '-',
            ]);
          }
          if (img.qualityStatus === 'BLURRY') {
            rows.push([
              page.pageName,
              page.url,
              'Blurry Image',
              'High',
              `Resolusi asli (${img.naturalWidth || 0}px) lebih kecil dari wadah tampilan (${img.width}px). Density ratio: ${img.densityRatio}x`,
              img.src,
              '-',
            ]);
          }
          if (img.qualityStatus === 'DISTORTED') {
            rows.push([
              page.pageName,
              page.url,
              'Distorted Image',
              'Medium',
              `Rasio aspek tidak proporsional (deviasi ${img.aspectRatioDeltaPct}%)`,
              img.src,
              '-',
            ]);
          }
          if (img.qualityStatus === 'OVERSIZED') {
            rows.push([
              page.pageName,
              page.url,
              'Oversized Image',
              'Low',
              `Gambar terlalu besar atau berat (${img.fileSizeBytes ? (img.fileSizeBytes / 1024).toFixed(1) + ' KB' : 'density > 3.5x'})`,
              img.src,
              '-',
            ]);
          }
        }
      }

      // 4. Console Errors & Uncaught JS
      for (const jsErr of page.unhandledJSErrors) {
        rows.push([
          page.pageName,
          page.url,
          'Uncaught JS Error',
          'High',
          jsErr.split('\n')[0].slice(0, 200),
          '-',
          '-',
        ]);
      }
      for (const conErr of page.consoleErrors) {
        rows.push([
          page.pageName,
          page.url,
          'Console Error',
          'Medium',
          conErr.text.split('\n')[0].slice(0, 200),
          conErr.location || '-',
          '-',
        ]);
      }

      // 5. Failed Network Requests
      for (const netErr of page.failedRequests) {
        rows.push([
          page.pageName,
          page.url,
          'Failed Network Request',
          'High',
          `Permintaan aset gagal: ${netErr.failureReason || netErr.statusText || 'Error'}`,
          netErr.url,
          String(netErr.status || 'ERR'),
        ]);
      }
    }

    return rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
  }

  private generateMarkdown(summary: QAAuditSummary): string {
    const lines: string[] = [
      `# 📊 QA Crawl & Audit Report: ${summary.siteName}`,
      ``,
      `- **Base URL**: \`${summary.baseUrl}\``,
      `- **Sitemap**: ${summary.sitemapUrl ? `\`${summary.sitemapUrl}\` (Mode: \`${summary.crawlMode || 'sitemap'}\`${summary.selectedSubSitemap ? ` | Sub: \`${summary.selectedSubSitemap}\`` : ''})` : '`Tidak terdeteksi / Crawl Dinamis BFS`'}`,
      ...(summary.sitemapGroups && summary.sitemapGroups.length > 1
        ? [`- **Sub-Sitemaps Terdeteksi**: ${summary.sitemapGroups.map((g) => `\`${g.name}\` (${g.count} pgs)`).join(', ')}`]
        : []),
      `- **Scanned At**: ${new Date(summary.scannedAt).toLocaleString()}`,
      `- **Execution**: \`${summary.concurrency || 1} worker paralel\` | Viewports: \`${summary.viewportMode || 'all'}\`${summary.durationSec ? ` | Durasi: \`${summary.durationSec}s\`` : ''}`,
      `- **Total Pages Scanned**: ${summary.totalPages}`,
      `- **Pages with Errors / Warnings**: ${summary.pagesWithErrors}`,
      `- **Total Console / JS Errors**: ${summary.totalConsoleErrors}`,
      `- **Total Failed Network Requests**: ${summary.totalNetworkErrors}`,
      `- **Total Images Scanned**: ${summary.totalImages}`,
      `- **Retina HD Images (🟢)**: ${summary.totalRetinaHdImages || 0}`,
      `- **Standard Res Images (🟡)**: ${summary.totalStandardResImages || 0}`,
      `- **Blurry / Upscaled Images (🔴)**: ${summary.totalBlurryImages || 0}`,
      `- **Oversized / Heavy Images (⚠️)**: ${summary.totalOversizedImages || 0}`,
      ...(summary.totalDistortedImages && summary.totalDistortedImages > 0
        ? [`- **Distorted Aspect Ratio Images (📐)**: ${summary.totalDistortedImages}`]
        : []),
      `- **Images Missing Alt Attribute (🔴)**: ${summary.totalMissingAlt}`,
      `- **Images with Empty Alt Attribute (🟡)**: ${summary.totalEmptyAlt}`,
      `- **Total CTA Buttons Tested**: ${summary.totalCTAs}`,
      `- **Broken CTA Buttons (404/Error) (🔴)**: ${summary.totalBrokenCTAs}`,
      ``,
      `---`,
      ``,
      `## 📑 Overview Table`,
      ``,
      `| Page Name | URL | HTTP Status | Image Alt Status | Image Graphic (HD/Blurry) | CTA Buttons Status | Console Errors | Network Errors (4xx/5xx) | Screenshots |`,
      `|---|---|---|---|---|---|---|---|---|`,
    ];

    for (const r of summary.results) {
      const desktopRel = r.screenshots.desktop ? path.basename(r.screenshots.desktop) : '-';
      const mobileRel = r.screenshots.mobile ? path.basename(r.screenshots.mobile) : '-';
      const statusBadge = r.httpStatus < 400 ? `✅ ${r.httpStatus}` : `❌ ${r.httpStatus}`;
      const consoleCount = r.consoleErrors.length + r.unhandledJSErrors.length;
      const netCount = r.failedRequests.length;

      let altBadge = '-';
      if (r.imageAudit) {
        if (r.imageAudit.missingAlt > 0 && r.imageAudit.emptyAlt > 0) {
          altBadge = `🔴 **${r.imageAudit.missingAlt} Missing**<br>🟡 ${r.imageAudit.emptyAlt} Empty / ${r.imageAudit.totalImages}`;
        } else if (r.imageAudit.missingAlt > 0) {
          altBadge = `🔴 **${r.imageAudit.missingAlt} Missing** / ${r.imageAudit.totalImages}`;
        } else if (r.imageAudit.emptyAlt > 0) {
          altBadge = `🟡 ${r.imageAudit.emptyAlt} Empty / ${r.imageAudit.totalImages}`;
        } else if (r.imageAudit.totalImages > 0) {
          altBadge = `🟢 All ${r.imageAudit.totalImages} Alt OK`;
        } else {
          altBadge = `0 images`;
        }
      }

      let graphicBadge = '-';
      if (r.imageAudit) {
        const hd = r.imageAudit.retinaHdCount || 0;
        const blurry = r.imageAudit.blurryCount || 0;
        const heavy = r.imageAudit.oversizedCount || 0;
        const sd = r.imageAudit.standardResCount || 0;
        const dist = r.imageAudit.distortedCount || 0;

        const parts: string[] = [];
        if (blurry > 0) parts.push(`🔴 **${blurry} Blurry**`);
        if (dist > 0) parts.push(`📐 **${dist} Distorted**`);
        if (heavy > 0) parts.push(`⚠️ ${heavy} Heavy`);
        if (hd > 0) parts.push(`🟢 ${hd} HD`);
        if (sd > 0) parts.push(`🟡 ${sd} SD`);

        graphicBadge = parts.length > 0 ? parts.join('<br>') : `${r.imageAudit.totalImages} img`;
      }

      let ctaBadge = '-';
      if (r.ctaAudit) {
        if (r.ctaAudit.brokenCTAs > 0) {
          ctaBadge = `🔴 **${r.ctaAudit.brokenCTAs} Broken** / ${r.ctaAudit.totalCTAs}`;
        } else if (r.ctaAudit.totalCTAs > 0) {
          const redir = r.ctaAudit.redirect200CTAs ? ` (🔀 ${r.ctaAudit.redirect200CTAs} redir)` : '';
          ctaBadge = `🟢 All ${r.ctaAudit.totalCTAs} CTAs OK${redir}`;
        } else {
          ctaBadge = `0 CTAs`;
        }
      }

      lines.push(
        `| **${r.pageName}** | [${r.path}](${r.url}) | ${statusBadge} | ${altBadge} | ${graphicBadge} | ${ctaBadge} | ${consoleCount > 0 ? `⚠️ ${consoleCount}` : '0'} | ${netCount > 0 ? `🛑 ${netCount}` : '0'} | Desktop: \`${desktopRel}\`<br>Mobile: \`${mobileRel}\` |`
      );
    }

    // =========================================================================
    // 🔍 Detailed Error & Audit Logs by Page
    // =========================================================================
    lines.push(``, `---`, `## 🔍 Detailed Error & Audit Logs by Page`, ``);

    if (summary.results.length === 0) {
      lines.push(`> ℹ️ Tidak ada halaman yang dipindai.`);
    } else {
      for (const r of summary.results) {
        const hasErrors =
          r.consoleErrors.length > 0 ||
          r.unhandledJSErrors.length > 0 ||
          r.failedRequests.length > 0 ||
          r.httpStatus >= 400 ||
          (r.imageAudit && (
            r.imageAudit.missingAlt > 0 ||
            r.imageAudit.emptyAlt > 0 ||
            (r.imageAudit.blurryCount && r.imageAudit.blurryCount > 0) ||
            (r.imageAudit.distortedCount && r.imageAudit.distortedCount > 0)
          )) ||
          (r.ctaAudit && r.ctaAudit.brokenCTAs > 0);

        lines.push(`### 📄 Page: \`${r.pageName}\` (${r.url})`, ``);

        if (!hasErrors) {
          lines.push(`> ✅ **Status Halaman:** Tidak ditemukan error teknis (Console/JS, Network, HTTP, Alt Image, Mutu Resolusi Gambar, ataupun Broken CTA).`, ``);
        } else {
          if (r.httpStatus >= 400) {
            lines.push(`**🚫 HTTP Error Status:** \`${r.httpStatus}\` (Halaman tidak dapat diakses / bermasalah)`);
            lines.push(``);
          }

          if (r.ctaAudit && r.ctaAudit.brokenCTAs > 0) {
            lines.push(`**🚨 Broken CTA Buttons (404 / Error) (${r.ctaAudit.brokenCTAs} buttons):**`);
            const broken = r.ctaAudit.ctas.filter((c) => c.is404 || (c.status && c.status >= 400) || c.error);
            for (const c of broken) {
              const follow = c.followStatus ? `[${c.followStatus}]` : '';
              const cond = c.condition ? `[${c.condition}]` : `[Status: ${c.status || 'ERR'}]`;
              const redir = c.redirectUrl ? ` (redirected to: \`${c.redirectUrl}\`)` : '';
              lines.push(`- Button: **"${c.text}"** ${follow} -> Target: \`${c.href}\`${redir} ${cond}`);
            }
            lines.push(``);
          }

          if (r.imageAudit && r.imageAudit.missingAlt > 0) {
            lines.push(`**🔴 Missing Image Alt Attributes (${r.imageAudit.missingAlt} images):**`);
            const missing = r.imageAudit.images.filter((img) => !img.hasAlt);
            for (const img of missing) {
              lines.push(`- \`<img>\` src: \`${img.src.slice(0, 140)}\` (${img.width}x${img.height}px) [Kritis: Atribut alt tidak ada]`);
            }
            lines.push(``);
          }

          if (r.imageAudit && r.imageAudit.emptyAlt > 0) {
            lines.push(`**🟡 Empty Image Alt Attributes (alt="") (${r.imageAudit.emptyAlt} images):**`);
            const empties = r.imageAudit.images.filter((img) => img.isEmptyAlt);
            for (const img of empties) {
              const cls = img.className ? ` [class: \`${img.className}\`]` : '';
              lines.push(`- \`<img>\` src: \`${img.src.slice(0, 140)}\` (${img.width}x${img.height}px)${cls} [Peringatan: Atribut alt kosong / empty]`);
            }
            lines.push(``);
          }

          if (r.imageAudit && r.imageAudit.blurryCount && r.imageAudit.blurryCount > 0) {
            lines.push(`**🔴 Blurry / Upscaled Images (${r.imageAudit.blurryCount} images) [Cacat Visual]:**`);
            const blurries = r.imageAudit.images.filter((img) => img.qualityStatus === 'BLURRY');
            for (const b of blurries) {
              lines.push(`- \`<img>\` src: \`${b.src.slice(0, 140)}\` (Asli: \`${b.naturalWidth || 0}px\` ➔ Tampil: \`${b.width}px\`, Kerapatan: \`${b.densityRatio}x\` < 1.0x pecah)`);
            }
            lines.push(``);
          }

          if (r.imageAudit && r.imageAudit.distortedCount && r.imageAudit.distortedCount > 0) {
            lines.push(`**📐 Distorted Aspect Ratio Images (${r.imageAudit.distortedCount} images) [Cacat Layout]:**`);
            const dists = r.imageAudit.images.filter((img) => img.qualityStatus === 'DISTORTED');
            for (const d of dists) {
              lines.push(`- \`<img>\` src: \`${d.src.slice(0, 140)}\` (Asli: ${d.naturalWidth}x${d.naturalHeight} vs Tampil: ${d.width}x${d.height}, Beda Rasio: \`${d.aspectRatioDeltaPct}%\`)`);
            }
            lines.push(``);
          }

          if (r.unhandledJSErrors.length > 0) {
            lines.push(`**💥 Unhandled JavaScript Errors:**`);
            for (const err of r.unhandledJSErrors) {
              lines.push(`- \`\`\`\n${err}\n\`\`\``);
            }
            lines.push(``);
          }

          if (r.consoleErrors.length > 0) {
            lines.push(`**⚠️ Console Errors:**`);
            for (const c of r.consoleErrors) {
              lines.push(`- \`${c.text}\` ${c.location ? `(at ${c.location})` : ''}`);
            }
            lines.push(``);
          }

          if (r.failedRequests.length > 0) {
            lines.push(`**🛑 Failed Network Requests (4xx / 5xx / Blocked):**`);
            for (const net of r.failedRequests) {
              lines.push(
                `- Status \`${net.status || 'FAILED'}\` [${net.resourceType || 'resource'}]: \`${net.url}\` ${net.failureReason ? `(${net.failureReason})` : ''}`
              );
            }
            lines.push(``);
          }
        }

        // 🖼️ Rincian Lengkap Seluruh Gambar & Audit Resolusi Grafik (Expandable Details)
        if (r.imageAudit && r.imageAudit.images && r.imageAudit.images.length > 0) {
          const hd = r.imageAudit.retinaHdCount || 0;
          const sd = r.imageAudit.standardResCount || 0;
          const blurry = r.imageAudit.blurryCount || 0;
          const heavy = r.imageAudit.oversizedCount || 0;
          const dist = r.imageAudit.distortedCount || 0;

          lines.push(
            `<details>`,
            `<summary><b>🖼️ Rincian Seluruh ${r.imageAudit.totalImages} Gambar & Audit Mutu Grafik (Enterprise)</b> (🟢 ${hd} HD | 🟡 ${sd} SD${blurry > 0 ? ` | 🔴 ${blurry} Blurry` : ''}${heavy > 0 ? ` | ⚠️ ${heavy} Heavy` : ''}${dist > 0 ? ` | 📐 ${dist} Distorted` : ''} — Klik untuk membuka tabel)</summary>`,
            ``,
            `| # | Sumber Gambar (Src) | Asli (Natural) | Tampil (CSS) | Kerapatan (Ratio) | Bobot File | Format | Status Mutu | Alt Text |`,
            `|---|---|---|---|---|---|---|---|---|`
          );

          r.imageAudit.images.forEach((img, idx) => {
            const cleanSrc = (img.src || '').slice(0, 110);
            const safeSrc = cleanSrc.replace(/\|/g, '%7C');
            const nat = img.naturalWidth && img.naturalHeight ? `${img.naturalWidth}×${img.naturalHeight}px` : '-';
            const ren = `${img.width}×${img.height}px`;
            const ratio = img.densityRatio ? `${img.densityRatio}x` : '-';
            const sizeStr = img.fileSizeBytes
              ? (img.fileSizeBytes < 1024 * 1024 ? `${(img.fileSizeBytes / 1024).toFixed(1)} KB` : `${(img.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`)
              : '-';
            const fmt = img.fileFormat || 'unknown';

            let statusBadge = '🟡 SD (1x)';
            if (img.qualityStatus === 'HD') statusBadge = '🟢 CRISP HD (Retina)';
            else if (img.qualityStatus === 'BLURRY') statusBadge = '🔴 BLURRY (Pecah)';
            else if (img.qualityStatus === 'OVERSIZED') statusBadge = '⚠️ OVERSIZED (Heavy)';
            else if (img.qualityStatus === 'DISTORTED') statusBadge = `📐 DISTORTED (${img.aspectRatioDeltaPct || 0}%)`;
            else if (img.qualityStatus === 'VECTOR') statusBadge = '🔷 SVG Vector';

            let altTxt = '🔴 *(Missing)*';
            if (img.hasAlt && !img.isEmptyAlt) {
              altTxt = `🟢 "${(img.alt || '').slice(0, 25).replace(/\|/g, '&#124;')}"`;
            } else if (img.isEmptyAlt) {
              altTxt = '🟡 *(Empty / alt="")*';
            }

            lines.push(
              `| ${idx + 1} | \`${safeSrc}\` | ${nat} | ${ren} | **${ratio}** | ${sizeStr} | \`${fmt}\` | ${statusBadge} | ${altTxt} |`
            );
          });

          lines.push(`</details>`, ``);
        }

        // 🎯 Rincian Lengkap Seluruh Tombol CTA & Target URL Tujuan (Expandable Details)
        if (r.ctaAudit && r.ctaAudit.ctas && r.ctaAudit.ctas.length > 0) {
          const redirCount = r.ctaAudit.redirect200CTAs || 0;
          const brokenCount = r.ctaAudit.brokenCTAs || 0;
          const validCount = r.ctaAudit.validCTAs || 0;
          const redirBadge = redirCount > 0 ? ` | 🔀 ${redirCount} Redirection` : '';
          const brokenBadge = brokenCount > 0 ? ` | 🔴 ${brokenCount} Broken` : '';

          lines.push(
            `<details>`,
            `<summary><b>🎯 Rincian Seluruh ${r.ctaAudit.totalCTAs} Tombol CTA & Target URL Tujuan</b> (🟢 ${validCount} Valid${redirBadge}${brokenBadge} — Klik untuk membuka tabel)</summary>`,
            ``,
            `| # | Teks Tombol / CTA | Target Destination URL | Status / Kondisi | SEO Follow | Tipe Elemen |`,
            `|---|---|---|---|---|---|`
          );

          r.ctaAudit.ctas.forEach((cta, idx) => {
            const cleanText = (cta.text || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '&#124;').trim() || '*(Tanpa Teks / Icon)*';

            let destUrlMd = '';
            const isActionProtocol =
              !cta.href ||
              cta.href === '#' ||
              cta.href.startsWith('javascript:') ||
              cta.href.startsWith('tel:') ||
              cta.href.startsWith('mailto:');

            if (isActionProtocol) {
              destUrlMd = `\`${cta.href || '(empty)'}\``;
            } else {
              const safeHref = cta.href.replace(/\|/g, '%7C');
              destUrlMd = `[${safeHref}](${safeHref})`;
            }

            if (cta.redirectUrl && cta.redirectUrl !== cta.href) {
              const safeRedir = cta.redirectUrl.replace(/\|/g, '%7C');
              const redirCode = cta.initialStatus || 301;
              destUrlMd += `<br>↳ 🔀 *${redirCode} redir ke:* [${safeRedir}](${safeRedir})`;
            }

            let stBadge = '🟢 200 OK';
            if (cta.is404 || (cta.condition && cta.condition.includes('404'))) {
              stBadge = '🔴 404 Broken';
            } else if ((cta.status && cta.status >= 400) || cta.error) {
              stBadge = `🔴 ${cta.status || 'ERR'} Gagal`;
            } else if (cta.condition === '200 redirection' || cta.isRedirect) {
              stBadge = '🔀 200 Redirection';
            } else if (cta.condition && cta.condition.includes('Action Protocol')) {
              stBadge = '🟢 200 (Action Protocol)';
            } else if (cta.condition) {
              stBadge = `🟢 ${cta.condition.replace(/\|/g, '&#124;')}`;
            }

            const followBadge = cta.followStatus === 'NOFOLLOW' ? '🟡 NOFOLLOW' : '🟢 DOFOLLOW';
            const elType = `\`<${cta.type || 'a'}>\``;

            lines.push(
              `| ${idx + 1} | **${cleanText}** | ${destUrlMd} | ${stBadge} | ${followBadge} | ${elType} |`
            );
          });

          lines.push(`</details>`, ``);
        }
      }
    }

    // =========================================================================
    // 📌 Catatan Khusus & Action Items (Notes Khusus di Bagian Bawah)
    // =========================================================================
    lines.push(``, `---`, `## 📌 Catatan Khusus & Rekomendasi QA (Action Items)`, ``);

    const httpErrorPages = summary.results.filter((r) => r.httpStatus >= 400);
    const hasAnyIssue =
      httpErrorPages.length > 0 ||
      summary.totalBrokenCTAs > 0 ||
      summary.totalMissingAlt > 0 ||
      summary.totalEmptyAlt > 0 ||
      (summary.totalBlurryImages && summary.totalBlurryImages > 0) ||
      (summary.totalOversizedImages && summary.totalOversizedImages > 0) ||
      (summary.totalDistortedImages && summary.totalDistortedImages > 0) ||
      summary.totalConsoleErrors > 0 ||
      summary.totalNetworkErrors > 0 ||
      summary.pagesWithErrors > 0;

    if (!hasAnyIssue) {
      lines.push(`> ✅ **Status Website Sempurna:** Seluruh halaman yang di-scan bersih tanpa error konsol, broken link (404), halaman mati (4xx/5xx), aset hilang, maupun masalah resolusi gambar.`);
    } else {
      let noteIndex = 1;

      if (httpErrorPages.length > 0) {
        lines.push(`### 🚫 ${noteIndex++}. Halaman Error / Tidak Ditemukan (HTTP 4xx / 5xx)`);
        lines.push(`Ditemukan **${httpErrorPages.length} halaman** yang tidak dapat diakses atau mengembalikan status error:`);
        for (const p of httpErrorPages) {
          lines.push(`- Halaman **${p.pageName}** (\`${p.url}\`) -> Status HTTP: \`${p.httpStatus}\``);
        }
        lines.push(``);
      }

      if (summary.totalBrokenCTAs > 0) {
        lines.push(`### 🚨 ${noteIndex++}. Tombol CTA / Tautan Rusak (Broken Link 404 / Error)`);
        lines.push(`Ditemukan **${summary.totalBrokenCTAs} tombol/link rusak** yang mengarah ke halaman mati (404/Error). Segera perbaiki URL tujuan tombol berikut:`);
        for (const r of summary.results) {
          if (r.ctaAudit && r.ctaAudit.brokenCTAs > 0) {
            const broken = r.ctaAudit.ctas.filter((c) => c.is404 || (c.status && c.status >= 400) || c.error);
            for (const b of broken) {
              const redir = b.redirectUrl ? ` (redirect ke: \`${b.redirectUrl}\`)` : '';
              lines.push(`- Halaman **${r.pageName}** (\`${r.url}\`): Button **"${b.text}"** -> target: \`${b.href}\`${redir} [Status: ${b.status || 'ERR'}]`);
            }
          }
        }
        lines.push(``);
      }

      if (summary.totalBlurryImages && summary.totalBlurryImages > 0) {
        lines.push(`### 🔴 ${noteIndex++}. Gambar Pecah / Buram (Blurry / Upscaled Images - Urgent Visual Fix)`);
        lines.push(`Ditemukan **${summary.totalBlurryImages} gambar** yang resolusi aslinya lebih kecil daripada ukuran tampilannya di layar ($R_d < 1.0\\times$). Gambar mengalami interpolasi paksa sehingga terlihat buram/pecah bagi pengguna:`);
        for (const r of summary.results) {
          if (r.imageAudit && r.imageAudit.blurryCount && r.imageAudit.blurryCount > 0) {
            const blurries = r.imageAudit.images.filter((img) => img.qualityStatus === 'BLURRY');
            for (const b of blurries) {
              lines.push(`- Halaman **${r.pageName}**: \`${b.src.slice(0, 140)}\` (Asli: \`${b.naturalWidth || 0}px\` ➔ Tampil: \`${b.width}px\`, Kerapatan: \`${b.densityRatio}x\`)`);
            }
          }
        }
        lines.push(``);
      }

      if (summary.totalDistortedImages && summary.totalDistortedImages > 0) {
        lines.push(`### 📐 ${noteIndex++}. Gambar Terdistorsi / Gepeng (Aspect Ratio Mismatch)`);
        lines.push(`Ditemukan **${summary.totalDistortedImages} gambar** dengan rasio aspek asli yang tidak sesuai dengan dimensi CSS tampilan (deviasi rasio $> 8\\%$). Gambar terlihat peyot/gepeng:`);
        for (const r of summary.results) {
          if (r.imageAudit && r.imageAudit.distortedCount && r.imageAudit.distortedCount > 0) {
            const dists = r.imageAudit.images.filter((img) => img.qualityStatus === 'DISTORTED');
            for (const d of dists) {
              lines.push(`- Halaman **${r.pageName}**: \`${d.src.slice(0, 140)}\` (Asli: ${d.naturalWidth}x${d.naturalHeight} vs Tampil: ${d.width}x${d.height}, Beda: \`${d.aspectRatioDeltaPct}%\`)`);
            }
          }
        }
        lines.push(``);
      }

      if (summary.totalOversizedImages && summary.totalOversizedImages > 0) {
        lines.push(`### ⚠️ ${noteIndex++}. Aset Gambar Terlalu Berat / Oversized (Lighthouse Performance Optimization)`);
        lines.push(`Ditemukan **${summary.totalOversizedImages} gambar** yang resolusinya berlebih ($> 3.5\\times$ dari yang dibutuhkan) atau berbobot file besar ($> 500\\text{ KB}$). Pertimbangkan kompresi ke WebP/AVIF untuk mempercepat PageSpeed & Core Web Vitals (LCP):`);
        for (const r of summary.results) {
          if (r.imageAudit && r.imageAudit.oversizedCount && r.imageAudit.oversizedCount > 0) {
            const heavies = r.imageAudit.images.filter((img) => img.qualityStatus === 'OVERSIZED');
            for (const h of heavies) {
              const sz = h.fileSizeBytes ? ` [${(h.fileSizeBytes / 1024).toFixed(1)} KB]` : '';
              lines.push(`- Halaman **${r.pageName}**: \`${h.src.slice(0, 140)}\` (Asli: ${h.naturalWidth}x${h.naturalHeight} vs Tampil: ${h.width}x${h.height}, Rasio: \`${h.densityRatio}x\`)${sz}`);
            }
          }
        }
        lines.push(``);
      }

      if (summary.totalNetworkErrors > 0) {
        lines.push(`### 🛑 ${noteIndex++}. Aset / Permintaan Jaringan yang Gagal (Asset Hilang / 404 / 5xx)`);
        lines.push(`Ditemukan **${summary.totalNetworkErrors} aset/file yang tidak terdapat atau gagal dimuat** pada website:`);
        for (const r of summary.results) {
          if (r.failedRequests.length > 0) {
            lines.push(`- Halaman **${r.pageName}** (\`${r.url}\`):`);
            r.failedRequests.forEach((req) => lines.push(`  * [Status ${req.status || 'ERR'}] Tipe \`${req.resourceType || 'aset'}\`: \`${req.url.slice(0, 140)}\``));
          }
        }
        lines.push(``);
      }

      if (summary.totalMissingAlt > 0) {
        lines.push(`### 🔴 ${noteIndex++}. Gambar Tanpa Atribut Alt (Missing Alt Attributes)`);
        lines.push(`Ditemukan **${summary.totalMissingAlt} gambar** yang sama sekali tidak memiliki atribut \`alt\` (tidak terdapat pada tag gambar). Hal ini menurunkan skor aksesibilitas (WCAG) dan SEO gambar:`);
        for (const r of summary.results) {
          if (r.imageAudit && r.imageAudit.missingAlt > 0) {
            const missing = r.imageAudit.images.filter((img) => !img.hasAlt);
            for (const m of missing) {
              lines.push(`- Halaman **${r.pageName}**: \`${m.src.slice(0, 140)}\` (${m.width}x${m.height}px)`);
            }
          }
        }
        lines.push(``);
      }

      if (summary.totalEmptyAlt > 0) {
        lines.push(`### 🟡 ${noteIndex++}. Gambar dengan Atribut Alt Kosong (alt="")`);
        lines.push(`Ditemukan **${summary.totalEmptyAlt} gambar** dengan atribut \`alt=""\` (teks deskripsi tidak terdapat / kosong). Harap periksa apakah gambar ini murni elemen dekoratif latar belakang, atau gambar banner/konten penting yang tertinggal teks deskripsinya:`);
        for (const r of summary.results) {
          if (r.imageAudit && r.imageAudit.emptyAlt > 0) {
            const empties = r.imageAudit.images.filter((img) => img.isEmptyAlt);
            for (const e of empties) {
              const cls = e.className ? ` [class: \`${e.className}\`]` : '';
              lines.push(`- Halaman **${r.pageName}**: \`${e.src.slice(0, 140)}\` (${e.width}x${e.height}px)${cls}`);
            }
          }
        }
        lines.push(``);
      }

      if (summary.totalConsoleErrors > 0) {
        lines.push(`### ⚠️ ${noteIndex++}. Error JavaScript / Console Terdeteksi`);
        lines.push(`Ditemukan **${summary.totalConsoleErrors} pesan error** pada console browser saat halaman dirender:`);
        for (const r of summary.results) {
          const allErr = [...r.unhandledJSErrors, ...r.consoleErrors.map((c) => c.text)];
          if (allErr.length > 0) {
            lines.push(`- Halaman **${r.pageName}** (\`${r.url}\`):`);
            allErr.slice(0, 5).forEach((err) => lines.push(`  * \`${err.split('\n')[0].slice(0, 150)}\``));
          }
        }
        lines.push(``);
      }
    }

    return lines.join('\n');
  }

  generateAIPrompt(summary: QAAuditSummary, singlePage?: PageScanResult): string {
    const relScreenshots = path.relative(process.cwd(), path.join(this.config.outputDir, 'screenshots')).replace(/\\/g, '/');
    const lines: string[] = [
      `# 🤖 Standard QA Visual & Functional Prompt for AI (Claude / Gemini / ChatGPT)`,
      ``,
      `> Salin seluruh teks di bawah ini ke AI chat (Claude / Gemini / ChatGPT) dan sertakan screenshot dari folder \`${relScreenshots}/\`.`,
      ``,
      `---`,
      ``,
      `Kamu adalah seorang QA Engineer berpengalaman. Saya telah mengunggah screenshot dan log console dari hasil crawling otomatis halaman web **${summary.siteName}** (${summary.baseUrl}).`,
      `*Catatan Visual: Pada screenshot yang diunggah, telah ditambahkan badge visual overlay ganda pada setiap gambar:*`,
      `- **Pill Atas (Accessibility & SEO)**:`,
      `  - 🔴 **Badge Merah [ALT MISSING!]**: Gambar sama sekali tidak memiliki atribut \`alt\` (isu Accessibility & SEO).`,
      `  - 🟡 **Badge Kuning [alt=""]**: Atribut alt kosong / dekoratif.`,
      `  - 🟢 **Badge Hijau [alt="..."]**: Atribut alt terisi dengan teks lengkap yang tercantum.`,
      `- **Pill Bawah (Grafik & Resolusi HD Standar Enterprise)**:`,
      `  - 🟢 **Badge Hijau [CRISP HD]**: Resolusi gambar tajam memenuhi standar Retina Display modern (≥ 1.9x).`,
      `  - 🔴 **Badge Merah [BLURRY]**: Resolusi file asli lebih kecil daripada kotak tampilannya di layar (< 1.0x, gambar pecah/buram).`,
      `  - 📐 **Badge Ungu [DISTORTED]**: Aspek rasio gambar asli tidak seimbang dengan tampilan CSS (gepeng/melar).`,
      `  - ⚠️ **Badge Oranye [OVERSIZED]**: Resolusi atau ukuran file berlebih (> 3.5x atau > 500 KB, memboroskan kuota).`,
      `  - 🔷 **Badge Biru [SVG VECTOR]**: Format vektor tak terbatas resolusi.`,
      ``,
      `Tolong lakukan analisis QA dan berikan laporan ringkas dengan fokus pada:`,
      `1. **Visual & Layout Breakdown**: Adakah teks yang bertumpuk (overlapping), gambar yang pecah/crop tidak wajar, spasi berlebih, atau elemen yang keluar dari container?`,
      `2. **Mobile/Desktop Responsiveness**: Apakah proporsi elemen sudah rapi pada viewport Desktop (1920x1080) dan Mobile (375x844)?`,
      `3. **CTA Buttons & Functional Links**: Periksa apakah seluruh tombol CTA mengarah ke halaman yang valid dan tidak ada broken link (404 Not Found).`,
      `4. **Image Alt Text & Accessibility**: Periksa badge visual overlay pada gambar di screenshot dan log terlampir. Sebutkan gambar yang tidak memiliki atribut alt atau alt-nya kurang relevan.`,
      `5. **Console/Network Error (dari log terlampir)**: Sebutkan error penting seperti script gagal loading, broken link (404), atau server error (500).`,
      `6. **Typo & English Grammar Check**: Periksa dengan teliti teks/konten dalam bahasa Inggris pada halaman.`,
      `   - **PENTING**: Jangan mengubah teks apa pun, **HANYA DICATAT SAJA**!`,
      `   - Format catatan typo: *"Typo pada [section/kalimat]: '[kata salah]' -> seharusnya '[kata benar]' (hanya dicatat, tidak diganti)"*`,
      ``,
      `Sajikan hasil audit dalam 2 bagian:`,
      `1. **Tabel Ringkasan Temuan per Halaman**:`,
      `| URL / Page Name | Issue / Bug Found | Severity (Low / Medium / High) | Rekomendasi Perbaikan |`,
      `|---|---|---|---|`,
      ``,
      `*Catatan: Jika halaman terlihat normal tanpa kendala dan tanpa typo, cukup nyatakan 'PASS' pada kolom Issue / Bug Found.*`,
      ``,
      `2. **📌 Notes Khusus & Action Items (di bagian paling bawah)**:`,
      `Kumpulkan semua hal yang error atau tidak terdapat pada website ke dalam catatan khusus di bawah tabel:`,
      `- Daftar halaman error / mati (404/500)`,
      `- Daftar tombol CTA / link rusak (broken 404)`,
      `- Daftar gambar dengan atribut alt hilang atau alt kosong`,
      `- Daftar aset / file yang gagal dimuat (404/network error)`,
      `- Daftar console error JavaScript`,
      `- Daftar catatan typo bahasa Inggris (hanya dicatat, jangan diubah)`,
      ``,
      `---`,
      `### DATA LOG & AUDIT HASIL CRAWLING:`,
      ``,
    ];

    const targetList = singlePage ? [singlePage] : summary.results;

    for (const r of targetList) {
      lines.push(`#### [Halaman: ${r.pageName}] - URL: ${r.url}`);
      lines.push(`- HTTP Status: ${r.httpStatus}`);
      lines.push(`- File Screenshot: Desktop: \`${path.basename(r.screenshots.desktop || '')}\`, Mobile: \`${path.basename(r.screenshots.mobile || '')}\``);

      if (r.ctaAudit) {
        const redirCount = r.ctaAudit.redirect200CTAs || 0;
        const redirInfo = redirCount > 0 ? `, ${redirCount} Redirection` : '';
        lines.push(`- CTA Buttons Audit: Total ${r.ctaAudit.totalCTAs} CTA buttons (${r.ctaAudit.validCTAs} Valid${redirInfo}, ${r.ctaAudit.brokenCTAs} BROKEN/404)`);
        if (r.ctaAudit.brokenCTAs > 0) {
          const broken = r.ctaAudit.ctas.filter((c) => c.is404 || (c.status && c.status >= 400) || c.error);
          for (const b of broken) {
            lines.push(`    * 🚨 BROKEN CTA: "${b.text}" -> ${b.href} [Status ${b.status || 'ERR'}]`);
          }
        }
      }

      if (r.imageAudit) {
        lines.push(`- Image Alt Audit: Total ${r.imageAudit.totalImages} gambar (${r.imageAudit.withAlt} ada alt, ${r.imageAudit.emptyAlt} alt kosong, ${r.imageAudit.missingAlt} ALT HILANG)`);
        lines.push(`  Daftar Lengkap Gambar & Alt Text:`);
        for (const img of r.imageAudit.images) {
          if (!img.hasAlt) {
            lines.push(`    * 🔴 MISSING ALT: ${img.src}`);
          } else if (img.isEmptyAlt) {
            lines.push(`    * 🟡 ALT KOSONG (""): ${img.src}`);
          } else {
            lines.push(`    * 🟢 ALT LENGKAP: "${img.alt}" | Src: ${img.src}`);
          }
        }
      }

      const totalErrors = r.consoleErrors.length + r.unhandledJSErrors.length + r.failedRequests.length;
      if (totalErrors === 0) {
        lines.push(`- Console/Network Log: Tidak ditemukan Console Error atau Broken Network Request.`);
      } else {
        if (r.unhandledJSErrors.length > 0) {
          lines.push(`- Uncaught JS Errors:`);
          for (const err of r.unhandledJSErrors) {
            lines.push(`    * ${err.split('\n')[0]}`);
          }
        }
        if (r.consoleErrors.length > 0) {
          lines.push(`- Console Errors:`);
          for (const c of r.consoleErrors) {
            lines.push(`    * ${c.text}`);
          }
        }
        if (r.failedRequests.length > 0) {
          lines.push(`- Failed Requests (4xx / 5xx / Network Failure):`);
          for (const req of r.failedRequests) {
            lines.push(`    * [${req.status || 'ERR'}] ${req.url}`);
          }
        }
        if (r.pageTextSnippets && r.pageTextSnippets.length > 0) {
          lines.push(`- Cuplikan Konten Teks Halaman (periksa typo bahasa Inggris di sini):`);
          for (const snip of r.pageTextSnippets.slice(0, 30)) {
            lines.push(`    * "${snip}"`);
          }
        }
      }
      lines.push(``);
    }

    return lines.join('\n');
  }

  private generateHtmlDashboard(summary: QAAuditSummary): string {
    const resultsJson = JSON.stringify(summary.results);

    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QA Crawl & Visual Dashboard - ${summary.siteName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 30, 46, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.15);
      --warning: #f59e0b;
      --warning-bg: rgba(245, 158, 11, 0.15);
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: radial-gradient(circle at 50% 0%, #171f38 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem 1.5rem;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.5rem;
      margin-bottom: 2.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
    }
    .brand h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; }
    .brand h1 span { background: linear-gradient(135deg, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .brand p { color: var(--text-muted); margin-top: 0.25rem; font-size: 0.95rem; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2.5rem;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 1.25rem 1.5rem;
      backdrop-filter: blur(12px);
    }
    .metric-title { font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .metric-value { font-size: 2rem; font-weight: 800; margin-top: 0.5rem; }
    .val-danger { color: var(--danger); }
    .val-warning { color: var(--warning); }
    .val-success { color: var(--success); }

    .controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .filter-group { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .btn {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.6rem 1.1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover, .btn.active {
      background: var(--accent);
      border-color: var(--accent);
      box-shadow: 0 0 15px var(--accent-glow);
    }
    .search-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: #fff;
      padding: 0.6rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.9rem;
      min-width: 280px;
    }
    .pages-list { display: flex; flex-direction: column; gap: 1.5rem; }
    .page-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      transition: border-color 0.2s;
    }
    .page-card.has-error { border-color: rgba(239, 68, 68, 0.4); }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .page-info h3 { font-size: 1.25rem; font-weight: 700; }
    .page-url { color: #818cf8; font-size: 0.875rem; text-decoration: none; word-break: break-all; }
    .page-url:hover { text-decoration: underline; }
    .badges { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .badge {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .badge-success { background: var(--success-bg); color: var(--success); }
    .badge-danger { background: var(--danger-bg); color: var(--danger); }
    .badge-warning { background: var(--warning-bg); color: var(--warning); }

    .page-body {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 1.5rem;
      margin-top: 1rem;
    }
    @media (max-width: 1024px) {
      .page-body { grid-template-columns: 1fr; }
    }
    .screenshots-preview {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }
    .shot-box {
      flex: 1;
      background: #000;
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      overflow: hidden;
      cursor: pointer;
      position: relative;
    }
    .shot-box span {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
      background: rgba(0,0,0,0.75);
      padding: 0.2rem 0.5rem;
      font-size: 0.75rem;
      border-radius: 0.35rem;
      font-weight: 600;
      z-index: 10;
    }
    .shot-box img {
      width: 100%;
      height: 280px;
      object-fit: cover;
      object-position: top;
      display: block;
      transition: transform 0.3s;
    }
    .shot-box:hover img { transform: scale(1.02); }
    .shot-box.mobile-shot { max-width: 140px; }

    .logs-panel {
      background: rgba(10, 14, 23, 0.8);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      max-height: 310px;
      overflow-y: auto;
    }
    .log-item {
      padding: 0.35rem 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      word-break: break-all;
    }
    .log-err { color: #f87171; }
    .log-warn { color: #fbbf24; }
    .log-net { color: #f472b6; }
    .log-clean { color: #34d399; }

    .breakdown-details {
      margin-top: 1rem;
      border-top: 1px solid var(--card-border);
      padding-top: 0.75rem;
    }
    .breakdown-details summary {
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      color: #cbd5e1;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0.5rem;
      font-size: 0.78rem;
    }
    .data-table th, .data-table td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      text-align: left;
    }
    .data-table th { color: var(--text-muted); }

    /* Modal */
    .modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.88);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      backdrop-filter: blur(8px);
    }
    .modal.open { display: flex; }
    .modal-content {
      max-width: 90vw;
      max-height: 90vh;
      overflow: auto;
      border-radius: 0.75rem;
      background: #111;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .modal-content img { display: block; max-width: 100%; height: auto; }
    .modal-close {
      position: absolute;
      top: 1.5rem;
      right: 1.5rem;
      color: #fff;
      font-size: 2rem;
      background: none;
      border: none;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1><span>QA AutoAudit</span> Dashboard</h1>
        <p>Target: <strong>${summary.siteName}</strong> &bull; Scanned at ${new Date(summary.scannedAt).toLocaleString()}${summary.sitemapUrl ? ` &bull; 🗺️ Sitemap: <a href="${summary.sitemapUrl}" target="_blank" style="color: #818cf8; text-decoration: underline;">${summary.sitemapUrl}</a> (${summary.crawlMode || 'sitemap'})` : ''} &bull; ⚡ <strong>${summary.concurrency || 1} Workers</strong> &bull; 📱 Viewport: <strong>${summary.viewportMode || 'all'}</strong>${summary.durationSec ? ` &bull; ⏱️ <strong>${summary.durationSec}s</strong>` : ''}</p>
      </div>
      <div>
        <a href="ai-prompt.md" target="_blank" class="btn">📋 View AI Prompt Bundle</a>
      </div>
    </header>

    <div class="metrics">
      <div class="metric-card">
        <div class="metric-title">Total Pages Scanned</div>
        <div class="metric-value">${summary.totalPages}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Pages With Issues</div>
        <div class="metric-value ${summary.pagesWithErrors > 0 ? 'val-danger' : 'val-success'}">${summary.pagesWithErrors}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">CTA Buttons (🎯)</div>
        <div class="metric-value ${summary.totalBrokenCTAs > 0 ? 'val-danger' : 'val-success'}">${summary.totalCTAs} (${summary.totalBrokenCTAs} Broken)</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Retina HD Images (✨)</div>
        <div class="metric-value val-success">${summary.totalRetinaHdImages || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Blurry / Pecah (🔴)</div>
        <div class="metric-value ${(summary.totalBlurryImages || 0) > 0 ? 'val-danger' : 'val-success'}">${summary.totalBlurryImages || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Missing Alt Text (⚠️)</div>
        <div class="metric-value ${summary.totalMissingAlt > 0 ? 'val-danger' : 'val-success'}">${summary.totalMissingAlt}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Console / JS Errors</div>
        <div class="metric-value ${summary.totalConsoleErrors > 0 ? 'val-warning' : 'val-success'}">${summary.totalConsoleErrors}</div>
      </div>
    </div>

    <div class="controls">
      <div class="filter-group">
        <button class="btn active" onclick="setFilter('all')">All Pages (${summary.totalPages})</button>
        <button class="btn" onclick="setFilter('blurry')">Blurry Imgs (${summary.results.filter((r) => r.imageAudit && r.imageAudit.blurryCount && r.imageAudit.blurryCount > 0).length})</button>
        <button class="btn" onclick="setFilter('broken-cta')">Broken CTAs (${summary.results.filter((r) => r.ctaAudit && r.ctaAudit.brokenCTAs > 0).length})</button>
        <button class="btn" onclick="setFilter('alt-issues')">Alt Issues (${summary.results.filter((r) => r.imageAudit && (r.imageAudit.missingAlt > 0 || r.imageAudit.emptyAlt > 0)).length})</button>
        <button class="btn" onclick="setFilter('error')">With Issues (${summary.pagesWithErrors})</button>
        <button class="btn" onclick="setFilter('clean')">Clean (${summary.totalPages - summary.pagesWithErrors})</button>
      </div>
      <input type="text" id="searchInput" class="search-box" placeholder="Filter by URL or Page Name..." oninput="handleSearch()">
    </div>

    <div class="pages-list" id="pagesList"></div>
  </div>

  <div class="modal" id="imgModal" onclick="closeModal()">
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <div class="modal-content" onclick="event.stopPropagation()">
      <img id="modalImg" src="" alt="Screenshot Full View">
    </div>
  </div>

  <script>
    const pages = ${resultsJson};
    let currentFilter = 'all';
    let searchQuery = '';

    function renderPages() {
      const container = document.getElementById('pagesList');
      const filtered = pages.filter(p => {
        const hasBrokenCta = p.ctaAudit && p.ctaAudit.brokenCTAs > 0;
        const hasMissingAlt = p.imageAudit && p.imageAudit.missingAlt > 0;
        const hasEmptyAlt = p.imageAudit && p.imageAudit.emptyAlt > 0;
        const hasAltIssue = hasMissingAlt || hasEmptyAlt;
        const hasBlurry = p.imageAudit && (p.imageAudit.blurryCount || 0) > 0;
        const hasDistorted = p.imageAudit && (p.imageAudit.distortedCount || 0) > 0;
        const hasQualityIssue = hasBlurry || hasDistorted;
        const hasErr = p.consoleErrors.length > 0 || p.unhandledJSErrors.length > 0 || p.failedRequests.length > 0 || p.httpStatus >= 400 || hasAltIssue || hasBrokenCta || hasQualityIssue;

        if (currentFilter === 'blurry' && !hasBlurry) return false;
        if (currentFilter === 'broken-cta' && !hasBrokenCta) return false;
        if ((currentFilter === 'alt-issues' || currentFilter === 'missing-alt') && !hasAltIssue) return false;
        if (currentFilter === 'error' && !hasErr) return false;
        if (currentFilter === 'clean' && hasErr) return false;

        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return p.url.toLowerCase().includes(q) || p.pageName.toLowerCase().includes(q) || p.title.toLowerCase().includes(q);
        }
        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 3rem; color: #64748b;">No pages found matching filter.</div>';
        return;
      }

      container.innerHTML = filtered.map(p => {
        const hasBrokenCta = p.ctaAudit && p.ctaAudit.brokenCTAs > 0;
        const hasMissingAlt = p.imageAudit && p.imageAudit.missingAlt > 0;
        const hasEmptyAlt = p.imageAudit && p.imageAudit.emptyAlt > 0;
        const hasAltIssue = hasMissingAlt || hasEmptyAlt;
        const hasBlurry = p.imageAudit && (p.imageAudit.blurryCount || 0) > 0;
        const hasDistorted = p.imageAudit && (p.imageAudit.distortedCount || 0) > 0;
        const hasQualityIssue = hasBlurry || hasDistorted;
        const hasErr = p.consoleErrors.length > 0 || p.unhandledJSErrors.length > 0 || p.failedRequests.length > 0 || p.httpStatus >= 400 || hasAltIssue || hasBrokenCta || hasQualityIssue;
        const desktopImg = p.screenshots.desktop ? 'screenshots/' + p.screenshots.desktop.split(/[/\\\\]/).pop() : '';
        const mobileImg = p.screenshots.mobile ? 'screenshots/' + p.screenshots.mobile.split(/[/\\\\]/).pop() : '';

        let logsHtml = '';
        if (p.httpStatus >= 400) {
          logsHtml += '<div class="log-item log-err">🚫 HTTP ' + p.httpStatus + ' Error</div>';
        }
        if (p.ctaAudit) {
          logsHtml += '<div class="log-item ' + (hasBrokenCta ? 'log-err' : 'log-clean') + '">🎯 CTA Buttons: ' + p.ctaAudit.totalCTAs + ' total (' + p.ctaAudit.validCTAs + ' valid, ' + p.ctaAudit.brokenCTAs + ' broken/404)</div>';
        }
        if (p.imageAudit) {
          const imgLogClass = hasMissingAlt ? 'log-err' : hasEmptyAlt ? 'log-warn' : 'log-clean';
          logsHtml += '<div class="log-item ' + imgLogClass + '">🖼️ Images Alt: ' + p.imageAudit.totalImages + ' total (' + p.imageAudit.withAlt + ' alt, ' + p.imageAudit.missingAlt + ' missing, ' + p.imageAudit.emptyAlt + ' empty)</div>';
          if (hasBlurry) {
            logsHtml += '<div class="log-item log-err">🔴 Image Graphic: ' + p.imageAudit.blurryCount + ' gambar buram/pecah (Kerapatan &lt; 1.0x)!</div>';
          }
          if (hasDistorted) {
            logsHtml += '<div class="log-item log-warn">📐 Image Graphic: ' + p.imageAudit.distortedCount + ' gambar terdistorsi (Rasio beda &gt; 8%)!</div>';
          }
          if (!hasBlurry && !hasDistorted && (p.imageAudit.retinaHdCount || 0) > 0) {
            logsHtml += '<div class="log-item log-clean">✨ Image Graphic: ' + p.imageAudit.retinaHdCount + ' gambar Crisp HD (Retina-ready)</div>';
          }
        }
        if (p.unhandledJSErrors.length) {
          logsHtml += p.unhandledJSErrors.map(e => '<div class="log-item log-err">💥 ' + escapeHtml(e) + '</div>').join('');
        }
        if (p.consoleErrors.length) {
          logsHtml += p.consoleErrors.map(c => '<div class="log-item log-err">⚠️ [Console] ' + escapeHtml(c.text) + '</div>').join('');
        }
        if (p.failedRequests.length) {
          logsHtml += p.failedRequests.map(r => '<div class="log-item log-net">🛑 [' + (r.status || 'ERR') + '] ' + escapeHtml(r.url) + '</div>').join('');
        }
        if (!p.unhandledJSErrors.length && !p.consoleErrors.length && !p.failedRequests.length && !hasBrokenCta && !hasAltIssue && !hasQualityIssue && p.httpStatus < 400) {
          logsHtml += '<div class="log-item log-clean">✅ No errors or warnings detected.</div>';
        }

        let ctaTable = '';
        if (p.ctaAudit && p.ctaAudit.ctas && p.ctaAudit.ctas.length) {
          ctaTable = \`
            <details class="breakdown-details">
              <summary>🎯 Inspect All \${p.ctaAudit.totalCTAs} CTA Buttons (\${p.ctaAudit.brokenCTAs} Broken/404 | \${p.ctaAudit.dofollowCTAs || 0} Dofollow, \${p.ctaAudit.nofollowCTAs || 0} Nofollow)</summary>
              <table class="data-table">
                <thead>
                  <tr><th>Condition / Status</th><th>SEO Follow</th><th>Button Text</th><th>Target Destination URL</th><th>Type</th></tr>
                </thead>
                <tbody>
                  \${p.ctaAudit.ctas.map(cta => {
                    let st = '<span style="color:#10b981;">🟢 200 success</span>';
                    if (cta.condition === '200 redirection' || cta.isRedirect) {
                      st = '<span style="color:#38bdf8; font-weight:600;">🔀 200 redirection</span>';
                    } else if (cta.is404 || (cta.condition && cta.condition.indexOf('404') !== -1)) {
                      st = '<span style="color:#ef4444; font-weight:bold;">🔴 404 gagal</span>';
                    } else if (cta.status && cta.status >= 400) {
                      st = '<span style="color:#ef4444; font-weight:bold;">🛑 ' + cta.status + ' gagal</span>';
                    } else if (cta.error) {
                      st = '<span style="color:#ef4444;">❌ ' + escapeHtml(cta.error) + '</span>';
                    } else if (cta.condition) {
                      st = '<span>' + escapeHtml(cta.condition) + '</span>';
                    }

                    const followBadge = cta.followStatus === 'NOFOLLOW'
                      ? '<span style="background:rgba(245,158,11,0.18); color:#fbbf24; padding:2px 7px; border-radius:4px; font-size:0.75rem; font-weight:bold;">NOFOLLOW</span>'
                      : '<span style="background:rgba(16,185,129,0.18); color:#34d399; padding:2px 7px; border-radius:4px; font-size:0.75rem; font-weight:bold;">DOFOLLOW</span>';

                    let destUrl = '<a href="' + escapeHtml(cta.href) + '" target="_blank" style="color:#818cf8;">' + escapeHtml(cta.href) + '</a>';
                    if (cta.redirectUrl && cta.redirectUrl !== cta.href) {
                      destUrl += '<br><span style="font-size:0.72rem; color:#94a3b8;">↳ 🔀 <em>' + (cta.initialStatus || 301) + ' redir to:</em> <a href="' + escapeHtml(cta.redirectUrl) + '" target="_blank" style="color:#38bdf8;">' + escapeHtml(cta.redirectUrl) + '</a></span>';
                    }

                    return '<tr>' +
                      '<td>' + st + '</td>' +
                      '<td>' + followBadge + '</td>' +
                      '<td><strong>' + escapeHtml(cta.text) + '</strong></td>' +
                      '<td style="max-width:320px; overflow:hidden; text-overflow:ellipsis;">' + destUrl + '</td>' +
                      '<td>' + escapeHtml(cta.type) + '</td>' +
                    '</tr>';
                  }).join('')}
                </tbody>
              </table>
            </details>
          \`;
        }

        let imagesTable = '';
        if (p.imageAudit && p.imageAudit.images && p.imageAudit.images.length) {
          const hd = p.imageAudit.retinaHdCount || 0;
          const blurry = p.imageAudit.blurryCount || 0;
          const heavy = p.imageAudit.oversizedCount || 0;
          imagesTable = \`
            <details class="breakdown-details">
              <summary>🖼️ Inspect All \\\${p.imageAudit.totalImages} Images & Graphic Quality (✨ \\\${hd} HD | 🟡 \\\${p.imageAudit.standardResCount || 0} SD\\\${blurry > 0 ? ' | 🔴 ' + blurry + ' Blurry' : ''}\\\${heavy > 0 ? ' | ⚠️ ' + heavy + ' Heavy' : ''})</summary>
              <table class="data-table">
                <thead>
                  <tr><th>Graphic Status</th><th>Density</th><th>Natural</th><th>Rendered</th><th>Size</th><th>Format</th><th>Image Source</th><th>Alt Text</th></tr>
                </thead>
                <tbody>
                  \\\${p.imageAudit.images.map(img => {
                    let st = '<span style="color:#10b981;font-weight:600;">🟢 HD</span>';
                    if (img.qualityStatus === 'BLURRY') st = '<span style="color:#ef4444;font-weight:bold;">🔴 BLURRY</span>';
                    else if (img.qualityStatus === 'OVERSIZED') st = '<span style="color:#f59e0b;font-weight:600;">⚠️ OVERSIZED</span>';
                    else if (img.qualityStatus === 'DISTORTED') st = '<span style="color:#a855f7;font-weight:600;">📐 DISTORTED</span>';
                    else if (img.qualityStatus === 'VECTOR') st = '<span style="color:#0ea5e9;">🔷 SVG</span>';
                    else if (img.qualityStatus === 'SD') st = '<span style="color:#94a3b8;">🟡 SD</span>';

                    const sz = img.fileSizeBytes
                      ? (img.fileSizeBytes < 1024 * 1024 ? (img.fileSizeBytes / 1024).toFixed(1) + ' KB' : (img.fileSizeBytes / (1024 * 1024)).toFixed(2) + ' MB')
                      : '-';

                    let altStr = '<span style="color:#ef4444;">🔴 Missing</span>';
                    if (img.hasAlt && !img.isEmptyAlt) {
                      altStr = '<span style="color:#34d399;">🟢 ' + escapeHtml(img.alt || '') + '</span>';
                    } else if (img.isEmptyAlt) {
                      altStr = '<span style="color:#fbbf24;">🟡 alt=""</span>';
                    }

                    return \\\`<tr>
                      <td>\\\${st}</td>
                      <td><strong>\\\${img.densityRatio ? img.densityRatio + 'x' : '-'}</strong></td>
                      <td>\\\${img.naturalWidth ? img.naturalWidth + '×' + img.naturalHeight : '-'}</td>
                      <td>\\\${img.width}x\\\${img.height}</td>
                      <td>\\\${sz}</td>
                      <td><code>\\\${img.fileFormat || 'img'}</code></td>
                      <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><a href="\\\${escapeHtml(img.src)}" target="_blank" style="color:#818cf8;">\\\${escapeHtml(img.src)}</a></td>
                      <td>\\\${altStr}</td>
                    </tr>\\\`;
                  }).join('')}
                </tbody>
              </table>
            </details>
          \`;
        }

        return \`
          <div class="page-card \\\${hasErr ? 'has-error' : ''}">
            <div class="page-header">
              <div class="page-info">
                <h3>\\\${escapeHtml(p.pageName)}</h3>
                <a href="\\\${p.url}" target="_blank" class="page-url">\\\${escapeHtml(p.url)}</a>
              </div>
              <div class="badges">
                <span class="badge \\\${p.httpStatus < 400 ? 'badge-success' : 'badge-danger'}">HTTP \\\${p.httpStatus}</span>
                \\\${p.ctaAudit ? \\\`<span class="badge \\\${hasBrokenCta ? 'badge-danger' : 'badge-success'}">🎯 \\\${p.ctaAudit.totalCTAs} CTAs (\\\${p.ctaAudit.brokenCTAs} Broken)</span>\\\` : ''}
                \\\${hasBlurry ? \\\`<span class="badge badge-danger">🔴 \\\${p.imageAudit.blurryCount} Blurry Imgs</span>\\\` : ''}
                \\\${hasDistorted ? \\\`<span class="badge badge-warning">📐 \\\${p.imageAudit.distortedCount} Distorted</span>\\\` : ''}
                \\\${p.imageAudit && (p.imageAudit.retinaHdCount || 0) > 0 ? \\\`<span class="badge badge-success">✨ \\\${p.imageAudit.retinaHdCount} HD</span>\\\` : ''}
                \\\${p.imageAudit ? \\\`<span class="badge \\\${hasMissingAlt ? 'badge-danger' : hasEmptyAlt ? 'badge-warning' : 'badge-success'}">🖼️ \\\${p.imageAudit.totalImages} Imgs (\\\${p.imageAudit.missingAlt > 0 ? \\\`\\\${p.imageAudit.missingAlt} Missing Alt\\\` : 'Alt OK'})</span>\\\` : ''}
                \\\${p.consoleErrors.length ? \\\`<span class="badge badge-warning">\\\${p.consoleErrors.length} Console Err</span>\\\` : ''}
                \\\${p.unhandledJSErrors.length ? \\\`<span class="badge badge-danger">\\\${p.unhandledJSErrors.length} Uncaught JS</span>\\\` : ''}
                \\\${p.failedRequests.length ? \\\`<span class="badge badge-danger">\\\${p.failedRequests.length} Broken Req</span>\\\` : ''}
                \\\${!hasErr ? '<span class="badge badge-success">CLEAN</span>' : ''}
              </div>
            </div>

            <div class="page-body">
              <div class="screenshots-preview">
                \${desktopImg ? \`
                  <div class="shot-box" onclick="openModal('\${desktopImg}')">
                    <span>Desktop (Alt Overlay Active)</span>
                    <img src="\${desktopImg}" alt="Desktop view" loading="lazy">
                  </div>
                \` : ''}
                \${mobileImg ? \`
                  <div class="shot-box mobile-shot" onclick="openModal('\${mobileImg}')">
                    <span>Mobile</span>
                    <img src="\${mobileImg}" alt="Mobile view" loading="lazy">
                  </div>
                \` : ''}
              </div>

              <div class="logs-panel">
                <div style="font-weight: 700; margin-bottom: 0.5rem; color: #cbd5e1;">Audit & Console Logs:</div>
                \${logsHtml}
              </div>
            </div>

            \${ctaTable}
            \${imagesTable}
          </div>
        \`;
      }).join('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filter-group .btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      renderPages();
    }

    function handleSearch() {
      searchQuery = document.getElementById('searchInput').value;
      renderPages();
    }

    function openModal(imgSrc) {
      document.getElementById('modalImg').src = imgSrc;
      document.getElementById('imgModal').classList.add('open');
    }

    function closeModal() {
      document.getElementById('imgModal').classList.remove('open');
    }

    renderPages();
  </script>
</body>
</html>`;
  }
}
