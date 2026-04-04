// scripts/getAllUsers.js
// Jalankan dengan: node scripts/getAllUsers.js

const { db } = require('./config/firebaseAdmin');
const admin = require('firebase-admin');

async function getAllUsers() {
  console.log('='.repeat(70));
  console.log('📋 DAFTAR SEMUA USER DI FIRESTORE');
  console.log('='.repeat(70));
  console.log('');

  try {
    // 1. Ambil semua mahasiswa
    console.log('👨‍🎓 MAHASISWA:');
    console.log('-'.repeat(70));
    
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nim')
      .get();
    
    if (mahasiswaSnapshot.empty) {
      console.log('   Tidak ada data mahasiswa.');
    } else {
      console.log(`   Total: ${mahasiswaSnapshot.size} mahasiswa\n`);
      console.log('   | No | User ID                            | NIM       | Nama');
      console.log('   |----|------------------------------------|-----------|------------------');
      
      let no = 1;
      mahasiswaSnapshot.forEach(doc => {
        const data = doc.data();
        const userId = doc.id;
        const nim = data.nim || '-';
        const nama = data.nama || '-';
        
        console.log(`   | ${no.toString().padEnd(2)} | ${userId.padEnd(34)} | ${nim.padEnd(9)} | ${nama}`);
        no++;
      });
    }
    
    console.log('');
    console.log('='.repeat(70));
    console.log('');
    
    // 2. Ambil semua dosen
    console.log('👨‍🏫 DOSEN:');
    console.log('-'.repeat(70));
    
    const dosenSnapshot = await db.collection('dosen')
      .orderBy('nama')
      .get();
    
    if (dosenSnapshot.empty) {
      console.log('   Tidak ada data dosen.');
    } else {
      console.log(`   Total: ${dosenSnapshot.size} dosen\n`);
      console.log('   | No | User ID                            | NIDN      | Nama');
      console.log('   |----|------------------------------------|-----------|------------------');
      
      let no = 1;
      dosenSnapshot.forEach(doc => {
        const data = doc.data();
        const userId = doc.id;
        const nidn = data.nidn || '-';
        const nama = data.nama || '-';
        
        console.log(`   | ${no.toString().padEnd(2)} | ${userId.padEnd(34)} | ${nidn.padEnd(9)} | ${nama}`);
        no++;
      });
    }
    
    console.log('');
    console.log('='.repeat(70));
    console.log('');
    
    // 3. Simpan ke file (opsional)
    const fs = require('fs');
    const output = {
      mahasiswa: [],
      dosen: [],
      generatedAt: new Date().toISOString()
    };
    
    mahasiswaSnapshot.forEach(doc => {
      output.mahasiswa.push({
        id: doc.id,
        nim: doc.data().nim,
        nama: doc.data().nama,
        email: doc.data().email
      });
    });
    
    dosenSnapshot.forEach(doc => {
      output.dosen.push({
        id: doc.id,
        nidn: doc.data().nidn,
        nama: doc.data().nama,
        email: doc.data().email
      });
    });
    
    fs.writeFileSync('users_data.json', JSON.stringify(output, null, 2));
    console.log('✅ Data juga disimpan ke file: users_data.json');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

getAllUsers();