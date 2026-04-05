/**
 * routes/dosen/dashboard.js
 * Dashboard utama untuk dosen - TANPA MEMERLUKAN INDEKS BARU
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  });
}

router.get('/', async (req, res) => {
  try {
    const dosen = req.dosen;

    // ===== 1. Mata Kuliah yang diampu =====
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .get();

    const mkList = mkSnapshot.docs.map(doc => ({
      id: doc.id,
      kode: doc.data().kode,
      nama: doc.data().nama,
      semester: doc.data().semester,
      sks: doc.data().sks
    }));

    // ===== 2. Total mahasiswa bimbingan =====
    const bimbinganSnapshot1 = await db.collection('bimbingan')
      .where('pembimbing1Id', '==', req.dosen.id)
      .where('status', '==', 'active')
      .get();
    
    const bimbinganSnapshot2 = await db.collection('bimbingan')
      .where('pembimbing2Id', '==', req.dosen.id)
      .where('status', '==', 'active')
      .get();
    
    const mahasiswaBimbinganIds = new Set();
    bimbinganSnapshot1.docs.forEach(doc => mahasiswaBimbinganIds.add(doc.data().mahasiswaId));
    bimbinganSnapshot2.docs.forEach(doc => mahasiswaBimbinganIds.add(doc.data().mahasiswaId));
    const totalMahasiswa = mahasiswaBimbinganIds.size;

    // ===== 3. Tugas aktif =====
    const now = new Date().toISOString();
    const tugasSnapshot = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .where('deadline', '>', now)
      .get();
    const tugasAktif = tugasSnapshot.size;

    // ===== 4. Pengumpulan belum dinilai =====
    let pengumpulanBelumDinilai = 0;
    const tugasSemua = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .get();

    for (const tugasDoc of tugasSemua.docs) {
      const pengumpulanSnapshot = await db.collection('pengumpulan')
        .where('tugasId', '==', tugasDoc.id)
        .where('status', '==', 'dikumpulkan')
        .get();
      pengumpulanBelumDinilai += pengumpulanSnapshot.size;
    }

    // ===== 5. Event terdekat =====
    const today = new Date().toISOString().split('T')[0];
    const eventsSnapshot = await db.collection('jadwalPenting')
      .where('tanggal', '>=', today)
      .orderBy('tanggal', 'asc')
      .limit(5)
      .get();
    const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // ===== 6. LOGBOOK PENDING (TANPA INDEKS BARU) =====
    const logbookPendingList = [];
    
    for (const mahasiswaId of mahasiswaBimbinganIds) {
      // Ambil semua logbook mahasiswa
      const logbookSnapshot = await db.collection('logbookMagang')
        .where('userId', '==', mahasiswaId)
        .get();
      
      // Filter status 'pending' di memory
      for (const logbookDoc of logbookSnapshot.docs) {
        const data = logbookDoc.data();
        
        if (data.status !== 'pending') continue;
        
        // Ambil data mahasiswa
        const userDoc = await db.collection('users').doc(mahasiswaId).get();
        const mahasiswaNama = userDoc.exists ? userDoc.data().nama : 'Unknown';
        const mahasiswaNim = userDoc.exists ? userDoc.data().nim : '-';
        
        // Ambil info PDK jika ada
        let pdkInfo = '';
        if (data.pdkId) {
          const periodSnapshot = await db.collection('magangPeriod')
            .where('pdkId', '==', data.pdkId)
            .where('mahasiswaId', '==', mahasiswaId)
            .limit(1)
            .get();
          if (!periodSnapshot.empty) {
            const period = periodSnapshot.docs[0].data();
            pdkInfo = `${period.pdkKode} - ${period.pdkNama}`;
          }
        }
        
        logbookPendingList.push({
          id: logbookDoc.id,
          mahasiswaId: mahasiswaId,
          mahasiswaNama: mahasiswaNama,
          mahasiswaNim: mahasiswaNim,
          tanggal: data.tanggal,
          tanggalFormatted: formatDate(data.tanggal),
          kegiatan: data.kegiatan && data.kegiatan.length > 60 ? data.kegiatan.substring(0, 60) + '...' : (data.kegiatan || '-'),
          durasi: data.durasi,
          pdkInfo: pdkInfo,
          imageCount: data.imageUrls ? data.imageUrls.length : 0
        });
      }
    }
    
    // Urutkan di memory
    logbookPendingList.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
    
    const recentLogbookPending = logbookPendingList.slice(0, 10);
    const logbookPendingCount = logbookPendingList.length;

    // ===== 7. Render dashboard =====
    res.render('dosen/dashboard', {
      title: 'Dashboard Dosen',
      dosen,
      mkCount: mkList.length,
      totalMahasiswa,
      tugasAktif,
      pengumpulanBelumDinilai,
      events,
      mkList: mkList.slice(0, 5),
      berita: [],
      logbookPendingList: recentLogbookPending,
      logbookPendingCount: logbookPendingCount
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