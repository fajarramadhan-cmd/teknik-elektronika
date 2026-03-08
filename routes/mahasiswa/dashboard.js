/**
 * routes/mahasiswa/dashboard.js
 * Dashboard utama mahasiswa
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');
const semesterSekarang = getCurrentAcademicSemester().label;
router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getTagihan(userId) {
  try {
    const tagihanDoc = await db.collection('tagihan').doc(userId).get();
    return tagihanDoc.exists ? tagihanDoc.data().semester || [] : [];
  } catch (error) {
    console.error('Error getTagihan:', error);
    return [];
  }
}

async function getMataKuliahDiambil(userId) {
  try {
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();

    const mkList = [];
    for (const doc of enrollmentSnapshot.docs) {
      const data = doc.data();
      const mkDoc = await db.collection('mataKuliah').doc(data.mkId).get();
      if (mkDoc.exists) {
        mkList.push({
          id: data.mkId,
          ...mkDoc.data(),
          enrollmentId: doc.id,
          semesterEnrollment: data.semester,
          tahunAjaran: data.tahunAjaran
        });
      }
    }
    return mkList;
  } catch (error) {
    console.error('Error getMataKuliahDiambil:', error);
    return [];
  }
}

function getPertemuanTerkini(mk) {
  if (!mk.materi || !Array.isArray(mk.materi)) return 0;
  return mk.materi.filter(m => m.status === 'selesai').length;
}

async function getTugasAktif(mkIds) {
  try {
    if (mkIds.length === 0) return [];
    const now = new Date().toISOString();
    const tugasList = [];
    for (const mkId of mkIds) {
      const snapshot = await db.collection('tugas')
        .where('mkId', '==', mkId)
        .where('deadline', '>', now)
        .orderBy('deadline', 'asc')
        .get();
      snapshot.docs.forEach(doc => tugasList.push({ id: doc.id, ...doc.data() }));
    }
    return tugasList;
  } catch (error) {
    console.error('Error getTugasAktif:', error);
    return [];
  }
}

// ============================================================================
// RUTE UTAMA DASHBOARD
// ============================================================================

// routes/mahasiswa/dashboard.js
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const userId = user.id;

    const tagihan = await getTagihan(userId);
    const mkList = await getMataKuliahDiambil(userId);
    const mkIds = mkList.map(mk => mk.id);
    const totalSks = mkList.reduce((acc, mk) => acc + (mk.sks || 0), 0);
    const tugasAktif = await getTugasAktif(mkIds);

    const currentSemester = getCurrentAcademicSemester();
    const semesterSekarang = currentSemester.label;

    let pertemuanRata = 0;
    if (mkList.length > 0) {
      const totalPertemuan = mkList.reduce((acc, mk) => acc + getPertemuanTerkini(mk), 0);
      pertemuanRata = Math.round(totalPertemuan / mkList.length);
    }

    // ===== HITUNG TOTAL TAGIHAN =====
    let totalTagihan = 0;
    let totalLunas = 0;
    tagihan.forEach(t => {
      if (t.status === 'lunas') {
        totalLunas += t.jumlah;
      } else {
        totalTagihan += t.jumlah;
      }
    });
    const sisaTagihan = totalTagihan; // total yang belum lunas

    res.render('mahasiswa/dashboard', {
      user,
      uploadSuccess: req.query.upload === 'success',
      tagihan,
      totalTagihan,
      totalLunas,
      sisaTagihan,
      totalSks,
      semesterSekarang,
      pertemuanRata,
      tugasAktif
    });

  } catch (error) {
    console.error('Error loading mahasiswa dashboard:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat dashboard mahasiswa'
    });
  }
});
module.exports = router;