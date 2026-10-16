# AI Creative OS Desktop v0.3 — Hybrid Update Foundation

## Apa yang nyata di versi ini
- Source Electron v0.2 tetap berjalan secara lokal.
- Installer Windows NSIS bisa dibuat melalui `npm run dist:win`.
- Pemeriksaan, download, dan pemasangan versi baru memakai `electron-updater`, **hanya pada build installer yang dipaketkan dan setelah repo rilis dikonfigurasi**.
- Migrasi v0.2 → schemaVersion 2 membuat backup *sebelum* mengganti JSON, disimpan di folder `migration-backups` dalam Electron userData. Tidak memindahkan atau menghapus video di `media/`.
- Opsional: tombol Cloud membuka website HTTPS dalam jendela Electron terisolasi tanpa preload dan tanpa desktopAPI. Tidak ada cloud backend, login, maupun data sync yang dibuat pada tahap ini.

## Setup sekali untuk update otomatis (developer)
1. Buat repository GitHub untuk source aplikasi dan pastikan releases bisa dijangkau pengguna.
2. Di `package.json`, ganti `SET_GITHUB_OWNER` dan `SET_GITHUB_REPO` dengan owner/repo GitHub asli. Jangan commit token pribadi.
3. Pastikan source ada di akar repository; jalankan `npm install` untuk menghasilkan `package-lock.json`, lalu commit kedua file tersebut.
4. Dari Windows, jalankan `npm run dist:win` untuk membuat NSIS installer. Atau gunakan GitHub Actions workflow yang disertakan (push tag `v0.3.0`; versi tag sesuai `package.json`).
5. Publikasikan GitHub Release yang memuat installer `.exe`, paket `.blockmap`, dan `latest.yml`. Actions menggunakan token bawaan GitHub dan membuat release jika konfigurasi sudah benar.
6. Install **sekali** menggunakan NSIS installer. Setelah itu fitur Cek Update berfungsi untuk setiap release baru. `npm start` tetap mode development dan tidak melakukan update otomatis.
7. Dianjurkan menggunakan code signing Windows untuk meningkatkan kepercayaan dan keamanan rilis; uji update antarversi pada PC percobaan terlebih dahulu.

## Migrasi data v0.2
- Di v0.2, klik `Backup` dan simpan JSON manual sebelum pertama kali menggunakan v0.3. Simpan pula folder `media/` jika memiliki lampiran video.
- Gunakan nama package Electron yang sama; default userData lama di Windows: `%APPDATA%\ai-creative-os-desktop`. Jangan rename `name` package tanpa strategi migrasi.
- v0.3 otomatis mendeteksi `creative-os.json`, membackup JSON lama ke `migration-backups`, dan hanya mengubah nomor skema + histori migrasi.
- Backup JSON **tidak** berisi byte file video. Jangan hapus folder media.
- Pengujian wajib: 5 Winner tetap ada, review lama tetap ada, video lama bisa dibuka, backup restore tetap berhasil.

## Cloud (belum di-deploy)
- Set `CREATIVE_OS_CLOUD_URL=https://alamat-domain-kamu` bila sudah ada frontend web yang di-host. Tombol Cloud akan membuka website tersebut dalam jendela terpisah tanpa akses ke sistem file lokal.
- Penggunaan cloud secara nyata memerlukan hosting, autentikasi, API backend, database, upload media, enkripsi, migrasi dan konflik sinkronisasi. Saat ini local data **tidak dikirim ke cloud**.
- Jangan memuat website remote dalam renderer dengan `desktopAPI` yang memiliki hak baca/tulis file lokal.

## Test lokal
`npm install` lalu `npm start`, kemudian coba Projects → Review → Backup. Mode dev hanya menampilkan bahwa updater belum aktif.

## Keamanan data lokal (branch fix/phase1-data-safety)
- Data tetap di `%APPDATA%\ai-creative-os-desktop\creative-os.json` (tidak berubah).
- Database rusak **tidak lagi diganti data awal**. Salinan disimpan sebagai `creative-os.damaged-*.json`, lalu dipulihkan otomatis dari backup terbaru. Jika tidak ada backup, penyimpanan dikunci agar tidak menimpa data.
- Backup otomatis di folder `backups/` (maksimal 1x per jam saat menyimpan, 30 terakhir disimpan) dan selalu sebelum Restore (`before-restore-*.json`).
- Log aplikasi: `logs/main.log`. Hanya satu jendela aplikasi yang boleh berjalan.
- Tes: `npm test` (tidak butuh Electron).
