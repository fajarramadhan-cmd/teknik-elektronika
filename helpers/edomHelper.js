// helpers/edomHelper.js
const { db } = require('../config/firebaseAdmin');
const { getCurrentAcademicSemester } = require('./academicHelper');

/**
 * Mendapatkan periode edom yang aktif berdasarkan tanggal dan status
 */
async function getActiveEdomPeriod() {
  const now = new Date().toISOString().split('T')[0];
  const snapshot = await db.collection('edom_periode')
    .where('status', '==', 'active')
    .where('tanggalMulai', '<=', now)
    .where('tanggalSelesai', '>=', now)
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

/**
 * Mendapatkan semua pertanyaan aktif (urut berdasarkan urutan)
 */
async function getActiveQuestions() {
  const snapshot = await db.collection('edom_kuisioner')
    .where('aktif', '==', true)
    .orderBy('urutan', 'asc')
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Cek apakah mahasiswa sudah mengisi edom untuk MK tertentu di periode tertentu
 */
async function hasFilledEdom(mahasiswaId, mkId, periodeId) {
  const snapshot = await db.collection('edom_respon')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('mkId', '==', mkId)
    .where('periodeId', '==', periodeId)
    .limit(1)
    .get();
  return !snapshot.empty;
}

/**
 * Hitung rata-rata nilai dari array jawaban
 */
function calculateAverage(answers) {
  if (!answers.length) return 0;
  const sum = answers.reduce((acc, a) => acc + a.nilai, 0);
  return sum / answers.length;
}

module.exports = {
  getActiveEdomPeriod,
  getActiveQuestions,
  hasFilledEdom,
  calculateAverage
};