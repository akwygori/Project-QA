import { Command } from 'commander';
import { getDefaultConfig } from './config.js';
import { PageScanner } from './scanner.js';
import { QAReporter } from './reporter.js';
import { runAIAnalysis } from './ai-analyzer.js';
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
  .option('-a, --analyze', 'Jalankan analisis AI otomatis menggunakan Gemini setelah crawling selesai')
  .option('-o, --output-dir <dir>', 'Custom output directory (default: output/<target-domain>)')
  .option('--urls <urls...>', 'Daftar URL spesifik untuk di-scan secara manual (tanpa crawling dinamis)');

program.parse(process.argv);
const options = program.opts();

async function main() {
  const overrides: Partial<CrawlConfig> = {};
  if (options.url) overrides.baseUrl = options.url;
  if (options.name) overrides.siteName = options.name;
  if (options.maxPages) overrides.maxPages = options.maxPages;
  if (options.maxDepth) overrides.maxDepth = options.maxDepth;
  if (options.headful) overrides.headless = false;
  if (options.urls) overrides.customUrls = options.urls;
  if (options.altOverlay === false) overrides.annotateAlt = false;
  if (options.outputDir) overrides.outputDir = options.outputDir;

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
  console.log(`📱 Viewports      : ${config.viewports.map((v) => v.name).join(', ')}`);
  console.log(`📁 Output Dir     : ${config.outputDir}`);
  console.log(`======================================================\n`);

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
      const imgInfo = result.imageAudit
        ? ` | 🖼️ ${result.imageAudit.totalImages} imgs (${result.imageAudit.missingAlt > 0 ? `🔴 ${result.imageAudit.missingAlt} Missing Alt` : `🟢 Alt OK`})`
        : '';
      const ctaInfo = result.ctaAudit
        ? ` | 🎯 ${result.ctaAudit.totalCTAs} CTAs (${result.ctaAudit.brokenCTAs > 0 ? `🔴 ${result.ctaAudit.brokenCTAs} Broken/404` : `🟢 All OK`})`
        : '';

      if (
        errCount > 0 ||
        result.httpStatus >= 400 ||
        (result.imageAudit && result.imageAudit.missingAlt > 0) ||
        (result.ctaAudit && result.ctaAudit.brokenCTAs > 0)
      ) {
        console.log(`   ⚠️  HTTP ${result.httpStatus} | ${result.consoleErrors.length} Console Err | ${result.failedRequests.length} Net Err${imgInfo}${ctaInfo}`);
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
