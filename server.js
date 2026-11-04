const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 4000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// Normalisasi otomatis URL Landing Page (kebal salah ketik / trailing slash / lupa /api)
let rawLandingUrl = (process.env.LANDING_API_URL || 'http://localhost:3000/api').trim().replace(/\/+$/, '');
if (!rawLandingUrl.endsWith('/api')) {
  rawLandingUrl += '/api';
}
const LANDING_API_URL = rawLandingUrl;
const LANDING_API_KEY = (process.env.LANDING_API_KEY || 'eventhub_super_secret_token_2026').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Admin] ERROR: SUPABASE_URL and SUPABASE_KEY must be provided in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Generate Certificate Number
async function getNextCertNumber() {
  const { count } = await supabase
    .from('certificates')
    .select('*', { count: 'exact', head: true });
  const seq = (count || 0) + 1;
  const padded = String(seq).padStart(4, '0');
  return `CERT/EVT-2026/${padded}`;
}

// -------------------------------------------------------------
// CORE FEATURE: SCAN & VERIFY TICKET (INTEGRASI KE WEBSITE 1)
// -------------------------------------------------------------
app.post('/api/scan', async (req, res) => {
  const { ticket_code, gate_name } = req.body;

  if (!ticket_code) {
    return res.status(400).json({ success: false, message: 'Kode tiket harus diisi.' });
  }

  const gate = gate_name || 'Gate 1 - Pintu Utama';

  try {
    // 1. TEMBAK API WEBSITE 1 (LANDING PAGE) MENGGUNAKAN AXIOS
    console.log(`[Admin -> Landing API] Verifying ${ticket_code} at ${gate}...`);
    
    let landingResponse;
    try {
      landingResponse = await axios.post(
        `${LANDING_API_URL}/tickets/verify`,
        { ticket_code: ticket_code.trim(), gate },
        {
          headers: {
            'Authorization': `Bearer ${LANDING_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
    } catch (axiosErr) {
      if (axiosErr.response) {
        landingResponse = axiosErr.response;
      } else {
        // Website 1 offline / network unreachable
        console.error('[Admin] Connection to Website 1 failed:', axiosErr.message);
        return res.status(503).json({
          success: false,
          code: 'NETWORK_ERROR',
          sound: 'error',
          message: 'Gagal terhubung ke Server Website 1 (Landing Page). Pastikan Website 1 berjalan di ' + LANDING_API_URL
        });
      }
    }

    const payload = landingResponse.data;

    // 2. KASUS A: TIKET VALID (PERTAMA KALI CHECK-IN)
    if (payload.success && payload.code === 'VALID') {
      const pData = payload.data;

      // Catat di tabel scan_logs (Database 2)
      await supabase.from('scan_logs').insert({
        ticket_code: pData.ticket_code,
        participant_name: pData.participant_name,
        gate_name: gate,
        scan_status: 'VALID',
        response_message: 'Tiket berhasil diverifikasi.'
      });

      // Terbitkan E-Sertifikat di Database 2 jika belum ada
      const certNo = await getNextCertNumber();
      const { data: certData } = await supabase.from('certificates').upsert({
        ticket_code: pData.ticket_code,
        certificate_no: certNo,
        participant_name: pData.participant_name,
        event_title: pData.event_title || 'Tech Summit 2026'
      }, { onConflict: 'ticket_code' }).select().maybeSingle();

      return res.json({
        success: true,
        code: 'VALID',
        sound: 'success',
        message: 'VERIFIKASI BERHASIL! Selamat datang di acara.',
        data: {
          ticket_code: pData.ticket_code,
          participant_name: pData.participant_name,
          participant_email: pData.participant_email,
          institution: pData.institution,
          event_title: pData.event_title,
          attended_at: pData.attended_at,
          gate: gate,
          certificate_no: certData ? certData.certificate_no : certNo
        }
      });
    }

    // 3. KASUS B: TIKET SUDAH PERNAH DIGUNAKAN (DOUBLE SCAN / DUPLIKAT)
    if (payload.code === 'ALREADY_ATTENDED') {
      const pData = payload.data || {};
      
      // Catat log duplikat di Database 2
      await supabase.from('scan_logs').insert({
        ticket_code: ticket_code.trim(),
        participant_name: pData.participant_name || 'Tidak Diketahui',
        gate_name: gate,
        scan_status: 'ALREADY_ATTENDED',
        response_message: `Peringatan: Tiket sudah masuk sebelumnya pada ${pData.attended_at || 'jam sebelumnya'}`
      });

      return res.json({
        success: false,
        code: 'ALREADY_ATTENDED',
        sound: 'warning',
        message: 'PERINGATAN: Tiket ini sudah pernah digunakan untuk check-in sebelumnya!',
        data: pData
      });
    }

    // 4. KASUS C: TIKET TIDAK VALID / PALSU
    await supabase.from('scan_logs').insert({
      ticket_code: ticket_code.trim(),
      participant_name: 'Tiket Tidak Dikenal',
      gate_name: gate,
      scan_status: 'INVALID',
      response_message: 'Tiket palsu atau tidak terdaftar di sistem.'
    });

    return res.status(404).json({
      success: false,
      code: 'INVALID',
      sound: 'error',
      message: 'TIKET TIDAK VALID! Barcode tidak terdaftar pada database registrasi.'
    });

  } catch (err) {
    console.error('[Admin /api/scan] Fatal error:', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', sound: 'error', message: 'Terjadi kesalahan internal server scanner.' });
  }
});

// -------------------------------------------------------------
// GET DAFTAR PESERTA TERDAFTAR (DITARIK DARI DATABASE 1 VIA API)
// -------------------------------------------------------------
app.get('/api/participants', async (req, res) => {
  try {
    const resp = await axios.get(`${LANDING_API_URL}/participants`, {
      headers: { 'Authorization': `Bearer ${LANDING_API_KEY}` },
      timeout: 5000
    });
    res.json(resp.data);
  } catch (err) {
    console.error('[Admin /api/participants] Error:', err.message);
    res.status(502).json({ success: false, message: 'Gagal mengambil data dari Landing Page: ' + err.message });
  }
});

// -------------------------------------------------------------
// GET RECENT AUDIT SCAN LOGS (DARI DATABASE 2)
// -------------------------------------------------------------
app.get('/api/logs', async (req, res) => {
  try {
    const { status, gate, limit = 50 } = req.query;

    let query = supabase
      .from('scan_logs')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(parseInt(limit));

    if (status) query = query.eq('scan_status', status);
    if (gate) query = query.eq('gate_name', gate);

    const { data: logs, error } = await query;

    if (error) throw error;

    res.json({ success: true, logs });
  } catch (err) {
    console.error('[Admin /api/logs] Error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat log audit.' });
  }
});

// -------------------------------------------------------------
// GET DASHBOARD COMBINED STATS (SYNC ANTAR-SISTEM)
// -------------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    // 1. Data dari Database 2 (Lokal Admin)
    const { count: totalScanned } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true });

    const { count: validScanned } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true })
      .eq('scan_status', 'VALID');

    const { count: duplicateScanned } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true })
      .eq('scan_status', 'ALREADY_ATTENDED');

    const { count: certCount } = await supabase
      .from('certificates')
      .select('*', { count: 'exact', head: true });

    // 2. Fetch Data dari Database 1 (Landing Page) via API
    let landingStats = null;
    let isConnectedToLanding = false;

    try {
      const resp = await axios.get(`${LANDING_API_URL}/events/summary`, {
        headers: { 'Authorization': `Bearer ${LANDING_API_KEY}` },
        timeout: 3000
      });
      if (resp.data && resp.data.success) {
        landingStats = resp.data.data;
        isConnectedToLanding = true;
      }
    } catch (e) {
      console.warn('[Admin] Could not reach Landing API for summary stats:', e.message);
    }

    res.json({
      success: true,
      stats: {
        total_scanned_logs: totalScanned || 0,
        valid_attendees: validScanned || 0,
        duplicate_attempts: duplicateScanned || 0,
        certificates_issued: certCount || 0,
        is_connected_to_landing: isConnectedToLanding,
        landing_url: LANDING_API_URL,
        landing_summary: landingStats
      }
    });
  } catch (err) {
    console.error('[Admin /api/stats] Error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat ringkasan statistik.' });
  }
});

// -------------------------------------------------------------
// PUBLIC CERTIFICATE CLAIM (DARI DATABASE 2)
// -------------------------------------------------------------
app.get('/api/certificate/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const { data: cert, error } = await supabase
      .from('certificates')
      .select('*')
      .eq('ticket_code', code.trim())
      .maybeSingle();

    if (error || !cert) {
      return res.status(404).json({
        success: false,
        message: 'Sertifikat tidak ditemukan. Pastikan Anda sudah melakukan check-in di lokasi acara.'
      });
    }

    res.json({ success: true, certificate: cert });
  } catch (err) {
    console.error('[Admin /api/certificate] Error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat sertifikat.' });
  }
});

// -------------------------------------------------------------
// EVENT SETTINGS (INTEGRASI DUA ARAH KE WEBSITE 1)
// -------------------------------------------------------------
app.get('/api/settings', async (req, res) => {
  try {
    const resp = await axios.get(`${LANDING_API_URL}/event`, {
      timeout: 5000
    });
    if (resp.data && resp.data.success) {
      return res.json({ success: true, event: resp.data.event });
    }
    res.status(502).json({ success: false, message: 'Gagal mengambil data event dari Website 1.' });
  } catch (err) {
    console.error('[Admin GET /api/settings] Error:', err.message);
    res.status(503).json({ success: false, message: 'Tidak dapat terhubung ke Website 1: ' + err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Admin -> Landing API] Updating event settings:', payload);

    const resp = await axios.put(`${LANDING_API_URL}/event/settings`, payload, {
      headers: {
        'Authorization': `Bearer ${LANDING_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    res.json(resp.data);
  } catch (err) {
    console.error('[Admin POST /api/settings] Error:', err.message);
    const msg = (err.response && err.response.data && err.response.data.message) || err.message;
    res.status(502).json({ success: false, message: 'Gagal menyimpan pengaturan ke Website 1: ' + msg });
  }
});

// Fallback route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`[Website 2: Admin Dashboard & Scanner (GateCheck)]`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Database: Supabase (Project Admin)`);
  console.log(`Connected to Website 1 API: ${LANDING_API_URL}`);
  console.log(`====================================================`);
});

module.exports = app;
