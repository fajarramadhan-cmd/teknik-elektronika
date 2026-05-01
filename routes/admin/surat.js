/**
 * routes/admin/surat.js
 * Manajemen surat untuk mahasiswa DAN dosen
 * - Mahasiswa: collection 'surat'
 * - Dosen: collection 'surat_dosen'
 * - Upload file ke Google Drive, verifikasi, tolak surat
 * - Tambahan: Generate otomatis surat aktif kuliah (mahasiswa) menggunakan Puppeteer
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { getCurrentAcademicSemester } = require('../../helpers/academicHelper');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Konstanta folder utama Data WEB
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getMahasiswa(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  return userDoc.exists ? { id: userId, ...userDoc.data() } : { id: userId, nama: 'Unknown', nim: '-' };
}

async function getDosen(dosenId) {
  const dosenDoc = await db.collection('dosen').doc(dosenId).get();
  return dosenDoc.exists ? { id: dosenId, ...dosenDoc.data() } : { id: dosenId, nama: 'Unknown', nip: '-' };
}

async function getOrCreateSubFolder(parentId, name) {
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) return query.data.files[0].id;
  const folder = await drive.files.create({
    resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return folder.data.id;
}

async function getSuratFolderMahasiswa(nim, tahunAkademik) {
  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Surat');
  const tahunFolder = await getOrCreateSubFolder(parent, tahunAkademik);
  return await getOrCreateSubFolder(tahunFolder, nim);
}

async function getSuratFolderDosen(nip, tahunAkademik) {
  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'Surat Dosen');
  const tahunFolder = await getOrCreateSubFolder(parent, tahunAkademik);
  return await getOrCreateSubFolder(tahunFolder, nip);
}

function generateKodeValidasi() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ELK${timestamp}${random}`;
}

// ============================================================================
// FITUR ADMIN: Kirim Surat Langsung ke Dosen
// ============================================================================

router.get('/create', async (req, res) => {
  try {
    const dosenSnapshot = await db.collection('dosen').orderBy('nama').get();
    const dosenList = dosenSnapshot.docs.map(doc => ({ id: doc.id, nama: doc.data().nama, nip: doc.data().nip }));
    res.render('admin/surat/create', { title: 'Kirim Surat ke Dosen', dosenList });
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal memuat data dosen');
  }
});

router.post('/create', upload.single('file'), async (req, res) => {
  try {
    const { dosenId, jenisSurat, keperluan, isiLain } = req.body;
    const file = req.file;
    if (!dosenId || !jenisSurat || !keperluan || !file) return res.status(400).send('Semua field wajib diisi');

    const dosenDoc = await db.collection('dosen').doc(dosenId).get();
    if (!dosenDoc.exists) return res.status(404).send('Dosen tidak ditemukan');
    const dosenData = dosenDoc.data();
    const dosenIdFirestore = dosenDoc.id;

    const tahunAkademik = getCurrentAcademicSemester().tahunAkademik;
    const folderId = await getSuratFolderDosen(dosenData.nip || dosenIdFirestore, tahunAkademik);
    const fileName = `${dosenData.nip || dosenIdFirestore}_${jenisSurat.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
    const driveResponse = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
    await drive.permissions.create({ fileId: driveResponse.data.id, requestBody: { role: 'reader', type: 'anyone' } });
    const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
    const fileId = driveResponse.data.id;

    const kodeValidasi = generateKodeValidasi();
    const suratData = {
      dosenId: dosenIdFirestore,
      dosenNama: dosenData.nama,
      nip: dosenData.nip || '',
      email: dosenData.email || '',
      jenisSurat,
      keperluan,
      isiLain: isiLain || '',
      kodeValidasi,
      status: 'completed',
      fileUrl,
      fileId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dikirimOleh: req.user.id,
      dikirimOlehNama: req.user.nama || 'Admin',
      history: [{ status: 'completed', timestamp: new Date().toISOString(), catatan: `Surat dikirim langsung oleh ${req.user.nama || 'Admin'}` }]
    };
    await db.collection('surat_dosen').add(suratData);
    res.redirect('/admin/surat');
  } catch (err) {
    console.error(err);
    res.status(500).send('Gagal mengirim surat: ' + err.message);
  }
});

// ============================================================================
// GENERATE SURAT OTOMATIS (MAHASISWA - AKTIF KULIAH)
// ============================================================================

router.post('/:id/:role/generate', async (req, res) => {
  try {
    const { id, role } = req.params;
    const { nomorSurat } = req.body;
    if (!nomorSurat) return res.status(400).send('Nomor surat wajib diisi');
    if (role !== 'mahasiswa') return res.status(400).send('Generate surat hanya untuk mahasiswa');

    const suratRef = db.collection('surat').doc(id);
    const suratDoc = await suratRef.get();
    if (!suratDoc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = suratDoc.data();
    if (surat.jenis !== 'Aktif Kuliah') {
      return res.status(400).send('Generate otomatis hanya untuk surat jenis "Aktif Kuliah"');
    }

    const mahasiswa = await getMahasiswa(surat.userId);
    if (!mahasiswa.nim) return res.status(404).send('Data mahasiswa tidak lengkap');

    const templateData = {
      nomorSurat,
      nama: mahasiswa.nama,
      nim: mahasiswa.nim,
      tempatLahir: surat.tempatLahir || '-',
      tanggalLahir: surat.tanggalLahir ? new Date(surat.tanggalLahir) : new Date(),
      semester: surat.semester,
      tahunAkademik: surat.tahunAkademik,
      keperluan: surat.keperluan,
      kodeValidasi: surat.kodeValidasi   // ← tambahkan ini
    };

    // Render HTML
    let html = await new Promise((resolve, reject) => {
      res.render('admin/surat/aktif_kuliah', templateData, (err, html) => {
        if (err) reject(err);
        else resolve(html);
      });
    });

    // Baca gambar logo dan ttd, konversi ke base64
    const logoPath = path.join(__dirname, '../../public/images/logo.png');
    const ttdPath = path.join(__dirname, '../../public/images/ttd.png');
    let logoBase64 = '';
    let ttdBase64 = '';
    try {
      if (fs.existsSync(logoPath)) {
        logoBase64 = fs.readFileSync(logoPath).toString('base64');
      } else {
        console.warn('Logo tidak ditemukan di', logoPath);
      }
      if (fs.existsSync(ttdPath)) {
        ttdBase64 = fs.readFileSync(ttdPath).toString('base64');
      } else {
        console.warn('TTD tidak ditemukan di', ttdPath);
      }
    } catch (err) {
      console.error('Gagal membaca file gambar:', err);
    }

    // Ganti src gambar di HTML dengan base64
    if (logoBase64) {
      html = html.replace('src="/images/logo.png"', `src="data:image/png;base64,${logoBase64}"`);
    }
    if (ttdBase64) {
      html = html.replace('src="/images/ttd.png"', `src="data:image/png;base64,${ttdBase64}"`);
    }

    // Launch puppeteer
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new',
      timeout: 60000
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' }
    });
    await browser.close();

    const buffer = Buffer.from(pdfBuffer);

    // Upload ke Google Drive
    const folderId = await getSuratFolderMahasiswa(mahasiswa.nim, surat.tahunAkademik);
    const fileName = `${surat.kodeValidasi}_${nomorSurat.replace(/\//g, '_')}.pdf`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: 'application/pdf', body: Readable.from(buffer) };
    const driveResponse = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
    await drive.permissions.create({ fileId: driveResponse.data.id, requestBody: { role: 'reader', type: 'anyone' } });
    const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;

    // Update surat
    await suratRef.update({
      status: 'completed',
      fileUrl,
      fileId: driveResponse.data.id,
      nomorSurat,
      updatedAt: new Date().toISOString(),
      history: [
        ...(surat.history || []),
        { status: 'completed', timestamp: new Date().toISOString(), catatan: `Surat diterbitkan otomatis dengan nomor ${nomorSurat}` }
      ]
    });

    res.redirect(`/admin/surat/${id}/${role}`);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Gagal generate surat: ' + err.message);
  }
});

// ============================================================================
// DAFTAR SURAT
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { status, role, search } = req.query;
    let queryMahasiswa = db.collection('surat').orderBy('createdAt', 'desc');
    if (status) queryMahasiswa = queryMahasiswa.where('status', '==', status);
    const snapMahasiswa = await queryMahasiswa.get();

    let queryDosen = db.collection('surat_dosen').orderBy('createdAt', 'desc');
    if (status) queryDosen = queryDosen.where('status', '==', status);
    const snapDosen = await queryDosen.get();

    let suratList = [];

    for (const doc of snapMahasiswa.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      if (search) {
        const lower = search.toLowerCase();
        if (!mahasiswa.nama.toLowerCase().includes(lower) && !data.keperluan?.toLowerCase().includes(lower)) continue;
      }
      suratList.push({ id: doc.id, role: 'mahasiswa', pemohon: mahasiswa.nama, identitas: mahasiswa.nim, ...data });
    }

    for (const doc of snapDosen.docs) {
      const data = doc.data();
      const dosen = await getDosen(data.dosenId);
      if (search) {
        const lower = search.toLowerCase();
        if (!dosen.nama.toLowerCase().includes(lower) && !data.keperluan?.toLowerCase().includes(lower)) continue;
      }
      suratList.push({ id: doc.id, role: 'dosen', pemohon: dosen.nama, identitas: dosen.nip, ...data });
    }

    suratList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (role && role !== 'semua') suratList = suratList.filter(s => s.role === role);

    res.render('admin/surat/index', { title: 'Manajemen Surat (Mahasiswa & Dosen)', suratList, filters: { status, role, search } });
  } catch (error) {
    console.error('Error ambil surat:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat daftar surat' });
  }
});

// ============================================================================
// DETAIL SURAT
// ============================================================================

router.get('/:id/:role', async (req, res) => {
  try {
    const { id, role } = req.params;
    let surat, pemohon;
    if (role === 'mahasiswa') {
      const doc = await db.collection('surat').doc(id).get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = { id: doc.id, ...doc.data() };
      pemohon = await getMahasiswa(surat.userId);
    } else if (role === 'dosen') {
      const doc = await db.collection('surat_dosen').doc(id).get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = { id: doc.id, ...doc.data() };
      pemohon = await getDosen(surat.dosenId);
    } else {
      return res.status(400).send('Role tidak valid');
    }
    res.render('admin/surat/detail', { title: `Detail Surat - ${pemohon.nama}`, surat, pemohon, role });
  } catch (error) {
    console.error('Error detail surat:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail surat' });
  }
});

// ============================================================================
// UPLOAD FILE SURAT (APPROVE)
// ============================================================================

router.post('/:id/:role/upload', upload.single('file'), async (req, res) => {
  try {
    const { id, role } = req.params;
    const file = req.file;
    if (!file) return res.status(400).send('File tidak ada');

    let suratRef, surat, identitas, tahunAkademik;
    if (role === 'mahasiswa') {
      suratRef = db.collection('surat').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      const mahasiswa = await getMahasiswa(surat.userId);
      identitas = mahasiswa.nim;
      tahunAkademik = surat.tahunAkademik || getCurrentAcademicSemester().tahunAkademik;
      const folderId = await getSuratFolderMahasiswa(identitas, tahunAkademik);
      const fileName = `${identitas}_${surat.jenis.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const driveResponse = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
      await drive.permissions.create({ fileId: driveResponse.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      await suratRef.update({
        status: 'completed',
        fileUrl,
        fileId: driveResponse.data.id,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'completed', timestamp: new Date().toISOString(), catatan: 'Surat telah diupload oleh Admin' }]
      });
    } else if (role === 'dosen') {
      suratRef = db.collection('surat_dosen').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      const dosen = await getDosen(surat.dosenId);
      identitas = dosen.nip;
      tahunAkademik = surat.tahunAkademik || getCurrentAcademicSemester().tahunAkademik;
      const folderId = await getSuratFolderDosen(identitas, tahunAkademik);
      const fileName = `${identitas}_${surat.jenisSurat?.replace(/\s+/g, '_') || 'surat'}_${Date.now()}.pdf`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const driveResponse = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
      await drive.permissions.create({ fileId: driveResponse.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      await suratRef.update({
        status: 'completed',
        fileUrl,
        fileId: driveResponse.data.id,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'completed', timestamp: new Date().toISOString(), catatan: 'Surat telah diupload oleh Admin' }]
      });
    } else {
      return res.status(400).send('Role tidak valid');
    }

    res.redirect(`/admin/surat/${id}/${role}`);
  } catch (error) {
    console.error('Error upload surat:', error);
    res.status(500).send('Gagal upload surat: ' + error.message);
  }
});

// ============================================================================
// TOLAK SURAT
// ============================================================================

router.post('/:id/:role/reject', async (req, res) => {
  try {
    const { id, role } = req.params;
    const { alasan } = req.body;
    if (!alasan) return res.status(400).send('Alasan penolakan harus diisi');

    let suratRef, surat;
    if (role === 'mahasiswa') {
      suratRef = db.collection('surat').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      await suratRef.update({
        status: 'rejected',
        alasanPenolakan: alasan,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'rejected', timestamp: new Date().toISOString(), catatan: `Ditolak: ${alasan}` }]
      });
    } else if (role === 'dosen') {
      suratRef = db.collection('surat_dosen').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      await suratRef.update({
        status: 'rejected',
        alasanPenolakan: alasan,
        updatedAt: new Date().toISOString(),
        history: [...(surat.history || []), { status: 'rejected', timestamp: new Date().toISOString(), catatan: `Ditolak: ${alasan}` }]
      });
    } else {
      return res.status(400).send('Role tidak valid');
    }
    res.redirect(`/admin/surat/${id}/${role}`);
  } catch (error) {
    console.error('Error reject surat:', error);
    res.status(500).send('Gagal menolak surat');
  }
});

// ============================================================================
// HAPUS SURAT
// ============================================================================

router.post('/:id/:role/delete', async (req, res) => {
  try {
    const { id, role } = req.params;
    let suratRef, surat;
    if (role === 'mahasiswa') {
      suratRef = db.collection('surat').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      if (surat.fileId) {
        try { await drive.files.delete({ fileId: surat.fileId }); } catch (err) { console.error('Gagal hapus file Drive:', err.message); }
      }
      await suratRef.delete();
    } else if (role === 'dosen') {
      suratRef = db.collection('surat_dosen').doc(id);
      const doc = await suratRef.get();
      if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
      surat = doc.data();
      if (surat.fileId) {
        try { await drive.files.delete({ fileId: surat.fileId }); } catch (err) { console.error('Gagal hapus file Drive:', err.message); }
      }
      await suratRef.delete();
    } else {
      return res.status(400).send('Role tidak valid');
    }
    res.redirect('/admin/surat');
  } catch (error) {
    console.error('Error delete surat:', error);
    res.status(500).send('Gagal menghapus surat');
  }
});

module.exports = router;