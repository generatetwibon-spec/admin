# 🛡️ GateCheck - Admin Dashboard, Scanner Gate & E-Certificate (System 2)

> **Repository 2 dari 2**: Bertanggung jawab atas verifikasi check-in di pintu masuk (gate scanner kamera), pencatatan log audit kehadiran, dan penerbitan otomatis E-Sertifikat digital.

---

## 🚀 Fitur Utama
1. **Live Camera Scanner**: Menggunakan kamera laptop / HP untuk memindai QR code tiket secara instan via `html5-qrcode`.
2. **Audio-Visual Feedback (Web Audio API)**:
   * 🟢 **Beep Tinggi & Layar Hijau**: Tiket valid, peserta dipersilakan masuk.
   * 🟠 **Chime Peringatan & Layar Oranye**: Tiket ganda (*Double Scan*), menunjukkan jam masuk sebelumnya.
   * 🔴 **Buzzer Error & Layar Merah**: Tiket tidak valid atau tidak terdaftar.
3. **Multi-Gate Support**: Petugas dapat memilih pos gate aktif (*Pintu Utama, Pintu Barat, Pintu Timur, VIP*).
4. **Audit Scan Logs**: Tabel audit realtime dengan filter status/gate dan fitur **Ekspor ke CSV**.
5. **Dynamic E-Certificate Generator**: Canvas renderer yang otomatis mencetak nama, nomor sertifikat urut, dan tanggal ke sertifikat (Download PNG / Print PDF).
6. **Integrasi REST API**: Berkomunikasi langsung ke System 1 (`http://localhost:3000/api`) menggunakan API Key.

---

## 🛠️ Tech Stack & Konfigurasi
* **Runtime**: Node.js & Express.js
* **Database**: Supabase PostgreSQL (Project 2: `fcegnmlurihlyiqaryrg`)
* **Port Default**: `4000`

### File `.env`
```env
PORT=4000
SUPABASE_URL=https://fcegnmlurihlyiqaryrg.supabase.co
SUPABASE_KEY=your_supabase_secret_key_here

# INTEGRATION TO SYSTEM 1 (LANDING PAGE)
LANDING_API_URL=http://localhost:3000/api
LANDING_API_KEY=eventhub_super_secret_token_2026
```

---

## 📦 Cara Menjalankan

1. **Jalankan Skema Database di Supabase:**
   Buka dashboard Supabase Project Admin -> Masuk ke **SQL Editor** -> Jalankan query yang ada di file `schema.sql`.

2. **Install Dependensi & Jalankan Server:**
   ```bash
   npm install
   npm run dev
   ```
3. Buka browser di:
   * **Dashboard & Monitoring**: `http://localhost:4000`
   * **Live Camera Scanner**: `http://localhost:4000/scanner.html`
   * **Audit Log Tables**: `http://localhost:4000/logs.html`
   * **Portal Klaim Sertifikat Peserta**: `http://localhost:4000/claim.html`
