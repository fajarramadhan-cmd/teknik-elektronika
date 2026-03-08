/**
 * routes/admin/tracklulusan.js
 * Track Lulusan - Kelola data lulusan dan survey tracer study
 * Terintegrasi dengan Data WEB, kompresi gambar, dan fileId
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const sharp = require('sharp'); // untuk kompresi gambar
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// KONSTANTA FOLDER UTAMA (Data WEB)
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

router.use(verifyToken);
router.use(isAdmin);

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
 * Mendapatkan folder foto lulusan dengan struktur:
 * Data WEB / Lulusan / Foto / [tahunLulus] / [nim] /
 * @param {number} tahunLulus - Tahun lulus
 * @param {string} nim - NIM lulusan
 * @returns {Promise<string>} ID folder
 */
async function getLulusanFotoFolder(tahunLulus, nim) {
  const parentLulusan = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Lulusan');
  const parentFoto = await getOrCreateSubFolder(parentLulusan, 'Foto');
  const tahunFolder = await getOrCreateSubFolder(parentFoto, tahunLulus.toString());
  const nimFolder = await getOrCreateSubFolder(tahunFolder, nim);
  return nimFolder;
}

// ============================================================================
// DAFTAR LULUSAN
// ============================================================================

/**
 * GET /admin/tracklulusan
 * Menampilkan daftar lulusan dengan filter (opsional)
 */
router.get('/', async (req, res) => {
  try {
    const { tahun, status } = req.query;
    let query = db.collection('lulusan').orderBy('tahunLulus', 'desc').orderBy('nama');

    if (tahun) {
      query = query.where('tahunLulus', '==', parseInt(tahun));
    }
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();
    const lulusan = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Ambil daftar tahun unik untuk filter
    const semua = await db.collection('lulusan').get();
    const tahunSet = new Set();
    semua.docs.forEach(doc => tahunSet.add(doc.data().tahunLulus));
    const tahunList = Array.from(tahunSet).sort().reverse();

    res.render('admin/tracklulusan_list', {
      title: 'Track Lulusan',
      lulusan,
      tahunList,
      filterTahun: tahun || '',
      filterStatus: status || ''
    });
  } catch (error) {
    console.error('Error mengambil data lulusan:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data lulusan' });
  }
});

// ============================================================================
// TAMBAH LULUSAN
// ============================================================================

/**
 * GET /admin/tracklulusan/create
 * Form tambah lulusan
 */
router.get('/create', (req, res) => {
  res.render('admin/tracklulusan_form', { title: 'Tambah Data Lulusan', lulusan: null });
});

/**
 * POST /admin/tracklulusan
 * Simpan lulusan baru (dengan upload foto + kompresi)
 */
router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const {
      nama, nim, tahunLulus, pekerjaan, tempatKerja, alamatKerja,
      gaji, status, email, noHp
    } = req.body;
    const file = req.file;

    if (!nama || !nim || !tahunLulus) {
      return res.status(400).send('Nama, NIM, dan tahun lulus wajib diisi');
    }

    let fotoUrl = null, fotoFileId = null;
    if (file) {
      // Kompres gambar
      const compressedBuffer = await sharp(file.buffer)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Dapatkan folder
      const folderId = await getLulusanFotoFolder(parseInt(tahunLulus), nim);
      const fileName = `${nim}_${Date.now()}.jpg`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: 'image/jpeg', body: Readable.from(compressedBuffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id',
      });

      // Set akses publik
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      fotoUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      fotoFileId = response.data.id;
    }

    await db.collection('lulusan').add({
      nama,
      nim,
      tahunLulus: parseInt(tahunLulus),
      pekerjaan: pekerjaan || '',
      tempatKerja: tempatKerja || '',
      alamatKerja: alamatKerja || '',
      gaji: gaji || '',
      status: status || 'bekerja',
      email: email || '',
      noHp: noHp || '',
      foto: fotoUrl,
      fotoFileId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    res.redirect('/admin/tracklulusan');
  } catch (error) {
    console.error('Error tambah lulusan:', error);
    res.status(500).send('Gagal menambah data lulusan');
  }
});

// ============================================================================
// DETAIL LULUSAN
// ============================================================================

/**
 * GET /admin/tracklulusan/:id
 * Menampilkan detail lulusan
 */
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('lulusan').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Data lulusan tidak ditemukan');
    }
    const lulusan = { id: doc.id, ...doc.data() };
    res.render('admin/tracklulusan_detail', { title: 'Detail Lulusan', lulusan });
  } catch (error) {
    console.error('Error mengambil detail lulusan:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data lulusan' });
  }
});

// ============================================================================
// EDIT LULUSAN
// ============================================================================

/**
 * GET /admin/tracklulusan/:id/edit
 * Form edit lulusan
 */
router.get('/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('lulusan').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Data lulusan tidak ditemukan');
    }
    const lulusan = { id: doc.id, ...doc.data() };
    res.render('admin/tracklulusan_form', { title: 'Edit Data Lulusan', lulusan });
  } catch (error) {
    console.error('Error ambil lulusan:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data lulusan' });
  }
});

/**
 * POST /admin/tracklulusan/:id/update
 * Update lulusan (dengan upload foto baru opsional + kompresi)
 */
router.post('/:id/update', upload.single('foto'), async (req, res) => {
  try {
    const {
      nama, nim, tahunLulus, pekerjaan, tempatKerja, alamatKerja,
      gaji, status, email, noHp
    } = req.body;
    const file = req.file;
    const docRef = db.collection('lulusan').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send('Data lulusan tidak ditemukan');
    }
    const oldData = doc.data();

    const updateData = {
      nama,
      nim,
      tahunLulus: parseInt(tahunLulus),
      pekerjaan: pekerjaan || '',
      tempatKerja: tempatKerja || '',
      alamatKerja: alamatKerja || '',
      gaji: gaji || '',
      status: status || 'bekerja',
      email: email || '',
      noHp: noHp || '',
      updatedAt: new Date().toISOString()
    };

    if (file) {
      // Hapus foto lama jika ada
      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
        } catch (err) {
          console.error('Gagal hapus foto lama:', err);
        }
      }

      // Kompres gambar
      const compressedBuffer = await sharp(file.buffer)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Dapatkan folder
      const folderId = await getLulusanFotoFolder(parseInt(tahunLulus), nim);
      const fileName = `${nim}_${Date.now()}.jpg`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: 'image/jpeg', body: Readable.from(compressedBuffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id',
      });

      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      updateData.foto = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      updateData.fotoFileId = response.data.id;
    }

    await docRef.update(updateData);
    res.redirect('/admin/tracklulusan');
  } catch (error) {
    console.error('Error update lulusan:', error);
    res.status(500).send('Gagal update data lulusan');
  }
});

// ============================================================================
// HAPUS LULUSAN
// ============================================================================

/**
 * POST /admin/tracklulusan/:id/delete
 * Hapus lulusan beserta foto di Drive
 */
router.post('/:id/delete', async (req, res) => {
  try {
    const docRef = db.collection('lulusan').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).send('Data lulusan tidak ditemukan');
    }
    const data = doc.data();

    if (data.fotoFileId) {
      try {
        await drive.files.delete({ fileId: data.fotoFileId });
      } catch (err) {
        console.error('Gagal hapus foto lulusan:', err);
      }
    }

    await docRef.delete();
    res.redirect('/admin/tracklulusan');
  } catch (error) {
    console.error('Error hapus lulusan:', error);
    res.status(500).send('Gagal hapus data lulusan');
  }
});

module.exports = router;