const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { db } = require('../config/firebaseAdmin');

// Cache nama mahasiswa
let mahasiswaCache = new Map();

async function getMahasiswaName(userId) {
  if (mahasiswaCache.has(userId)) return mahasiswaCache.get(userId);
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    let name = userDoc.exists ? userDoc.data().nama : 'Mahasiswa';
    mahasiswaCache.set(userId, name);
    return name;
  } catch (error) {
    console.error('Error getMahasiswaName:', error);
    return 'Mahasiswa';
  }
}

function getValidImageUrl(url) {
  if (!url) return null;
  // Jika sudah URL thumbnail Google Drive, langsung kembalikan
  if (url.includes('drive.google.com/thumbnail')) return url;
  // Konversi URL drive biasa ke thumbnail
  const match = url.match(/[?&]id=([^&]+)/);
  if (match) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
  const match2 = url.match(/\/d\/([^\/]+)/);
  if (match2) return `https://drive.google.com/thumbnail?id=${match2[1]}&sz=w1000`;
  // URL lain (misal imgur)
  return url;
}

router.get('/', async (req, res) => {
  try {
    console.log('📡 Mengambil data logbook approved...');
    const logbookSnapshot = await db.collection('logbookMagang')
      .where('status', '==', 'approved')
      .limit(100)
      .get();

    console.log(`✅ Ditemukan ${logbookSnapshot.size} logbook approved.`);
    
    let logs = logbookSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    logs.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));

    const slides = [];
    for (const data of logs) {
      const imageUrls = data.imageUrls || [];
      if (imageUrls.length === 0) continue;

      const namaMahasiswa = await getMahasiswaName(data.userId);
      const kegiatan = data.kegiatan || 'Kegiatan magang';
      const tanggal = data.tanggal ? new Date(data.tanggal).toLocaleDateString('id-ID') : '-';
      const lokasi = data.lokasi || '';

      for (const rawUrl of imageUrls) {
        const imageUrl = getValidImageUrl(rawUrl);
        if (!imageUrl) continue;
        slides.push({
          imageUrl,
          caption: kegiatan,
          mahasiswa: namaMahasiswa,
          tanggal,
          lokasi
        });
      }
    }

    console.log(`🖼️ Total slide yang dihasilkan: ${slides.length}`);

    if (slides.length === 0) {
      slides.push({
        imageUrl: 'https://via.placeholder.com/1280x720?text=Belum+Ada+Foto+Magang',
        caption: 'Belum ada foto magang yang disetujui',
        mahasiswa: '-',
        tanggal: '-',
        lokasi: '-'
      });
    }

    // Statistik (paralel)
    const [totalMahasiswaMagang, totalLogbookApproved] = await Promise.all([
      db.collection('magangPeriod').where('status', '==', 'active').get().then(snap => snap.size),
      db.collection('logbookMagang').where('status', '==', 'approved').get().then(snap => snap.size)
    ]);

    res.render('display/display', {
      title: 'TV Prodi - Galeri Magang',
      slides,
      totalMahasiswaMagang,
      totalLogbookApproved
    });
  } catch (error) {
    console.error('❌ Error display TV:', error);
    res.status(500).send('Gagal memuat tampilan TV');
  }
});

module.exports = router;