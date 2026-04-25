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

    // Ambil penelitian dosen yang sudah disetujui
    const penelitianSnapshot = await db.collection('penelitian')
      .where('status', '==', 'approved')
      .orderBy('createdAt', 'desc')
      .get();
    const penelitianList = penelitianSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        _type: 'penelitian',
        tahun: data.tahun || null,
        judulPencarian: data.judul || '',
        penulisPencarian: data.dosenNama || (data.penulis ? data.penulis.join(', ') : ''),
        abstrakPencarian: data.abstrak || data.deskripsi || ''
      };
    });

    // Ambil pengabdian dosen yang sudah disetujui
    const pengabdianSnapshot = await db.collection('pengabdian')
      .where('status', '==', 'approved')
      .orderBy('createdAt', 'desc')
      .get();
    const pengabdianList = pengabdianSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        _type: 'pengabdian',
        tahun: data.tahun || null,
        judulPencarian: data.judul || data.namaKegiatan || '',
        penulisPencarian: data.dosenNama || (data.penulis ? data.penulis.join(', ') : ''),
        abstrakPencarian: data.abstrak || data.deskripsi || ''
      };
    });

    // Statistik global
    const totalLaporanGlobal = laporanList.length;
    const totalPenelitianGlobal = penelitianList.length;
    const totalPengabdianGlobal = pengabdianList.length;
    const totalItemsGlobal = totalLaporanGlobal + totalPenelitianGlobal + totalPengabdianGlobal;

    // Gabungkan semua
    let allItems = [...laporanList, ...penelitianList, ...pengabdianList];

    // Filter berdasarkan search
    if (search && search.trim() !== '') {
      const lowerSearch = search.toLowerCase();
      allItems = allItems.filter(item => 
        item.judulPencarian.toLowerCase().includes(lowerSearch) ||
        item.penulisPencarian.toLowerCase().includes(lowerSearch) ||
        item.abstrakPencarian.toLowerCase().includes(lowerSearch)
      );
    }
    // Filter tahun
    if (tahun && tahun.trim() !== '') {
      const tahunNum = parseInt(tahun);
      allItems = allItems.filter(item => item.tahun === tahunNum);
    }
    // Filter pembimbing (khusus laporan)
    if (pembimbing && pembimbing.trim() !== '') {
      const lowerPembimbing = pembimbing.toLowerCase();
      allItems = allItems.filter(item => 
        item._type === 'laporan' && 
        item.pembimbing && 
        item.pembimbing.toLowerCase().includes(lowerPembimbing)
      );
    }
    // Filter tipe
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
    penelitianList.forEach(item => { if (item.tahun) tahunSet.add(item.tahun); });
    pengabdianList.forEach(item => { if (item.tahun) tahunSet.add(item.tahun); });
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
      totalItems: totalItemsGlobal,
      totalLaporan: totalLaporanGlobal,
      totalPenelitian: totalPenelitianGlobal,
      totalPengabdian: totalPengabdianGlobal
    });

  } catch (error) {
    console.error('Error ELK Library:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat ELK Library' 
    });
  }
});

// Route detail :id (tetap sama seperti aslinya - mencoba laporanMagang dulu lalu artikelDosen)
// Jika ingin mendukung detail penelitian/pengabdian, Anda bisa tambahkan logika di sini.
router.get('/:id', async (req, res) => {
  try {
    let doc = await db.collection('laporanMagang').doc(req.params.id).get();
    let type = 'laporan';
    if (!doc.exists) {
      doc = await db.collection('artikelDosen').doc(req.params.id).get();
      type = 'artikel';
    }
    if (!doc.exists) {
      // Coba cari di penelitian
      doc = await db.collection('penelitian').doc(req.params.id).get();
      if (doc.exists) type = 'penelitian';
    }
    if (!doc.exists) {
      doc = await db.collection('pengabdian').doc(req.params.id).get();
      if (doc.exists) type = 'pengabdian';
    }
    if (!doc.exists) {
      return res.status(404).render('error', { 
        title: 'Tidak Ditemukan', 
        message: 'Item tidak ditemukan' 
      });
    }
    const data = doc.data();
    const item = { id: doc.id, ...data, _type: type };

    // Increment views jika ada field views
    await doc.ref.update({ views: (data.views || 0) + 1 });

    res.render('elkLibrary/detail', {
      title: item.judul || item.judulPublik || item.title || 'Detail',
      item
    });
  } catch (error) {
    console.error('Error detail:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat detail' 
    });
  }
});

module.exports = router;