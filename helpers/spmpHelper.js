const { db } = require('../config/firebaseAdmin');

async function getActiveSpmpPeriod() {
  const now = new Date().toISOString().split('T')[0];
  // 1. Ambil semua periode dengan status 'active'
  const snapshot = await db.collection('spmp_periode')
    .where('status', '==', 'active')
    .get();
  // 2. Filter manual di JavaScript
  const activePeriods = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => p.tanggalMulai <= now && p.tanggalSelesai >= now);
  return activePeriods.length ? activePeriods[0] : null;
}

async function getIndikators(periodeId) {
  const snapshot = await db.collection('spmp_indikator')
    .where('periodeId', '==', periodeId)
    .orderBy('urutan', 'asc')
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getDosenResponse(dosenId, periodeId) {
  const snapshot = await db.collection('spmp_respon')
    .where('dosenId', '==', dosenId)
    .where('periodeId', '==', periodeId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function calculateFinalScore(indikators, responses) {
  let totalBobot = 0;
  let totalWeightedScore = 0;
  for (const ind of indikators) {
    const resp = responses.find(r => r.indikatorId === ind.id);
    const capaian = resp ? parseFloat(resp.capaian) || 0 : 0;
    const target = parseFloat(ind.target) || 1;
    const bobot = parseFloat(ind.bobot) || 0;
    const persentase = target > 0 ? Math.min(100, (capaian / target) * 100) : 0;
    totalBobot += bobot;
    totalWeightedScore += (persentase / 100) * bobot;
  }
  const skor = totalBobot > 0 ? (totalWeightedScore / totalBobot) * 100 : 0;
  return Math.round(skor);
}

module.exports = {
  getActiveSpmpPeriod,
  getIndikators,
  getDosenResponse,
  calculateFinalScore
};