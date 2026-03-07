function getCurrentAcademicSemester() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  let semester, tahunAwal, tahunAkhir;

  if (month >= 2 && month <= 7) {
    semester = "Genap";
    tahunAwal = year - 1;
    tahunAkhir = year;
  } else if (month >= 8 && month <= 12) {
    semester = "Ganjil";
    tahunAwal = year;
    tahunAkhir = year + 1;
  } else {
    // Januari
    semester = "Ganjil";
    tahunAwal = year - 1;
    tahunAkhir = year;
  }
  return {
    semester,
    tahunAwal,
    tahunAkhir,
    label: `${semester} ${tahunAwal}/${tahunAkhir}`,
    tahunAkademik: `${tahunAwal}/${tahunAkhir}`  // <-- tambahkan ini
  };
}

function getAngkatanFromNim(nim) {
  if (!nim || nim.length < 2) return null;
  const twoDigit = parseInt(nim.substring(0, 2), 10);
  if (isNaN(twoDigit)) return null;
  return 2000 + twoDigit;
}

function getStudentCurrentSemester(angkatan) {
  const current = getCurrentAcademicSemester();
  const tahunAwal = current.tahunAwal;
  const isGanjil = current.semester === "Ganjil";
  let semester = (tahunAwal - angkatan) * 2;
  if (isGanjil) semester += 1;
  else semester += 2;
  return semester;
}

module.exports = {
  getCurrentAcademicSemester,
  getAngkatanFromNim,
  getStudentCurrentSemester
};