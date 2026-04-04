/**
 * routes/admin/bimbingan.js
 * Admin: Kelola bimbingan magang (menetapkan pembimbing 1 dan 2 untuk setiap mahasiswa)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan semua mahasiswa (aktif)
 */
async function getAllMahasiswa() {
  try {
    const snapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nama')
      .get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      nim: doc.data().nim,
      nama: doc.data().nama,
      email: doc.data().email
    }));
  } catch (error) {
    console.error('Error getAllMahasiswa:', error);
    return [];
  }
}

/**
 * Mendapatkan semua dosen (aktif)
 */
async function getAllDosen() {
  try {
    const snapshot = await db.collection('dosen')
      .orderBy('nama')
      .get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      nidn: doc.data().nidn,
      nama: doc.data().nama,
      email: doc.data().email
    }));
  } catch (error) {
    console.error('Error getAllDosen:', error);
    return [];
  }
}

/**
 * Mendapatkan bimbingan aktif untuk seorang mahasiswa
 */
async function getBimbinganByMahasiswa(mahasiswaId) {
  try {
    const snapshot = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    
    const data = snapshot.docs[0].data();
    return {
      id: snapshot.docs[0].id,
      pembimbing1Id: data.pembimbing1Id,
      pembimbing1Nama: data.pembimbing1Nama,
      pembimbing2Id: data.pembimbing2Id || null,
      pembimbing2Nama: data.pembimbing2Nama || null,
      semester: data.semester,
      tahunAjaran: data.tahunAjaran
    };
  } catch (error) {
    console.error('Error getBimbinganByMahasiswa:', error);
    return null;
  }
}

/**
 * Mendapatkan semua bimbingan aktif (untuk tabel)
 */
async function getAllBimbingan() {
  try {
    const snapshot = await db.collection('bimbingan')
      .where('status', '==', 'active')
      .get();
    
    const bimbinganList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await db.collection('users').doc(data.mahasiswaId).get();
      
      bimbinganList.push({
        id: doc.id,
        mahasiswaId: data.mahasiswaId,
        mahasiswaNim: mahasiswa.exists ? mahasiswa.data().nim : '-',
        mahasiswaNama: mahasiswa.exists ? mahasiswa.data().nama : '-',
        pembimbing1Id: data.pembimbing1Id,
        pembimbing1Nama: data.pembimbing1Nama,
        pembimbing2Id: data.pembimbing2Id || null,
        pembimbing2Nama: data.pembimbing2Nama || null,
        semester: data.semester,
        tahunAjaran: data.tahunAjaran,
        createdAt: data.createdAt
      });
    }
    
    return bimbinganList;
  } catch (error) {
    console.error('Error getAllBimbingan:', error);
    return [];
  }
}

// ============================================================================
// HALAMAN UTAMA BIMBINGAN
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const currentSemester = getCurrentAcademicSemester();
    const semesterLabel = currentSemester.label;
    const tahunAjaran = currentSemester.tahunAkademik;
    
    const mahasiswaList = await getAllMahasiswa();
    const dosenList = await getAllDosen();
    const bimbinganList = await getAllBimbingan();
    
    // Buat map untuk cek status bimbingan per mahasiswa
    const bimbinganMap = new Map();
    for (const b of bimbinganList) {
      bimbinganMap.set(b.mahasiswaId, b);
    }
    
    res.render('admin/bimbingan/index', {
      title: 'Kelola Bimbingan Magang',
      mahasiswaList,
      dosenList,
      bimbinganList,
      bimbinganMap,
      semesterLabel,
      tahunAjaran,
      success: req.query.success,
      error: req.query.error
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat halaman bimbingan' 
    });
  }
});

// ============================================================================
// TAMBAH / UPDATE BIMBINGAN
// ============================================================================

router.post('/set', async (req, res) => {
  try {
    const { 
      mahasiswaId, 
      pembimbing1Id, 
      pembimbing2Id, 
      semester, 
      tahunAjaran 
    } = req.body;
    
    if (!mahasiswaId || !pembimbing1Id || !semester) {
      return res.redirect('/admin/bimbingan?error=Data tidak lengkap');
    }
    
    // Ambil nama pembimbing 1
    const dosen1Doc = await db.collection('dosen').doc(pembimbing1Id).get();
    const pembimbing1Nama = dosen1Doc.exists ? dosen1Doc.data().nama : '-';
    
    // Ambil nama pembimbing 2 (jika ada)
    let pembimbing2Nama = null;
    if (pembimbing2Id && pembimbing2Id !== '') {
      const dosen2Doc = await db.collection('dosen').doc(pembimbing2Id).get();
      pembimbing2Nama = dosen2Doc.exists ? dosen2Doc.data().nama : null;
    }
    
    // Cek apakah sudah ada bimbingan aktif untuk mahasiswa ini
    const existing = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .get();
    
    const now = new Date().toISOString();
    
    if (!existing.empty) {
      // Update existing
      const docRef = existing.docs[0].ref;
      await docRef.update({
        pembimbing1Id,
        pembimbing1Nama,
        pembimbing2Id: pembimbing2Id || null,
        pembimbing2Nama: pembimbing2Nama || null,
        semester,
        tahunAjaran: tahunAjaran || null,
        updatedAt: now,
        updatedBy: req.user.id
      });
    } else {
      // Create new
      await db.collection('bimbingan').add({
        mahasiswaId,
        pembimbing1Id,
        pembimbing1Nama,
        pembimbing2Id: pembimbing2Id || null,
        pembimbing2Nama: pembimbing2Nama || null,
        semester,
        tahunAjaran: tahunAjaran || null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: req.user.id
      });
    }
    
    res.redirect('/admin/bimbingan?success=Bimbingan berhasil disimpan');
  } catch (error) {
    console.error('Error set bimbingan:', error);
    res.redirect(`/admin/bimbingan?error=${encodeURIComponent(error.message)}`);
  }
});

// ============================================================================
// HAPUS BIMBINGAN
// ============================================================================

router.post('/:id/delete', async (req, res) => {
  try {
    const bimbinganRef = db.collection('bimbingan').doc(req.params.id);
    await bimbinganRef.update({
      status: 'deleted',
      deletedAt: new Date().toISOString(),
      deletedBy: req.user.id
    });
    
    res.redirect('/admin/bimbingan?success=Bimbingan berhasil dihapus');
  } catch (error) {
    console.error('Error delete bimbingan:', error);
    res.redirect(`/admin/bimbingan?error=${encodeURIComponent(error.message)}`);
  }
});

// ============================================================================
// API GET BIMBINGAN BY MAHASISWA (untuk AJAX)
// ============================================================================

router.get('/api/mahasiswa/:id', async (req, res) => {
  try {
    const bimbingan = await getBimbinganByMahasiswa(req.params.id);
    res.json({ success: true, data: bimbingan });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;