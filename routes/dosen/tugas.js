/**
 * routes/dosen/tugas.js
 * Kelola tugas untuk dosen (CRUD tugas)
 * Terintegrasi dengan folder Data WEB (ID: 17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// KONSTANTA FOLDER UTAMA (Data WEB)
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU (HELPER)
// ============================================================================

/**
 * Membuat atau mendapatkan subfolder di dalam folder induk
 * @param {string} parentId - ID folder induk
 * @param {string} name - Nama folder yang akan dibuat/dicari
 * @returns {Promise<string>} ID folder
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
 * Mendapatkan folder untuk menyimpan file soal tugas dosen.
 * Struktur: Data WEB / Dosen / Tugas / [KodeMK] / Soal /
 * @param {string} kodeMK - Kode mata kuliah (contoh: "PDK001")
 * @returns {Promise<string>} ID folder
 */
async function getSoalTugasFolder(kodeMK) {
  const parentDosen = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Dosen');
  const parentTugas = await getOrCreateSubFolder(parentDosen, 'Tugas');
  const mkFolder = await getOrCreateSubFolder(parentTugas, kodeMK);
  const soalFolder = await getOrCreateSubFolder(mkFolder, 'Soal');
  return soalFolder;
}

// ============================================================================
// DAFTAR TUGAS
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .orderBy('deadline', 'desc')
      .get();

    const tugasList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      // Ambil kode MK
      let mkKode = '';
      if (data.mkId) {
        const mkDoc = await db.collection('mataKuliah').doc(data.mkId).get();
        if (mkDoc.exists) mkKode = mkDoc.data().kode;
      }
      tugasList.push({
        id: doc.id,
        ...data,
        mkKode
      });
    }

    res.render('dosen/tugas_list', {
      title: 'Daftar Tugas',
      tugasList
    });
  } catch (error) {
    console.error('Error ambil tugas:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal mengambil daftar tugas' });
  }
});

// ============================================================================
// FORM BUAT TUGAS BARU
// ============================================================================
router.get('/create', async (req, res) => {
  try {
    // Ambil daftar mata kuliah yang diampu dosen ini
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .get();
    const mkList = mkSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.render('dosen/tugas_form', {
      title: 'Buat Tugas Baru',
      mkList,
      tugas: null
    });
  } catch (error) {
    console.error('Error load form tugas:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat form' });
  }
});

// ============================================================================
// SIMPAN TUGAS BARU (dengan upload file ke Data WEB)
// ============================================================================
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { mkId, judul, deskripsi, deadline, tipe } = req.body;
    const file = req.file;

    if (!mkId || !judul || !deadline) {
      return res.status(400).send('MK, judul, dan deadline wajib diisi');
    }

    // Ambil data MK untuk mendapatkan kode
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }
    const mkData = mkDoc.data();

    let fileUrl = null, fileId = null;
    if (file) {
      // Dapatkan folder soal berdasarkan kode MK
      const folderId = await getSoalTugasFolder(mkData.kode);
      const fileName = `${mkData.kode}_${Date.now()}_${file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id'
      });
      // Set permission publik
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
      fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      fileId = response.data.id;
    }

    await db.collection('tugas').add({
      dosenId: req.dosen.id,
      mkId,
      judul,
      deskripsi: deskripsi || '',
      deadline: new Date(deadline).toISOString(),
      tipe: tipe || 'tugas',
      fileUrl,
      fileId,
      mkKode: mkData.kode, // simpan kode untuk keperluan tampilan
      createdAt: new Date().toISOString()
    });

    res.redirect('/dosen/tugas');
  } catch (error) {
    console.error('Error buat tugas:', error);
    res.status(500).send('Gagal membuat tugas: ' + error.message);
  }
});

// ============================================================================
// DETAIL TUGAS
// ============================================================================
router.get('/:id', async (req, res) => {
  try {
    const tugasDoc = await db.collection('tugas').doc(req.params.id).get();
    if (!tugasDoc.exists) {
      return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Tugas tidak ditemukan' });
    }
    const tugas = { id: tugasDoc.id, ...tugasDoc.data() };

    // Pastikan tugas ini milik dosen yang login
    if (tugas.dosenId !== req.dosen.id) {
      return res.status(403).render('error', { title: 'Akses Ditolak', message: 'Anda tidak berhak mengakses tugas ini' });
    }

    // Ambil data MK
    let mkKode = '', mkNama = '';
    if (tugas.mkId) {
      const mkDoc = await db.collection('mataKuliah').doc(tugas.mkId).get();
      if (mkDoc.exists) {
        mkKode = mkDoc.data().kode;
        mkNama = mkDoc.data().nama;
      }
    }
    tugas.mkKode = mkKode;
    tugas.mkNama = mkNama;

    // Ambil daftar mahasiswa yang terdaftar di MK ini
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', tugas.mkId)
      .where('status', '==', 'active')
      .get();
    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().userId);

    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        // Cek pengumpulan
        const pengumpulanSnapshot = await db.collection('pengumpulan')
          .where('tugasId', '==', tugas.id)
          .where('mahasiswaId', '==', uid)
          .get();
        const pengumpulan = pengumpulanSnapshot.empty ? null : { id: pengumpulanSnapshot.docs[0].id, ...pengumpulanSnapshot.docs[0].data() };
        mahasiswaList.push({
          id: uid,
          nim: userData.nim,
          nama: userData.nama,
          pengumpulan
        });
      }
    }

    res.render('dosen/tugas_detail', {
      title: `Tugas: ${tugas.judul}`,
      tugas,
      mahasiswaList
    });
  } catch (error) {
    console.error('Error detail tugas:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail tugas' });
  }
});

// ============================================================================
// BERI NILAI (POST)
// ============================================================================
router.post('/pengumpulan/nilai', async (req, res) => {
  try {
    const { pengumpulanId, nilai, komentar } = req.body;
    if (!pengumpulanId || !nilai) {
      return res.status(400).send('Data tidak lengkap');
    }
    await db.collection('pengumpulan').doc(pengumpulanId).update({
      nilai: parseFloat(nilai),
      komentar: komentar || '',
      status: 'dinilai',
      dinilaiPada: new Date().toISOString()
    });
    res.redirect('back');
  } catch (error) {
    console.error('Error nilai:', error);
    res.status(500).send('Gagal memberi nilai');
  }
});

module.exports = router;