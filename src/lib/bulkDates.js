const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const toIso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const fromIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Unique, valid, sorted ISO dates.
export const normalizeDates = (dates) => [...new Set((dates || []).filter((d) => ISO.test(d)))].sort();

export const isSelectableDate = (iso, { start = '', end = '', noSchool = [] } = {}) => {
  const day = fromIso(iso).getDay();
  if (day === 0 || day === 6) return false;
  if (start && iso < start) return false;
  if (end && iso > end) return false;
  return !noSchool.includes(iso);
};

// Only the selected dates x sessions x students are produced; dates in between are never included.
export const buildBulkCells = ({ dates, sessions, students, statusOf }) => {
  const cells = [];
  let row = 0;
  for (const date of normalizeDates(dates)) {
    for (const session of sessions) {
      for (const student of students) {
        row += 1;
        cells.push({ row, student_id_no: student.student_id_no, date, session, status: statusOf(student) });
      }
    }
  }
  return cells;
};
