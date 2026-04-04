/**
 * routes/mahasiswa/magang.js
 * Modul ELK‑Magang: logbook, permohonan seminar, upload laporan akhir (3 laporan)
 * Terintegrasi dengan folder Data WEB (ID: 17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0)
 * Dilengkapi kompresi gambar (sharp) dan penyimpanan fileId.
 * 
 * REVISI: 
 * - Pembimbing ditetapkan oleh admin (2 pembimbing: Pembimbing 1 dan Pembimbing 2)
 * - Mahasiswa tidak bisa memilih pembimbing sendiri
 * - Logbook & laporan menyimpan kedua pembimbing
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
// FUNGSI BANTU PEMBIMBING (DUA DOSEN - DARI ADMIN)
// ============================================================================

/**
 * Mendapatkan data pembimbing mahasiswa (Pembimbing 1 dan 2) yang ditetapkan admin
 * @param {string} mahasiswaId - UID mahasiswa
 * @returns {Promise<Object|null>} data pembimbing atau null jika belum ada
 */
async function getPembimbingMahasiswa(mahasiswaId) {
  try {
    const snapshot = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    
    const bimbingan = snapshot.docs[0].data();
    
    // Ambil data dosen untuk pembimbing 1
    let pembimbing1 = null;
    if (bimbingan.pembimbing1Id) {
      const dosenDoc = await db.collection('dosen').doc(bimbingan.pembimbing1Id).get();
      pembimbing1 = {
        id: bimbingan.pembimbing1Id,
        nama: dosenDoc.exists ? dosenDoc.data().nama : bimbingan.pembimbing1Nama || '-',
        nidn: dosenDoc.exists ? dosenDoc.data().nidn : '-'
      };
    }
    
    // Ambil data dosen untuk pembimbing 2 (opsional)
    let pembimbing2 = null;
    if (bimbingan.pembimbing2Id) {
      const dosenDoc = await db.collection('dosen').doc(bimbingan.pembimbing2Id).get();
      pembimbing2 = {
        id: bimbingan.pembimbing2Id,
        nama: dosenDoc.exists ? dosenDoc.data().nama : bimbingan.pembimbing2Nama || '-',
        nidn: dosenDoc.exists ? dosenDoc.data().nidn : '-'
      };
    }
    
    return {
      pembimbing1,
      pembimbing2,
      bimbinganId: snapshot.docs[0].id,
      semester: bimbingan.semester,
      tahunAjaran: bimbingan.tahunAjaran
    };
  } catch (error) {
    console.error('Error getPembimbingMahasiswa:', error);
    return null;
  }
}

/**
 * Format teks pembimbing untuk ditampilkan
 * @param {Object} pembimbing - Data dari getPembimbingMahasiswa
 * @returns {string} Teks pembimbing
 */
function formatPembimbingText(pembimbing) {
  if (!pembimbing) return 'Belum ditetapkan';
  
  const parts = [];
  if (pembimbing.pembimbing1) {
    parts.push(`Pembimbing 1: ${pembimbing.pembimbing1.nama}`);
  }
  if (pembimbing.pembimbing2) {
    parts.push(`Pembimbing 2: ${pembimbing.pembimbing2.nama}`);
  }
  
  return parts.length > 0 ? parts.join(' | ') : 'Belum ditetapkan';
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

router.get('/', async (req, res) => {
  try {
    // Ambil data pembimbing mahasiswa yang sedang login
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    
    res.render('mahasiswa/magang/index', {
      title: 'ELK-Magang',
      user: req.user,
      pembimbing: pembimbing   // <- kirim ke view
    });
  } catch (error) {
    console.error('Gagal memuat halaman magang:', error);
    // Jika error, tetap render tanpa data pembimbing
    res.render('mahasiswa/magang/index', {
      title: 'ELK-Magang',
      user: req.user,
      pembimbing: null
    });
  }
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
    // Ambil pembimbing yang sudah ditetapkan admin
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    
    // Ambil daftar logbook
    const snapshot = await db.collection('logbookMagang')
      .where('userId', '==', req.user.id)
      .orderBy('tanggal', 'desc')
      .get();
    
    const logbook = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        pembimbing1Nama: data.pembimbing1Nama || (pembimbing?.pembimbing1?.nama || '-'),
        pembimbing2Nama: data.pembimbing2Nama || (pembimbing?.pembimbing2?.nama || '-')
      };
    });

    const pdkCourses = await getEnrolledPdkCourses(req.user.id);
    const currentSemester = getCurrentAcademicSemester().label;

    res.render('mahasiswa/magang/logbook', {
      title: 'Logbook Magang',
      user: req.user,
      logbook,
      pdkCourses,
      currentSemester,
      pembimbing  // ← kirim data pembimbing ke view
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
 * Pembimbing diambil dari data yang ditetapkan admin (tidak bisa dipilih sendiri)
 */
router.post('/logbook', upload.array('images', 5), async (req, res) => {
  try {
    const { tanggal, kegiatan, lokasi, durasi, courseId, semester } = req.body;
    const files = req.files || [];

    if (!tanggal || !kegiatan || !courseId || !semester) {
      return res.status(400).send('Tanggal, kegiatan, mata kuliah, dan semester wajib diisi.');
    }

    // Validasi PDK
    const isValid = await hasActivePdkEnrollment(req.user.id, courseId, semester);
    if (!isValid) {
      return res.status(403).send('Anda tidak terdaftar di mata kuliah PDK untuk semester ini.');
    }

    // ✅ Ambil pembimbing yang sudah ditetapkan admin
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    if (!pembimbing || !pembimbing.pembimbing1) {
      return res.status(400).send('Anda belum memiliki dosen pembimbing 1. Silakan hubungi admin.');
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

    // ✅ Simpan logbook dengan kedua pembimbing dari admin
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
      createdAt: new Date().toISOString(),
      // Pembimbing 1 (wajib)
      pembimbing1Id: pembimbing.pembimbing1.id,
      pembimbing1Nama: pembimbing.pembimbing1.nama,
      // Pembimbing 2 (opsional)
      pembimbing2Id: pembimbing.pembimbing2 ? pembimbing.pembimbing2.id : null,
      pembimbing2Nama: pembimbing.pembimbing2 ? pembimbing.pembimbing2.nama : null
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
 * Pembimbing tetap menggunakan data dari admin (tidak bisa diubah)
 */
router.post('/logbook/:id', async (req, res) => {
  try {
    const { tanggal, kegiatan, lokasi, durasi, courseId, semester } = req.body;
    const docRef = db.collection('logbookMagang').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Logbook tidak ditemukan');
    if (doc.data().userId !== req.user.id) return res.status(403).send('Akses ditolak');

    // Ambil pembimbing terbaru dari admin (jika berubah)
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    
    const updateData = {
      tanggal,
      kegiatan,
      lokasi: lokasi || '',
      durasi: durasi || '',
      courseId,
      semester,
      updatedAt: new Date().toISOString()
    };
    
    // Update pembimbing jika ada perubahan
    if (pembimbing) {
      updateData.pembimbing1Id = pembimbing.pembimbing1?.id || null;
      updateData.pembimbing1Nama = pembimbing.pembimbing1?.nama || null;
      updateData.pembimbing2Id = pembimbing.pembimbing2?.id || null;
      updateData.pembimbing2Nama = pembimbing.pembimbing2?.nama || null;
    }

    await docRef.update(updateData);
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
    
    // ✅ Ambil data pembimbing mahasiswa
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    
    const totalDurasi = logbook.reduce((sum, item) => sum + (parseFloat(item.durasi) || 0), 0);

    res.render('mahasiswa/magang/print', {
      title: 'Cetak Logbook',
      mahasiswa,
      logbook,
      totalDurasi,
      totalEntries: logbook.length,
      generatedAt: new Date().toLocaleString('id-ID'),
      pembimbing  // <- kirim ke view
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
    const pembimbing = await getPembimbingMahasiswa(userId);
    
    const laporanList = [];
    for (let i = 1; i <= 3; i++) {
      const docId = `${userId}_${i}`;
      const doc = await db.collection('laporanMagang').doc(docId).get();
      
      let data = null;
      if (doc.exists) {
        data = doc.data();
        // Tambahkan nama pembimbing dari data bimbingan jika belum ada
        if (pembimbing) {
          data.pembimbing1Nama = data.pembimbing1Nama || pembimbing.pembimbing1?.nama;
          data.pembimbing2Nama = data.pembimbing2Nama || pembimbing.pembimbing2?.nama;
        }
      }
      
      laporanList.push({
        ke: i,
        exists: doc.exists,
        data
      });
    }
    
    res.render('mahasiswa/magang/laporan', {
      title: 'Laporan Magang',
      user: req.user,
      laporanList,
      pembimbing  // ← kirim data pembimbing ke view
    });
  } catch (error) {
    console.error('Error muat halaman laporan:', error);
    res.status(500).send('Gagal memuat halaman');
  }
});

/**
 * POST /mahasiswa/magang/laporan/upload
 * Upload file laporan magang ke Google Drive (untuk laporan tertentu)
 * Pembimbing diambil dari data yang ditetapkan admin
 */
router.post('/laporan/upload', upload.single('file'), async (req, res) => {
  try {
    const { laporanKe } = req.body;
    const file = req.file;
    
    if (!laporanKe || !file) {
      return res.status(400).send('Laporan ke dan file wajib diisi');
    }

    // Validasi file type (hanya PDF)
    if (file.mimetype !== 'application/pdf') {
      return res.status(400).send('Laporan magang harus dalam format PDF');
    }

    // ✅ Ambil pembimbing yang sudah ditetapkan admin
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    if (!pembimbing || !pembimbing.pembimbing1) {
      return res.status(400).send('Anda belum memiliki dosen pembimbing 1. Silakan hubungi admin.');
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

    // ✅ Simpan laporan dengan kedua pembimbing
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
      status: 'submitted',
      komentar: [],
      // Pembimbing 1 (wajib)
      pembimbing1Id: pembimbing.pembimbing1.id,
      pembimbing1Nama: pembimbing.pembimbing1.nama,
      // Pembimbing 2 (opsional)
      pembimbing2Id: pembimbing.pembimbing2 ? pembimbing.pembimbing2.id : null,
      pembimbing2Nama: pembimbing.pembimbing2 ? pembimbing.pembimbing2.nama : null
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
// HALAMAN UTAMA MAGANG (menu pilihan)
// ============================================================================

router.get('/', async (req, res) => {
  try {
    // Ambil data pembimbing mahasiswa yang sedang login
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    
    res.render('mahasiswa/magang/index', {
      title: 'ELK-Magang',
      user: req.user,
      pembimbing: pembimbing   // <- kirim ke view
    });
  } catch (error) {
    console.error('Gagal memuat halaman magang:', error);
    // Tetap render tanpa data pembimbing
    res.render('mahasiswa/magang/index', {
      title: 'ELK-Magang',
      user: req.user,
      pembimbing: null
    });
  }
});
// ============================================================================
// PERMOHONAN SEMINAR MAGANG
// ============================================================================

/**
 * GET /mahasiswa/magang/seminar
 * Daftar permohonan seminar
 */
router.get('/seminar', async (req, res) => {
  try {
    const snapshot = await db.collection('permohonanMagang')
      .where('userId', '==', req.user.id)
      .orderBy('createdAt', 'desc')
      .get();
    const permohonan = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    
    res.render('mahasiswa/magang/seminar_list', {
      title: 'Permohonan Seminar Magang',
      user: req.user,
      permohonan,
      pembimbing
    });
  } catch (error) {
    console.error('Error mengambil permohonan:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat permohonan' });
  }
});

/**
 * GET /mahasiswa/magang/seminar/baru
 * Form ajukan seminar
 */
router.get('/seminar/baru', async (req, res) => {
  const pembimbing = await getPembimbingMahasiswa(req.user.id);
  res.render('mahasiswa/magang/seminar_form', {
    title: 'Ajukan Seminar Magang',
    user: req.user,
    seminar: null,
    pembimbing
  });
});

/**
 * POST /mahasiswa/magang/seminar
 * Simpan permohonan seminar baru
 */
router.post('/seminar', async (req, res) => {
  try {
    const { judul, tanggal, waktu, tempat, pembimbing1, pembimbing2, penguji } = req.body;
    if (!judul || !tanggal || !waktu || !tempat) {
      return res.status(400).send('Judul, tanggal, waktu, dan tempat wajib diisi');
    }

    // Ambil pembimbing dari admin sebagai default
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    const defaultPembimbing1 = pembimbing?.pembimbing1?.nama || '';
    const defaultPembimbing2 = pembimbing?.pembimbing2?.nama || pembimbing2 || '';

    await db.collection('permohonanMagang').add({
      userId: req.user.id,
      nim: req.user.nim,
      nama: req.user.nama,
      judul,
      tanggal: new Date(tanggal).toISOString(),
      waktu,
      tempat,
      pembimbing1: pembimbing1 || defaultPembimbing1,
      pembimbing2: defaultPembimbing2,
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

/**
 * GET /mahasiswa/magang/seminar/:id
 * Detail permohonan seminar
 */
router.get('/seminar/:id', async (req, res) => {
  try {
    const doc = await db.collection('permohonanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Data tidak ditemukan');
    const seminar = { id: doc.id, ...doc.data() };
    if (seminar.userId !== req.user.id) return res.status(403).send('Akses ditolak');
    
    const pembimbing = await getPembimbingMahasiswa(req.user.id);
    res.render('mahasiswa/magang/seminar_detail', {
      title: 'Detail Seminar',
      user: req.user,
      seminar,
      pembimbing
    });
  } catch (error) {
    console.error('Error detail seminar:', error);
    res.status(500).send('Gagal memuat detail');
  }
});

/**
 * POST /mahasiswa/magang/seminar/:id/batal
 * Batalkan permohonan seminar
 */
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