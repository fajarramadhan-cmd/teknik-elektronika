const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

router.get('/', async (req, res) => {
  try {
    // Ambil semua periode magang yang memiliki data perusahaan (nama tidak null)
    const snapshot = await db.collection('magangPeriod')
      .where('perusahaan.nama', '!=', null)
      .orderBy('perusahaan.nama', 'asc')
      .get();

    // Kelompokkan berdasarkan nama perusahaan (unik)
    const perusahaanMap = new Map();

    for (const doc of snapshot.docs) {
      const period = doc.data();
      const perusahaan = period.perusahaan || {};
      const namaPerusahaan = perusahaan.nama;
      if (!namaPerusahaan) continue;

      if (!perusahaanMap.has(namaPerusahaan)) {
        perusahaanMap.set(namaPerusahaan, {
          nama: namaPerusahaan,
          alamat: perusahaan.alamat || '-',
          kontak: perusahaan.kontak || perusahaan.kontakHp || '-',
          pembimbingLapangan: perusahaan.pembimbingLapangan || '-',
          mahasiswaList: []
        });
      }
      // Ambil data mahasiswa
      let mahasiswaNama = 'Tidak diketahui';
      if (period.mahasiswaId) {
        const userDoc = await db.collection('users').doc(period.mahasiswaId).get();
        if (userDoc.exists) mahasiswaNama = userDoc.data().nama;
      }
      perusahaanMap.get(namaPerusahaan).mahasiswaList.push({
        id: period.mahasiswaId,
        nama: mahasiswaNama,
        pdkKode: period.pdkKode,
        periode: `${period.tanggalMulai} s/d ${period.tanggalSelesai || 'Selesai'}`
      });
    }

    const perusahaanList = Array.from(perusahaanMap.values());

    res.render('dosen/perusahaan/index', {
      title: 'Daftar Perusahaan Magang',
      perusahaanList
    });
  } catch (error) {
    console.error('Error ambil perusahaan magang:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data perusahaan' });
  }
});

module.exports = router;