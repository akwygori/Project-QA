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
        (r.imageAudit && r.imageAudit.missingAlt > 0) ||
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
      totalCTAs,
      totalBrokenCTAs,
      results: this.results,
    };
  }

  saveAllReports(): {
    jsonPath: string;
    markdownPath: string;
    aiPromptPath: string;
    htmlReportPath: string;
  } {
    const summary = this.generateSummary();
    const outputDir = this.config.outputDir;

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

    return { jsonPath, markdownPath, aiPromptPath, htmlReportPath };
  }

  private generateMarkdown(summary: QAAuditSummary): string {
    const lines: string[] = [
      `# 📊 QA Crawl & Audit Report: ${summary.siteName}`,
      ``,
      `- **Base URL**: \`${summary.baseUrl}\``,
      `- **Scanned At**: ${new Date(summary.scannedAt).toLocaleString()}`,
      `- **Total Pages Scanned**: ${summary.totalPages}`,
      `- **Pages with Errors / Warnings**: ${summary.pagesWithErrors}`,
      `- **Total Console / JS Errors**: ${summary.totalConsoleErrors}`,
      `- **Total Failed Network Requests**: ${summary.totalNetworkErrors}`,
      `- **Total Images Scanned**: ${summary.totalImages}`,
      `- **Images Missing Alt Attribute (🔴)**: ${summary.totalMissingAlt}`,
      `- **Total CTA Buttons Tested**: ${summary.totalCTAs}`,
      `- **Broken CTA Buttons (404/Error) (🔴)**: ${summary.totalBrokenCTAs}`,
      ``,
      `---`,
      ``,
      `## 📑 Overview Table`,
      ``,
      `| Page Name | URL | HTTP Status | Image Alt Status | CTA Buttons Status | Console Errors | Network Errors (4xx/5xx) | Screenshots |`,
      `|---|---|---|---|---|---|---|---|`,
    ];

    for (const r of summary.results) {
      const desktopRel = r.screenshots.desktop ? path.basename(r.screenshots.desktop) : '-';
      const mobileRel = r.screenshots.mobile ? path.basename(r.screenshots.mobile) : '-';
      const statusBadge = r.httpStatus < 400 ? `✅ ${r.httpStatus}` : `❌ ${r.httpStatus}`;
      const consoleCount = r.consoleErrors.length + r.unhandledJSErrors.length;
      const netCount = r.failedRequests.length;

      let altBadge = '-';
      if (r.imageAudit) {
        if (r.imageAudit.missingAlt > 0) {
          altBadge = `🔴 **${r.imageAudit.missingAlt} Missing** / ${r.imageAudit.totalImages}`;
        } else if (r.imageAudit.emptyAlt > 0) {
          altBadge = `🟡 ${r.imageAudit.emptyAlt} Empty / ${r.imageAudit.totalImages}`;
        } else if (r.imageAudit.totalImages > 0) {
          altBadge = `🟢 All ${r.imageAudit.totalImages} Alt OK`;
        } else {
          altBadge = `0 images`;
        }
      }

      let ctaBadge = '-';
      if (r.ctaAudit) {
        if (r.ctaAudit.brokenCTAs > 0) {
          altBadge = `🔴 **${r.ctaAudit.brokenCTAs} Broken (404)** / ${r.ctaAudit.totalCTAs}`;
        } else if (r.ctaAudit.totalCTAs > 0) {
          ctaBadge = `🟢 All ${r.ctaAudit.totalCTAs} CTAs OK`;
        } else {
          ctaBadge = `0 CTAs`;
        }
      }

      lines.push(
        `| **${r.pageName}** | [${r.path}](${r.url}) | ${statusBadge} | ${altBadge} | ${ctaBadge} | ${consoleCount > 0 ? `⚠️ ${consoleCount}` : '0'} | ${netCount > 0 ? `🛑 ${netCount}` : '0'} | Desktop: \`${desktopRel}\`<br>Mobile: \`${mobileRel}\` |`
      );
    }

    lines.push(``, `---`, `## 🔍 Detailed Error & Audit Logs by Page`, ``);

    for (const r of summary.results) {
      const hasErrors =
        r.consoleErrors.length > 0 ||
        r.unhandledJSErrors.length > 0 ||
        r.failedRequests.length > 0 ||
        r.httpStatus >= 400 ||
        (r.imageAudit && r.imageAudit.missingAlt > 0) ||
        (r.ctaAudit && r.ctaAudit.brokenCTAs > 0);

      if (!hasErrors) continue;

      lines.push(`### 📄 Page: \`${r.pageName}\` (${r.url})`, ``);

      if (r.ctaAudit && r.ctaAudit.brokenCTAs > 0) {
        lines.push(`**🚨 Broken CTA Buttons (404 / Error) (${r.ctaAudit.brokenCTAs} buttons):**`);
        const broken = r.ctaAudit.ctas.filter((c) => c.is404 || (c.status && c.status >= 400) || c.error);
        for (const c of broken) {
          lines.push(`- Button: **"${c.text}"** -> Target: \`${c.href}\` [Status: ${c.status || 'ERR'}]`);
        }
        lines.push(``);
      }

      if (r.imageAudit && r.imageAudit.missingAlt > 0) {
        lines.push(`**🔴 Missing Image Alt Attributes (${r.imageAudit.missingAlt} images):**`);
        const missing = r.imageAudit.images.filter((img) => !img.hasAlt);
        for (const img of missing) {
          lines.push(`- \`<img>\` src: \`${img.src.slice(0, 120)}\` (${img.width}x${img.height}px)`);
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
      `*Catatan Visual: Pada screenshot yang diunggah, telah ditambahkan badge visual overlay:*`,
      `- 🔴 **Badge Merah [ALT MISSING!]**: Gambar sama sekali tidak memiliki atribut \`alt\` (isu Accessibility & SEO).`,
      `- 🟡 **Badge Kuning [alt=""]**: Atribut alt kosong / dekoratif.`,
      `- 🟢 **Badge Hijau [alt="..."]**: Atribut alt terisi dengan teks lengkap yang tercantum.`,
      ``,
      `Tolong lakukan analisis QA dan berikan laporan ringkas dengan fokus pada:`,
      `1. **Visual & Layout Breakdown**: Adakah teks yang bertumpuk (overlapping), gambar yang pecah/crop tidak wajar, spasi berlebih, atau elemen yang keluar dari container?`,
      `2. **Mobile/Desktop Responsiveness**: Apakah proporsi elemen sudah rapi pada viewport Desktop (1920x1080) dan Mobile (390x844)?`,
      `3. **CTA Buttons & Functional Links**: Periksa apakah seluruh tombol CTA mengarah ke halaman yang valid dan tidak ada broken link (404 Not Found).`,
      `4. **Image Alt Text & Accessibility**: Periksa badge visual overlay pada gambar di screenshot dan log terlampir. Sebutkan gambar yang tidak memiliki atribut alt atau alt-nya kurang relevan.`,
      `5. **Console/Network Error (dari log terlampir)**: Sebutkan error penting seperti script gagal loading, broken link (404), atau server error (500).`,
      `6. **Typo & English Grammar Check**: Periksa dengan teliti teks/konten dalam bahasa Inggris pada halaman.`,
      `   - **PENTING**: Jangan mengubah teks apa pun, **HANYA DICATAT SAJA**!`,
      `   - Format catatan typo: *"Typo pada [section/kalimat]: '[kata salah]' -> seharusnya '[kata benar]' (hanya dicatat, tidak diganti)"*`,
      ``,
      `Sajikan hasil audit dalam format tabel sederhana:`,
      `| URL / Page Name | Issue / Bug Found | Severity (Low / Medium / High) | Rekomendasi Perbaikan |`,
      `|---|---|---|---|`,
      ``,
      `*Catatan: Jika halaman terlihat normal tanpa kendala dan tanpa typo, cukup nyatakan 'PASS' pada kolom Issue / Bug Found.*`,
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
        lines.push(`- CTA Buttons Audit: Total ${r.ctaAudit.totalCTAs} CTA buttons (${r.ctaAudit.validCTAs} Valid, ${r.ctaAudit.brokenCTAs} BROKEN/404)`);
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
        <p>Target: <strong>${summary.siteName}</strong> &bull; Scanned at ${new Date(summary.scannedAt).toLocaleString()}</p>
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
        <div class="metric-title">Missing Alt Text (🔴)</div>
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
        <button class="btn" onclick="setFilter('broken-cta')">Broken CTAs (${summary.results.filter((r) => r.ctaAudit && r.ctaAudit.brokenCTAs > 0).length})</button>
        <button class="btn" onclick="setFilter('missing-alt')">Missing Alt (${summary.results.filter((r) => r.imageAudit && r.imageAudit.missingAlt > 0).length})</button>
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
        const hasErr = p.consoleErrors.length > 0 || p.unhandledJSErrors.length > 0 || p.failedRequests.length > 0 || p.httpStatus >= 400 || hasMissingAlt || hasBrokenCta;

        if (currentFilter === 'broken-cta' && !hasBrokenCta) return false;
        if (currentFilter === 'missing-alt' && !hasMissingAlt) return false;
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
        const hasErr = p.consoleErrors.length > 0 || p.unhandledJSErrors.length > 0 || p.failedRequests.length > 0 || p.httpStatus >= 400 || hasMissingAlt || hasBrokenCta;
        const desktopImg = p.screenshots.desktop ? 'screenshots/' + p.screenshots.desktop.split(/[/\\\\]/).pop() : '';
        const mobileImg = p.screenshots.mobile ? 'screenshots/' + p.screenshots.mobile.split(/[/\\\\]/).pop() : '';

        let logsHtml = '';
        if (p.ctaAudit) {
          logsHtml += '<div class="log-item ' + (hasBrokenCta ? 'log-err' : 'log-clean') + '">🎯 CTA Buttons: ' + p.ctaAudit.totalCTAs + ' total (' + p.ctaAudit.validCTAs + ' valid, ' + p.ctaAudit.brokenCTAs + ' broken/404)</div>';
        }
        if (p.imageAudit) {
          logsHtml += '<div class="log-item ' + (hasMissingAlt ? 'log-err' : 'log-clean') + '">🖼️ Images: ' + p.imageAudit.totalImages + ' total (' + p.imageAudit.withAlt + ' alt, ' + p.imageAudit.missingAlt + ' missing, ' + p.imageAudit.emptyAlt + ' empty)</div>';
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
        if (!p.unhandledJSErrors.length && !p.consoleErrors.length && !p.failedRequests.length && !hasBrokenCta) {
          logsHtml += '<div class="log-item log-clean">✅ No JS or network errors detected.</div>';
        }

        let ctaTable = '';
        if (p.ctaAudit && p.ctaAudit.ctas && p.ctaAudit.ctas.length) {
          ctaTable = \`
            <details class="breakdown-details">
              <summary>🎯 Inspect All \${p.ctaAudit.totalCTAs} CTA Buttons (\${p.ctaAudit.brokenCTAs} Broken/404)</summary>
              <table class="data-table">
                <thead>
                  <tr><th>Status</th><th>Button Text</th><th>Target Destination URL</th><th>Type</th></tr>
                </thead>
                <tbody>
                  \${p.ctaAudit.ctas.map(cta => {
                    let st = '<span style="color:#10b981;">🟢 ' + (cta.status || '200') + ' OK</span>';
                    if (cta.is404) st = '<span style="color:#ef4444; font-weight:bold;">🔴 404 NOT FOUND</span>';
                    else if (cta.status && cta.status >= 400) st = '<span style="color:#ef4444; font-weight:bold;">🛑 ' + cta.status + ' ERR</span>';
                    else if (cta.error) st = '<span style="color:#ef4444;">❌ ' + escapeHtml(cta.error) + '</span>';
                    return \`<tr>
                      <td>\${st}</td>
                      <td><strong>\${escapeHtml(cta.text)}</strong></td>
                      <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><a href="\${escapeHtml(cta.href)}" target="_blank" style="color:#818cf8;">\${escapeHtml(cta.href)}</a></td>
                      <td>\${escapeHtml(cta.type)}</td>
                    </tr>\`;
                  }).join('')}
                </tbody>
              </table>
            </details>
          \`;
        }

        let imagesTable = '';
        if (p.imageAudit && p.imageAudit.images && p.imageAudit.images.length) {
          imagesTable = \`
            <details class="breakdown-details">
              <summary>🖼️ Inspect All \${p.imageAudit.totalImages} Images Alt Text (\${p.imageAudit.missingAlt} Missing)</summary>
              <table class="data-table">
                <thead>
                  <tr><th>Status</th><th>Alt Attribute Value</th><th>Image Source</th><th>Size</th></tr>
                </thead>
                <tbody>
                  \${p.imageAudit.images.map(img => {
                    let st = '<span style="color:#10b981;">🟢 OK</span>';
                    if (!img.hasAlt) st = '<span style="color:#ef4444; font-weight:bold;">🔴 MISSING</span>';
                    else if (img.isEmptyAlt) st = '<span style="color:#f59e0b;">🟡 EMPTY</span>';
                    return \`<tr>
                      <td>\${st}</td>
                      <td>\${img.alt !== null ? escapeHtml(img.alt) : '<em>(None)</em>'}</td>
                      <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><a href="\${escapeHtml(img.src)}" target="_blank" style="color:#818cf8;">\${escapeHtml(img.src)}</a></td>
                      <td>\${img.width}x\${img.height}</td>
                    </tr>\`;
                  }).join('')}
                </tbody>
              </table>
            </details>
          \`;
        }

        return \`
          <div class="page-card \${hasErr ? 'has-error' : ''}">
            <div class="page-header">
              <div class="page-info">
                <h3>\${escapeHtml(p.pageName)}</h3>
                <a href="\${p.url}" target="_blank" class="page-url">\${escapeHtml(p.url)}</a>
              </div>
              <div class="badges">
                <span class="badge \${p.httpStatus < 400 ? 'badge-success' : 'badge-danger'}">HTTP \${p.httpStatus}</span>
                \${p.ctaAudit ? \`<span class="badge \${hasBrokenCta ? 'badge-danger' : 'badge-success'}">🎯 \${p.ctaAudit.totalCTAs} CTAs (\${p.ctaAudit.brokenCTAs} Broken)</span>\` : ''}
                \${p.imageAudit ? \`<span class="badge \${hasMissingAlt ? 'badge-danger' : 'badge-success'}">🖼️ \${p.imageAudit.totalImages} Imgs (\${p.imageAudit.missingAlt} Missing Alt)</span>\` : ''}
                \${p.consoleErrors.length ? \`<span class="badge badge-warning">\${p.consoleErrors.length} Console Err</span>\` : ''}
                \${p.unhandledJSErrors.length ? \`<span class="badge badge-danger">\${p.unhandledJSErrors.length} Uncaught JS</span>\` : ''}
                \${p.failedRequests.length ? \`<span class="badge badge-danger">\${p.failedRequests.length} Broken Req</span>\` : ''}
                \${!hasErr ? '<span class="badge badge-success">CLEAN</span>' : ''}
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
