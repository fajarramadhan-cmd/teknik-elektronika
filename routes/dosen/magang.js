/**
 * routes/dosen/magang.js
 * Monitoring magang untuk dosen (hanya lihat logbook mahasiswa bimbingan)
 * 
 * OPTIMASI: Gunakan Promise.all untuk paralelisasi query, tanpa mengubah logika bisnis.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU (SAMA PERSIS DENGAN ASLINYA)
// ============================================================================

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Cache sederhana untuk getMahasiswa (per request) - akan di-reset di setiap route utama
let mahasiswaCache = new Map();

async function getMahasiswa(userId) {
  if (mahasiswaCache.has(userId)) return mahasiswaCache.get(userId);
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const result = userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : { id: userId, nama: 'Unknown', nim: '-' };
    mahasiswaCache.set(userId, result);
    return result;
  } catch (error) {
    console.error('Error getMahasiswa:', error);
    return { id: userId, nama: 'Error', nim: '-' };
  }
}

async function getMahasiswaBimbingan(dosenId) {
  try {
    // Query paralel untuk pembimbing1 dan pembimbing2
    const [snap1, snap2] = await Promise.all([
      db.collection('bimbingan').where('pembimbing1Id', '==', dosenId).where('status', '==', 'active').get(),
      db.collection('bimbingan').where('pembimbing2Id', '==', dosenId).where('status', '==', 'active').get()
    ]);

    const bimbinganMap = new Map();
    for (const doc of snap1.docs) {
      const data = doc.data();
      bimbinganMap.set(data.mahasiswaId, { ...data, bimbinganId: doc.id, role: 'pembimbing1' });
    }
    for (const doc of snap2.docs) {
      const data = doc.data();
      const mahasiswaId = data.mahasiswaId;
      if (bimbinganMap.has(mahasiswaId)) {
        const existing = bimbinganMap.get(mahasiswaId);
        existing.role = 'pembimbing1_dan_2';
        existing.pembimbing2Id = data.pembimbing2Id;
        existing.pembimbing2Nama = data.pembimbing2Nama;
      } else {
        bimbinganMap.set(mahasiswaId, { ...data, bimbinganId: doc.id, role: 'pembimbing2' });
      }
    }

    if (bimbinganMap.size === 0) return [];

    // Ambil semua data mahasiswa secara paralel
    const mahasiswaIds = Array.from(bimbinganMap.keys());
    const mahasiswaResults = await Promise.all(mahasiswaIds.map(id => getMahasiswa(id)));

    // Ambil periode magang aktif untuk semua mahasiswa secara paralel
    const periodSnapshots = await Promise.all(
      mahasiswaIds.map(id => db.collection('magangPeriod').where('mahasiswaId', '==', id).where('status', '==', 'active').get())
    );

    const result = [];
    for (let i = 0; i < mahasiswaIds.length; i++) {
      const mahasiswaId = mahasiswaIds[i];
      const bimbingan = bimbinganMap.get(mahasiswaId);
      const mahasiswa = mahasiswaResults[i];
      const periodSnapshot = periodSnapshots[i];

      if (mahasiswa && mahasiswa.nama !== 'Unknown') {
        const activePeriods = periodSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        result.push({
          ...mahasiswa,
          bimbinganId: bimbingan.bimbinganId,
          semester: bimbingan.semester,
          tahunAjaran: bimbingan.tahunAjaran || '-',
          role: bimbingan.role,
          pembimbing1Id: bimbingan.pembimbing1Id,
          pembimbing1Nama: bimbingan.pembimbing1Nama,
          pembimbing2Id: bimbingan.pembimbing2Id,
          pembimbing2Nama: bimbingan.pembimbing2Nama,
          activePeriods
        });
      }
    }
    return result;
  } catch (error) {
    console.error('Error getMahasiswaBimbingan:', error);
    return [];
  }
}

async function getLogbookStatistik(mahasiswaId, pdkId = null) {
  try {
    let baseQuery = db.collection('logbookMagang').where('userId', '==', mahasiswaId);
    if (pdkId) baseQuery = baseQuery.where('pdkId', '==', pdkId);
    
    const [totalSnapshot, pendingSnapshot, approvedSnapshot, rejectedSnapshot] = await Promise.all([
      baseQuery.get(),
      baseQuery.where('status', '==', 'pending').get(),
      baseQuery.where('status', '==', 'approved').get(),
      baseQuery.where('status', '==', 'rejected').get()
    ]);
    
    return {
      totalLogbook: totalSnapshot.size,
      pendingCount: pendingSnapshot.size,
      approvedCount: approvedSnapshot.size,
      rejectedCount: rejectedSnapshot.size
    };
  } catch (error) {
    console.error('Error getLogbookStatistik:', error);
    return { totalLogbook: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0 };
  }
}

async function isMahasiswaBimbingan(dosenId, mahasiswaId) {
  try {
    const snapshot = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (snapshot.empty) return { isBimbingan: false, role: null };
    const bimbingan = snapshot.docs[0].data();
    if (bimbingan.pembimbing1Id === dosenId) return { isBimbingan: true, role: 'pembimbing1' };
    if (bimbingan.pembimbing2Id === dosenId) return { isBimbingan: true, role: 'pembimbing2' };
    return { isBimbingan: false, role: null };
  } catch (error) {
    console.error('Error isMahasiswaBimbingan:', error);
    return { isBimbingan: false, role: null };
  }
}

async function canApprove(dosenId, mahasiswaId) {
  const { role } = await isMahasiswaBimbingan(dosenId, mahasiswaId);
  return role === 'pembimbing2';
}

async function isMagangPeriodActive(mahasiswaId, pdkId) {
  try {
    const snapshot = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('pdkId', '==', pdkId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    return !snapshot.empty;
  } catch (error) {
    console.error('Error isMagangPeriodActive:', error);
    return false;
  }
}

async function getActiveMagangPeriods(mahasiswaId) {
  try {
    const snapshot = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getActiveMagangPeriods:', error);
    return [];
  }
}

// ============================================================================
// ROUTE DAFTAR MAHASISWA BIMBINGAN
// ============================================================================
router.get('/', async (req, res) => {
  try {
    mahasiswaCache.clear(); // Reset cache per request
    let mahasiswaList = await getMahasiswaBimbingan(req.dosen.id);
    
    if (mahasiswaList.length === 0) {
      return res.render('dosen/magang_list', {
        title: 'Monitoring Magang',
        mahasiswaList: [],
        message: 'Anda belum memiliki mahasiswa bimbingan. Silakan hubungi admin.'
      });
    }
    
    // Kumpulkan semua data tambahan secara paralel
    const enrollmentPromises = mahasiswaList.map(mhs =>
      db.collection('enrollment').where('userId', '==', mhs.id).where('status', '==', 'active').get()
    );
    const periodActivePromises = mahasiswaList.map(mhs =>
      db.collection('magangPeriod').where('mahasiswaId', '==', mhs.id).where('status', '==', 'active').limit(1).get()
    );
    const statistikPromises = mahasiswaList.map(mhs => getLogbookStatistik(mhs.id));
    
    const [enrollmentSnapshots, periodActiveSnapshots, statsResults] = await Promise.all([
      Promise.all(enrollmentPromises),
      Promise.all(periodActivePromises),
      Promise.all(statistikPromises)
    ]);
    
    for (let i = 0; i < mahasiswaList.length; i++) {
      const mhs = mahasiswaList[i];
      const enrolmentSnapshot = enrollmentSnapshots[i];
      const periodActiveSnapshot = periodActiveSnapshots[i];
      const stats = statsResults[i];
      
      // enrolledPdks
      const enrolledPdks = [];
      for (const doc of enrolmentSnapshot.docs) {
        const enrollment = doc.data();
        const mkDoc = await db.collection('mataKuliah').doc(enrollment.mkId).get();
        if (mkDoc.exists && mkDoc.data().isPDK === true) {
          enrolledPdks.push({
            id: mkDoc.id,
            kode: mkDoc.data().kode,
            nama: mkDoc.data().nama,
            urutan: mkDoc.data().urutanPDK
          });
        }
      }
      mhs.enrolledPdks = enrolledPdks;
      mhs.hasActivePeriod = !periodActiveSnapshot.empty;
      mhs.totalLogbook = stats.totalLogbook;
      mhs.pendingCount = stats.pendingCount;
      mhs.approvedCount = stats.approvedCount;
      mhs.rejectedCount = stats.rejectedCount;
    }
    
    mahasiswaList.sort((a, b) => a.nama.localeCompare(b.nama));
    res.render('dosen/magang_list', {
      title: 'Monitoring Magang',
      mahasiswaList,
      message: null
    });
  } catch (error) {
    console.error('Error ambil daftar mahasiswa bimbingan:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data mahasiswa bimbingan' });
  }
});

// ============================================================================
// ROUTE DETAIL LOGBOOK MAHASISWA
// ============================================================================
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { periodId, semester } = req.query;
    
    const { isBimbingan, role } = await isMahasiswaBimbingan(req.dosen.id, userId);
    if (!isBimbingan) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki akses ke logbook mahasiswa ini.'
      });
    }
    
    const mahasiswa = await getMahasiswa(userId);
    if (mahasiswa.nama === 'Unknown') {
      return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Mahasiswa tidak ditemukan.' });
    }
    
    const allPeriods = await getActiveMagangPeriods(userId);
    let selectedPeriod = null;
    if (periodId) selectedPeriod = allPeriods.find(p => p.id === periodId);
    else if (allPeriods.length > 0) selectedPeriod = allPeriods[0];
    
    // Query logbook utama (pakai orderBy)
    let logbookQuery = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc');
    if (selectedPeriod) logbookQuery = logbookQuery.where('pdkId', '==', selectedPeriod.pdkId);
    if (semester) logbookQuery = logbookQuery.where('semester', '==', semester);
    
    // Ambil juga semua logbook untuk semester list
    const allLogbookQuery = db.collection('logbookMagang').where('userId', '==', userId);
    
    const [logbookSnapshot, allLogbookSnapshot] = await Promise.all([
      logbookQuery.get(),
      allLogbookQuery.get()
    ]);
    
    const logbookList = logbookSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        tanggalFormatted: formatDate(data.tanggal),
        tanggalWaktuFormatted: formatDateTime(data.tanggal),
        canApprove: role === 'pembimbing2' && data.status === 'pending'
      };
    });
    
    // Semester list
    const semesterSet = new Set();
    allLogbookSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.semester) semesterSet.add(data.semester);
    });
    const semesterList = Array.from(semesterSet).sort();
    
    // Statistik per PDK
    const pdkStats = [];
    for (const period of allPeriods) {
      const stats = await getLogbookStatistik(userId, period.pdkId);
      pdkStats.push({ ...period, ...stats });
    }
    
    res.render('dosen/magang_detail', {
      title: `Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      semesterList,
      selectedSemester: semester || '',
      allPeriods,
      selectedPeriod,
      pdkStats,
      role,
      canApprove: role === 'pembimbing2',
      isPembimbing1: role === 'pembimbing1',
      isPembimbing2: role === 'pembimbing2',
      pembimbing1Nama: mahasiswa.pembimbing1Nama,
      pembimbing2Nama: mahasiswa.pembimbing2Nama,
      user: req.user
    });
  } catch (error) {
    console.error('Error ambil logbook mahasiswa:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat logbook mahasiswa' });
  }
});

// ============================================================================
// ROUTE DETAIL SATU LOGBOOK
// ============================================================================
router.get('/logbook/:id', async (req, res) => {
  try {
    const logbookId = req.params.id;
    const logbookDoc = await db.collection('logbookMagang').doc(logbookId).get();
    if (!logbookDoc.exists) {
      return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Logbook tidak ditemukan' });
    }
    const logbook = logbookDoc.data();
    const mahasiswa = await getMahasiswa(logbook.userId);
    const { isBimbingan, role } = await isMahasiswaBimbingan(req.dosen.id, logbook.userId);
    if (!isBimbingan) {
      return res.status(403).render('error', { title: 'Akses Ditolak', message: 'Anda tidak memiliki akses ke logbook ini.' });
    }
    res.render('dosen/magang_logbook_detail', {
      title: 'Detail Logbook',
      logbook,
      mahasiswa,
      tanggalFormatted: formatDate(logbook.tanggal),
      tanggalWaktuFormatted: formatDateTime(logbook.tanggal),
      role,
      canApprove: role === 'pembimbing2' && logbook.status === 'pending',
      user: req.user
    });
  } catch (error) {
    console.error('Error detail logbook:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail logbook' });
  }
});

// ============================================================================
// APPROVE LOGBOOK
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
    const pdkId = logbook.pdkId;
    
    const canApproveFlag = await canApprove(req.dosen.id, mahasiswaId);
    if (!canApproveFlag) {
      req.session.error = 'Hanya Pembimbing 2 yang dapat menyetujui logbook';
      return res.redirect('back');
    }
    const isActive = await isMagangPeriodActive(mahasiswaId, pdkId);
    if (!isActive) {
      req.session.error = 'Periode magang sudah berakhir, tidak dapat menyetujui logbook';
      return res.redirect('back');
    }
    await logbookDoc.ref.update({
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.dosen.id,
      approvedByNama: req.dosen.nama,
      approvedByRole: 'Pembimbing 2'
    });
    req.session.success = 'Logbook berhasil disetujui';
    res.redirect(`/dosen/magang/${mahasiswaId}`);
  } catch (error) {
    console.error('Error approve logbook:', error);
    req.session.error = 'Gagal menyetujui logbook';
    res.redirect('back');
  }
});

// ============================================================================
// REJECT LOGBOOK
// ============================================================================
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
    const pdkId = logbook.pdkId;
    
    const canApproveFlag = await canApprove(req.dosen.id, mahasiswaId);
    if (!canApproveFlag) {
      req.session.error = 'Hanya Pembimbing 2 yang dapat menolak logbook';
      return res.redirect('back');
    }
    const isActive = await isMagangPeriodActive(mahasiswaId, pdkId);
    if (!isActive) {
      req.session.error = 'Periode magang sudah berakhir, tidak dapat menolak logbook';
      return res.redirect('back');
    }
    await logbookDoc.ref.update({
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.dosen.id,
      rejectedByNama: req.dosen.nama,
      rejectedByRole: 'Pembimbing 2',
      rejectionReason: alasan || 'Tidak ada alasan'
    });
    req.session.success = 'Logbook berhasil ditolak';
    res.redirect(`/dosen/magang/${mahasiswaId}`);
  } catch (error) {
    console.error('Error reject logbook:', error);
    req.session.error = 'Gagal menolak logbook';
    res.redirect('back');
  }
});

// ============================================================================
// CETAK LOGBOOK
// ============================================================================
router.get('/print/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { periodId, semester } = req.query;
    const { isBimbingan } = await isMahasiswaBimbingan(req.dosen.id, userId);
    if (!isBimbingan) {
      return res.status(403).send('Anda tidak memiliki akses ke logbook mahasiswa ini.');
    }
    const mahasiswa = await getMahasiswa(userId);
    let query = db.collection('logbookMagang').where('userId', '==', userId).orderBy('tanggal', 'asc');
    if (periodId) {
      const periodDoc = await db.collection('magangPeriod').doc(periodId).get();
      if (periodDoc.exists) {
        const period = periodDoc.data();
        query = query.where('pdkId', '==', period.pdkId);
      }
    }
    if (semester) query = query.where('semester', '==', semester);
    const snapshot = await query.get();
    const logbookList = snapshot.docs.map(doc => ({ ...doc.data(), tanggalFormatted: formatDate(doc.data().tanggal) }));
    const totalDurasi = logbookList.reduce((sum, item) => sum + (parseFloat(item.durasi) || 0), 0);
    const filterInfo = [];
    if (periodId) filterInfo.push(`Periode: ${periodId}`);
    if (semester) filterInfo.push(`Semester: ${semester}`);
    const filterText = filterInfo.length > 0 ? filterInfo.join(' | ') : 'Semua Data';
    let pdkInfo = null;
    if (periodId) {
      const periodDoc = await db.collection('magangPeriod').doc(periodId).get();
      if (periodDoc.exists) pdkInfo = periodDoc.data();
    }
    res.render('dosen/magang_print', {
      title: `Cetak Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      totalDurasi,
      totalEntries: logbookList.length,
      filterInfo: filterText,
      pdkInfo,
      selectedSemester: semester || '',
      generatedAt: formatDateTime(new Date().toISOString()),
      user: req.user
    });
  } catch (error) {
    console.error('Error print logbook dosen:', error);
    res.status(500).send('Gagal mencetak logbook');
  }
});

// ============================================================================
// API ENDPOINTS
// ============================================================================
router.get('/api/bimbingan', async (req, res) => {
  try {
    const mahasiswaList = await getMahasiswaBimbingan(req.dosen.id);
    res.json({ success: true, data: mahasiswaList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/logbook/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { periodId } = req.query;
    const { isBimbingan } = await isMahasiswaBimbingan(req.dosen.id, userId);
    if (!isBimbingan) return res.status(403).json({ success: false, error: 'Akses ditolak' });
    let query = db.collection('logbookMagang').where('userId', '==', userId).orderBy('tanggal', 'desc');
    if (periodId) query = query.where('pdkId', '==', periodId);
    const snapshot = await query.get();
    const logbookList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), tanggalFormatted: formatDate(doc.data().tanggal) }));
    res.json({ success: true, data: logbookList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/periods/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { isBimbingan } = await isMahasiswaBimbingan(req.dosen.id, userId);
    if (!isBimbingan) return res.status(403).json({ success: false, error: 'Akses ditolak' });
    const periods = await getActiveMagangPeriods(userId);
    res.json({ success: true, data: periods });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;