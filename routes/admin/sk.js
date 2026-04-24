const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);
router.use(isAdmin);

// Konstanta folder Drive
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0'; // Ganti dengan ID folder Data WEB Anda

async function getOrCreateSubFolder(parentId, name) {
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) return query.data.files[0].id;
  const folder = await drive.files.create({
    resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return folder.data.id;
}

async function getSkFolder() {
  const parentDosen = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Dosen');
  const skFolder = await getOrCreateSubFolder(parentDosen, 'SK Dosen');
  return skFolder;
}

// Halaman daftar SK (admin)
router.get('/', async (req, res) => {
  try {
    const skSnapshot = await db.collection('sk_dosen').orderBy('tanggalUpload', 'desc').get();
    const skList = [];
    for (const doc of skSnapshot.docs) {
      const data = doc.data();
      // Ambil nama dosen
      let namaDosen = 'Tidak diketahui';
      if (data.dosenId) {
        const dosenDoc = await db.collection('dosen').doc(data.dosenId).get();
        if (dosenDoc.exists) namaDosen = dosenDoc.data().nama;
      }
      skList.push({
        id: doc.id,
        ...data,
        namaDosen,
        tanggalUpload: data.tanggalUpload ? data.tanggalUpload.toDate() : null,
      });
    }
    // Ambil daftar dosen untuk dropdown
    const dosenSnapshot = await db.collection('dosen').get();
    const dosenList = dosenSnapshot.docs.map(doc => ({ id: doc.id, nama: doc.data().nama }));
    res.render('admin/sk/index', { title: 'Kelola SK Dosen', skList, dosenList });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { message: 'Gagal memuat data SK' });
  }
});

// Proses upload SK
router.post('/', upload.single('fileSk'), async (req, res) => {
  try {
    const { dosenId, kategori, judul } = req.body;
    if (!req.file) return res.status(400).send('File SK harus diupload');
    if (!dosenId || !kategori) return res.status(400).send('Dosen dan kategori wajib diisi');

    // Upload ke Drive
    const skFolderId = await getSkFolder();
    const originalName = req.file.originalname;
    const fileMetadata = { name: originalName, parents: [skFolderId] };
    const media = { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) };
    const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });
    const fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;

    // Simpan ke Firestore
    await db.collection('sk_dosen').add({
      dosenId,
      kategori,
      judul: judul || `SK ${kategori} - ${new Date().toLocaleDateString()}`,
      fileUrl,
      fileId: response.data.id,
      tanggalUpload: new Date(),
      createdBy: req.user.id,
    });

    res.redirect('/admin/sk');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal upload SK');
  }
});

// Hapus SK (opsional)
router.post('/:id/delete', async (req, res) => {
  try {
    const skId = req.params.id;
    const skDoc = await db.collection('sk_dosen').doc(skId).get();
    if (!skDoc.exists) return res.status(404).send('SK tidak ditemukan');
    const { fileId } = skDoc.data();
    // Hapus dari Drive (opsional)
    try {
      await drive.files.delete({ fileId });
    } catch (err) { console.error('Gagal hapus file dari Drive:', err.message); }
    // Hapus dari Firestore
    await db.collection('sk_dosen').doc(skId).delete();
    res.redirect('/admin/sk');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus SK');
  }
});

module.exports = router;