// helpers/nilaiHelper.js
const { db } = require('../config/firebaseAdmin');

/**
 * Mendapatkan atau membuat entri nilai untuk mahasiswa
 * @param {string} mahasiswaId - UID mahasiswa
 * @param {string} mkId - ID mata kuliah
 * @param {string} tugasId - ID tugas
 * @param {string} judulTugas - Judul tugas (untuk display)
 * @param {number} nilai - Nilai yang diberikan
 * @returns {Promise<Object>}
 */
async function saveNilai(mahasiswaId, mkId, tugasId, judulTugas, nilai) {
  const tipeNilai = `tugas_${tugasId}`; // Format unik: tugas_<tugasId>
  
  const existingSnapshot = await db.collection('nilai')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('mkId', '==', mkId)
    .where('tipe', '==', tipeNilai)
    .limit(1)
    .get();
  
  const nilaiAngka = parseFloat(nilai);
  const now = new Date().toISOString();
  
  if (existingSnapshot.empty) {
    const docRef = await db.collection('nilai').add({
      mahasiswaId,
      mkId,
      tipe: tipeNilai,
      judulTugas,
      nilai: nilaiAngka,
      createdAt: now,
      updatedAt: now
    });
    return { id: docRef.id, isNew: true };
  } else {
    const docRef = existingSnapshot.docs[0].ref;
    await docRef.update({
      nilai: nilaiAngka,
      judulTugas,
      updatedAt: now
    });
    return { id: existingSnapshot.docs[0].id, isNew: false };
  }
}

/**
 * Mendapatkan semua nilai untuk suatu mata kuliah
 * @param {string} mkId - ID mata kuliah
 * @returns {Promise<Object>} Map mahasiswaId -> { tugasId: nilai }
 */
async function getNilaiByMkId(mkId) {
  const snapshot = await db.collection('nilai')
    .where('mkId', '==', mkId)
    .get();
  
  const result = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (!result[data.mahasiswaId]) {
      result[data.mahasiswaId] = {};
    }
    // Extract tugasId dari tipe "tugas_<tugasId>"
    const tugasId = data.tipe.replace('tugas_', '');
    result[data.mahasiswaId][tugasId] = {
      nilai: data.nilai,
      judul: data.judulTugas,
      updatedAt: data.updatedAt
    };
  });
  
  return result;
}

/**
 * Mendapatkan semua tugas untuk suatu mata kuliah
 * @param {string} mkId - ID mata kuliah
 * @returns {Promise<Array>} Daftar tugas
 */
async function getTugasByMkId(mkId) {
  const snapshot = await db.collection('tugas')
    .where('mkId', '==', mkId)
    .orderBy('deadline', 'asc')
    .get();
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    judul: doc.data().judul,
    deadline: doc.data().deadline,
    deskripsi: doc.data().deskripsi
  }));
}

/**
 * Mendapatkan nilai untuk satu mahasiswa pada satu tugas
 * @param {string} mahasiswaId - UID mahasiswa
 * @param {string} tugasId - ID tugas
 * @returns {Promise<Object|null>}
 */
async function getNilaiByTugasId(mahasiswaId, tugasId) {
  const tipeNilai = `tugas_${tugasId}`;
  const snapshot = await db.collection('nilai')
    .where('mahasiswaId', '==', mahasiswaId)
    .where('tipe', '==', tipeNilai)
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
}

module.exports = { saveNilai, getNilaiByMkId, getTugasByMkId, getNilaiByTugasId };