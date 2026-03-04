/**
 * routes/mahasiswa/magang.js
 * Modul ELK‑Magang: logbook, permohonan seminar, upload laporan akhir (3 laporan)
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU (HELPER)
// ============================================================================

// --- Untuk logbook ---
async function getMagangImageFolderId() {
  const folderName = 'Magang_Images';
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

async function hasActivePdkEnrollment(userId, courseId, semester) {
  console.log('Validasi enrollment:', { userId, courseId, semester });
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
  console.log('getEnrolledPdkCourses dipanggil untuk userId:', userId);
  const enrollmentSnapshot = await db.collection('enrollment')
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .get();
  console.log('Jumlah enrollment aktif:', enrollmentSnapshot.size);

  const mkIds = enrollmentSnapshot.docs.map(doc => {
    const data = doc.data();
    console.log('Enrollment mkId:', data.mkId, 'semester:', data.semester);
    return data.mkId;
  });

  const courses = [];
  for (const mkId of mkIds) {
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (mkDoc.exists) {
      console.log(`Mata kuliah ${mkId}: kode=${mkDoc.data().kode}, isPDK=${mkDoc.data().isPDK}`);
      if (mkDoc.data().isPDK === true) {
        courses.push({ id: mkId, ...mkDoc.data() });
      }
    } else {
      console.log(`MK dengan ID ${mkId} tidak ditemukan`);
    }
  }
  console.log('Jumlah PDK ditemukan:', courses.length);
  return courses;
}

// --- Untuk laporan magang (3 laporan) ---
async function getLaporanFolderId() {
  const folderName = 'Laporan_Magang';
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

async function getMahasiswaLaporanFolder(nim, userId) {
  const parentId = await getLaporanFolderId();
  const folderName = `${nim}_${userId.substring(0, 6)}`;
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    return folder.data.id;
  }
}

function getAngkatanFromNim(nim) {
  if (!nim || nim.length < 2) return new Date().getFullYear().toString();
  if (nim.length >= 4 && !isNaN(parseInt(nim.substring(0,4)))) {
    return nim.substring(0,4);
  }
  return '20' + nim.substring(0,2);
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

    res.render('mahasiswa/magang/logbook', {
      title: 'Logbook Magang',
      user: req.user,
      logbook,
      pdkCourses
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
 * Menyimpan logbook baru dengan upload gambar (maks 5)
 */
router.post('/logbook', upload.array('images', 5), async (req, res) => {
  try {
    const { tanggal, kegiatan, lokasi, durasi, courseId, semester } = req.body;
    const files = req.files || [];

    console.log('POST logbook - Data:', { tanggal, kegiatan, courseId, semester });
    console.log('Jumlah file:', files.length);

    if (!tanggal || !kegiatan || !courseId || !semester) {
      return res.status(400).send('Tanggal, kegiatan, mata kuliah, dan semester wajib diisi.');
    }

    const isValid = await hasActivePdkEnrollment(req.user.id, courseId, semester);
    if (!isValid) {
      return res.status(403).send('Anda tidak terdaftar di mata kuliah PDK untuk semester ini.');
    }

    let imageUrls = [];
    if (files.length > 0) {
      const folderId = await getMagangImageFolderId();
      for (const file of files) {
        const fileName = `${req.user.nim}_${Date.now()}_${file.originalname}`;
        const fileMetadata = { name: fileName, parents: [folderId] };
        const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
        const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id, webViewLink' });
        await drive.permissions.create({ fileId: response.data.id, requestBody: { role: 'reader', type: 'anyone' } });
        const directLink = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
        imageUrls.push(directLink);
      }
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
    if (data.imageUrls && data.imageUrls.length > 0) {
      for (const url of data.imageUrls) {
        const match = url.match(/id=([^&]+)/);
        if (match) {
          try {
            await drive.files.delete({ fileId: match[1] });
          } catch (err) {
            console.error('Gagal hapus gambar:', err.message);
          }
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
  console.log('✅ RUTE CETAK DIPANGGIL!');
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
// LAPORAN MAGANG (3 laporan)
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
    const nama = (req.user.nama || 'mahasiswa').replace(/\s+/g, '_');
    const angkatan = getAngkatanFromNim(nim);
    const timestamp = Date.now();
    const fileName = `${nama}_${nim}_laporan_${laporanKe}_${timestamp}.pdf`;

    const folderId = await getMahasiswaLaporanFolder(nim, userId);
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink'
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
      uploadedAt: new Date().toISOString(),
      status: 'submitted' // submitted, approved, rejected
    });

    res.redirect('/mahasiswa/magang/laporan');
  } catch (error) {
    console.error('Error upload laporan:', error);
    res.status(500).send('Gagal upload laporan');
  }
});

/**
 * POST /mahasiswa/magang/laporan/hapus
 * Hapus laporan (hanya jika status submitted)
 */
router.post('/laporan/hapus', async (req, res) => {
  try {
    const userId = req.user.id;
    const laporanRef = db.collection('laporanMagang').doc(userId);
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

/**
 * GET /mahasiswa/magang/seminar
 * Daftar permohonan seminar milik mahasiswa
 */
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

/**
 * GET /mahasiswa/magang/seminar/baru
 * Form pengajuan seminar baru
 */
router.get('/seminar/baru', (req, res) => {
  res.render('mahasiswa/magang/seminar_form', {
    title: 'Ajukan Seminar Magang',
    user: req.user,
    seminar: null
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

/**
 * POST /mahasiswa/magang/seminar/:id/batal
 * Batalkan pengajuan (hanya jika status pending)
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