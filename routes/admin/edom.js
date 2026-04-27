const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');

router.use(verifyToken);
router.use(isAdmin);

// ==================== HALAMAN UTAMA (INDEX) ====================
router.get('/', (req, res) => {
  res.render('admin/edom/index', { title: 'EDOM - Admin' });
});

// ==================== PERIODE ====================
router.get('/periods', async (req, res) => {
  try {
    const snapshot = await db.collection('edom_periode').orderBy('tanggalMulai', 'desc').get();
    const periods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/edom/periods', { title: 'Kelola Periode EDOM', periods });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/periods/create', (req, res) => {
  const defaultSemester = getCurrentAcademicSemester().label;
  res.render('admin/edom/period_form', { title: 'Tambah Periode', period: null, defaultSemester });
});

router.post('/periods', async (req, res) => {
  try {
    const { nama, tanggalMulai, tanggalSelesai, semester, status } = req.body;
    if (!nama || !tanggalMulai || !tanggalSelesai || !semester) {
      return res.status(400).send('Semua field wajib diisi');
    }
    await db.collection('edom_periode').add({
      nama,
      tanggalMulai,
      tanggalSelesai,
      semester,
      status: status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/edom/periods');
  } catch (err) { res.status(500).send(err.message); }
});

router.get('/periods/:id/edit', async (req, res) => {
  const doc = await db.collection('edom_periode').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).send('Periode tidak ditemukan');
  res.render('admin/edom/period_form', { title: 'Edit Periode', period: { id: doc.id, ...doc.data() }, defaultSemester: null });
});

router.post('/periods/:id/edit', async (req, res) => {
  try {
    const { nama, tanggalMulai, tanggalSelesai, semester, status } = req.body;
    await db.collection('edom_periode').doc(req.params.id).update({
      nama, tanggalMulai, tanggalSelesai, semester, status,
      updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/edom/periods');
  } catch (err) { res.status(500).send(err.message); }
});

router.post('/periods/:id/delete', async (req, res) => {
  await db.collection('edom_periode').doc(req.params.id).delete();
  res.redirect('/admin/edom/periods');
});

// ==================== KUISIONER ====================
router.get('/questions', async (req, res) => {
  const snapshot = await db.collection('edom_kuisioner').orderBy('urutan', 'asc').get();
  const questions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.render('admin/edom/questions', { title: 'Kelola Kuisioner EDOM', questions });
});

router.get('/questions/create', (req, res) => {
  res.render('admin/edom/question_form', { title: 'Tambah Pertanyaan', question: null });
});

router.post('/questions', async (req, res) => {
  const { pertanyaan, tipe, skala, bobot, urutan, aktif } = req.body;
  if (!pertanyaan) return res.status(400).send('Pertanyaan wajib diisi');
  await db.collection('edom_kuisioner').add({
    pertanyaan,
    tipe: tipe || 'rating',
    skala: parseInt(skala) || 5,
    bobot: parseFloat(bobot) || 1,
    urutan: parseInt(urutan) || 0,
    aktif: aktif === 'on',
    createdAt: new Date().toISOString()
  });
  res.redirect('/admin/edom/questions');
});

router.get('/questions/:id/edit', async (req, res) => {
  const doc = await db.collection('edom_kuisioner').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).send('Pertanyaan tidak ditemukan');
  res.render('admin/edom/question_form', { title: 'Edit Pertanyaan', question: { id: doc.id, ...doc.data() } });
});

router.post('/questions/:id/edit', async (req, res) => {
  const { pertanyaan, tipe, skala, bobot, urutan, aktif } = req.body;
  await db.collection('edom_kuisioner').doc(req.params.id).update({
    pertanyaan, tipe, skala: parseInt(skala), bobot: parseFloat(bobot), urutan: parseInt(urutan),
    aktif: aktif === 'on',
    updatedAt: new Date().toISOString()
  });
  res.redirect('/admin/edom/questions');
});

router.post('/questions/:id/delete', async (req, res) => {
  await db.collection('edom_kuisioner').doc(req.params.id).delete();
  res.redirect('/admin/edom/questions');
});

// ==================== REKAP HASIL ====================
router.get('/rekap', async (req, res) => {
  const { periodeId } = req.query;
  const periodsSnap = await db.collection('edom_periode').orderBy('tanggalMulai', 'desc').get();
  const periods = periodsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  let results = [];
  if (periodeId) {
    const responSnap = await db.collection('edom_respon')
      .where('periodeId', '==', periodeId)
      .get();
    const dosenMap = new Map();
    for (const doc of responSnap.docs) {
      const data = doc.data();
      if (!dosenMap.has(data.dosenId)) {
        dosenMap.set(data.dosenId, {
          dosenId: data.dosenId,
          dosenNama: data.dosenNama,
          totalNilai: 0,
          count: 0,
          mkSet: new Set()
        });
      }
      const entry = dosenMap.get(data.dosenId);
      entry.totalNilai += data.nilaiRata;
      entry.count++;
      entry.mkSet.add(data.mkId);
    }
    results = Array.from(dosenMap.values()).map(r => ({
      ...r,
      average: r.count ? (r.totalNilai / r.count).toFixed(2) : 0,
      jumlahMk: r.mkSet.size
    }));
  }
  res.render('admin/edom/rekap', { title: 'Rekap EDOM', periods, selectedPeriod: periodeId, results });
});

module.exports = router;