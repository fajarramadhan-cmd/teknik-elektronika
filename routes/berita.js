const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('berita').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).render('404', { title: 'Berita tidak ditemukan' });
    const berita = { id: doc.id, ...doc.data() };
    res.render('berita/detail', { title: berita.judul, berita });
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat berita');
  }
});

module.exports = router;