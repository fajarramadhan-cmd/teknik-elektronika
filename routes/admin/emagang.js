/**
 * routes/admin/emagang.js
 * E‑Magang - Admin/Kaprodi melihat dan mengelola logbook mahasiswa
 * Fitur lengkap: Mulai periode, Edit perusahaan, Lock/Unlock, Extend, Complete & Nilai
 * OPTIMASI: Cache sederhana + Promise.all untuk mengurangi query berulang.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// CACHE SEDERHANA (untuk satu request)
// ============================================================================
const cache = {
  mahasiswa: new Map(),      // userId -> { nama, nim, ... }
  bimbingan: new Map(),      // mahasiswaId -> data bimbingan
  magangPeriods: new Map(),  // mahasiswaId -> array periode
  logbookStats: new Map()     // key "userId_pdkId" -> { total, pending, approved, rejected }
};

function clearCache() {
  cache.mahasiswa.clear();
  cache.bimbingan.clear();
  cache.magangPeriods.clear();
  cache.logbookStats.clear();
}

// ============================================================================
// FUNGSI BANTU (dengan cache)
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
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function getMahasiswa(userId) {
  if (cache.mahasiswa.has(userId)) return cache.mahasiswa.get(userId);
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const data = userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : { id: userId, nama: 'Unknown', nim: '-' };
    cache.mahasiswa.set(userId, data);
    return data;
  } catch (error) {
    console.error('Error getMahasiswa:', error);
    return { id: userId, nama: 'Error', nim: '-' };
  }
}

async function getBimbingan(mahasiswaId) {
  if (cache.bimbingan.has(mahasiswaId)) return cache.bimbingan.get(mahasiswaId);
  try {
    const snapshot = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const data = snapshot.docs[0].data();
    cache.bimbingan.set(mahasiswaId, data);
    return data;
  } catch (error) {
    console.error('Error getBimbingan:', error);
    return null;
  }
}

async function getMagangPeriods(mahasiswaId) {
  if (cache.magangPeriods.has(mahasiswaId)) return cache.magangPeriods.get(mahasiswaId);
  try {
    const snapshot = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .orderBy('pdkKode', 'asc')
      .get();
    const periods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    cache.magangPeriods.set(mahasiswaId, periods);
    return periods;
  } catch (error) {
    console.error('Error getMagangPeriods:', error);
    return [];
  }
}

async function getLogbookStats(mahasiswaId, pdkId = null) {
  const key = pdkId ? `${mahasiswaId}_${pdkId}` : mahasiswaId;
  if (cache.logbookStats.has(key)) return cache.logbookStats.get(key);
  try {
    let query = db.collection('logbookMagang')
      .where('userId', '==', mahasiswaId);
    if (pdkId) query = query.where('pdkId', '==', pdkId);
    const snapshot = await query.get();
    let total = 0, pending = 0, approved = 0, rejected = 0;
    snapshot.forEach(doc => {
      total++;
      const status = doc.data().status;
      if (status === 'pending') pending++;
      else if (status === 'approved') approved++;
      else if (status === 'rejected') rejected++;
    });
    const result = { total, pending, approved, rejected };
    cache.logbookStats.set(key, result);
    return result;
  } catch (error) {
    console.error('Error getLogbookStats:', error);
    return { total: 0, pending: 0, approved: 0, rejected: 0 };
  }
}

// ============================================================================
// RUTE UTAMA – DAFTAR MAHASISWA (OPTIMASI)
// ============================================================================

router.get('/', async (req, res) => {
  try {
    clearCache();
    const { search, angkatan } = req.query;

    // 1. Ambil semua enrollment aktif
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('status', '==', 'active')
      .get();

    // Kumpulkan semua mkId unik, ambil data mata kuliah sekali
    const mkIds = new Set();
    enrollmentSnapshot.forEach(doc => mkIds.add(doc.data().mkId));
    const mkDocs = await Promise.all(Array.from(mkIds).map(id => db.collection('mataKuliah').doc(id).get()));
    const mkMap = new Map();
    mkDocs.forEach(doc => { if (doc.exists) mkMap.set(doc.id, doc.data()); });

    // Kelompokkan per mahasiswa
    const userPdkMap = new Map();
    for (const doc of enrollmentSnapshot.docs) {
      const enrollment = doc.data();
      const userId = enrollment.userId;
      const mk = mkMap.get(enrollment.mkId);
      if (mk && mk.isPDK === true) {
        if (!userPdkMap.has(userId)) {
          userPdkMap.set(userId, { pdks: [], mahasiswaData: null });
        }
        userPdkMap.get(userId).pdks.push({
          id: enrollment.mkId,
          kode: mk.kode,
          nama: mk.nama,
          urutan: mk.urutanPDK,
          semester: enrollment.semester
        });
      }
    }

    // Ambil data mahasiswa secara paralel
    const userIds = Array.from(userPdkMap.keys());
    const mahasiswaDocs = await Promise.all(userIds.map(id => db.collection('users').doc(id).get()));
    const mahasiswaMap = new Map();
    mahasiswaDocs.forEach((doc, idx) => {
      if (doc.exists && doc.data().role === 'mahasiswa') {
        mahasiswaMap.set(userIds[idx], { id: doc.id, ...doc.data() });
      } else {
        userPdkMap.delete(userIds[idx]);
      }
    });

    // Bangun array mahasiswaList
    let mahasiswaList = [];
    for (const [userId, data] of userPdkMap) {
      const mhs = mahasiswaMap.get(userId);
      if (!mhs) continue;
      data.pdks.sort((a, b) => (a.urutan || 0) - (b.urutan || 0));
      mahasiswaList.push({
        ...mhs,
        enrolledPdks: data.pdks,
        pdkKodes: data.pdks.map(p => p.kode).join(', '),
        pdkUrutans: data.pdks.map(p => `PDK ${p.urutan}`).join(', ')
      });
    }

    // Filter pencarian
    if (search) {
      const searchLower = search.toLowerCase();
      mahasiswaList = mahasiswaList.filter(m =>
        m.nama.toLowerCase().includes(searchLower) || (m.nim && m.nim.includes(search))
      );
    }
    if (angkatan) {
      mahasiswaList = mahasiswaList.filter(m => {
        const nimAngkatan = m.nim ? '20' + m.nim.substring(0, 2) : '';
        return nimAngkatan === angkatan;
      });
    }

    // Ambil statistik logbook untuk semua mahasiswa sekaligus (paralel)
    const statsPromises = mahasiswaList.map(m => getLogbookStats(m.id));
    const statsResults = await Promise.all(statsPromises);
    mahasiswaList.forEach((m, idx) => {
      m.totalLogbook = statsResults[idx].total;
      m.pendingCount = statsResults[idx].pending;
      m.approvedCount = statsResults[idx].approved;
      m.rejectedCount = statsResults[idx].rejected;
      m.role = 'pembimbing2';
    });

    mahasiswaList.sort((a, b) => a.nama.localeCompare(b.nama));
    const angkatanList = [...new Set(mahasiswaList.map(m => m.nim ? '20' + m.nim.substring(0,2) : '').filter(a => a))].sort().reverse();

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
// DETAIL LOGBOOK PER MAHASISWA (OPTIMASI)
// ============================================================================

router.get('/mahasiswa/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { periodId, semester } = req.query;

    clearCache();
    const mahasiswa = await getMahasiswa(userId);
    if (!mahasiswa.nama || mahasiswa.nama === 'Unknown') {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }

    const allPeriods = await getMagangPeriods(userId);
    let selectedPeriod = null;
    if (periodId) selectedPeriod = allPeriods.find(p => p.id === periodId);
    else if (allPeriods.length > 0) selectedPeriod = allPeriods[0];

    // Query logbook utama
    let logbookQuery = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc');
    if (selectedPeriod) logbookQuery = logbookQuery.where('pdkId', '==', selectedPeriod.pdkId);
    if (semester) logbookQuery = logbookQuery.where('semester', '==', semester);
    const logbookSnapshot = await logbookQuery.get();
    const logbookList = logbookSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        tanggalFormatted: formatDate(data.tanggal),
        tanggalWaktuFormatted: formatDateTime(data.tanggal)
      };
    });

    // Ambil daftar semester unik
    const allSemesterSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .get();
    const semesterSet = new Set();
    allSemesterSnapshot.docs.forEach(doc => {
      if (doc.data().semester) semesterSet.add(doc.data().semester);
    });
    const semesterList = Array.from(semesterSet).sort();

    // Statistik per PDK (paralel)
    const pdkStats = await Promise.all(allPeriods.map(async period => {
      const stats = await getLogbookStats(userId, period.pdkId);
      return {
        id: period.id,
        pdkKode: period.pdkKode,
        pdkNama: period.pdkNama,
        pendingCount: stats.pending,
        approvedCount: stats.approved,
        rejectedCount: stats.rejected,
        status: period.status,
        tanggalMulai: period.tanggalMulai,
        tanggalSelesai: period.tanggalSelesai,
        perusahaan: period.perusahaan
      };
    }));

    // Daftar PDK untuk dropdown (satu query)
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
      pdkStats,
      pdkList,
      user: req.user
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data logbook' });
  }
});

// ============================================================================
// KELOLA PERIODE MAGANG (TIDAK BERUBAH)
// ============================================================================

router.post('/period/start', async (req, res) => {
  try {
    const { 
      mahasiswaId, pdkId, tanggalMulai, tanggalSelesai,
      namaPerusahaan, alamatPerusahaan, kontakPerusahaan, kontakHpPerusahaan,
      emailPerusahaan, websitePerusahaan, pembimbingLapangan, jabatanPembimbingLapangan
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

router.post('/period/:periodId/update-perusahaan', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { namaPerusahaan, alamatPerusahaan, kontakPerusahaan, kontakHpPerusahaan,
      emailPerusahaan, websitePerusahaan, pembimbingLapangan, jabatanPembimbingLapangan } = req.body;
    
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
// CETAK LOGBOOK (OPTIMASI)
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
    const uniqueUserIds = new Set();
    snapshot.docs.forEach(doc => uniqueUserIds.add(doc.data().userId));
    const mahasiswaMap = new Map();
    await Promise.all(Array.from(uniqueUserIds).map(async uid => {
      const m = await getMahasiswa(uid);
      mahasiswaMap.set(uid, m);
    }));
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = mahasiswaMap.get(data.userId);
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
      const m = mahasiswaMap.get(userId);
      filterInfo.push(`Mahasiswa: ${m?.nama || userId}`);
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