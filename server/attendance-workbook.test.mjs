import assert from 'node:assert/strict';
import moment from 'moment';
import ExcelJS from 'exceljs';
import test from 'node:test';
import { buildAttendanceWorkbook } from '../src/lib/attendanceWorkbook.js';

test('monthly attendance export includes metadata, daily marks, totals and non-school dates', async () => {
  const month = '2026-09';
  const days = Array.from({ length: 30 }, (_, index) =>
    moment(`${month}-01`).add(index, 'days').format('YYYY-MM-DD'));
  const totals = new Map([['student-1', {
    present: 1,
    absent: 1,
    late: 0,
    excused: 0,
    marked: 2,
  }]]);
  const calendars = new Map([['2026-09-05', { day_type: 'no_school', reason: 'Holiday' }]]);
  const { filename, buffer } = await buildAttendanceWorkbook({
    schoolName: 'Attendance School',
    academicYear: '2026/2027',
    className: '3A3',
    classType: 'homeroom',
    subject: '',
    teacherName: 'Teacher One',
    termName: 'Term 1',
    label: 'Morning',
    month,
    days,
    members: [{ student_id: 'student-1', student_name: 'Alma Alpha', student_id_no: 'A-001' }],
    cells: {
      'student-1|2026-09-01': { status: 'present' },
      'student-1|2026-09-02': { status: 'absent' },
    },
    totals,
    calendars,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Attendance');
  const presentColumn = 4 + days.length;
  const absentColumn = presentColumn + 1;

  assert.equal(filename, 'attendance-3a3-2026-09.xlsx');
  assert.equal(workbook.creator, 'ClassPulse');
  assert.equal(sheet.getCell(1, 1).value, 'ClassPulse Monthly Attendance Register');
  assert.equal(sheet.getCell(2, 2).value, 'Attendance School');
  assert.equal(sheet.getCell(2, 5).value, '2026/2027');
  assert.equal(sheet.getCell(3, 2).value, '3A3');
  assert.equal(sheet.getCell(3, 5).value, 'Form / Homeroom');
  assert.equal(sheet.getCell(4, 2).value, 'Teacher One');
  assert.equal(sheet.getCell(5, 2).value, 'September 2026');
  assert.equal(sheet.getCell(5, 5).value, 'Morning');
  assert.equal(sheet.getCell(6, 4).value, 'Tue 1 Sep');
  assert.equal(sheet.getCell(6, 8).value, 'Sat 5 Sep *');
  assert.equal(sheet.getCell(7, 2).value, 'Alma Alpha');
  assert.equal(sheet.getCell(7, 3).value, 'A-001');
  assert.equal(sheet.getCell(7, 4).value, 'P');
  assert.equal(sheet.getCell(7, 5).value, 'A');
  assert.equal(sheet.getCell(7, 4).fill.fgColor.argb, 'FFD1FAE5');
  assert.equal(sheet.getCell(6, 8).fill.fgColor.argb, 'FF64748B');
  assert.equal(sheet.getCell(7, 8).fill.fgColor.argb, 'FFF1F5F9');
  assert.equal(sheet.getCell(6, absentColumn).value, 'Absent (Unexcused)');
  assert.deepEqual([
    sheet.getCell(7, presentColumn).value,
    sheet.getCell(7, absentColumn).value,
    sheet.getCell(7, absentColumn + 1).value,
    sheet.getCell(7, absentColumn + 2).value,
    sheet.getCell(7, absentColumn + 3).value,
  ], [1, 1, 0, 0, 2]);
});
