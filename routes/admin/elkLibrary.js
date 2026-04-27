const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');

router.use(verifyToken);
router.use(isAdmin);

// ========== FUNGSI BANTU ==========
async function updateStatus(collection, id, status, userId) {
  const ref = db.collection(collection).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Dokumen tidak ditemukan');
  const updateData = { status, updatedAt: new Date().toISOString() };
  if (status === 'approved') {
    updateData.approvedAt = new Date().toISOString();
    updateData.approvedBy = userId;
  } else if (status === 'rejected') {
    updateData.rejectedAt = new Date().toISOString();
    updateData.rejectedBy = userId;
  }
  await ref.update(updateData);
}

async function deleteItem(collection, id) {
  const ref = db.collection(collection).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Dokumen tidak ditemukan');
  const data = doc.data();
  if (data.fileId) {
    try { await drive.files.delete({ fileId: data.fileId }); } catch (err) { console.error('Gagal hapus file Drive:', err.message); }
  }
  await ref.delete();
}

// ========== HALAMAN UTAMA ==========
router.get('/', async (req, res) => {
  try {
    const { type = 'all', status = 'all' } = req.query;
    let laporanList = [], artikelList = [], penelitianList = [], pengabdianList = [];

    if (type === 'all' || type === 'laporan') {
      const snap = await db.collection('laporanMagang').get();
      let data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (status !== 'all') data = data.filter(d => d.status === status);
      laporanList = data;
    }
    if (type === 'all' || type === 'artikel') {
      const snap = await db.collection('artikelDosen').get();
      let data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (status !== 'all') data = data.filter(d => d.status === status);
      artikelList = data;
    }
    if (type === 'all' || type === 'penelitian') {
      const snap = await db.collection('penelitian').get();
      let data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (status !== 'all') data = data.filter(d => d.status === status);
      penelitianList = data;
    }
    if (type === 'all' || type === 'pengabdian') {
      const snap = await db.collection('pengabdian').get();
      let data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (status !== 'all') data = data.filter(d => d.status === status);
      pengabdianList = data;
    }

    // Optional: urutkan secara manual (descending berdasarkan createdAt)
    const sortByDate = (arr) => arr.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    laporanList = sortByDate(laporanList);
    artikelList = sortByDate(artikelList);
    penelitianList = sortByDate(penelitianList);
    pengabdianList = sortByDate(pengabdianList);

    res.render('admin/elkLibrary_list', {
      laporanList, artikelList, penelitianList, pengabdianList,
      currentType: type, currentStatus: status
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat data: ' + err.message);
  }
});

// ========== APPROVE / REJECT ==========
// Laporan
router.post('/laporan/:id/approve', async (req, res) => {
  try {
    await updateStatus('laporanMagang', req.params.id, 'approved', req.user.id);
    res.redirect('/admin/elk-library?type=laporan&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/laporan/:id/reject', async (req, res) => {
  try {
    await updateStatus('laporanMagang', req.params.id, 'rejected', req.user.id);
    res.redirect('/admin/elk-library?type=laporan&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});
// Artikel
router.post('/artikel/:id/approve', async (req, res) => {
  try {
    await updateStatus('artikelDosen', req.params.id, 'approved', req.user.id);
    res.redirect('/admin/elk-library?type=artikel&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/artikel/:id/reject', async (req, res) => {
  try {
    await updateStatus('artikelDosen', req.params.id, 'rejected', req.user.id);
    res.redirect('/admin/elk-library?type=artikel&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});
// Penelitian
router.post('/penelitian/:id/approve', async (req, res) => {
  try {
    await updateStatus('penelitian', req.params.id, 'approved', req.user.id);
    res.redirect('/admin/elk-library?type=penelitian&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/penelitian/:id/reject', async (req, res) => {
  try {
    await updateStatus('penelitian', req.params.id, 'rejected', req.user.id);
    res.redirect('/admin/elk-library?type=penelitian&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});
// Pengabdian
router.post('/pengabdian/:id/approve', async (req, res) => {
  try {
    await updateStatus('pengabdian', req.params.id, 'approved', req.user.id);
    res.redirect('/admin/elk-library?type=pengabdian&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/pengabdian/:id/reject', async (req, res) => {
  try {
    await updateStatus('pengabdian', req.params.id, 'rejected', req.user.id);
    res.redirect('/admin/elk-library?type=pengabdian&status=pending');
  } catch (err) { res.status(500).send(err.message); }
});

// ========== EDIT ==========
// Laporan
router.get('/laporan/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('laporanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    res.render('admin/elkLibrary_edit', { title: 'Edit Laporan', item: { id: doc.id, ...doc.data() }, type: 'laporan' });
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/laporan/:id/edit', async (req, res) => {
  try {
    const { judulPublik, abstrak, pembimbing, tahun } = req.body;
    await db.collection('laporanMagang').doc(req.params.id).update({
      judulPublik, abstrak, pembimbing, tahun: parseInt(tahun), updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/elk-library');
  } catch (err) { res.status(500).send(err.message); }
});
// (sama untuk artikel, penelitian, pengabdian – Anda bisa salin pola di atas)

// ========== HAPUS ==========
router.post('/laporan/:id/delete', async (req, res) => {
  try {
    await deleteItem('laporanMagang', req.params.id);
    res.redirect('/admin/elk-library');
  } catch (err) { res.status(500).send(err.message); }
});
// (sama untuk lainnya)

module.exports = router;