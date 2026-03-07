// scripts/import-tagihan-6-semester.js
const { db } = require('./config/firebaseAdmin');
const fs = require('fs');
const csv = require('csv-parser');

// ========== KONFIGURASI ==========
const CSV_FILE = 'tagihan.csv'; // Nama file CSV (letakkan di folder proyek)
const SEMESTER_COUNT = 6;       // Jumlah semester yang diproses
// =================================

/**
 * Membersihkan format rupiah menjadi angka
 * Contoh: "Rp 500,000" → 500000, "Rp 1,000,000" → 1000000, "Rp -" → 0
 */
function parseRupiah(value) {
  if (!value) return 0;
  // Hapus "Rp", spasi, dan koma (pemisah ribuan), sisakan angka dan tanda minus
  const cleaned = value.replace(/[^0-9-]/g, '');
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

async function main() {
  const results = [];

  console.log(`📂 Membaca file ${CSV_FILE}...`);
  fs.createReadStream(CSV_FILE)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`✅ Ditemukan ${results.length} baris data.`);
      let success = 0;
      let failed = 0;
      const errors = [];

      for (const [index, row] of results.entries()) {
        try {
          // Ambil NIM (kolom kedua)
          const nim = row['NIM'] || row['nim'];
          if (!nim) {
            errors.push(`Baris ${index + 2}: NIM tidak ditemukan`);
            failed++;
            continue;
          }

          // Cari user berdasarkan NIM (role mahasiswa)
          const userSnapshot = await db.collection('users')
            .where('nim', '==', nim)
            .where('role', '==', 'mahasiswa')
            .limit(1)
            .get();

          if (userSnapshot.empty) {
            errors.push(`Baris ${index + 2}: Mahasiswa dengan NIM ${nim} tidak ditemukan`);
            failed++;
            continue;
          }

          const userId = userSnapshot.docs[0].id;

          // Siapkan array semester baru
          const semesterArray = [];

          // Loop untuk semester 1 sampai 6 (atau sesuai jumlah yang diinginkan)
          for (let sem = 1; sem <= SEMESTER_COUNT; sem++) {
            // Cari kolom yang mengandung angka semester (misal "TAGIHAN SPP SEMESTER 1")
            // Kita akan mencari dengan regex yang fleksibel
            const keyPattern = new RegExp(`SEMESTER\\s*${sem}|SMSTER\\s*${sem}`, 'i');
            const foundKey = Object.keys(row).find(key => keyPattern.test(key));
            
            // Jika kolom ditemukan, ambil nilainya, jika tidak, set 0
            const nilai = foundKey ? parseRupiah(row[foundKey]) : 0;

            const semesterLabel = `Semester ${sem}`;
            semesterArray.push({
              id: `${userId}_${sem}`, // ID sederhana (bisa diganti UUID)
              semester: semesterLabel,
              jumlah: nilai,
              jatuhTempo: null, // bisa ditambahkan jika ada kolom terpisah
              status: nilai > 0 ? 'belum lunas' : 'lunas',
              createdAt: new Date().toISOString()
            });
          }

          // Simpan ke Firestore (overwrite dokumen)
          await db.collection('tagihan').doc(userId).set({
            userId,
            semester: semesterArray,
            updatedAt: new Date().toISOString()
          });

          console.log(`✅ [${index + 1}/${results.length}] Berhasil: ${nim} (${semesterArray.length} semester)`);
          success++;

        } catch (err) {
          console.error(`❌ [${index + 1}/${results.length}] Gagal:`, err.message);
          errors.push(`Baris ${index + 2}: ${err.message}`);
          failed++;
        }
      }

      console.log('\n========== HASIL IMPORT ==========');
      console.log(`✅ Berhasil: ${success}`);
      console.log(`❌ Gagal: ${failed}`);
      if (errors.length > 0) {
        console.log('\n📋 Daftar error:');
        errors.forEach((e, i) => console.log(`${i+1}. ${e}`));
      }
    });
}

main().catch(console.error);