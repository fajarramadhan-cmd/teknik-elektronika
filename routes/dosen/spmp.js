const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { getActiveSpmpPeriod, getIndikators, getDosenResponse, calculateFinalScore } = require('../../helpers/spmpHelper');

router.use(verifyToken);
router.use(isDosen);
const DATA_WEB_FOLDER_ID = '17Z02_5zOImG1GYfi_5gvWL97-p6dW5t0';

async function getOrCreateSubFolder(parentId, name) {
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length) return query.data.files[0].id;
  const folder = await drive.files.create({ resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }, fields: 'id' });
  return folder.data.id;
}
async function getSpmpBuktiFolder(dosenId, periodeId) {
  const parent = await getOrCreateSubFolder(DATA_WEB_FOLDER_ID, 'SPMP_Bukti');
  const periodeFolder = await getOrCreateSubFolder(parent, periodeId);
  const dosenFolder = await getOrCreateSubFolder(periodeFolder, dosenId);
  return dosenFolder;
}

router.get('/', async (req, res) => {
  const activePeriod = await getActiveSpmpPeriod();
  if (!activePeriod) {
    return res.render('dosen/spmp/index', { title: 'Evaluasi SPMP', activePeriod: null, indicators: [], responses: [], finalScore: 0, message: 'Tidak ada periode aktif' });
  }
  const indicators = await getIndikators(activePeriod.id);
  const existing = await getDosenResponse(req.dosen.id, activePeriod.id);
  const responses = existing ? existing.jawaban || [] : [];
  const finalScore = existing ? existing.skorAkhir : 0;
  res.render('dosen/spmp/index', { title: 'Evaluasi SPMP', activePeriod, indicators, responses, finalScore, message: null });
});

router.get('/isi', async (req, res) => {
  const activePeriod = await getActiveSpmpPeriod();
  if (!activePeriod) return res.status(400).send('Tidak ada periode aktif');
  const indicators = await getIndikators(activePeriod.id);
  const existing = await getDosenResponse(req.dosen.id, activePeriod.id);
  const jawaban = existing ? existing.jawaban || [] : [];
  res.render('dosen/spmp/form', { title: 'Isi Capaian IKU', activePeriod, indicators, jawaban });
});

router.post('/isi', upload.single('file'), async (req, res) => {
  const activePeriod = await getActiveSpmpPeriod();
  if (!activePeriod) return res.status(400).send('Periode tidak aktif');
  const indicators = await getIndikators(activePeriod.id);
  const existing = await getDosenResponse(req.dosen.id, activePeriod.id);
  const jawabanBaru = [];
  for (const ind of indicators) {
    const capaian = req.body[`capaian_${ind.id}`] || 0;
    let fileUrl = null, fileId = null;
    if (req.file && req.file.fieldname === `file_${ind.id}`) {
      const folderId = await getSpmpBuktiFolder(req.dosen.id, activePeriod.id);
      const fileName = `${Date.now()}_${ind.id}_${req.file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) };
      const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id' });
      await drive.permissions.create({ fileId: response.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      fileId = response.data.id;
    } else if (existing) {
      const old = existing.jawaban.find(j => j.indikatorId === ind.id);
      if (old) { fileUrl = old.fileUrl; fileId = old.fileId; }
    }
    jawabanBaru.push({ indikatorId: ind.id, capaian: parseFloat(capaian), fileUrl, fileId });
  }
  const skor = calculateFinalScore(indicators, jawabanBaru);
  const docData = {
    dosenId: req.dosen.id,
    dosenNama: req.dosen.nama,
    periodeId: activePeriod.id,
    jawaban: jawabanBaru,
    skorAkhir: skor,
    updatedAt: new Date().toISOString()
  };
  if (existing) await db.collection('spmp_respon').doc(existing.id).update(docData);
  else await db.collection('spmp_respon').add({ ...docData, createdAt: new Date().toISOString() });
  res.redirect('/dosen/spmp');
});

module.exports = router;