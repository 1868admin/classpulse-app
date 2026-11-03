import { ATTENDANCE_FIRST_COLUMN, ATTENDANCE_HEADER_ROW, ATTENDANCE_STATUS_LABELS, attendanceColumnLabel } from './attendanceSheet.js';
import { downloadCsv, downloadWorkbookBuffer } from './spreadsheet.js';

export const TEACHER_HEADERS = ['Full Name', 'Teacher Number', 'Employment Status', 'Employment Start Date', 'Effective Date',
  'Employment Notes', 'Subject Specialisations', 'Homeroom Classes', 'Subject Classes', 'Year Dean'];
export const SUBJECT_CLASS_HEADERS = ['Subject Class Name', 'Subject', 'Form/Year Group', 'Class Section', 'Academic Year',
  'Assigned Teachers', 'Student IDs', 'Homeroom Classes', 'Room', 'Notes'];
export const EMPLOYMENT_STATUS_LABELS = ['Active', 'On leave', 'Departed'];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
const LOCKED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
const EDIT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
const MAX_TEMPLATE_CELLS = 60000;

async function createWorkbook() {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ClassPulse';
  workbook.created = new Date();
  return workbook;
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell((cell) => { cell.fill = HEADER_FILL; });
}

function addInstructions(workbook, title, lines) {
  const sheet = workbook.addWorksheet('Instructions', { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 110 }];
  sheet.addRow([title]).font = { bold: true, size: 16 };
  sheet.addRow([]);
  for (const line of lines) {
    const row = sheet.addRow([line]);
    row.alignment = { wrapText: true, vertical: 'top' };
    if (/^[A-Z][A-Za-z /&-]+:$/.test(line)) row.font = { bold: true };
  }
  return sheet;
}

// Reference lists live on a visible sheet so dropdowns can point at ranges of any length.
function addLists(workbook, lists) {
  const sheet = workbook.addWorksheet('Lists');
  const ranges = {};
  Object.entries(lists).forEach(([name, values], index) => {
    const column = index + 1;
    const header = sheet.getCell(1, column);
    header.value = name;
    header.font = { bold: true };
    sheet.getColumn(column).width = 32;
    values.forEach((value, position) => { sheet.getCell(position + 2, column).value = value; });
    const letter = sheet.getColumn(column).letter;
    ranges[name] = `Lists!$${letter}$2:$${letter}$${Math.max(values.length + 1, 2)}`;
  });
  return ranges;
}

function listValidation(formula, label) {
  return {
    type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true,
    errorStyle: 'warning', errorTitle: label, error: `Choose a ${label} from the list.`,
  };
}

async function saveWorkbook(workbook, filename) {
  downloadWorkbookBuffer(filename, await workbook.xlsx.writeBuffer());
}

/* --------------------------- Attendance --------------------------- */

export function attendanceTemplateColumns(data, sessions) {
  return data.dates.filter((item) => !item.skipped)
    .flatMap((item) => sessions.map((session) => ({ date: item.date, session, label: attendanceColumnLabel(item.date, session) })));
}

export function attendanceTemplateGrid(data, columns) {
  const usable = data.dates.filter((item) => !item.skipped);
  const range = usable.length ? `${usable[0].date} to ${usable[usable.length - 1].date}` : '';
  const grid = [
    ['Class', data.class.name],
    ['Class ID', data.class.id],
    ['Class Type', data.class.type],
    ['Academic Year', data.academic_year.name],
    ['Date Range', range],
    ['Student ID', 'First Name', 'Last Name', ...columns.map((column) => column.label)],
  ];
  for (const student of data.students) {
    grid.push([student.student_id_no, student.first_name, student.surname, ...columns.map(() => '')]);
  }
  return grid;
}

export function assertTemplateSize(data, columns) {
  if (!data.students.length) throw new Error('This class has no students to include in a template.');
  if (!columns.length) throw new Error('No school days fall inside the selected dates. Choose a different range.');
  if (columns.length * data.students.length > MAX_TEMPLATE_CELLS) {
    throw new Error('That range is too large for one template. Choose a shorter date range (for example one month).');
  }
}

export async function downloadAttendanceTemplate(data, sessions, format) {
  const columns = attendanceTemplateColumns(data, sessions);
  assertTemplateSize(data, columns);
  const safeName = data.class.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';
  const stamp = `${columns[0].date}_to_${columns[columns.length - 1].date}`;
  const grid = attendanceTemplateGrid(data, columns);
  if (format === 'csv') {
    downloadCsv(`attendance-${safeName}-${stamp}.csv`, grid[0], grid.slice(1));
    return;
  }

  const workbook = await createWorkbook();
  addInstructions(workbook, 'ClassPulse bulk attendance template', [
    'How to complete this template:',
    `1. Open the "Attendance" worksheet. It lists every student in ${data.class.name} (${data.academic_year.name}) with one column per date and session.`,
    '2. In each attendance cell choose Present, Absent, Late or Excused from the dropdown (typing P, A, L or E also works).',
    '3. Leave a cell BLANK to make NO CHANGE. A blank cell is never treated as Absent and never overwrites an existing record.',
    '4. AM and PM are separate registers. Complete only the sessions you need.',
    '5. Student IDs, names, class details and dates are locked. Students are matched by their permanent Student ID only, never by name.',
    '6. Save the file as .xlsx (or .csv) and upload it in ClassPulse under Attendance → Bulk import.',
    '',
    'What happens on upload:',
    '- ClassPulse shows a preview with new, changed and invalid entries before anything is saved.',
    '- Existing attendance is preserved unless you explicitly authorise updates during the import.',
    '- Weekends and no-school days are not included in the template.',
    '- Do not rename, move or delete the heading rows, the Student ID column or the column headings.',
    '',
    'Valid statuses:',
    ...ATTENDANCE_STATUS_LABELS.map((label) => `- ${label}`),
  ]);
  const sheet = workbook.addWorksheet('Attendance', {
    views: [{ state: 'frozen', xSplit: ATTENDANCE_FIRST_COLUMN, ySplit: ATTENDANCE_HEADER_ROW }],
  });
  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 18;
  grid.forEach((values, rowIndex) => {
    const row = sheet.getRow(rowIndex + 1);
    values.forEach((value, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      cell.value = value;
      cell.numFmt = '@';
      const isAttendanceCell = rowIndex >= ATTENDANCE_HEADER_ROW && columnIndex >= ATTENDANCE_FIRST_COLUMN;
      cell.protection = { locked: !isAttendanceCell };
      if (isAttendanceCell) {
        cell.fill = EDIT_FILL;
        cell.alignment = { horizontal: 'center' };
        cell.dataValidation = {
          type: 'list', allowBlank: true, formulae: [`"${ATTENDANCE_STATUS_LABELS.join(',')}"`], showErrorMessage: true,
          errorTitle: 'Invalid attendance status', error: 'Choose Present, Absent, Late or Excused, or leave the cell blank.',
        };
      } else if (rowIndex >= ATTENDANCE_HEADER_ROW || (rowIndex < ATTENDANCE_HEADER_ROW - 1 && columnIndex === 0)) {
        cell.fill = LOCKED_FILL;
      }
    });
  });
  for (let index = 0; index < ATTENDANCE_HEADER_ROW - 1; index += 1) sheet.getRow(index + 1).getCell(1).font = { bold: true };
  styleHeader(sheet.getRow(ATTENDANCE_HEADER_ROW));
  columns.forEach((_, position) => { sheet.getColumn(ATTENDANCE_FIRST_COLUMN + position + 1).width = 14; });
  const lastRow = grid.length;
  const lastColumn = ATTENDANCE_FIRST_COLUMN + columns.length;
  const cellRange = `${sheet.getRow(ATTENDANCE_HEADER_ROW + 1).getCell(ATTENDANCE_FIRST_COLUMN + 1).address}:${sheet.getRow(lastRow).getCell(lastColumn).address}`;
  sheet.addConditionalFormatting({
    ref: cellRange,
    rules: [
      { type: 'cellIs', operator: 'equal', formulae: ['"Absent"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFECACA' } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"Late"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE68A' } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"Excused"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFBFDBFE' } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"Present"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFBBF7D0' } } } },
    ],
  });
  // No password: this protects against accidental edits, not deliberate ones.
  await sheet.protect('', { formatColumns: true, formatRows: true, selectLockedCells: true, selectUnlockedCells: true });
  await saveWorkbook(workbook, `attendance-${safeName}-${stamp}.xlsx`);
}

/* ----------------------------- Teachers ---------------------------- */

export function teacherTemplateRows(data, includeExisting) {
  if (!includeExisting) return [];
  return data.teachers.map((teacher) => [
    teacher.full_name, teacher.teacher_number,
    ({ active: 'Active', on_leave: 'On leave', departed: 'Departed' })[teacher.employment_status] || 'Active',
    teacher.employment_start_date, '', '',
    teacher.subject_specialisms.join('; '), teacher.homeroom_classes.join('; '), teacher.subject_classes.join('; '),
    teacher.year_dean.join('; '),
  ]);
}

export async function downloadTeacherTemplate(data, { format, includeExisting }) {
  const rows = teacherTemplateRows(data, includeExisting);
  if (format === 'csv') {
    downloadCsv('teacher-import-template.csv', TEACHER_HEADERS, rows);
    return;
  }
  const workbook = await createWorkbook();
  addInstructions(workbook, 'ClassPulse teacher import template', [
    'How to complete this template:',
    '1. Add one row per teacher on the "Teachers" worksheet. Only Full Name is mandatory.',
    '2. Teacher Number identifies a teacher. Existing Teacher Numbers are never changed or regenerated. A new teacher without a number is created without one.',
    '3. Employment Status: Active, On leave or Departed (choose from the dropdown). Departed teachers can only be reinstated to Active.',
    '4. Employment Start Date and Effective Date use the format YYYY-MM-DD (for example 2026-09-01).',
    '5. Subject Specialisations, Homeroom Classes and Subject Classes accept several values separated by semicolons or commas.',
    '6. Homeroom and subject classes must already exist (see the "Lists" worksheet). Existing assignments are kept; new ones are added.',
    '7. Year Dean takes the name of a year group (choose from the dropdown).',
    '8. A teacher can be a profile only: leave the assignment columns empty.',
    '9. Teaching and Year Dean assignments require Active employment.',
    '',
    'Matching and safety:',
    '- A row whose Teacher Number already exists updates that teacher; no duplicate profile is created.',
    '- Rows that contain errors block the import until they are corrected. Nothing is partially saved.',
  ]);
  const sheet = workbook.addWorksheet('Teachers', { views: [{ state: 'frozen', ySplit: 1 }] });
  const ranges = addLists(workbook, {
    'Employment Status': EMPLOYMENT_STATUS_LABELS,
    'Year Groups': data.year_groups,
    'Homeroom Classes': data.homerooms,
    'Subject Classes': data.subject_classes,
  });
  sheet.addRow(TEACHER_HEADERS);
  styleHeader(sheet.getRow(1));
  [28, 18, 18, 20, 16, 28, 34, 28, 34, 18].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  rows.forEach((values) => sheet.addRow(values));
  const total = Math.max(rows.length + 200, 300);
  for (let row = 2; row <= total; row += 1) {
    ['B', 'D', 'E'].forEach((letter) => { sheet.getCell(`${letter}${row}`).numFmt = '@'; });
    sheet.getCell(`C${row}`).dataValidation = listValidation(ranges['Employment Status'], 'employment status');
    if (data.year_groups.length) sheet.getCell(`J${row}`).dataValidation = listValidation(ranges['Year Groups'], 'year group');
  }
  await saveWorkbook(workbook, 'teacher-import-template.xlsx');
}

/* -------------------------- Subject classes ------------------------- */

export function subjectClassTemplateRows(data, includeExisting) {
  if (!includeExisting) return [];
  return data.existing_classes.map((item) => [
    item.name, item.subject, item.year_group, item.section, item.academic_year,
    item.teachers.join('; '), '', item.homerooms.join('; '), item.room, '',
  ]);
}

export async function downloadSubjectClassTemplate(data, { format, includeExisting }) {
  const rows = subjectClassTemplateRows(data, includeExisting);
  if (format === 'csv') {
    downloadCsv('subject-class-import-template.csv', SUBJECT_CLASS_HEADERS, rows);
    return;
  }
  const workbook = await createWorkbook();
  addInstructions(workbook, 'ClassPulse subject class import template', [
    'How to complete this template:',
    '1. Add one row per subject class on the "Subject Classes" worksheet. Classes that do not exist yet are created automatically.',
    '2. Subject and Form/Year Group are mandatory. Choose them from the dropdowns (see the "Lists" worksheet).',
    '3. Subject Class Name is optional: when blank it is built from Form/Year Group, Subject and Class Section (for example "Form 4 Physics A").',
    '4. Academic Year defaults to the current academic year when left blank.',
    '5. Assigned Teachers: one or several Teacher Numbers (or exact full names) separated by semicolons or commas. The first teacher of a new class becomes its primary teacher.',
    '6. Student IDs: one or several permanent Student IDs separated by semicolons or commas. Students are never matched by name.',
    '7. Homeroom Classes (optional): existing homeroom class names that the subject class is associated with.',
    '',
    'Safety rules:',
    '- Existing classes are never replaced. Importing a class that already exists only ADDS teachers, students and homerooms that are not already assigned.',
    '- A row cannot change the subject, year group or academic year of an existing class.',
    '- Nothing is removed, and attendance history is never touched.',
    '- Rows with errors are listed in the preview; you can fix the file and upload it again.',
  ]);
  const sheet = workbook.addWorksheet('Subject Classes', { views: [{ state: 'frozen', ySplit: 1 }] });
  const ranges = addLists(workbook, {
    Subjects: data.subjects,
    'Year Groups': data.year_groups,
    'Academic Years': data.academic_years.map((year) => year.name),
    Homerooms: data.homerooms,
    'Teachers (name)': data.teachers.map((teacher) => teacher.full_name),
    'Teachers (number)': data.teachers.map((teacher) => teacher.teacher_number),
  });
  sheet.addRow(SUBJECT_CLASS_HEADERS);
  styleHeader(sheet.getRow(1));
  [30, 22, 18, 14, 16, 34, 38, 28, 12, 28].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  rows.forEach((values) => sheet.addRow(values));
  const total = Math.max(rows.length + 200, 300);
  for (let row = 2; row <= total; row += 1) {
    sheet.getCell(`G${row}`).numFmt = '@';
    sheet.getCell(`B${row}`).dataValidation = listValidation(ranges.Subjects, 'subject');
    if (data.year_groups.length) sheet.getCell(`C${row}`).dataValidation = listValidation(ranges['Year Groups'], 'year group');
    if (data.academic_years.length) sheet.getCell(`E${row}`).dataValidation = listValidation(ranges['Academic Years'], 'academic year');
  }
  await saveWorkbook(workbook, 'subject-class-import-template.xlsx');
}
