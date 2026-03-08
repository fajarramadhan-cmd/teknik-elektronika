/**
 * routes/mahasiswa/magang.js
 * Modul ELK‑Magang: logbook, permohonan seminar, upload laporan akhir (3 laporan)
 * Terintegrasi dengan folder Data WEB (ID: 17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0)
 * Dilengkapi kompresi gambar (sharp) dan penyimpanan fileId.
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const sharp = require('sharp');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');

const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// KONSTANTA FOLDER UTAMA (Data WEB)
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU UMUM
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
 * Mendapatkan angkatan dari NIM (2 digit pertama -> 20xx)
 */
function getAngkatanFromNim(nim) {
  if (!nim || nim.length < 2) return new Date().getFullYear().toString();
  if (nim.length >= 4 && !isNaN(parseInt(nim.substring(0,4)))) {
    return nim.substring(0,4);
  }
  return '20' + nim.substring(0,2);
}

/**
 * Mendapatkan tahun ajaran dari label semester (misal "Genap 2025/2026" -> "2025/2026")
 */
function extractTahunAjaran(semesterLabel) {
  const match = semesterLabel.match(/\d{4}\/\d{4}/);
  return match ? match[0] : new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
}

// ============================================================================
// FUNGSI BANTU KHUSUS LOGBOOK
// ============================================================================

/**
 * Folder untuk dokumentasi logbook per mahasiswa:
 * Data WEB / Dokumentasi Magang Mahasiswa / [tahunAjaran] / [angkatan] / [nim_nama] /
 */
async function getDokumentasiMagangFolder(nim, nama, semesterLabel) {
  const tahunAjaran = extractTahunAjaran(semesterLabel);
  const angkatan = getAngkatanFromNim(nim);
  const sanitizedNama = nama.replace(/[^a-zA-Z0-9]/g, '_');
  const folderMahasiswa = `${nim}_${sanitizedNama}`;

  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Dokumentasi Magang Mahasiswa');
  const tahunFolder = await getOrCreateSubFolder(parent, tahunAjaran);
  const angkatanFolder = await getOrCreateSubFolder(tahunFolder, angkatan);
  const mahasiswaFolder = await getOrCreateSubFolder(angkatanFolder, folderMahasiswa);
  return mahasiswaFolder;
}

// ============================================================================
// FUNGSI BANTU KHUSUS LAPORAN MAGANG
// ============================================================================

/**
 * Folder untuk laporan magang per mahasiswa:
 * Data WEB / Laporan Magang / [tahunAjaran] / [angkatan] / [nim_nama] /
 */
async function getLaporanMagangFolder(nim, nama, semesterLabel) {
  const tahunAjaran = extractTahunAjaran(semesterLabel);
  const angkatan = getAngkatanFromNim(nim);
  const sanitizedNama = nama.replace(/[^a-zA-Z0-9]/g, '_');
  const folderMahasiswa = `${nim}_${sanitizedNama}`;

  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Laporan Magang');
  const tahunFolder = await getOrCreateSubFolder(parent, tahunAjaran);
  const angkatanFolder = await getOrCreateSubFolder(tahunFolder, angkatan);
  const mahasiswaFolder = await getOrCreateSubFolder(angkatanFolder, folderMahasiswa);
  return mahasiswaFolder;
}

// ============================================================================
// FUNGSI BANTU VALIDASI PDK
// ============================================================================

async function hasActivePdkEnrollment(userId, courseId, semester) {
  const enrollmentSnapshot = await db.collection('enrollment')
    .where('userId', '==', userId)
    .where('mkId', '==', courseId)
    .where('semester', '==', semester)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  return !enrollmentSnapshot.empty;
}

async function getEnrolledPdkCourses(userId) {
  const enrollmentSnapshot = await db.collection('enrollment')
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .get();

  const mkIds = enrollmentSnapshot.docs.map(doc => doc.data().mkId);
  const courses = [];
  for (const mkId of mkIds) {
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (mkDoc.exists && mkDoc.data().isPDK === true) {
      courses.push({ id: mkId, ...mkDoc.data() });
    }
  }
  return courses;
}

// ============================================================================
// HALAMAN UTAMA MAGANG (menu pilihan)
// ============================================================================
router.get('/', (req, res) => {
  res.render('mahasiswa/magang/index', {
    title: 'ELK-Magang',
    user: req.user
  });
});

// ============================================================================
// LOGBOOK
// ============================================================================

/**
 * GET /mahasiswa/magang/logbook
 * Menampilkan daftar logbook milik mahasiswa
 */
router.get('/logbook', async (req, res) => {
  try {
    const snapshot = await db.collection('logbookMagang')
      .where('userId', '==', req.user.id)
      .orderBy('tanggal', 'desc')
      .get();
    const logbook = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const pdkCourses = await getEnrolledPdkCourses(req.user.id);
    const currentSemester = getCurrentAcademicSemester().label;

    res.render('mahasiswa/magang/logbook', {
      title: 'Logbook Magang',
      user: req.user,
      logbook,
      pdkCourses,
      currentSemester
    });
  } catch (error) {
    console.error('❌ Error mengambil logbook:', error);
    if (error.code === 9 || error.message.includes('index')) {
      return res.status(500).send('Database memerlukan indeks. Silakan hubungi admin.');
    }
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat logbook' });
  }
});

/**
 * POST /mahasiswa/magang/logbook
 * Menyimpan logbook baru dengan upload gambar (maks 5) + kompresi
 */
router.post('/logbook', upload.array('images', 5), async (req, res) => {
  try {
    const { tanggal, kegiatan, lokasi, durasi, courseId, semester } = req.body;
    const files = req.files || [];

    if (!tanggal || !kegiatan || !courseId || !semester) {
      return res.status(400).send('Tanggal, kegiatan, mata kuliah, dan semester wajib diisi.');
    }

    const isValid = await hasActivePdkEnrollment(req.user.id, courseId, semester);
    if (!isValid) {
      return res.status(403).send('Anda tidak terdaftar di mata kuliah PDK untuk semester ini.');
    }

    const nim = req.user.nim;
    const nama = req.user.nama;
    const folderId = await getDokumentasiMagangFolder(nim, nama, semester);

    const imageUrls = [];
    const imageFileIds = [];

    for (const file of files) {
      // Kompres gambar
      const compressedBuffer = await sharp(file.buffer)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const fileName = `${nim}_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: 'image/jpeg', body: Readable.from(compressedBuffer) };
      const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });

      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      const directLink = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      imageUrls.push(directLink);
      imageFileIds.push(response.data.id);
    }

    await db.collection('logbookMagang').add({
      userId: req.user.id,
      tanggal,
      kegiatan,
      lokasi: lokasi || '',
      durasi: durasi || '',
      courseId,
      semester,
      imageUrls,
      imageFileIds,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    res.redirect('/mahasiswa/magang/logbook');
  } catch (error) {
    console.error('Error tambah logbook:', error);
    res.status(500).send('Gagal menambah logbook: ' + error.message);
  }
});

/**
 * GET /mahasiswa/magang/logbook/:id
 * Mengambil data logbook untuk diedit (response JSON)
 */
router.get('/logbook/:id', async (req, res) => {
  try {
    const doc = await db.collection('logbookMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Logbook tidak ditemukan' });
    if (doc.data().userId !== req.user.id) return res.status(403).json({ error: 'Akses ditolak' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

/**
 * POST /mahasiswa/magang/logbook/:id
 * Update logbook (hanya teks, gambar tidak bisa diupdate melalui sini)
 */
router.post('/logbook/:id', async (req, res) => {
  try {
    const { tanggal, kegiatan, lokasi, durasi, courseId, semester } = req.body;
    const docRef = db.collection('logbookMagang').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Logbook tidak ditemukan');
    if (doc.data().userId !== req.user.id) return res.status(403).send('Akses ditolak');

    await docRef.update({
      tanggal,
      kegiatan,
      lokasi: lokasi || '',
      durasi: durasi || '',
      courseId,
      semester,
      updatedAt: new Date().toISOString()
    });
    res.redirect('/mahasiswa/magang/logbook');
  } catch (error) {
    console.error('Error update logbook:', error);
    res.status(500).send('Gagal update logbook');
  }
});

/**
 * POST /mahasiswa/magang/logbook/:id/delete
 * Hapus logbook beserta gambar di Drive
 */
router.post('/logbook/:id/delete', async (req, res) => {
  try {
    const docRef = db.collection('logbookMagang').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Logbook tidak ditemukan');
    if (doc.data().userId !== req.user.id) return res.status(403).send('Akses ditolak');

    const data = doc.data();
    if (data.imageFileIds && data.imageFileIds.length > 0) {
      for (const fileId of data.imageFileIds) {
        try {
          await drive.files.delete({ fileId });
        } catch (err) {
          console.error('Gagal hapus gambar:', err.message);
        }
      }
    }
    await docRef.delete();
    res.redirect('/mahasiswa/magang/logbook');
  } catch (error) {
    console.error('Error hapus logbook:', error);
    res.status(500).send('Gagal hapus logbook');
  }
});

/**
 * GET /mahasiswa/magang/logbook-print
 * Cetak logbook (PDF)
 */
router.get('/logbook-print', async (req, res) => {
  try {
    const snapshot = await db.collection('logbookMagang')
      .where('userId', '==', req.user.id)
      .orderBy('tanggal', 'asc')
      .get();

    const logbook = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const mahasiswaDoc = await db.collection('users').doc(req.user.id).get();
    const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: req.user.nama, nim: req.user.nim };

    const totalDurasi = logbook.reduce((sum, item) => sum + (parseFloat(item.durasi) || 0), 0);

    res.render('mahasiswa/magang/print', {
      title: 'Cetak Logbook',
      mahasiswa,
      logbook,
      totalDurasi,
      totalEntries: logbook.length,
      generatedAt: new Date().toLocaleString('id-ID')
    });
  } catch (error) {
    console.error('❌ Error print logbook:', error);
    res.status(500).send('Gagal mencetak logbook');
  }
});

// ============================================================================
// LAPORAN MAGANG (3 laporan per mahasiswa)
// ============================================================================

/**
 * GET /mahasiswa/magang/laporan
 * Menampilkan halaman laporan magang (Laporan 1,2,3)
 */
router.get('/laporan', async (req, res) => {
  try {
    const userId = req.user.id;
    const laporanList = [];
    for (let i = 1; i <= 3; i++) {
      const docId = `${userId}_${i}`;
      const doc = await db.collection('laporanMagang').doc(docId).get();
      laporanList.push({
        ke: i,
        exists: doc.exists,
        data: doc.exists ? doc.data() : null
      });
    }
    res.render('mahasiswa/magang/laporan', {
      title: 'Laporan Magang',
      user: req.user,
      laporanList
    });
  } catch (error) {
    console.error('Error muat halaman laporan:', error);
    res.status(500).send('Gagal memuat halaman');
  }
});

/**
 * POST /mahasiswa/magang/laporan/upload
 * Upload file laporan magang ke Google Drive (untuk laporan tertentu)
 */
router.post('/laporan/upload', upload.single('file'), async (req, res) => {
  try {
    const { laporanKe } = req.body; // 1,2,3
    const file = req.file;
    if (!laporanKe || !file) {
      return res.status(400).send('Laporan ke dan file wajib diisi');
    }

    const userId = req.user.id;
    const nim = req.user.nim;
    const nama = req.user.nama;
    const currentSemester = getCurrentAcademicSemester().label;

    // Dapatkan folder laporan mahasiswa
    const folderId = await getLaporanMagangFolder(nim, nama, currentSemester);

    const fileName = `Laporan_${laporanKe}_${Date.now()}.pdf`;
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

    const fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
    const docId = `${userId}_${laporanKe}`;

    await db.collection('laporanMagang').doc(docId).set({
      userId,
      nim,
      nama: req.user.nama,
      laporanKe: parseInt(laporanKe),
      fileUrl,
      fileId: response.data.id,
      fileName,
      semester: currentSemester,
      uploadedAt: new Date().toISOString(),
      status: 'submitted'
    });

    res.redirect('/mahasiswa/magang/laporan');
  } catch (error) {
    console.error('Error upload laporan:', error);
    res.status(500).send('Gagal upload laporan: ' + error.message);
  }
});

/**
 * POST /mahasiswa/magang/laporan/hapus/:laporanKe
 * Hapus laporan berdasarkan nomor laporan (1,2,3)
 */
router.post('/laporan/hapus/:laporanKe', async (req, res) => {
  try {
    const laporanKe = parseInt(req.params.laporanKe);
    if (isNaN(laporanKe) || laporanKe < 1 || laporanKe > 3) {
      return res.status(400).send('Nomor laporan tidak valid');
    }

    const userId = req.user.id;
    const docId = `${userId}_${laporanKe}`;
    const laporanRef = db.collection('laporanMagang').doc(docId);
    const doc = await laporanRef.get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const data = doc.data();

    if (data.status !== 'submitted') {
      return res.status(400).send('Hanya laporan dengan status submitted yang dapat dihapus');
    }

    if (data.fileId) {
      try {
        await drive.files.delete({ fileId: data.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err);
      }
    }

    await laporanRef.delete();
    res.redirect('/mahasiswa/magang/laporan');
  } catch (error) {
    console.error('Error hapus laporan:', error);
    res.status(500).send('Gagal hapus laporan');
  }
});

// ============================================================================
// PERMOHONAN SEMINAR MAGANG
// ============================================================================

router.get('/seminar', async (req, res) => {
  try {
    const snapshot = await db.collection('permohonanMagang')
      .where('userId', '==', req.user.id)
      .orderBy('createdAt', 'desc')
      .get();
    const permohonan = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('mahasiswa/magang/seminar_list', {
      title: 'Permohonan Seminar Magang',
      user: req.user,
      permohonan
    });
  } catch (error) {
    console.error('Error mengambil permohonan:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat permohonan' });
  }
});

router.get('/seminar/baru', (req, res) => {
  res.render('mahasiswa/magang/seminar_form', {
    title: 'Ajukan Seminar Magang',
    user: req.user,
    seminar: null
  });
});

router.post('/seminar', async (req, res) => {
  try {
    const { judul, tanggal, waktu, tempat, pembimbing1, pembimbing2, penguji } = req.body;
    if (!judul || !tanggal || !waktu || !tempat) {
      return res.status(400).send('Judul, tanggal, waktu, dan tempat wajib diisi');
    }

    await db.collection('permohonanMagang').add({
      userId: req.user.id,
      nim: req.user.nim,
      nama: req.user.nama,
      judul,
      tanggal: new Date(tanggal).toISOString(),
      waktu,
      tempat,
      pembimbing1: pembimbing1 || '',
      pembimbing2: pembimbing2 || '',
      penguji: penguji || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{
        status: 'pending',
        timestamp: new Date().toISOString(),
        catatan: 'Pengajuan seminar diterima'
      }]
    });

    res.redirect('/mahasiswa/magang/seminar');
  } catch (error) {
    console.error('Error simpan seminar:', error);
    res.status(500).send('Gagal menyimpan pengajuan');
  }
});

router.get('/seminar/:id', async (req, res) => {
  try {
    const doc = await db.collection('permohonanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Data tidak ditemukan');
    const seminar = { id: doc.id, ...doc.data() };
    if (seminar.userId !== req.user.id) return res.status(403).send('Akses ditolak');
    res.render('mahasiswa/magang/seminar_detail', {
      title: 'Detail Seminar',
      user: req.user,
      seminar
    });
  } catch (error) {
    console.error('Error detail seminar:', error);
    res.status(500).send('Gagal memuat detail');
  }
});

router.post('/seminar/:id/batal', async (req, res) => {
  try {
    const docRef = db.collection('permohonanMagang').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Data tidak ditemukan');
    const data = doc.data();
    if (data.userId !== req.user.id) return res.status(403).send('Akses ditolak');
    if (data.status !== 'pending') {
      return res.status(400).send('Hanya pengajuan pending yang dapat dibatalkan');
    }

    await docRef.update({
      status: 'dibatalkan',
      updatedAt: new Date().toISOString(),
      history: [
        ...(data.history || []),
        { status: 'dibatalkan', timestamp: new Date().toISOString(), catatan: 'Dibatalkan mahasiswa' }
      ]
    });
    res.redirect('/mahasiswa/magang/seminar');
  } catch (error) {
    console.error('Error batal seminar:', error);
    res.status(500).send('Gagal membatalkan');
  }
});

module.exports = router;