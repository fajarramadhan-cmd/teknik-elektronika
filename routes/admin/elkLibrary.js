const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Menampilkan halaman daftar dengan filter jenis dan status
 */
router.get('/', async (req, res) => {
  try {
    const { type = 'all', status = 'approved' } = req.query; // status: approved, pending, rejected, all
    let laporanList = [], artikelList = [], penelitianList = [], pengabdianList = [];

    if (type === 'all' || type === 'laporan') {
      let query = db.collection('laporanMagang');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      laporanList = snap.docs.map(d => ({ id: d.id, ...d.data(), kategori: 'laporan' }));
    }
    if (type === 'all' || type === 'artikel') {
      let query = db.collection('artikelDosen');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      artikelList = snap.docs.map(d => ({ id: d.id, ...d.data(), kategori: 'artikel' }));
    }
    if (type === 'all' || type === 'penelitian') {
      let query = db.collection('penelitian');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      penelitianList = snap.docs.map(d => ({ id: d.id, ...d.data(), kategori: 'penelitian' }));
    }
    if (type === 'all' || type === 'pengabdian') {
      let query = db.collection('pengabdian');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      pengabdianList = snap.docs.map(d => ({ id: d.id, ...d.data(), kategori: 'pengabdian' }));
    }

    const allItems = [...laporanList, ...artikelList, ...penelitianList, ...pengabdianList];
    allItems.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.render('admin/elkLibrary_list', {
      title: 'Kelola E-Library',
      items: allItems,
      currentType: type,
      currentStatus: status
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data' });
  }
});

// ============================================================================
// FUNGSI UMUM APPROVE / REJECT (untuk semua koleksi)
// ============================================================================

async function updateStatus(collection, id, status, approvedBy = null) {
  const ref = db.collection(collection).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Dokumen tidak ditemukan');
  const updateData = { status, updatedAt: new Date().toISOString() };
  if (status === 'approved') {
    updateData.approvedAt = new Date().toISOString();
    updateData.approvedBy = approvedBy;
  } else if (status === 'rejected') {
    updateData.rejectedAt = new Date().toISOString();
    updateData.rejectedBy = approvedBy;
  }
  await ref.update(updateData);
}

// LAPORAN
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

// ARTIKEL
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

// PENELITIAN
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

// PENGABDIAN
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

// ============================================================================
// EDIT (HANYA METADATA, TIDAK UBAH FILE)
// ============================================================================

// Laporan
router.get('/laporan/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('laporanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const item = { id: doc.id, ...doc.data() };
    res.render('admin/elkLibrary_edit', { title: 'Edit Laporan', item, type: 'laporan' });
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/laporan/:id/edit', async (req, res) => {
  try {
    const { judulPublik, abstrak, pembimbing, tahun } = req.body;
    await db.collection('laporanMagang').doc(req.params.id).update({
      judulPublik, abstrak, pembimbing: pembimbing || '', tahun: parseInt(tahun), updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/elk-library?type=laporan');
  } catch (err) { res.status(500).send(err.message); }
});

// Artikel
router.get('/artikel/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('artikelDosen').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Artikel tidak ditemukan');
    const item = { id: doc.id, ...doc.data() };
    res.render('admin/elkLibrary_edit', { title: 'Edit Artikel', item, type: 'artikel' });
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/artikel/:id/edit', async (req, res) => {
  try {
    const { judul, abstrak, authors, tahun, metadataJurnal, metadataDoi } = req.body;
    await db.collection('artikelDosen').doc(req.params.id).update({
      judul, abstrak, authors: authors ? authors.split(',').map(s => s.trim()) : [],
      publicationYear: parseInt(tahun),
      metadata: { jurnal: metadataJurnal || '', doi: metadataDoi || '' },
      updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/elk-library?type=artikel');
  } catch (err) { res.status(500).send(err.message); }
});

// Penelitian
router.get('/penelitian/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('penelitian').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Penelitian tidak ditemukan');
    const item = { id: doc.id, ...doc.data() };
    res.render('admin/elkLibrary_edit', { title: 'Edit Penelitian', item, type: 'penelitian' });
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/penelitian/:id/edit', async (req, res) => {
  try {
    const { judul, namaJurnal, linkJurnal, tahun } = req.body;
    await db.collection('penelitian').doc(req.params.id).update({
      judul, namaJurnal: namaJurnal || '', linkJurnal: linkJurnal || '',
      tahun: parseInt(tahun), updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/elk-library?type=penelitian');
  } catch (err) { res.status(500).send(err.message); }
});

// Pengabdian
router.get('/pengabdian/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('pengabdian').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Pengabdian tidak ditemukan');
    const item = { id: doc.id, ...doc.data() };
    res.render('admin/elkLibrary_edit', { title: 'Edit Pengabdian', item, type: 'pengabdian' });
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/pengabdian/:id/edit', async (req, res) => {
  try {
    const { judul, namaKegiatan, mitra, tahun } = req.body;
    await db.collection('pengabdian').doc(req.params.id).update({
      judul, namaKegiatan: namaKegiatan || '', mitra: mitra || '',
      tahun: parseInt(tahun), updatedAt: new Date().toISOString()
    });
    res.redirect('/admin/elk-library?type=pengabdian');
  } catch (err) { res.status(500).send(err.message); }
});

// ============================================================================
// HAPUS (BESERTA FILE DI DRIVE)
// ============================================================================
async function deleteItem(collection, id) {
  const ref = db.collection(collection).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Dokumen tidak ditemukan');
  const data = doc.data();
  if (data.fileId) {
    try { await drive.files.delete({ fileId: data.fileId }); } catch (e) { console.error('Gagal hapus file Drive:', e.message); }
  }
  await ref.delete();
}
router.post('/laporan/:id/delete', async (req, res) => {
  try { await deleteItem('laporanMagang', req.params.id); res.redirect('/admin/elk-library?type=laporan'); } catch (err) { res.status(500).send(err.message); }
});
router.post('/artikel/:id/delete', async (req, res) => {
  try { await deleteItem('artikelDosen', req.params.id); res.redirect('/admin/elk-library?type=artikel'); } catch (err) { res.status(500).send(err.message); }
});
router.post('/penelitian/:id/delete', async (req, res) => {
  try { await deleteItem('penelitian', req.params.id); res.redirect('/admin/elk-library?type=penelitian'); } catch (err) { res.status(500).send(err.message); }
});
router.post('/pengabdian/:id/delete', async (req, res) => {
  try { await deleteItem('pengabdian', req.params.id); res.redirect('/admin/elk-library?type=pengabdian'); } catch (err) { res.status(500).send(err.message); }
});

module.exports = router;