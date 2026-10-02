import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { urlToOutputDirName } from './config.js';

dotenv.config();

function findReportPath(): string | null {
  const argTarget = process.argv[2];
  const outputBase = path.resolve(process.cwd(), 'output');

  // 1. Specified via CLI argument (e.g. npm run report -- smilesbydocford.com or full URL)
  if (argTarget) {
    const folderName = argTarget.includes('://') ? urlToOutputDirName(argTarget) : argTarget;
    const directPath = path.join(outputBase, folderName, 'index.html');
    if (fs.existsSync(directPath)) return directPath;
  }

  // 2. Based on TARGET_URL in .env
  if (process.env.TARGET_URL) {
    const siteFolder = urlToOutputDirName(process.env.TARGET_URL);
    const envPath = path.join(outputBase, siteFolder, 'index.html');
    if (fs.existsSync(envPath)) return envPath;
  }

  // 3. Legacy root output/index.html
  const legacyPath = path.join(outputBase, 'index.html');
  if (fs.existsSync(legacyPath)) return legacyPath;

  // 4. Search newest index.html among output subdirectories
  if (fs.existsSync(outputBase)) {
    const subdirs = fs.readdirSync(outputBase, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(outputBase, d.name, 'index.html'))
      .filter((p) => fs.existsSync(p))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    if (subdirs.length > 0) return subdirs[0];
  }

  return null;
}

const reportPath = findReportPath();

if (!reportPath || !fs.existsSync(reportPath)) {
  console.error(`❌ File laporan visual (index.html) belum ditemukan di folder output.`);
  console.log(`👉 Jalankan crawling terlebih dahulu dengan: npm run crawl`);
  process.exit(1);
}

console.log(`🌐 Membuka Dashboard Laporan QA: ${reportPath}`);

// Windows / Mac / Linux opener
const command =
  process.platform === 'win32'
    ? `start "" "${reportPath}"`
    : process.platform === 'darwin'
    ? `open "${reportPath}"`
    : `xdg-open "${reportPath}"`;

exec(command);
