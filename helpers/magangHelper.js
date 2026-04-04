// helpers/magangHelper.js
const { db } = require('../config/firebaseAdmin');
const { getActiveMagangPeriods } = require('../models/magangPeriodModel');

/**
 * Cek apakah mahasiswa bisa submit logbook untuk PDK tertentu
 * @param {string} mahasiswaId - UID mahasiswa
 * @param {string} pdkId - ID mata kuliah PDK
 * @returns {Promise<{can: boolean, reason: string, period: Object|null}>}
 */
async function canSubmitLogbook(mahasiswaId, pdkId) {
  try {
    // Cari periode magang aktif untuk PDK ini
    const periodSnapshot = await db.collection('magangPeriod')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('pdkId', '==', pdkId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    
    if (periodSnapshot.empty) {
      return {
        can: false,
        reason: 'Periode magang belum dimulai oleh dosen pembimbing',
        period: null
      };
    }
    
    const period = periodSnapshot.docs[0].data();
    const today = new Date().toISOString().split('T')[0];
    
    // Cek tanggal mulai
    if (period.tanggalMulai && today < period.tanggalMulai) {
      return {
        can: false,
        reason: `Periode magang dimulai pada ${period.tanggalMulai}`,
        period
      };
    }
    
    // Cek tanggal selesai
    if (period.tanggalSelesai && today > period.tanggalSelesai) {
      return {
        can: false,
        reason: `Periode magang telah berakhir pada ${period.tanggalSelesai}. Hubungi dosen untuk perpanjangan.`,
        period
      };
    }
    
    return {
      can: true,
      reason: '',
      period
    };
    
  } catch (error) {
    console.error('Error canSubmitLogbook:', error);
    return {
      can: false,
      reason: 'Terjadi kesalahan sistem',
      period: null
    };
  }
}

/**
 * Mendapatkan PDK yang sedang aktif (berdasarkan KRS dan periode magang)
 * @param {string} userId - UID mahasiswa
 * @returns {Promise<Array>}
 */
async function getActivePdkList(userId) {
  try {
    // Ambil dari enrollment aktif
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();
    
    const pdkList = [];
    
    for (const doc of enrollmentSnapshot.docs) {
      const enrollment = doc.data();
      const mkDoc = await db.collection('mataKuliah').doc(enrollment.mkId).get();
      
      if (mkDoc.exists && mkDoc.data().isPDK === true) {
        pdkList.push({
          id: mkDoc.id,
          kode: mkDoc.data().kode,
          nama: mkDoc.data().nama,
          urutanPDK: mkDoc.data().urutanPDK,
          semester: enrollment.semester
        });
      }
    }
    
    // Urutkan berdasarkan urutan PDK
    pdkList.sort((a, b) => a.urutanPDK - b.urutanPDK);
    
    return pdkList;
    
  } catch (error) {
    console.error('Error getActivePdkList:', error);
    return [];
  }
}

/**
 * Mendapatkan PDK yang sedang aktif periodenya (bisa diisi logbook)
 * @param {string} userId - UID mahasiswa
 * @returns {Promise<Array>}
 */
async function getActivePdkWithPeriod(userId) {
  try {
    const activePeriods = await getActiveMagangPeriods(userId);
    
    const result = [];
    for (const period of activePeriods) {
      const mkDoc = await db.collection('mataKuliah').doc(period.pdkId).get();
      if (mkDoc.exists) {
        result.push({
          ...period,
          kode: mkDoc.data().kode,
          nama: mkDoc.data().nama,
          urutanPDK: mkDoc.data().urutanPDK
        });
      }
    }
    
    result.sort((a, b) => a.urutanPDK - b.urutanPDK);
    return result;
    
  } catch (error) {
    console.error('Error getActivePdkWithPeriod:', error);
    return [];
  }
}

/**
 * Hitung progress magang berdasarkan logbook yang sudah disetujui
 * @param {string} userId - UID mahasiswa
 * @param {string} pdkId - ID PDK
 * @returns {Promise<{total: number, approved: number, percentage: number}>}
 */
async function getMagangProgress(userId, pdkId) {
  try {
    const logbookSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .where('pdkId', '==', pdkId)
      .get();
    
    const total = logbookSnapshot.size;
    const approved = logbookSnapshot.docs.filter(d => d.data().status === 'approved').length;
    
    return {
      total,
      approved,
      percentage: total > 0 ? Math.round((approved / total) * 100) : 0
    };
    
  } catch (error) {
    console.error('Error getMagangProgress:', error);
    return { total: 0, approved: 0, percentage: 0 };
  }
}

/**
 * Format tanggal ke format Indonesia
 * @param {string} dateString - ISO date string
 * @returns {string}
 */
function formatTanggal(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Format nilai huruf dari nilai angka
 * @param {number} nilaiAngka - Nilai angka (0-100)
 * @returns {string}
 */
function getNilaiHuruf(nilaiAngka) {
  if (nilaiAngka >= 85) return 'A';
  if (nilaiAngka >= 75) return 'B';
  if (nilaiAngka >= 65) return 'C';
  if (nilaiAngka >= 50) return 'D';
  return 'E';
}

module.exports = {
  canSubmitLogbook,
  getActivePdkList,
  getActivePdkWithPeriod,
  getMagangProgress,
  formatTanggal,
  getNilaiHuruf
};