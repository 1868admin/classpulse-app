import { cellText, columnLetter } from './spreadsheet.js';

export const ATTENDANCE_STATUS_LABELS = ['Present', 'Absent', 'Late', 'Excused'];
export const ATTENDANCE_HEADER_ROW = 6;
export const ATTENDANCE_FIRST_COLUMN = 3;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value) => String(value).padStart(2, '0');
const norm = (value) => cellText(value).toLocaleLowerCase().replace(/[^a-z0-9]/g, '');

export function attendanceColumnLabel(isoDate, session) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${day} ${year} ${session}`;
}

function validIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}` : '';
}

/** Understands "Sep 1 2026 AM", "Sep 1, 2026 PM", "2026-09-01 AM", "1 Sep 2026 AM" and "Sept 1 AM" (year from the date range). */
export function parseAttendanceHeader(value, fallbackYears = []) {
  const text = cellText(value).replace(/\s+/g, ' ');
  const match = text.match(/^(.*?)[\s_-]*(AM|PM)$/i);
  if (!match) return null;
  const session = match[2].toUpperCase();
  const datePart = match[1].trim().replace(/,/g, '');
  let iso = '';
  let found;
  if ((found = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) iso = validIso(+found[1], +found[2], +found[3]);
  else if ((found = datePart.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?: (\d{4}))?$/))) {
    const month = MONTHS.indexOf(found[1].slice(0, 3).toLowerCase()) + 1;
    iso = resolveYear(month, +found[2], found[3] ? +found[3] : 0, fallbackYears);
  } else if ((found = datePart.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.?(?: (\d{4}))?$/))) {
    const month = MONTHS.indexOf(found[2].slice(0, 3).toLowerCase()) + 1;
    iso = resolveYear(month, +found[1], found[3] ? +found[3] : 0, fallbackYears);
  }
  return iso ? { date: iso, session } : { date: datePart, session, invalid: true };
}

function resolveYear(month, day, year, fallbackYears) {
  if (!month) return '';
  if (year) return validIso(year, month, day);
  for (const candidate of fallbackYears) {
    const iso = validIso(candidate, month, day);
    if (iso) return iso;
  }
  return '';
}

/** Converts a template grid (Excel or CSV) into server-ready attendance cells. Blank cells are counted, never sent. */
export function parseAttendanceGrid(rows) {
  const meta = {};
  let headerIndex = -1;
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const label = norm(rows[index][0]);
    if (label === 'studentid') { headerIndex = index; break; }
    if (label) meta[label] = cellText(rows[index][1]);
  }
  if (headerIndex < 0) {
    throw new Error('This is not a ClassPulse attendance template. Download the template from Attendance → Bulk import and complete it.');
  }
  const classId = meta.classid;
  if (!classId) throw new Error('The Class ID is missing from the template. Download a fresh template for the class.');
  const classType = meta.classtype === 'subject' ? 'subject' : 'homeroom';
  const rangeYears = (meta.daterange || '').match(/\d{4}/g)?.map(Number) || [];

  const header = rows[headerIndex];
  const columns = [];
  for (let column = ATTENDANCE_FIRST_COLUMN; column < header.length; column += 1) {
    if (!cellText(header[column])) continue;
    columns.push({ column, label: cellText(header[column]), parsed: parseAttendanceHeader(header[column], rangeYears) });
  }
  if (!columns.length) throw new Error('No attendance columns were found in the template.');

  const cells = [];
  let blank = 0;
  let studentRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const studentId = cellText(row[0]);
    const values = columns.map((item) => cellText(row[item.column]));
    if (!studentId && !values.some(Boolean)) continue;
    studentRows += 1;
    columns.forEach((item, position) => {
      const status = values[position];
      if (!status) { blank += 1; return; }
      cells.push({
        row: index + 1,
        column: columnLetter(item.column),
        student_id_no: studentId,
        student_name: `${cellText(row[1])} ${cellText(row[2])}`.trim(),
        date: item.parsed?.date || item.label,
        session: item.parsed?.session || '',
        status,
      });
    });
  }
  return {
    class_id: classId,
    class_type: classType,
    academic_year: meta.academicyear || '',
    cells,
    blank_count: blank,
    student_rows: studentRows,
    column_count: columns.length,
  };
}

export function findAttendanceGrid(sheets) {
  return (sheets.find((sheet) => sheet.name.toLowerCase() === 'attendance')
    || sheets.find((sheet) => sheet.rows.slice(0, 40).some((row) => norm(row[0]) === 'studentid')))?.rows;
}
