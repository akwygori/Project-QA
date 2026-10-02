import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { QAAuditSummary, PageScanResult } from './types.js';
import { urlToOutputDirName } from './config.js';

dotenv.config();

function isImageWithinSafeLimits(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    // Images larger than 8MB should not be inlined
    if (stats.size > 8 * 1024 * 1024) return false;
    // Check PNG height from IHDR header (bytes 20-23)
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    const height = buf.readUInt32BE(20);
    // If height exceeds 16,000 pixels, vision encoder cannot handle it
    if (height > 16000) return false;
    return true;
  } catch {
    return true;
  }
}

export async function runAIAnalysis(summaryPath?: string): Promise<string> {
  let targetSummaryPath = summaryPath;

  if (!targetSummaryPath) {
    const targetUrl = process.env.TARGET_URL;
    if (targetUrl) {
      const siteFolder = urlToOutputDirName(targetUrl);
      const siteSummary = path.resolve(process.cwd(), 'output', siteFolder, 'summary.json');
      if (fs.existsSync(siteSummary)) {
        targetSummaryPath = siteSummary;
      }
    }

    if (!targetSummaryPath) {
      const legacySummary = path.resolve(process.cwd(), 'output', 'summary.json');
      if (fs.existsSync(legacySummary)) {
        targetSummaryPath = legacySummary;
      }
    }

    if (!targetSummaryPath) {
      const outputBase = path.resolve(process.cwd(), 'output');
      if (fs.existsSync(outputBase)) {
        const subdirs = fs.readdirSync(outputBase, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => path.join(outputBase, d.name, 'summary.json'))
          .filter((p) => fs.existsSync(p))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        if (subdirs.length > 0) {
          targetSummaryPath = subdirs[0];
        }
      }
    }

    if (!targetSummaryPath) {
      targetSummaryPath = path.resolve(process.cwd(), 'output', 'summary.json');
    }
  }

  if (!fs.existsSync(targetSummaryPath)) {
    console.error(`❌ Error: Summary file tidak ditemukan di: ${targetSummaryPath}`);
    console.log(`👉 Jalankan crawling terlebih dahulu dengan perintah: npm run crawl`);
    process.exit(1);
  }

  const raw = fs.readFileSync(targetSummaryPath, 'utf-8');
  const summary: QAAuditSummary = JSON.parse(raw);
  const targetDir = path.dirname(targetSummaryPath);
  const relPrompt = path.relative(process.cwd(), path.join(targetDir, 'ai-prompt.md')).replace(/\\/g, '/');
  const relScreenshots = path.relative(process.cwd(), path.join(targetDir, 'screenshots')).replace(/\\/g, '/');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log(`
⚠️  GEMINI_API_KEY belum terpasang di file .env!

Solusi untuk Analisis AI:
1. Cara Otomatis:
   - Buat/edit file .env lalu tambahkan:
     GEMINI_API_KEY=AIzaSy...
   - Jalankan kembali: npm run analyze

2. Cara Manual (Claude / Gemini / ChatGPT Web):
   - Buka file prompt yang sudah siap pakai: ${relPrompt}
   - Salin seluruh isinya dan unggah screenshot dari folder: ${relScreenshots}/
    `);
    return '';
  }

  console.log(`\n🤖 Menjalankan Analisis AI Otomatis menggunakan Gemini 3.5 Flash...`);
  console.log(`🎯 Website: ${summary.siteName} (${summary.baseUrl})`);
  console.log(`📄 Total halaman: ${summary.totalPages}\n`);

  const ai = new GoogleGenAI({ apiKey });
  const reportLines: string[] = [
    `# 🤖 Laporan Hasil Analisis AI QA Visual & Functional`,
    ``,
    `- **Target Website**: \`${summary.siteName}\` (${summary.baseUrl})`,
    `- **Tanggal Analisis**: ${new Date().toLocaleString()}`,
    `- **Model AI**: \`gemini-3.5-flash\``,
    ``,
    `---`,
    ``,
    `| URL / Page Name | Issue / Bug Found | Severity (Low / Medium / High) | Rekomendasi Perbaikan |`,
    `|---|---|---|---|`,
  ];

  for (let i = 0; i < summary.results.length; i++) {
    const page: PageScanResult = summary.results[i];
    console.log(`⏳ [${i + 1}/${summary.results.length}] Menganalisis halaman: ${page.pageName} (${page.url})...`);

    const textSnippetsBlock =
      page.pageTextSnippets && page.pageTextSnippets.length > 0
        ? `\nKutipan Teks Konten Halaman (periksa typo bahasa Inggris di sini):\n` +
          page.pageTextSnippets.slice(0, 35).map((t, idx) => `[${idx + 1}] "${t}"`).join('\n')
        : '';

    // Prompt instructions matching user requirements
    const pagePrompt = `
Kamu adalah seorang QA Engineer berpengalaman. Saya telah mengunggah screenshot (Desktop dan/atau Mobile) dan log console/network dari hasil crawling otomatis halaman web ${summary.siteName}.

Catatan Visual Overlay pada Screenshot:
- 🔴 Merah [ALT MISSING!]: Gambar tidak memiliki atribut alt (isu Accessibility/SEO)
- 🟡 Kuning [alt=""]: Atribut alt kosong
- 🟢 Hijau [alt="..."]: Atribut alt terisi

Detail Halaman:
- Page Name: ${page.pageName}
- URL: ${page.url}
- HTTP Status: ${page.httpStatus}
- Image Alt Audit: ${page.imageAudit?.totalImages || 0} gambar (${page.imageAudit?.withAlt || 0} dengan alt, ${page.imageAudit?.missingAlt || 0} MISSING ALT, ${page.imageAudit?.emptyAlt || 0} kosong)
- CTA Buttons Audit: ${page.ctaAudit ? `${page.ctaAudit.totalCTAs} CTAs (${page.ctaAudit.brokenCTAs} Broken/404)` : 'N/A'}
- Console Errors: ${page.consoleErrors.length > 0 ? JSON.stringify(page.consoleErrors.map((c) => c.text)) : 'None'}
- Uncaught JS Errors: ${page.unhandledJSErrors.length > 0 ? JSON.stringify(page.unhandledJSErrors) : 'None'}
- Failed Network Requests: ${page.failedRequests.length > 0 ? JSON.stringify(page.failedRequests.map((f) => `[${f.status || 'ERR'}] ${f.url}`)) : 'None'}
${textSnippetsBlock}

Tolong lakukan analisis QA dan berikan baris tabel markdown dengan fokus pada:
1. Visual & Layout Breakdown: Adakah teks bertumpuk (overlapping), gambar pecah/crop tidak wajar, spasi berlebih, atau elemen keluar container?
2. Mobile/Desktop Responsiveness: Apakah proporsi elemen rapi?
3. Image Alt Text & Accessibility: Sebutkan jika ada gambar dengan badge merah (missing alt) atau tidak deskriptif.
4. Console/Network Error & CTA: Sebutkan jika ada broken link (404), tombol CTA bermasalah, script gagal loading, atau server error (500).
5. Typo & English Grammar Check:
   - Periksa dengan teliti penggunaan bahasa Inggris pada teks halaman (baik dari screenshot maupun kutipan teks di atas).
   - PENTING: JANGAN MENGUBAH / MENGGANTI teks apa pun di website. HANYA DICATAT SAJA!
   - Format pencatatan typo pada kolom 'Issue / Bug Found':
     "Typo bahasa Inggris: kata '[kata salah]' pada [nama section/kalimat] -> seharusnya '[kata benar]' (hanya dicatat, tidak diganti)"

PENTING FORMAT OUTPUT:
Hanya berikan baris tabel markdown (satu atau beberapa baris jika ada beberapa temuan) dengan format:
| URL / Page Name | Issue / Bug Found | Severity (Low / Medium / High) | Rekomendasi Perbaikan |

Jika halaman terlihat normal tanpa kendala, tanpa error log/missing alt, dan tidak ada typo bahasa Inggris, cukup isi kolom Issue / Bug Found dengan 'PASS' dan kolom Severity dengan '-' serta Rekomendasi dengan '-'.
Jangan tambahkan pembuka atau penutup obrolan, hanya kembalikan baris tabel markdown.
    `.trim();

    const contents: any[] = [pagePrompt];

    // Prefer Desktop Screenshot if exists and within safe limits
    if (page.screenshots.desktop && fs.existsSync(page.screenshots.desktop) && isImageWithinSafeLimits(page.screenshots.desktop)) {
      try {
        const desktopBuffer = fs.readFileSync(page.screenshots.desktop);
        contents.push({
          inlineData: {
            data: desktopBuffer.toString('base64'),
            mimeType: 'image/png',
          },
        });
      } catch (err) {
        console.warn(`Gagal membaca screenshot desktop: ${page.screenshots.desktop}`);
      }
    }

    // Attach Mobile Screenshot only if safe and within limits
    if (page.screenshots.mobile && fs.existsSync(page.screenshots.mobile) && isImageWithinSafeLimits(page.screenshots.mobile)) {
      try {
        const mobileBuffer = fs.readFileSync(page.screenshots.mobile);
        contents.push({
          inlineData: {
            data: mobileBuffer.toString('base64'),
            mimeType: 'image/png',
          },
        });
      } catch (err) {
        console.warn(`Gagal membaca screenshot mobile: ${page.screenshots.mobile}`);
      }
    }

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents,
        });
      } catch (apiErr: any) {
        if (apiErr.message?.includes('image') || apiErr.message?.includes('INVALID_ARGUMENT')) {
          console.warn(`  ⚠️ Gambar melebihi batas vision encoder, beralih menganalisis via log error & cuplikan teks...`);
          response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: [pagePrompt],
          });
        } else {
          // Fallback to flash-lite if high demand
          response = await ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents,
          });
        }
      }

      const text = response.text?.trim() || '';
      // Filter out header lines if model repeated them
      const cleanRows = text
        .split('\n')
        .filter(
          (line) =>
            line.includes('|') &&
            !line.toLowerCase().includes('url / page name') &&
            !line.includes('---|')
        )
        .join('\n');

      if (cleanRows) {
        reportLines.push(cleanRows);
        console.log(`  ✅ Hasil: \n${cleanRows}`);
      } else {
        reportLines.push(`| [${page.pageName}](${page.url}) | PASS | - | - |`);
        console.log(`  ✅ Hasil: PASS`);
      }
    } catch (apiErr: any) {
      console.error(`  ❌ Error memanggil Gemini API untuk halaman ${page.pageName}:`, apiErr.message);
      reportLines.push(
        `| [${page.pageName}](${page.url}) | Analisis gagal: ${apiErr.message} | Medium | Periksa manual screenshot dan console log |`
      );
    }
  }

  const finalReport = reportLines.join('\n');
  const reportPath = path.join(targetDir, 'AI_QA_REPORT.md');
  fs.writeFileSync(reportPath, finalReport, 'utf-8');

  console.log(`\n🎉 Analisis AI Selesai!`);
  console.log(`📁 Laporan tersimpan di: ${reportPath}\n`);

  return finalReport;
}

// Standalone execution support
if (process.argv[1] && process.argv[1].endsWith('ai-analyzer.ts')) {
  runAIAnalysis().catch((err) => {
    console.error('Fatal error saat AI Analysis:', err);
    process.exit(1);
  });
}
