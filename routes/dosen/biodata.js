/**
 * routes/dosen/biodata.js
 * Biodata Dosen - Lihat dan edit profil, foto, kontak, email, ubah password
 * Terintegrasi dengan Data WEB, kompresi gambar, dan fileId
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db, auth } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const sharp = require('sharp');
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// KONSTANTA FOLDER UTAMA (Data WEB)
// ============================================================================
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0'; // Ganti dengan ID folder Anda

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
 * Mendapatkan folder foto dosen di Google Drive.
 * Struktur: Data WEB / Dosen / Foto / [NIP] /
 * @param {string} nip - NIP dosen
 * @returns {Promise<string>} ID folder
 */
async function getDosenFotoFolder(nip) {
  const parentDosen = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Dosen');
  const parentFoto = await getOrCreateSubFolder(parentDosen, 'Foto');
  const nipFolder = await getOrCreateSubFolder(parentFoto, nip);
  return nipFolder;
}

// ============================================================================
// RUTE UTAMA – TAMPIL BIODATA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const dosenRef = db.collection('dosen').doc(req.dosen.id);
    const dosenDoc = await dosenRef.get();
    if (!dosenDoc.exists) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Data dosen tidak ditemukan'
      });
    }
    const dosen = { id: req.dosen.id, ...dosenDoc.data() };

    res.render('dosen/biodata', {
      title: 'Biodata Saya',
      dosen,
      success: req.query.success,
      reset: req.query.reset
    });
  } catch (error) {
    console.error('❌ Error memuat biodata:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat biodata'
    });
  }
});

// ============================================================================
// UPDATE BIODATA
// ============================================================================

router.post('/update', upload.single('foto'), async (req, res) => {
  try {
    const { nama, kontak, email } = req.body;
    const file = req.file;
    const dosenRef = db.collection('dosen').doc(req.dosen.id);
    const oldData = req.dosen;

    if (!nama || !email) {
      return res.status(400).send('Nama dan email wajib diisi');
    }

    const updateData = {
      nama,
      kontak: kontak || '',
      email,
      updatedAt: new Date().toISOString()
    };

    // ========== PROSES UPLOAD FOTO (dengan kompresi) ==========
    if (file) {
      console.log('📸 File diterima:', file.originalname, file.mimetype, file.size);

      if (!file.mimetype.startsWith('image/')) {
        return res.status(400).send('File harus berupa gambar');
      }

      // Hapus foto lama jika ada
      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
          console.log('🗑️ Foto lama dihapus:', oldData.fotoFileId);
        } catch (err) {
          console.error('⚠️ Gagal hapus foto lama (mungkin sudah tidak ada):', err.message);
        }
      }

      // Kompresi gambar menggunakan sharp
      const compressedBuffer = await sharp(file.buffer)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Dapatkan folder tujuan (berdasarkan NIP)
      const nip = oldData.nip || 'dosen';
      const folderId = await getDosenFotoFolder(nip);

      const fileName = `${nip}_${Date.now()}.jpg`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: 'image/jpeg', body: Readable.from(compressedBuffer) };

      const driveResponse = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id'
      });
      console.log('✅ File uploaded ke Drive, ID:', driveResponse.data.id);

      // Set akses publik
      await drive.permissions.create({
        fileId: driveResponse.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      const directLink = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      updateData.foto = directLink;
      updateData.fotoFileId = driveResponse.data.id;
    }

    // Update email di Firebase Auth jika berubah
    if (email !== oldData.email) {
      try {
        await auth.updateUser(req.user.uid, { email });
        console.log('📧 Email di Auth diperbarui');
      } catch (authError) {
        console.error('❌ Gagal update email di Auth:', authError);
        return res.status(400).send('Email sudah digunakan atau tidak valid');
      }
    }

    // Simpan perubahan ke Firestore
    await dosenRef.update(updateData);
    console.log('💾 Data Firestore diperbarui');

    res.redirect('/dosen/biodata?success=updated');
  } catch (error) {
    console.error('❌ Error update biodata:', error);
    res.status(500).send('Gagal update biodata: ' + error.message);
  }
});

// ============================================================================
// UBAH PASSWORD
// ============================================================================

router.post('/ubah-password', async (req, res) => {
  try {
    const email = req.dosen.email;
    if (!email) {
      return res.status(400).send('Email tidak ditemukan');
    }

    await auth.generatePasswordResetLink(email);
    console.log('📧 Link reset password dikirim ke:', email);
    res.redirect('/dosen/biodata?reset=email_sent');
  } catch (error) {
    console.error('❌ Error reset password:', error);
    res.status(500).send('Gagal mengirim email reset password');
  }
});

module.exports = router;