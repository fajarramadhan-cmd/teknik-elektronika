/**
 * routes/mahasiswa/tracer.js
 * Modul Tracer Study Mahasiswa/Lulusan: Survey keberkerjaan, upload foto tempat kerja
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const sharp = require('sharp');
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// KONSTANTA FOLDER UTAMA (Data WEB)
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

// Semua route memerlukan autentikasi
router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Membuat atau mendapatkan subfolder di dalam folder induk
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
 * Mendapatkan folder foto tracer study untuk mahasiswa tertentu
 * Struktur: Data WEB / Tracer Study / [nim] /
 */
async function getTracerFotoFolder(nim) {
  const parentFolder = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Tracer Study');
  const mahasiswaFolder = await getOrCreateSubFolder(parentFolder, nim);
  return mahasiswaFolder;
}

// ============================================================================
// CEK STATUS SURVEY & TAMPILKAN FORM ATAU HASIL
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const tracerDoc = await db.collection('tracerStudy').doc(userId).get();

    if (tracerDoc.exists) {
      // Sudah mengisi, tampilkan data
      const data = tracerDoc.data();
      res.render('mahasiswa/tracer/hasil', {
        title: 'Hasil Tracer Study',
        user: req.user,
        data
      });
    } else {
      // Belum mengisi, tampilkan form
      res.render('mahasiswa/tracer/form', {
        title: 'Tracer Study',
        user: req.user
      });
    }
  } catch (error) {
    console.error('Error memuat tracer study:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat halaman tracer study' 
    });
  }
});

// ============================================================================
// SIMPAN DATA SURVEY
// ============================================================================

router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      pekerjaan, tempatKerja, alamatKerja, gaji,
      tanggalMulai, statusPekerjaan, bidang, namaPerusahaan
    } = req.body;

    if (!pekerjaan || !tempatKerja || !statusPekerjaan) {
      return res.status(400).send('Pekerjaan, tempat kerja, dan status pekerjaan wajib diisi');
    }

    const data = {
      userId,
      nim: req.user.nim,
      nama: req.user.nama,
      pekerjaan,
      tempatKerja,
      alamatKerja: alamatKerja || '',
      gaji: gaji || '',
      tanggalMulai: tanggalMulai || null,
      statusPekerjaan,
      bidang: bidang || '',
      namaPerusahaan: namaPerusahaan || tempatKerja,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await db.collection('tracerStudy').doc(userId).set(data);
    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error menyimpan tracer study:', error);
    res.status(500).send('Gagal menyimpan data');
  }
});

// ============================================================================
// UPLOAD FOTO TEMPAT KERJA (dengan kompresi)
// ============================================================================

router.post('/foto', upload.single('foto'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).send('Tidak ada file yang diupload');
    }

    const nim = req.user.nim;
    const folderId = await getTracerFotoFolder(nim);

    // Kompres gambar
    const compressedBuffer = await sharp(file.buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const fileName = `Tracer_${nim}_${Date.now()}.jpg`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: 'image/jpeg', body: Readable.from(compressedBuffer) };
    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id'
    });

    // Beri akses publik
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    const directLink = `https://drive.google.com/uc?export=view&id=${response.data.id}`;

    // Simpan ke Firestore (merge agar data lain tidak hilang)
    await db.collection('tracerStudy').doc(req.user.id).set({
      fotoUrl: directLink,
      fotoId: response.data.id,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error upload foto:', error);
    res.status(500).send('Gagal upload foto');
  }
});

// ============================================================================
// HAPUS FOTO
// ============================================================================

router.post('/foto/hapus', async (req, res) => {
  try {
    const userId = req.user.id;
    const tracerDoc = await db.collection('tracerStudy').doc(userId).get();
    if (!tracerDoc.exists) {
      return res.status(404).send('Data tidak ditemukan');
    }

    const data = tracerDoc.data();
    if (data.fotoId) {
      try {
        await drive.files.delete({ fileId: data.fotoId });
      } catch (err) {
        console.error('Gagal hapus file dari Drive:', err);
      }
      await db.collection('tracerStudy').doc(userId).update({
        fotoUrl: null,
        fotoId: null,
        updatedAt: new Date().toISOString()
      });
    }
    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error hapus foto tracer:', error);
    res.status(500).send('Gagal hapus foto');
  }
});

// ============================================================================
// EDIT DATA
// ============================================================================

router.get('/edit', async (req, res) => {
  try {
    const userId = req.user.id;
    const tracerDoc = await db.collection('tracerStudy').doc(userId).get();
    if (!tracerDoc.exists) {
      return res.redirect('/mahasiswa/tracer'); // jika belum ada, ke form awal
    }
    const data = tracerDoc.data();
    res.render('mahasiswa/tracer/form_edit', {
      title: 'Edit Tracer Study',
      user: req.user,
      data
    });
  } catch (error) {
    console.error('Error memuat form edit:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat form edit' 
    });
  }
});

router.post('/edit', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      pekerjaan, tempatKerja, alamatKerja, gaji,
      tanggalMulai, statusPekerjaan, bidang, namaPerusahaan
    } = req.body;

    if (!pekerjaan || !tempatKerja || !statusPekerjaan) {
      return res.status(400).send('Pekerjaan, tempat kerja, dan status pekerjaan wajib diisi');
    }

    const updateData = {
      pekerjaan,
      tempatKerja,
      alamatKerja: alamatKerja || '',
      gaji: gaji || '',
      tanggalMulai: tanggalMulai || null,
      statusPekerjaan,
      bidang: bidang || '',
      namaPerusahaan: namaPerusahaan || tempatKerja,
      updatedAt: new Date().toISOString()
    };

    await db.collection('tracerStudy').doc(userId).update(updateData);
    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error update tracer study:', error);
    res.status(500).send('Gagal mengupdate data');
  }
});

module.exports = router;