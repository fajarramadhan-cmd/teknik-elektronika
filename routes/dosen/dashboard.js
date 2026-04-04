/**
 * routes/dosen/dashboard.js
 * Dashboard utama untuk dosen
 * Menampilkan ringkasan mata kuliah, mahasiswa, tugas aktif, dan pengumpulan belum dinilai
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

// Middleware autentikasi – pastikan user sudah login dan merupakan dosen
router.use(verifyToken);
router.use(isDosen);

/**
 * GET /dosen/dashboard
 * Halaman utama dashboard dosen
 */
router.get('/', async (req, res) => {
  try {
    // Data dosen dari middleware isDosen (sudah termasuk id dokumen, nama, dll)
    const dosen = req.dosen;

    // ===== 1. Ambil semua mata kuliah yang diampu oleh dosen ini =====
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

    // ===== 2. Hitung total mahasiswa unik dari semua MK yang diampu =====
    const mahasiswaSet = new Set();
    for (const mk of mkSnapshot.docs) {
      const enrollmentSnapshot = await db.collection('enrollment')
        .where('mkId', '==', mk.id)
        .get();
      enrollmentSnapshot.docs.forEach(doc => {
        mahasiswaSet.add(doc.data().userId); // tambahkan userId ke Set
      });
    }
    const totalMahasiswa = mahasiswaSet.size; // ukuran Set adalah jumlah mahasiswa unik

    // ===== 3. Hitung jumlah tugas aktif (deadline > sekarang) =====
    const now = new Date().toISOString();
    const tugasSnapshot = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .where('deadline', '>', now)
      .get();
    const tugasAktif = tugasSnapshot.size;

    // ===== 4. Hitung jumlah pengumpulan yang belum dinilai =====
    let pengumpulanBelumDinilai = 0;
    const tugasSemua = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .get();

    for (const tugas of tugasSemua.docs) {
      const pengumpulanSnapshot = await db.collection('pengumpulan')
        .where('tugasId', '==', tugas.id)
        .where('status', '==', 'dikumpulkan')
        .get();
    
      pengumpulanBelumDinilai += pengumpulanSnapshot.size;
    }

    // ===== 5. Ambil event terdekat (untuk ditampilkan di dashboard) =====
    const today = new Date().toISOString().split('T')[0];
    const eventsSnapshot = await db.collection('jadwalPenting')
      .where('tanggal', '>=', today)
      .orderBy('tanggal', 'asc')
      .limit(5)
      .get();
    const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // ===== 6. Render halaman dashboard dengan semua data =====
    res.render('dosen/dashboard', {
      title: 'Dashboard Dosen',
      dosen,
      mkCount: mkList.length,
      totalMahasiswa,
      tugasAktif,
      pengumpulanBelumDinilai,
      events,          // <-- data event untuk ditampilkan
      mkList: mkList.slice(0, 5), // tampilkan 5 MK terbaru (opsional)
      berita: []       // jika tidak ada berita, kirim array kosong
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