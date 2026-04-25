/**
 * routes/admin/krs.js
 * Kelola KRS: lihat daftar, detail, setujui, tolak, dan hapus
 * Dilengkapi pencegahan duplikat enrollment dan penolakan otomatis KRS lain untuk semester yang sama
 * OPTIMASI: cache per request + Promise.all + batch paralel
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');

router.use(verifyToken);
router.use(isAdmin);

// Cache sederhana untuk satu request (direset setiap route)
let mahasiswaCache = new Map();
let mataKuliahCache = new Map();

function clearCache() {
  mahasiswaCache.clear();
  mataKuliahCache.clear();
}

async function getMahasiswa(userId) {
  if (mahasiswaCache.has(userId)) return mahasiswaCache.get(userId);
  try {
    const doc = await db.collection('users').doc(userId).get();
    const data = doc.exists ? doc.data() : { nama: 'Unknown', nim: '-' };
    mahasiswaCache.set(userId, data);
    return data;
  } catch {
    return { nama: 'Unknown', nim: '-' };
  }
}

async function getMataKuliah(mkId) {
  if (mataKuliahCache.has(mkId)) return mataKuliahCache.get(mkId);
  try {
    const doc = await db.collection('mataKuliah').doc(mkId).get();
    const data = doc.exists ? doc.data() : null;
    mataKuliahCache.set(mkId, data);
    return data;
  } catch {
    return null;
  }
}

// ============================================================================
// DAFTAR KRS (dengan filter status & semester)
// ============================================================================
router.get('/', async (req, res) => {
  try {
    clearCache();
    const { status, semester } = req.query;

    let query = db.collection('krs');
    if (status) query = query.where('status', '==', status);
    if (semester) query = query.where('semester', '==', semester);
    query = query.orderBy('createdAt', 'desc');

    const krsSnapshot = await query.get();
    const krsDocs = krsSnapshot.docs;

    if (krsDocs.length === 0) {
      return res.render('admin/krs_list', {
        title: 'Daftar KRS',
        krsList: [],
        filters: { status, semester },
        success: req.query.success
      });
    }

    // Kumpulkan semua userId dan mkIds unik
    const userIds = new Set();
    const allMkIds = new Set();
    for (const doc of krsDocs) {
      const data = doc.data();
      userIds.add(data.userId);
      const mkIds = data.mataKuliah || [];
      mkIds.forEach(id => allMkIds.add(id));
    }

    // Ambil semua data mahasiswa dan mata kuliah secara paralel
    const [mahasiswaMap, mkMap] = await Promise.all([
      Promise.all(Array.from(userIds).map(async uid => {
        const m = await getMahasiswa(uid);
        return [uid, m];
      })),
      Promise.all(Array.from(allMkIds).map(async mid => {
        const mk = await getMataKuliah(mid);
        return [mid, mk];
      }))
    ]);

    const userMap = new Map(mahasiswaMap);
    const mkFullMap = new Map(mkMap);

    // Bangun list KRS
    const krsList = [];
    for (const doc of krsDocs) {
      const data = doc.data();
      const mahasiswa = userMap.get(data.userId) || { nama: 'Unknown', nim: '-' };
      const mkIds = data.mataKuliah || [];
      const courses = [];
      for (const mkId of mkIds.slice(0, 3)) {
        const mk = mkFullMap.get(mkId);
        if (mk) {
          courses.push({
            kode: mk.kode,
            nama: mk.nama,
            sks: mk.sks
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

    res.render('admin/krs_list', {
      title: 'Daftar KRS',
      krsList,
      filters: { status, semester },
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
    clearCache();
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'KRS tidak ditemukan'
      });
    }
    const krs = { id: krsDoc.id, ...krsDoc.data() };

    const mahasiswa = await getMahasiswa(krs.userId);

    const mkIds = krs.mataKuliah || [];
    const mkList = await Promise.all(mkIds.map(async mkId => {
      const mk = await getMataKuliah(mkId);
      if (mk) {
        return {
          id: mkId,
          kode: mk.kode,
          nama: mk.nama,
          sks: mk.sks
        };
      }
      return null;
    }));
    const filteredMkList = mkList.filter(m => m !== null);

    res.render('admin/krs_detail', {
      title: `Detail KRS - ${mahasiswa.nama}`,
      krs,
      mahasiswa,
      mkList: filteredMkList
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

    // Cek duplikat enrollment untuk semua mk sekaligus
    const enrollmentChecks = await Promise.all(mkIds.map(mkId =>
      db.collection('enrollment')
        .where('userId', '==', userId)
        .where('mkId', '==', mkId)
        .where('semester', '==', semester)
        .where('status', '==', 'active')
        .limit(1)
        .get()
    ));

    for (let i = 0; i < mkIds.length; i++) {
      const mkId = mkIds[i];
      const existingSnapshot = enrollmentChecks[i];
      if (existingSnapshot.empty) {
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
    batch.delete(krsDoc.ref);
    await batch.commit();

    res.redirect('/admin/krs?success=deleted');
  } catch (error) {
    console.error('Error delete KRS:', error);
    res.status(500).send('Gagal menghapus KRS');
  }
});

module.exports = router;