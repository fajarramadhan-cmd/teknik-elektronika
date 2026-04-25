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

const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

async function getOrCreateSubFolder(parentId, name) {
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length) return query.data.files[0].id;
  const folder = await drive.files.create({
    resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return folder.data.id;
}

async function getFolderPenelitian(dosenId) {
  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Karya Dosen');
  const jenisFolder = await getOrCreateSubFolder(parent, 'Penelitian');
  const dosenFolder = await getOrCreateSubFolder(jenisFolder, dosenId);
  return dosenFolder;
}

// Daftar penelitian
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('penelitian')
      .where('dosenId', '==', req.dosen.id)
      .orderBy('createdAt', 'desc')
      .get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('dosen/karya/penelitian_index', {
      title: 'Penelitian Saya',
      list,
      dosen: req.dosen
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data penelitian' });
  }
});

// Form tambah
router.get('/tambah', (req, res) => {
  res.render('dosen/karya/penelitian_form', {
    title: 'Tambah Penelitian',
    data: null,
    dosen: req.dosen
  });
});

// Proses tambah
router.post('/tambah', upload.single('file'), async (req, res) => {
  try {
    const { judul, namaJurnal, linkJurnal, statusSubmit, suratTugasUrl, tahun } = req.body;
    if (!judul) return res.status(400).send('Judul wajib diisi');
    let fileUrl = null, fileId = null;
    if (req.file) {
      const folderId = await getFolderPenelitian(req.dosen.id);
      const fileName = `${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) };
      const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
      await drive.permissions.create({ fileId: response.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      fileId = response.data.id;
    }
    await db.collection('penelitian').add({
      dosenId: req.dosen.id,
      dosenNama: req.dosen.nama,
      nip: req.dosen.nip,
      judul,
      namaJurnal: namaJurnal || '',
      linkJurnal: linkJurnal || '',
      statusSubmit: statusSubmit || 'belum_submit',
      suratTugasUrl: suratTugasUrl || '',
      tahun: parseInt(tahun) || new Date().getFullYear(),
      fileUrl,
      fileId,
      status: 'pending', // butuh verifikasi admin
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ action: 'submitted', timestamp: new Date().toISOString(), catatan: 'Pengajuan penelitian' }]
    });
    res.redirect('/dosen/penelitian');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal menyimpan penelitian');
  }
});

// Detail
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('penelitian').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).render('404', { title: 'Tidak ditemukan' });
    const data = { id: doc.id, ...doc.data() };
    if (data.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');
    res.render('dosen/karya/penelitian_detail', { title: 'Detail Penelitian', data, dosen: req.dosen });
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat detail');
  }
});

// Hapus (hanya jika status pending)
router.post('/:id/hapus', async (req, res) => {
  try {
    const ref = db.collection('penelitian').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).send('Tidak ditemukan');
    const data = doc.data();
    if (data.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');
    if (data.status !== 'pending') return res.status(400).send('Hanya data pending yang bisa dihapus');
    if (data.fileId) {
      try { await drive.files.delete({ fileId: data.fileId }); } catch (e) { console.error(e); }
    }
    await ref.delete();
    res.redirect('/dosen/penelitian');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal hapus');
  }
});

module.exports = router;