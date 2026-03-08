// scripts/cleanup-laporan.js
const { db } = require('./config/firebaseAdmin');

async function cleanupLaporan() {
  const snapshot = await db.collection('laporanMagang').get();
  let deleted = 0;
  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let changed = false;

    // Hapus dokumen jika nim atau nama tidak ada
    if (!data.nim || !data.nama) {
      console.log(`❌ Menghapus dokumen ${doc.id} karena nim atau nama kosong.`);
      await doc.ref.delete();
      deleted++;
      continue;
    }

    // Ubah status 'pending' menjadi 'submitted' (untuk laporan yang perlu disetujui)
    if (data.status === 'pending') {
      console.log(`🔄 Mengubah status dokumen ${doc.id} dari pending menjadi submitted.`);
      await doc.ref.update({ status: 'submitted' });
      updated++;
      changed = true;
    }

    // Jika tidak ada uploadedAt, set dengan createdAt atau sekarang
    if (!data.uploadedAt) {
      const uploadedAt = data.createdAt || new Date().toISOString();
      await doc.ref.update({ uploadedAt });
      console.log(`📅 Menambahkan uploadedAt untuk ${doc.id}: ${uploadedAt}`);
      updated++;
      changed = true;
    }

    // Jika status approved tapi tidak ada approvedAt, set dengan sekarang
    if (data.status === 'approved' && !data.approvedAt) {
      await doc.ref.update({ approvedAt: new Date().toISOString() });
      console.log(`✅ Menambahkan approvedAt untuk ${doc.id}`);
      updated++;
      changed = true;
    }

    // Jika tidak ada, tambahkan laporanKe (default 1 jika tidak ada)
    if (!data.laporanKe) {
      await doc.ref.update({ laporanKe: 1 });
      console.log(`📄 Menambahkan laporanKe=1 untuk ${doc.id}`);
      updated++;
      changed = true;
    }
  }

  console.log('\n========== HASIL PEMBERSIHAN ==========');
  console.log(`🗑️  Dokumen dihapus: ${deleted}`);
  console.log(`✏️  Dokumen diperbarui: ${updated}`);
}

cleanupLaporan().catch(console.error);