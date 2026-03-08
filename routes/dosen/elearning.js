/**
 * routes/dosen/elearning.js
 * Fitur E-Learning untuk dosen: mengelola pertemuan, tugas, dan nilai per mata kuliah
 * Terintegrasi dengan Data WEB untuk penyimpanan file soal tugas
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
// FUNGSI BANTU
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
 * Mendapatkan folder untuk menyimpan file soal tugas.
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
// DAFTAR MATA KULIAH YANG DIAMPU
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.user.id)
      .orderBy('semester', 'desc')
      .orderBy('kode')
      .get();
    const mkList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.render('dosen/elearning_index', {
      title: 'E-Learning',
      mkList
    });
  } catch (error) {
    console.error('Error mengambil MK untuk e-learning:', error);
    res.status(500).render('error', { message: 'Gagal memuat data MK' });
  }
});

// ============================================================================
// DETAIL MATA KULIAH (PERTEMUAN, TUGAS, MAHASISWA)
// ============================================================================

router.get('/:mkId', async (req, res) => {
  try {
    const mkId = req.params.mkId;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mk = { id: mkDoc.id, ...mkDoc.data() };

    if (!mk.dosenIds || !mk.dosenIds.includes(req.user.id)) {
      return res.status(403).send('Anda tidak berhak mengakses MK ini');
    }

    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .get();
    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().mahasiswaId);
    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) mahasiswaList.push({ id: uid, ...userDoc.data() });
    }

    const materi = mk.materi || [];
    const pertemuanList = [];
    for (let i = 1; i <= 16; i++) {
      const existing = materi.find(m => m.pertemuan === i) || {};
      pertemuanList.push({
        pertemuan: i,
        topik: existing.topik || `Pertemuan ${i}`,
        tanggal: existing.tanggal || null,
        status: existing.status || 'belum',
        catatan: existing.catatan || '',
        fileUrl: existing.fileUrl || null
      });
    }

    const tugasSnapshot = await db.collection('tugas')
      .where('mkId', '==', mkId)
      .orderBy('deadline', 'asc')
      .get();
    const tugasList = tugasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.render('dosen/elearning_mk_detail', {
      title: `${mk.kode} - ${mk.nama}`,
      mk,
      mahasiswaList,
      pertemuanList,
      tugasList
    });
  } catch (error) {
    console.error('Error detail MK e-learning:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail MK' });
  }
});

// ============================================================================
// KELOLA PERTEMUAN
// ============================================================================

router.post('/:mkId/pertemuan/:pertemuan', async (req, res) => {
  try {
    const { mkId, pertemuan } = req.params;
    const { topik, tanggal, catatan, status } = req.body;

    const mkRef = db.collection('mataKuliah').doc(mkId);
    const mkDoc = await mkRef.get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    if (!mkDoc.data().dosenIds.includes(req.user.id)) {
      return res.status(403).send('Tidak diizinkan');
    }

    let materi = mkDoc.data().materi || [];
    const idx = materi.findIndex(m => m.pertemuan == pertemuan);
    const updated = {
      pertemuan: parseInt(pertemuan),
      topik: topik || `Pertemuan ${pertemuan}`,
      tanggal: tanggal || null,
      status: status || (tanggal ? 'selesai' : 'belum'),
      catatan: catatan || '',
      updatedAt: new Date().toISOString()
    };
    if (idx !== -1) {
      materi[idx] = { ...materi[idx], ...updated };
    } else {
      materi.push(updated);
    }
    materi.sort((a, b) => a.pertemuan - b.pertemuan);
    await mkRef.update({ materi, updatedAt: new Date().toISOString() });

    res.redirect(`/dosen/elearning/${mkId}`);
  } catch (error) {
    console.error('Error update pertemuan:', error);
    res.status(500).send('Gagal update pertemuan');
  }
});

router.post('/:mkId/pertemuan/bulk', async (req, res) => {
  try {
    const { mkId } = req.params;
    const { completed } = req.body; // array of numbers

    const mkRef = db.collection('mataKuliah').doc(mkId);
    const mkDoc = await mkRef.get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    if (!mkDoc.data().dosenIds.includes(req.user.id)) {
      return res.status(403).send('Tidak diizinkan');
    }

    let materi = mkDoc.data().materi || [];
    const completedSet = new Set((Array.isArray(completed) ? completed : []).map(Number));

    for (let i = 1; i <= 16; i++) {
      const idx = materi.findIndex(m => m.pertemuan === i);
      const isCompleted = completedSet.has(i);
      if (idx !== -1) {
        materi[idx].status = isCompleted ? 'selesai' : 'belum';
        if (isCompleted && !materi[idx].tanggal) {
          materi[idx].tanggal = new Date().toISOString().split('T')[0];
        }
      } else {
        materi.push({
          pertemuan: i,
          topik: `Pertemuan ${i}`,
          status: isCompleted ? 'selesai' : 'belum',
          tanggal: isCompleted ? new Date().toISOString().split('T')[0] : null,
        });
      }
    }
    materi.sort((a, b) => a.pertemuan - b.pertemuan);
    await mkRef.update({ materi, updatedAt: new Date().toISOString() });

    res.redirect(`/dosen/elearning/${mkId}`);
  } catch (error) {
    console.error('Error bulk update pertemuan:', error);
    res.status(500).send('Gagal bulk update');
  }
});

// ============================================================================
// KELOLA TUGAS
// ============================================================================

router.get('/:mkId/tugas/create', async (req, res) => {
  try {
    const { mkId } = req.params;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    if (!mkDoc.data().dosenIds.includes(req.user.id)) {
      return res.status(403).send('Tidak diizinkan');
    }
    const mk = { id: mkDoc.id, ...mkDoc.data() };
    res.render('dosen/elearning_tugas_form', {
      title: 'Buat Tugas Baru',
      mk,
      tugas: null
    });
  } catch (error) {
    console.error('Error load form tugas:', error);
    res.status(500).send('Gagal memuat form');
  }
});

/**
 * POST /dosen/elearning/:mkId/tugas
 * Simpan tugas baru, upload file soal ke folder Data WEB/Dosen/Tugas/[KodeMK]/Soal/
 */
router.post('/:mkId/tugas', upload.single('file'), async (req, res) => {
  try {
    const { mkId } = req.params;
    const { judul, deskripsi, deadline, tipe } = req.body;
    const file = req.file;

    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    if (!mkDoc.data().dosenIds.includes(req.user.id)) {
      return res.status(403).send('Tidak diizinkan');
    }
    const mk = mkDoc.data();

    let fileUrl = null, fileId = null;
    if (file) {
      // Dapatkan folder Soal berdasarkan kode MK
      const folderId = await getSoalTugasFolder(mk.kode);
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id'
      });

      // Set akses publik
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      fileId = response.data.id;
    }

    await db.collection('tugas').add({
      mkId,
      dosenId: req.user.id,
      judul,
      deskripsi,
      deadline: new Date(deadline).toISOString(),
      tipe: tipe || 'tugas',
      fileUrl,
      fileId, // simpan fileId untuk kemudahan hapus nanti
      createdAt: new Date().toISOString()
    });

    res.redirect(`/dosen/elearning/${mkId}`);
  } catch (error) {
    console.error('Error buat tugas:', error);
    res.status(500).send('Gagal membuat tugas');
  }
});

/**
 * GET /dosen/elearning/:mkId/tugas/:tugasId
 * Detail tugas dan daftar pengumpulan mahasiswa
 */
router.get('/:mkId/tugas/:tugasId', async (req, res) => {
  try {
    const { mkId, tugasId } = req.params;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    if (!mkDoc.data().dosenIds.includes(req.user.id)) {
      return res.status(403).send('Tidak diizinkan');
    }

    const tugasDoc = await db.collection('tugas').doc(tugasId).get();
    if (!tugasDoc.exists) return res.status(404).send('Tugas tidak ditemukan');
    const tugas = { id: tugasDoc.id, ...tugasDoc.data() };

    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .get();
    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().mahasiswaId);

    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const pengumpulanSnapshot = await db.collection('pengumpulan')
          .where('tugasId', '==', tugasId)
          .where('mahasiswaId', '==', uid)
          .get();
        const pengumpulan = pengumpulanSnapshot.empty ? null : { id: pengumpulanSnapshot.docs[0].id, ...pengumpulanSnapshot.docs[0].data() };
        mahasiswaList.push({
          id: uid,
          ...userDoc.data(),
          pengumpulan
        });
      }
    }

    res.render('dosen/elearning_tugas_detail', {
      title: tugas.judul,
      mk: mkDoc.data(),
      tugas,
      mahasiswaList
    });
  } catch (error) {
    console.error('Error detail tugas:', error);
    res.status(500).send('Gagal memuat detail tugas');
  }
});

/**
 * POST /dosen/elearning/pengumpulan/:id/nilai
 * Memberi nilai pada suatu pengumpulan
 */
router.post('/pengumpulan/:id/nilai', async (req, res) => {
  try {
    const { nilai, komentar } = req.body;
    await db.collection('pengumpulan').doc(req.params.id).update({
      nilai: parseFloat(nilai),
      komentar,
      status: 'dinilai',
      dinilaiPada: new Date().toISOString()
    });
    res.redirect('back');
  } catch (error) {
    console.error('Error memberi nilai:', error);
    res.status(500).send('Gagal memberi nilai');
  }
});

// ============================================================================
// INPUT NILAI MAHASISWA (UTS, UAS, DLL)
// ============================================================================

router.get('/:mkId/nilai', async (req, res) => {
  try {
    const mkId = req.params.mkId;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    if (!mkDoc.data().dosenIds.includes(req.user.id)) {
      return res.status(403).send('Tidak diizinkan');
    }
    const mk = mkDoc.data();

    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .get();
    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().mahasiswaId);
    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const nilaiSnapshot = await db.collection('nilai')
          .where('mahasiswaId', '==', uid)
          .where('mkId', '==', mkId)
          .get();
        const nilaiMap = {};
        nilaiSnapshot.docs.forEach(doc => {
          nilaiMap[doc.data().tipe] = doc.data().nilai;
        });
        mahasiswaList.push({
          id: uid,
          ...userDoc.data(),
          nilai: nilaiMap
        });
      }
    }

    res.render('dosen/elearning_nilai', {
      title: `Input Nilai - ${mk.kode}`,
      mkId,
      mk,
      mahasiswaList
    });
  } catch (error) {
    console.error('Error load nilai:', error);
    res.status(500).send('Gagal memuat halaman nilai');
  }
});

router.post('/nilai/update', async (req, res) => {
  try {
    const { mahasiswaId, mkId, tipe, nilai } = req.body;
    if (!mahasiswaId || !mkId || !tipe || nilai === undefined) {
      return res.status(400).send('Data tidak lengkap');
    }

    const existing = await db.collection('nilai')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('mkId', '==', mkId)
      .where('tipe', '==', tipe)
      .get();

    if (existing.empty) {
      await db.collection('nilai').add({
        mahasiswaId,
        mkId,
        tipe,
        nilai: parseFloat(nilai),
        createdAt: new Date().toISOString()
      });
    } else {
      await existing.docs[0].ref.update({
        nilai: parseFloat(nilai),
        updatedAt: new Date().toISOString()
      });
    }

    res.redirect('back');
  } catch (error) {
    console.error('Error update nilai:', error);
    res.status(500).send('Gagal update nilai');
  }
});

module.exports = router;