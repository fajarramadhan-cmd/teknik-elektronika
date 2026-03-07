/**
 * routes/mahasiswa/surat.js
 * Modul Persuratan Mahasiswa: pengajuan surat aktif kuliah dan surat lainnya
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');

// ============================================================================
// KONSTANTA FOLDER UTAMA (Data WEB) – untuk digunakan admin nanti
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

// Fungsi ini akan digunakan oleh admin untuk menyimpan file surat
async function getOrCreateSubFolder(parentId, name) {
  const drive = require('../../config/googleDrive'); // di-include di sini karena hanya untuk admin
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

router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Generate kode validasi (untuk keaslian surat)
 */
function generateKodeValidasi() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ELK${timestamp}${random}`;
}

// ============================================================================
// DAFTAR SURAT
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('surat')
      .where('userId', '==', req.user.id)
      .orderBy('createdAt', 'desc')
      .get();
    const suratList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('mahasiswa/persuratan/index', {
      title: 'Daftar Surat',
      user: req.user,
      suratList
    });
  } catch (error) {
    console.error('Error memuat daftar surat:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat daftar surat' 
    });
  }
});

// ============================================================================
// PENGAJUAN SURAT AKTIF KULIAH
// ============================================================================

router.get('/aktif-kuliah', (req, res) => {
  const currentSemester = getCurrentAcademicSemester(); // helper
  const semesterSekarang = currentSemester.label;
  const tahunAkademik = currentSemester.tahunAkademik;
  res.render('mahasiswa/persuratan/aktif_form', {
    title: 'Ajukan Surat Aktif Kuliah',
    user: req.user,
    semesterSekarang,
    tahunAkademik   // <- pastikan ini ada
  });
});

router.post('/aktif-kuliah', async (req, res) => {
  try {
    const { keperluan } = req.body;
    if (!keperluan) {
      return res.status(400).send('Keperluan harus diisi');
    }

    const current = getCurrentAcademicSemester(); // panggil helper
    const semester = current.label;
    const tahunAkademik = current.tahunAkademik; // sekarang sudah ada

    const kodeValidasi = generateKodeValidasi();

    const suratData = {
      userId: req.user.id,
      nim: req.user.nim,
      nama: req.user.nama,
      jenis: 'Aktif Kuliah',
      kodeValidasi,
      keperluan,
      semester,
      tahunAkademik,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{
        status: 'pending',
        timestamp: new Date().toISOString(),
        catatan: 'Pengajuan surat diterima'
      }]
    };

    await db.collection('surat').add(suratData);
    res.redirect('/mahasiswa/persuratan');
  } catch (error) {
    console.error('Error mengajukan surat:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal mengajukan surat' 
    });
  }
});

// ============================================================================
// PENGAJUAN SURAT LAINNYA
// ============================================================================

router.get('/lainnya', (req, res) => {
  res.render('mahasiswa/persuratan/lainnya_form', {
    title: 'Ajukan Surat Lainnya',
    user: req.user
  });
});

router.post('/lainnya', async (req, res) => {
  try {
    const { jenisSurat, keperluan, keterangan } = req.body;
    if (!jenisSurat || !keperluan) {
      return res.status(400).send('Jenis surat dan keperluan harus diisi');
    }

    const kodeValidasi = generateKodeValidasi();

    const suratData = {
      userId: req.user.id,
      nim: req.user.nim,
      nama: req.user.nama,
      jenis: jenisSurat,
      kodeValidasi,
      keperluan,
      keterangan: keterangan || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{
        status: 'pending',
        timestamp: new Date().toISOString(),
        catatan: 'Pengajuan surat diterima'
      }]
    };

    await db.collection('surat').add(suratData);
    res.redirect('/mahasiswa/persuratan');
  } catch (error) {
    console.error('Error mengajukan surat:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal mengajukan surat' 
    });
  }
});

// ============================================================================
// DETAIL SURAT
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('surat').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Surat tidak ditemukan');
    }
    const surat = { id: doc.id, ...doc.data() };
    if (surat.userId !== req.user.id) {
      return res.status(403).send('Akses ditolak');
    }
    res.render('mahasiswa/persuratan/detail', {
      title: 'Detail Surat',
      user: req.user,
      surat
    });
  } catch (error) {
    console.error('Error detail surat:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat detail surat' 
    });
  }
});

// ============================================================================
// DOWNLOAD SURAT (PDF) - setelah admin upload file
// ============================================================================

router.get('/:id/download', async (req, res) => {
  try {
    const doc = await db.collection('surat').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = doc.data();
    if (surat.userId !== req.user.id) return res.status(403).send('Akses ditolak');
    if (surat.status !== 'completed') {
      return res.status(400).send('Surat belum tersedia');
    }
    if (!surat.fileUrl) {
      return res.status(400).send('File surat belum diupload');
    }
    // Redirect ke URL file (bisa juga download langsung)
    res.redirect(surat.fileUrl);
  } catch (error) {
    console.error('Error download surat:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal mengunduh surat' 
    });
  }
});

// ============================================================================
// BATALKAN PENGAJUAN (hanya jika status pending)
// ============================================================================

router.post('/:id/batal', async (req, res) => {
  try {
    const docRef = db.collection('surat').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = doc.data();
    if (surat.userId !== req.user.id) return res.status(403).send('Akses ditolak');
    if (surat.status !== 'pending') {
      return res.status(400).send('Hanya surat dengan status pending yang dapat dibatalkan');
    }

    await docRef.update({
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
      history: [
        ...(surat.history || []),
        {
          status: 'cancelled',
          timestamp: new Date().toISOString(),
          catatan: 'Dibatalkan oleh mahasiswa'
        }
      ]
    });
    res.redirect('/mahasiswa/persuratan');
  } catch (error) {
    console.error('Error membatalkan surat:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal membatalkan surat' 
    });
  }
});

module.exports = router;