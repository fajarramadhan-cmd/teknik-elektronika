/**
 * routes/admin/surat.js
 * Manajemen surat untuk mahasiswa DAN dosen
 * - Mahasiswa: collection 'surat'
 * - Dosen: collection 'surat_dosen'
 * - Upload file ke Google Drive, verifikasi, tolak surat
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Konstanta folder utama Data WEB
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getMahasiswa(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  return userDoc.exists ? { id: userId, ...userDoc.data() } : { id: userId, nama: 'Unknown', nim: '-' };
}

async function getDosen(dosenId) {
  const dosenDoc = await db.collection('dosen').doc(dosenId).get();
  return dosenDoc.exists ? { id: dosenId, ...dosenDoc.data() } : { id: dosenId, nama: 'Unknown', nip: '-' };
}

/**
 * Membuat atau mendapatkan subfolder di Google Drive
 */
async function getOrCreateSubFolder(parentId, name) {
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    return folder.data.id;
  }
}

/**
 * Mendapatkan folder untuk surat mahasiswa: Data WEB / Surat / [tahunAkademik] / [nim] /
 */
async function getSuratFolderMahasiswa(nim, tahunAkademik) {
  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Surat');
  const tahunFolder = await getOrCreateSubFolder(parent, tahunAkademik);
  const nimFolder = await getOrCreateSubFolder(tahunFolder, nim);
  return nimFolder;
}

/**
 * Mendapatkan folder untuk surat dosen: Data WEB / Surat Dosen / [tahunAkademik] / [nip] /
 */
async function getSuratFolderDosen(nip, tahunAkademik) {
  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Surat Dosen');
  const tahunFolder = await getOrCreateSubFolder(parent, tahunAkademik);
  const nipFolder = await getOrCreateSubFolder(tahunFolder, nip);
  return nipFolder;
}

// ============================================================================
// DAFTAR SURAT (GABUNGAN MAHASISWA & DOSEN)
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { status, role, search } = req.query; // role = 'mahasiswa' atau 'dosen'

    // Ambil surat mahasiswa
    let queryMahasiswa = db.collection('surat').orderBy('createdAt', 'desc');
    if (status) queryMahasiswa = queryMahasiswa.where('status', '==', status);
    const snapMahasiswa = await queryMahasiswa.get();

    // Ambil surat dosen
    let queryDosen = db.collection('surat_dosen').orderBy('createdAt', 'desc');
    if (status) queryDosen = queryDosen.where('status', '==', status);
    const snapDosen = await queryDosen.get();

    let suratList = [];

    // Proses surat mahasiswa
    for (const doc of snapMahasiswa.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      if (search) {
        const lower = search.toLowerCase();
        if (!mahasiswa.nama.toLowerCase().includes(lower) && !data.keperluan?.toLowerCase().includes(lower)) continue;
      }
      suratList.push({
        id: doc.id,
        role: 'mahasiswa',
        pemohon: mahasiswa.nama,
        identitas: mahasiswa.nim,
        ...data,
      });
    }

    // Proses surat dosen
    for (const doc of snapDosen.docs) {
      const data = doc.data();
      const dosen = await getDosen(data.dosenId);
      if (search) {
        const lower = search.toLowerCase();
        if (!dosen.nama.toLowerCase().includes(lower) && !data.keperluan?.toLowerCase().includes(lower)) continue;
      }
      suratList.push({
        id: doc.id,
        role: 'dosen',
        pemohon: dosen.nama,
        identitas: dosen.nip,
        ...data,
      });
    }

    // Urutkan berdasarkan createdAt (descending)
    suratList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Filter role jika ada
    if (role && role !== 'semua') {
      suratList = suratList.filter(s => s.role === role);
    }

    res.render('admin/surat/index', {
      title: 'Manajemen Surat (Mahasiswa & Dosen)',
      suratList,
      filters: { status, role, search }
    });
  } catch (error) {
    console.error('Error ambil surat:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat daftar surat' });
  }
});

// ============================================================================
// DETAIL SURAT (Berdasarkan role)
// ============================================================================

router.get('/:id/:role', async (req, res) => {
  try {
    const { id, role } = req.params;
    let surat, pemohon;
    if (role === 'mahasiswa') {
      const doc = await db.collection('surat').doc(id).get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = { id: doc.id, ...doc.data() };
      pemohon = await getMahasiswa(surat.userId);
    } else if (role === 'dosen') {
      const doc = await db.collection('surat_dosen').doc(id).get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = { id: doc.id, ...doc.data() };
      pemohon = await getDosen(surat.dosenId);
    } else {
      return res.status(400).send('Role tidak valid');
    }
    res.render('admin/surat/detail', { title: `Detail Surat - ${pemohon.nama}`, surat, pemohon, role });
  } catch (error) {
    console.error('Error detail surat:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail surat' });
  }
});

// ============================================================================
// UPLOAD FILE SURAT (APPROVE)
// ============================================================================

router.post('/:id/:role/upload', upload.single('file'), async (req, res) => {
  try {
    const { id, role } = req.params;
    const file = req.file;
    if (!file) return res.status(400).send('File tidak ada');

    let suratRef, surat, identitas, tahunAkademik, nimOrNip;
    if (role === 'mahasiswa') {
      suratRef = db.collection('surat').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      const mahasiswa = await getMahasiswa(surat.userId);
      identitas = mahasiswa.nim;
      nimOrNip = mahasiswa.nim;
      tahunAkademik = surat.tahunAkademik || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
      const folderId = await getSuratFolderMahasiswa(identitas, tahunAkademik);
      const fileName = `${identitas}_${surat.jenis.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const driveResponse = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
      await drive.permissions.create({ fileId: driveResponse.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      await suratRef.update({
        status: 'completed',
        fileUrl,
        fileId: driveResponse.data.id,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'completed', timestamp: new Date().toISOString(), catatan: 'Surat telah diupload oleh Admin' }]
      });
    } else if (role === 'dosen') {
      suratRef = db.collection('surat_dosen').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      const dosen = await getDosen(surat.dosenId);
      identitas = dosen.nip;
      nimOrNip = dosen.nip;
      tahunAkademik = surat.tahunAkademik || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
      const folderId = await getSuratFolderDosen(identitas, tahunAkademik);
      const fileName = `${identitas}_${surat.jenisSurat?.replace(/\s+/g, '_') || 'surat'}_${Date.now()}.pdf`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const driveResponse = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
      await drive.permissions.create({ fileId: driveResponse.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      await suratRef.update({
        status: 'completed',
        fileUrl,
        fileId: driveResponse.data.id,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'completed', timestamp: new Date().toISOString(), catatan: 'Surat telah diupload oleh Admin' }]
      });
    } else {
      return res.status(400).send('Role tidak valid');
    }

    // Redirect kembali ke halaman detail sesuai role
    res.redirect(`/admin/surat/${id}/${role}`);
  } catch (error) {
    console.error('Error upload surat:', error);
    res.status(500).send('Gagal upload surat: ' + error.message);
  }
});

// ============================================================================
// TOLAK SURAT (dengan alasan)
// ============================================================================

router.post('/:id/:role/reject', async (req, res) => {
  try {
    const { id, role } = req.params;
    const { alasan } = req.body;
    if (!alasan) return res.status(400).send('Alasan penolakan harus diisi');

    let suratRef, surat;
    if (role === 'mahasiswa') {
      suratRef = db.collection('surat').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      await suratRef.update({
        status: 'rejected',
        alasanPenolakan: alasan,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'rejected', timestamp: new Date().toISOString(), catatan: `Ditolak: ${alasan}` }]
      });
    } else if (role === 'dosen') {
      suratRef = db.collection('surat_dosen').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      await suratRef.update({
        status: 'rejected',
        alasanPenolakan: alasan,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'rejected', timestamp: new Date().toISOString(), catatan: `Ditolak: ${alasan}` }]
      });
    } else {
      return res.status(400).send('Role tidak valid');
    }
    res.redirect(`/admin/surat/${id}/${role}`);
  } catch (error) {
    console.error('Error reject surat:', error);
    res.status(500).send('Gagal menolak surat');
  }
});

// ============================================================================
// HAPUS SURAT (beserta file di Drive)
// ============================================================================

router.post('/:id/:role/delete', async (req, res) => {
  try {
    const { id, role } = req.params;
    let suratRef, surat;
    if (role === 'mahasiswa') {
      suratRef = db.collection('surat').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      if (surat.fileId) {
        try { await drive.files.delete({ fileId: surat.fileId }); } catch (err) { console.error('Gagal hapus file Drive:', err.message); }
      }
      await suratRef.delete();
    } else if (role === 'dosen') {
      suratRef = db.collection('surat_dosen').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      if (surat.fileId) {
        try { await drive.files.delete({ fileId: surat.fileId }); } catch (err) { console.error('Gagal hapus file Drive:', err.message); }
      }
      await suratRef.delete();
    } else {
      return res.status(400).send('Role tidak valid');
    }
    res.redirect('/admin/surat');
  } catch (error) {
    console.error('Error delete surat:', error);
    res.status(500).send('Gagal menghapus surat');
  }
});

module.exports = router;