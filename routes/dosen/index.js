/**
 * routes/dosen/index.js
 * 
 * File utama untuk semua rute dosen.
 * Menggabungkan semua sub‑modul dosen (dashboard, biodata, elearning, dll.)
 * serta menambahkan middleware autentikasi dan error handling.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { saveNilai } = require('../../helpers/nilaiHelper');

// Import sub‑modul
const laporanMagangRouter = require('./laporanMagang');
const seminarRouter = require('./seminar');
const dashboardRouter = require('./dashboard');
const magangRouter = require('./magang');
const biodataRouter = require('./biodata');

const mkRouter = require('./mk');
const kurikulumRouter = require('./kurikulum');
const nilaiRouter = require('./nilai');
const mahasiswaRouter = require('./mahasiswa');

// ============================================================================
// KONSTANTA FOLDER UTAMA (Data WEB)
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0'; // Ganti dengan ID folder Anda

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
// MIDDLEWARE UMUM UNTUK SEMUA RUTE DOSEN
// ============================================================================

router.use(verifyToken);
router.use(isDosen);

// Middleware untuk menyediakan data user ke semua view dosen
router.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

// ============================================================================
// IMPORT SUB‑MODUL ROUTE DOSEN
// ============================================================================

router.use('/dashboard', dashboardRouter);
router.use('/laporan-magang', laporanMagangRouter);
router.use('/seminar', seminarRouter);
router.use('/magang', magangRouter);
router.use('/biodata', biodataRouter);


router.use('/mk', mkRouter);
router.use('/kurikulum', kurikulumRouter);
router.use('/nilai', nilaiRouter);
router.use('/mahasiswa', mahasiswaRouter);

// ============================================================================
// RUTE UTAMA DOSEN
// ============================================================================

router.get('/', (req, res) => {
  res.redirect('/dosen/dashboard');
});

// ============================================================================
// KELOLA TUGAS (tanpa melalui elearning)
// ============================================================================

// Daftar semua tugas yang dibuat dosen ini
router.get('/tugas', async (req, res) => {
  try {
    const snapshot = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .orderBy('deadline', 'desc')
      .get();

    const tugasList = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        mkKode: data.mkKode || '?',
        mkNama: data.mkNama || '?'
      };
    });

    res.render('dosen/tugas_list', {
      title: 'Daftar Tugas',
      tugasList
    });
  } catch (error) {
    console.error('Error ambil tugas:', error);
    if (error.code === 9) {
      return res.status(500).render('error', {
        title: 'Error',
        message: 'Database memerlukan indeks. Silakan hubungi admin atau buat indeks.'
      });
    }
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal mengambil tugas'
    });
  }
});

// Form buat tugas baru
router.get('/tugas/create', async (req, res) => {
  try {
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .orderBy('kode')
      .get();

    const mkList = mkSnapshot.docs.map(doc => ({
      id: doc.id,
      kode: doc.data().kode,
      nama: doc.data().nama
    }));

    res.render('dosen/tugas_form', {
      title: 'Buat Tugas Baru',
      mkList,
      tugas: null
    });
  } catch (error) {
    console.error('Error load form tugas:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form'
    });
  }
});

// Proses simpan tugas baru (POST) – dengan folder terstruktur
router.post('/tugas', upload.single('file'), async (req, res) => {
  try {
    const { mkId, judul, deskripsi, deadline, tipe } = req.body;
    const file = req.file;

    if (!mkId || !judul || !deadline) {
      return res.status(400).send('MK, judul, dan deadline wajib diisi');
    }

    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    const mkData = mkDoc.data();

    let fileUrl = null, fileId = null;
    if (file) {
      // Dapatkan folder Soal berdasarkan kode MK
      const folderId = await getSoalTugasFolder(mkData.kode);
      const fileName = `${judul.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id'
      });
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
      fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      fileId = response.data.id;
    }

    await db.collection('tugas').add({
      mkId,
      mkKode: mkData.kode,
      mkNama: mkData.nama,
      dosenId: req.dosen.id,
      judul,
      deskripsi: deskripsi || '',
      deadline: new Date(deadline).toISOString(),
      tipe: tipe || 'tugas',
      fileUrl,
      fileId,
      createdAt: new Date().toISOString()
    });

    res.redirect('/dosen/tugas');
  } catch (error) {
    console.error('Error buat tugas:', error);
    res.status(500).send('Gagal membuat tugas');
  }
});

// Detail tugas
router.get('/tugas/:id', async (req, res) => {
  try {
    const tugasDoc = await db.collection('tugas').doc(req.params.id).get();
    if (!tugasDoc.exists) {
      return res.status(404).render('error', { 
        title: 'Tidak Ditemukan', 
        message: 'Tugas tidak ditemukan' 
      });
    }
    
    const tugas = { id: tugasDoc.id, ...tugasDoc.data() };

    // Pastikan tugas ini milik dosen yang login
    if (tugas.dosenId !== req.dosen.id) {
      return res.status(403).render('error', { 
        title: 'Akses Ditolak', 
        message: 'Anda tidak berhak mengakses tugas ini' 
      });
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

    // ✅ AMBIL SEMUA NILAI DARI COLLECTION 'nilai' SEKALIGUS
    const nilaiSnapshot = await db.collection('nilai')
      .where('mkId', '==', tugas.mkId)
      .where('tipe', '==', tugas.judul)
      .get();
    
    // Buat map nilai berdasarkan mahasiswaId
    const nilaiMap = new Map();
    nilaiSnapshot.docs.forEach(doc => {
      const data = doc.data();
      nilaiMap.set(data.mahasiswaId, {
        nilai: data.nilai,
        komentar: data.komentar || '',
        updatedAt: data.updatedAt
      });
    });

    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        
        // Cek pengumpulan (file jawaban)
        const pengumpulanSnapshot = await db.collection('pengumpulan')
          .where('tugasId', '==', tugas.id)
          .where('mahasiswaId', '==', uid)
          .get();
        
        const pengumpulan = pengumpulanSnapshot.empty ? null : { 
          id: pengumpulanSnapshot.docs[0].id, 
          ...pengumpulanSnapshot.docs[0].data() 
        };
        
        // ✅ AMBIL NILAI DARI nilaiMap (bukan dari pengumpulan)
        const nilaiData = nilaiMap.get(uid);
        
        mahasiswaList.push({
          id: uid,
          nim: userData.nim,
          nama: userData.nama,
          pengumpulan: pengumpulan ? {
            ...pengumpulan,
            nilai: nilaiData ? nilaiData.nilai : pengumpulan.nilai, // Prioritaskan dari nilaiMap
            komentar: nilaiData ? nilaiData.komentar : pengumpulan.komentar
          } : null,
          nilai: nilaiData ? nilaiData.nilai : null  // Tambahkan field nilai terpisah
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
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat detail tugas: ' + error.message 
    });
  }
});

// Beri nilai
router.post('/pengumpulan/nilai', async (req, res) => {
  try {
    const { pengumpulanId, nilai, komentar } = req.body;
    
    if (!pengumpulanId || nilai === undefined) {
      return res.status(400).send('Data tidak lengkap');
    }

    // 1. Ambil data pengumpulan
    const pengumpulanDoc = await db.collection('pengumpulan').doc(pengumpulanId).get();
    if (!pengumpulanDoc.exists) {
      return res.status(404).send('Pengumpulan tidak ditemukan');
    }
    
    const pengumpulan = pengumpulanDoc.data();
    const { mahasiswaId, tugasId } = pengumpulan;

    // 2. Ambil data tugas
    const tugasDoc = await db.collection('tugas').doc(tugasId).get();
    if (!tugasDoc.exists) {
      return res.status(404).send('Tugas tidak ditemukan');
    }
    const tugas = tugasDoc.data();

    // 3. UPDATE collection 'pengumpulan'
    await pengumpulanDoc.ref.update({
      nilai: parseFloat(nilai),
      komentar: komentar || '',
      status: 'dinilai',
      dinilaiPada: new Date().toISOString()
    });

    // 4. UPDATE atau CREATE di collection 'nilai'
    const existingNilai = await db.collection('nilai')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('mkId', '==', tugas.mkId)
      .where('tipe', '==', tugas.judul)
      .limit(1)
      .get();

    const nilaiAngka = parseFloat(nilai);
    const now = new Date().toISOString();

    if (existingNilai.empty) {
      // Buat baru di collection nilai
      await db.collection('nilai').add({
        mahasiswaId,
        mkId: tugas.mkId,
        tipe: tugas.judul,
        nilai: nilaiAngka,
        komentar: komentar || '',
        createdAt: now,
        updatedAt: now
      });
    } else {
      // Update existing di collection nilai
      await existingNilai.docs[0].ref.update({
        nilai: nilaiAngka,
        komentar: komentar || '',
        updatedAt: now
      });
    }

    console.log(`✅ Nilai ${nilai} untuk ${mahasiswaId} pada tugas ${tugasId} berhasil disimpan di kedua collection`);

    // Redirect kembali ke halaman detail tugas
    res.redirect(`/dosen/tugas/${tugasId}`);
    
  } catch (error) {
    console.error('Error memberi nilai:', error);
    res.status(500).send('Gagal memberi nilai: ' + error.message);
  }
});

// ============================================================================
// HAPUS TUGAS
// ============================================================================

/**
 * POST /dosen/tugas/:id/delete
 * Menghapus tugas beserta file di Google Drive (jika ada)
 */
router.post('/tugas/:id/delete', async (req, res) => {
  try {
    const tugasId = req.params.id;
    const tugasDoc = await db.collection('tugas').doc(tugasId).get();

    if (!tugasDoc.exists) {
      return res.status(404).send('Tugas tidak ditemukan');
    }

    const tugas = tugasDoc.data();

    // Pastikan dosen yang membuat tugas yang menghapus (atau admin)
    if (tugas.dosenId !== req.dosen.id) {
      return res.status(403).send('Anda tidak berhak menghapus tugas ini');
    }

    // Hapus file di Google Drive jika ada
    if (tugas.fileId) {
      try {
        await drive.files.delete({ fileId: tugas.fileId });
        console.log('File di Drive berhasil dihapus:', tugas.fileId);
      } catch (err) {
        console.error('Gagal menghapus file di Drive:', err.message);
        // Tetap lanjutkan penghapusan dokumen meskipun file gagal dihapus
      }
    }

    // Hapus dokumen tugas dari Firestore
    await db.collection('tugas').doc(tugasId).delete();

    // Redirect ke halaman daftar tugas
    res.redirect('/dosen/tugas');
  } catch (error) {
    console.error('Error hapus tugas:', error);
    res.status(500).send('Gagal menghapus tugas');
  }
});
// ============================================================================
// PENANGANAN ERROR KHUSUS DOSEN
// ============================================================================

router.use((req, res, next) => {
  res.status(404).render('admin/404', { title: 'Halaman Tidak Ditemukan' });
});

router.use((err, req, res, next) => {
  console.error('❌ Dosen error:', err.stack);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500);
  res.render('admin/error', {
    title: 'Terjadi Kesalahan',
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

console.log('Dosen index.js loaded, submodules: dashboard, biodata, elearning, kurikulum, mahasiswa, nilai, mk, laporan-magang, seminar, magang');
module.exports = router;