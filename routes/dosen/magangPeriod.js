// routes/dosen/magangPeriod.js
const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Ambil data mahasiswa
 */
async function getMahasiswa(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
}

/**
 * Cek apakah dosen ini adalah pembimbing mahasiswa
 */
async function isPembimbing(dosenId, mahasiswaId) {
  const snapshot = await db.collection('bimbingan')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  
  if (snapshot.empty) return false;
  const bimbingan = snapshot.docs[0].data();
  return bimbingan.pembimbing1Id === dosenId || bimbingan.pembimbing2Id === dosenId;
}

/**
 * Ambil data bimbingan mahasiswa
 */
async function getBimbingan(mahasiswaId) {
  const snapshot = await db.collection('bimbingan')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

/**
 * Mendapatkan semua periode magang mahasiswa
 */
async function getMagangPeriods(mahasiswaId) {
  const snapshot = await db.collection('magangPeriod')
    .where('mahasiswaId', '==', mahasiswaId)
    .orderBy('pdkKode', 'asc')
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============================================================================
// HALAMAN UTAMA KELOLA PERIODE MAGANG
// ============================================================================

router.get('/:mahasiswaId', async (req, res) => {
  try {
    const { mahasiswaId } = req.params;
    
    const isPembimbingDosen = await isPembimbing(req.dosen.id, mahasiswaId);
    if (!isPembimbingDosen) {
      return res.status(403).send('Anda tidak memiliki akses ke mahasiswa ini');
    }
    
    const mahasiswa = await getMahasiswa(mahasiswaId);
    if (!mahasiswa) {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }
    
    const bimbingan = await getBimbingan(mahasiswaId);
    const periods = await getMagangPeriods(mahasiswaId);
    
    // Ambil daftar PDK yang tersedia
    const pdkSnapshot = await db.collection('mataKuliah')
      .where('isPDK', '==', true)
      .orderBy('urutanPDK', 'asc')
      .get();
    
    const pdkList = pdkSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      kode: doc.data().kode, 
      nama: doc.data().nama,
      urutan: doc.data().urutanPDK
    }));
    
    res.render('dosen/magang_period', {
      title: `Kelola Magang - ${mahasiswa.nama}`,
      mahasiswa,
      bimbingan,
      periods,
      pdkList,
      user: req.user
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal memuat data');
  }
});

// ============================================================================
// MULAI PERIODE MAGANG
// ============================================================================

router.post('/start', async (req, res) => {
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
      return res.status(400).send('Data tidak lengkap. Nama perusahaan wajib diisi.');
    }
    
    const isPembimbingDosen = await isPembimbing(req.dosen.id, mahasiswaId);
    if (!isPembimbingDosen) {
      return res.status(403).send('Anda tidak memiliki akses');
    }
    
    const pdkDoc = await db.collection('mataKuliah').doc(pdkId).get();
    if (!pdkDoc.exists) {
      return res.status(404).send('Mata kuliah PDK tidak ditemukan');
    }
    const pdk = pdkDoc.data();
    
    const bimbingan = await getBimbingan(mahasiswaId);
    if (!bimbingan) {
      return res.status(400).send('Mahasiswa belum memiliki dosen pembimbing');
    }
    
    // Cek apakah sudah ada periode aktif untuk PDK ini
    const existing = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('pdkId', '==', pdkId)
      .where('status', 'in', ['active', 'locked'])
      .get();
    
    if (!existing.empty) {
      return res.status(400).send(`Mahasiswa sudah memiliki periode magang aktif untuk ${pdk.nama}`);
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
        diisiOleh: req.dosen.id,
        diisiPada: now
      },
      nilai: {
        angka: null,
        huruf: null,
        komentar: null,
        dinilaiOleh: null,
        dinilaiPada: null,
        komponenNilai: {}
      },
      ulasan: {
        isFilled: false
      },
      lockHistory: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      history: [{
        action: 'started',
        tanggal: new Date().toISOString().split('T')[0],
        catatan: `Periode magang ${pdk.nama} di ${namaPerusahaan} dimulai oleh ${req.dosen.nama}`
      }]
    });
    
    res.redirect(`/dosen/magang-period/${mahasiswaId}`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal memulai periode magang: ' + error.message);
  }
});

// ============================================================================
// UPDATE PERUSAHAAN
// ============================================================================

router.post('/:periodId/update-perusahaan', async (req, res) => {
  try {
    const { periodId } = req.params;
    const {
      namaPerusahaan,
      alamatPerusahaan,
      kontakPerusahaan,
      kontakHpPerusahaan,
      emailPerusahaan,
      websitePerusahaan,
      pembimbingLapangan,
      jabatanPembimbingLapangan
    } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      return res.status(404).send('Periode magang tidak ditemukan');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    const isPembimbingDosen = await isPembimbing(req.dosen.id, mahasiswaId);
    if (!isPembimbingDosen) {
      return res.status(403).send('Anda tidak memiliki akses');
    }
    
    await periodRef.update({
      'perusahaan.nama': namaPerusahaan,
      'perusahaan.alamat': alamatPerusahaan || '',
      'perusahaan.kontak': kontakPerusahaan || '',
      'perusahaan.kontakHp': kontakHpPerusahaan || '',
      'perusahaan.email': emailPerusahaan || '',
      'perusahaan.website': websitePerusahaan || '',
      'perusahaan.pembimbingLapangan': pembimbingLapangan || '',
      'perusahaan.jabatanPembimbingLapangan': jabatanPembimbingLapangan || '',
      'perusahaan.diisiOleh': req.dosen.id,
      'perusahaan.diisiPada': new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    res.redirect(`/dosen/magang-period/${mahasiswaId}`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal update perusahaan');
  }
});

// ============================================================================
// LOCK PERIODE MAGANG
// ============================================================================

router.post('/:periodId/lock', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { reason } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      return res.status(404).send('Periode magang tidak ditemukan');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    const isPembimbingDosen = await isPembimbing(req.dosen.id, mahasiswaId);
    if (!isPembimbingDosen) {
      return res.status(403).send('Anda tidak memiliki akses');
    }
    
    if (period.status === 'completed') {
      return res.status(400).send('Magang sudah selesai, tidak bisa dikunci');
    }
    
    const lockHistory = period.lockHistory || [];
    lockHistory.push({
      action: 'locked',
      reason: reason || 'Tidak ada alasan',
      lockedBy: req.dosen.id,
      lockedByNama: req.dosen.nama,
      lockedAt: new Date().toISOString()
    });
    
    await periodRef.update({
      status: 'locked',
      lockHistory,
      updatedAt: new Date().toISOString(),
      history: [
        ...(period.history || []),
        {
          action: 'locked',
          catatan: `Periode magang dikunci oleh ${req.dosen.nama}`,
          reason: reason || 'Tidak ada alasan',
          tanggal: new Date().toISOString().split('T')[0]
        }
      ]
    });
    
    res.redirect(`/dosen/magang-period/${mahasiswaId}`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal mengunci periode magang');
  }
});

// ============================================================================
// UNLOCK PERIODE MAGANG
// ============================================================================

router.post('/:periodId/unlock', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { reason } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      return res.status(404).send('Periode magang tidak ditemukan');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    const isPembimbingDosen = await isPembimbing(req.dosen.id, mahasiswaId);
    if (!isPembimbingDosen) {
      return res.status(403).send('Anda tidak memiliki akses');
    }
    
    const lockHistory = period.lockHistory || [];
    lockHistory.push({
      action: 'unlocked',
      reason: reason || 'Tidak ada alasan',
      unlockedBy: req.dosen.id,
      unlockedByNama: req.dosen.nama,
      unlockedAt: new Date().toISOString()
    });
    
    await periodRef.update({
      status: 'active',
      lockHistory,
      updatedAt: new Date().toISOString(),
      history: [
        ...(period.history || []),
        {
          action: 'unlocked',
          catatan: `Periode magang dibuka kembali oleh ${req.dosen.nama}`,
          reason: reason || 'Tidak ada alasan',
          tanggal: new Date().toISOString().split('T')[0]
        }
      ]
    });
    
    res.redirect(`/dosen/magang-period/${mahasiswaId}`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal membuka kunci periode magang');
  }
});

// ============================================================================
// PERPANJANG PERIODE MAGANG
// ============================================================================

router.post('/:periodId/extend', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { tanggalSelesaiBaru, catatan } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      return res.status(404).send('Periode magang tidak ditemukan');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    const isPembimbingDosen = await isPembimbing(req.dosen.id, mahasiswaId);
    if (!isPembimbingDosen) {
      return res.status(403).send('Anda tidak memiliki akses');
    }
    
    const oldSelesai = period.tanggalSelesai || '-';
    
    await periodRef.update({
      tanggalSelesai: tanggalSelesaiBaru,
      updatedAt: new Date().toISOString(),
      history: [
        ...(period.history || []),
        {
          action: 'extended',
          tanggal: new Date().toISOString().split('T')[0],
          oldSelesai,
          newSelesai: tanggalSelesaiBaru,
          catatan: catatan || `Perpanjangan periode magang oleh ${req.dosen.nama}`
        }
      ]
    });
    
    res.redirect(`/dosen/magang-period/${mahasiswaId}`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal memperpanjang periode magang');
  }
});

// ============================================================================
// BERI NILAI & SELESAIKAN MAGANG
// ============================================================================

router.post('/:periodId/complete', async (req, res) => {
  try {
    const { periodId } = req.params;
    const { 
      nilaiAngka, 
      komentarNilai,
      nilaiKehadiran,
      nilaiLogbook,
      nilaiLaporan,
      nilaiSikap,
      nilaiPresentasi
    } = req.body;
    
    const periodRef = db.collection('magangPeriod').doc(periodId);
    const periodDoc = await periodRef.get();
    
    if (!periodDoc.exists) {
      return res.status(404).send('Periode magang tidak ditemukan');
    }
    
    const period = periodDoc.data();
    const mahasiswaId = period.mahasiswaId;
    
    const isPembimbingDosen = await isPembimbing(req.dosen.id, mahasiswaId);
    if (!isPembimbingDosen) {
      return res.status(403).send('Anda tidak memiliki akses');
    }
    
    // Hitung nilai huruf
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
      'nilai.dinilaiOleh': req.dosen.id,
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
        {
          action: 'completed',
          tanggal: new Date().toISOString().split('T')[0],
          nilai: nilaiAngka,
          nilaiHuruf,
          catatan: `Magang selesai dan dinilai oleh ${req.dosen.nama}`
        }
      ]
    });
    
    res.redirect(`/dosen/magang-period/${mahasiswaId}`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Gagal menyelesaikan magang: ' + error.message);
  }
});

module.exports = router;