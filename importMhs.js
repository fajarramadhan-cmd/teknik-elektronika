// scripts/import-mahasiswa.js
const { db, auth } = require('./config/firebaseAdmin');
const fs = require('fs');
const csv = require('csv-parser');

const results = [];

fs.createReadStream('mahasiswa.csv')
  .pipe(csv())
  .on('data', (data) => results.push(data))
  .on('end', async () => {
    console.log(`Membaca ${results.length} data mahasiswa...`);
    let success = 0;
    let failed = 0;

    for (const row of results) {
      try {
        // Validasi minimal
        if (!row.nim || !row.nama || !row.email || !row.password) {
          console.warn('Data tidak lengkap, dilewati:', row);
          failed++;
          continue;
        }

        // Buat user di Firebase Authentication
        const userRecord = await auth.createUser({
          email: row.email,
          password: row.password,
          displayName: row.nama,
        });

        // Simpan data ke Firestore (koleksi 'users')
        await db.collection('users').doc(userRecord.uid).set({
          nim: row.nim,
          nama: row.nama,
          email: row.email,
          noHp: row.noHp || '',
          role: 'mahasiswa',
          createdAt: new Date().toISOString(),
        });

        console.log(`✅ Berhasil: ${row.nim} - ${row.nama}`);
        success++;

        // Jeda 200ms untuk menghindari rate limiting (opsional)
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`❌ Gagal: ${row.nim} - ${row.nama}`, error.message);
        failed++;
      }
    }

    console.log(`\nSelesai! Berhasil: ${success}, Gagal: ${failed}`);
  });