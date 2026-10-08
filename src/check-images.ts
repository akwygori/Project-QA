import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { ImageQualityAuditItem } from './types.js';

dotenv.config();

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

async function checkImages() {
  const urlIdx = process.argv.findIndex((a) => a === '-u' || a === '--url' || a === '-t' || a === '--target');
  const targetArg = urlIdx !== -1 && process.argv[urlIdx + 1] ? process.argv[urlIdx + 1] : process.argv.slice(2).find((a) => !a.startsWith('-'));
  const rawUrl = targetArg || process.env.TARGET_URL || 'https://example.com';
  const targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  const minHdArg = process.argv.findIndex((a) => a === '--min-hd');
  const minHdRatio = minHdArg !== -1 && process.argv[minHdArg + 1] ? parseFloat(process.argv[minHdArg + 1]) : parseFloat(process.env.IMAGE_MIN_HD_RATIO || '1.9');

  const maxOverArg = process.argv.findIndex((a) => a === '--max-oversized' || a === '--max-oversized-ratio');
  const maxOversizedRatio = maxOverArg !== -1 && process.argv[maxOverArg + 1] ? parseFloat(process.argv[maxOverArg + 1]) : parseFloat(process.env.IMAGE_MAX_OVERSIZED_RATIO || '3.5');

  const maxSizeArg = process.argv.findIndex((a) => a === '--max-image-size' || a === '--max-size');
  const maxImageSizeKb = maxSizeArg !== -1 && process.argv[maxSizeArg + 1] ? parseInt(process.argv[maxSizeArg + 1], 10) : parseInt(process.env.IMAGE_MAX_SIZE_KB || '500', 10);

  console.log(`\n======================================================`);
  console.log(`🔍 [Image Quality & HD Auditor] Standar Enterprise`);
  console.log(`🌐 Target URL        : ${targetUrl}`);
  console.log(`📐 Ambang Batas HD   : Min ${minHdRatio}x (Retina-ready)`);
  console.log(`⚠️ Ambang Oversized  : Max ${maxOversizedRatio}x atau > ${maxImageSizeKb} KB`);
  console.log(`======================================================\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 PlaywrightQABot/1.0',
  });
  const page = await context.newPage();

  try {
    console.log(`⏳ Membuka halaman dan mengevaluasi seluruh gambar...`);
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
    } catch {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    await page.waitForTimeout(1500);

    // Auto-scroll to trigger lazy-loaded assets
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 350);
          total += 350;
          if (total >= document.body.scrollHeight || total > 12000) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            setTimeout(resolve, 300);
          }
        }, 100);
      });
    });

    const auditResults = await page.evaluate((options) => {
      // Polyfill esbuild __name helper if injected into browser context
      if (typeof (window as any).__name === 'undefined') {
        (window as any).__name = (fn: any) => fn;
      }

      const imgElements = Array.from(document.querySelectorAll('img'));
      const dpr = window.devicePixelRatio || 1;

      const items: any[] = [];
      let withAltCount = 0;
      let missingAltCount = 0;
      let emptyAltCount = 0;

      let retinaHdCount = 0;
      let standardResCount = 0;
      let blurryCount = 0;
      let oversizedCount = 0;
      let distortedCount = 0;

      imgElements.forEach((img) => {
        const hasAlt = img.hasAttribute('alt');
        const altValue = img.getAttribute('alt');
        const isEmpty = hasAlt && (altValue === null || altValue.trim() === '');
        const isMissing = !hasAlt;

        if (isMissing) missingAltCount++;
        else if (isEmpty) emptyAltCount++;
        else withAltCount++;

        const rect = img.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(img).display !== 'none';

        const naturalWidth = img.naturalWidth || 0;
        const naturalHeight = img.naturalHeight || 0;
        const renderedWidth = Math.round(rect.width);
        const renderedHeight = Math.round(rect.height);
        const currentSrc = img.currentSrc || img.src || '';

        const densityRatio = renderedWidth > 0 && naturalWidth > 0
          ? Math.round(((naturalWidth / renderedWidth) + Number.EPSILON) * 100) / 100
          : 1;

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
            // Ignore performance timing errors
          }
        }

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

        items.push({
          src: currentSrc,
          alt: altValue,
          hasAlt,
          isEmptyAlt: isEmpty,
          width: renderedWidth,
          height: renderedHeight,
          naturalWidth,
          naturalHeight,
          densityRatio,
          aspectRatioMismatch,
          aspectRatioDeltaPct,
          fileSizeBytes,
          fileFormat,
          qualityStatus,
        });
      });

      return {
        totalImages: imgElements.length,
        withAltCount,
        missingAltCount,
        emptyAltCount,
        retinaHdCount,
        standardResCount,
        blurryCount,
        oversizedCount,
        distortedCount,
        items,
      };
    }, { minHdRatio, maxOversizedRatio, maxImageSizeKb });

    console.log(`\n======================================================`);
    console.log(`📊 RINGKASAN HASIL AUDIT GRAFIK GAMBAR:`);
    console.log(`======================================================`);
    console.log(`🖼️  Total Gambar Ditemukan : ${auditResults.totalImages}`);
    console.log(`✨  CRISP HD (Retina-ready) : ${auditResults.retinaHdCount} (Kerapatan ≥ ${minHdRatio}x)`);
    console.log(`🟡  Standard Res (SD 1x)    : ${auditResults.standardResCount}`);
    console.log(`🔴  BLURRY / Pecah (Upscale): ${auditResults.blurryCount} (Kerapatan < 1.0x)`);
    console.log(`⚠️  OVERSIZED (Terlalu Berat): ${auditResults.oversizedCount} (> ${maxOversizedRatio}x atau > ${maxImageSizeKb}KB)`);
    if (auditResults.distortedCount > 0) {
      console.log(`📐  DISTORTED (Gepeng/Melar) : ${auditResults.distortedCount} (Deviasi rasio > 8%)`);
    }
    console.log(`🏷️  Status Alt Text         : ${auditResults.withAltCount} OK | ${auditResults.emptyAltCount} Empty | ${auditResults.missingAltCount} Missing`);
    console.log(`======================================================\n`);

    if (auditResults.items.length > 0) {
      console.log(`📑 DAFTAR RINCIAN SETIAP GAMBAR:`);
      console.log(`------------------------------------------------------------------------------------------------------------------------`);
      console.log(
        `#  | Status Mutu    | Kerapatan | Asli (Natural) | Tampil (CSS) | Bobot File | Format | Alt Text     | URL Gambar`
      );
      console.log(`------------------------------------------------------------------------------------------------------------------------`);

      auditResults.items.forEach((item: ImageQualityAuditItem, idx: number) => {
        let statusTag = '🟡 SD (1x)';
        if (item.qualityStatus === 'HD') statusTag = '🟢 CRISP HD';
        else if (item.qualityStatus === 'BLURRY') statusTag = '🔴 BLURRY ';
        else if (item.qualityStatus === 'OVERSIZED') statusTag = '⚠️ OVERSIZED';
        else if (item.qualityStatus === 'DISTORTED') statusTag = '📐 DISTORTED';
        else if (item.qualityStatus === 'VECTOR') statusTag = '🔷 SVG     ';

        const natStr = item.naturalWidth ? `${item.naturalWidth}x${item.naturalHeight}`.padEnd(14) : '-'.padEnd(14);
        const renStr = `${item.width}x${item.height}`.padEnd(12);
        const ratioStr = item.densityRatio ? `${item.densityRatio}x`.padEnd(9) : '-'.padEnd(9);
        const sizeStr = formatBytes(item.fileSizeBytes).padEnd(10);
        const fmtStr = (item.fileFormat || 'img').padEnd(6);
        const altStr = !item.hasAlt ? '🔴 Missing'.padEnd(12) : item.isEmptyAlt ? '🟡 Empty'.padEnd(12) : '🟢 OK'.padEnd(12);
        const shortSrc = item.src.length > 50 ? item.src.slice(0, 47) + '...' : item.src;

        console.log(
          `${String(idx + 1).padStart(2)} | ${statusTag} | ${ratioStr} | ${natStr} | ${renStr} | ${sizeStr} | ${fmtStr} | ${altStr} | ${shortSrc}`
        );
      });
      console.log(`------------------------------------------------------------------------------------------------------------------------\n`);
    }

    // Action Items
    const blurryItems = auditResults.items.filter((i: any) => i.qualityStatus === 'BLURRY');
    const distortedItems = auditResults.items.filter((i: any) => i.qualityStatus === 'DISTORTED');
    const oversizedItems = auditResults.items.filter((i: any) => i.qualityStatus === 'OVERSIZED');
    const missingAltItems = auditResults.items.filter((i: any) => !i.hasAlt);

    if (blurryItems.length > 0 || distortedItems.length > 0 || oversizedItems.length > 0 || missingAltItems.length > 0) {
      console.log(`📌 ACTION ITEMS & REKOMENDASI PERBAIKAN:`);
      if (blurryItems.length > 0) {
        console.log(`\n🔴 GAMBAR PECAH / BURAM (${blurryItems.length} aset):`);
        blurryItems.forEach((b: any) => {
          console.log(`  - ${b.src}`);
          console.log(`    ↳ Resolusi asli ${b.naturalWidth}px dipaksa tampil ${b.width}px (Rasio ${b.densityRatio}x). Ganti dengan file beresolusi lebih tinggi.`);
        });
      }
      if (distortedItems.length > 0) {
        console.log(`\n📐 GAMBAR TERDISTORSI / GEPENG (${distortedItems.length} aset):`);
        distortedItems.forEach((d: any) => {
          console.log(`  - ${d.src}`);
          console.log(`    ↳ Resolusi asli ${d.naturalWidth}x${d.naturalHeight} vs Tampil ${d.width}x${d.height} (Beda rasio ${d.aspectRatioDeltaPct}%). Sesuaikan CSS aspect-ratio.`);
        });
      }
      if (oversizedItems.length > 0) {
        console.log(`\n⚠️ GAMBAR TERLALU BERAT / OVERSIZED (${oversizedItems.length} aset):`);
        oversizedItems.forEach((o: any) => {
          console.log(`  - ${o.src}`);
          console.log(`    ↳ Resolusi ${o.naturalWidth}x${o.naturalHeight}px (${formatBytes(o.fileSizeBytes)}). Kompresi ke WebP/AVIF untuk menghemat kuota.`);
        });
      }
      if (missingAltItems.length > 0) {
        console.log(`\n🔴 GAMBAR TANPA ATRIBUT ALT (${missingAltItems.length} aset):`);
        missingAltItems.forEach((m: any) => {
          console.log(`  - ${m.src}`);
        });
      }
      console.log(``);
    } else {
      console.log(`✅ SEMUA GAMBAR MEMENUHI STANDAR MUTU HD & ACCESSIBILITY!\n`);
    }
  } catch (err: any) {
    console.error(`❌ Terjadi kesalahan saat memeriksa gambar: ${err.message}`);
  } finally {
    await browser.close();
  }
}

checkImages();
