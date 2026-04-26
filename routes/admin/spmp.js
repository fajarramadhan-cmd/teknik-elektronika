const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { getActiveSpmpPeriod } = require('../../helpers/spmpHelper');

router.use(verifyToken);
router.use(isAdmin);

// ========== PERIODE ==========
router.get('/periods', async (req, res) => {
  const snapshot = await db.collection('spmp_periode').orderBy('tanggalMulai', 'desc').get();
  const periods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.render('admin/spmp/periods', { title: 'Periode SPMP', periods });
});

router.get('/periods/create', (req, res) => {
  res.render('admin/spmp/period_form', { title: 'Tambah Periode', period: null });
});
router.post('/periods', async (req, res) => {
  const { nama, tanggalMulai, tanggalSelesai, status } = req.body;
  await db.collection('spmp_periode').add({ nama, tanggalMulai, tanggalSelesai, status: status || 'active', createdAt: new Date() });
  res.redirect('/admin/spmp/periods');
});
router.get('/periods/:id/edit', async (req, res) => {
  const doc = await db.collection('spmp_periode').doc(req.params.id).get();
  res.render('admin/spmp/period_form', { title: 'Edit Periode', period: { id: doc.id, ...doc.data() } });
});
router.post('/periods/:id/edit', async (req, res) => {
  const { nama, tanggalMulai, tanggalSelesai, status } = req.body;
  await db.collection('spmp_periode').doc(req.params.id).update({ nama, tanggalMulai, tanggalSelesai, status });
  res.redirect('/admin/spmp/periods');
});
router.post('/periods/:id/delete', async (req, res) => {
  await db.collection('spmp_periode').doc(req.params.id).delete();
  res.redirect('/admin/spmp/periods');
});

// ========== INDIKATOR ==========
router.get('/indicators', async (req, res) => {
  const { periodeId } = req.query;
  const periods = (await db.collection('spmp_periode').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  let indicators = [];
  if (periodeId) {
    const snap = await db.collection('spmp_indikator').where('periodeId', '==', periodeId).orderBy('urutan').get();
    indicators = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  res.render('admin/spmp/indicators', { title: 'Indikator IKU', periods, selectedPeriode: periodeId, indicators });
});
router.get('/indicators/create', async (req, res) => {
  const periods = (await db.collection('spmp_periode').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  res.render('admin/spmp/indicator_form', { title: 'Tambah Indikator', indicator: null, periods });
});
router.post('/indicators', async (req, res) => {
  const { periodeId, nama, target, satuan, bobot, urutan } = req.body;
  await db.collection('spmp_indikator').add({ periodeId, nama, target: parseFloat(target), satuan, bobot: parseFloat(bobot), urutan: parseInt(urutan) });
  res.redirect(`/admin/spmp/indicators?periodeId=${periodeId}`);
});
router.get('/indicators/:id/edit', async (req, res) => {
  const doc = await db.collection('spmp_indikator').doc(req.params.id).get();
  const periods = (await db.collection('spmp_periode').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  res.render('admin/spmp/indicator_form', { title: 'Edit Indikator', indicator: { id: doc.id, ...doc.data() }, periods });
});
router.post('/indicators/:id/edit', async (req, res) => {
  const { periodeId, nama, target, satuan, bobot, urutan } = req.body;
  await db.collection('spmp_indikator').doc(req.params.id).update({ periodeId, nama, target: parseFloat(target), satuan, bobot: parseFloat(bobot), urutan: parseInt(urutan) });
  res.redirect(`/admin/spmp/indicators?periodeId=${periodeId}`);
});
router.post('/indicators/:id/delete', async (req, res) => {
  const doc = await db.collection('spmp_indikator').doc(req.params.id).get();
  const periodeId = doc.data().periodeId;
  await doc.ref.delete();
  res.redirect(`/admin/spmp/indicators?periodeId=${periodeId}`);
});

// ========== REKAP DOSEN ==========
router.get('/rekap', async (req, res) => {
  const { periodeId } = req.query;
  const periods = (await db.collection('spmp_periode').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  let data = [];
  if (periodeId) {
    const indicators = await db.collection('spmp_indikator').where('periodeId', '==', periodeId).get();
    const indiList = indicators.docs.map(d => ({ id: d.id, ...d.data() }));
    const responses = await db.collection('spmp_respon').where('periodeId', '==', periodeId).get();
    const dosenMap = new Map();
    for (const resp of responses.docs) {
      const r = resp.data();
      if (!dosenMap.has(r.dosenId)) {
        const dosenDoc = await db.collection('dosen').doc(r.dosenId).get();
        dosenMap.set(r.dosenId, { id: r.dosenId, nama: dosenDoc.exists ? dosenDoc.data().nama : 'Unknown', responses: [] });
      }
      dosenMap.get(r.dosenId).responses.push({ indikatorId: r.indikatorId, capaian: r.capaian, fileUrl: r.fileUrl });
    }
    for (const [dosenId, dosen] of dosenMap) {
      let totalBobot = 0, totalWeighted = 0;
      for (const ind of indiList) {
        const resp = dosen.responses.find(r => r.indikatorId === ind.id);
        const capaian = resp ? parseFloat(resp.capaian) || 0 : 0;
        const target = parseFloat(ind.target) || 1;
        const bobot = parseFloat(ind.bobot) || 0;
        const persentase = target > 0 ? Math.min(100, (capaian / target) * 100) : 0;
        totalBobot += bobot;
        totalWeighted += (persentase / 100) * bobot;
      }
      const skor = totalBobot > 0 ? (totalWeighted / totalBobot) * 100 : 0;
      data.push({ ...dosen, skor: Math.round(skor), responses: dosen.responses });
    }
    data.sort((a,b) => b.skor - a.skor);
  }
  res.render('admin/spmp/rekap', { title: 'Rekap Capaian Dosen', periods, selectedPeriode: periodeId, data, indiList: indicators.docs.map(d => d.data()) });
});

// Verifikasi bukti (tandai sudah dicek)
router.post('/verifikasi/:responId', async (req, res) => {
  await db.collection('spmp_respon').doc(req.params.responId).update({ verified: true, verifiedAt: new Date() });
  res.redirect('back');
});

module.exports = router;