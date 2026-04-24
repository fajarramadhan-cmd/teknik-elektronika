const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

const ITEMS_PER_PAGE = 9;

router.get('/', async (req, res) => {
  try {
    const { search, tahun, pembimbing, type, page = 1 } = req.query;
    const currentPage = parseInt(page) || 1;

    // Ambil laporan magang yang sudah disetujui
    const laporanSnapshot = await db.collection('laporanMagang')
      .where('status', '==', 'approved')
      .orderBy('approvedAt', 'desc')
      .get();
    const laporanList = laporanSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        _type: 'laporan',
        tahun: data.tahun || null,
        judulPencarian: data.judulPublik || data.title || '',
        penulisPencarian: data.nama || data.penulis || '',
        abstrakPencarian: data.abstrak || data.abstract || ''
      };
    });

    // Ambil artikel dosen yang sudah disetujui
    const artikelSnapshot = await db.collection('artikelDosen')
      .where('status', '==', 'approved')
      .orderBy('createdAt', 'desc')
      .get();
    const artikelList = artikelSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        _type: 'artikel',
        tahun: data.publicationYear || null,
        judulPencarian: data.title || '',
        penulisPencarian: data.penulis || (data.authors ? data.authors.join(', ') : ''),
        abstrakPencarian: data.abstrak || data.abstract || ''
      };
    });

    // === HITUNG STATISTIK GLOBAL (sebelum filtering) ===
    const totalLaporanGlobal = laporanList.length;
    const totalArtikelGlobal = artikelList.length;
    const totalItemsGlobal = totalLaporanGlobal + totalArtikelGlobal;

    // Gabungkan untuk keperluan filter & pagination
    let allItems = [...laporanList, ...artikelList];

    // Filter berdasarkan search
    if (search && search.trim() !== '') {
      const lowerSearch = search.toLowerCase();
      allItems = allItems.filter(item => 
        item.judulPencarian.toLowerCase().includes(lowerSearch) ||
        item.penulisPencarian.toLowerCase().includes(lowerSearch) ||
        item.abstrakPencarian.toLowerCase().includes(lowerSearch)
      );
    }
    if (tahun && tahun.trim() !== '') {
      const tahunNum = parseInt(tahun);
      allItems = allItems.filter(item => item.tahun === tahunNum);
    }
    if (pembimbing && pembimbing.trim() !== '') {
      const lowerPembimbing = pembimbing.toLowerCase();
      allItems = allItems.filter(item => 
        item._type === 'laporan' && 
        item.pembimbing && 
        item.pembimbing.toLowerCase().includes(lowerPembimbing)
      );
    }
    if (type && type !== 'all') {
      allItems = allItems.filter(item => item._type === type);
    }

    // Urutkan berdasarkan tanggal
    allItems.sort((a, b) => {
      const dateA = a.approvedAt || a.createdAt || a.uploadedAt;
      const dateB = b.approvedAt || b.createdAt || b.uploadedAt;
      return (dateB || '').localeCompare(dateA || '');
    });

    // Pagination
    const totalItemsFiltered = allItems.length;
    const totalPages = Math.ceil(totalItemsFiltered / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedItems = allItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    // Daftar tahun unik (untuk filter dropdown)
    const tahunSet = new Set();
    laporanList.forEach(item => { if (item.tahun) tahunSet.add(item.tahun); });
    artikelList.forEach(item => { if (item.tahun) tahunSet.add(item.tahun); });
    const tahunList = Array.from(tahunSet).sort((a, b) => b - a);

    // Hapus field sementara
    const itemsForView = paginatedItems.map(item => {
      const { judulPencarian, penulisPencarian, abstrakPencarian, ...rest } = item;
      return rest;
    });

    res.render('elkLibrary/index', {
      title: 'ELK Library',
      items: itemsForView,
      filters: {
        search: search || '',
        tahun: tahun || '',
        pembimbing: pembimbing || '',
        type: type || 'all'
      },
      tahunList,
      currentPage,
      totalPages,
      // Kirim statistik global (total semua laporan & artikel yang disetujui)
      totalItems: totalItemsGlobal,
      totalLaporan: totalLaporanGlobal,
      totalArtikel: totalArtikelGlobal
    });
  } catch (error) {
    console.error('Error ELK Library:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat ELK Library' 
    });
  }
});

// ... route /:id (tidak berubah)
module.exports = router;