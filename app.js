/**
 * app.js
 * Entry point aplikasi Teknik Elektronika
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { verifyToken } = require('./middleware/auth');

const app = express();

// ============================================================================
// MIDDLEWARE GLOBAL
// ============================================================================
// Cookie parser harus sebelum router dan session
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi session (untuk keperluan lain, jika diperlukan)
app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia-super-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only di production
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 hari
  }
}));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================================
// ROUTES PUBLIK
// ============================================================================
const landingRoutes = require('./routes/landing');
app.use('/', landingRoutes); // Landing page dan halaman publik lainnya

// Auth routes
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// API untuk mendapatkan data user yang login (digunakan di form KRS statis)
app.get('/api/current-user', verifyToken, (req, res) => {
  res.json({
    nama: req.user.nama || '',
    nim: req.user.nim || ''
  });
});

// ============================================================================
// ROUTES MAHASISWA
// ============================================================================
const mahasiswaRoutes = require('./routes/mahasiswa/index');
app.use('/mahasiswa', mahasiswaRoutes);
const mahasiswaKalenderRouter = require('./routes/mahasiswa/kalender');
app.use('/mahasiswa/kalender', mahasiswaKalenderRouter);
// ============================================================================
// ROUTES DOSEN
// ============================================================================
const dosenRoutes = require('./routes/dosen/index');
app.use('/dosen', dosenRoutes);

// ============================================================================
// ROUTES ADMIN
// ============================================================================
const adminRoutes = require('./routes/admin/index');
app.use('/admin', adminRoutes);

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
// HANDLE 404 (Halaman Tidak Ditemukan)
// ============================================================================
app.use((req, res) => {
  res.status(404).render('404', {
    title: 'Halaman Tidak Ditemukan',
    user: req.user || null
  });
});

// ============================================================================
// ERROR HANDLER (untuk menangani error di semua route)
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