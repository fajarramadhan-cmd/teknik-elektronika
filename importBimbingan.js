// scripts/setBimbinganAngkatan2023Lengkap.js
// Jalankan dengan: node scripts/setBimbinganAngkatan2023Lengkap.js

const { db } = require('./config/firebaseAdmin');

// ============================================================================
// MAPPING USER ID (dari output getUser.js)
// ============================================================================

// Mapping Mahasiswa Angkatan 2023 (NIM -> User ID)
const mahasiswaMap = {
  // NIM 233020xx - Dari output getUser.js
  '23302001': 'VzjexmSOUpb4FFPWcZIWxZXgDw43',     // Muh. Reski Chalik
  '23302002': 'XHDor68cDCZexyHpzIJKO7cFlig2',     // Muh Ibrahim Hasan
  '23302008': 'rF3OJ1lEIWYTC47AbwxlpODpmks1',     // Juniansa
  '23302011': 'MlZlrYVzDNPGfdrgVxlskVSJDSS2',     // Anwar
  '23302012': 'xW6IFlcBHANqNTEyJ3e7aqmsveD3',     // Vicky Prasetio
  '23302014': 'xiWlKQhLfINeN8qgCGafUHtgzuI2',     // Afdhal
  '23302015': '52h3AtCfvlUWbqmS3Hmy33FCXF03',     // Hairullah Hairuddin
  '23302016': 'Rdt7RDQwN9T3BdNlkXo9aWqJyTw2',     // Abdul Jaya
  '23302022': 'YcrwdSnhqaYZ5Wr1qcRCQMnwykK2',     // Shabrina Malika Azzahra
  '23302023': 'LPdzVGJFiqOUhiUsUQjj8fiLQMd2',     // Erina
  '23302024': 'PPfyEoXVPWOI70NtNfPPFFxxJ013',     // Faras Nur Anjani
  '23302025': 'sLpSDUvhiWTD5tSg4RYZ6qF0kOh2',     // Sulmika
  '23302026': '9HDVnGe4UaPTtli6Uk2HalNx4gB2',     // Muhammad Salman
  '23302028': 'zJaaflTzIMeabpnNKM2r4Qk7JXC3',     // Afandi Jhon Malabi
  '23302029': 'tzkjPxaPdpXRdkvVhrdPZ1pvOnz1',     // Ibnu Muarif
  '23302031': 'VrLxsw5KMtWeWVOgAxUHPXPiruK2',     // Arbaiyah
  '23302032': 'F6m4TBAVdHfMC5FEydJnYMtBChF2',     // Asriyadi
  '23302033': 'Axk7q0bKySgQrr0m49hQXxyoOOm1',     // Muh. Gading Riyanto
  '23302034': 'U9U51vBdPAObGVpx4YkZgepEjN23',     // Nurfadillah
  '23302035': 'aoFjc4sE4nO1AtnAIrVyEUxtdhs1',     // Saania Maharani
  '23302036': 'j1QHXG34kQdGbhvb8l3le6Xy7vt1',     // Armayanti A
  '23302039': 'csOew6ZLeeYsK08X4BZJ9tHx9y92',     // Lira
  '23302040': 'IWlXlKTdzXhLKf4gUI0aeyKV2YF2',     // Muh Rifky
  '23302043': 'hlQ1k7k8lFgRFnPYh4UMpVOaBFh2',     // Nova Samulung
  '23302046': 'VXOrwzuy3Jh9K5Jblg8MIaTeD2D3',     // Dela
  '23302047': 'o1Z1eQEPpLTKToBOdrKGETSMSoD2',     // Saenal
  '23302048': 'TCwN8xVaGKQ2vmDWLYpw5YJV6jG3',     // Ibra Razak
  '23302053': 'Eq41HEe7XXTGO0T6G0ZTc5lbZuX2',     // Muh. Fariel
  '23302055': 'DaDWyx1aySeKNCUCTaMdqQxoG2L2',     // Agung
  '23302056': 'rOLljMtnqeNYsd4xL6T7dzMYWaK2',     // Muh. Sulsabilah
  '23302058': 'e8v864o1wIbwnj1grTMg70G33K32',     // Muhammad Adam
  '23302060': 'XlebxGFHsyaOaMnOP3IImoOEPGu2',     // Ridwan
  '23302062': 'jr5OCURms9ZS0w8JD5Dbgvwiz0n2',     // Muh. Akram
  '23302063': '3cThiC8TkYPQRDMDmaJ7F8CLy8f1',     // Muh. Gerald Rofi'if
  '23302064': 'VSKf66X7aVXrgqVP5iZLOXKZ5nq2',     // Muhammad Faiz Al-Gifari
  '23302065': 'eFmJckmOEkXe8kdjGYMkT3osNhK2',     // Ahmad Gazali
  '23302066': 'dee5hCQCoHMps4RFcFP0xfySHuP2',     // Fendi Kurniawan
  '23302067': '7B1Q1YUrBnZ0fNqMQ3WQMHBw8Nw1',     // Vito Aditya
  '23302070': 'Eo44hpsDQHbFSXiqSpYY3qDotKd2',     // Fitriany
  '23302071': 'za9sVUj0ZMcEl19KxpMRKPMKP382',     // Muliani
  '23302072': 'IpKsKWruQwfqhPfGV7mpdq92bqj2',     // Hasniar
  '23302074': 'CnJgCUe3s2fdGsuXUUZeitNrum03',     // Muh. Wedi
  '23302081': 'vqH3DoQjuKOZLaDibUETTmo3OGg2',     // Yusnia Wulandari
  '23302082': 'RrxxuIBDYyTSRvciz212sV9DFAG3',     // Nurliana
  '23302088': 'kg6Bqecj4dMKDvKRVoe1f81HT253',     // Lusiana
  '23302094': 'b7nZZ95NuPPHkPot7GpdvsMJQhU2',     // Nurul Hikmah
  '23302100': 'tz8BX71CXgU903BrKY1UArRK2Bn1',     // Yuliani
  '23302110': 'eXrWcFzFqYOnYv8r56nL3mjXB0U2',     // Mawar Bilang Tua
  '23302117': 'oHfUs8SjbKS6DR7a2yVQS7cKH0F3',     // Pratiwi S
  '23302120': '9RQeougIWPMQSCTSZKvj4ghqlVb2',     // Nirmala
  '23302129': 'q6YzpCDsfaRdyZzhlpnvEdOrdsg2',     // Widyanti
  '23302132': 'O2C57c7tzqaNNON0vkWVxXV7hj12',     // Laura Malla
  '23302138': 'ucg7FzJY1tRxnt972aOE2kxerVU2',     // Nur Ainun
  '23302141': 'caBBgu66rsTH5g8TUePnPgHt1ez2',     // Aisyah Radiallahuanha
  '23302144': 'LsILjULvsygKvqXauqXgt4EdKyJ3',     // Arini
  '23302146': '4UPZ8AYZjdfjzguhDNevVRqPOH02',     // Srilisa
  '23302148': 'G8fcJfoZr8Sh1AtWD4or0irOmFA2',     // Rifkhu Noperdiansyah
};

// Mapping Dosen (Nama -> User ID)
const dosenMap = {
  'Ariani Amri': 'g4dtuUHKbqPliI7xtyUK2kkNF6j1',
  'Fajar Ramadhan': 'UtuyVRuhIoWcNoVOyjv99O09hxv1',
  'Gunawan Tari': 'BdwnRGcEZUPq0eiR3v4PdqlZTFA3',
  'Miftahul Hairiah': '3F4ogmZOamPE2fr6ltseYGA3n263',
  'Rahman Syam': 'DZAaXXAAodVzILCf0CujXveA4352',
  'Suardi': 'gG5i8oMoxRRzzHCu2IpP4HVuqqe2',
};

// ============================================================================
// DATA BIMBINGAN (Hanya untuk mahasiswa yang ada di database)
// ============================================================================

const bimbinganData = [
  // No 1-8: Rahman Syam & Fajar Ramadhan
  ['23302001', 'Muh. Reski Chalik', 'Rahman Syam', 'Fajar Ramadhan'],
  ['23302002', 'Muh. Ibrahim Hasan', 'Rahman Syam', 'Fajar Ramadhan'],
  ['23302008', 'Juniansa', 'Rahman Syam', 'Fajar Ramadhan'],
  
  // No 9-15: Miftahul Hairiah & Fajar Ramadhan
  ['23302011', 'Anwar', 'Miftahul Hairiah', 'Fajar Ramadhan'],
  ['23302012', 'Vicky Prasetio', 'Miftahul Hairiah', 'Fajar Ramadhan'],
  ['23302014', 'Afdhal', 'Miftahul Hairiah', 'Fajar Ramadhan'],
  ['23302015', 'Hairullah Hairuddin', 'Miftahul Hairiah', 'Fajar Ramadhan'],
  ['23302016', 'Abdul Jaya', 'Miftahul Hairiah', 'Fajar Ramadhan'],
  ['23302022', 'Shabrina Malika Az-Zahra', 'Miftahul Hairiah', 'Fajar Ramadhan'],
  ['23302023', 'Erina', 'Miftahul Hairiah', 'Fajar Ramadhan'],
  
  // No 16-19: Suardi & Rahman Syam
  ['23302024', 'Faras Nur Anjani', 'Suardi', 'Rahman Syam'],
  ['23302025', 'Sulmika', 'Suardi', 'Rahman Syam'],
  ['23302026', 'Muhammad Salman', 'Suardi', 'Rahman Syam'],
  ['23302028', 'Afandi Jhon Malabi', 'Suardi', 'Rahman Syam'],
  
  // No 20-22: Rahman Syam & Rahman Syam (pembimbing 2 sama dengan pembimbing 1)
  ['23302029', 'Ibnu Muarif', 'Rahman Syam', 'Rahman Syam'],
  ['23302067', 'Vito Aditya', 'Rahman Syam', 'Rahman Syam'],
  ['23302062', 'Muh. Akram', 'Rahman Syam', 'Rahman Syam'],
  
  // No 23-25: Rahman Syam & Miftahul Hairiah
  ['23302031', 'Arbaiyah', 'Rahman Syam', 'Miftahul Hairiah'],
  ['23302032', 'Asriyadi', 'Rahman Syam', 'Miftahul Hairiah'],
  ['23302033', 'Muhammad Gading Riyanto', 'Rahman Syam', 'Miftahul Hairiah'],
  
  // No 26-35: Suardi & Fajar Ramadhan
  ['23302034', 'Nur Fadillah', 'Suardi', 'Fajar Ramadhan'],
  ['23302035', 'Saania Maharani', 'Suardi', 'Fajar Ramadhan'],
  ['23302036', 'Armayanti A', 'Suardi', 'Fajar Ramadhan'],
  ['23302039', 'Lira', 'Suardi', 'Fajar Ramadhan'],
  ['23302040', 'Muh Rifky', 'Suardi', 'Fajar Ramadhan'],
  ['23302043', 'Nova Samulung', 'Suardi', 'Fajar Ramadhan'],
  ['23302146', 'Srilisa', 'Suardi', 'Fajar Ramadhan'],
  
  // No 36-43: Suardi & Ariani Amri
  ['23302046', 'Dela', 'Suardi', 'Ariani Amri'],
  ['23302047', 'Saenal', 'Suardi', 'Ariani Amri'],
  ['23302048', 'Ibra Razak', 'Suardi', 'Ariani Amri'],
  ['23302053', 'Muh. Fariel', 'Suardi', 'Ariani Amri'],
  
  // No 44-49: Ariani Amri & Fajar Ramadhan
  ['23302055', 'Agung', 'Ariani Amri', 'Fajar Ramadhan'],
  ['23302056', 'Muh. Sulsabilah', 'Ariani Amri', 'Fajar Ramadhan'],
  ['23302058', 'Muhammad Adam', 'Ariani Amri', 'Fajar Ramadhan'],
  
  // No 50-55: Suardi & Miftahul Hairiah
  ['23302060', 'Ridwan', 'Suardi', 'Miftahul Hairiah'],
  ['23302063', 'Muh. Gerald Rofi\'f', 'Suardi', 'Miftahul Hairiah'],
  ['23302064', 'Muhammad Faiz Al-Gifari', 'Suardi', 'Miftahul Hairiah'],
  ['23302065', 'Ahmad Gazali', 'Suardi', 'Miftahul Hairiah'],
  ['23302066', 'Fendi Kurniawan', 'Suardi', 'Miftahul Hairiah'],
  
  // Tambahan lainnya
  ['23302070', 'Fitriany', 'Suardi', 'Fajar Ramadhan'],
  ['23302071', 'Muliani', 'Suardi', 'Fajar Ramadhan'],
  ['23302072', 'Hasniar', 'Suardi', 'Fajar Ramadhan'],
  ['23302074', 'Muh. Wedi', 'Suardi', 'Fajar Ramadhan'],
  ['23302081', 'Yusnia Wulandari', 'Suardi', 'Fajar Ramadhan'],
  ['23302082', 'Nurliana', 'Suardi', 'Fajar Ramadhan'],
  ['23302088', 'Lusiana', 'Suardi', 'Fajar Ramadhan'],
  ['23302094', 'Nurul Hikmah', 'Suardi', 'Fajar Ramadhan'],
  ['23302100', 'Yuliani', 'Suardi', 'Fajar Ramadhan'],
  ['23302110', 'Mawar Bilang Tua', 'Suardi', 'Fajar Ramadhan'],
  ['23302117', 'Pratiwi S', 'Suardi', 'Fajar Ramadhan'],
  ['23302120', 'Nirmala', 'Suardi', 'Fajar Ramadhan'],
  ['23302129', 'Widyanti', 'Suardi', 'Fajar Ramadhan'],
  ['23302132', 'Laura Malla', 'Suardi', 'Fajar Ramadhan'],
  ['23302138', 'Nur Ainun', 'Suardi', 'Fajar Ramadhan'],
  ['23302141', 'Aisyah Radiallahuanha', 'Suardi', 'Fajar Ramadhan'],
  ['23302144', 'Arini', 'Suardi', 'Fajar Ramadhan'],
  ['23302148', 'Rifkhu Noperdiansyah', 'Suardi', 'Fajar Ramadhan'],
];

// ============================================================================
// FUNGSI UTAMA
// ============================================================================

async function setBimbinganAngkatan2023() {
  console.log('='.repeat(70));
  console.log('📋 SET BIMBINGAN MAGANG ANGKATAN 2023');
  console.log('='.repeat(70));
  console.log('');

  const currentYear = new Date().getFullYear();
  const semester = `Genap ${currentYear}/${currentYear + 1}`;
  const tahunAjaran = `${currentYear}/${currentYear + 1}`;
  const now = new Date().toISOString();

  let success = 0;
  let failed = 0;
  let notFound = [];

  for (const [nim, nama, pembimbing1Nama, pembimbing2Nama] of bimbinganData) {
    try {
      // Cek mahasiswa
      const mahasiswaId = mahasiswaMap[nim];
      if (!mahasiswaId) {
        notFound.push({ nim, nama });
        console.log(`⚠️  SKIP: ${nama} (${nim}) - ID tidak ditemukan di mapping`);
        continue;
      }

      // Validasi mahasiswa
      const mahasiswaDoc = await db.collection('users').doc(mahasiswaId).get();
      if (!mahasiswaDoc.exists) {
        notFound.push({ nim, nama });
        console.log(`⚠️  SKIP: ${nama} (${nim}) - Dokumen tidak ditemukan`);
        continue;
      }

      // Ambil ID pembimbing
      const pembimbing1Id = dosenMap[pembimbing1Nama];
      const pembimbing2Id = dosenMap[pembimbing2Nama];

      if (!pembimbing1Id) {
        throw new Error(`Dosen ${pembimbing1Nama} tidak ditemukan di mapping`);
      }
      if (!pembimbing2Id) {
        throw new Error(`Dosen ${pembimbing2Nama} tidak ditemukan di mapping`);
      }

      // Ambil nama dosen untuk disimpan
      const pembimbing1Doc = await db.collection('dosen').doc(pembimbing1Id).get();
      const pembimbing2Doc = await db.collection('dosen').doc(pembimbing2Id).get();
      
      const pembimbing1NamaLengkap = pembimbing1Doc.exists ? pembimbing1Doc.data().nama : pembimbing1Nama;
      const pembimbing2NamaLengkap = pembimbing2Doc.exists ? pembimbing2Doc.data().nama : pembimbing2Nama;

      // Cek existing bimbingan
      const existing = await db.collection('bimbingan')
        .where('mahasiswaId', '==', mahasiswaId)
        .where('status', '==', 'active')
        .get();

      if (!existing.empty) {
        // Update
        await existing.docs[0].ref.update({
          pembimbing1Id,
          pembimbing1Nama: pembimbing1NamaLengkap,
          pembimbing2Id,
          pembimbing2Nama: pembimbing2NamaLengkap,
          semester,
          tahunAjaran,
          updatedAt: now,
        });
        console.log(`✅ UPDATE: ${nama} (${nim}) -> ${pembimbing1Nama} | ${pembimbing2Nama}`);
      } else {
        // Create
        await db.collection('bimbingan').add({
          mahasiswaId,
          pembimbing1Id,
          pembimbing1Nama: pembimbing1NamaLengkap,
          pembimbing2Id,
          pembimbing2Nama: pembimbing2NamaLengkap,
          semester,
          tahunAjaran,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        });
        console.log(`✅ CREATE: ${nama} (${nim}) -> ${pembimbing1Nama} | ${pembimbing2Nama}`);
      }
      success++;
    } catch (error) {
      failed++;
      console.log(`❌ GAGAL: ${nama} (${nim}) - ${error.message}`);
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('📊 HASIL');
  console.log('='.repeat(70));
  console.log(`✅ Berhasil: ${success}`);
  console.log(`❌ Gagal: ${failed}`);
  console.log(`⚠️  Tidak ditemukan di mapping: ${notFound.length}`);

  if (notFound.length > 0) {
    console.log('');
    console.log('📋 Daftar mahasiswa yang tidak ditemukan di mapping:');
    notFound.forEach(item => {
      console.log(`   - ${item.nama} (${item.nim})`);
    });
    console.log('');
    console.log('💡 Mahasiswa ini perlu ditambahkan ke database terlebih dahulu.');
  }

  console.log('');
  console.log('✨ Selesai!');
  process.exit(0);
}

// Jalankan
setBimbinganAngkatan2023();