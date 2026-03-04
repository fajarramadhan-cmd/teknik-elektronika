/**
 * routes/admin-content/berita.js
 * CRUD berita untuk admin
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Semua route di sini memerlukan admin login
router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan folder gambar berita di Google Drive
 */
async function getBeritaImageFolderId() {
  const folderName = 'Berita_Images';
  const query = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    return folder.data.id;
  }
}

// ============================================================================
// DAFTAR BERITA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('berita')
      .orderBy('tanggal', 'desc')
      .get();
    const berita = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/berita', {
      title: 'Kelola Berita',
      berita,
      success: req.query.success
    });
  } catch (error) {
    console.error('Error ambil berita:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat berita' });
  }
});

// ============================================================================
// FORM TAMBAH BERITA
// ============================================================================

router.get('/create', (req, res) => {
  res.render('admin/berita_form', {
    title: 'Tambah Berita',
    berita: null,
    user: req.user
  });
});

// ============================================================================
// PROSES SIMPAN BERITA BARU
// ============================================================================

router.post('/', async (req, res) => {
  try {
    const { judul, isi, penulis, sumber, gambar } = req.body;

    if (!judul || !isi) {
      return res.status(400).send('Judul dan isi wajib diisi');
    }

    await db.collection('berita').add({
      judul,
      isi,
      penulis: penulis || req.user.nama,
      sumber: sumber || '',
      gambar: gambar || null,
      tanggal: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    res.redirect('/admin-content/berita?success=ditambahkan');
  } catch (error) {
    console.error('Error tambah berita:', error);
    res.status(500).send('Gagal menambah berita');
  }
});

// ============================================================================
// FORM EDIT BERITA
// ============================================================================

router.get('/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('berita').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Berita tidak ditemukan');
    }
    const berita = { id: doc.id, ...doc.data() };
    res.render('admin/berita_form', {
      title: 'Edit Berita',
      berita,
      user: req.user
    });
  } catch (error) {
    console.error('Error edit berita:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat form edit' });
  }
});

// ============================================================================
// PROSES UPDATE BERITA
// ============================================================================

router.post('/:id/update', async (req, res) => {
  try {
    const { judul, isi, penulis, sumber, gambar } = req.body;
    const beritaRef = db.collection('berita').doc(req.params.id);
    const beritaDoc = await beritaRef.get();
    if (!beritaDoc.exists) {
      return res.status(404).send('Berita tidak ditemukan');
    }
    const oldData = beritaDoc.data();

    const updateData = {
      judul,
      isi,
      penulis: penulis || oldData.penulis,
      sumber: sumber || oldData.sumber,
      gambar: gambar || oldData.gambar, // jika URL kosong, pertahankan yang lama
      updatedAt: new Date().toISOString()
    };

    await beritaRef.update(updateData);
    res.redirect('/admin-content/berita?success=diperbarui');
  } catch (error) {
    console.error('Error update berita:', error);
    res.status(500).send('Gagal update berita');
  }
});

// ============================================================================
// HAPUS BERITA
// ============================================================================

router.post('/:id/delete', async (req, res) => {
  try {
    await db.collection('berita').doc(req.params.id).delete();
    res.redirect('/admin-content/berita?success=dihapus');
  } catch (error) {
    console.error('Error hapus berita:', error);
    res.status(500).send('Gagal hapus berita');
  }
});

module.exports = router;