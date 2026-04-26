const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getActiveEdomPeriod } = require('../../helpers/edomHelper');

router.use(verifyToken);
router.use(isDosen);

// Hasil evaluasi untuk dosen yang login
router.get('/', async (req, res) => {
  try {
    const dosenId = req.dosen.id;
    // Ambil semua periode (bisa filter hanya yang sudah selesai atau semua)
    const periodsSnap = await db.collection('edom_periode').orderBy('tanggalMulai', 'desc').get();
    const periods = periodsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let selectedPeriodId = req.query.periode || (periods.length ? periods[0].id : null);
    let selectedPeriod = null;
    let results = [];
    if (selectedPeriodId) {
      selectedPeriod = periods.find(p => p.id === selectedPeriodId);
      // Ambil semua respon untuk periode ini dan dosen ini
      const responSnap = await db.collection('edom_respon')
        .where('dosenId', '==', dosenId)
        .where('periodeId', '==', selectedPeriodId)
        .get();

      const mkMap = new Map(); // key mkId, value array of respon
      for (const doc of responSnap.docs) {
        const data = doc.data();
        if (!mkMap.has(data.mkId)) {
          mkMap.set(data.mkId, {
            mkId: data.mkId,
            mkKode: data.mkKode,
            mkNama: data.mkNama,
            responList: [],
            totalNilai: 0,
            count: 0,
            komentarList: []
          });
        }
        const entry = mkMap.get(data.mkId);
        entry.responList.push(data);
        entry.totalNilai += data.nilaiRata;
        entry.count++;
        // Ambil komentar dari setiap jawaban
        data.jawaban.forEach(j => {
          if (j.komentar && j.komentar.trim()) {
            entry.komentarList.push(j.komentar);
          }
        });
      }

      // Hitung rata-rata per MK
      results = Array.from(mkMap.values()).map(item => ({
        ...item,
        average: item.count ? (item.totalNilai / item.count).toFixed(2) : 0
      }));
    }

    res.render('dosen/edom/index', {
      title: 'Hasil EDOM',
      periods,
      selectedPeriodId,
      selectedPeriod,
      results,
      dosen: req.dosen
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat hasil EDOM' });
  }
});

module.exports = router;