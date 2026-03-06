/**
 * routes/dosen/mk.js
 * Daftar dan detail mata kuliah yang diampu oleh dosen
 * Dilengkapi dengan upload materi per pertemuan ke Google Drive
 * dan daftar mahasiswa per mata kuliah
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

console.log('mk.js loaded');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU (HELPER)
// ============================================================================

/**
 * Menghapus properti dengan nilai undefined dari objek (untuk Firestore)
 */
function removeUndefined(obj) {
  Object.keys(obj).forEach(key => obj[key] === undefined && delete obj[key]);
  return obj;
}

/**
 * Mendapatkan folder materi mata kuliah di Google Drive.
 * Membuat folder jika belum ada.
 */
async function getMateriFolderId() {
  const folderName = 'Materi_MK';
  const query = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    return folder.data.id;
  }
}

// ============================================================================
// DAFTAR MATA KULIAH YANG DIAMPU
// ============================================================================

/**
 * GET /dosen/mk
 * Menampilkan daftar mata kuliah yang diampu
 */
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .orderBy('semester', 'desc')
      .orderBy('kode')
      .get();

    const mkList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();

      // Hitung jumlah mahasiswa terdaftar aktif di MK ini
      let jumlahMahasiswa = 0;
      try {
        const enrollmentSnapshot = await db.collection('enrollment')
          .where('mkId', '==', doc.id)
          .where('status', '==', 'active')
          .count()
          .get();
        jumlahMahasiswa = enrollmentSnapshot.data().count;
      } catch (err) {
        console.error(`Gagal hitung enrollment untuk MK ${doc.id}:`, err);
      }

      // Hitung progress perkuliahan (dari materi)
      const materi = data.materi || [];
      const terlaksana = materi.filter(m => m.status === 'selesai').length;
      const progress = Math.round((terlaksana / 16) * 100) || 0;

      mkList.push({
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        semester: data.semester,
        sks: data.sks,
        jumlahMahasiswa,
        progress
      });
    }

    res.render('dosen/mk_list', {
      title: 'Mata Kuliah Saya',
      mkList
    });
  } catch (error) {
    console.error('Error ambil mk:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal mengambil data MK'
    });
  }
});

// ============================================================================
// DAFTAR MAHASISWA PER MATA KULIAH
// ============================================================================

/**
 * GET /dosen/mk/:id/mahasiswa
 * Menampilkan daftar mahasiswa yang mengambil mata kuliah tertentu
 */
router.get('/:id/mahasiswa', async (req, res) => {
  try {
    const mkId = req.params.id;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mata kuliah tidak ditemukan'
      });
    }
    const mk = { id: mkId, ...mkDoc.data() };

    // Cek apakah dosen ini mengampu MK tersebut
    if (!mk.dosenIds || !mk.dosenIds.includes(req.dosen.id)) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki akses ke mata kuliah ini'
      });
    }

    // Ambil enrollment aktif untuk MK ini
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .get();

    const mahasiswaIds = enrollmentSnapshot.docs
      .map(doc => doc.data().userId)
      .filter(uid => uid && typeof uid === 'string' && uid.trim() !== '');

    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        mahasiswaList.push({
          id: uid,
          nama: userDoc.data().nama,
          nim: userDoc.data().nim,
          foto: userDoc.data().foto
        });
      }
    }

    // Urutkan berdasarkan NIM
    mahasiswaList.sort((a, b) => a.nim.localeCompare(b.nim));

    res.render('dosen/mk_mahasiswa', {
      title: `Mahasiswa - ${mk.kode} ${mk.nama}`,
      mk,
      mahasiswaList
    });
  } catch (error) {
    console.error('Error ambil mahasiswa per MK:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat daftar mahasiswa'
    });
  }
});

// ============================================================================
// UPDATE PERTEMUAN (dengan upload file)
// ============================================================================

/**
 * POST /dosen/mk/:id/pertemuan/:pertemuan
 * Update data satu pertemuan, termasuk upload materi ke Google Drive
 */
router.post('/:id/pertemuan/:pertemuan', upload.single('file'), async (req, res) => {
  try {
    const { topik, tanggal, catatan, status } = req.body;
    const file = req.file;
    const mkRef = db.collection('mataKuliah').doc(req.params.id);
    const mkDoc = await mkRef.get();

    if (!mkDoc.exists) {
      return res.status(404).send('MK tidak ditemukan');
    }

    // Cek apakah dosen ini berhak mengedit MK tersebut
    const mkData = mkDoc.data();
    if (!mkData.dosenIds || !mkData.dosenIds.includes(req.dosen.id)) {
      return res.status(403).send('Anda tidak berhak mengedit MK ini');
    }

    let materi = mkData.materi || [];
    const idx = materi.findIndex(m => m.pertemuan == req.params.pertemuan);

    // Ambil data lama jika ada
    const old = idx !== -1 ? materi[idx] : {};

    // Siapkan data update, pastikan tidak ada undefined
    const updated = {
      pertemuan: parseInt(req.params.pertemuan),
      updatedAt: new Date().toISOString()
    };

    // Hanya set field jika ada nilai baru (atau gunakan nilai lama)
    if (topik !== undefined) updated.topik = topik;
    else if (old.topik) updated.topik = old.topik;
    else updated.topik = `Pertemuan ${req.params.pertemuan}`;

    if (tanggal !== undefined) updated.tanggal = tanggal;
    else if (old.tanggal) updated.tanggal = old.tanggal;
    else updated.tanggal = null;

    if (status !== undefined) updated.status = status;
    else if (old.status) updated.status = old.status;
    else updated.status = (tanggal ? 'selesai' : 'belum');

    if (catatan !== undefined) updated.catatan = catatan;
    else if (old.catatan) updated.catatan = old.catatan;
    else updated.catatan = '';

    // Proses file jika ada
    if (file) {
      try {
        const folderId = await getMateriFolderId();
        const fileName = `MK_${mkData.kode}_Pertemuan_${req.params.pertemuan}_${Date.now()}.pdf`;
        const fileMetadata = { name: fileName, parents: [folderId] };
        const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
        const response = await drive.files.create({
          resource: fileMetadata,
          media,
          fields: 'id, webViewLink'
        });
        // Set permission publik
        await drive.permissions.create({
          fileId: response.data.id,
          requestBody: { role: 'reader', type: 'anyone' }
        });
        updated.fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      } catch (uploadError) {
        console.error('Gagal upload file ke Drive:', uploadError);
        return res.status(500).send('Gagal mengupload file. Pastikan konfigurasi Drive benar.');
      }
    } else {
      // Jika tidak ada file baru, pertahankan file lama
      if (old.fileUrl) updated.fileUrl = old.fileUrl;
    }

    // Hapus properti undefined (jaga-jaga)
    removeUndefined(updated);

    // Update atau tambahkan ke array materi
    if (idx !== -1) {
      materi[idx] = { ...materi[idx], ...updated };
    } else {
      materi.push(updated);
    }

    // Urutkan berdasarkan pertemuan
    materi.sort((a, b) => a.pertemuan - b.pertemuan);

    // Simpan ke Firestore
    await mkRef.update({
      materi,
      updatedAt: new Date().toISOString()
    });

    res.redirect(`/dosen/mk/${req.params.id}`);
  } catch (error) {
    console.error('Error update pertemuan:', error);
    res.status(500).send('Gagal update pertemuan');
  }
});

// ============================================================================
// DETAIL MATA KULIAH
// ============================================================================

/**
 * GET /dosen/mk/:id
 * Detail mata kuliah (RPS, pertemuan, daftar mahasiswa)
 */
router.get('/:id', async (req, res) => {
  try {
    const mkDoc = await db.collection('mataKuliah').doc(req.params.id).get();
    if (!mkDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mata kuliah tidak ditemukan'
      });
    }
    const mk = { id: mkDoc.id, ...mkDoc.data() };

    // Cek apakah dosen ini benar mengampu MK tersebut
    if (!mk.dosenIds || !mk.dosenIds.includes(req.dosen.id)) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki akses ke mata kuliah ini'
      });
    }

    // ===== AMBIL DAFTAR MAHASISWA DARI ENROLLMENT =====
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', req.params.id)
      .where('status', '==', 'active')
      .get();

    const mahasiswaIds = enrollmentSnapshot.docs
      .map(doc => doc.data().userId)
      .filter(uid => uid && typeof uid === 'string' && uid.trim() !== '');

    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        mahasiswaList.push({
          id: uid,
          nama: userDoc.data().nama,
          nim: userDoc.data().nim,
          foto: userDoc.data().foto
        });
      }
    }

    // ===== PERTEMUAN (dari materi MK) =====
    const materi = mk.materi || [];
    const pertemuanList = [];
    for (let i = 1; i <= 16; i++) {
      const existing = materi.find(m => m.pertemuan === i) || {};
      pertemuanList.push({
        pertemuan: i,
        topik: existing.topik || `Pertemuan ${i}`,
        tanggal: existing.tanggal || null,
        status: existing.status || 'belum',
        catatan: existing.catatan || '',
        fileUrl: existing.fileUrl || null  // konsisten gunakan fileUrl
      });
    }

    // Hitung progress perkuliahan
    const terlaksana = pertemuanList.filter(p => p.status === 'selesai').length;
    const persentase = Math.round((terlaksana / 16) * 100);

    // ===== DOSEN PENGAMPU =====
    const dosenList = [];
    if (mk.dosenIds && mk.dosenIds.length > 0) {
      for (const dId of mk.dosenIds) {
        const dDoc = await db.collection('dosen').doc(dId).get();
        if (dDoc.exists) {
          dosenList.push(dDoc.data().nama);
        }
      }
    }

    // ===== TUGAS (opsional) =====
    let tugasList = [];
    try {
      const tugasSnapshot = await db.collection('tugas')
        .where('mkId', '==', req.params.id)
        .orderBy('deadline', 'asc')
        .get();
      tugasList = tugasSnapshot.docs.map(doc => ({
        id: doc.id,
        judul: doc.data().judul,
        deadline: doc.data().deadline,
        tipe: doc.data().tipe
      }));
    } catch (err) {
      console.error('Gagal mengambil tugas (mungkin perlu indeks):', err.message);
      // biarkan tugasList kosong
    }

    res.render('dosen/mk_detail', {
      title: `${mk.kode} - ${mk.nama}`,
      mk,
      mahasiswaList,
      pertemuanList,
      dosenList,
      terlaksana,
      persentase,
      tugasList
    });
  } catch (error) {
    console.error('Error detail mk:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail MK'
    });
  }
});

module.exports = router;