// models/magangPeriodModel.js
const { db } = require('../config/firebaseAdmin');

// Konstanta Status
const MAGANG_STATUS = {
  ACTIVE: 'active',      // Magang berjalan
  LOCKED: 'locked',      // Dikunci sementara
  COMPLETED: 'completed', // Selesai
  CANCELLED: 'cancelled'  // Dibatalkan
};

/**
 * Membuat periode magang baru
 * @param {Object} data - Data periode magang
 * @returns {Promise<string>} ID periode magang
 */
async function createMagangPeriod(data) {
  const now = new Date().toISOString();
  
  const periodData = {
    // Identitas
    mahasiswaId: data.mahasiswaId,
    pdkId: data.pdkId,
    pdkKode: data.pdkKode,
    pdkNama: data.pdkNama,
    
    // Periode
    tanggalMulai: data.tanggalMulai,
    tanggalSelesai: data.tanggalSelesai || null,
    status: MAGANG_STATUS.ACTIVE,
    
    // Dosen Pembimbing
    pembimbing1Id: data.pembimbing1Id,
    pembimbing1Nama: data.pembimbing1Nama,
    pembimbing2Id: data.pembimbing2Id || null,
    pembimbing2Nama: data.pembimbing2Nama || null,
    
    // Perusahaan
    perusahaan: {
      nama: data.namaPerusahaan || '',
      alamat: data.alamatPerusahaan || '',
      kontak: data.kontakPerusahaan || '',
      kontakHp: data.kontakHpPerusahaan || '',
      email: data.emailPerusahaan || '',
      website: data.websitePerusahaan || '',
      pembimbingLapangan: data.pembimbingLapangan || '',
      jabatanPembimbingLapangan: data.jabatanPembimbingLapangan || '',
      diisiOleh: data.diisiOleh,
      diisiPada: now
    },
    
    // Nilai
    nilai: {
      angka: null,
      huruf: null,
      komentar: null,
      dinilaiOleh: null,
      dinilaiPada: null,
      komponenNilai: {}
    },
    
    // Ulasan Mahasiswa
    ulasan: {
      isFilled: false,
      deskripsiPerusahaan: '',
      fasilitasMagang: '',
      saranUntukJunior: '',
      pengalamanKerja: '',
      rating: null,
      diisiPada: null,
      diisiOleh: null
    },
    
    // Lock History
    lockHistory: [],
    
    // Timestamps
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    
    // History Perubahan
    history: [{
      action: 'created',
      tanggal: now.split('T')[0],
      catatan: 'Periode magang dibuat',
      oleh: data.diisiOleh
    }]
  };
  
  const docRef = await db.collection('magangPeriod').add(periodData);
  return docRef.id;
}

/**
 * Mendapatkan periode magang berdasarkan ID
 * @param {string} periodId - ID periode magang
 * @returns {Promise<Object|null>}
 */
async function getMagangPeriodById(periodId) {
  const doc = await db.collection('magangPeriod').doc(periodId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Mendapatkan semua periode magang mahasiswa
 * @param {string} mahasiswaId - UID mahasiswa
 * @returns {Promise<Array>}
 */
async function getMagangPeriodsByMahasiswa(mahasiswaId) {
  const snapshot = await db.collection('magangPeriod')
    .where('mahasiswaId', '==', mahasiswaId)
    .orderBy('pdkKode', 'asc')
    .get();
  
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Mendapatkan periode magang aktif mahasiswa
 * @param {string} mahasiswaId - UID mahasiswa
 * @returns {Promise<Array>}
 */
async function getActiveMagangPeriods(mahasiswaId) {
  const snapshot = await db.collection('magangPeriod')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('status', '==', MAGANG_STATUS.ACTIVE)
    .get();
  
  const activePeriods = [];
  const today = new Date().toISOString().split('T')[0];
  
  for (const doc of snapshot.docs) {
    const period = doc.data();
    
    // Cek apakah dalam periode tanggal
    let isInPeriod = true;
    if (period.tanggalMulai && today < period.tanggalMulai) isInPeriod = false;
    if (period.tanggalSelesai && today > period.tanggalSelesai) isInPeriod = false;
    
    if (isInPeriod) {
      activePeriods.push({ id: doc.id, ...period });
    }
  }
  
  return activePeriods;
}

/**
 * Mendapatkan periode magang yang sudah selesai
 * @param {string} mahasiswaId - UID mahasiswa
 * @returns {Promise<Array>}
 */
async function getCompletedMagangPeriods(mahasiswaId) {
  const snapshot = await db.collection('magangPeriod')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('status', '==', MAGANG_STATUS.COMPLETED)
    .orderBy('completedAt', 'desc')
    .get();
  
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Update status periode magang
 * @param {string} periodId - ID periode
 * @param {string} status - Status baru
 * @param {string} reason - Alasan perubahan
 * @param {string} updatedBy - UID yang mengubah
 */
async function updatePeriodStatus(periodId, status, reason = '', updatedBy = '') {
  const periodRef = db.collection('magangPeriod').doc(periodId);
  const periodDoc = await periodRef.get();
  
  if (!periodDoc.exists) {
    throw new Error('Periode magang tidak ditemukan');
  }
  
  const period = periodDoc.data();
  const now = new Date().toISOString();
  
  const updateData = {
    status,
    updatedAt: now,
    history: [
      ...(period.history || []),
      {
        action: status,
        tanggal: now.split('T')[0],
        catatan: reason,
        oleh: updatedBy
      }
    ]
  };
  
  if (status === MAGANG_STATUS.COMPLETED) {
    updateData.completedAt = now;
  }
  
  await periodRef.update(updateData);
}

/**
 * Beri nilai magang
 * @param {string} periodId - ID periode
 * @param {number} nilaiAngka - Nilai angka (0-100)
 * @param {string} komentar - Komentar dosen
 * @param {string} dinilaiOleh - UID dosen
 * @param {Object} komponenNilai - Nilai per komponen (opsional)
 */
async function setNilaiMagang(periodId, nilaiAngka, komentar, dinilaiOleh, komponenNilai = {}) {
  const periodRef = db.collection('magangPeriod').doc(periodId);
  const periodDoc = await periodRef.get();
  
  if (!periodDoc.exists) {
    throw new Error('Periode magang tidak ditemukan');
  }
  
  // Hitung nilai huruf
  let nilaiHuruf = 'E';
  if (nilaiAngka >= 85) nilaiHuruf = 'A';
  else if (nilaiAngka >= 75) nilaiHuruf = 'B';
  else if (nilaiAngka >= 65) nilaiHuruf = 'C';
  else if (nilaiAngka >= 50) nilaiHuruf = 'D';
  
  await periodRef.update({
    'nilai.angka': nilaiAngka,
    'nilai.huruf': nilaiHuruf,
    'nilai.komentar': komentar || '',
    'nilai.dinilaiOleh': dinilaiOleh,
    'nilai.dinilaiPada': new Date().toISOString(),
    'nilai.komponenNilai': komponenNilai,
    updatedAt: new Date().toISOString()
  });
}

/**
 * Lock periode magang (hentikan sementara)
 * @param {string} periodId - ID periode
 * @param {string} reason - Alasan lock
 * @param {string} lockedBy - UID dosen
 */
async function lockMagangPeriod(periodId, reason, lockedBy) {
  const periodRef = db.collection('magangPeriod').doc(periodId);
  const periodDoc = await periodRef.get();
  
  if (!periodDoc.exists) {
    throw new Error('Periode magang tidak ditemukan');
  }
  
  const period = periodDoc.data();
  const now = new Date().toISOString();
  
  const lockHistory = period.lockHistory || [];
  lockHistory.push({
    action: 'locked',
    reason: reason || 'Tidak ada alasan',
    lockedBy,
    lockedAt: now
  });
  
  await periodRef.update({
    status: MAGANG_STATUS.LOCKED,
    lockHistory,
    updatedAt: now,
    history: [
      ...(period.history || []),
      {
        action: 'locked',
        tanggal: now.split('T')[0],
        catatan: reason,
        oleh: lockedBy
      }
    ]
  });
}

/**
 * Unlock periode magang
 * @param {string} periodId - ID periode
 * @param {string} reason - Alasan unlock
 * @param {string} unlockedBy - UID dosen
 */
async function unlockMagangPeriod(periodId, reason, unlockedBy) {
  const periodRef = db.collection('magangPeriod').doc(periodId);
  const periodDoc = await periodRef.get();
  
  if (!periodDoc.exists) {
    throw new Error('Periode magang tidak ditemukan');
  }
  
  const period = periodDoc.data();
  const now = new Date().toISOString();
  
  const lockHistory = period.lockHistory || [];
  lockHistory.push({
    action: 'unlocked',
    reason: reason || 'Tidak ada alasan',
    unlockedBy,
    unlockedAt: now
  });
  
  await periodRef.update({
    status: MAGANG_STATUS.ACTIVE,
    lockHistory,
    updatedAt: now,
    history: [
      ...(period.history || []),
      {
        action: 'unlocked',
        tanggal: now.split('T')[0],
        catatan: reason,
        oleh: unlockedBy
      }
    ]
  });
}

/**
 * Perpanjang periode magang
 * @param {string} periodId - ID periode
 * @param {string} tanggalSelesaiBaru - Tanggal selesai baru
 * @param {string} catatan - Catatan perpanjangan
 * @param {string} extendedBy - UID dosen
 */
async function extendMagangPeriod(periodId, tanggalSelesaiBaru, catatan, extendedBy) {
  const periodRef = db.collection('magangPeriod').doc(periodId);
  const periodDoc = await periodRef.get();
  
  if (!periodDoc.exists) {
    throw new Error('Periode magang tidak ditemukan');
  }
  
  const period = periodDoc.data();
  const now = new Date().toISOString();
  
  await periodRef.update({
    tanggalSelesai: tanggalSelesaiBaru,
    updatedAt: now,
    history: [
      ...(period.history || []),
      {
        action: 'extended',
        tanggal: now.split('T')[0],
        oldSelesai: period.tanggalSelesai || '-',
        newSelesai: tanggalSelesaiBaru,
        catatan: catatan || `Perpanjangan oleh ${extendedBy}`,
        oleh: extendedBy
      }
    ]
  });
}

module.exports = {
  MAGANG_STATUS,
  createMagangPeriod,
  getMagangPeriodById,
  getMagangPeriodsByMahasiswa,
  getActiveMagangPeriods,
  getCompletedMagangPeriods,
  updatePeriodStatus,
  setNilaiMagang,
  lockMagangPeriod,
  unlockMagangPeriod,
  extendMagangPeriod
};