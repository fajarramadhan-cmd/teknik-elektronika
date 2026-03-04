/**
 * routes/landing.js
 * Halaman utama publik (landing page) dan halaman publik lainnya
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

// ============================================================================
// FUNGSI BANTU
// ============================================================================
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ============================================================================
// HALAMAN UTAMA (LANDING PAGE)
// ============================================================================
router.get('/', async (req, res) => {
  try {
    // 1. Statistik prodi
    const statistikDoc = await db.collection('statistik').doc('data').get();
    const statistik = statistikDoc.exists ? statistikDoc.data() : {
      mahasiswaAktif: 0,
      mahasiswaMagang: 0,
      angkatan: []
    };

    // 2. Berita terbaru
    const beritaSnapshot = await db.collection('berita')
      .orderBy('tanggal', 'desc')
      .limit(6)
      .get();
    const berita = beritaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 3. Jadwal penting (event mendatang)
    const today = new Date().toISOString().split('T')[0];
    const jadwalSnapshot = await db.collection('jadwalPenting')
      .where('tanggal', '>=', today)
      .orderBy('tanggal', 'asc')
      .limit(5)
      .get();
    const jadwal = jadwalSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 4. Jadwal seminar (dari collection seminar)
    const seminarSnapshot = await db.collection('seminar')
      .orderBy('tanggal', 'asc')
      .limit(5)
      .get();
    const seminar = seminarSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 5. Lulusan (tracer study yang disetujui) – untuk bagian lulusan bekerja
    let lulusan = [];
    try {
      const lulusanSnapshot = await db.collection('tracerStudy')
        .where('isPublic', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(6)
        .get();
      lulusan = lulusanSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn('TracerStudy tidak dapat diambil:', err.message);
    }

    // 6. Aktivitas prodi
    let aktivitas = [];
    try {
      const aktivitasSnapshot = await db.collection('aktivitas')
        .orderBy('tanggal', 'desc')
        .limit(4)
        .get();
      aktivitas = aktivitasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn('Aktivitas tidak dapat diambil:', err.message);
    }

    // ============ TAMBAHAN BARU ============
    // 7. Dosen pengajar (4 dosen)
    let dosenList = [];
    try {
      const dosenSnapshot = await db.collection('dosen').limit(4).get();
      dosenList = dosenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn('Gagal mengambil data dosen:', err.message);
    }

    // 8. Lulusan yang bekerja (dari tracer study yang memiliki pekerjaan)
    let lulusanKerja = [];
    try {
      const kerjaSnapshot = await db.collection('tracerStudy')
        .where('statusPekerjaan', '==', 'bekerja')
        .limit(4)
        .get();
      lulusanKerja = kerjaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn('Gagal mengambil data lulusan bekerja:', err.message);
      // Jika field statusPekerjaan tidak ada, coba alternatif lain
      try {
        const kerjaSnapshot = await db.collection('tracerStudy')
          .where('pekerjaan', '!=', null)
          .limit(4)
          .get();
        lulusanKerja = kerjaSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (e) {
        console.warn('Alternatif gagal:', e.message);
      }
    }

    res.render('landing/index', {
      title: 'Teknik Elektronika - Politeknik Dewantara',
      user: req.user || null,
      statistik,
      berita,
      jadwalPenting: jadwal,
      seminar,
      lulusan,
      aktivitas,
      dosenList,
      lulusanKerja,
      formatDate
    });
  } catch (error) {
    console.error('Error landing page:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Terjadi kesalahan server'
    });
  }
});

// ============================================================================
// HALAMAN AKTIVITAS PRODI (DAFTAR)
// ============================================================================
router.get('/aktivitas', async (req, res) => {
  try {
    const { kategori } = req.query;
    
    let query = db.collection('aktivitas').orderBy('tanggal', 'desc');
    if (kategori && kategori !== 'semua') {
      query = query.where('kategori', '==', kategori);
    }
    
    const snapshot = await query.get();
    const aktivitas = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.render('aktivitas/index', {
      title: 'Aktivitas Prodi',
      aktivitas,
      kategoriAktif: kategori || 'semua',
      user: req.user || null
    });
  } catch (error) {
    console.error('Error memuat aktivitas:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat aktivitas'
    });
  }
});

// ============================================================================
// DETAIL AKTIVITAS
// ============================================================================
router.get('/aktivitas/:id', async (req, res) => {
  try {
    const doc = await db.collection('aktivitas').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Aktivitas tidak ditemukan'
      });
    }
    const aktivitas = { id: doc.id, ...doc.data() };
    res.render('aktivitas/detail', {
      title: aktivitas.judul,
      aktivitas,
      user: req.user || null
    });
  } catch (error) {
    console.error('Error detail aktivitas:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail aktivitas'
    });
  }
});

// ============================================================================
// DETAIL BERITA
// ============================================================================
router.get('/berita/:id', async (req, res) => {
  try {
    const berita = await db.collection('berita').doc(req.params.id).get();
    if (!berita.exists) return res.status(404).send('Berita tidak ditemukan');
    res.render('berita_detail', { berita: berita.data() });
  } catch (error) {
    res.status(500).send('Error');
  }
});

// ============================================================================
// HALAMAN VALIDASI SURAT
// ============================================================================
router.get('/validasi', (req, res) => {
  const { kode } = req.query;
  res.render('validasi', {
    title: 'Validasi Surat',
    kode,
    user: req.user || null
  });
});

// ============================================================================
// HALAMAN LULUSAN (DAFTAR)
// ============================================================================
router.get('/lulusan', async (req, res) => {
  try {
    const { angkatan, status } = req.query;
    
    let query = db.collection('tracerStudy')
      .where('isPublic', '==', true)
      .orderBy('tahunLulus', 'desc')
      .orderBy('nama');

    if (angkatan) {
      query = query.where('tahunLulus', '==', parseInt(angkatan));
    }
    if (status && status !== 'semua') {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();
    const lulusan = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Statistik
    const statSnapshot = await db.collection('tracerStudy').where('isPublic', '==', true).get();
    const total = statSnapshot.size;
    const bekerja = statSnapshot.docs.filter(d => d.data().status === 'bekerja').length;
    const wirausaha = statSnapshot.docs.filter(d => d.data().status === 'wirausaha').length;
    const kuliah = statSnapshot.docs.filter(d => d.data().status === 'kuliah').length;
    const stats = { total, bekerja, wirausaha, kuliah };

    // Angkatan unik
    const angkatanSet = new Set();
    statSnapshot.docs.forEach(d => angkatanSet.add(d.data().tahunLulus));
    const angkatanList = Array.from(angkatanSet).sort((a, b) => b - a);

    res.render('lulusan/index', {
      title: 'Lulusan',
      lulusan,
      stats,
      angkatanList,
      filterAngkatan: angkatan || '',
      filterStatus: status || 'semua',
      user: req.user || null
    });
  } catch (error) {
    console.error('Error memuat halaman lulusan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat data lulusan'
    });
  }
});

// ============================================================================
// DETAIL LULUSAN
// ============================================================================
router.get('/lulusan/:id', async (req, res) => {
  try {
    const doc = await db.collection('tracerStudy').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Data tidak ditemukan'
      });
    }
    const lulusan = { id: doc.id, ...doc.data() };
    res.render('lulusan/detail', {
      title: lulusan.nama,
      lulusan,
      user: req.user || null
    });
  } catch (error) {
    console.error('Error detail lulusan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail lulusan'
    });
  }
});

module.exports = router;