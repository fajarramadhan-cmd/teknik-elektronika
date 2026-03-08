// routes/admin/laporanMagang.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// GET daftar laporan yang perlu disetujui
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('laporanMagang')
      .where('status', '==', 'submitted')
      .orderBy('uploadedAt', 'desc')
      .get();
    const laporanList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/laporanMagang_list', {
      title: 'Persetujuan Laporan Magang',
      laporanList,
      success: req.query.success
    });
  } catch (error) {
    console.error('Error ambil laporan:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data' });
  }
});

// GET form persetujuan
router.get('/:id/approve', async (req, res) => {
  try {
    const doc = await db.collection('laporanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const laporan = { id: doc.id, ...doc.data() };
    res.render('admin/laporanMagang_approve', {
      title: 'Setujui Laporan Magang',
      laporan
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat form' });
  }
});

// POST proses persetujuan
router.post('/:id/approve', async (req, res) => {
  try {
    const { judulPublik, abstrak, pembimbing, tahun } = req.body;
    if (!judulPublik || !abstrak) {
      return res.status(400).send('Judul publik dan abstrak wajib diisi');
    }
    await db.collection('laporanMagang').doc(req.params.id).update({
      judulPublik,
      abstrak,
      pembimbing: pembimbing || '',
      tahun: parseInt(tahun) || new Date().getFullYear(),
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id
    });
    res.redirect('/admin/laporan-magang?success=approved');
  } catch (error) {
    console.error('Error approve laporan:', error);
    res.status(500).send('Gagal menyetujui laporan');
  }
});

module.exports = router;