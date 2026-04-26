/**
 * app.js
 * Entry point aplikasi Teknik Elektronika
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session'); // ✅ CUKUP SEKALI
const { verifyToken } = require('./middleware/auth');

const app = express();

// ============================================================================
// MIDDLEWARE GLOBAL
// ============================================================================

// Cookie parser
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// SESSION CONFIGURATION (HANYA SEKALI)
// ============================================================================
app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia-super-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only di production
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 hari
  }
}));

// ✅ Make session available in all views (HARUS SETELAH app.use(session(...)))
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ============================================================================
// VIEW ENGINE
// ============================================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================================
// ROUTES PUBLIK
// ============================================================================
const landingRoutes = require('./routes/landing');
app.use('/', landingRoutes);

// Auth routes
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// API untuk mendapatkan data user yang login
app.get('/api/current-user', verifyToken, (req, res) => {
  res.json({
    nama: req.user.nama || '',
    nim: req.user.nim || ''
  });
});
// SPMP
const adminSpmpRouter = require('./routes/admin/spmp');
const dosenSpmpRouter = require('./routes/dosen/spmp');
app.use('/admin/spmp', adminSpmpRouter);
app.use('/dosen/spmp', dosenSpmpRouter);
// Perusahaan magang
const adminPerusahaanRouter = require('./routes/admin/perusahaan');
const dosenPerusahaanRouter = require('./routes/dosen/perusahaan');

app.use('/admin/perusahaan', adminPerusahaanRouter);
app.use('/dosen/perusahaan', dosenPerusahaanRouter);
// EDOM
const mahasiswaEdomRouter = require('./routes/mahasiswa/edom');
const dosenEdomRouter = require('./routes/dosen/edom');
const adminEdomRouter = require('./routes/admin/edom');

app.use('/mahasiswa/edom', mahasiswaEdomRouter);
app.use('/dosen/edom', dosenEdomRouter);
app.use('/admin/edom', adminEdomRouter);
// Mengakses halaman detail kurikulum (misal untuk mata kuliah tertentu)
app.get('/dosen/kurikulum/detail/:id', (req, res) => {
    res.render('dosen/kurikulum/detail', { id: req.params.id });
});

// Mengakses halaman my_rps (daftar RPS milik dosen)
app.get('/dosen/kurikulum/my-rps', (req, res) => {
    res.render('dosen/kurikulum/my_rps');
});
// ===== ROUTE PUBLIK BERITA =====
const beritaPublicRoutes = require('./routes/berita');   // file untuk publik
app.use('/berita', beritaPublicRoutes);

// ===== ROUTE ADMIN BERITA =====
const adminBeritaRoutes = require('./routes/admin/berita');
app.use('/admin/berita', adminBeritaRoutes);   // mount di /admin/berita
// ============================================================================
// ROUTES MAHASISWA
// ============================================================================
const mahasiswaRoutes = require('./routes/mahasiswa/index');
app.use('/mahasiswa', mahasiswaRoutes);

// ============================================================================
// ROUTES DOSEN
// ============================================================================
// Route SK untuk dosen
const dosenSuratRouter = require('./routes/dosen/surat');
app.use('/dosen/surat', dosenSuratRouter);
const penelitianRouter = require('./routes/dosen/penelitian');
const pengabdianRouter = require('./routes/dosen/pengabdian');
app.use('/dosen/penelitian', penelitianRouter);
app.use('/dosen/pengabdian', pengabdianRouter);
const dosenSkRouter = require('./routes/dosen/sk');
app.use('/dosen/sk', dosenSkRouter);
const dosenRoutes = require('./routes/dosen/index');
app.use('/dosen', dosenRoutes);
const adminSkRouter = require('./routes/admin/sk');
app.use('/admin/sk', adminSkRouter);


// Rute dosen untuk upload artikel
const dosenArtikelRouter = require('./routes/dosen/artikel');
app.use('/dosen/artikel', dosenArtikelRouter);

// Rute dosen kalender
const dosenKalenderRouter = require('./routes/dosen/kalender');
app.use('/dosen/kalender', dosenKalenderRouter);

// ============================================================================
// ROUTES ADMIN
// ============================================================================
const adminRoutes = require('./routes/admin/index');
app.use('/admin', adminRoutes);

// Admin laporan magang
const adminLaporanMagangRouter = require('./routes/admin/elkLibrary');
app.use('/admin/laporan-magang', adminLaporanMagangRouter);

// Admin elk library
const adminElkLibraryRouter = require('./routes/admin/elkLibrary');
app.use('/admin/elk-library', adminElkLibraryRouter);

// ============================================================================
// ROUTES UMUM
// ============================================================================
const elkLibraryRouter = require('./routes/elkLibrary');
app.use('/elk-library', elkLibraryRouter);

const mahasiswaKalenderRouter = require('./routes/mahasiswa/kalender');
app.use('/mahasiswa/kalender', mahasiswaKalenderRouter);

// Route panduan
app.get('/panduan', (req, res) => {
  res.render('landing/panduan', { title: 'Panduan Penggunaan' });
});

// ============================================================================
// DASHBOARD REDIRECT (setelah login)
// ============================================================================
app.get('/dashboard', verifyToken, (req, res) => {
  if (req.user.role === 'admin') {
    res.redirect('/admin/dashboard');
  } else if (req.user.role === 'dosen') {
    res.redirect('/dosen/dashboard');
  } else {
    res.redirect('/mahasiswa/dashboard');
  }
});
// ============================================================================
// ROUTES DISPLAY (TV KAMPUS)
// ============================================================================
const displayRoutes = require('./routes/display');
app.use('/display', displayRoutes);
// ============================================================================
// HANDLE 404 (Halaman Tidak Ditemukan)
// ============================================================================
app.use((req, res) => {
  res.status(404).render('404', {
    title: 'Halaman Tidak Ditemukan',
    user: req.user || null
  });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).render('error', {
    title: 'Terjadi Kesalahan',
    message: err.message || 'Internal Server Error',
    user: req.user || null
  });
});

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});