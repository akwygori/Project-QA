# 🚀 Sistem Otomasi QA: Playwright + TypeScript + AI

Sistem otomatisasi QA end-to-end yang dirancang untuk meng-crawl seluruh halaman website target, menangkap screenshot visual (Desktop & Mobile), mengaudit aksesibilitas Alt Text gambar, menguji keabsahan tombol CTA (mendeteksi broken link / 404), mengekstrak teks konten untuk mencatat **Typo Bahasa Inggris** (tanpa mengubah isi website), serta menyiapkan analisis AI (Google Gemini / Claude / ChatGPT) menggunakan **Prompt Standard QA**.

---

## 🔄 Alur Kerja Tim (Workflow QA)

```
[1. Dev/Script]                         [2. Crawling & Audit]                 [3. Output Per Target]                [4. AI Analysis]
QA Engineer jalankan  ----->  Playwright scan & audit:    ----->       Terbentuk di output/<domain>/: ----->  Di-analyze AI pakai
script Playwright            - Screenshot (Alt Overlay)               - Screenshot (Desktop & Mobile)        Prompt Standard QA:
                             - CTA (DOFOLLOW/Redir/404)               - Console & Network Logs               - Visual & Responsive
                             - Extract Text Content                   - Summary JSON & Markdown              - Alt Text & CTA (404)
                             - Console/Network Errors                 - Interactive HTML Dashboard           - Catat Typo English
```

1. **Dev/Script**: QA Engineer / Developer mengeksekusi script Playwright dengan satu perintah sederhana (`npm run crawl`, `npm run check:cta`, `npm run check:sitemap`, atau `npm run qa:all`).
2. **Deteksi Sitemap & Crawling Audit Otomatis**:
   - **Auto-Detection Sitemap**: Memeriksa `robots.txt` dan file XML sitemap secara otomatis, lalu meminta konfirmasi kepada QA: crawl semua URL, batasi sesuai `maxPages`, atau gunakan crawling dinamis biasa (BFS).
   - Mengunjungi halaman secara presisi atau rekursif (BFS), melakukan autoscroll untuk memicu lazy-loaded elements.
   - **Audit Alt Text**: Menempelkan badge visual langsung pada screenshot (Merah = missing, Kuning = empty, Hijau = ok).
   - **Audit CTA Button & Link**: Menemukan seluruh tombol aksi & buttonbox, menguji status HTTP (`200 success`, `200 redirection`, `404 gagal`), serta mendeteksi status SEO (`DOFOLLOW` / `NOFOLLOW`).
   - **Ekstraksi Teks Konten**: Mengambil cuplikan teks asli (`h1-h6`, `p`, button) untuk audit ejaan/typo yang presisi.
3. **Output Terstruktur per Target URL**:
   - Disimpan di folder khusus `output/<nama-domain>/` sehingga hasil scan berbagai website tidak akan saling menimpa:
     * `screenshots/`: Screenshot Desktop & Mobile beresolusi tinggi dengan visual overlay alt text badge.
     * `logs/`: Detail log per halaman (HTTP status, console, network).
     * `summary.json`: Ringkasan machine-readable seluruh metrik audit QA.
     * `qa-summary.md`: Laporan komprehensif metrik QA dalam format Markdown.
     * `issues.csv`: Rekapitulasi seluruh isu (Broken CTA, Blurry Image, Missing Alt, Console Errors) siap impor ke Jira / Excel / Sheets.
     * `ai-prompt.md`: Prompt siap pakai untuk AI multimodal (Claude / Gemini / ChatGPT).
     * `index.html`: Dashboard visual interaktif dengan dark mode & filter pencarian instan.
4. **AI QA Analysis**:
   - **Opsi A (Otomatis)**: Script `npm run analyze` memanggil Google Gemini API (`gemini-2.0-flash` / `gemini-1.5-flash`) secara multimodal (gambar screenshot + log error + cuplikan teks) menghasilkan `AI_QA_REPORT.md`.
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
TARGET_URL=https://example.com
SITE_NAME=Target Website

# Batas Crawling
MAX_PAGES=15
MAX_DEPTH=2
TIMEOUT_MS=30000
DELAY_MS=1000

# Browser & Concurrency Settings (true = headless, false = visible browser)
HEADLESS=true
CONCURRENCY=3
VIEWPORT_MODE=all
MAX_RETRIES=2

# Enterprise Image Quality Audit Settings (Opsional)
CHECK_IMAGE_QUALITY=true
IMAGE_MIN_HD_RATIO=1.9
IMAGE_MAX_OVERSIZED_RATIO=3.5
IMAGE_MAX_SIZE_KB=500

# Google Gemini API Key (Dapatkan gratis di https://aistudio.google.com/)
GEMINI_API_KEY=AIzaSy...
```

### 4. Pencegahan Version Control (`.gitignore`)
Pastikan folder `output/` (kecuali file placeholder `.gitkeep`) dimasukkan ke dalam file `.gitignore`:
```gitignore
output/*
!output/.gitkeep
```

> [!IMPORTANT]
> **Penting untuk Seluruh Anggota Tim:**
> Menambahkan folder `output/` ke `.gitignore` bertujuan untuk:
> 1. **Mencegah Version Control Penuh / Membengkak**: File screenshot (`.png`) beresolusi tinggi dan log pengujian (`.json`) berukuran besar dapat dengan cepat membuat riwayat commit Git menjadi sangat berat jika ikut ter-commit.
> 2. **Mencegah Konflik Merge (Merge Conflicts)**: Setiap anggota tim menjalankan crawling di lokal masing-masing dengan timestamp, nama screenshot, dan file log yang terus berganti. Mengabaikan folder output menjamin branch tim tetap bersih dan bebas dari konflik merge saat melakukan pull atau push kode.

---

## 📋 Daftar Lengkap Command NPM

| Command | Script Asli | Fungsi Utama |
| :--- | :--- | :--- |
| `npm run crawl` | `tsx src/index.ts` | Menjalankan deteksi sitemap otomatis, crawling, screenshot Desktop & Mobile, audit Alt Text, dan audit CTA button. |
| `npm run qa` | `tsx src/index.ts` | Alias yang sama persis dengan `npm run crawl`. |
| `npm run check:sitemap` | `tsx src/sitemap.ts` | **Baru**: Mendeteksi dan menginspeksi sitemap (`robots.txt`, XML sitemap index, total URL valid) secara cepat tanpa browser. |
| `npm run check:images` | `tsx src/check-images.ts` | **Baru**: Menjalankan audit mutu grafik & resolusi gambar HD (Retina, blurry, distorted, oversized) pada single URL instan. |
| `npm run check:cta` | `tsx src/check-cta.ts` | Menjalankan audit mandiri tombol CTA (DOFOLLOW/NOFOLLOW, 200 success, 200 redirection, 404 gagal). |
| `npm run report` | `tsx src/open-report.ts` | Membuka Dashboard Laporan Visual Interaktif (`index.html`) langsung di browser default. |
| `npm run clear` | `tsx src/clean.ts` | Membersihkan cache screenshot, log error, dan file laporan di folder `output/`. |
| `npm run clean` | `tsx src/clean.ts` | Alias yang sama persis dengan `npm run clear`. |
| `npm run analyze` | `tsx src/ai-analyzer.ts` | Menjalankan evaluasi AI otomatis (Gemini 2.0 Flash) terhadap screenshot & log hasil crawl. |
| `npm run qa:all` | `tsx src/index.ts --analyze` | Menjalankan crawling penuh lalu **langsung** mengeksekusi analisis AI dalam 1 langkah. |
| `npm run build` | `tsc` | Menjalankan kompilasi TypeScript untuk validasi tipe data (`types.ts`, `scanner.ts`, dll). |
| `npm test` | `playwright test` | Menjalankan test suite Playwright bawaan. |

---

## 🏃 Cara Menjalankan & Panduan Flag CLI

### 1. Menjalankan Crawling Dasar (Mengikuti `.env`)
Cukup jalankan satu perintah berikut untuk menggunakan konfigurasi target dari file [`.env`](file:///.env):
```bash
npm run crawl
```
*Sistem akan secara otomatis memeriksa keberadaan sitemap terlebih dahulu dan memberikan dialog konfirmasi interaktif untuk memilih mode crawling.*

---

### 2. Tabel Lengkap Flag Argumen CLI

Ketika menjalankan crawling melalui NPM dengan argumen kustom, sertakan pemisah `--` sebelum memasukkan flag CLI (contoh: `npm run crawl -- [flags]`).

| Flag / Opsi CLI | Format Nilai | Nilai Default | Penjelasan & Skenario Debugging |
| :--- | :--- | :--- | :--- |
| `-u, --url <url>` | String URL | Nilai dari `.env` | **Ubah Target Cepat:** Menguji website tertentu langsung dari terminal tanpa perlu mengedit file `.env`. |
| `-n, --name <name>` | String | Nama domain | **Label Project:** Memberikan nama project khusus (misal: `"Project-Alpha"`, `"Storefront"`) untuk judul laporan & visual dashboard. |
| `-m, --max-pages <num>` | Integer | `15` | **Batas Halaman:** Membatasi jumlah halaman yang di-crawl. Sangat berguna diisi `1` atau `3` untuk verifikasi cepat saat debugging. |
| `-d, --max-depth <num>` | Integer | `2` | **Batas Kedalaman:** Membatasi seberapa dalam link turunan di-crawl dari root domain (`0` = hanya homepage). |
| `-c, --concurrency <num>` | Integer | `3` | **Multi-Worker Paralel:** Menjalankan N worker crawler secara bersamaan untuk mempercepat proses crawling hingga 3x lipat. |
| `--viewport <mode>` | `all \| desktop \| mobile` | `all` | **Seleksi Viewport:** Menentukan viewport yang diaudit (`all` = Desktop & Mobile, `desktop` = hanya Desktop, `mobile` = hanya Mobile). |
| `--desktop-only` | Flag Boolean | `false` (Dual view) | **Hemat Waktu Debugging:** Hanya mengambil screenshot Desktop (1920x1080) dan melewati scan Mobile, mempercepat proses audit hingga 2x lipat. |
| `--mobile-only` | Flag Boolean | `false` (Dual view) | **Mobile Saja:** Hanya mengambil screenshot dan audit Mobile (375x844, Touch, DPR 2) dan melewati Desktop. |
| `--retries <num>` | Integer | `2` | **Toleransi Retry:** Batas pengulangan otomatis saat halaman mengalami rate-limiting (HTTP 429/503) atau timeout jaringan. |
| `--sitemap <url>` | String URL | `undefined` (Auto-detect) | **Sitemap Kustom:** Menentukan lokasi sitemap XML tertentu secara manual tanpa proses auto-discovery. |
| `--sub-sitemap <name>` | String | `undefined` | **Filter Sub-Sitemap:** Memilih kelompok sub-sitemap spesifik berdasarkan nama/keyword (misal: `page`, `post`, `service`, `local`). |
| `--skip-sitemap` | Flag Boolean | `false` | **Bypass Sitemap:** Mengabaikan sitemap dan langsung menjalankan penelusuran tautan HTML standar (BFS dinamis). |
| `--all-sitemap` | Flag Boolean | `false` | **Crawl Seluruh Sitemap:** Mengabaikan limit `maxPages` dan otomatis meng-crawl seluruh URL yang terdaftar di sitemap. |
| `-y, --yes` | Flag Boolean | `false` | **Auto-Confirm (CI/CD):** Otomatis menyetujui konfirmasi sitemap tanpa menunggu input keyboard (menggunakan sitemap s.d. `maxPages`). |
| `--headful` | Flag Boolean | `false` (Headless) | **Mode Tampak (Visual Debugging):** Membuka jendela browser Chromium secara nyata di layar. Wajib digunakan jika ingin memantau proses interaksi klik, redirect, atau visual rendering secara *real-time*. |
| `--desktop-only` | Flag Boolean | `false` (Dual view) | **Hemat Waktu Debugging:** Hanya mengambil screenshot Desktop (1920x1080) dan melewati scan Mobile, mempercepat proses audit hingga 2x lipat. |
| `--urls <urls...>` | List spasi URL | `undefined` | **Audit Halaman Tertentu:** Memeriksa daftar URL spesifik secara statis tanpa melakukan penelusuran tautan dinamis atau sitemap. |
| `--no-alt-overlay` | Flag Boolean | `false` (Aktif) | **Screenshot Bersih:** Menonaktifkan badge visual overlay alt text jika ingin screenshot murni tanpa tanda audit warna merah/hijau (misal untuk presentasi ke klien). |
| `--no-hd-check` | Flag Boolean | `false` (Aktif) | **Bypass Audit HD:** Menonaktifkan audit ketajaman grafik & resolusi gambar HD pada screenshot dan laporan. |
| `--min-hd <num>` | Float (angka) | `1.9` | **Ambang Batas HD Kustom:** Mengatur faktor rasio ketajaman minimal untuk klasifikasi Crisp HD / Retina Ready (default `1.9x`). |
| `--max-image-size <num>` | Integer (KB) | `500` | **Batas Bobot File:** Mengatur ambang batas peringatan ukuran file gambar dalam KB (default `500 KB`). |
| `-o, --output-dir <dir>` | Path folder | `output/<domain>` | **Folder Output Kustom:** Menentukan direktori penyimpanan hasil scan khusus (berguna untuk perbandingan antar build testing). |
| `-a, --analyze` | Flag Boolean | `false` | **Otomasi Penuh:** Langsung mengeksekusi analisis AI (Gemini) tepat setelah proses crawling selesai. |

---

### 3. Skenario Debugging Praktis Sehari-Hari

Berikut adalah kombinasi flag yang paling sering digunakan oleh QA engineer saat investigasi bug:

#### A. Quick Visual Inspection (1 Halaman, Browser Tampak & Desktop Saja)
Gunakan saat ingin melihat bagaimana layout dan tombol CTA dirender secara langsung di layar dengan cepat:
```bash
npm run crawl -- -u https://example.com/service-areas/ --headful --desktop-only -m 1
```

#### B. Audit Halaman Spesifik Tertentu (Manual List of URLs)
Gunakan jika ada revisi pada beberapa halaman spesifik (misal Home, Pricing, dan Contact) tanpa perlu crawl seluruh situs:
```bash
npm run crawl -- --urls "https://example.com/" "https://example.com/pricing/" "https://example.com/contact/" --headful
```

#### C. Ambil Screenshot Murni Tanpa Badge Overlay
Gunakan jika ingin mengambil screenshot bersih untuk dokumentasi atau presentasi:
```bash
npm run crawl -- -u https://example.com --no-alt-overlay -m 5
```

#### D. Crawling Penuh Website Klien Langsung dari Terminal
Gunakan saat ingin melakukan full audit pada project website baru:
```bash
# Contoh untuk project Alpha
npm run crawl -- --url https://alpha.example.com --name "Project Alpha" --max-pages 20

# Contoh untuk project Beta
npm run crawl -- --url https://beta.example.com --name "Project Beta" --max-pages 25
```

#### E. Inspeksi & Deteksi Sitemap Cepat (Tanpa Membuka Browser)
Gunakan jika Anda hanya ingin mengetahui apakah suatu website memiliki sitemap publik, berapa banyak sub-sitemap atau URL halamannya:
```bash
# Periksa sitemap target dari file .env:
npm run check:sitemap

# Periksa sitemap website lain secara langsung:
npm run check:sitemap -- https://example.com
```

#### F. Crawling Berdasarkan Kelompok Sub-Sitemap Tertentu (Misal Hanya Pages / Posts)
Gunakan jika Anda hanya ingin meng-crawl satu sub-sitemap spesifik tanpa membuang waktu meng-crawl halaman blog atau arsip lainnya:
```bash
# Hanya crawl halaman utama (page-sitemap.xml):
npm run crawl -- -u https://example.com --sub-sitemap page -m 15

# Hanya crawl artikel blog (post-sitemap.xml):
npm run crawl -- -u https://example.com --sub-sitemap post -m 10
```

#### G. Crawling Seluruh Halaman Sitemap Secara Otomatis (CI/CD Friendly)
Gunakan jika Anda ingin crawler mengambil 100% URL dari sitemap tanpa terpotong limit `maxPages` dan tanpa prompt interaktif:
```bash
npm run crawl -- -u https://example.com --all-sitemap -y
```

#### H. Bypass Sitemap (Crawling Dinamis Murni BFS)
Gunakan jika sitemap rusak atau sengaja ingin menguji alur navigasi klik hyperlink HTML secara natural dari homepage:
```bash
npm run crawl -- -u https://example.com --skip-sitemap -m 15 -d 2
```

---

### 4. Audit Mandiri Tombol CTA (DOFOLLOW/NOFOLLOW & Status Redirection)
Jika hanya ingin menguji keabsahan tombol CTA, broken link (404), dan status SEO rel follow dalam hitungan detik tanpa memicu crawling penuh:
```bash
# Menguji URL target default dari .env:
npm run check:cta

# Menguji URL halaman tertentu secara langsung:
npm run check:cta -- https://example.com/services/
```

---

### 5. Audit Mandiri Mutu Grafik & Resolusi Gambar HD (Standar Enterprise)
Gunakan saat ingin menguji ketajaman visual seluruh gambar di suatu halaman (memeriksa gambar buram/pecah, gambar terlalu berat, rasio distorsi, dan kesiapan layar Retina/HiDPI) secara instan tanpa crawling panjang:
```bash
# Menguji URL target default dari .env:
npm run check:images

# Menguji URL halaman tertentu secara langsung:
npm run check:images -- https://example.com/gallery/case-study-1/
```

---

## 🔍 Fitur-Fitur Khusus QA Engine

### 1. Fitur Auto-Detection Sitemap, Pengelompokan Sub-Sitemap & Konfirmasi Interaktif
Sebelum memulai crawling, Playwright QA Engine secara cerdas memindai arsitektur website target untuk menemukan sitemap:
1. **Pemeriksaan Deklarasi `robots.txt`**: Engine membaca file `robots.txt` target dan mengekstrak seluruh baris direktif `Sitemap: https://...`.
2. **Pengecekan Kandidat XML Standar**: Jika tidak dideklarasikan di `robots.txt`, sistem memeriksa lokasi sitemap populer seperti `sitemap_index.xml`, `sitemap.xml`, `wp-sitemap.xml`, dan `sitemap/sitemap.xml`.
3. **Rekursi & Pengelompokan Sub-Sitemap (`<sitemapindex>`)**:
   - Jika sitemap target adalah indeks (misal Rank Math, Yoast, All In One SEO, WooCommerce), engine akan membedah dan **mengelompokkan setiap sub-sitemap beserta jumlah halamannya**:
     - *Contoh: `page-sitemap.xml` (70 halaman), `post-sitemap.xml` (13 halaman), `category-sitemap.xml` (6 halaman), dll.*
   - Seluruh daftar kelompok sub-sitemap ditampilkan secara transparan di terminal konsol sebelum crawl dimulai.
4. **Normalisasi & Filter Domain Boundary**: Menjamin hanya URL internal valid yang dimasukkan ke antrean crawling, mengabaikan file non-halaman (`.pdf`, `.zip`, `.kml`, `.png`, dll).
5. **Dialog Konfirmasi Interaktif (`[1/2/3/4/0]`)**:
   Alih-alih langsung membabi buta meng-crawl puluhan ribu halaman, sistem menginformasikan jumlah URL yang ditemukan dan meminta persetujuan QA:
   - `[1]` **Crawl Seluruh Halaman dari Semua Sub-Sitemap**: Meng-crawl seluruh URL yang terdaftar di semua sub-sitemap.
   - `[2]` **Crawl Sebagian Dibatasi maxPages (Default)**: Mengambil URL resmi sitemap sesuai batas `MAX_PAGES` yang telah ditentukan di `.env` (misal 15 halaman).
   - `[3]` **Pilih Satu Sub-Sitemap Spesifik**: Memberi opsi bagi QA untuk memilih hanya satu kelompok sub-sitemap (misal hanya mengaudit `page-sitemap.xml` atau `service-sitemap.xml`).
   - `[4]` **Abaikan Sitemap**: Menjalankan penelusuran tautan HTML standar (BFS dinamis dari homepage).
   - `[0]` **Batalkan**: Menghentikan proses secara aman.
6. **Dukungan Lingkungan CI/CD & Pipeline**:
   Jika dijalankan di lingkungan otomatis tanpa terminal interaktif (non-TTY) atau menyertakan flag `-y, --yes`, sistem secara cerdas memilih opsi `[2]` tanpa menggantung proses terminal. Flag `--sub-sitemap <keyword>` juga dapat digunakan untuk memilih kelompok sub-sitemap langsung dari CLI.

### 2. Fitur Audit Alt Text Image (Visual Overlay di Screenshot)
Secara otomatis mengaudit seluruh elemen `<img>` pada halaman dan **menempelkan badge visual langsung pada screenshot**:
- 🔴 **Badge Merah [ALT MISSING!]**: Gambar tidak memiliki atribut `alt` sama sekali (isu SEO & Accessibility WCAG).
- 🟡 **Badge Kuning [alt=""]**: Atribut alt bernilai kosong (`alt=""`, gambar dekoratif).
- 🟢 **Badge Hijau [alt="..."]**: Atribut alt terisi lengkap dengan teks deskripsinya.
- 📌 *Opsi CLI:* Gunakan `--no-alt-overlay` jika ingin screenshot murni tanpa badge.

### 3. Fitur Audit Tombol CTA & Link (DOFOLLOW/NOFOLLOW, Redirection & 404 Check)
Engine secara otomatis menginspeksi seluruh elemen tombol aksi (Call-To-Action) dan tautan aksi pada halaman:
- **Status SEO Follow (`DOFOLLOW` vs `NOFOLLOW`)**:
  - 🟢 **DOFOLLOW**: Tautan standar yang meneruskan *link equity* / otoritas SEO (tanpa atribut `nofollow`).
  - 🟡 **NOFOLLOW**: Tautan yang memiliki atribut `rel="nofollow"`, `rel="sponsored"`, atau `rel="ugc"`.
- **Status 200 Success**: Tautan langsung valid menuju halaman tujuan dengan kode status HTTP 200 tanpa mengalami pengalihan (*no redirect*).
- **Status 200 Redirection**: Tautan melewati kode pengalihan (HTTP 301, 302, 307, 308) lalu berhasil mendarat di halaman akhir dengan HTTP 200. Sistem mencatat URL asal, alur status, dan URL akhir tujuan.
- **Status 404 Gagal**: Tautan rusak/mati yang menghasilkan HTTP 404 (Not Found), baik terjadi secara langsung maupun setelah proses redirect.
- **Action Protocol**: Mendeteksi dan memvalidasi tombol telepon (`tel:+1...`), email (`mailto:...`), dan modal/trigger JavaScript (`javascript:void(0)` / `#anchor`).
- **Penyajian Laporan**: Data disajikan lengkap di terminal console, file Markdown `qa-summary.md`, dan tabel interaktif pada dashboard HTML (`index.html`).

### 4. Pencatatan Typo Penggunaan Bahasa Inggris
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
├── example.com/
│   ├── screenshots/      # Screenshot Desktop & Mobile dengan visual overlay
│   ├── logs/             # JSON log per halaman (error log, alt text lengkap, CTA audit, text snippets)
│   ├── summary.json      # Rekap data hasil crawl & audit
│   ├── qa-summary.md     # Rekapitulasi Markdown (Overview, Detail Logs, & Catatan Khusus)
│   ├── ai-prompt.md      # Prompt QA siap pakai untuk AI (termasuk instruksi Notes Khusus)
│   ├── index.html        # Interactive QA Visual Dashboard
│   └── AI_QA_REPORT.md   # Laporan evaluasi AI (dari npm run analyze)
└── mysite.com/
    └── ...
```

### 📑 Format Standar Laporan `qa-summary.md` (3-Tier Reporting Engine)
Untuk seluruh pemeriksaan website saat ini dan kedepannya, laporan `qa-summary.md` disusun secara hierarkis:
1. **📑 Overview Table**: Tabel matriks cepat status HTTP, Image Alt (`Missing` / `Empty` / `OK`), Status Tombol CTA, serta jumlah error JavaScript & request jaringan.
2. **🔍 Detailed Error & Audit Logs by Page**: Rincian teknis mendalam per URL (rincian link rusak, daftar gambar tanpa alt atau alt kosong beserta dimensi dan class CSS, unhandled JS exceptions, dan request 4xx/5xx yang terblokir).
3. **📌 Catatan Khusus & Action Items (Notes Khusus di Bagian Bawah)**: Rekapitulasi terpusat di bagian paling bawah laporan yang merangkum seluruh temuan hal error atau elemen yang tidak terdapat pada website:
   - 🚫 **Halaman Error / Tidak Ditemukan (Status 4xx / 5xx)**: URL yang mengembalikan status 404 / 500.
   - 🚨 **Tombol CTA / Tautan Rusak**: Daftar tombol mati yang mengarah ke broken link (404).
   - 🛑 **Aset / Request Jaringan Gagal**: Aset (CSS, JS, gambar, font) yang tidak terdapat di server (404/ERR_FAILED).
   - 🔴 **Gambar Tanpa Atribut Alt**: Tag `<img>` yang tidak memiliki atribut `alt` sama sekali.
   - 🟡 **Gambar dengan Alt Kosong (`alt=""`)**: Banner atau gambar konten utama yang atribut alt-nya tidak terisi teks deskripsi.
   - ⚠️ **Error JavaScript / Console**: Pesan error skrip runtime pada browser.

> [!TIP]
> **Catatan Version Control:** Folder `output/` telah diatur di `.gitignore` (`output/*`) sehingga hasil tangkapan screenshot dan file log pengujian tidak akan masuk ke Git. Hal ini menjaga ukuran repository tetap ramping serta mencegah konflik merge antar anggota tim.

### Membuka Dashboard Laporan Visual di Browser
```bash
# Buka laporan untuk target default (dari .env atau folder terbaru):
npm run report

# Buka laporan untuk target website tertentu:
npm run report -- example.com
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
npm run clear -- --target example.com
# atau menggunakan URL langsung:
npm run clear -- -t https://example.com
```

---

## 🤖 Langkah 4: Analisis AI (AI QA Analysis)

### Opsi A: Analisis Otomatis via Terminal (Gemini 2.0 Flash)
1. Dapatkan Gemini API Key gratis di [Google AI Studio](https://aistudio.google.com/).
2. Masukkan ke file `.env`:
   ```env
   GEMINI_API_KEY=AIzaSy...
   # Opsional: tentukan model (default: gemini-2.0-flash)
   GEMINI_MODEL=gemini-2.0-flash
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

Berikut adalah prompt standar yang otomatis disiapkan oleh sistem di dalam file `output/<target-website>/ai-prompt.md`:

<details>
<summary><strong>📄 Klik di sini untuk melihat Isi Lengkap Template Prompt QA (ai-prompt.md)</strong></summary>

<br>

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

</details>

---

## 🔧 Troubleshooting / Kendala Umum

### 1. Error Missing System Dependencies di Linux / CI (GitHub Actions / Docker)
**Gejala:**
Saat menjalankan script di server Linux, pipeline CI/CD, atau kontainer Docker, Playwright gagal meluncurkan browser dan menampilkan pesan error seperti:
```text
Host system is missing dependencies to run browsers.
Missing libraries: libnss3.so, libatk-1.0.so.0, libgbm.so.1, libasound.so.2, ...
```

**Solusi:**
Instal pustaka sistem (*system dependencies*) yang dibutuhkan oleh engine Chromium dengan perintah:
```bash
npx playwright install-deps
```
Atau jika baru pertama kali menyiapkan server, pasang browser beserta seluruh library dependensinya secara langsung:
```bash
npx playwright install --with-deps chromium
```

---

### 2. Perbedaan Rendering Tampilan: Mode Headless vs Headful
**Gejala & Karakteristik:**
Terkadang hasil tangkapan screenshot pada mode `headless` (di background) memiliki sedikit perbedaan visual dibandingkan saat Anda melihat website tersebut secara langsung di jendela browser (`--headful`).

**Penyebab & Catatan Teknis:**
- **Font Rendering & Antialiasing**: Lingkungan headless (khususnya pada Linux/CI tanpa physical display) menggunakan *software rasterization*, sehingga ketebalan font dan kerapatan huruf (*kerning*) dapat terlihat sedikit berbeda dibanding rendering kartu grafis (GPU) di mode headful Windows/macOS.
- **Scrollbar & Effective Viewport**: Mode headless secara default tidak merender *scrollbar* fisik OS, sehingga lebar kanvas konten efektif bisa lebih lebar sekitar 10–17px dibandingkan mode tampak, yang berpotensi mempengaruhi breakpoint media queries yang berada tepat di batas ambang (*boundary threshold*).
- **Deteksi Anti-Bot & CSS Animations**: Beberapa situs web mematikan animasi CSS kompleks atau efek WebGL tertentu jika mendeteksi ketiadaan display fisik.

**Rekomendasi QA:**
- Gunakan mode tampak (**`--headful`**) saat melakukan investigasi bug visual secara langsung:
  ```bash
  npm run crawl -- --headful --desktop-only -m 1
  ```
- Tetap gunakan mode **`headless`** (bawaan) untuk pipeline CI/CD atau crawling massal karena jauh lebih cepat dan menghemat alokasi memori CPU/RAM.

---

### 3. Masalah File Screenshot Terkunci di Windows (*EPERM Lock*)
Jika Anda membuka file screenshot di aplikasi Photo Viewer pihak ketiga saat crawling sedang berjalan, Windows dapat mengunci file tersebut. Sistem telah mengantisipasi hal ini dengan fitur *safe fallback* otomatis yang menyimpan file dengan timestamp cadangan tanpa menghentikan proses crawl.

---

## 📁 Struktur Kode

```
playwright/
├── src/
│   ├── types.ts          # Definisi TypeScript interface (ImageAudit, CTAAudit, PageScanResult)
│   ├── config.ts         # Konfigurasi crawler, viewports, getDomainFolderName, regex exclude
│   ├── crawler.ts        # Logika normalisasi link, domain boundary, BFS queue
│   ├── sitemap.ts        # Modul auto-detection sitemap (robots.txt parser, XML index recursion, URL normalizer)
│   ├── scanner.ts        # Playwright browser engine, console listener, screenshots, text extractor
│   ├── reporter.ts       # Generator JSON summary, Markdown, ai-prompt.md, & interactive HTML Dashboard
│   ├── check-cta.ts      # Script mandiri audit CTA (DOFOLLOW/NOFOLLOW, 200 redirection, 404 gagal)
│   ├── ai-analyzer.ts    # Integrasi AI otomatis (Gemini 2.0 Flash via @google/genai, safe image handling)
│   ├── open-report.ts    # CLI helper untuk membuka dashboard HTML di browser
│   ├── clean.ts          # Script pembersih folder output cross-platform
│   └── index.ts          # CLI entry point utama (Commander)
├── output/               # Folder hasil output crawling dan analisis
│   └── <target-domain>/  # Folder output per target website (misal: example.com)
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
