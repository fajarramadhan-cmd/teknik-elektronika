const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');

router.use(verifyToken);
router.use(isDosen);

// Helper untuk generate kode validasi
function generateKodeValidasi() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ELK${timestamp}${random}`;
}

// ============================================================================
// DAFTAR SURAT
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('surat_dosen')
      .where('dosenId', '==', req.dosen.id)
      .orderBy('createdAt', 'desc')
      .get();
    const suratList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('dosen/persuratan/index', {
      title: 'Daftar Pengajuan Surat',
      suratList,
      dosen: req.dosen
    });
  } catch (error) {
    console.error('Error ambil surat dosen:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data surat' });
  }
});

// ============================================================================
// FORM PENGAJUAN SURAT
// ============================================================================
router.get('/ajukan', (req, res) => {
  const currentSemester = getCurrentAcademicSemester();
  res.render('dosen/persuratan/ajukan', {
    title: 'Ajukan Surat',
    dosen: req.dosen,
    semester: currentSemester.label,
    tahunAkademik: currentSemester.tahunAkademik
  });
});

// ============================================================================
// PROSES PENGAJUAN SURAT
// ============================================================================
router.post('/ajukan', async (req, res) => {
  try {
    const { jenisSurat, tujuan, keperluan, isiLain } = req.body;
    if (!jenisSurat || !keperluan) {
      return res.status(400).send('Jenis surat dan keperluan harus diisi');
    }
    const current = getCurrentAcademicSemester();
    const kodeValidasi = generateKodeValidasi();
    await db.collection('surat_dosen').add({
      dosenId: req.dosen.id,
      dosenNama: req.dosen.nama,
      nip: req.dosen.nip,
      email: req.dosen.email,
      jenisSurat,
      tujuan: tujuan || '',
      keperluan,
      isiLain: isiLain || '',
      kodeValidasi,
      status: 'pending',
      semester: current.label,
      tahunAkademik: current.tahunAkademik,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ status: 'pending', timestamp: new Date().toISOString(), catatan: 'Pengajuan surat diterima' }]
    });
    res.redirect('/dosen/surat');
  } catch (error) {
    console.error('Error ajukan surat:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal mengajukan surat' });
  }
});

// ============================================================================
// DETAIL SURAT
// ============================================================================
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('surat_dosen').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Surat tidak ditemukan' });
    }
    const surat = { id: doc.id, ...doc.data() };
    if (surat.dosenId !== req.dosen.id) {
      return res.status(403).render('error', { title: 'Akses Ditolak', message: 'Anda tidak memiliki akses ke surat ini' });
    }
    res.render('dosen/persuratan/detail', {
      title: 'Detail Surat',
      surat,
      dosen: req.dosen
    });
  } catch (error) {
    console.error('Error detail surat:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail surat' });
  }
});

// ============================================================================
// BATALKAN PENGAJUAN
// ============================================================================
router.post('/:id/batal', async (req, res) => {
  try {
    const docRef = db.collection('surat_dosen').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = doc.data();
    if (surat.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');
    if (surat.status !== 'pending') return res.status(400).send('Hanya surat pending yang dapat dibatalkan');
    await docRef.update({
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
      history: [...(surat.history || []), { status: 'cancelled', timestamp: new Date().toISOString(), catatan: 'Dibatalkan oleh dosen' }]
    });
    res.redirect('/dosen/surat');
  } catch (error) {
    console.error('Error batalkan surat:', error);
    res.status(500).send('Gagal membatalkan surat');
  }
});

// ============================================================================
// DOWNLOAD SURAT (jika sudah diupload admin)
// ============================================================================
router.get('/:id/download', async (req, res) => {
  try {
    const doc = await db.collection('surat_dosen').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = doc.data();
    if (surat.dosenId !== req.dosen.id) return res.status(403).send('Akses ditolak');
    if (surat.status !== 'completed' || !surat.fileUrl) {
      return res.status(400).send('Surat belum tersedia');
    }
    res.redirect(surat.fileUrl);
  } catch (error) {
    console.error('Error download surat:', error);
    res.status(500).send('Gagal mengunduh surat');
  }
});

module.exports = router;