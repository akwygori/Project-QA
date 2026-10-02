import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Command } from 'commander';
import { urlToOutputDirName } from './config.js';

dotenv.config();

const program = new Command();

program
  .name('playwright-qa-clean')
  .description('Membersihkan folder hasil output crawling & audit (screenshots, logs, reports)')
  .option('-t, --target <urlOrFolder>', 'Hapus hanya folder output dari target URL atau nama folder tertentu')
  .option('-a, --all', 'Hapus seluruh isi folder output (default jika tanpa target)');

program.parse(process.argv);
const options = program.opts();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getDirStats(dirPath: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;

  if (!fs.existsSync(dirPath)) return { files, bytes };

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = getDirStats(fullPath);
        files += sub.files;
        bytes += sub.bytes;
      } else {
        files += 1;
        bytes += fs.statSync(fullPath).size;
      }
    } catch {
      // Ignore files currently being read
    }
  }
  return { files, bytes };
}

function clean(): void {
  const outputBase = path.resolve(process.cwd(), 'output');

  if (!fs.existsSync(outputBase)) {
    console.log(`ℹ️ Direktori output belum ada (${outputBase}). Tidak ada file yang perlu dibersihkan.`);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`🧹 Membersihkan Hasil Output Crawling & QA Auditor`);
  console.log(`======================================================`);

  if (options.target) {
    // Clean specific target folder
    const folderName = options.target.includes('://')
      ? urlToOutputDirName(options.target)
      : options.target;
    const targetPath = path.join(outputBase, folderName);

    if (!fs.existsSync(targetPath)) {
      console.log(`⚠️ Folder output target tidak ditemukan: ${targetPath}`);
      return;
    }

    const stats = getDirStats(targetPath);
    console.log(`🎯 Target folder : ${folderName}`);
    console.log(`📊 Ukuran        : ${stats.files} file (${formatBytes(stats.bytes)})`);
    console.log(`🗑️ Menghapus folder: output/${folderName}...`);

    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      console.log(`✅ Sukses! Folder 'output/${folderName}' berhasil dihapus.\n`);
    } catch (err: any) {
      console.error(`❌ Gagal menghapus folder: ${err.message}`);
    }
  } else {
    // Clean all contents inside output/
    const stats = getDirStats(outputBase);
    const entries = fs.readdirSync(outputBase);

    if (entries.length === 0) {
      console.log(`ℹ️ Folder 'output/' sudah kosong.`);
      return;
    }

    console.log(`📁 Lokasi : ${outputBase}`);
    console.log(`📊 Total  : ${entries.length} entitas (${stats.files} file, ${formatBytes(stats.bytes)})`);
    console.log(`🗑️ Menghapus seluruh file dan subfolder output...`);

    let removedCount = 0;
    for (const item of entries) {
      if (item === '.gitkeep') continue;
      const itemPath = path.join(outputBase, item);
      try {
        fs.rmSync(itemPath, { recursive: true, force: true });
        removedCount++;
      } catch (err: any) {
        console.warn(`  ⚠️ Peringatan saat menghapus ${item}: ${err.message}`);
      }
    }

    // Ensure empty output/ directory remains
    if (!fs.existsSync(outputBase)) {
      fs.mkdirSync(outputBase, { recursive: true });
    }

    console.log(`✅ Sukses! ${removedCount} item berhasil dibersihkan.`);
    console.log(`📁 Folder 'output/' sekarang bersih dan siap untuk scanning baru.\n`);
  }
}

clean();
