const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper'); // <-- IMPORT HELPER

router.use(verifyToken);
router.use(isDosen);

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

router.get('/', async (req, res) => {
  try {
    const dosen = req.dosen;

    // ========================================================================
    // 0. Semester saat ini (untuk ditampilkan di dashboard)
    // ========================================================================
    const currentSemester = getCurrentAcademicSemester(); // dapatkan semester saat ini

    // ========================================================================
    // 1. Mata Kuliah yang diampu dan progress pertemuan
    // ========================================================================
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .get();
    const mkList = mkSnapshot.docs.map(doc => ({
      id: doc.id,
      kode: doc.data().kode,
      nama: doc.data().nama,
      semester: doc.data().semester,
      sks: doc.data().sks,
      materi: doc.data().materi || []
    }));
    const mkCount = mkList.length;

    const PERTEMUAN_PER_MK = 16;
    let totalPertemuanTerlaksana = 0;
    for (const mk of mkList) {
      const terlaksana = mk.materi.filter(m => m.status === 'selesai').length;
      totalPertemuanTerlaksana += terlaksana;
    }
    const totalPertemuanMax = mkCount * PERTEMUAN_PER_MK;
    const persentasePengajaran = totalPertemuanMax > 0 
      ? Math.round((totalPertemuanTerlaksana / totalPertemuanMax) * 100) 
      : 0;

    // ========================================================================
    // 2. Total mahasiswa bimbingan
    // ========================================================================
    const bimbingan1 = await db.collection('bimbingan')
      .where('pembimbing1Id', '==', req.dosen.id)
      .where('status', '==', 'active')
      .get();
    const bimbingan2 = await db.collection('bimbingan')
      .where('pembimbing2Id', '==', req.dosen.id)
      .where('status', '==', 'active')
      .get();
    const mahasiswaBimbinganIds = new Set();
    bimbingan1.docs.forEach(doc => mahasiswaBimbinganIds.add(doc.data().mahasiswaId));
    bimbingan2.docs.forEach(doc => mahasiswaBimbinganIds.add(doc.data().mahasiswaId));
    const totalMahasiswa = mahasiswaBimbinganIds.size;

    // ========================================================================
    // 3. Tugas aktif
    // ========================================================================
    const now = new Date().toISOString();
    const tugasSnapshot = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .where('deadline', '>', now)
      .get();
    const tugasAktif = tugasSnapshot.size;

    // ========================================================================
    // 4. Pengumpulan belum dinilai
    // ========================================================================
    let pengumpulanBelumDinilai = 0;
    const tugasSemua = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .get();
    for (const tugasDoc of tugasSemua.docs) {
      const pengumpulanSnap = await db.collection('pengumpulan')
        .where('tugasId', '==', tugasDoc.id)
        .where('status', '==', 'dikumpulkan')
        .get();
      pengumpulanBelumDinilai += pengumpulanSnap.size;
    }

    // ========================================================================
    // 5. Event terdekat
    // ========================================================================
    const today = new Date().toISOString().split('T')[0];
    const eventsSnapshot = await db.collection('jadwalPenting')
      .where('tanggal', '>=', today)
      .orderBy('tanggal', 'asc')
      .limit(5)
      .get();
    const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // ========================================================================
    // 6. Logbook: daftar pending + statistik approved/total
    // ========================================================================
    let totalLogbookAll = 0;
    let totalLogbookApproved = 0;
    const logbookPendingList = [];

    for (const mahasiswaId of mahasiswaBimbinganIds) {
      const logbookSnap = await db.collection('logbookMagang')
        .where('userId', '==', mahasiswaId)
        .get();

      for (const logbookDoc of logbookSnap.docs) {
        const data = logbookDoc.data();
        const status = data.status;
        totalLogbookAll++;
        if (status === 'approved') totalLogbookApproved++;

        if (status === 'pending') {
          const userDoc = await db.collection('users').doc(mahasiswaId).get();
          const mahasiswaNama = userDoc.exists ? userDoc.data().nama : 'Unknown';
          const mahasiswaNim = userDoc.exists ? userDoc.data().nim : '-';
          let pdkInfo = '';
          if (data.pdkId) {
            const periodSnap = await db.collection('magangPeriod')
              .where('pdkId', '==', data.pdkId)
              .where('mahasiswaId', '==', mahasiswaId)
              .limit(1)
              .get();
            if (!periodSnap.empty) {
              const period = periodSnap.docs[0].data();
              pdkInfo = `${period.pdkKode} - ${period.pdkNama}`;
            }
          }
          logbookPendingList.push({
            id: logbookDoc.id,
            mahasiswaId,
            mahasiswaNama,
            mahasiswaNim,
            tanggal: data.tanggal,
            tanggalFormatted: formatDate(data.tanggal),
            kegiatan: data.kegiatan && data.kegiatan.length > 60 ? data.kegiatan.substring(0, 60) + '...' : (data.kegiatan || '-'),
            durasi: data.durasi,
            pdkInfo,
            imageCount: data.imageUrls ? data.imageUrls.length : 0
          });
        }
      }
    }

    logbookPendingList.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
    const recentLogbookPending = logbookPendingList.slice(0, 10);
    const logbookPendingCount = logbookPendingList.length;
    const logbookPersentase = totalLogbookAll > 0 ? Math.round((totalLogbookApproved / totalLogbookAll) * 100) : 0;

    // ========================================================================
    // 7. Render view
    // ========================================================================
    res.render('dosen/dashboard', {
      title: 'Dashboard Dosen',
      dosen,
      currentSemester,                     // <-- DITAMBAHKAN
      mkCount,
      totalPertemuanTerlaksana,
      totalPertemuanMax,
      persentasePengajaran,
      totalMahasiswa,
      tugasAktif,
      pengumpulanBelumDinilai,
      events,
      mkList: mkList.slice(0, 5),
      berita: [],
      logbookPendingList: recentLogbookPending,
      logbookPendingCount,
      totalLogbookApproved,
      totalLogbookAll,
      logbookPersentase
    });

  } catch (error) {
    console.error('Error loading dosen dashboard:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat dashboard dosen'
    });
  }
});

module.exports = router;