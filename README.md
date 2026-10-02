# 🚀 Sistem Otomasi QA: Playwright + TypeScript + AI

Sistem otomatisasi QA end-to-end yang dirancang untuk meng-crawl seluruh halaman website target, menangkap screenshot visual (Desktop & Mobile), mengaudit aksesibilitas Alt Text gambar, menguji keabsahan tombol CTA (mendeteksi broken link / 404), mengekstrak teks konten untuk mencatat **Typo Bahasa Inggris** (tanpa mengubah isi website), serta menyiapkan analisis AI (Google Gemini / Claude / ChatGPT) menggunakan **Prompt Standard QA**.

---

## 🔄 Alur Kerja Tim (Workflow QA)

```
[1. Dev/Script]                         [2. Crawling & Audit]                 [3. Output Per Target]                [4. AI Analysis]
Bima/Rico jalankan   ----->  Playwright scan & audit:    ----->       Terbentuk di output/<domain>/: ----->  Di-analyze AI pakai
script Playwright            - Screenshot (Alt Overlay)               - Screenshot (Desktop & Mobile)        Prompt Standard QA:
                             - CTA Buttons (Test 404)                 - Console & Network Logs               - Visual & Responsive
                             - Extract Text Content                   - Summary JSON & Markdown              - Alt Text & CTA (404)
                             - Console/Network Errors                 - Interactive HTML Dashboard           - Catat Typo English
```

1. **Dev/Script**: Bima/Rico mengeksekusi script Playwright dengan satu perintah sederhana (`npm run crawl` atau `npm run qa:all`).
2. **Crawling & Audit Otomatis**:
   - Mengunjungi halaman secara rekursif (BFS) atau daftar URL kustom, melakukan autoscroll untuk memicu lazy-loaded elements.
   - **Audit Alt Text**: Menempelkan badge visual langsung pada screenshot (Merah = missing, Kuning = empty, Hijau = ok).
   - **Audit CTA Button**: Menemukan seluruh tombol aksi & buttonbox, menguji status HTTP endpoint tujuan (`200 OK`, `404 Not Found`, atau protokol `tel:`).
   - **Ekstraksi Teks Konten**: Mengambil cuplikan teks asli (`h1-h6`, `p`, button) untuk audit ejaan/typo yang presisi.
3. **Output Terstruktur per Target URL**:
   - Disimpan di folder khusus `output/<nama-domain>/` sehingga hasil scan berbagai website (misal: DocFord, Limestone, Wink) tidak akan saling menimpa.
4. **AI QA Analysis**:
   - **Opsi A (Otomatis)**: Script `npm run analyze` memanggil Google Gemini API (`gemini-3.5-flash`) secara multimodal (gambar screenshot + log error + cuplikan teks) menghasilkan `AI_QA_REPORT.md`.
   - **Opsi B (Manual)**: Tim QA menyalin isi `ai-prompt.md` dan mengunggah screenshot ke Claude AI / Gemini / ChatGPT web.

---

## 🛠️ Instalasi & Setup

### 1. Prasyarat
- **Node.js**: versi 18+ (disarankan Node 20+)
- **NPM**

### 2. Instalasi Dependency & Browser Playwright
Buka terminal pada folder project ini dan jalankan:
```bash
npm install
npx playwright install chromium
```

### 3. Konfigurasi Target (.env)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Isi konfigurasi pada file `.env`:
```env
# Target Website Configuration
TARGET_URL=https://smilesbydocford.com
SITE_NAME=Target Website

# Batas Crawling
MAX_PAGES=15
MAX_DEPTH=2
TIMEOUT_MS=30000
DELAY_MS=1000

# Browser (true = headless di background, false = buka browser tampak di layar)
HEADLESS=true

# Google Gemini API Key (Dapatkan gratis di https://aistudio.google.com/)
GEMINI_API_KEY=AIzaSy...
```

---

## 📋 Daftar Lengkap Command NPM

| Command | Script Asli | Fungsi Utama |
| :--- | :--- | :--- |
| `npm run crawl` | `tsx src/index.ts` | Menjalankan crawling, screenshot Desktop & Mobile, audit Alt Text, dan audit CTA button. |
| `npm run qa` | `tsx src/index.ts` | Alias yang sama persis dengan `npm run crawl`. |
| `npm run report` | `tsx src/open-report.ts` | Membuka Dashboard Laporan Visual Interaktif (`index.html`) langsung di browser default. |
| `npm run clear` | `tsx src/clean.ts` | Membersihkan cache screenshot, log error, dan file laporan di folder `output/`. |
| `npm run clean` | `tsx src/clean.ts` | Alias yang sama persis dengan `npm run clear`. |
| `npm run analyze` | `tsx src/ai-analyzer.ts` | Menjalankan evaluasi AI otomatis (Gemini 3.5 Flash) terhadap screenshot & log hasil crawl. |
| `npm run qa:all` | `tsx src/index.ts --analyze` | Menjalankan crawling penuh lalu **langsung** mengeksekusi analisis AI dalam 1 langkah. |
| `npm run build` | `tsc` | Menjalankan kompilasi TypeScript untuk validasi tipe data (`types.ts`, `scanner.ts`, dll). |
| `npm test` | `playwright test` | Menjalankan test suite Playwright bawaan. |

---

## 🏃 Cara Menjalankan

### 1. Menjalankan Crawling Dasar (Mengikuti `.env`)
```bash
npm run crawl
```

### 2. Menjalankan Crawling dengan Argumen Langsung
Bima/Rico dapat langsung menentukan URL, nama website, dan jumlah halaman via CLI:
```bash
# Contoh untuk situs Limestone
npm run crawl -- --url https://limestone.example.com --name "Limestone" --max-pages 10

# Contoh untuk situs Wink
npm run crawl -- --url https://wink.example.com --name "Wink" --max-pages 20

# Hanya screenshot Desktop (lewati Mobile untuk menghemat waktu)
npm run crawl -- --url https://example.com --desktop-only

# Tampilkan jendela browser saat crawling berjalan (mode tampak / headful untuk debugging)
npm run crawl -- --url https://example.com --headful

# Menentukan folder output kustom
npm run crawl -- --output-dir output/custom-folder
```

### 3. Scan Daftar URL Kustom (Tanpa Crawl Otomatis)
Jika sudah memiliki daftar URL spesifik yang ingin diaudit secara manual:
```bash
npm run crawl -- --name "Wink Pages" --urls "https://example.com" "https://example.com/pricing" "https://example.com/contact"
```

---

## 🔍 Fitur-Fitur Khusus QA Engine

### 1. Fitur Audit Alt Text Image (Visual Overlay di Screenshot)
Secara otomatis mengaudit seluruh elemen `<img>` pada halaman dan **menempelkan badge visual langsung pada screenshot**:
- 🔴 **Badge Merah [ALT MISSING!]**: Gambar tidak memiliki atribut `alt` sama sekali (isu SEO & Accessibility WCAG).
- 🟡 **Badge Kuning [alt=""]**: Atribut alt bernilai kosong (`alt=""`, gambar dekoratif).
- 🟢 **Badge Hijau [alt="..."]**: Atribut alt terisi lengkap dengan teks deskripsinya.
- 📌 *Opsi CLI:* Gunakan `--no-alt-overlay` jika ingin screenshot murni tanpa badge.

### 2. Fitur Audit Tombol CTA & Broken Link (404 Check)
Engine secara otomatis menginspeksi seluruh elemen tombol aksi (Call-To-Action) dan buttonbox pada halaman:
- Mengekstrak teks tombol dan URL tujuan (`href`).
- Menguji status HTTP endpoint tujuan (`200 OK`, `404 Not Found`, atau redirect `301/302`).
- Mendukung action protocol seperti tombol klik telepon (`tel:+123...`).
- Menyajikan ringkasan tombol rusak dan tabel interaktif di dashboard HTML.

### 3. Pencatatan Typo Penggunaan Bahasa Inggris
Sistem QA dilengkapi dengan modul pendeteksi kesalahan penulisan (*typo*), salah eja (*spelling*), dan tata bahasa (*grammar*) dalam bahasa Inggris:
- **PENTING: Aturan Utama**: Konten pada website **TIDAK DIUBAH / DIGANTI**, melainkan **HANYA DICATAT SAJA** pada laporan evaluasi.
- **Ekstraksi Cuplikan Teks**: Teks asli halaman (`h1-h6`, `p`, button) diekstrak secara otomatis ke log JSON agar AI dapat membaca ejaan kata demi kata secara presisi.
- **Format Pencatatan Typo pada Laporan**:
  ```text
  Typo bahasa Inggris: kata '[kata salah]' pada [section/kalimat] -> seharusnya '[kata benar]' (hanya dicatat, tidak diganti)
  ```

---

## 📊 Hasil Output Berbasis Target URL

Setiap website yang di-crawl memiliki folder output tersendiri di dalam direktori `output/<nama-domain>/`:

```
output/
├── smilesbydocford.com/
│   ├── screenshots/      # Screenshot Desktop & Mobile dengan visual overlay
│   ├── logs/             # JSON log per halaman (error log, alt text lengkap, CTA audit, text snippets)
│   ├── summary.json      # Rekap data hasil crawl & audit
│   ├── qa-summary.md     # Rekapitulasi Markdown
│   ├── ai-prompt.md      # Prompt QA siap pakai untuk AI
│   ├── index.html        # Interactive QA Visual Dashboard
│   └── AI_QA_REPORT.md   # Laporan evaluasi AI (dari npm run analyze)
└── birminghamplumbingnearme.com/
    └── ...
```

### Membuka Dashboard Laporan Visual di Browser
```bash
# Buka laporan untuk target default (dari .env atau folder terbaru):
npm run report

# Buka laporan untuk target website tertentu:
npm run report -- smilesbydocford.com
```

---

## 🧹 Membersihkan Hasil Output (`clean` / `clear`)

Untuk menghapus cache screenshot, file log, dan laporan yang sudah selesai dianalisis:

```bash
# Bersihkan seluruh isi folder output:
npm run clean
# atau
npm run clear

# Bersihkan hanya untuk website target tertentu:
npm run clear -- --target smilesbydocford.com
# atau menggunakan URL langsung:
npm run clear -- -t https://smilesbydocford.com
```

---

## 🤖 Langkah 4: Analisis AI (AI QA Analysis)

### Opsi A: Analisis Otomatis via Terminal (Gemini 3.5 Flash)
1. Dapatkan Gemini API Key gratis di [Google AI Studio](https://aistudio.google.com/).
2. Masukkan ke file `.env`:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
3. Jalankan perintah:
   ```bash
   npm run analyze
   ```
   Atau jalankan crawl sekaligus analisis AI dalam 1 langkah:
   ```bash
   npm run qa:all -- --url https://example.com --name "Target"
   ```
*Hasil analisis akan tersimpan rapi di **`output/<target-website>/AI_QA_REPORT.md`** dalam format tabel evaluasi QA!*

> [!NOTE]
> Engine analisis AI telah dilengkapi dengan fitur **Safe Image Handling**. Jika screenshot halaman sangat panjang (misal versi mobile > 16.000px), sistem akan otomatis menyesuaikan agar tidak melebihi batas vision decoder Gemini dan menjamin analisis tetap berjalan sukses tanpa error.

### Opsi B: Analisis Manual via Claude AI / Gemini Web
1. Buka file **`output/<target-website>/ai-prompt.md`** yang telah dibuat secara otomatis.
2. Salin seluruh isi prompt tersebut.
3. Buka Claude AI (`claude.ai`) atau Gemini (`gemini.google.com`).
4. Unggah file screenshot halaman terkait dari folder **`output/<target-website>/screenshots/`**.
5. Tempel teks prompt dan kirim.

---

## 📝 Format Template Prompt Standar QA

Berikut adalah prompt standar yang digunakan oleh sistem (tersedia di `ai-prompt.md`):

```text
Kamu adalah seorang QA Engineer berpengalaman. Saya telah mengunggah screenshot dan log console dari hasil crawling otomatis halaman web [Nama Website].
Catatan Visual: Pada screenshot yang diunggah, telah ditambahkan badge visual overlay alt text (Merah = missing, Kuning = empty, Hijau = ok).

Tolong lakukan analisis QA dan berikan laporan ringkas dengan fokus pada:
1. Visual & Layout Breakdown: Adakah teks yang bertumpuk (overlapping), gambar yang pecah/crop tidak wajar, spasi berlebih, atau elemen yang keluar dari container?
2. Mobile/Desktop Responsiveness: Apakah proporsi elemen sudah rapi pada viewport Desktop (1920x1080) dan Mobile (375x844)?
3. CTA Buttons & Functional Links: Periksa apakah seluruh tombol CTA mengarah ke halaman yang valid dan tidak ada broken link (404 Not Found).
4. Image Alt Text & Accessibility: Periksa badge visual overlay pada gambar di screenshot dan log terlampir. Sebutkan gambar yang tidak memiliki atribut alt atau alt-nya kurang relevan.
5. Console/Network Error (dari log terlampir): Sebutkan error penting seperti script gagal loading, broken link (404), atau server error (500).
6. Typo & English Grammar Check: Periksa dengan teliti teks/konten dalam bahasa Inggris pada halaman.
   - PENTING: Jangan mengubah teks apa pun di website, HANYA DICATAT SAJA!
   - Format catatan typo: "Typo pada [section/kalimat]: '[kata salah]' -> seharusnya '[kata benar]' (hanya dicatat, tidak diganti)"

Sajikan hasil audit dalam format tabel sederhana:
| URL / Page Name | Issue / Bug Found | Severity (Low / Medium / High) | Rekomendasi Perbaikan |
|---|---|---|---|

Catatan: Jika halaman terlihat normal tanpa kendala dan tanpa typo, cukup nyatakan 'PASS' pada kolom Issue / Bug Found.
```

---

## 📁 Struktur Kode

```
playwright/
├── src/
│   ├── types.ts          # Definisi TypeScript interface (ImageAudit, CTAAudit, PageScanResult)
│   ├── config.ts         # Konfigurasi crawler, viewports, getDomainFolderName, regex exclude
│   ├── crawler.ts        # Logika normalisasi link, domain boundary, BFS queue
│   ├── scanner.ts        # Playwright browser engine, console listener, screenshots, text extractor
│   ├── reporter.ts       # Generator JSON summary, Markdown, ai-prompt.md, & interactive HTML Dashboard
│   ├── ai-analyzer.ts    # Integrasi AI otomatis (Gemini 3.5 Flash via @google/genai, safe image handling)
│   ├── open-report.ts    # CLI helper untuk membuka dashboard HTML di browser
│   ├── clean.ts          # Script pembersih folder output cross-platform
│   └── index.ts          # CLI entry point utama (Commander)
├── output/               # Folder hasil output crawling dan analisis
│   └── <target-domain>/  # Folder output per target website (misal: smilesbydocford.com)
│       ├── screenshots/  # File PNG Desktop dan Mobile (dengan visual alt badge)
│       ├── logs/         # File JSON per halaman (log error, alt text lengkap, CTA audit, text snippets)
│       ├── summary.json  # Ringkasan data crawl & audit
│       ├── qa-summary.md # Ringkasan markdown
│       ├── ai-prompt.md  # Template prompt siap pakai untuk AI (termasuk instruksi typo & text snippet)
│       ├── index.html    # Interactive QA visual dashboard
│       └── AI_QA_REPORT.md # Laporan evaluasi AI (opsional)
├── playwright.config.ts  # Konfigurasi Playwright test standar
├── tsconfig.json         # Konfigurasi TypeScript
├── package.json          # Dependencies & scripts
└── .env.example          # Template konfigurasi environment
```
