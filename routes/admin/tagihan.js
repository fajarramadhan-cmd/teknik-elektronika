/**
 * routes/admin/tagihan.js
 * Admin: Mengelola tagihan mahasiswa (daftar, detail, edit, hapus)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// Helper: mendapatkan angkatan dari NIM
function getAngkatanFromNim(nim) {
  if (!nim || nim.length < 2) return null;
  return '20' + nim.substring(0, 2);
}

// GET /admin/tagihan - Daftar mahasiswa dan ringkasan tagihan
router.get('/', async (req, res) => {
  try {
    const { angkatan, search } = req.query;

    // Ambil semua mahasiswa
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nama')
      .get();

    let mahasiswaList = [];
    for (const doc of mahasiswaSnapshot.docs) {
      const data = doc.data();
      const nim = data.nim || '';
      const angkatanMhs = getAngkatanFromNim(nim);

      // Filter berdasarkan angkatan
      if (angkatan && angkatanMhs !== angkatan) continue;

      // Filter berdasarkan search (nim atau nama)
      if (search) {
        const searchLower = search.toLowerCase();
        const nimMatch = nim.toLowerCase().includes(searchLower);
        const namaMatch = (data.nama || '').toLowerCase().includes(searchLower);
        if (!nimMatch && !namaMatch) continue;
      }

      // Ambil data tagihan mahasiswa
      const tagihanDoc = await db.collection('tagihan').doc(doc.id).get();
      let totalBelumLunas = 0;
      let tagihanCount = 0;
      if (tagihanDoc.exists) {
        const tagihan = tagihanDoc.data().semester || [];
        tagihanCount = tagihan.length;
        tagihan.forEach(t => {
          if (t.status !== 'lunas') {
            totalBelumLunas += t.jumlah || 0;
          }
        });
      }

      mahasiswaList.push({
        id: doc.id,
        nim,
        nama: data.nama || '-',
        tagihanCount,
        totalBelumLunas
      });
    }

    // Ambil daftar angkatan unik untuk dropdown filter
    const angkatanSet = new Set();
    mahasiswaSnapshot.docs.forEach(doc => {
      const nim = doc.data().nim;
      if (nim) {
        const ang = getAngkatanFromNim(nim);
        if (ang) angkatanSet.add(ang);
      }
    });
    const angkatanList = Array.from(angkatanSet).sort().reverse();

    res.render('admin/tagihan_list', {
      title: 'Kelola Tagihan Mahasiswa',
      mahasiswaList,
      angkatanList,
      filters: { angkatan: angkatan || '', search: search || '' }
    });
  } catch (error) {
    console.error('Error memuat daftar tagihan:', error);
    res.status(500).render('error', { message: 'Gagal memuat daftar tagihan' });
  }
});

// GET /admin/tagihan/mahasiswa/:id - Detail tagihan per mahasiswa
router.get('/mahasiswa/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).render('error', { message: 'Mahasiswa tidak ditemukan' });
    }
    const mahasiswa = { id: userId, ...userDoc.data() };

    const tagihanDoc = await db.collection('tagihan').doc(userId).get();
    const tagihan = tagihanDoc.exists ? tagihanDoc.data().semester || [] : [];

    res.render('admin/tagihan_detail', {
      title: `Tagihan - ${mahasiswa.nama}`,
      mahasiswa,
      tagihan
    });
  } catch (error) {
    console.error('Error detail tagihan:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail tagihan' });
  }
});

// GET /admin/tagihan/mahasiswa/:id/tambah - Form tambah tagihan baru
router.get('/mahasiswa/:id/tambah', async (req, res) => {
  try {
    const userId = req.params.id;
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).render('error', { message: 'Mahasiswa tidak ditemukan' });
    }
    const mahasiswa = { id: userId, ...userDoc.data() };

    res.render('admin/tagihan_form', {
      title: 'Tambah Tagihan',
      mahasiswa,
      tagihan: null
    });
  } catch (error) {
    console.error('Error load form tambah:', error);
    res.status(500).render('error', { message: 'Gagal memuat form' });
  }
});

// POST /admin/tagihan/mahasiswa/:id/tambah - Simpan tagihan baru
router.post('/mahasiswa/:id/tambah', async (req, res) => {
  try {
    const userId = req.params.id;
    const { semester, jumlah, jatuhTempo } = req.body;

    if (!semester || !jumlah) {
      return res.status(400).send('Semester dan jumlah wajib diisi');
    }

    const tagihanRef = db.collection('tagihan').doc(userId);
    const tagihanDoc = await tagihanRef.get();

    const newTagihan = {
      semester,
      jumlah: parseFloat(jumlah),
      jatuhTempo: jatuhTempo || null,
      status: 'belum lunas'
    };

    if (tagihanDoc.exists) {
      const data = tagihanDoc.data();
      const semesterList = data.semester || [];
      semesterList.push(newTagihan);
      await tagihanRef.update({ semester: semesterList });
    } else {
      await tagihanRef.set({ semester: [newTagihan] });
    }

    res.redirect(`/admin/tagihan/mahasiswa/${userId}`);
  } catch (error) {
    console.error('Error tambah tagihan:', error);
    res.status(500).send('Gagal menambah tagihan');
  }
});

// GET /admin/tagihan/edit/:id - Form edit tagihan (per item semester)
// (Ini bisa dikembangkan lebih lanjut, misalnya dengan mengirim index)
router.get('/edit/:userId/:index', async (req, res) => {
  try {
    const { userId, index } = req.params;
    const tagihanDoc = await db.collection('tagihan').doc(userId).get();
    if (!tagihanDoc.exists) {
      return res.status(404).send('Data tagihan tidak ditemukan');
    }
    const semesterList = tagihanDoc.data().semester || [];
    const tagihan = semesterList[parseInt(index)];
    if (!tagihan) {
      return res.status(404).send('Tagihan tidak ditemukan');
    }

    const userDoc = await db.collection('users').doc(userId).get();
    const mahasiswa = userDoc.exists ? { id: userId, ...userDoc.data() } : { nama: 'Unknown' };

    res.render('admin/tagihan_form', {
      title: 'Edit Tagihan',
      mahasiswa,
      tagihan,
      index
    });
  } catch (error) {
    console.error('Error load edit:', error);
    res.status(500).send('Gagal memuat form edit');
  }
});

// POST /admin/tagihan/update/:userId/:index - Update tagihan
router.post('/update/:userId/:index', async (req, res) => {
  try {
    const { userId, index } = req.params;
    const { semester, jumlah, jatuhTempo, status } = req.body;

    const tagihanRef = db.collection('tagihan').doc(userId);
    const tagihanDoc = await tagihanRef.get();
    if (!tagihanDoc.exists) {
      return res.status(404).send('Data tagihan tidak ditemukan');
    }

    const semesterList = tagihanDoc.data().semester || [];
    if (!semesterList[parseInt(index)]) {
      return res.status(404).send('Tagihan tidak ditemukan');
    }

    semesterList[parseInt(index)] = {
      semester,
      jumlah: parseFloat(jumlah),
      jatuhTempo: jatuhTempo || null,
      status: status || 'belum lunas'
    };

    await tagihanRef.update({ semester: semesterList });
    res.redirect(`/admin/tagihan/mahasiswa/${userId}`);
  } catch (error) {
    console.error('Error update tagihan:', error);
    res.status(500).send('Gagal update tagihan');
  }
});

// POST /admin/tagihan/delete/:userId/:index - Hapus tagihan
router.post('/delete/:userId/:index', async (req, res) => {
  try {
    const { userId, index } = req.params;
    const tagihanRef = db.collection('tagihan').doc(userId);
    const tagihanDoc = await tagihanRef.get();
    if (!tagihanDoc.exists) {
      return res.status(404).send('Data tagihan tidak ditemukan');
    }

    const semesterList = tagihanDoc.data().semester || [];
    if (!semesterList[parseInt(index)]) {
      return res.status(404).send('Tagihan tidak ditemukan');
    }

    semesterList.splice(parseInt(index), 1);
    await tagihanRef.update({ semester: semesterList });
    res.redirect(`/admin/tagihan/mahasiswa/${userId}`);
  } catch (error) {
    console.error('Error hapus tagihan:', error);
    res.status(500).send('Gagal hapus tagihan');
  }
});

module.exports = router;