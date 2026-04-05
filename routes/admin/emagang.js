/**
 * routes/admin/emagang.js
 * E‑Magang - Admin/Kaprodi melihat dan mengelola logbook mahasiswa
 * Fitur lengkap: Mulai periode, Edit perusahaan, Lock/Unlock, Extend, Complete & Nilai
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function getMahasiswa(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      return { id: userDoc.id, ...userDoc.data() };
    }
    return { id: userId, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswa:', error);
    return { id: userId, nama: 'Error', nim: '-' };
  }
}

async function getMagangPeriods(mahasiswaId) {
  try {
    const snapshot = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .orderBy('pdkKode', 'asc')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getMagangPeriods:', error);
    return [];
  }
}

async function getLogbookStats(mahasiswaId, pdkId = null) {
  try {
    let query = db.collection('logbookMagang')
      .where('userId', '==', mahasiswaId);
    
    if (pdkId) {
      query = query.where('pdkId', '==', pdkId);
    }
    
    const snapshot = await query.get();
    const total = snapshot.size;
    const pending = snapshot.docs.filter(d => d.data().status === 'pending').length;
    const approved = snapshot.docs.filter(d => d.data().status === 'approved').length;
    const rejected = snapshot.docs.filter(d => d.data().status === 'rejected').length;
    
    return { total, pending, approved, rejected };
  } catch (error) {
    console.error('Error getLogbookStats:', error);
    return { total: 0, pending: 0, approved: 0, rejected: 0 };
  }
}

async function getBimbingan(mahasiswaId) {
  const snapshot = await db.collection('bimbingan')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
}

// ============================================================================
// RUTE UTAMA – DAFTAR MAHASISWA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { search, angkatan } = req.query;
    
    // ========== 1. Ambil semua mahasiswa yang memiliki enrollment PDK ==========
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('status', '==', 'active')
      .get();
    
    // Kelompokkan enrollment berdasarkan userId dan cari PDK yang diambil
    const userPdkMap = new Map(); // userId -> { pdks: [], mahasiswaData: {} }
    
    for (const doc of enrollmentSnapshot.docs) {
      const enrollment = doc.data();
      const userId = enrollment.userId;
      const mkId = enrollment.mkId;
      
      // Cek apakah mata kuliah ini PDK
      const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
      if (mkDoc.exists && mkDoc.data().isPDK === true) {
        const mk = mkDoc.data();
        if (!userPdkMap.has(userId)) {
          // Ambil data mahasiswa
          const userDoc = await db.collection('users').doc(userId).get();
          if (userDoc.exists && userDoc.data().role === 'mahasiswa') {
            userPdkMap.set(userId, {
              pdks: [],
              mahasiswaData: { id: userDoc.id, ...userDoc.data() }
            });
          }
        }
        
        if (userPdkMap.has(userId)) {
          userPdkMap.get(userId).pdks.push({
            id: mkId,
            kode: mk.kode,
            nama: mk.nama,
            urutan: mk.urutanPDK,
            semester: enrollment.semester
          });
        }
      }
    }
    
    // Urutkan PDK berdasarkan urutan
    for (const [userId, data] of userPdkMap) {
      data.pdks.sort((a, b) => a.urutan - b.urutan);
    }
    
    // Konversi ke array
    let mahasiswaList = Array.from(userPdkMap.values()).map(item => ({
      ...item.mahasiswaData,
      enrolledPdks: item.pdks,  // ← INI YANG PENTING
      pdkKodes: item.pdks.map(p => p.kode).join(', '),
      pdkUrutans: item.pdks.map(p => `PDK ${p.urutan}`).join(', ')
    }));
    
    console.log('Jumlah mahasiswa dengan PDK:', mahasiswaList.length);
    if (mahasiswaList.length > 0) {
      console.log('Contoh enrolledPdks:', JSON.stringify(mahasiswaList[0].enrolledPdks, null, 2));
    }
    
    // ========== 2. Filter berdasarkan pencarian ==========
    if (search) {
      const searchLower = search.toLowerCase();
      mahasiswaList = mahasiswaList.filter(m => 
        m.nama.toLowerCase().includes(searchLower) || 
        (m.nim && m.nim.includes(search))
      );
    }
    
    // ========== 3. Filter berdasarkan angkatan ==========
    if (angkatan) {
      mahasiswaList = mahasiswaList.filter(m => {
        const nimAngkatan = m.nim ? '20' + m.nim.substring(0, 2) : '';
        return nimAngkatan === angkatan;
      });
    }
    
    // ========== 4. Ambil statistik untuk setiap mahasiswa ==========
    for (const mhs of mahasiswaList) {
      // Total logbook (semua PDK)
      const allLogbooks = await db.collection('logbookMagang')
        .where('userId', '==', mhs.id)
        .get();
      mhs.totalLogbook = allLogbooks.size;
      mhs.pendingCount = allLogbooks.docs.filter(d => d.data().status === 'pending').length;
      mhs.approvedCount = allLogbooks.docs.filter(d => d.data().status === 'approved').length;
      mhs.rejectedCount = allLogbooks.docs.filter(d => d.data().status === 'rejected').length;
      
      // Role untuk admin (default pembimbing 2)
      mhs.role = 'pembimbing2';
    }
    
    // Urutkan berdasarkan nama
    mahasiswaList.sort((a, b) => a.nama.localeCompare(b.nama));
    
    // Dapatkan daftar angkatan unik untuk filter
    const angkatanList = [...new Set(mahasiswaList.map(m => 
      m.nim ? '20' + m.nim.substring(0, 2) : ''
    ).filter(a => a))].sort().reverse();
    
    res.render('admin/emagang_list', {
      title: 'E‑Magang - Monitoring Magang',
      mahasiswaList,
      angkatanList,
      filters: { search: search || '', angkatan: angkatan || '' },
      user: req.user
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data logbook' });
  }
});

// ============================================================================
// DETAIL LOGBOOK PER MAHASISWA
// ============================================================================

router.get('/mahasiswa/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { periodId, semester } = req.query;
    
    const mahasiswa = await getMahasiswa(userId);
    if (!mahasiswa.nama || mahasiswa.nama === 'Unknown') {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }
    
    // Ambil semua periode magang mahasiswa
    const allPeriods = await getMagangPeriods(userId);
    console.log('All Periods:', JSON.stringify(allPeriods, null, 2));
    
    // Tentukan periode yang dipilih
    let selectedPeriod = null;
    if (periodId) {
      selectedPeriod = allPeriods.find(p => p.id === periodId);
    } else if (allPeriods.length > 0) {
      selectedPeriod = allPeriods[0];
    }
    
    // Ambil logbook
    let logbookQuery = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc');
    
    if (selectedPeriod) {
      logbookQuery = logbookQuery.where('pdkId', '==', selectedPeriod.pdkId);
    }
    
    if (semester) {
      logbookQuery = logbookQuery.where('semester', '==', semester);
    }
    
    const logbookSnapshot = await logbookQuery.get();
    
    const logbookList = [];
    for (const doc of logbookSnapshot.docs) {
      const data = doc.data();
      logbookList.push({
        id: doc.id,
        ...data,
        tanggalFormatted: formatDate(data.tanggal),
        tanggalWaktuFormatted: formatDateTime(data.tanggal)
      });
    }
    
    // Ambil daftar semester unik
    const allSemesterSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .get();
    const semesterSet = new Set();
    allSemesterSnapshot.docs.forEach(doc => {
      if (doc.data().semester) semesterSet.add(doc.data().semester);
    });
    const semesterList = Array.from(semesterSet).sort();
    
    // ✅ PERBAIKI: Hitung statistik per PDK dengan benar
    const pdkStats = [];
    for (const period of allPeriods) {
      // Ambil semua logbook untuk PDK ini
      const periodLogbooks = await db.collection('logbookMagang')
        .where('userId', '==', userId)
        .where('pdkId', '==', period.pdkId)
        .get();
      
      const pendingCount = periodLogbooks.docs.filter(d => d.data().status === 'pending').length;
      const approvedCount = periodLogbooks.docs.filter(d => d.data().status === 'approved').length;
      const rejectedCount = periodLogbooks.docs.filter(d => d.data().status === 'rejected').length;
      
      console.log(`Period ${period.pdkKode}: pending=${pendingCount}, approved=${approvedCount}, rejected=${rejectedCount}`);
      
      pdkStats.push({
        id: period.id,
        pdkKode: period.pdkKode,
        pdkNama: period.pdkNama,
        pendingCount: pendingCount,
        approvedCount: approvedCount,
        rejectedCount: rejectedCount,
        status: period.status,
        tanggalMulai: period.tanggalMulai,
        tanggalSelesai: period.tanggalSelesai,
        perusahaan: period.perusahaan
      });
    }
    
    // Ambil daftar PDK untuk dropdown
    const pdkSnapshot = await db.collection('mataKuliah')
      .where('isPDK', '==', true)
      .orderBy('urutanPDK', 'asc')
      .get();
    const pdkList = pdkSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      kode: doc.data().kode, 
      nama: doc.data().nama 
    }));
    
    res.render('admin/emagang_mahasiswa', {
      title: `Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      semesterList,
      selectedSemester: semester || '',
      allPeriods,
      selectedPeriod,
      pdkStats,  // ← PASTIKAN INI TERISI
      pdkList,
      user: req.user
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data logbook' });
  }
});

// ============================================================================
// KELOLA PERIODE MAGANG (SAMA SEPERTI DOSEN)
// ============================================================================

// MULAI PERIODE MAGANG BARU
router.post('/period/start', async (req, res) => {
  try {
    const { 
      mahasiswaId, 
      pdkId, 
      tanggalMulai, 
      tanggalSelesai,
      namaPerusahaan, 
      alamatPerusahaan,
      kontakPerusahaan,
      kontakHpPerusahaan,
      emailPerusahaan,
      websitePerusahaan,
      pembimbingLapangan,
      jabatanPembimbingLapangan
    } = req.body;
    
    if (!mahasiswaId || !pdkId || !tanggalMulai || !namaPerusahaan) {
      req.session.error = 'Data tidak lengkap. Nama perusahaan wajib diisi.';
      return res.redirect('back');
    }
    
    const pdkDoc = await db.collection('mataKuliah').doc(pdkId).get();
    if (!pdkDoc.exists) {
      req.session.error = 'Mata kuliah PDK tidak ditemukan';
      return res.redirect('back');
    }
    const pdk = pdkDoc.data();
    
    const bimbingan = await getBimbingan(mahasiswaId);
    if (!bimbingan) {
      req.session.error = 'Mahasiswa belum memiliki dosen pembimbing';
      return res.redirect('back');
    }
    
    const existing = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('pdkId', '==', pdkId)
      .where('status', 'in', ['active', 'locked'])
      .get();
    
    if (!existing.empty) {
      req.session.error = `Mahasiswa sudah memiliki periode magang aktif untuk ${pdk.nama}`;
      return res.redirect('back');
    }
    
    const now = new Date().toISOString();
    
    await db.collection('magangPeriod').add({
      mahasiswaId,
      pdkId,
      pdkKode: pdk.kode,
      pdkNama: pdk.nama,
      tanggalMulai,
      tanggalSelesai: tanggalSelesai || null,
      status: 'active',
      pembimbing1Id: bimbingan.pembimbing1Id,
      pembimbing1Nama: bimbingan.pembimbing1Nama,
      pembimbing2Id: bimbingan.pembimbing2Id || null,
      pembimbing2Nama: bimbingan.pembimbing2Nama || null,
      perusahaan: {
        nama: namaPerusahaan,
        alamat: alamatPerusahaan || '',
        kontak: kontakPerusahaan || '',
        kontakHp: kontakHpPerusahaan || '',
        email: emailPerusahaan || '',
        website: websitePerusahaan || '',
        pembimbingLapangan: pembimbingLapangan || '',
        jabatanPembimbingLapangan: jabatanPembimbingLapangan || '',
        diisiOleh: req.user.id,
        diisiPada: now
      },
      nilai: { angka: null, huruf: null, komentar: null, dinilaiOleh: null, dinilaiPada: null, komponenNilai: {} },
      ulasan: { isFilled: false },
      lockHistory: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      history: [{
        action: 'started',
        tanggal: new Date().toISOString().split('T')[0],
        catatan: `Periode magang ${pdk.nama} di ${namaPerusahaan} dimulai oleh ${req.user.nama || 'Admin'}`
      }]
    });
    
    req.session.success = `Periode magang ${pdk.nama} berhasil dimulai`;
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal memulai periode magang';
    res.redirect('back');
  }
});

// UPDATE PERUSAHAAN
router.post('/period/:periodId/update-perusahaan', async (req, res) => {
  try {
    const { periodId } = req.params;
    const {
      namaPerusahaan, alamatPerusahaan, kontakPerusahaan, kontakHpPerusahaan,
      emailPerusahaan, websitePerusahaan, pembimbingLapangan, jabatanPembimbingLapangan
    } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      req.session.error = 'Periode magang tidak ditemukan';
      return res.redirect('back');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    await periodRef.update({
      'perusahaan.nama': namaPerusahaan,
      'perusahaan.alamat': alamatPerusahaan || '',
      'perusahaan.kontak': kontakPerusahaan || '',
      'perusahaan.kontakHp': kontakHpPerusahaan || '',
      'perusahaan.email': emailPerusahaan || '',
      'perusahaan.website': websitePerusahaan || '',
      'perusahaan.pembimbingLapangan': pembimbingLapangan || '',
      'perusahaan.jabatanPembimbingLapangan': jabatanPembimbingLapangan || '',
      'perusahaan.diisiOleh': req.user.id,
      'perusahaan.diisiPada': new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    req.session.success = 'Informasi perusahaan berhasil diupdate';
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal update perusahaan';
    res.redirect('back');
  }
});

// LOCK PERIODE
router.post('/period/:periodId/lock', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { reason } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      req.session.error = 'Periode magang tidak ditemukan';
      return res.redirect('back');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    if (period.status === 'completed') {
      req.session.error = 'Magang sudah selesai, tidak bisa dikunci';
      return res.redirect('back');
    }
    
    const lockHistory = period.lockHistory || [];
    lockHistory.push({
      action: 'locked',
      reason: reason || 'Tidak ada alasan',
      lockedBy: req.user.id,
      lockedByNama: req.user.nama || 'Admin',
      lockedAt: new Date().toISOString()
    });
    
    await periodRef.update({
      status: 'locked',
      lockHistory,
      updatedAt: new Date().toISOString(),
      history: [
        ...(period.history || []),
        { action: 'locked', catatan: `Periode magang dikunci oleh ${req.user.nama || 'Admin'}`, reason: reason || 'Tidak ada alasan', tanggal: new Date().toISOString().split('T')[0] }
      ]
    });
    
    req.session.success = 'Periode magang berhasil dikunci';
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal mengunci periode magang';
    res.redirect('back');
  }
});

// UNLOCK PERIODE
router.post('/period/:periodId/unlock', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { reason } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      req.session.error = 'Periode magang tidak ditemukan';
      return res.redirect('back');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    const lockHistory = period.lockHistory || [];
    lockHistory.push({
      action: 'unlocked',
      reason: reason || 'Tidak ada alasan',
      unlockedBy: req.user.id,
      unlockedByNama: req.user.nama || 'Admin',
      unlockedAt: new Date().toISOString()
    });
    
    await periodRef.update({
      status: 'active',
      lockHistory,
      updatedAt: new Date().toISOString(),
      history: [
        ...(period.history || []),
        { action: 'unlocked', catatan: `Periode magang dibuka kembali oleh ${req.user.nama || 'Admin'}`, reason: reason || 'Tidak ada alasan', tanggal: new Date().toISOString().split('T')[0] }
      ]
    });
    
    req.session.success = 'Periode magang berhasil dibuka';
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal membuka kunci periode magang';
    res.redirect('back');
  }
});

// PERPANJANG PERIODE
router.post('/period/:periodId/extend', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { tanggalSelesaiBaru, catatan } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      req.session.error = 'Periode magang tidak ditemukan';
      return res.redirect('back');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    const oldSelesai = period.tanggalSelesai || '-';
    
    await periodRef.update({
      tanggalSelesai: tanggalSelesaiBaru,
      updatedAt: new Date().toISOString(),
      history: [
        ...(period.history || []),
        { action: 'extended', tanggal: new Date().toISOString().split('T')[0], oldSelesai, newSelesai: tanggalSelesaiBaru, catatan: catatan || `Perpanjangan periode magang oleh ${req.user.nama || 'Admin'}` }
      ]
    });
    
    req.session.success = 'Periode magang berhasil diperpanjang';
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal memperpanjang periode magang';
    res.redirect('back');
  }
});

// SELESAIKAN & BERI NILAI
router.post('/period/:periodId/complete', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { nilaiAngka, komentarNilai, nilaiKehadiran, nilaiLogbook, nilaiLaporan, nilaiSikap, nilaiPresentasi } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      req.session.error = 'Periode magang tidak ditemukan';
      return res.redirect('back');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    let nilaiHuruf = 'E';
    if (nilaiAngka >= 85) nilaiHuruf = 'A';
    else if (nilaiAngka >= 75) nilaiHuruf = 'B';
    else if (nilaiAngka >= 65) nilaiHuruf = 'C';
    else if (nilaiAngka >= 50) nilaiHuruf = 'D';
    
    await periodRef.update({
      status: 'completed',
      tanggalSelesai: new Date().toISOString().split('T')[0],
      'nilai.angka': parseFloat(nilaiAngka),
      'nilai.huruf': nilaiHuruf,
      'nilai.komentar': komentarNilai || '',
      'nilai.dinilaiOleh': req.user.id,
      'nilai.dinilaiPada': new Date().toISOString(),
      'nilai.komponenNilai': {
        kehadiran: nilaiKehadiran ? parseFloat(nilaiKehadiran) : null,
        logbook: nilaiLogbook ? parseFloat(nilaiLogbook) : null,
        laporan: nilaiLaporan ? parseFloat(nilaiLaporan) : null,
        sikap: nilaiSikap ? parseFloat(nilaiSikap) : null,
        presentasi: nilaiPresentasi ? parseFloat(nilaiPresentasi) : null
      },
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [
        ...(period.history || []),
        { action: 'completed', tanggal: new Date().toISOString().split('T')[0], nilai: nilaiAngka, nilaiHuruf, catatan: `Magang selesai dan dinilai oleh ${req.user.nama || 'Admin'}` }
      ]
    });
    
    req.session.success = `Magang ${period.pdkKode} berhasil diselesaikan dengan nilai ${nilaiHuruf} (${nilaiAngka})`;
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal menyelesaikan magang';
    res.redirect('back');
  }
});

// ============================================================================
// APPROVE/REJECT LOGBOOK
// ============================================================================

router.post('/logbook/:id/approve', async (req, res) => {
  try {
    const logbookId = req.params.id;
    const logbookDoc = await db.collection('logbookMagang').doc(logbookId).get();
    
    if (!logbookDoc.exists) {
      req.session.error = 'Logbook tidak ditemukan';
      return res.redirect('back');
    }
    
    const logbook = logbookDoc.data();
    const mahasiswaId = logbook.userId;
    
    await logbookDoc.ref.update({
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id,
      approvedByNama: req.user.nama || 'Admin',
      approvedByRole: 'Admin'
    });
    
    req.session.success = 'Logbook berhasil disetujui';
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal menyetujui logbook';
    res.redirect('back');
  }
});

router.post('/logbook/:id/reject', async (req, res) => {
  try {
    const logbookId = req.params.id;
    const { alasan } = req.body;
    
    const logbookDoc = await db.collection('logbookMagang').doc(logbookId).get();
    if (!logbookDoc.exists) {
      req.session.error = 'Logbook tidak ditemukan';
      return res.redirect('back');
    }
    
    const logbook = logbookDoc.data();
    const mahasiswaId = logbook.userId;
    
    await logbookDoc.ref.update({
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.id,
      rejectedByNama: req.user.nama || 'Admin',
      rejectedByRole: 'Admin',
      rejectionReason: alasan || 'Tidak ada alasan'
    });
    
    req.session.success = 'Logbook berhasil ditolak';
    res.redirect(`/admin/emagang/mahasiswa/${mahasiswaId}`);
    
  } catch (error) {
    console.error('Error:', error);
    req.session.error = 'Gagal menolak logbook';
    res.redirect('back');
  }
});

// ============================================================================
// CETAK LOGBOOK
// ============================================================================

router.get('/print', async (req, res) => {
  try {
    const { userId, periodId, semester } = req.query;
    
    let query = db.collection('logbookMagang').orderBy('tanggal', 'asc');
    
    if (userId) query = query.where('userId', '==', userId);
    if (periodId) {
      const periodDoc = await db.collection('magangPeriod').doc(periodId).get();
      if (periodDoc.exists) query = query.where('pdkId', '==', periodDoc.data().pdkId);
    }
    if (semester) query = query.where('semester', '==', semester);
    
    const snapshot = await query.get();
    const logbookList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      logbookList.push({ ...data, mahasiswa, tanggalFormatted: formatDate(data.tanggal) });
    }
    
    let grouped = {};
    if (!userId) {
      logbookList.forEach(item => {
        if (!grouped[item.userId]) grouped[item.userId] = { mahasiswa: item.mahasiswa, entries: [] };
        grouped[item.userId].entries.push(item);
      });
      for (let key in grouped) {
        grouped[key].totalDurasi = grouped[key].entries.reduce((sum, e) => sum + (parseFloat(e.durasi) || 0), 0);
      }
    }
    
    const filterInfo = [];
    if (userId) {
      const m = await getMahasiswa(userId);
      filterInfo.push(`Mahasiswa: ${m.nama}`);
    }
    if (periodId) filterInfo.push(`Periode: ${periodId}`);
    if (semester) filterInfo.push(`Semester: ${semester}`);
    
    let pdkInfo = null;
    if (periodId) {
      const periodDoc = await db.collection('magangPeriod').doc(periodId).get();
      if (periodDoc.exists) pdkInfo = periodDoc.data();
    }
    
    res.render('admin/emagang_print', {
      title: 'Cetak Logbook',
      grouped,
      logbookList: userId ? logbookList : null,
      filterInfo: filterInfo.join(' | ') || 'Semua data',
      pdkInfo,
      generatedAt: formatDateTime(new Date().toISOString()),
      user: req.user
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal mencetak logbook');
  }
});

// ============================================================================
// API ENDPOINT
// ============================================================================

router.get('/api/mahasiswa', async (req, res) => {
  try {
    const snapshot = await db.collection('users').where('role', '==', 'mahasiswa').orderBy('nama').get();
    res.json({ success: true, data: snapshot.docs.map(doc => ({ id: doc.id, nama: doc.data().nama, nim: doc.data().nim })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/periods/:userId', async (req, res) => {
  try {
    const periods = await getMagangPeriods(req.params.userId);
    res.json({ success: true, data: periods });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;