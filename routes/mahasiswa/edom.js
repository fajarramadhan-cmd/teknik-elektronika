const express = require('express');
const router = express.Router();
const { verifyToken, isMahasiswa } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getActiveEdomPeriod, getActiveQuestions, hasFilledEdom, calculateAverage } = require('../../helpers/edomHelper');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');

router.use(verifyToken);
router.use(isMahasiswa);

// Daftar mata kuliah yang perlu dievaluasi
router.get('/', async (req, res) => {
  try {
    const activePeriod = await getActiveEdomPeriod();
    if (!activePeriod) {
      return res.render('mahasiswa/edom/index', {
        title: 'EDOM',
        activePeriod: null,
        mkList: [],
        message: 'Tidak ada periode evaluasi aktif saat ini.'
      });
    }

    const currentSemester = getCurrentAcademicSemester().label;
    // Ambil enrollment aktif mahasiswa untuk semester yang sama dengan periode (asumsi periode memiliki field semester)
    const semesterPeriod = activePeriod.semester || currentSemester;
    const enrollmentSnap = await db.collection('enrollment')
      .where('userId', '==', req.user.id)
      .where('status', '==', 'active')
      .where('semester', '==', semesterPeriod)
      .get();

    const mkList = [];
    for (const enroll of enrollmentSnap.docs) {
      const mkId = enroll.data().mkId;
      const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
      if (!mkDoc.exists) continue;
      const mk = mkDoc.data();
      // Ambil nama dosen
      let dosenNames = [];
      if (mk.dosenIds && mk.dosenIds.length) {
        for (const dId of mk.dosenIds) {
          const dosenDoc = await db.collection('dosen').doc(dId).get();
          if (dosenDoc.exists) dosenNames.push(dosenDoc.data().nama);
        }
      }
      const sudahIsi = await hasFilledEdom(req.user.id, mkId, activePeriod.id);
      mkList.push({
        id: mkId,
        kode: mk.kode,
        nama: mk.nama,
        dosen: dosenNames.join(', '),
        sudahIsi,
        semester: semesterPeriod
      });
    }

    res.render('mahasiswa/edom/index', {
      title: 'Evaluasi Dosen (EDOM)',
      activePeriod,
      mkList,
      message: null
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data' });
  }
});

// Form isi edom untuk MK tertentu
router.get('/mk/:mkId', async (req, res) => {
  try {
    const { mkId } = req.params;
    const activePeriod = await getActiveEdomPeriod();
    if (!activePeriod) {
      return res.status(400).send('Tidak ada periode evaluasi aktif');
    }

    const sudahIsi = await hasFilledEdom(req.user.id, mkId, activePeriod.id);
    if (sudahIsi) {
      return res.status(400).send('Anda sudah mengisi evaluasi untuk mata kuliah ini');
    }

    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mk = mkDoc.data();

    // Ambil daftar pertanyaan aktif
    const questions = await getActiveQuestions();
    if (!questions.length) {
      return res.status(400).send('Belum ada pertanyaan evaluasi. Silakan hubungi admin.');
    }

    res.render('mahasiswa/edom/form', {
      title: `Evaluasi - ${mk.kode} ${mk.nama}`,
      mk,
      questions,
      activePeriod,
      user: req.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat form');
  }
});

// Submit edom
router.post('/mk/:mkId', async (req, res) => {
  try {
    const { mkId } = req.params;
    const { jawaban, komentar } = req.body; // jawaban array of nilai, komentar per pertanyaan opsional
    const activePeriod = await getActiveEdomPeriod();
    if (!activePeriod) {
      return res.status(400).send('Periode evaluasi tidak aktif');
    }

    const sudahIsi = await hasFilledEdom(req.user.id, mkId, activePeriod.id);
    if (sudahIsi) {
      return res.status(400).send('Anda sudah mengisi evaluasi untuk mata kuliah ini');
    }

    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mk = mkDoc.data();

    // Ambil dosen pengampu (asumsi dosenIds[0] sebagai dosen utama untuk evaluasi)
    // Bisa disederhanakan: simpan semua dosen yang mengampu MK ini, tapi evaluasi bisa per dosen? Untuk sederhana, evaluasi untuk semua dosen MK
    let dosenId = null, dosenNama = '';
    if (mk.dosenIds && mk.dosenIds.length) {
      dosenId = mk.dosenIds[0];
      const dosenDoc = await db.collection('dosen').doc(dosenId).get();
      if (dosenDoc.exists) dosenNama = dosenDoc.data().nama;
    }

    const questions = await getActiveQuestions();
    // Parse jawaban: expect req.body.nilai_<questionId> dan req.body.komentar_<questionId>
    const answers = [];
    for (const q of questions) {
      const nilai = parseInt(req.body[`nilai_${q.id}`]);
      const komentarQ = req.body[`komentar_${q.id}`] || '';
      if (!isNaN(nilai)) {
        answers.push({
          pertanyaanId: q.id,
          pertanyaan: q.pertanyaan,
          nilai,
          komentar: komentarQ
        });
      }
    }

    if (answers.length === 0) {
      return res.status(400).send('Harap memberikan penilaian');
    }

    const nilaiRata = calculateAverage(answers.map(a => ({ nilai: a.nilai })));

    await db.collection('edom_respon').add({
      mahasiswaId: req.user.id,
      mahasiswaNama: req.user.nama,
      mkId,
      mkKode: mk.kode,
      mkNama: mk.nama,
      dosenId,
      dosenNama,
      periodeId: activePeriod.id,
      semester: activePeriod.semester || getCurrentAcademicSemester().label,
      jawaban: answers,
      nilaiRata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    res.redirect('/mahasiswa/edom');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal menyimpan evaluasi');
  }
});

module.exports = router;