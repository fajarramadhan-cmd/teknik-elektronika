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
 * Update status dokumen di koleksi tertentu
 */
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

/**
 * Hapus dokumen dan file di Drive
 */
async function deleteItem(collection, id) {
  const ref = db.collection(collection).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Dokumen tidak ditemukan');
  const data = doc.data();
  if (data.fileId) {
    try {
      await drive.files.delete({ fileId: data.fileId });
    } catch (err) {
      console.error('Gagal hapus file Drive:', err.message);
    }
  }
  await ref.delete();
}

// ============================================================================
// HALAMAN UTAMA (Daftar semua konten)
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const { type = 'all', status = 'all' } = req.query; // default: tampilkan semua status

    let laporanList = [];
    let artikelList = [];
    let penelitianList = [];
    let pengabdianList = [];

    // Ambil data berdasarkan type
    if (type === 'all' || type === 'laporan') {
      let query = db.collection('laporanMagang');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      laporanList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    if (type === 'all' || type === 'artikel') {
      let query = db.collection('artikelDosen');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      artikelList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    if (type === 'all' || type === 'penelitian') {
      let query = db.collection('penelitian');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      penelitianList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    if (type === 'all' || type === 'pengabdian') {
      let query = db.collection('pengabdian');
      if (status !== 'all') query = query.where('status', '==', status);
      const snap = await query.orderBy('createdAt', 'desc').get();
      pengabdianList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    res.render('admin/elkLibrary_list', {
      title: 'Kelola E-Library',
      laporanList,
      artikelList,
      penelitianList,
      pengabdianList,
      currentType: type,
      currentStatus: status
    });
  } catch (error) {
    console.error('Error ELK Library admin:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data' });
  }
});

// ============================================================================
// APPROVE / REJECT
// ============================================================================
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

// ============================================================================
// EDIT METADATA
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
// HAPUS
// ============================================================================
router.post('/laporan/:id/delete', async (req, res) => {
  try {
    await deleteItem('laporanMagang', req.params.id);
    res.redirect('/admin/elk-library?type=laporan');
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/artikel/:id/delete', async (req, res) => {
  try {
    await deleteItem('artikelDosen', req.params.id);
    res.redirect('/admin/elk-library?type=artikel');
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/penelitian/:id/delete', async (req, res) => {
  try {
    await deleteItem('penelitian', req.params.id);
    res.redirect('/admin/elk-library?type=penelitian');
  } catch (err) { res.status(500).send(err.message); }
});
router.post('/pengabdian/:id/delete', async (req, res) => {
  try {
    await deleteItem('pengabdian', req.params.id);
    res.redirect('/admin/elk-library?type=pengabdian');
  } catch (err) { res.status(500).send(err.message); }
});

module.exports = router;