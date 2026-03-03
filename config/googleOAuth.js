// config/googleOAuth.js

const { google } = require("googleapis");
const env = require("./env");

// Buat OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

// Set refresh token dari ENV
oauth2Client.setCredentials({
  refresh_token: env.GOOGLE_REFRESH_TOKEN,
});

// Optional: log saat token diperbarui
oauth2Client.on("tokens", (tokens) => {
  if (tokens.access_token) {
    console.log("Access token diperbarui otomatis");
  }

  if (tokens.refresh_token) {
    console.log("Refresh token baru diterima (simpan jika perlu)");
  }
});

module.exports = oauth2Client;