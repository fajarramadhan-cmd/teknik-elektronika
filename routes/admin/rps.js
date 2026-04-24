const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

/**
 * GET /admin/rps
 * Menampilkan daftar semua mata kuliah yang memiliki RPS (rpsUrl tidak null)
 * Atau semua mata kuliah dengan informasi apakah sudah upload RPS
 */
router.get('/', async (req, res) => {
  try {
    const { prodi, dosen, search } = req.query;

    // Query dasar: ambil semua mata kuliah
    let query = db.collection('mataKuliah');

    // Optional filtering (jika diperlukan, sesuaikan dengan struktur data Anda)
    // Misal jika ada field prodiId
    // if (prodi) query = query.where('prodiId', '==', prodi);

    const mkSnapshot = await query.get();

    // Kumpulkan data mata kuliah beserta dosen pengampu
    const mkList = [];
    for (const doc of mkSnapshot.docs) {
      const data = doc.data();
      // Ambil nama dosen dari field dosenIds (array)
      let dosenNames = [];
      if (data.dosenIds && data.dosenIds.length) {
        for (const dId of data.dosenIds) {
          const dosenDoc = await db.collection('dosen').doc(dId).get();
          if (dosenDoc.exists) dosenNames.push(dosenDoc.data().nama);
        }
      }
      mkList.push({
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        semester: data.semester,
        sks: data.sks,
        rpsUrl: data.rpsUrl || null,
        dosen: dosenNames.join(', ') || '-',
        updatedAt: data.updatedAt || null
      });
    }

    // Filter pencarian teks (search)
    let filteredList = mkList;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredList = mkList.filter(mk =>
        mk.kode.toLowerCase().includes(lowerSearch) ||
        mk.nama.toLowerCase().includes(lowerSearch) ||
        mk.dosen.toLowerCase().includes(lowerSearch)
      );
    }

    // Sorting: yang sudah upload RPS di atas?
    filteredList.sort((a, b) => {
      if (a.rpsUrl && !b.rpsUrl) return -1;
      if (!a.rpsUrl && b.rpsUrl) return 1;
      return a.kode.localeCompare(b.kode);
    });

    res.render('admin/rps/index', {
      title: 'Daftar RPS Mata Kuliah',
      mkList: filteredList,
      search: search || ''
    });
  } catch (error) {
    console.error('Error loading admin RPS list:', error);
    res.status(500).render('error', { message: 'Gagal memuat data RPS' });
  }
});

// Optional: route untuk melihat detail RPS (hanya preview PDF via link yang sudah ada)
// Tidak perlu route khusus karena rpsUrl langsung diarahkan ke Google Drive.

module.exports = router;