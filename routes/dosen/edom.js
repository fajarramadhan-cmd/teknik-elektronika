const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// HALAMAN UTAMA EDOM (daftar hasil per MK)
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const dosenId = req.dosen.id;
    const periodsSnap = await db.collection('edom_periode').orderBy('tanggalMulai', 'desc').get();
    const periods = periodsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let selectedPeriodId = req.query.periode || (periods.length ? periods[0].id : null);
    let selectedPeriod = null;
    let results = [];

    if (selectedPeriodId) {
      selectedPeriod = periods.find(p => p.id === selectedPeriodId);
      const responSnap = await db.collection('edom_respon')
        .where('dosenId', '==', dosenId)
        .where('periodeId', '==', selectedPeriodId)
        .get();

      const mkMap = new Map();
      for (const doc of responSnap.docs) {
        const data = doc.data();
        if (!mkMap.has(data.mkId)) {
          mkMap.set(data.mkId, {
            mkId: data.mkId,
            mkKode: data.mkKode,
            mkNama: data.mkNama,
            totalNilai: 0,
            count: 0,
            komentarList: []
          });
        }
        const entry = mkMap.get(data.mkId);
        entry.totalNilai += data.nilaiRata;
        entry.count++;
        if (data.jawaban) {
          data.jawaban.forEach(j => {
            if (j.komentar && j.komentar.trim()) entry.komentarList.push(j.komentar);
          });
        }
      }
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

// ============================================================================
// DETAIL EVALUASI PER MATA KULIAH
// ============================================================================
router.get('/detail', async (req, res) => {
  try {
    const { mkId, periode } = req.query;
    const dosenId = req.dosen.id;

    if (!mkId || !periode) {
      return res.status(400).send('Parameter mkId dan periode wajib diisi');
    }

    // Ambil data mata kuliah
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mkData = mkDoc.data();

    // Ambil data periode
    const periodeDoc = await db.collection('edom_periode').doc(periode).get();
    if (!periodeDoc.exists) return res.status(404).send('Periode tidak ditemukan');
    const periodeData = periodeDoc.data();

    // Ambil semua respon untuk MK, periode, dan dosen ini
    const responSnap = await db.collection('edom_respon')
      .where('dosenId', '==', dosenId)
      .where('mkId', '==', mkId)
      .where('periodeId', '==', periode)
      .get();

    if (responSnap.empty) {
      return res.status(404).send('Belum ada evaluasi untuk mata kuliah ini pada periode tersebut');
    }

    // Ambil daftar pertanyaan dari kuisioner
    const pertanyaanSnap = await db.collection('edom_kuisioner')
      .orderBy('urutan', 'asc')
      .get();

    const pertanyaanList = pertanyaanSnap.docs.map(doc => ({
      id: doc.id,
      pertanyaan: doc.data().pertanyaan,
      totalNilai: 0,
      count: 0,
      komentarList: []
    }));

    let totalNilai = 0;
    let jumlahRespon = 0;
    const semuaKomentar = [];

    for (const doc of responSnap.docs) {
      const data = doc.data();
      totalNilai += data.nilaiRata;
      jumlahRespon++;
      if (data.jawaban && Array.isArray(data.jawaban)) {
        data.jawaban.forEach(jawab => {
          const qIdx = pertanyaanList.findIndex(q => q.id === jawab.pertanyaanId);
          if (qIdx !== -1) {
            pertanyaanList[qIdx].totalNilai += jawab.nilai;
            pertanyaanList[qIdx].count++;
            if (jawab.komentar && jawab.komentar.trim()) {
              pertanyaanList[qIdx].komentarList.push(jawab.komentar);
              semuaKomentar.push(jawab.komentar);
            }
          }
        });
      }
    }

    pertanyaanList.forEach(q => {
      q.rataNilai = q.count ? q.totalNilai / q.count : 0;
    });

    const rataNilai = totalNilai / jumlahRespon;
    const totalResponden = jumlahRespon;
    const jumlahPertanyaan = pertanyaanList.length;

    res.render('dosen/edom/detail', {
      title: `Detail Evaluasi - ${mkData.nama}`,
      mkId: mkId,                // <-- tambahkan
      periodeId: periode,        // <-- tambahkan
      mkKode: mkData.kode,
      mkNama: mkData.nama,
      periodeNama: periodeData.nama,
      rataNilai,
      totalResponden,
      jumlahPertanyaan,
      pertanyaanList,
      semuaKomentar
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail evaluasi' });
  }
});
// ============================================================================
// CETAK HASIL EVALUASI (per mata kuliah)
// ============================================================================
router.get('/print', async (req, res) => {
  try {
    const { mkId, periode } = req.query;
    const dosenId = req.dosen.id;

    if (!mkId || !periode) {
      return res.status(400).send('Parameter mkId dan periode wajib diisi');
    }

    // Ambil data mata kuliah
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mkData = mkDoc.data();

    // Ambil data periode
    const periodeDoc = await db.collection('edom_periode').doc(periode).get();
    if (!periodeDoc.exists) return res.status(404).send('Periode tidak ditemukan');
    const periodeData = periodeDoc.data();

    // Data dosen
    const dosenNama = req.dosen.nama;
    const dosenNip = req.dosen.nip || '-';

    // Ambil semua respon untuk MK, periode, dan dosen ini
    const responSnap = await db.collection('edom_respon')
      .where('dosenId', '==', dosenId)
      .where('mkId', '==', mkId)
      .where('periodeId', '==', periode)
      .get();

    if (responSnap.empty) {
      return res.status(404).send('Belum ada evaluasi untuk mata kuliah ini pada periode tersebut');
    }

    // Ambil daftar pertanyaan dari kuisioner
    const pertanyaanSnap = await db.collection('edom_kuisioner')
      .orderBy('urutan', 'asc')
      .get();
    const pertanyaanList = pertanyaanSnap.docs.map(doc => ({
      id: doc.id,
      pertanyaan: doc.data().pertanyaan,
      totalNilai: 0,
      count: 0,
      komentarList: []
    }));

    let totalNilai = 0;
    let jumlahRespon = 0;
    const semuaKomentar = [];

    for (const doc of responSnap.docs) {
      const data = doc.data();
      totalNilai += data.nilaiRata;
      jumlahRespon++;
      if (data.jawaban && Array.isArray(data.jawaban)) {
        data.jawaban.forEach(jawab => {
          const qIdx = pertanyaanList.findIndex(q => q.id === jawab.pertanyaanId);
          if (qIdx !== -1) {
            pertanyaanList[qIdx].totalNilai += jawab.nilai;
            pertanyaanList[qIdx].count++;
            if (jawab.komentar && jawab.komentar.trim()) {
              pertanyaanList[qIdx].komentarList.push(jawab.komentar);
              semuaKomentar.push(jawab.komentar);
            }
          }
        });
      }
    }

    pertanyaanList.forEach(q => {
      q.rataNilai = q.count ? q.totalNilai / q.count : 0;
    });

    const rataNilai = totalNilai / jumlahRespon;
    const totalResponden = jumlahRespon;

    res.render('dosen/edom/print', {
      title: `Cetak EDOM - ${mkData.nama}`,
      mkId,
      periodeId: periode,
      mkKode: mkData.kode,
      mkNama: mkData.nama,
      periodeNama: periodeData.nama,
      dosenNama,
      dosenNip,
      rataNilai,
      totalResponden,
      pertanyaanList,
      semuaKomentar
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Gagal mencetak laporan' });
  }
});

module.exports = router;