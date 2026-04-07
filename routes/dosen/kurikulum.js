/**
 * routes/dosen/kurikulum.js
 * Menampilkan kurikulum prodi (daftar mata kuliah) dan detail MK
 * Serta halaman MyRPS (daftar MK yang diampu dosen) dan manajemen RPS + materi pertemuan
 * - Upload RPS (PDF) ke Google Drive
 * - Update pertemuan: tanggal, status, catatan, upload file pendukung
 * Topik materi sudah ditentukan oleh admin/kaprodi (tidak bisa diubah dosen)
 */

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
// KONSTANTA FOLDER GOOGLE DRIVE
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0'; // Ganti dengan ID folder Data WEB Anda

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

async function getRpsFolder(kodeMK) {
  const parentDosen = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Dosen');
  const parentRps = await getOrCreateSubFolder(parentDosen, 'RPS MK');
  const mkFolder = await getOrCreateSubFolder(parentRps, kodeMK);
  return mkFolder;
}

async function getMateriMkFolder(kodeMK) {
  const parentDosen = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Dosen');
  const parentMateri = await getOrCreateSubFolder(parentDosen, 'Materi MK');
  const mkFolder = await getOrCreateSubFolder(parentMateri, kodeMK);
  return mkFolder;
}

function removeUndefined(obj) {
  Object.keys(obj).forEach(key => obj[key] === undefined && delete obj[key]);
  return obj;
}

async function getDosenNames(dosenIds) {
  if (!dosenIds || dosenIds.length === 0) return '-';
  const names = [];
  for (const id of dosenIds) {
    const dosenDoc = await db.collection('dosen').doc(id).get();
    if (dosenDoc.exists) names.push(dosenDoc.data().nama);
  }
  return names.join(', ') || '-';
}

// ============================================================================
// ROUTE UTAMA (DAFTAR MK YANG DIAMPU DOSEN) - dengan filter semester
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const dosenId = req.dosen.id;
    const { semester } = req.query;

    let query = db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', dosenId)
      .orderBy('semester')
      .orderBy('kode');

    if (semester) query = query.where('semester', '==', parseInt(semester));

    const mkSnapshot = await query.get();
    const mkList = [];
    for (const doc of mkSnapshot.docs) {
      const data = doc.data();
      const dosenNames = await getDosenNames(data.dosenIds || []);
      mkList.push({
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        sks: data.sks,
        semester: data.semester,
        dosen: dosenNames,
        rpsUrl: data.rpsUrl || null
      });
    }

    const semesterSet = new Set();
    mkList.forEach(mk => semesterSet.add(mk.semester));
    const semesterList = Array.from(semesterSet).sort((a, b) => a - b);

    res.render('dosen/kurikulum/my_rps', {
      title: 'Mata Kuliah Saya',
      mkList,
      semesterList,
      selectedSemester: semester || ''
    });
  } catch (error) {
    console.error('Error memuat kurikulum dosen:', error);
    res.status(500).render('error', { message: 'Gagal memuat data mata kuliah' });
  }
});

// ============================================================================
// HALAMAN MY RPS (tanpa filter)
// ============================================================================
router.get('/my-rps', async (req, res) => {
  try {
    const dosenId = req.dosen.id;
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', dosenId)
      .orderBy('semester')
      .orderBy('kode')
      .get();

    const mkList = mkSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        sks: data.sks,
        semester: data.semester,
        rpsUrl: data.rpsUrl || null
      };
    });

    res.render('dosen/kurikulum/my_rps', {
      title: 'My RPS',
      mkList,
      semesterList: [],
      selectedSemester: ''
    });
  } catch (error) {
    console.error('Error memuat My RPS:', error);
    res.status(500).render('error', { message: 'Gagal memuat data RPS' });
  }
});

// ============================================================================
// HANDLER UPLOAD RPS (digunakan oleh dua route)
// ============================================================================
async function handleUploadRps(req, res, mkId) {
  try {
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mkData = mkDoc.data();

    if (!mkData.dosenIds || !mkData.dosenIds.includes(req.dosen.id)) {
      return res.status(403).send('Anda tidak memiliki akses ke mata kuliah ini');
    }
    if (!req.file) return res.status(400).send('File RPS tidak ditemukan');

    const folderId = await getRpsFolder(mkData.kode);
    const fileName = `RPS_${mkData.kode}.pdf`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) };
    const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
    await drive.permissions.create({ fileId: response.data.id, requestBody: { role: 'reader', type: 'anyone' } });
    const fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;

    await db.collection('mataKuliah').doc(mkId).update({ rpsUrl: fileUrl, updatedAt: new Date().toISOString() });
    res.redirect(`/dosen/kurikulum/${mkId}`);
  } catch (error) {
    console.error('Error upload RPS:', error);
    res.status(500).send('Gagal mengupload RPS');
  }
}

// Route upload RPS standar (dengan prefix /dosen/kurikulum/:id/rps)
router.post('/:id/rps', upload.single('rpsFile'), (req, res) => handleUploadRps(req, res, req.params.id));

// ALIAS: untuk mendukung form yang menggunakan /dosen/mk/:id/rps
router.post('/mk/:id/rps', upload.single('rpsFile'), (req, res) => handleUploadRps(req, res, req.params.id));

// ============================================================================
// HANDLER UPDATE PERTEMUAN
// ============================================================================
async function handleUpdatePertemuan(req, res, mkId, pertemuanKe) {
  try {
    const { tanggal, status, catatan } = req.body;
    const file = req.file;

    const mkRef = db.collection('mataKuliah').doc(mkId);
    const mkDoc = await mkRef.get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mkData = mkDoc.data();

    if (!mkData.dosenIds || !mkData.dosenIds.includes(req.dosen.id)) {
      return res.status(403).send('Anda tidak memiliki akses ke mata kuliah ini');
    }

    let materi = mkData.materi || [];
    const idx = materi.findIndex(m => m.pertemuan === pertemuanKe);
    const old = idx !== -1 ? materi[idx] : {};

    const updated = { pertemuan: pertemuanKe, updatedAt: new Date().toISOString() };
    updated.topik = old.topik || `Pertemuan ${pertemuanKe}`;
    updated.tanggal = tanggal !== undefined ? tanggal : (old.tanggal || null);
    updated.status = status !== undefined ? status : (old.status || 'belum');
    updated.catatan = catatan !== undefined ? catatan : (old.catatan || '');

    if (file) {
      const folderId = await getMateriMkFolder(mkData.kode);
      const fileName = `Pertemuan_${pertemuanKe}_${Date.now()}.pdf`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
      await drive.permissions.create({ fileId: response.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      updated.fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
    } else {
      if (old.fileUrl) updated.fileUrl = old.fileUrl;
    }

    removeUndefined(updated);
    if (idx !== -1) materi[idx] = { ...materi[idx], ...updated };
    else materi.push(updated);

    materi.sort((a, b) => a.pertemuan - b.pertemuan);
    await mkRef.update({ materi, updatedAt: new Date().toISOString() });
    res.redirect(`/dosen/kurikulum/${mkId}`);
  } catch (error) {
    console.error('Error update pertemuan:', error);
    res.status(500).send('Gagal update pertemuan');
  }
}

// Route update pertemuan standar
router.post('/:id/pertemuan/:pertemuan', upload.single('file'), (req, res) => {
  handleUpdatePertemuan(req, res, req.params.id, parseInt(req.params.pertemuan));
});

// ALIAS: untuk mendukung form yang menggunakan /dosen/mk/:id/pertemuan/:pertemuan
router.post('/mk/:id/pertemuan/:pertemuan', upload.single('file'), (req, res) => {
  handleUpdatePertemuan(req, res, req.params.id, parseInt(req.params.pertemuan));
});

// ============================================================================
// HALAMAN DETAIL MATA KULIAH
// ============================================================================
router.get('/:id', async (req, res) => {
  try {
    const mkId = req.params.id;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Mata kuliah tidak ditemukan' });
    }
    const mk = { id: mkId, ...mkDoc.data() };

    if (!mk.dosenIds || !mk.dosenIds.includes(req.dosen.id)) {
      return res.status(403).render('error', { title: 'Akses Ditolak', message: 'Anda tidak memiliki akses ke mata kuliah ini' });
    }

    const dosenList = [];
    for (const dId of mk.dosenIds || []) {
      const dDoc = await db.collection('dosen').doc(dId).get();
      if (dDoc.exists) dosenList.push(dDoc.data().nama);
    }

    const materiExisting = mk.materi || [];
    const pertemuanList = [];
    for (let i = 1; i <= 16; i++) {
      const existing = materiExisting.find(m => m.pertemuan === i) || {};
      pertemuanList.push({
        pertemuan: i,
        topik: existing.topik || `Pertemuan ${i}`,
        tanggal: existing.tanggal || null,
        status: existing.status || 'belum',
        catatan: existing.catatan || '',
        fileUrl: existing.fileUrl || null
      });
    }

    const terlaksana = pertemuanList.filter(p => p.status === 'selesai').length;
    const persentase = Math.round((terlaksana / 16) * 100);

    const enrollmentSnapshot = await db.collection('enrollment').where('mkId', '==', mkId).where('status', '==', 'active').get();
    const mahasiswaIds = enrollmentSnapshot.docs.map(doc => doc.data().userId).filter(uid => uid);
    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) mahasiswaList.push({ id: uid, nama: userDoc.data().nama, nim: userDoc.data().nim });
    }
    mahasiswaList.sort((a, b) => a.nim.localeCompare(b.nim));

    let tugasList = [];
    try {
      const tugasSnapshot = await db.collection('tugas').where('mkId', '==', mkId).orderBy('deadline', 'asc').get();
      tugasList = tugasSnapshot.docs.map(doc => ({ id: doc.id, judul: doc.data().judul, deadline: doc.data().deadline, tipe: doc.data().tipe }));
    } catch (err) { console.error('Gagal ambil tugas:', err.message); }

    res.render('dosen/kurikulum/detail', {
      title: `Detail MK - ${mk.kode} ${mk.nama}`,
      mk,
      dosenList,
      pertemuanList,
      terlaksana,
      persentase,
      mahasiswaList,
      tugasList
    });
  } catch (error) {
    console.error('Error memuat detail MK:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail mata kuliah' });
  }
});

// ============================================================================
// ALIAS GET untuk mendukung URL /dosen/mk/:id/rps (redirect ke halaman detail)
// ============================================================================
router.get('/mk/:id/rps', async (req, res) => {
  res.redirect(`/dosen/kurikulum/${req.params.id}`);
});

module.exports = router;