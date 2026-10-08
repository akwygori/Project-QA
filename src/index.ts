import { Command } from 'commander';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getDefaultConfig } from './config.js';
import { PageScanner } from './scanner.js';
import { QAReporter } from './reporter.js';
import { runAIAnalysis } from './ai-analyzer.js';
import { detectSitemap } from './sitemap.js';
import { CrawlConfig } from './types.js';

const program = new Command();

program
  .name('playwright-qa-crawler')
  .description('Automated Playwright QA Crawler, Visual & Functional Auditor, and AI Analyzer')
  .option('-u, --url <url>', 'Base URL website target (misal: https://example.com)')
  .option('-n, --name <name>', 'Nama website / project (misal: Limestone, Wink)')
  .option('-m, --max-pages <number>', 'Maksimal jumlah halaman yang di-crawl', (val) => parseInt(val, 10))
  .option('-d, --max-depth <number>', 'Maksimal kedalaman crawl (depth)', (val) => parseInt(val, 10))
  .option('--desktop-only', 'Hanya ambil screenshot Desktop (tanpa Mobile)')
  .option('--headful', 'Buka browser secara tampak (non-headless)')
  .option('--no-alt-overlay', 'Nonaktifkan visual badge overlay alt text pada screenshot')
  .option('--no-hd-check', 'Nonaktifkan audit mutu resolusi grafik gambar HD')
  .option('--min-hd <number>', 'Ambang batas rasio minimal HD (default: 1.9)', (val) => parseFloat(val))
  .option('--max-oversized-ratio <number>', 'Ambang batas rasio maksimal oversized (default: 3.5)', (val) => parseFloat(val))
  .option('--max-image-size <number>', 'Batas toleransi ukuran file gambar dalam KB (default: 500)', (val) => parseInt(val, 10))
  .option('-a, --analyze', 'Jalankan analisis AI otomatis menggunakan Gemini setelah crawling selesai')
  .option('-o, --output-dir <dir>', 'Custom output directory (default: output/<target-domain>)')
  .option('--urls <urls...>', 'Daftar URL spesifik untuk di-scan secara manual (tanpa crawling dinamis)')
  .option('--sitemap <url>', 'URL sitemap kustom untuk dideteksi dan di-crawl')
  .option('--sub-sitemap <name>', 'Pilih sub-sitemap tertentu berdasarkan nama/keyword (misal: page, post, local)')
  .option('--skip-sitemap', 'Lewati deteksi sitemap dan langsung gunakan crawling dinamis biasa (BFS)')
  .option('--all-sitemap', 'Otomatis crawl seluruh URL dari sitemap tanpa dibatasi maxPages')
  .option('-y, --yes', 'Otomatis konfirmasi prompt (mode non-interaktif / CI-friendly)');

program.parse(process.argv);
const options = program.opts();

async function promptUser(questionText: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(questionText)).trim();
  } catch {
    return '';
  } finally {
    rl.close();
  }
}

async function main() {
  const overrides: Partial<CrawlConfig> = {};
  if (options.url) overrides.baseUrl = options.url;
  if (options.name) overrides.siteName = options.name;
  if (options.maxPages) overrides.maxPages = options.maxPages;
  if (options.maxDepth) overrides.maxDepth = options.maxDepth;
  if (options.headful) overrides.headless = false;
  if (options.urls) overrides.customUrls = options.urls;
  if (options.altOverlay === false) overrides.annotateAlt = false;
  if (options.hdCheck === false) overrides.checkImageQuality = false;
  if (options.minHd) overrides.minHdRatio = options.minHd;
  if (options.maxOversizedRatio) overrides.maxOversizedRatio = options.maxOversizedRatio;
  if (options.maxImageSize) overrides.maxImageSizeKb = options.maxImageSize;
  if (options.outputDir) overrides.outputDir = options.outputDir;
  if (options.sitemap) overrides.sitemapUrl = options.sitemap;

  const config = getDefaultConfig(overrides);

  if (options.desktopOnly) {
    config.viewports = config.viewports.filter((v) => v.name === 'desktop');
  }

  console.log(`\n======================================================`);
  console.log(`🚀 [QA Automation] Memulai Playwright Crawler & Auditor`);
  console.log(`======================================================`);
  console.log(`🌐 Target Website : ${config.siteName} (${config.baseUrl})`);
  console.log(`📄 Max Pages      : ${config.maxPages}`);
  console.log(`🖼️ Alt Text Audit : ${config.annotateAlt ? 'Aktif (Visual Overlay pada Screenshot)' : 'Nonaktif'}`);
  console.log(`✨ Image HD Audit : ${config.checkImageQuality ? `Aktif (Min ${config.minHdRatio}x, Max Size ${config.maxImageSizeKb}KB)` : 'Nonaktif'}`);
  console.log(`📱 Viewports      : ${config.viewports.map((v) => v.name).join(', ')}`);
  console.log(`📁 Output Dir     : ${config.outputDir}`);
  console.log(`======================================================\n`);

  // Step 1: Deteksi Sitemap Otomatis & Konfirmasi Interaktif Pengguna
  if (config.customUrls && config.customUrls.length > 0) {
    config.crawlMode = 'custom-urls';
    console.log(`📌 [URL Manual] Menggunakan daftar ${config.customUrls.length} URL manual. Deteksi sitemap dilewati.\n`);
  } else if (options.skipSitemap) {
    config.crawlMode = 'bfs';
    console.log(`⏩ [--skip-sitemap] Deteksi sitemap dilewati. Menggunakan crawling dinamis HTML (BFS).\n`);
  } else {
    console.log(`🗺️  [Sitemap] Memeriksa keberadaan sitemap pada ${config.baseUrl}...`);
    const sitemapResult = await detectSitemap(config.baseUrl, config.excludePatterns, options.sitemap);

    if (sitemapResult.found && sitemapResult.urls.length > 0) {
      config.sitemapUrl = sitemapResult.sitemapUrl;
      if (sitemapResult.groups && sitemapResult.groups.length > 0) {
        config.sitemapGroups = sitemapResult.groups.map((g) => ({
          name: g.name,
          url: g.url,
          count: g.urls.length,
        }));
      }

      console.log(`\n======================================================`);
      console.log(`✅ [Sitemap Ditemukan!]`);
      console.log(`📍 Lokasi Sitemap : ${sitemapResult.sitemapUrl} (Sumber: ${sitemapResult.source})`);

      const hasMultipleGroups = !!(sitemapResult.groups && sitemapResult.groups.length > 1);

      if (hasMultipleGroups) {
        console.log(`\n📑 Sub-Sitemaps Terdeteksi (${sitemapResult.groups!.length} kelompok):`);
        sitemapResult.groups!.forEach((g, idx) => {
          console.log(`   [${idx + 1}] ${g.name} (${g.urls.length} halaman)`);
          console.log(`       ↳ URL: ${g.url}`);
        });
      } else if (sitemapResult.subSitemaps && sitemapResult.subSitemaps.length > 0) {
        console.log(`📑 Sub-sitemaps    : ${sitemapResult.subSitemaps.length} file sub-sitemap`);
      }
      console.log(`\n🔗 Total URL Valid : ${sitemapResult.urls.length} halaman terdaftar`);
      console.log(`======================================================\n`);

      // Cek apakah ada flag CLI spesifik untuk sub-sitemap
      const groupFilter = options.subSitemap;
      const matchedGroup =
        groupFilter && sitemapResult.groups
          ? sitemapResult.groups.find(
              (g, idx) =>
                g.name.toLowerCase().includes(groupFilter.toLowerCase()) ||
                g.url.toLowerCase().includes(groupFilter.toLowerCase()) ||
                String(idx + 1) === groupFilter
            )
          : undefined;

      if (matchedGroup) {
        config.selectedSubSitemap = matchedGroup.name;
        config.crawlMode = 'sitemap-group';
        if (options.allSitemap) {
          config.customUrls = matchedGroup.urls;
          config.maxPages = matchedGroup.urls.length;
          console.log(`⚡ [--sub-sitemap "${groupFilter}"] Crawling seluruh ${matchedGroup.urls.length} URL pada sub-sitemap "${matchedGroup.name}"...\n`);
        } else {
          const count = Math.min(config.maxPages, matchedGroup.urls.length);
          config.customUrls = matchedGroup.urls.slice(0, count);
          console.log(`⚡ [--sub-sitemap "${groupFilter}"] Menggunakan ${count} URL dari sub-sitemap "${matchedGroup.name}" (dibatasi maxPages: ${config.maxPages})...\n`);
        }
      } else if (options.allSitemap) {
        config.customUrls = sitemapResult.urls;
        config.maxPages = sitemapResult.urls.length;
        config.crawlMode = 'sitemap-all';
        console.log(`⚡ [--all-sitemap] Menjadwalkan crawling seluruh ${sitemapResult.urls.length} URL sitemap...\n`);
      } else if (options.yes || !process.stdin.isTTY) {
        const count = Math.min(config.maxPages, sitemapResult.urls.length);
        config.customUrls = sitemapResult.urls.slice(0, count);
        config.crawlMode = 'sitemap-partial';
        console.log(`⚡ [Auto-confirm] Menggunakan ${count} URL pertama dari sitemap (dibatasi maxPages: ${config.maxPages})...\n`);
      } else {
        console.log(`Silakan pilih mode crawling untuk QA:`);
        console.log(`  [1] Crawl SELURUH halaman dari SEMUA sub-sitemap (${sitemapResult.urls.length} halaman)`);
        console.log(`  [2] Crawl sebagian URL dari semua sub-sitemap dibatasi maxPages (${Math.min(config.maxPages, sitemapResult.urls.length)} halaman) [Rekomendasi / Default]`);
        if (hasMultipleGroups) {
          console.log(`  [3] Pilih SATU SUB-SITEMAP tertentu saja (misal: hanya ${sitemapResult.groups![0].name})`);
          console.log(`  [4] Abaikan sitemap, jalankan crawling dinamis biasa (BFS dari homepage)`);
          console.log(`  [0] Batalkan crawling\n`);
        } else {
          console.log(`  [3] Abaikan sitemap, jalankan crawling dinamis biasa (BFS dari homepage)`);
          console.log(`  [0] Batalkan crawling\n`);
        }

        const promptChoiceText = hasMultipleGroups
          ? `Pilihan Anda [1/2/3/4/0] (default: 2): `
          : `Pilihan Anda [1/2/3/0] (default: 2): `;

        const answer = await promptUser(promptChoiceText);

        if (answer === '1') {
          config.customUrls = sitemapResult.urls;
          config.maxPages = sitemapResult.urls.length;
          config.crawlMode = 'sitemap-all';
          console.log(`\n⚡ Terpilih: Crawling seluruh ${sitemapResult.urls.length} URL dari sitemap.\n`);
        } else if (hasMultipleGroups && answer === '3') {
          console.log(`\nDaftar Sub-Sitemap yang Tersedia:`);
          sitemapResult.groups!.forEach((g, idx) => {
            console.log(`  [${idx + 1}] ${g.name} (${g.urls.length} halaman)`);
          });
          console.log(``);

          const groupChoice = await promptUser(`Pilih nomor sub-sitemap [1-${sitemapResult.groups!.length}] (default: 1): `);
          const chosenIndex = parseInt(groupChoice, 10);
          const selectedGroup =
            !isNaN(chosenIndex) && chosenIndex >= 1 && chosenIndex <= sitemapResult.groups!.length
              ? sitemapResult.groups![chosenIndex - 1]
              : sitemapResult.groups![0];

          config.selectedSubSitemap = selectedGroup.name;
          config.crawlMode = 'sitemap-group';

          console.log(`\n⚡ Terpilih sub-sitemap: ${selectedGroup.name} (${selectedGroup.urls.length} halaman).`);
          console.log(`Mode pengambilan URL untuk "${selectedGroup.name}":`);
          console.log(`  [1] Crawl seluruh ${selectedGroup.urls.length} halaman pada sub-sitemap ini`);
          console.log(`  [2] Dibatasi maxPages (${Math.min(config.maxPages, selectedGroup.urls.length)} halaman) [Default]\n`);

          const scopeChoice = await promptUser(`Pilihan Anda [1/2] (default: 2): `);
          if (scopeChoice === '1') {
            config.customUrls = selectedGroup.urls;
            config.maxPages = selectedGroup.urls.length;
            console.log(`\n⚡ Menggunakan seluruh ${selectedGroup.urls.length} URL dari sub-sitemap "${selectedGroup.name}".\n`);
          } else {
            const count = Math.min(config.maxPages, selectedGroup.urls.length);
            config.customUrls = selectedGroup.urls.slice(0, count);
            console.log(`\n⚡ Menggunakan ${count} URL dari sub-sitemap "${selectedGroup.name}" (dibatasi maxPages: ${config.maxPages}).\n`);
          }
        } else if ((hasMultipleGroups && answer === '4') || (!hasMultipleGroups && answer === '3')) {
          config.customUrls = undefined;
          config.crawlMode = 'bfs';
          console.log(`\n⚡ Terpilih: Mengabaikan sitemap. Menggunakan crawling dinamis HTML (BFS).\n`);
        } else if (answer === '0' || answer.toLowerCase() === 'q') {
          console.log(`\n❌ Crawling dibatalkan oleh pengguna.`);
          process.exit(0);
        } else {
          const count = Math.min(config.maxPages, sitemapResult.urls.length);
          config.customUrls = sitemapResult.urls.slice(0, count);
          config.crawlMode = 'sitemap-partial';
          console.log(`\n⚡ Terpilih: Menggunakan ${count} URL dari sitemap (dibatasi maxPages: ${config.maxPages}).\n`);
        }
      }
    } else {
      console.log(`ℹ️  [Sitemap] Sitemap publik tidak ditemukan pada target website ini.`);
      if (!options.yes && process.stdin.isTTY) {
        const answer = await promptUser(`Lanjutkan crawling standar dengan penelusuran tautan HTML (BFS)? [Y/n]: `);
        if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
          console.log(`\n❌ Crawling dibatalkan oleh pengguna.`);
          process.exit(0);
        }
      }
      config.crawlMode = 'bfs';
      console.log(`⚡ Melanjutkan crawling dinamis biasa dari homepage (${config.baseUrl})...\n`);
    }
  }

  const scanner = new PageScanner(config);
  const reporter = new QAReporter(config);

  try {
    await scanner.init();

    const queue: { url: string; depth: number }[] = [];
    const visited = new Set<string>();

    // Initial URLs
    if (config.customUrls && config.customUrls.length > 0) {
      for (const customUrl of config.customUrls) {
        queue.push({ url: customUrl, depth: 0 });
      }
    } else {
      queue.push({ url: config.baseUrl, depth: 0 });
    }

    let scannedCount = 0;

    while (queue.length > 0 && scannedCount < config.maxPages) {
      const current = queue.shift()!;
      if (visited.has(current.url)) {
        continue;
      }

      visited.add(current.url);
      scannedCount++;

      console.log(`🔍 [${scannedCount}/${config.maxPages}] Scanning: ${current.url} (Depth: ${current.depth})`);

      const result = await scanner.scanPage(current.url);
      reporter.addResult(result);

      const errCount = result.consoleErrors.length + result.unhandledJSErrors.length + result.failedRequests.length;
      let altBadgeStr = '🟢 Alt OK';
      if (result.imageAudit) {
        if (result.imageAudit.missingAlt > 0 && result.imageAudit.emptyAlt > 0) {
          altBadgeStr = `🔴 ${result.imageAudit.missingAlt} Missing, 🟡 ${result.imageAudit.emptyAlt} Empty`;
        } else if (result.imageAudit.missingAlt > 0) {
          altBadgeStr = `🔴 ${result.imageAudit.missingAlt} Missing Alt`;
        } else if (result.imageAudit.emptyAlt > 0) {
          altBadgeStr = `🟡 ${result.imageAudit.emptyAlt} Empty Alt`;
        }
      }
      const imgInfo = result.imageAudit ? ` | 🖼️ ${result.imageAudit.totalImages} imgs (${altBadgeStr})` : '';
      const ctaInfo = result.ctaAudit
        ? ` | 🎯 ${result.ctaAudit.totalCTAs} CTAs (${result.ctaAudit.brokenCTAs > 0 ? `🔴 ${result.ctaAudit.brokenCTAs} Broken/404` : `🟢 All OK`})`
        : '';

      const hasAltWarning = result.imageAudit && (result.imageAudit.missingAlt > 0 || result.imageAudit.emptyAlt > 0);

      if (
        errCount > 0 ||
        result.httpStatus >= 400 ||
        hasAltWarning ||
        (result.ctaAudit && result.ctaAudit.brokenCTAs > 0)
      ) {
        const uncaughtStr = result.unhandledJSErrors.length > 0 ? ` | 💥 ${result.unhandledJSErrors.length} Uncaught JS` : '';
        console.log(`   ⚠️  HTTP ${result.httpStatus} | ${result.consoleErrors.length} Console Err${uncaughtStr} | ${result.failedRequests.length} Net Err${imgInfo}${ctaInfo}`);
      } else {
        console.log(`   ✅ HTTP ${result.httpStatus} | Bersih tanpa error console${imgInfo}${ctaInfo}`);
      }

      // Add newly discovered links if within depth limit
      if (!config.customUrls && current.depth < config.maxDepth) {
        for (const link of result.discoveredLinks) {
          if (!visited.has(link) && !queue.some((q) => q.url === link)) {
            queue.push({ url: link, depth: current.depth + 1 });
          }
        }
      }

      // Polite delay between pages
      if (config.delayBetweenPagesMs > 0 && queue.length > 0 && scannedCount < config.maxPages) {
        await new Promise((resolve) => setTimeout(resolve, config.delayBetweenPagesMs));
      }
    }

    await scanner.close();

    console.log(`\n💾 Menyimpan laporan QA...`);
    const reports = reporter.saveAllReports();

    console.log(`\n======================================================`);
    console.log(`✅ Crawling & Auditing Selesai!`);
    console.log(`======================================================`);
    console.log(`📊 Total Halaman Di-scan : ${scannedCount}`);
    console.log(`📸 Screenshots           : ${config.outputDir}/screenshots/`);
    console.log(`📜 Error Logs (JSON)     : ${config.outputDir}/logs/`);
    console.log(`📑 Summary Markdown      : ${reports.markdownPath}`);
    console.log(`🤖 AI Prompt Siap Pakai  : ${reports.aiPromptPath}`);
    console.log(`🌐 Visual Dashboard      : ${reports.htmlReportPath}`);
    console.log(`======================================================\n`);

    // Step 4: AI Analysis (if requested)
    if (options.analyze) {
      console.log(`🤖 Menjalankan Step 4: Analisis AI Otomatis...`);
      await runAIAnalysis(reports.jsonPath);
    } else {
      console.log(`💡 Langkah Selanjutnya (Step 4 - AI Analysis):`);
      console.log(`   Opsi A: Jalankan analisis AI otomatis:`);
      console.log(`           npm run analyze`);
      console.log(`   Opsi B: Salin prompt siap pakai dari:`);
      console.log(`           ${reports.aiPromptPath}`);
      console.log(`           lalu paste ke Claude AI / Gemini / ChatGPT bersama screenshot di:`);
      console.log(`           ${config.outputDir}/screenshots/\n`);
    }
  } catch (error) {
    console.error('❌ Terjadi kesalahan saat crawling:', error);
    await scanner.close().catch(() => {});
    process.exit(1);
  }
}

main();
