import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkCells, normalizeDates, isSelectableDate } from './bulkDates.js';

const students = [{ student_id_no: '1' }, { student_id_no: '2' }];
const statusOf = () => 'present';
const build = (dates, sessions) => buildBulkCells({ dates, sessions, students, statusOf });
const days = (cells) => [...new Set(cells.map((c) => c.date))];

test('one date', () => assert.equal(build(['2026-09-02'], ['AM']).length, 2));
test('five non-consecutive dates leave gaps untouched', () => {
  const picked = ['2026-09-02', '2026-09-04', '2026-09-09', '2026-09-15', '2026-09-22'];
  const cells = build(picked, ['AM', 'PM']);
  assert.deepEqual(days(cells), picked);
  assert.equal(cells.length, 5 * 2 * 2);
});
test('consecutive dates', () => assert.deepEqual(days(build(['2026-09-03', '2026-09-02'], ['PM'])), ['2026-09-02', '2026-09-03']));
test('removing a date', () => {
  const left = normalizeDates(['2026-09-02', '2026-09-04', '2026-09-09']).filter((d) => d !== '2026-09-04');
  assert.deepEqual(days(build(left, ['AM'])), ['2026-09-02', '2026-09-09']);
});
test('sessions AM / PM / both', () => {
  const d = ['2026-09-02', '2026-09-04'];
  assert.deepEqual([...new Set(build(d, ['AM']).map((c) => c.session))], ['AM']);
  assert.deepEqual([...new Set(build(d, ['PM']).map((c) => c.session))], ['PM']);
  assert.equal(build(d, ['AM', 'PM']).length, 8);
});
test('duplicates removed, only selected students', () => {
  assert.equal(build(['2026-09-02', '2026-09-02'], ['AM']).length, 2);
  assert.equal(buildBulkCells({ dates: ['2026-09-02'], sessions: ['AM'], students: [students[0]], statusOf }).length, 1);
});
test('selectable rules', () => {
  const rule = { start: '2026-09-01', end: '2026-12-18', noSchool: ['2026-09-07'] };
  assert.equal(isSelectableDate('2026-09-02', rule), true);
  assert.equal(isSelectableDate('2026-09-05', rule), false);
  assert.equal(isSelectableDate('2026-09-07', rule), false);
  assert.equal(isSelectableDate('2026-08-31', rule), false);
});
