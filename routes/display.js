const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

let mahasiswaCache = new Map();
let dosenCache = new Map();

async function getMahasiswaName(userId) {
  if (mahasiswaCache.has(userId)) return mahasiswaCache.get(userId);
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    let name = userDoc.exists ? userDoc.data().nama : 'Mahasiswa';
    mahasiswaCache.set(userId, name);
    return name;
  } catch {
    return 'Mahasiswa';
  }
}

async function getMahasiswaNim(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    return userDoc.exists ? userDoc.data().nim : '-';
  } catch {
    return '-';
  }
}

async function getPembimbingMahasiswa(mahasiswaId) {
  try {
    const snapshot = await db.collection('bimbingan')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (snapshot.empty) return { pembimbing1: '-', pembimbing2: '-' };
    const data = snapshot.docs[0].data();
    let pembimbing1 = data.pembimbing1Nama || '-';
    let pembimbing2 = data.pembimbing2Nama || '-';
    return { pembimbing1, pembimbing2 };
  } catch {
    return { pembimbing1: '-', pembimbing2: '-' };
  }
}

async function getProgressMagang(mahasiswaId, pdkId) {
  try {
    // Hitung total hari periode (ambil dari magangPeriod aktif)
    const periodSnap = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('pdkId', '==', pdkId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (periodSnap.empty) return { uploadedDays: 0, totalDays: 0, percentage: 0 };
    const period = periodSnap.docs[0].data();
    const start = new Date(period.tanggalMulai);
    const end = period.tanggalSelesai ? new Date(period.tanggalSelesai) : new Date();
    const totalDays = Math.ceil((end - start) / (1000*60*60*24)) + 1;
    // Hitung hari unik logbook approved
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
    return { uploadedDays, totalDays, percentage };
  } catch {
    return { uploadedDays: 0, totalDays: 0, percentage: 0 };
  }
}

async function getStatistikProdi() {
  // Total Logbook (semua status)
  const allLogbook = await db.collection('logbookMagang').get();
  const totalLogbook = allLogbook.size;
  
  // Logbook Pending
  const pendingSnapshot = await db.collection('logbookMagang').where('status', '==', 'pending').get();
  const logbookPending = pendingSnapshot.size;
  
  // Jumlah mahasiswa dengan periode magang active
  const activePeriods = await db.collection('magangPeriod')
    .where('status', '==', 'active')
    .get();
  const activeMahasiswaIds = new Set();
  activePeriods.docs.forEach(doc => activeMahasiswaIds.add(doc.data().mahasiswaId));
  const totalMahasiswaMagangAktif = activeMahasiswaIds.size;
  
  // Tugas Aktif (deadline >= hari ini)
  const today = new Date().toISOString().split('T')[0];
  const tugasSnapshot = await db.collection('tugas')
    .where('deadline', '>=', today)
    .get();
  const tugasAktif = tugasSnapshot.size;
  
  return { totalLogbook, logbookPending, totalMahasiswaMagangAktif, tugasAktif };
}

router.get('/', async (req, res) => {
  try {
    const logbookSnapshot = await db.collection('logbookMagang')
      .where('status', '==', 'approved')
      .limit(100)
      .get();

    let logs = logbookSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    logs.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));

    const slides = [];
    for (const data of logs) {
      const imageUrls = data.imageUrls || [];
      if (imageUrls.length === 0) continue;
      const nama = await getMahasiswaName(data.userId);
      const nim = await getMahasiswaNim(data.userId);
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
    console.error(error);
    res.status(500).send('Gagal memuat tampilan TV');
  }
});

module.exports = router;