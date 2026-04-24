/**
 * routes/admin/index.js
 * 
 * File utama untuk semua rute administratif.
 * Menggabungkan semua sub‑modul admin (dosen, mahasiswa, matakuliah, dll.)
 * serta menambahkan middleware autentikasi dan error handling.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

// ============================================================================
// IMPORT SUB‑MODUL
// ============================================================================
const usersRoutes = require('./users');
const laporanMagangRouter = require('./elkLibrary');
const seminarRouter = require('./seminar');          // pastikan file seminar.js ada di folder admin
const dashboardRouter = require('./dashboard');
// ============================================================================
// MIDDLEWARE UMUM (semua rute di bawah ini hanya untuk admin yang login)
// ============================================================================
router.use(verifyToken);
router.use(isAdmin);

// Middleware untuk menyediakan data user ke semua view admin (opsional)
router.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

// ============================================================================
// MOUNT SUB‑MODUL ROUTE
// ============================================================================
const bimbinganRouter = require('./bimbingan');
const rpsRouter = require('./rps');
router.use('/rps', rpsRouter);
// Tambahkan ini di bagian mount sub-modul
router.use('/bimbingan', bimbinganRouter);
// Kelola Pengguna (users) – CRUD akun
router.use('/users', usersRoutes);
router.use('/dashboard', dashboardRouter);
// Laporan Magang
router.use('/laporan-magang', require('./laporanMagang'));   // untuk persetujuan laporan
router.use('/elk-library', require('./elkLibrary'));        // untuk kelola konten library
// Seminar Magang
router.use('/seminar', seminarRouter);

// Kelola Dosen – CRUD data dosen, upload foto
router.use('/dosen', require('./dosen'));

// Kelola Mahasiswa – list per angkatan, tagihan SPP
router.use('/mahasiswa', require('./mahasiswa'));

// Kelola Mata Kuliah – daftar MK, dosen pengampu, materi per pertemuan
router.use('/matakuliah', require('./matakuliah'));

// Informasi Pengajaran – daftar MK aktif, pertemuan terkini
router.use('/pengajaran', require('./pengajaran'));

// Kelola KRS (Kartu Rencana Studi)
router.use('/krs', require('./krs'));

// Kelola KHS (Kartu Hasil Studi)
router.use('/khs', require('./khs'));

// Berkas Akademik – lihat KRS & KHS per mahasiswa / angkatan
router.use('/berkas', require('./berkas'));

// Kelola Tagihan Mahasiswa
router.use('/tagihan', require('./tagihan'));

// E‑Magang – lihat logbook mahasiswa
router.use('/emagang', require('./emagang'));

// Manajemen Surat
router.use('/surat', require('./surat'));


// Statistik Prodi (menggunakan modul admin-content)


// Kelola Jadwal Penting
router.use('/jadwalpenting', require('./jadwalpenting'));

// Track Lulusan – survey dan foto tempat kerja
router.use('/tracklulusan', require('./tracklulusan'));

// ============================================================================
// RUTE UTAMA DASHBOARD ADMIN
// ============================================================================

/**
 * GET /admin
 * Halaman utama dashboard admin, menampilkan ringkasan data.
 */
router.get('/', async (req, res) => {
  try {
    const dosenCount   = (await db.collection('dosen').count().get()).data().count;
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .count()
      .get();
    const mahasiswaCount = mahasiswaSnapshot.data().count;
    const mkCount       = (await db.collection('mataKuliah').count().get()).data().count;
    const beritaBaru    = await db.collection('berita')
      .orderBy('tanggal', 'desc')
      .limit(5)
      .get();

    res.render('admin/dashboard', {
      title: 'Dashboard Admin',
      stats: { dosenCount, mahasiswaCount, mkCount },
      beritaBaru: beritaBaru.docs.map(d => d.data())
    });
  } catch (error) {
    console.error('Gagal memuat dashboard admin:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat dashboard'
    });
  }
});

// Untuk kompatibilitas dengan tautan lama, arahkan /admin/dashboard ke /admin
router.get('/dashboard', (req, res) => {
  res.redirect('/admin');
});

// ============================================================================
// RUTE KHUSUS LAINNYA
// ============================================================================

/**
 * GET /admin/logs
 * (Opsional) Menampilkan log aktivitas (jika diperlukan)
 */
router.get('/logs', (req, res) => {
  res.render('admin/logs', { title: 'Log Aktivitas' });
});

// ============================================================================
// PENANGANAN ERROR KHUSUS ADMIN
// ============================================================================

// 404 – Rute tidak ditemukan di bawah /admin
router.use((req, res, next) => {
  res.status(404).render('admin/404', { title: 'Halaman Tidak Ditemukan' });
});

// Error handler untuk rute admin (menangkap error dari semua sub‑modul)
router.use((err, req, res, next) => {
  console.error('❌ Admin error:', err.stack);

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500);
  res.render('admin/error', {
    title: 'Terjadi Kesalahan',
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// ============================================================================
// EKSPOR ROUTER
// ============================================================================
module.exports = router;