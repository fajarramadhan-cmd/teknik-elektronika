/**
 * routes/dosen/magang.js
 * Monitoring magang untuk dosen (hanya lihat logbook mahasiswa bimbingan)
 * 
 * REVISI: 
 * - Dosen bisa menjadi Pembimbing 1 ATAU Pembimbing 2
 * - Dosen hanya bisa melihat mahasiswa yang ditetapkan sebagai bimbingannya oleh admin
 * - Mendukung 2 pembimbing per mahasiswa
 * - PEMBIMBING 2 yang bisa Approve/Reject, PEMBIMBING 1 Read Only
 */

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
 * Format tanggal ke format Indonesia
 */
function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  });
}

/**
 * Format tanggal lengkap dengan waktu
 */
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

/**
 * Ambil data mahasiswa dari ID
 */
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

/**
 * Mendapatkan daftar mahasiswa bimbingan dosen ini
 * Dosen bisa menjadi Pembimbing 1 atau Pembimbing 2
 * @param {string} dosenId - ID dosen
 * @returns {Promise<Array>} daftar mahasiswa dengan informasi bimbingan
 */
async function getMahasiswaBimbingan(dosenId) {
  try {
    // Cari bimbingan dimana dosen ini adalah Pembimbing 1 ATAU Pembimbing 2
    const bimbinganSnapshot1 = await db.collection('bimbingan')
      .where('pembimbing1Id', '==', dosenId)
      .where('status', '==', 'active')
      .get();
    
    const bimbinganSnapshot2 = await db.collection('bimbingan')
      .where('pembimbing2Id', '==', dosenId)
      .where('status', '==', 'active')
      .get();
    
    // Gabungkan hasil, hindari duplikat
    const bimbinganMap = new Map();
    
    for (const doc of bimbinganSnapshot1.docs) {
      const bimbingan = doc.data();
      bimbinganMap.set(bimbingan.mahasiswaId, {
        ...bimbingan,
        bimbinganId: doc.id,
        role: 'pembimbing1'
      });
    }
    
    for (const doc of bimbinganSnapshot2.docs) {
      const bimbingan = doc.data();
      const mahasiswaId = bimbingan.mahasiswaId;
      
      if (bimbinganMap.has(mahasiswaId)) {
        // Sudah ada sebagai pembimbing1, update role
        const existing = bimbinganMap.get(mahasiswaId);
        existing.role = 'pembimbing1_dan_2';
        existing.pembimbing2Id = bimbingan.pembimbing2Id;
        existing.pembimbing2Nama = bimbingan.pembimbing2Nama;
      } else {
        bimbinganMap.set(mahasiswaId, {
          ...bimbingan,
          bimbinganId: doc.id,
          role: 'pembimbing2'
        });
      }
    }
    
    if (bimbinganMap.size === 0) return [];
    
    const mahasiswaList = [];
    for (const [mahasiswaId, bimbingan] of bimbinganMap) {
      const mahasiswa = await getMahasiswa(mahasiswaId);
      
      if (mahasiswa && mahasiswa.nama !== 'Unknown') {
        mahasiswaList.push({
          ...mahasiswa,
          bimbinganId: bimbingan.bimbinganId,
          semester: bimbingan.semester,
          tahunAjaran: bimbingan.tahunAjaran || '-',
          role: bimbingan.role,
          pembimbing1Id: bimbingan.pembimbing1Id,
          pembimbing1Nama: bimbingan.pembimbing1Nama,
          pembimbing2Id: bimbingan.pembimbing2Id,
          pembimbing2Nama: bimbingan.pembimbing2Nama
        });
      }
    }
    
    return mahasiswaList;
  } catch (error) {
    console.error('Error getMahasiswaBimbingan:', error);
    return [];
  }
}

/**
 * Mendapatkan statistik logbook untuk seorang mahasiswa
 * @param {string} mahasiswaId - ID mahasiswa
 * @returns {Promise<Object>} statistik logbook
 */
async function getLogbookStatistik(mahasiswaId) {
  try {
    const logbookSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', mahasiswaId)
      .get();
    
    const totalLogbook = logbookSnapshot.size;
    
    const pendingSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', mahasiswaId)
      .where('status', '==', 'pending')
      .get();
    const pendingCount = pendingSnapshot.size;
    
    const approvedSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', mahasiswaId)
      .where('status', '==', 'approved')
      .get();
    const approvedCount = approvedSnapshot.size;
    
    const rejectedSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', mahasiswaId)
      .where('status', '==', 'rejected')
      .get();
    const rejectedCount = rejectedSnapshot.size;
    
    return {
      totalLogbook,
      pendingCount,
      approvedCount,
      rejectedCount
    };
  } catch (error) {
    console.error('Error getLogbookStatistik:', error);
    return { totalLogbook: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0 };
  }
}

/**
 * Validasi apakah mahasiswa ini dibimbing oleh dosen yang login
 * (sebagai Pembimbing 1 ATAU Pembimbing 2)
 * @param {string} dosenId - ID dosen
 * @param {string} mahasiswaId - ID mahasiswa
 * @returns {Promise<Object>} { isBimbingan: boolean, role: string|null }
 */
async function isMahasiswaBimbingan(dosenId, mahasiswaId) {
  try {
    const snapshot = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    
    if (snapshot.empty) return { isBimbingan: false, role: null };
    
    const bimbingan = snapshot.docs[0].data();
    
    if (bimbingan.pembimbing1Id === dosenId) {
      return { isBimbingan: true, role: 'pembimbing1' };
    }
    if (bimbingan.pembimbing2Id === dosenId) {
      return { isBimbingan: true, role: 'pembimbing2' };
    }
    
    return { isBimbingan: false, role: null };
  } catch (error) {
    console.error('Error isMahasiswaBimbingan:', error);
    return { isBimbingan: false, role: null };
  }
}

/**
 * Cek apakah dosen ini bisa approve (hanya Pembimbing 2)
 * @param {string} dosenId - ID dosen
 * @param {string} mahasiswaId - ID mahasiswa
 * @returns {Promise<boolean>}
 */
async function canApprove(dosenId, mahasiswaId) {
  const { role } = await isMahasiswaBimbingan(dosenId, mahasiswaId);
  return role === 'pembimbing2'; // ✅ HANYA PEMBIMBING 2 YANG BISA APPROVE
}

// ============================================================================
// DAFTAR MAHASISWA BIMBINGAN
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const mahasiswaList = await getMahasiswaBimbingan(req.dosen.id);
    
    if (mahasiswaList.length === 0) {
      return res.render('dosen/magang_list', {
        title: 'Monitoring Magang',
        mahasiswaList: [],
        message: 'Anda belum memiliki mahasiswa bimbingan. Silakan hubungi admin.'
      });
    }
    
    // Tambahkan statistik untuk setiap mahasiswa
    for (const mhs of mahasiswaList) {
      const statistik = await getLogbookStatistik(mhs.id);
      mhs.totalLogbook = statistik.totalLogbook;
      mhs.pendingCount = statistik.pendingCount;
      mhs.approvedCount = statistik.approvedCount;
      mhs.rejectedCount = statistik.rejectedCount;
    }
    
    mahasiswaList.sort((a, b) => a.nama.localeCompare(b.nama));
    
    res.render('dosen/magang_list', {
      title: 'Monitoring Magang',
      mahasiswaList,
      message: null
    });
  } catch (error) {
    console.error('Error ambil daftar mahasiswa bimbingan:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat data mahasiswa bimbingan' 
    });
  }
});

// ============================================================================
// DETAIL LOGBOOK MAHASISWA BIMBINGAN
// ============================================================================

router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { semester } = req.query; // ✅ Ambil parameter semester dari query string
    
    // Validasi akses
    const { isBimbingan, role } = await isMahasiswaBimbingan(req.dosen.id, userId);
    if (!isBimbingan) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki akses ke logbook mahasiswa ini.'
      });
    }
    
    const mahasiswa = await getMahasiswa(userId);
    if (mahasiswa.nama === 'Unknown') {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan.'
      });
    }
    
    // Ambil semua logbook
    let logbookQuery = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc');
    
    // ✅ Filter berdasarkan semester jika ada
    if (semester) {
      logbookQuery = logbookQuery.where('semester', '==', semester);
    }
    
    const logbookSnapshot = await logbookQuery.get();
    
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
    
    // Ambil daftar semester unik untuk filter
    const allLogbookSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .get();
    
    const semesterSet = new Set();
    allLogbookSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.semester) semesterSet.add(data.semester);
    });
    const semesterList = Array.from(semesterSet).sort();
    
    res.render('dosen/magang_detail', {
      title: `Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      semesterList,
      selectedSemester: semester || '', // ✅ KIRIMKAN selectedSemester KE VIEW
      role,
      canApprove: role === 'pembimbing2',
      isPembimbing1: role === 'pembimbing1',
      isPembimbing2: role === 'pembimbing2',
      pembimbing1Nama: mahasiswa.pembimbing1Nama,
      pembimbing2Nama: mahasiswa.pembimbing2Nama
    });
  } catch (error) {
    console.error('Error ambil logbook mahasiswa:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat logbook mahasiswa' 
    });
  }
});

// ============================================================================
// APPROVE LOGBOOK (HANYA PEMBIMBING 2)
// ============================================================================

router.post('/logbook/:id/approve', async (req, res) => {
  try {
    const logbookId = req.params.id;
    
    const logbookDoc = await db.collection('logbookMagang').doc(logbookId).get();
    if (!logbookDoc.exists) {
      req.session = req.session || {};
      req.session.error = 'Logbook tidak ditemukan';
      return res.redirect('back');
    }
    
    const logbook = logbookDoc.data();
    const mahasiswaId = logbook.userId;
    
    // ✅ Validasi: Hanya Pembimbing 2 yang bisa approve
    const canApproveFlag = await canApprove(req.dosen.id, mahasiswaId);
    if (!canApproveFlag) {
      req.session.error = 'Hanya Pembimbing 2 yang dapat menyetujui logbook';
      return res.redirect('back');
    }
    
    // Update status logbook
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
// REJECT LOGBOOK (HANYA PEMBIMBING 2)
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
    
    // ✅ Validasi: Hanya Pembimbing 2 yang bisa reject
    const canApproveFlag = await canApprove(req.dosen.id, mahasiswaId);
    if (!canApproveFlag) {
      req.session.error = 'Hanya Pembimbing 2 yang dapat menolak logbook';
      return res.redirect('back');
    }
    
    // Update status logbook
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
// CETAK LOGBOOK MAHASISWA BIMBINGAN
// ============================================================================

router.get('/print/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { semester } = req.query;
    
    const { isBimbingan } = await isMahasiswaBimbingan(req.dosen.id, userId);
    if (!isBimbingan) {
      return res.status(403).send('Anda tidak memiliki akses ke logbook mahasiswa ini.');
    }
    
    const mahasiswa = await getMahasiswa(userId);
    
    let query = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'asc');
    
    if (semester) {
      query = query.where('semester', '==', semester);
    }
    
    const snapshot = await query.get();
    const logbookList = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        tanggalFormatted: formatDate(data.tanggal)
      };
    });
    
    const totalDurasi = logbookList.reduce((sum, item) => sum + (parseFloat(item.durasi) || 0), 0);
    const filterInfo = semester ? `Semester: ${semester}` : 'Semua Semester';
    
    res.render('dosen/magang_print', {
      title: `Cetak Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      totalDurasi,
      filterInfo,
      selectedSemester: semester || '', // ✅ KIRIMKAN JUGA KE PRINT VIEW
      generatedAt: formatDateTime(new Date().toISOString())
    });
  } catch (error) {
    console.error('Error print logbook dosen:', error);
    res.status(500).send('Gagal mencetak logbook');
  }
});

// ============================================================================
// API ENDPOINT (untuk AJAX)
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
    
    const { isBimbingan } = await isMahasiswaBimbingan(req.dosen.id, userId);
    if (!isBimbingan) {
      return res.status(403).json({ success: false, error: 'Akses ditolak' });
    }
    
    const snapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc')
      .get();
    
    const logbookList = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      tanggalFormatted: formatDate(doc.data().tanggal)
    }));
    
    res.json({ success: true, data: logbookList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;