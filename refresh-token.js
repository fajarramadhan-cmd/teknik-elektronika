// get-refresh-token.js
require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const open = require('open'); // library untuk membuka browser

// Konfigurasi OAuth dari environment
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback'; // gunakan port 3001 (tidak bentrok dengan app utama)

// Scope yang diperlukan (sesuaikan dengan kebutuhan)
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Buat URL otorisasi
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',      // penting untuk mendapatkan refresh token
  scope: SCOPES,
  prompt: 'consent',            // memaksa agar refresh token selalu diberikan
});

console.log('\n🔗 Buka link berikut di browser (akan terbuka otomatis):');
console.log(authUrl);

// Buka browser otomatis
try {
  open(authUrl);
  console.log('✅ Browser akan terbuka otomatis.');
} catch (err) {
  console.log('⚠️ Gagal membuka browser. Silakan buka link manual.');
}

// Buat server lokal untuk menangani callback
const server = http.createServer(async (req, res) => {
  try {
    const query = url.parse(req.url, true).query;
    if (query.code) {
      const code = query.code;
      console.log('\n📥 Kode otorisasi diterima, menukar dengan token...');

      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n✅ Token berhasil didapatkan!\n');
      console.log('Refresh Token:', tokens.refresh_token);
      console.log('\n📝 Salin refresh token di atas dan perbarui di file .env Anda.\n');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h3>Otorisasi berhasil! Anda dapat menutup halaman ini.</h3>');
      server.close();
    } else {
      res.writeHead(400);
      res.end('Tidak ada kode');
    }
  } catch (error) {
    console.error('❌ Gagal mendapatkan token:', error);
    res.writeHead(500);
    res.end('Gagal');
    server.close();
  }
});

server.listen(3001, () => {
  console.log('⏳ Menunggu callback di http://localhost:3001/oauth2callback ...');
});