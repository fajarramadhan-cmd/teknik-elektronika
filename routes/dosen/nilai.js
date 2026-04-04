// routes/dosen/nilai.js

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const { getNilaiByMkId, getTugasByMkId } = require('../../helpers/nilaiHelper');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getMahasiswaById(uid) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      return { id: uid, ...userDoc.data() };
    }
    return { id: uid, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswaById:', error);
    return { id: uid, nama: 'Error', nim: '-' };
  }
}

// ============================================================================
// DAFTAR MATA KULIAH
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .orderBy('semester', 'desc')
      .orderBy('kode')
      .get();
    
    const mkList = [];
    for (const doc of mkSnapshot.docs) {
      const mk = { id: doc.id, ...doc.data() };
      
      const enrollmentSnapshot = await db.collection('enrollment')
        .where('mkId', '==', doc.id)
        .where('status', '==', 'active')
        .get();
      mk.jumlahMahasiswa = enrollmentSnapshot.size;
      
      mkList.push(mk);
    }

    res.render('dosen/nilai_pilih_mk', {
      title: 'Rekap Nilai - Pilih Mata Kuliah',
      mkList
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', { 
      title: 'Error',
      message: 'Gagal mengambil data mata kuliah' 
    });
  }
});

// ============================================================================
// REKAP NILAI PER MATA KULIAH (YANG SUDAH DISINKRONKAN)
// ============================================================================

router.get('/:mkId', async (req, res) => {
  try {
    const { mkId } = req.params;

    // 1. Ambil data MK
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }
    const mk = { id: mkDoc.id, ...mkDoc.data() };

    // 2. Ambil semua mahasiswa yang terdaftar
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .get();
    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().userId);

    // 3. ✅ Ambil data nilai menggunakan helper
    const nilaiMap = await getNilaiByMkId(mkId);
    
    // 4. ✅ Ambil daftar tugas menggunakan helper
    const tugasList = await getTugasByMkId(mkId);

    // 5. Kumpulkan data lengkap
    const data = [];
    for (const uid of mahasiswaIds) {
      const mahasiswa = await getMahasiswaById(uid);
      const nilaiMahasiswa = nilaiMap[uid] || {};
      
      // Buat object nilai untuk setiap tugas
      const nilaiPerTugas = {};
      for (const tugas of tugasList) {
        const nilaiData = nilaiMahasiswa[tugas.id];
        nilaiPerTugas[tugas.id] = {
          nilai: nilaiData?.nilai || '-',
          judul: nilaiData?.judul || tugas.judul,
          updatedAt: nilaiData?.updatedAt || null
        };
      }
      
      data.push({ 
        mahasiswa, 
        nilai: nilaiPerTugas,
        id: uid
      });
    }

    // Urutkan berdasarkan NIM
    data.sort((a, b) => a.mahasiswa.nim.localeCompare(b.mahasiswa.nim));

    res.render('dosen/nilai_rekap', {
      title: `Rekap Nilai - ${mk.kode} ${mk.nama}`,
      mk,
      data,
      tugasList  // Kirim ke view untuk header tabel
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal mengambil rekap nilai: ' + error.message
    });
  }
});

// ============================================================================
// INPUT NILAI (ALTERNATIF LANGSUNG DARI REKAP)
// ============================================================================

router.post('/input', async (req, res) => {
  try {
    const { mkId, mahasiswaId, tugasId, nilai } = req.body;
    
    const { saveNilai } = require('../../helpers/nilaiHelper');
    
    // Ambil judul tugas
    const tugasDoc = await db.collection('tugas').doc(tugasId).get();
    if (!tugasDoc.exists) {
      return res.status(404).json({ success: false, message: 'Tugas tidak ditemukan' });
    }
    const judulTugas = tugasDoc.data().judul;
    
    await saveNilai(mahasiswaId, mkId, tugasId, judulTugas, nilai);
    
    res.redirect(`/dosen/nilai/${mkId}`);
  } catch (error) {
    console.error('Error input nilai:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menyimpan nilai: ' + error.message 
    });
  }
});

// ============================================================================
// EKSPOR NILAI KE CSV
// ============================================================================

router.get('/:mkId/export', async (req, res) => {
  try {
    const { mkId } = req.params;
    
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }
    const mk = mkDoc.data();

    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .get();
    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().userId);

    const nilaiMap = await getNilaiByMkId(mkId);
    const tugasList = await getTugasByMkId(mkId);

    // Buat baris CSV
    const rows = [];
    for (const uid of mahasiswaIds) {
      const mahasiswa = await getMahasiswaById(uid);
      const nilaiMahasiswa = nilaiMap[uid] || {};
      
      const row = {
        nim: mahasiswa.nim,
        nama: mahasiswa.nama
      };
      
      for (const tugas of tugasList) {
        const nilaiData = nilaiMahasiswa[tugas.id];
        row[`tugas_${tugas.id}`] = nilaiData?.nilai || '';
      }
      
      rows.push(row);
    }

    // Header CSV
    const headers = ['NIM', 'Nama', ...tugasList.map(t => t.judul)];
    
    const csvRows = [
      headers.join(','),
      ...rows.map(row => 
        headers.map(h => {
          if (h === 'NIM') return row.nim;
          if (h === 'Nama') return row.nama;
          return row[`tugas_${h}`] || '';
        }).join(',')
      )
    ];
    
    const csvString = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nilai_${mk.kode}_${Date.now()}.csv"`);
    res.send('\uFEFF' + csvString); // BOM untuk UTF-8
  } catch (error) {
    console.error('Error export nilai:', error);
    res.status(500).send('Gagal mengekspor nilai');
  }
});

module.exports = router;