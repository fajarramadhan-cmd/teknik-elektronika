const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

router.get('/', async (req, res) => {
  try {
    console.log('Dosen SK route accessed, req.dosen:', req.dosen);
    const dosenId = req.dosen.id;
    if (!dosenId) {
      console.error('dosenId tidak ditemukan di req.dosen');
      return res.status(400).render('error', { title: 'Error', message: 'Data dosen tidak valid' });
    }

    // Query tanpa orderBy (sementara)
    const skSnapshot = await db.collection('sk_dosen')
      .where('dosenId', '==', dosenId)
      .get();

    const skList = [];
    skSnapshot.forEach(doc => {
      const data = doc.data();
      skList.push({
        id: doc.id,
        ...data,
        tanggalUpload: data.tanggalUpload ? data.tanggalUpload.toDate() : null,
      });
    });

    // Sorting manual descending berdasarkan tanggalUpload
    skList.sort((a, b) => {
      if (!a.tanggalUpload) return 1;
      if (!b.tanggalUpload) return -1;
      return b.tanggalUpload - a.tanggalUpload;
    });

    console.log(`Ditemukan ${skList.length} SK untuk dosen ${dosenId}`);
    res.render('dosen/sk/index', { title: 'SK Saya', skList });
  } catch (error) {
    console.error('Error di /dosen/sk:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data SK' });
  }
});

module.exports = router;