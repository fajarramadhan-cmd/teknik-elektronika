/**
 * routes/mahasiswa/tagihan.js
 * Menampilkan informasi tagihan SPP mahasiswa
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);

/**
 * GET /mahasiswa/tagihan
 * Menampilkan daftar tagihan SPP per semester
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const tagihanDoc = await db.collection('tagihan').doc(userId).get();
    
    let tagihan = [];
    if (tagihanDoc.exists) {
      tagihan = tagihanDoc.data().semester || [];
    }

    // Hitung total tagihan (yang belum lunas) dan total lunas
    let totalTagihan = 0;
    let totalLunas = 0;
    tagihan.forEach(t => {
      if (t.status === 'lunas') {
        totalLunas += t.jumlah;
      } else {
        totalTagihan += t.jumlah;
      }
    });

    const sisaTagihan = totalTagihan; // karena totalTagihan adalah jumlah yang belum lunas

    res.render('mahasiswa/tagihan', {
      title: 'Tagihan SPP',
      user: req.user,
      tagihan,
      totalTagihan,
      totalLunas,
      sisaTagihan
    });
  } catch (error) {
    console.error('Error mengambil tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat tagihan'
    });
  }
});

module.exports = router;