import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { validateSource } from './migrate-sqlite-to-postgres.mjs';

function createSource() {
  const source = new DatabaseSync(':memory:');
  source.exec(`
    CREATE TABLE records (entity TEXT, id TEXT, school_id TEXT, data TEXT);
    CREATE TABLE accounts (user_id TEXT, username TEXT, password_hash TEXT, active INTEGER, created_at TEXT);
    CREATE TABLE student_id_sequences (school_id TEXT, cohort_key TEXT, next_value INTEGER);
  `);
  return source;
}

function addRecord(source, entity, id, schoolId, data) {
  source.prepare('INSERT INTO records (entity, id, school_id, data) VALUES (?, ?, ?, ?)')
    .run(entity, id, schoolId, JSON.stringify(data));
}

test('validates a local dataset and returns only migration rows', () => {
  const source = createSource();
  try {
    addRecord(source, 'Student', 'student-1', 'school-1', {
      student_id_no: '2027-A1-0001',
      birth_paper_no: '',
    });
    source.prepare(
      'INSERT INTO accounts (user_id, username, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('user-1', 'teacher.one', 'salt:hash', 1, '2026-01-01T00:00:00.000Z');
    const result = validateSource(source);
    assert.equal(result.records.length, 1);
    assert.equal(result.accounts.length, 1);
    assert.deepEqual(result.sequences, []);
  } finally {
    source.close();
  }
});

test('rejects duplicate student IDs without exposing their values', () => {
  const source = createSource();
  try {
    addRecord(source, 'Student', 'student-1', 'school-1', { student_id_no: '2027-A1-0001' });
    addRecord(source, 'Student', 'student-2', 'school-1', { student_id_no: '2027-a1-0001' });
    assert.throws(() => validateSource(source), /duplicate student ID/);
  } finally {
    source.close();
  }
});

test('rejects normalized duplicate Birth Paper Numbers', () => {
  const source = createSource();
  try {
    addRecord(source, 'Student', 'student-1', 'school-1', { birth_paper_no: 'AB-123' });
    addRecord(source, 'Student', 'student-2', 'school-1', { birth_paper_no: 'ab 123' });
    assert.throws(() => validateSource(source), /duplicate Birth Paper Number/);
  } finally {
    source.close();
  }
});

test('rejects duplicate membership, attendance, enrollment, and initial-admin keys', () => {
  const cases = [
    ['ClassMembership', 'membership', {
      class_type: 'homeroom', class_id: 'class-1', student_id: 'student-1',
    }],
    ['AttendanceSession', 'session', { session_key: 'school|homeroom|class|date|period' }],
    ['StudentEnrollment', 'enrollment', {
      class_type: 'homeroom', student_id: 'student-1', source_class_id: 'class-1',
      destination_academic_year_id: 'year-2',
    }],
    ['User', 'admin', { role: 'admin', school_id: '' }],
  ];
  for (const [entity, idPrefix, record] of cases) {
    const source = createSource();
    try {
      addRecord(source, entity, `${idPrefix}-1`, 'school-1', record);
      addRecord(source, entity, `${idPrefix}-2`, 'school-1', record);
      assert.throws(() => validateSource(source), /duplicate/);
    } finally {
      source.close();
    }
  }
});
