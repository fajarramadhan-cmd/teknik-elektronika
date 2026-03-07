/**
 * routes/admin/krs.js
 * Kelola KRS: lihat daftar, detail, setujui, tolak, dan hapus
 * Dilengkapi pencegahan duplikat enrollment dan penolakan otomatis KRS lain untuk semester yang sama
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive'); // untuk hapus file

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// DAFTAR KRS (dengan filter status & semester)
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { status, semester } = req.query;

    let query = db.collection('krs');
    if (status) query = query.where('status', '==', status);
    if (semester) query = query.where('semester', '==', semester);
    query = query.orderBy('createdAt', 'desc');

    const krsSnapshot = await query.get();

    const krsList = [];
    for (const doc of krsSnapshot.docs) {
      const data = doc.data();
      
      const mahasiswaDoc = await db.collection('users').doc(data.userId).get();
      const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: 'Unknown', nim: '-' };

      const mkIds = data.mataKuliah || [];
      const courses = [];
      for (const mkId of mkIds.slice(0, 3)) {
        const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
        if (mkDoc.exists) {
          courses.push({
            kode: mkDoc.data().kode,
            nama: mkDoc.data().nama,
            sks: mkDoc.data().sks
          });
        }
      }

      krsList.push({
        id: doc.id,
        ...data,
        mahasiswa,
        courses,
        courseCount: mkIds.length
      });
    }

    const filters = { status, semester };
    res.render('admin/krs_list', {
      title: 'Daftar KRS',
      krsList,
      filters,
      success: req.query.success
    });
  } catch (error) {
    console.error('Error mengambil KRS:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat daftar KRS'
    });
  }
});

// ============================================================================
// DETAIL KRS
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'KRS tidak ditemukan'
      });
    }
    const krs = { id: krsDoc.id, ...krsDoc.data() };

    const mahasiswaDoc = await db.collection('users').doc(krs.userId).get();
    const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: '-', nim: '-' };

    const mkIds = krs.mataKuliah || [];
    const mkList = [];
    for (const mkId of mkIds) {
      const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
      if (mkDoc.exists) {
        mkList.push({
          id: mkId,
          kode: mkDoc.data().kode,
          nama: mkDoc.data().nama,
          sks: mkDoc.data().sks
        });
      }
    }

    res.render('admin/krs_detail', {
      title: `Detail KRS - ${mahasiswa.nama}`,
      krs,
      mahasiswa,
      mkList
    });
  } catch (error) {
    console.error('Error detail KRS:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail KRS'
    });
  }
});

// ============================================================================
// APPROVE KRS (dengan pencegahan duplikat enrollment)
// ============================================================================

router.post('/:id/approve', async (req, res) => {
  try {
    const krsRef = db.collection('krs').doc(req.params.id);
    const krsDoc = await krsRef.get();
    if (!krsDoc.exists) return res.status(404).send('KRS tidak ditemukan');
    const krs = krsDoc.data();
    const mkIds = krs.mataKuliah || [];
    const semester = krs.semester;
    const userId = krs.userId;

    const batch = db.batch();

    // Update status KRS yang diapprove
    batch.update(krsRef, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id
    });

    // Untuk setiap mata kuliah, cek apakah sudah ada enrollment aktif
    for (const mkId of mkIds) {
      const existingSnapshot = await db.collection('enrollment')
        .where('userId', '==', userId)
        .where('mkId', '==', mkId)
        .where('semester', '==', semester)
        .where('status', '==', 'active')
        .limit(1)
        .get();

      if (existingSnapshot.empty) {
        // Belum ada, buat baru
        const enrollmentRef = db.collection('enrollment').doc();
        batch.set(enrollmentRef, {
          userId,
          mkId,
          semester,
          status: 'active',
          createdAt: new Date().toISOString(),
          approvedBy: req.user.id,
          krsId: req.params.id
        });
      } else {
        // Jika sudah ada, lewati (tidak membuat duplikat)
        console.log(`Enrollment untuk user ${userId} dan mk ${mkId} sudah ada, dilewati.`);
      }
    }

    // Batalkan KRS lain yang masih pending untuk mahasiswa dan semester yang sama
    const otherKrsSnapshot = await db.collection('krs')
      .where('userId', '==', userId)
      .where('semester', '==', semester)
      .where('status', '==', 'pending')
      .get();

    for (const doc of otherKrsSnapshot.docs) {
      if (doc.id !== req.params.id) {
        batch.update(doc.ref, {
          status: 'rejected',
          rejectedAt: new Date().toISOString(),
          rejectedBy: req.user.id,
          alasanPenolakan: 'KRS lain disetujui untuk semester yang sama'
        });
      }
    }

    await batch.commit();
    res.redirect('/admin/krs?success=approved');
  } catch (error) {
    console.error('Error approve KRS:', error);
    res.status(500).send('Gagal menyetujui KRS');
  }
});

// ============================================================================
// REJECT KRS
// ============================================================================

router.post('/:id/reject', async (req, res) => {
  try {
    await db.collection('krs').doc(req.params.id).update({
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.id
    });
    res.redirect('/admin/krs?success=rejected');
  } catch (error) {
    console.error('Error reject KRS:', error);
    res.status(500).send('Gagal menolak KRS');
  }
});

// ============================================================================
// DELETE KRS (beserta file di Drive dan enrollment terkait)
// ============================================================================

/**
 * POST /admin/krs/delete/:id
 * Menghapus KRS, file terkait di Google Drive, dan semua enrollment yang berasal dari KRS ini
 */
router.post('/delete/:id', async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) {
      return res.status(404).send('KRS tidak ditemukan');
    }
    const krs = krsDoc.data();

    // Hapus file di Drive jika ada driveFileId
    if (krs.driveFileId) {
      try {
        await drive.files.delete({ fileId: krs.driveFileId });
        console.log('File di Drive berhasil dihapus:', krs.driveFileId);
      } catch (err) {
        console.error('Gagal menghapus file di Drive:', err.message);
        // Tetap lanjutkan penghapusan dokumen meskipun file gagal dihapus
      }
    }

    // Hapus semua enrollment yang terkait dengan KRS ini
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('krsId', '==', req.params.id)
      .get();

    const batch = db.batch();

    enrollmentSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Hapus dokumen KRS
    batch.delete(krsDoc.ref);

    await batch.commit();

    res.redirect('/admin/krs?success=deleted');
  } catch (error) {
    console.error('Error delete KRS:', error);
    res.status(500).send('Gagal menghapus KRS');
  }
});

module.exports = router;