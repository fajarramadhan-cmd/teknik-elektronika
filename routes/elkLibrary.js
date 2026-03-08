// routes/elkLibrary.js
const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

router.get('/', async (req, res) => {
  try {
    const { search, tahun, pembimbing, type, page = 1 } = req.query;
    const limit = 9; // jumlah item per halaman
    const currentPage = parseInt(page) || 1;

    // Ambil laporan magang yang sudah disetujui
    let laporanQuery = db.collection('laporanMagang')
      .where('status', '==', 'approved')
      .orderBy('approvedAt', 'desc');

    const laporanSnapshot = await laporanQuery.get();
    let laporanList = laporanSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      _type: 'laporan'
    }));

    // Ambil artikel dosen yang sudah disetujui
    let artikelQuery = db.collection('artikelDosen')
      .where('status', '==', 'approved')
      .orderBy('createdAt', 'desc');

    const artikelSnapshot = await artikelQuery.get();
    let artikelList = artikelSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      _type: 'artikel'
    }));

    // Gabungkan
    let allItems = [...laporanList, ...artikelList];

    // Filter berdasarkan search (manual)
    if (search) {
      const lowerSearch = search.toLowerCase();
      allItems = allItems.filter(item =>
        (item.judulPublik || item.title || '').toLowerCase().includes(lowerSearch) ||
        (item.nama || '').toLowerCase().includes(lowerSearch) ||
        (item.abstrak || '').toLowerCase().includes(lowerSearch)
      );
    }

    // Filter berdasarkan tahun
    if (tahun) {
      allItems = allItems.filter(item => item.tahun == tahun);
    }

    // Filter berdasarkan pembimbing (untuk laporan)
    if (pembimbing) {
      const lowerPembimbing = pembimbing.toLowerCase();
      allItems = allItems.filter(item =>
        item._type === 'laporan' && item.pembimbing && item.pembimbing.toLowerCase().includes(lowerPembimbing)
      );
    }

    // Filter berdasarkan tipe
    if (type && type !== 'all') {
      allItems = allItems.filter(item => item._type === type);
    }

    // Urutkan berdasarkan tanggal (desc)
    allItems.sort((a, b) => {
      const dateA = a.approvedAt || a.createdAt;
      const dateB = b.approvedAt || b.createdAt;
      return new Date(dateB) - new Date(dateA);
    });

    // Hitung total items dan pagination
    const totalItems = allItems.length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (currentPage - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedItems = allItems.slice(startIndex, endIndex);

    // Ambil daftar tahun unik untuk filter
    const tahunSet = new Set();
    allItems.forEach(item => {
      if (item.tahun) tahunSet.add(item.tahun);
    });
    const tahunList = Array.from(tahunSet).sort().reverse();

    res.render('elkLibrary/index', {
      title: 'ELK Library',
      items: paginatedItems,
      filters: { search, tahun, pembimbing, type: type || 'all' },
      tahunList,
      currentPage,
      totalPages
    });
  } catch (error) {
    console.error('Error ELK Library:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat ELK Library' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    // Coba cari di laporanMagang dulu
    let doc = await db.collection('laporanMagang').doc(req.params.id).get();
    let type = 'laporan';
    if (!doc.exists) {
      doc = await db.collection('artikelDosen').doc(req.params.id).get();
      type = 'artikel';
    }
    if (!doc.exists) return res.status(404).send('Item tidak ditemukan');
    const item = { id: doc.id, ...doc.data(), _type: type };

    // Increment views
    await doc.ref.update({ views: (item.views || 0) + 1 });

    res.render('elkLibrary/detail', {
      title: item.judulPublik || item.title || 'Detail',
      item
    });
  } catch (error) {
    console.error('Error detail:', error);
    res.status(500).send('Gagal memuat detail');
  }
});

module.exports = router;