const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db, auth } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan folder foto profil di Google Drive, membuat jika belum ada
 */
async function getFotoProfilFolderId() {
  const folderName = 'Foto_Profil';
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

// ============================================================================
// DAFTAR PENGGUNA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { role } = req.query;
    let users = [];

    if (role && role !== 'all') {
      if (role === 'dosen') {
        const dosenSnapshot = await db.collection('dosen').orderBy('nama').get();
        users = dosenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), role: 'dosen' }));
      } else {
        const userSnapshot = await db.collection('users').where('role', '==', role).orderBy('nama').get();
        users = userSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    } else {
      const userSnapshot = await db.collection('users').orderBy('nama').get();
      const dosenSnapshot = await db.collection('dosen').orderBy('nama').get();
      users = [
        ...userSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        ...dosenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), role: 'dosen' }))
      ];
      users.sort((a, b) => a.nama.localeCompare(b.nama));
    }

    res.render('admin/users', {
      title: 'Kelola Pengguna',
      users,
      role: role || 'all',
      success: req.query.success
    });
  } catch (error) {
    console.error('Error ambil pengguna:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat data pengguna'
    });
  }
});

// ============================================================================
// TAMBAH PENGGUNA (dengan upload foto)
// ============================================================================

router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { role, nama, nim, nip, email, password } = req.body;
    const file = req.file;

    if (!role || !nama || !email || !password) {
      return res.status(400).send('Role, nama, email, dan password wajib diisi');
    }

    // Buat user di Firebase Authentication
    let userRecord;
    try {
      userRecord = await auth.createUser({ email, password, displayName: nama });
    } catch (authError) {
      console.error('Gagal membuat user di Auth:', authError);
      return res.status(400).send('Email sudah terdaftar atau password tidak valid');
    }

    let fotoUrl = null;
    let fotoFileId = null;

    // Upload foto jika ada
    if (file) {
      // Validasi tipe file
      if (!file.mimetype.startsWith('image/')) {
        // Jika gagal, hapus user yang sudah dibuat di Auth
        await auth.deleteUser(userRecord.uid);
        return res.status(400).send('File harus berupa gambar');
      }

      // Validasi ukuran (maks 2MB)
      if (file.size > 2 * 1024 * 1024) {
        await auth.deleteUser(userRecord.uid);
        return res.status(400).send('Ukuran file maksimal 2MB');
      }

      try {
        const folderId = await getFotoProfilFolderId();
        const ext = file.originalname.split('.').pop();
        const fileName = `${userRecord.uid}_${Date.now()}.${ext}`;
        const fileMetadata = { name: fileName, parents: [folderId] };
        const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
        const driveResponse = await drive.files.create({
          resource: fileMetadata,
          media,
          fields: 'id, webViewLink'
        });

        // Set permission publik
        await drive.permissions.create({
          fileId: driveResponse.data.id,
          requestBody: { role: 'reader', type: 'anyone' }
        });

        fotoUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
        fotoFileId = driveResponse.data.id;
      } catch (driveError) {
        console.error('Gagal upload ke Drive:', driveError);
        await auth.deleteUser(userRecord.uid);
        return res.status(500).send('Gagal mengupload foto. Coba lagi.');
      }
    }

    const userData = {
      nama,
      email,
      foto: fotoUrl,
      fotoFileId,
      createdAt: new Date().toISOString()
    };

    // Simpan ke Firestore sesuai role
    try {
      if (role === 'dosen') {
        userData.nip = nip || '';
        userData.role = 'dosen';
        await db.collection('dosen').doc(userRecord.uid).set(userData);
      } else {
        userData.nim = role === 'mahasiswa' ? nim : '';
        userData.role = role;
        await db.collection('users').doc(userRecord.uid).set(userData);
      }
    } catch (firestoreError) {
      console.error('Gagal simpan ke Firestore:', firestoreError);
      // Rollback: hapus dari Auth
      await auth.deleteUser(userRecord.uid).catch(() => {});
      return res.status(500).send('Gagal menyimpan data pengguna');
    }

    res.redirect('/admin/users?success=ditambahkan');
  } catch (error) {
    console.error('Error tambah user:', error);
    res.status(500).send('Gagal menambah user: ' + error.message);
  }
});

// ============================================================================
// FORM EDIT PENGGUNA
// ============================================================================

router.get('/edit/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    let user = null;
    let role = '';

    // Coba ambil dari koleksi users
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      user = { id: userId, ...userDoc.data() };
      role = user.role;
    } else {
      // Coba dari koleksi dosen
      const dosenDoc = await db.collection('dosen').doc(userId).get();
      if (dosenDoc.exists) {
        user = { id: userId, ...dosenDoc.data(), role: 'dosen' };
        role = 'dosen';
      }
    }

    if (!user) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Pengguna tidak ditemukan'
      });
    }

    res.render('admin/users_edit', {
      title: 'Edit Pengguna',
      user,
      role
    });
  } catch (error) {
    console.error('Error load form edit:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form edit'
    });
  }
});

// ============================================================================
// PROSES UPDATE PENGGUNA (dengan upload foto baru)
// ============================================================================

router.post('/edit/:id', upload.single('foto'), async (req, res) => {
  try {
    const userId = req.params.id;
    const { nama, nim, nip, email, hapusFoto } = req.body;
    const file = req.file;

    // Cari data lama
    const userRef = db.collection('users').doc(userId);
    const dosenRef = db.collection('dosen').doc(userId);
    let userDoc = await userRef.get();
    let isDosen = false;
    let oldData;

    if (userDoc.exists) {
      oldData = userDoc.data();
    } else {
      const dosenDoc = await dosenRef.get();
      if (dosenDoc.exists) {
        oldData = dosenDoc.data();
        isDosen = true;
      } else {
        return res.status(404).send('Pengguna tidak ditemukan');
      }
    }

    const updateData = {
      nama,
      email,
      updatedAt: new Date().toISOString()
    };

    if (isDosen) {
      updateData.nip = nip || '';
    } else {
      updateData.nim = oldData.role === 'mahasiswa' ? nim : '';
    }

    // Proses foto
    if (hapusFoto === 'true') {
      // Hapus foto lama
      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
        } catch (err) {
          console.error('Gagal hapus foto lama:', err);
        }
      }
      updateData.foto = null;
      updateData.fotoFileId = null;
    } else if (file) {
      // Upload foto baru
      if (!file.mimetype.startsWith('image/')) {
        return res.status(400).send('File harus berupa gambar');
      }
      if (file.size > 2 * 1024 * 1024) {
        return res.status(400).send('Ukuran file maksimal 2MB');
      }

      // Hapus foto lama jika ada
      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
        } catch (err) {
          console.error('Gagal hapus foto lama:', err);
        }
      }

      const folderId = await getFotoProfilFolderId();
      const ext = file.originalname.split('.').pop();
      const fileName = `${userId}_${Date.now()}.${ext}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const driveResponse = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      await drive.permissions.create({
        fileId: driveResponse.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
      updateData.foto = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      updateData.fotoFileId = driveResponse.data.id;
    }

    // Update di Firestore
    if (isDosen) {
      await dosenRef.update(updateData);
    } else {
      await userRef.update(updateData);
    }

    // Update email di Auth jika berubah
    if (email !== oldData.email) {
      try {
        await auth.updateUser(userId, { email });
      } catch (authError) {
        console.error('Gagal update email di Auth:', authError);
        // Tetap lanjut, tapi beri pesan
      }
    }

    res.redirect('/admin/users?success=diperbarui');
  } catch (error) {
    console.error('Error update user:', error);
    res.status(500).send('Gagal update user: ' + error.message);
  }
});

// ============================================================================
// HAPUS PENGGUNA
// ============================================================================

router.post('/:id/delete', async (req, res) => {
  try {
    const userId = req.params.id;

    // Hapus foto di Drive jika ada
    const userRef = db.collection('users').doc(userId);
    const dosenRef = db.collection('dosen').doc(userId);
    let fotoFileId = null;

    const userDoc = await userRef.get();
    if (userDoc.exists) {
      fotoFileId = userDoc.data().fotoFileId;
    } else {
      const dosenDoc = await dosenRef.get();
      if (dosenDoc.exists) {
        fotoFileId = dosenDoc.data().fotoFileId;
      }
    }

    if (fotoFileId) {
      try {
        await drive.files.delete({ fileId: fotoFileId });
      } catch (err) {
        console.error('Gagal hapus foto:', err);
      }
    }

    // Hapus dari Auth
    try {
      await auth.deleteUser(userId);
    } catch (authError) {
      console.error('Gagal hapus dari Auth:', authError);
    }

    // Hapus dari Firestore
    await userRef.delete().catch(() => {});
    await dosenRef.delete().catch(() => {});

    res.redirect('/admin/users?success=dihapus');
  } catch (error) {
    console.error('Error hapus user:', error);
    res.status(500).send('Gagal hapus user');
  }
});

// ============================================================================
// RESET PASSWORD (kirim email reset)
// ============================================================================

router.post('/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email tidak boleh kosong' });
    }
    await auth.generatePasswordResetLink(email);
    res.json({ success: true });
  } catch (error) {
    console.error('Error reset password:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;