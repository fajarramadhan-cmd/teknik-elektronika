// scripts/cleanup-enrollment.js
const { db } = require('./config/firebaseAdmin');

async function cleanupOrphanEnrollments() {
  console.log('Memulai pembersihan enrollment orphan...');
  const enrollmentSnapshot = await db.collection('enrollment').get();
  let deleted = 0;
  let skipped = 0;

  for (const doc of enrollmentSnapshot.docs) {
    const data = doc.data();
    if (data.krsId) {
      // Cek apakah KRS dengan ID tersebut masih ada
      const krsDoc = await db.collection('krs').doc(data.krsId).get();
      if (!krsDoc.exists) {
        console.log(`Menghapus enrollment ${doc.id} (krsId: ${data.krsId}) karena KRS tidak ditemukan.`);
        await doc.ref.delete();
        deleted++;
      } else {
        skipped++;
      }
    } else {
      // Jika tidak ada krsId, mungkin perlu penanganan lain? Lewati saja.
      skipped++;
    }
  }

  console.log(`Selesai. ${deleted} enrollment dihapus, ${skipped} enrollment valid.`);
}

cleanupOrphanEnrollments().catch(console.error);