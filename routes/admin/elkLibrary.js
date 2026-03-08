// routes/admin/elkLibrary.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');

router.use(verifyToken);
router.use(isAdmin);

// GET daftar konten yang sudah dipublikasikan
router.get('/', async (req, res) => {
  try {
    const { type } = req.query; // 'laporan', 'artikel', atau 'all'
    let laporanList = [];
    let artikelList = [];

    if (!type || type === 'all' || type === 'laporan') {
      const laporanSnapshot = await db.collection('laporanMagang')
        .where('status', '==', 'approved')
        .orderBy('approvedAt', 'desc')
        .get();
      laporanList = laporanSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    if (!type || type === 'all' || type === 'artikel') {
      const artikelSnapshot = await db.collection('artikelDosen')
        .where('status', '==', 'approved')
        .orderBy('approvedAt', 'desc')
        .get();
      artikelList = artikelSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    res.render('admin/elkLibrary_list', {
      title: 'Kelola E-Library',
      laporanList,
      artikelList,
      currentType: type || 'all'
    });
  } catch (error) {
    console.error('Error ELK Library admin:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data' });
  }
});

// Edit laporan
router.get('/laporan/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('laporanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const laporan = { id: doc.id, ...doc.data() };
    res.render('admin/elkLibrary_laporan_edit', {
      title: 'Edit Laporan Magang',
      laporan
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat form edit' });
  }
});

router.post('/laporan/:id/edit', async (req, res) => {
  try {
    const { judulPublik, abstrak, pembimbing, tahun } = req.body;
    await db.collection('laporanMagang').doc(req.params.id).update({
      judulPublik,
      abstrak,
      pembimbing: pembimbing || '',
      tahun: parseInt(tahun) || new Date().getFullYear(),
      updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/elk-library?type=laporan&success=updated');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal update laporan');
  }
});

// Hapus laporan
router.post('/laporan/:id/delete', async (req, res) => {
  try {
    const doc = await db.collection('laporanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const data = doc.data();
    if (data.fileId) {
      try {
        await drive.files.delete({ fileId: data.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err);
      }
    }
    await doc.ref.delete();
    res.redirect('/admin/elk-library?type=laporan&success=deleted');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus laporan');
  }
});

// Edit artikel (sederhanakan)
router.get('/artikel/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('artikelDosen').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Artikel tidak ditemukan');
    const artikel = { id: doc.id, ...doc.data() };
    res.render('admin/elkLibrary_artikel_edit', {
      title: 'Edit Artikel Dosen',
      artikel
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat form edit' });
  }
});

router.post('/artikel/:id/edit', async (req, res) => {
  try {
    const { judul, abstrak, authors, tahun, metadataJurnal, metadataDoi } = req.body;
    await db.collection('artikelDosen').doc(req.params.id).update({
      judul,
      abstrak,
      authors: authors ? authors.split(',').map(s => s.trim()) : [],
      publicationYear: parseInt(tahun) || new Date().getFullYear(),
      metadata: {
        jurnal: metadataJurnal || '',
        doi: metadataDoi || ''
      },
      updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/elk-library?type=artikel&success=updated');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal update artikel');
  }
});

// Hapus artikel
router.post('/artikel/:id/delete', async (req, res) => {
  try {
    const doc = await db.collection('artikelDosen').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Artikel tidak ditemukan');
    const data = doc.data();
    if (data.fileId) {
      try {
        await drive.files.delete({ fileId: data.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err);
      }
    }
    await doc.ref.delete();
    res.redirect('/admin/elk-library?type=artikel&success=deleted');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus artikel');
  }
});

module.exports = router;