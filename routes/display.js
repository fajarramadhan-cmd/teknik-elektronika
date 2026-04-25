const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

// Cache dengan TTL (50 menit)
const cache = {
  mahasiswa: new Map(),
  pembimbing: new Map(),
  progress: new Map(),
  stats: null,
  statsExpiry: 0
};
const TTL = 50 * 60 * 1000; // 50 menit

// Helper untuk menyimpan cache dengan auto-expire
function setCache(map, key, value) {
  map.set(key, value);
  setTimeout(() => map.delete(key), TTL);
}

async function getMahasiswaInfo(userId) {
  if (cache.mahasiswa.has(userId)) return cache.mahasiswa.get(userId);
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const info = {
      nama: userDoc.exists ? userDoc.data().nama : 'Mahasiswa',
      nim: userDoc.exists ? userDoc.data().nim : '-'
    };
    setCache(cache.mahasiswa, userId, info);
    return info;
  } catch {
    return { nama: 'Mahasiswa', nim: '-' };
  }
}

async function getPembimbingMahasiswa(mahasiswaId) {
  if (cache.pembimbing.has(mahasiswaId)) return cache.pembimbing.get(mahasiswaId);
  try {
    const snapshot = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    let pembimbing1 = '-', pembimbing2 = '-';
    if (!snapshot.empty) {
      const data = snapshot.docs[0].data();
      pembimbing1 = data.pembimbing1Nama || '-';
      pembimbing2 = data.pembimbing2Nama || '-';
    }
    const result = { pembimbing1, pembimbing2 };
    setCache(cache.pembimbing, mahasiswaId, result);
    return result;
  } catch {
    return { pembimbing1: '-', pembimbing2: '-' };
  }
}

async function getProgressMagang(mahasiswaId, pdkId) {
  const key = `${mahasiswaId}_${pdkId}`;
  if (cache.progress.has(key)) return cache.progress.get(key);
  try {
    const periodSnap = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('pdkId', '==', pdkId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (periodSnap.empty) {
      const result = { uploadedDays: 0, totalDays: 0, percentage: 0 };
      setCache(cache.progress, key, result);
      return result;
    }
    const period = periodSnap.docs[0].data();
    const start = new Date(period.tanggalMulai);
    const end = period.tanggalSelesai ? new Date(period.tanggalSelesai) : new Date();
    const totalDays = Math.ceil((end - start) / (1000*60*60*24)) + 1;
    const logSnap = await db.collection('logbookMagang')
      .where('userId', '==', mahasiswaId)
      .where('pdkId', '==', pdkId)
      .where('status', '==', 'approved')
      .get();
    const uniqueDates = new Set();
    logSnap.docs.forEach(doc => {
      if (doc.data().tanggal) uniqueDates.add(doc.data().tanggal);
    });
    const uploadedDays = uniqueDates.size;
    const percentage = totalDays > 0 ? Math.min(100, Math.round((uploadedDays / totalDays) * 100)) : 0;
    const result = { uploadedDays, totalDays, percentage };
    setCache(cache.progress, key, result);
    return result;
  } catch {
    return { uploadedDays: 0, totalDays: 0, percentage: 0 };
  }
}

async function getStatistikProdi() {
  const now = Date.now();
  if (cache.stats && now < cache.statsExpiry) return cache.stats;
  try {
    const [allLogbook, pendingLogbook, activePeriods, tugasSnapshot] = await Promise.all([
      db.collection('logbookMagang').get(),
      db.collection('logbookMagang').where('status', '==', 'pending').get(),
      db.collection('magangPeriod').where('status', '==', 'active').get(),
      db.collection('tugas').where('deadline', '>=', new Date().toISOString().split('T')[0]).get()
    ]);
    const activeMahasiswaIds = new Set();
    activePeriods.docs.forEach(doc => activeMahasiswaIds.add(doc.data().mahasiswaId));
    const stats = {
      totalLogbook: allLogbook.size,
      logbookPending: pendingLogbook.size,
      totalMahasiswaMagangAktif: activeMahasiswaIds.size,
      tugasAktif: tugasSnapshot.size
    };
    cache.stats = stats;
    cache.statsExpiry = now + TTL;
    return stats;
  } catch (error) {
    console.error('Error getStatistikProdi:', error);
    return { totalLogbook: 0, logbookPending: 0, totalMahasiswaMagangAktif: 0, tugasAktif: 0 };
  }
}

router.get('/', async (req, res) => {
  try {
    // Batasi jumlah logbook yang diambil untuk mengurangi kuota
    const logbookSnapshot = await db.collection('logbookMagang')
      .where('status', '==', 'approved')
      .limit(30)
      .get();

    let logs = logbookSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    logs.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));

    const slides = [];
    for (const data of logs) {
      const imageUrls = data.imageUrls || [];
      if (imageUrls.length === 0) continue;
      const { nama, nim } = await getMahasiswaInfo(data.userId);
      const { pembimbing1, pembimbing2 } = await getPembimbingMahasiswa(data.userId);
      const progress = await getProgressMagang(data.userId, data.pdkId);
      for (const rawUrl of imageUrls) {
        let imageUrl = rawUrl;
        if (imageUrl.includes('drive.google.com')) {
          const match = imageUrl.match(/id=([^&]+)/);
          if (match) imageUrl = `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
        }
        slides.push({
          imageUrl,
          caption: data.kegiatan || 'Kegiatan magang',
          mahasiswa: nama,
          nim: nim,
          tanggal: data.tanggal ? new Date(data.tanggal).toLocaleDateString('id-ID') : '-',
          lokasi: data.lokasi || '',
          perusahaan: data.perusahaan?.nama || '-',
          pembimbing1,
          pembimbing2,
          progressUploaded: progress.uploadedDays,
          progressTotal: progress.totalDays,
          progressPercent: progress.percentage
        });
      }
    }

    if (slides.length === 0) {
      slides.push({
        imageUrl: 'https://via.placeholder.com/800x600?text=Belum+Ada+Foto+Magang',
        caption: 'Belum ada foto magang yang disetujui',
        mahasiswa: '-',
        nim: '-',
        tanggal: '-',
        lokasi: '-',
        perusahaan: '-',
        pembimbing1: '-',
        pembimbing2: '-',
        progressUploaded: 0,
        progressTotal: 0,
        progressPercent: 0
      });
    }

    const stats = await getStatistikProdi();

    res.render('display/display', {
      title: 'TV Prodi - Galeri Magang',
      slides,
      stats
    });
  } catch (error) {
    console.error('Error display TV:', error);
    res.status(500).send('Gagal memuat tampilan TV');
  }
});

module.exports = router;