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
  let targetArg = summaryPath;
  if (!targetArg && process.argv.length > 2) {
    const targetIdx = process.argv.findIndex((a) => a === '-t' || a === '--target');
    if (targetIdx !== -1 && process.argv[targetIdx + 1]) {
      targetArg = process.argv[targetIdx + 1];
    } else {
      targetArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
    }
  }

  let targetSummaryPath = targetArg;

  if (targetSummaryPath) {
    if (!fs.existsSync(targetSummaryPath) || !targetSummaryPath.endsWith('.json')) {
      const folderName = targetSummaryPath.includes('://') ? urlToOutputDirName(targetSummaryPath) : targetSummaryPath;
      const candidate = path.resolve(process.cwd(), 'output', folderName, 'summary.json');
      if (fs.existsSync(candidate)) {
        targetSummaryPath = candidate;
      }
    }
  }

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

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  console.log(`\n🤖 Menjalankan Analisis AI Otomatis menggunakan Gemini (${modelName})...`);
  console.log(`🎯 Website: ${summary.siteName} (${summary.baseUrl})`);
  console.log(`📄 Total halaman: ${summary.totalPages}\n`);

  const ai = new GoogleGenAI({ apiKey });
  const reportLines: string[] = [
    `# 🤖 Laporan Hasil Analisis AI QA Visual & Functional`,
    ``,
    `- **Target Website**: \`${summary.siteName}\` (${summary.baseUrl})`,
    `- **Tanggal Analisis**: ${new Date().toLocaleString()}`,
    `- **Model AI**: \`${modelName}\``,
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

Catatan Visual Overlay pada Screenshot (Badge Ganda):
- Pill Atas (Accessibility/SEO):
  * 🔴 Merah [ALT MISSING!]: Gambar tidak memiliki atribut alt (isu Accessibility/SEO)
  * 🟡 Kuning [alt=""]: Atribut alt kosong / dekoratif
  * 🟢 Hijau [alt="..."]: Atribut alt terisi
- Pill Bawah (Grafik & Resolusi Standar Enterprise):
  * 🟢 Hijau [CRISP HD]: Resolusi tajam memenuhi standar Retina Display modern (≥ 1.9x)
  * 🔴 Merah [BLURRY]: Resolusi file lebih kecil dari wadah tampilan (< 1.0x, gambar pecah/buram)
  * 📐 Ungu [DISTORTED]: Rasio aspek peyot / tidak proporsional
  * ⚠️ Oranye [OVERSIZED]: Resolusi / file berlebih (> 3.5x atau > 500 KB)

Detail Halaman:
- Page Name: ${page.pageName}
- URL: ${page.url}
- HTTP Status: ${page.httpStatus}
- Image Alt Audit: ${page.imageAudit?.totalImages || 0} gambar (${page.imageAudit?.withAlt || 0} dengan alt, ${page.imageAudit?.missingAlt || 0} MISSING ALT, ${page.imageAudit?.emptyAlt || 0} kosong)
- Image Graphic & Fidelity Audit: ${page.imageAudit ? `${page.imageAudit.retinaHdCount || 0} HD (Tajam), ${page.imageAudit.standardResCount || 0} SD, ${page.imageAudit.blurryCount || 0} BLURRY (Pecah!), ${page.imageAudit.oversizedCount || 0} Oversized` : 'N/A'}
- CTA Buttons Audit: ${page.ctaAudit ? `${page.ctaAudit.totalCTAs} CTAs (${page.ctaAudit.brokenCTAs} Broken/404)` : 'N/A'}
- Console Errors: ${page.consoleErrors.length > 0 ? JSON.stringify(page.consoleErrors.map((c) => c.text)) : 'None'}
- Uncaught JS Errors: ${page.unhandledJSErrors.length > 0 ? JSON.stringify(page.unhandledJSErrors) : 'None'}
- Failed Network Requests: ${page.failedRequests.length > 0 ? JSON.stringify(page.failedRequests.map((f) => `[${f.status || 'ERR'}] ${f.url}`)) : 'None'}
${textSnippetsBlock}

Tolong lakukan analisis QA dan berikan baris tabel markdown dengan fokus pada:
1. Visual & Layout Breakdown: Adakah teks bertumpuk (overlapping), gambar pecah/crop tidak wajar, spasi berlebih, atau elemen keluar container?
2. Image Resolution & Graphic Fidelity: Periksa badge merah [BLURRY] atau gambar yang tampak pecah/beresolusi rendah saat dilihat di screenshot, serta sebutkan letak gambarnya.
3. Mobile/Desktop Responsiveness: Apakah proporsi elemen rapi?
4. Image Alt Text & Accessibility: Sebutkan jika ada gambar dengan badge merah [ALT MISSING!] atau teks deskripsi yang tidak relevan.
5. Console/Network Error & CTA: Sebutkan jika ada broken link (404), tombol CTA bermasalah, script gagal loading, atau server error (500).
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
          model: modelName,
          contents,
        });
      } catch (apiErr: any) {
        if (apiErr.message?.includes('image') || apiErr.message?.includes('INVALID_ARGUMENT')) {
          console.warn(`  ⚠️ Gambar melebihi batas vision encoder, beralih menganalisis via log error & cuplikan teks...`);
          response = await ai.models.generateContent({
            model: modelName,
            contents: [pagePrompt],
          });
        } else {
          // Fallback to gemini-1.5-flash if primary model fails
          response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
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

  // Append 📌 Catatan Khusus & Rekomendasi QA (Action Items) at bottom
  reportLines.push(``, `---`, `## 📌 Catatan Khusus & Rekomendasi QA (Action Items)`, ``);

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
    reportLines.push(`> ✅ **Status Website Sempurna:** Seluruh halaman yang di-scan bersih tanpa error konsol, broken link (404), halaman mati (4xx/5xx), aset hilang, maupun masalah resolusi gambar.`);
  } else {
    let noteIndex = 1;
    if (httpErrorPages.length > 0) {
      reportLines.push(`### 🚫 \${noteIndex++}. Halaman Error / Tidak Ditemukan (HTTP 4xx / 5xx)`);
      for (const p of httpErrorPages) {
        reportLines.push(`- Halaman **\${p.pageName}** (\`\${p.url}\`) -> Status HTTP: \`\${p.httpStatus}\``);
      }
      reportLines.push(``);
    }
    if (summary.totalBrokenCTAs > 0) {
      reportLines.push(`### 🚨 \${noteIndex++}. Tombol CTA / Tautan Rusak (Broken Link 404 / Error)`);
      for (const r of summary.results) {
        if (r.ctaAudit && r.ctaAudit.brokenCTAs > 0) {
          const broken = r.ctaAudit.ctas.filter((c) => c.is404 || (c.status && c.status >= 400) || c.error);
          for (const b of broken) {
            const redir = b.redirectUrl ? ` (redirect ke: \`\${b.redirectUrl}\`)` : '';
            reportLines.push(`- Halaman **\${r.pageName}** (\`\${r.url}\`): Button **"\${b.text}"** -> target: \`\${b.href}\`\${redir} [Status: \${b.status || 'ERR'}]`);
          }
        }
      }
      reportLines.push(``);
    }
    if (summary.totalBlurryImages && summary.totalBlurryImages > 0) {
      reportLines.push(`### 🔴 \${noteIndex++}. Gambar Pecah / Buram (Blurry / Upscaled Images - Urgent Visual Fix)`);
      reportLines.push(`Ditemukan **\${summary.totalBlurryImages} gambar** yang resolusi aslinya lebih kecil daripada ukuran tampilannya di layar (Kerapatan < 1.0x). Gambar mengalami interpolasi paksa sehingga terlihat buram/pecah bagi pengguna:`);
      for (const r of summary.results) {
        if (r.imageAudit && r.imageAudit.blurryCount && r.imageAudit.blurryCount > 0) {
          const blurries = r.imageAudit.images.filter((img) => img.qualityStatus === 'BLURRY');
          for (const b of blurries) {
            reportLines.push(`- Halaman **\${r.pageName}**: \`\${b.src.slice(0, 140)}\` (Asli: \`\${b.naturalWidth || 0}px\` ➔ Tampil: \`\${b.width}px\`, Kerapatan: \`\${b.densityRatio}x\`)`);
          }
        }
      }
      reportLines.push(``);
    }
    if (summary.totalDistortedImages && summary.totalDistortedImages > 0) {
      reportLines.push(`### 📐 \${noteIndex++}. Gambar Terdistorsi / Gepeng (Aspect Ratio Mismatch)`);
      reportLines.push(`Ditemukan **\${summary.totalDistortedImages} gambar** dengan rasio aspek asli yang tidak sesuai dengan dimensi CSS tampilan (deviasi rasio > 8%). Gambar terlihat peyot/gepeng:`);
      for (const r of summary.results) {
        if (r.imageAudit && r.imageAudit.distortedCount && r.imageAudit.distortedCount > 0) {
          const dists = r.imageAudit.images.filter((img) => img.qualityStatus === 'DISTORTED');
          for (const d of dists) {
            reportLines.push(`- Halaman **\${r.pageName}**: \`\${d.src.slice(0, 140)}\` (Asli: \${d.naturalWidth}x\${d.naturalHeight} vs Tampil: \${d.width}x\${d.height}, Beda: \`\${d.aspectRatioDeltaPct}%\`)`);
          }
        }
      }
      reportLines.push(``);
    }
    if (summary.totalOversizedImages && summary.totalOversizedImages > 0) {
      reportLines.push(`### ⚠️ \${noteIndex++}. Aset Gambar Terlalu Berat / Oversized (Performance Optimization)`);
      reportLines.push(`Ditemukan **\${summary.totalOversizedImages} gambar** yang resolusinya berlebih (> 3.5x dari yang dibutuhkan) atau berbobot file besar (> 500 KB):`);
      for (const r of summary.results) {
        if (r.imageAudit && r.imageAudit.oversizedCount && r.imageAudit.oversizedCount > 0) {
          const heavies = r.imageAudit.images.filter((img) => img.qualityStatus === 'OVERSIZED');
          for (const h of heavies) {
            const sz = h.fileSizeBytes ? ` [\${(h.fileSizeBytes / 1024).toFixed(1)} KB]` : '';
            reportLines.push(`- Halaman **\${r.pageName}**: \`\${h.src.slice(0, 140)}\` (Asli: \${h.naturalWidth}x\${h.naturalHeight} vs Tampil: \${h.width}x\${h.height}, Rasio: \`\${h.densityRatio}x\`)\${sz}`);
          }
        }
      }
      reportLines.push(``);
    }
    if (summary.totalNetworkErrors > 0) {
      reportLines.push(`### 🛑 \${noteIndex++}. Aset / Permintaan Jaringan yang Gagal (Asset Hilang / 404 / 5xx)`);
      for (const r of summary.results) {
        if (r.failedRequests.length > 0) {
          reportLines.push(`- Halaman **\${r.pageName}** (\`\${r.url}\`):`);
          r.failedRequests.forEach((req) => reportLines.push(`  * [Status \${req.status || 'ERR'}] Tipe \`\${req.resourceType || 'aset'}\`: \`\${req.url.slice(0, 140)}\``));
        }
      }
      reportLines.push(``);
    }
    if (summary.totalMissingAlt > 0) {
      reportLines.push(`### 🔴 ${noteIndex++}. Gambar Tanpa Atribut Alt (Missing Alt Attributes)`);
      for (const r of summary.results) {
        if (r.imageAudit && r.imageAudit.missingAlt > 0) {
          const missing = r.imageAudit.images.filter((img) => !img.hasAlt);
          for (const m of missing) {
            reportLines.push(`- Halaman **${r.pageName}**: \`${m.src.slice(0, 140)}\` (${m.width}x${m.height}px)`);
          }
        }
      }
      reportLines.push(``);
    }
    if (summary.totalEmptyAlt > 0) {
      reportLines.push(`### 🟡 ${noteIndex++}. Gambar dengan Atribut Alt Kosong (alt="")`);
      for (const r of summary.results) {
        if (r.imageAudit && r.imageAudit.emptyAlt > 0) {
          const empties = r.imageAudit.images.filter((img) => img.isEmptyAlt);
          for (const e of empties) {
            const cls = e.className ? ` [class: \`${e.className}\`]` : '';
            reportLines.push(`- Halaman **${r.pageName}**: \`${e.src.slice(0, 140)}\` (${e.width}x${e.height}px)${cls}`);
          }
        }
      }
      reportLines.push(``);
    }
    if (summary.totalConsoleErrors > 0) {
      reportLines.push(`### ⚠️ ${noteIndex++}. Error JavaScript / Console Terdeteksi`);
      for (const r of summary.results) {
        const allErr = [...r.unhandledJSErrors, ...r.consoleErrors.map((c) => c.text)];
        if (allErr.length > 0) {
          reportLines.push(`- Halaman **${r.pageName}** (\`${r.url}\`):`);
          allErr.slice(0, 5).forEach((err) => reportLines.push(`  * \`${err.split('\n')[0].slice(0, 150)}\``));
        }
      }
      reportLines.push(``);
    }
  }

  const finalReport = reportLines.join('\n');
  const reportPath = path.join(targetDir, 'AI_QA_REPORT.md');
  fs.writeFileSync(reportPath, finalReport, 'utf-8');

  console.log(`\n🎉 Analisis AI Selesai!`);
  console.log(`📁 Laporan tersimpan di: ${reportPath}\n`);

  return finalReport;
}

// Standalone execution support: tsx src/ai-analyzer.ts or node dist/ai-analyzer.js
if (process.argv[1] && /ai-analyzer\.(ts|js)$/i.test(process.argv[1].replace(/\\/g, '/'))) {
  runAIAnalysis().catch((err) => {
    console.error('Fatal error saat AI Analysis:', err);
    process.exit(1);
  });
}
