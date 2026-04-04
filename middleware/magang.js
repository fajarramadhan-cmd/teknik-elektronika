// middleware/magang.js
const { getMagangContext } = require('../helpers/magangHelper');

async function requirePdkSelected(req, res, next) {
  const context = await getMagangContext(req.user.id);
  if (!context.hasActiveMagang) {
    return res.redirect('/mahasiswa/magang?error=belum_aktif');
  }
  if (!context.selectedPdk || !context.selectedPdk.id) {
    return res.redirect('/mahasiswa/magang?error=pilih_pdk');
  }
  req.magangContext = context;
  next();
}

module.exports = { requirePdkSelected };