const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('magangPeriod').get();
    const perusahaanMap = new Map(); // pakai nama perusahaan sebagai key
    const perusahaanList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const per = data.perusahaan;
      if (!per || !per.nama) continue;
      const key = per.nama.trim().toLowerCase();
      if (!perusahaanMap.has(key)) {
        perusahaanMap.set(key, {
          nama: per.nama,
          alamat: per.alamat || '',
          kontakHp: per.kontakHp || '',
          pembimbingLapangan: per.pembimbingLapangan || '',
          jabatan: per.jabatanPembimbingLapangan || '',
          periode: [{ id: doc.id, tanggalMulai: data.tanggalMulai, tanggalSelesai: data.tanggalSelesai, mahasiswaId: data.mahasiswaId }]
        });
      } else {
        perusahaanMap.get(key).periode.push({ id: doc.id, tanggalMulai: data.tanggalMulai, tanggalSelesai: data.tanggalSelesai, mahasiswaId: data.mahasiswaId });
      }
    }
    for (const [_, value] of perusahaanMap) {
      perusahaanList.push(value);
    }
    res.render('admin/perusahaan', { title: 'Daftar Perusahaan Magang', perusahaanList });
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat data perusahaan');
  }
});

module.exports = router;