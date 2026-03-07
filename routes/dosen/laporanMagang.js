/**
 * routes/dosen/laporanMagang.js
 * Dosen melihat laporan magang mahasiswa (read-only)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getMahasiswa(userId) {
  try {
    const doc = await db.collection('users').doc(userId).get();
    if (doc.exists) {
      return { id: doc.id, ...doc.data() };
    }
    return { id: userId, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswa:', error);
    return { id: userId, nama: 'Error', nim: '-' };
  }
}

/**
 * Mendapatkan semua laporan untuk seorang mahasiswa (laporan 1,2,3)
 */
async function getLaporanMahasiswa(userId) {
  const laporanList = [];
  for (let i = 1; i <= 3; i++) {
    const docId = `${userId}_${i}`;
    const doc = await db.collection('laporanMagang').doc(docId).get();
    if (doc.exists) {
      laporanList.push({
        id: docId,
        ...doc.data()
      });
    } else {
      laporanList.push({
        id: docId,
        userId,
        laporanKe: i,
        exists: false
      });
    }
  }
  return laporanList;
}

// ============================================================================
// DAFTAR MAHASISWA YANG MEMILIKI LAPORAN
// ============================================================================

router.get('/', async (req, res) => {
  try {
    // Ambil semua dokumen laporan (tanpa filter, karena jumlah tidak terlalu banyak)
    const snapshot = await db.collection('laporanMagang').get();
    const mahasiswaMap = new Map();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const userId = data.userId;
      if (!userId) return;

      if (!mahasiswaMap.has(userId)) {
        mahasiswaMap.set(userId, {
          userId,
          laporan: []
        });
      }
      mahasiswaMap.get(userId).laporan.push({
        id: doc.id,
        laporanKe: data.laporanKe,
        status: data.status,
        fileUrl: data.fileUrl,
        uploadedAt: data.uploadedAt
      });
    });

    // Ubah map menjadi array dan tambahkan data mahasiswa
    const mahasiswaList = [];
    for (const [userId, item] of mahasiswaMap.entries()) {
      const mahasiswa = await getMahasiswa(userId);
      mahasiswaList.push({
        ...mahasiswa,
        laporan: item.laporan
      });
    }

    // Urutkan berdasarkan nama
    mahasiswaList.sort((a, b) => a.nama.localeCompare(b.nama));

    res.render('dosen/laporan_list', {
      title: 'Laporan Magang Mahasiswa',
      mahasiswaList
    });
  } catch (error) {
    console.error('Error ambil laporan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat daftar laporan'
    });
  }
});

// ============================================================================
// DETAIL LAPORAN PER MAHASISWA
// ============================================================================

router.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const mahasiswa = await getMahasiswa(userId);
    const laporanList = await getLaporanMahasiswa(userId);

    res.render('dosen/laporan_detail', {
      title: `Laporan Magang - ${mahasiswa.nama}`,
      mahasiswa,
      laporanList
    });
  } catch (error) {
    console.error('Error detail laporan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail laporan'
    });
  }
});

module.exports = router;