/**
 * routes/admin/emagang.js
 * E‑Magang - Admin melihat logbook mahasiswa dengan filter MK PDK
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

// ============================================================================
// RUTE UTAMA – DAFTAR LOGBOOK
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { mahasiswaId, courseId, semester, startDate, endDate, search } = req.query;

    let query = db.collection('logbookMagang').orderBy('tanggal', 'desc');

    if (mahasiswaId) query = query.where('userId', '==', mahasiswaId);
    if (courseId) query = query.where('courseId', '==', courseId);
    if (semester) query = query.where('semester', '==', semester);
    if (startDate && endDate) {
      query = query.where('tanggal', '>=', startDate).where('tanggal', '<=', endDate);
    } else if (startDate) {
      query = query.where('tanggal', '>=', startDate);
    } else if (endDate) {
      query = query.where('tanggal', '<=', endDate);
    }

    const snapshot = await query.get();

    // Tampung semua logbook yang memenuhi filter
    const allLogbook = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);

      if (search && !data.kegiatan.toLowerCase().includes(search.toLowerCase())) {
        continue;
      }

      let courseName = '';
      if (data.courseId) {
        const mkDoc = await db.collection('mataKuliah').doc(data.courseId).get();
        if (mkDoc.exists) courseName = mkDoc.data().nama;
      }

      allLogbook.push({
        id: doc.id,
        ...data,
        mahasiswa,
        courseName,
        tanggalFormatted: formatDate(data.tanggal)
      });
    }

    // Grouping per mahasiswa: ambil logbook terbaru (karena sudah diurutkan descending)
    const latestMap = new Map();
    allLogbook.forEach(item => {
      const mId = item.mahasiswa?.id;
      if (!mId) return;
      if (!latestMap.has(mId)) {
        latestMap.set(mId, item); // item pertama adalah yang terbaru
      }
    });
    const logbookList = Array.from(latestMap.values());

    // Ambil daftar mahasiswa untuk dropdown (tanpa duplikasi)
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nama')
      .get();
    const mahasiswaList = mahasiswaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Ambil daftar mata kuliah PDK untuk dropdown
    const pdkSnapshot = await db.collection('mataKuliah')
      .where('kode', '>=', 'PDK')
      .where('kode', '<=', 'PDK\uf8ff')
      .orderBy('kode')
      .get();
    const pdkCourses = pdkSnapshot.docs.map(doc => ({ id: doc.id, kode: doc.data().kode, nama: doc.data().nama }));

    res.render('admin/emagang_list', {
      title: 'E‑Magang - Logbook Mahasiswa',
      logbookList,        // sudah berisi satu baris per mahasiswa (logbook terbaru)
      mahasiswaList,
      pdkCourses,
      filters: { mahasiswaId, courseId, semester, startDate, endDate, search }
    });

  } catch (error) {
    console.error('Error mengambil logbook:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data logbook' });
  }
});

// ============================================================================
// DETAIL LOGBOOK PER MAHASISWA
// ============================================================================
router.get('/mahasiswa/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { semester } = req.query; // filter semester

    const mahasiswa = await getMahasiswa(userId);
    if (!mahasiswa.nama || mahasiswa.nama === 'Unknown') {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }

    // Bangun query dasar
    let query = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc');

    if (semester) {
      query = query.where('semester', '==', semester);
    }

    const snapshot = await query.get();

    const logbookList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      let courseName = '';
      if (data.courseId) {
        const mkDoc = await db.collection('mataKuliah').doc(data.courseId).get();
        if (mkDoc.exists) courseName = mkDoc.data().nama;
      }
      logbookList.push({
        id: doc.id,
        ...data,
        courseName,
        tanggalFormatted: formatDate(data.tanggal)
      });
    }

    // Ambil semua semester yang pernah diisi oleh mahasiswa ini (untuk dropdown filter)
    const allSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .get();
    const semesterSet = new Set();
    allSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.semester) semesterSet.add(data.semester);
    });
    const semesterList = Array.from(semesterSet).sort();

    res.render('admin/emagang_mahasiswa', {
      title: `Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      semesterList,
      selectedSemester: semester || ''
    });

  } catch (error) {
    console.error('Error mengambil logbook mahasiswa:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data logbook' });
  }
});
// GET /admin/emagang/mahasiswa/:userId
router.get('/mahasiswa/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { semester } = req.query; // filter semester

    const mahasiswa = await getMahasiswa(userId);
    if (!mahasiswa.nama || mahasiswa.nama === 'Unknown') {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }

    // Bangun query
    let query = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc');

    if (semester) {
      query = query.where('semester', '==', semester);
    }

    const snapshot = await query.get();

    const logbookList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      let courseName = '';
      if (data.courseId) {
        const mkDoc = await db.collection('mataKuliah').doc(data.courseId).get();
        if (mkDoc.exists) courseName = mkDoc.data().nama;
      }
      logbookList.push({
        id: doc.id,
        ...data,
        courseName,
        tanggalFormatted: formatDate(data.tanggal)
      });
    }

    // Ambil daftar semester unik untuk dropdown filter
    const allSemesterSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .get();
    const semesterSet = new Set();
    allSemesterSnapshot.docs.forEach(doc => {
      if (doc.data().semester) semesterSet.add(doc.data().semester);
    });
    const semesterList = Array.from(semesterSet).sort();

    res.render('admin/emagang_mahasiswa', {
      title: `Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      semesterList,
      selectedSemester: semester || ''
    });

  } catch (error) {
    console.error('Error mengambil logbook mahasiswa:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal mengambil data logbook' });
  }
});

// ============================================================================
// APPROVE LOGBOOK
// ============================================================================
router.post('/logbook/:id/approve', async (req, res) => {
  try {
    await db.collection('logbookMagang').doc(req.params.id).update({
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id
    });
    // Redirect kembali ke halaman mahasiswa
    const logbookDoc = await db.collection('logbookMagang').doc(req.params.id).get();
    const userId = logbookDoc.data().userId;
    res.redirect(`/admin/emagang/mahasiswa/${userId}`);
  } catch (error) {
    console.error('Error approve logbook:', error);
    res.status(500).send('Gagal menyetujui logbook');
  }
});

// ============================================================================
// REJECT LOGBOOK
// ============================================================================
router.post('/logbook/:id/reject', async (req, res) => {
  try {
    await db.collection('logbookMagang').doc(req.params.id).update({
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.id
    });
    const logbookDoc = await db.collection('logbookMagang').doc(req.params.id).get();
    const userId = logbookDoc.data().userId;
    res.redirect(`/admin/emagang/mahasiswa/${userId}`);
  } catch (error) {
    console.error('Error reject logbook:', error);
    res.status(500).send('Gagal menolak logbook');
  }
});
// ============================================================================
// CETAK LOGBOOK (ADMIN)
// ============================================================================
router.get('/print', async (req, res) => {
  try {
    const { userId, semester } = req.query;
    let query = db.collection('logbookMagang').orderBy('tanggal', 'asc');

    if (userId) {
      query = query.where('userId', '==', userId);
    }
    if (semester) {
      query = query.where('semester', '==', semester);
    }

    const snapshot = await query.get();
    const logbookList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      logbookList.push({
        ...data,
        mahasiswa,
        tanggalFormatted: formatDate(data.tanggal)
      });
    }

    // Jika tidak ada filter userId, kelompokkan per mahasiswa
    let grouped = {};
    if (!userId) {
      logbookList.forEach(item => {
        if (!grouped[item.userId]) {
          grouped[item.userId] = {
            mahasiswa: item.mahasiswa,
            entries: []
          };
        }
        grouped[item.userId].entries.push(item);
      });
    }

    // Hitung total durasi per mahasiswa
    for (let key in grouped) {
      grouped[key].totalDurasi = grouped[key].entries.reduce((sum, e) => sum + (parseFloat(e.durasi) || 0), 0);
    }

    const filterInfo = [];
    if (userId) {
      const m = await getMahasiswa(userId);
      filterInfo.push(`Mahasiswa: ${m.nama}`);
    }
    if (semester) filterInfo.push(`Semester: ${semester}`);

    res.render('admin/emagang_print', {
      title: 'Cetak Logbook',
      grouped,
      logbookList: userId ? logbookList : null,
      filterInfo: filterInfo.join(' | ') || 'Semua data',
      generatedAt: new Date().toLocaleString('id-ID')
    });
  } catch (error) {
    console.error('Error print logbook:', error);
    res.status(500).send('Gagal mencetak logbook');
  }
});

module.exports = router;