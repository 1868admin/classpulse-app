import moment from 'moment';

const STATUS_CODES = { present: 'P', absent: 'A', late: 'L', excused: 'E' };
const STATUS_FILLS = {
  present: 'FFD1FAE5',
  absent: 'FFFEE2E2',
  late: 'FFFEF3C7',
  excused: 'FFDBEAFE',
};

function isNonSchoolDay(date, calendars) {
  return [0, 6].includes(moment(date).day()) || calendars.get(date)?.day_type === 'no_school';
}

export async function buildAttendanceWorkbook({
  schoolName,
  academicYear,
  className,
  classType,
  subject,
  teacherName,
  termName,
  label,
  month,
  days,
  members,
  cells,
  totals,
  calendars,
}) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ClassPulse';
  workbook.created = new Date();
  const finalColumn = 3 + days.length + 5;
  const sheet = workbook.addWorksheet('Attendance', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.mergeCells(1, 1, 1, finalColumn);
  sheet.getCell(1, 1).value = 'ClassPulse Monthly Attendance Register';
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
  sheet.getRow(1).height = 28;
  const metadata = [
    ['School', schoolName || '—', 'Academic year', academicYear || '—'],
    ['Class', className || '—', 'Subject', subject || (classType === 'homeroom' ? 'Form / Homeroom' : '—')],
    ['Teacher', teacherName || '—', 'Term', termName || '—'],
    ['Month', moment(`${month}-01`).format('MMMM YYYY'), 'Session', label || '—'],
  ];
  metadata.forEach((items, index) => {
    const row = sheet.getRow(index + 2);
    row.getCell(1).value = items[0];
    row.getCell(2).value = items[1];
    row.getCell(4).value = items[2];
    row.getCell(5).value = items[3];
    [1, 4].forEach((column) => {
      row.getCell(column).font = { bold: true, color: { argb: 'FF475569' } };
    });
  });
  const header = ['No.', 'Student name', 'Student ID', ...days.map((day) => {
    const dateLabel = moment(day).format('ddd D MMM');
    return isNonSchoolDay(day, calendars) ? `${dateLabel} *` : dateLabel;
  }), 'Present', 'Absent (Unexcused)', 'Late', 'Excused', 'Total marked'];
  const headerRow = sheet.addRow(header);
  headerRow.height = 35;
  headerRow.eachCell((cell, column) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column >= 4 && column < finalColumn - 4
      && days[column - 4] && isNonSchoolDay(days[column - 4], calendars) ? 'FF64748B' : 'FF1E3A8A' } };
  });
  members.forEach((student, index) => {
    const summary = totals.get(student.student_id);
    const row = sheet.addRow([
      index + 1,
      student.student_name || 'Unnamed student',
      student.student_id_no || '',
      ...days.map((day) => STATUS_CODES[cells[`${student.student_id}|${day}`]?.status] || ''),
      summary.present,
      summary.absent,
      summary.late,
      summary.excused,
      summary.marked,
    ]);
    row.eachCell((cell, column) => {
      cell.alignment = { vertical: 'middle', horizontal: column === 2 ? 'left' : 'center' };
      if (column >= 4 && column < finalColumn - 4) {
        const day = days[column - 4];
        const status = cells[`${student.student_id}|${day}`]?.status;
        if (status) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILLS[status] } };
        else if (isNonSchoolDay(day, calendars)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
    });
  });
  sheet.columns = [
    { width: 7 },
    { width: 28 },
    { width: 18 },
    ...days.map(() => ({ width: 8 })),
    ...Array.from({ length: 5 }, () => ({ width: 15 })),
  ];
  sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + members.length, column: finalColumn } };
  sheet.addRow([]);
  sheet.addRow(['* Weekend or date marked No School in the school calendar.']);
  const safeName = (className || 'class').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return {
    filename: `attendance-${safeName}-${month}.xlsx`,
    buffer: await workbook.xlsx.writeBuffer(),
  };
}
