const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');

// ============================================================================
// DATA SEMENTARA (nanti bisa diganti database)
// ============================================================================
let jadwalKelas = [
  {
    matkul: "Pemrograman Web",
    dosen: "Budi Santoso, M.Kom",
    ruang: "Lab 01",
    mulai: "07:30",
    selesai: "09:10"
  },
  {
    matkul: "Basis Data",
    dosen: "Siti Aminah, M.T",
    ruang: "Lab 01",
    mulai: "09:20",
    selesai: "11:00"
  }
];

// ============================================================================
// DISPLAY TV (PUBLIC)
// ============================================================================
router.get('/', (req, res) => {
  const now = new Date();
  const timeNow = now.toTimeString().slice(0,5);

  let current = null;
  let next = null;

  jadwalKelas.forEach(j => {
    if (timeNow >= j.mulai && timeNow <= j.selesai) {
      current = j;
    }
    if (timeNow < j.mulai && !next) {
      next = j;
    }
  });

  res.render('display/display', {
    current,
    next,
    jadwal: jadwalKelas,
    timeNow
  });
});

// ============================================================================
// ADMIN DISPLAY (WAJIB LOGIN ADMIN)
// ============================================================================
router.get('/admin', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.redirect('/dashboard');

  res.render('display/admin', {
    jadwal: jadwalKelas
  });
});

// TAMBAH DATA
router.post('/admin/add', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.redirect('/dashboard');

  jadwalKelas.push(req.body);
  res.redirect('/display/admin');
});

module.exports = router;