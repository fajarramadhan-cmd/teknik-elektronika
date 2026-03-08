/**
 * routes/mahasiswa/kalender.js
 * Menampilkan kalender akademik 6 bulan ke depan untuk mahasiswa
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);

// Helper untuk mendapatkan nama hari dalam bahasa Indonesia
const daysInWeek = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function getMonthDays(year, month, eventsInMonth) {
  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = firstDay.getDay(); // 0 = Minggu, 1 = Senin, ... (di JS Minggu = 0)
  // Ubah ke Senin = 0
  let startOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // Senin = 0, Minggu = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = [];
  // Sel kosong sebelum tanggal 1
  for (let i = 0; i < startOffset; i++) {
    days.push({ date: null, events: [] });
  }
  // Tanggal 1 sampai akhir bulan
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const events = eventsInMonth.filter(e => e.tanggal === dateStr);
    days.push({ date: d, events });
  }
  // Tambahkan sel kosong agar total kelipatan 7 (bisa 35 atau 42)
  const totalCells = Math.ceil(days.length / 7) * 7;
  while (days.length < totalCells) {
    days.push({ date: null, events: [] });
  }
  return days;
}

function groupEventsByMonth(events) {
  const months = [];
  const today = new Date();
  for (let i = 0; i < 6; i++) {
    const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthName = date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    months.push({
      monthName,
      monthIndex: date.getMonth(),
      year: date.getFullYear(),
      events: []
    });
  }

  events.forEach(event => {
    const eventDate = new Date(event.tanggal);
    const eventMonth = eventDate.getMonth();
    const eventYear = eventDate.getFullYear();
    const monthItem = months.find(m => m.monthIndex === eventMonth && m.year === eventYear);
    if (monthItem) {
      monthItem.events.push(event);
    }
  });

  // Untuk setiap bulan, buat array days
  months.forEach(m => {
    m.days = getMonthDays(m.year, m.monthIndex, m.events);
  });

  return months;
}

router.get('/', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const snapshot = await db.collection('jadwalPenting')
      .where('tanggal', '>=', today)
      .orderBy('tanggal', 'asc')
      .get();
    const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const months = groupEventsByMonth(events);

    res.render('mahasiswa/kalender', { 
      title: 'Kalender Akademik', 
      user: req.user, 
      months
    });
  } catch (error) {
    console.error('Error mengambil kalender akademik:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat kalender akademik' 
    });
  }
});

module.exports = router;