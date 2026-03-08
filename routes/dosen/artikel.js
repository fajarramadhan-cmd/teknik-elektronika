// routes/dosen/artikel.js
const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan folder artikel dosen di Google Drive, membuat jika belum ada
 */
async function getArtikelFolderId() {
  const folderName = 'Artikel_Dosen';
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
// DAFTAR ARTIKEL (milik dosen yang login)
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('artikelDosen')
      .where('dosenId', '==', req.dosen.id)
      .orderBy('createdAt', 'desc')
      .get();
    const artikelList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('dosen/artikel_list', {
      title: 'Artikel Saya',
      artikelList,
      success: req.query.success
    });
  } catch (error) {
    console.error('Error ambil artikel:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat artikel' });
  }
});

// ============================================================================
// FORM TAMBAH ARTIKEL
// ============================================================================

router.get('/create', (req, res) => {
  res.render('dosen/artikel_form', {
    title: 'Tambah Artikel',
    artikel: null
  });
});

// ============================================================================
// PROSES SIMPAN ARTIKEL BARU
// ============================================================================

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { judul, abstrak, kataKunci } = req.body;
    const file = req.file;

    if (!judul || !file) {
      return res.status(400).send('Judul dan file wajib diisi');
    }

    // Upload ke Google Drive
    const folderId = await getArtikelFolderId();
    const fileName = `${Date.now()}_${file.originalname}`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink'
    });

    // Set permission publik
    await drive.permissions.create({
      fileId: driveResponse.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;

    const artikelData = {
      dosenId: req.dosen.id,
      judul,
      abstrak: abstrak || '',
      kataKunci: kataKunci || '',
      fileUrl,
      fileId: driveResponse.data.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await db.collection('artikelDosen').add(artikelData);
    res.redirect('/dosen/artikel?success=ditambahkan');
  } catch (error) {
    console.error('Error tambah artikel:', error);
    res.status(500).send('Gagal menambah artikel');
  }
});

// ============================================================================
// DETAIL ARTIKEL
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('artikelDosen').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Artikel tidak ditemukan');
    const artikel = { id: doc.id, ...doc.data() };
    if (artikel.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');
    res.render('dosen/artikel_detail', { title: 'Detail Artikel', artikel });
  } catch (error) {
    console.error('Error detail artikel:', error);
    res.status(500).send('Gagal memuat detail');
  }
});

// ============================================================================
// FORM EDIT ARTIKEL
// ============================================================================

router.get('/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('artikelDosen').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Artikel tidak ditemukan');
    const artikel = { id: doc.id, ...doc.data() };
    if (artikel.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');
    res.render('dosen/artikel_form', { title: 'Edit Artikel', artikel });
  } catch (error) {
    console.error('Error form edit:', error);
    res.status(500).send('Gagal memuat form edit');
  }
});

// ============================================================================
// PROSES UPDATE ARTIKEL
// ============================================================================

router.post('/:id/update', upload.single('file'), async (req, res) => {
  try {
    const { judul, abstrak, kataKunci } = req.body;
    const file = req.file;
    const artikelRef = db.collection('artikelDosen').doc(req.params.id);
    const doc = await artikelRef.get();
    if (!doc.exists) return res.status(404).send('Artikel tidak ditemukan');
    const oldData = doc.data();
    if (oldData.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');

    const updateData = {
      judul,
      abstrak: abstrak || '',
      kataKunci: kataKunci || '',
      updatedAt: new Date().toISOString()
    };

    if (file) {
      // Hapus file lama jika ada
      if (oldData.fileId) {
        try {
          await drive.files.delete({ fileId: oldData.fileId });
        } catch (err) {
          console.error('Gagal hapus file lama:', err);
        }
      }
      // Upload file baru
      const folderId = await getArtikelFolderId();
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const driveResponse = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      await drive.permissions.create({
        fileId: driveResponse.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
      updateData.fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      updateData.fileId = driveResponse.data.id;
    }

    await artikelRef.update(updateData);
    res.redirect('/dosen/artikel?success=diperbarui');
  } catch (error) {
    console.error('Error update artikel:', error);
    res.status(500).send('Gagal update artikel');
  }
});

// ============================================================================
// HAPUS ARTIKEL
// ============================================================================

router.post('/:id/delete', async (req, res) => {
  try {
    const artikelRef = db.collection('artikelDosen').doc(req.params.id);
    const doc = await artikelRef.get();
    if (!doc.exists) return res.status(404).send('Artikel tidak ditemukan');
    const data = doc.data();
    if (data.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');
    if (data.fileId) {
      try {
        await drive.files.delete({ fileId: data.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err);
      }
    }
    await artikelRef.delete();
    res.redirect('/dosen/artikel?success=dihapus');
  } catch (error) {
    console.error('Error hapus artikel:', error);
    res.status(500).send('Gagal hapus artikel');
  }
});

module.exports = router;