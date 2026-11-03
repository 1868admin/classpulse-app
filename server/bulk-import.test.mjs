import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setupToken = 'test-only-first-admin-key-0123456789abcdef';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('bulk attendance, teacher and subject class imports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-bulk-'));
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/index.mjs'], {
    cwd: root,
    env: { ...process.env, CLASSPULSE_DATA_DIR: path.join(dir, 'data'), CLASSPULSE_HOST: '127.0.0.1', CLASSPULSE_PORT: String(port), INITIAL_ADMIN_SETUP_TOKEN: setupToken },
    stdio: 'ignore',
  });
  const call = async (route, method = 'GET', body, cookie = '') => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  };
  let adminCookie = '';
  const as = (cookie) => (name, body) => call(`/api/functions/${name}`, 'POST', body, cookie);
  const admin = (name, body) => as(adminCookie)(name, body);

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    const setup = await call('/api/auth/setup', 'POST', {
      fullName: 'Bulk Admin', username: 'bulk.admin', email: 'bulk.admin@example.test', password: 'valid-test-password', setupToken,
    });
    assert.equal(setup.status, 201);
    adminCookie = setup.headers.get('set-cookie').split(';')[0];
    const school = (await admin('provisionSchool', { name: 'Bulk School', year_start: '2026-09-01', year_end: '2027-06-30', year_group_names: ['Form 1'] })).data.school;
    const batch = async (queries) => (await admin('queryBatch', { queries })).data.results;
    const [[yearGroup], [year]] = (await batch([
      { entity: 'YearGroup', query: { school_id: school.id }, options: { limit: 10 } },
      { entity: 'AcademicYear', query: { school_id: school.id }, options: { limit: 10 } },
    ])).map((result) => result.items);

    const invite = async (values) => (await admin('manageStaff', { action: 'invite', role: 'teacher', ...values })).data.member;
    const homeTeacher = await invite({ full_name: 'Hanna Home', username: 'hanna.h', password: 'teacher-password-1', teacher_number: 'TN-001' });
    const subjTeacher = await invite({ full_name: 'Sam Subject', username: 'sam.s', password: 'teacher-password-2', teacher_number: 'TN-002' });
    const otherTeacher = await invite({ full_name: 'Olga Other', username: 'olga.o', password: 'teacher-password-3', teacher_number: 'TN-003' });
    const login = async (username, password) => (await call('/api/auth/login', 'POST', { username, password })).headers.get('set-cookie').split(';')[0];
    const homeCookie = await login('hanna.h', 'teacher-password-1');
    const subjCookie = await login('sam.s', 'teacher-password-2');
    const otherCookie = await login('olga.o', 'teacher-password-3');

    const homeroom = (await admin('saveClass', { type: 'homeroom', class: { name: 'Form 1A', year_group_id: yearGroup.id }, teacher_ids: [homeTeacher.id] })).data.class;
    const subject = (await admin('saveClass', { type: 'subject', class: { name: 'F1 Maths', subject: 'Mathematics' }, teacher_ids: [subjTeacher.id] })).data.class;
    const imported = await admin('importStudents', {
      rows: [
        { first_name: 'Ann', surname: 'Alpha', student_id_no: '001' },
        { first_name: 'Ben', surname: 'Beta', student_id_no: '002' },
        { first_name: 'Cy', surname: 'Gamma', student_id_no: '003' },
      ],
      defaults: { year_group_id: yearGroup.id, homeroom_class_id: homeroom.id },
    });
    assert.equal(imported.data.imported, 3);
    const students = (await batch([{ entity: 'Student', query: { school_id: school.id }, options: { limit: 10 } }]))[0].items;
    const ids = Object.fromEntries(students.map((student) => [student.first_name, student.student_id_no]));
    assert.ok(ids.Ann && ids.Ben && ids.Cy);
    await admin('assignStudents', { class_type: 'subject', class_id: subject.id, student_ids: students.filter((s) => s.first_name !== 'Cy').map((s) => s.id) });

    const cell = (row, student_id_no, date, session, status) => ({ row, column: 'D', student_id_no, date, session, status });
    const body = (cells, extra = {}) => ({ class_type: 'homeroom', class_id: homeroom.id, academic_year: year.name, cells, ...extra });

    // template data skips weekends
    const template = await admin('bulkAttendance', { action: 'template_data', class_type: 'homeroom', class_id: homeroom.id, start_date: '2026-09-04', end_date: '2026-09-08' });
    assert.equal(template.status, 200);
    assert.equal(template.data.students.length, 3);
    assert.deepEqual(template.data.dates.filter((d) => d.skipped).map((d) => d.date), ['2026-09-05', '2026-09-06']);

    // preview: valid, duplicate, bad id, bad status, bad date, non-member
    const cells = [
      cell(7, ids.Ann, '2026-09-01', 'AM', 'Present'),
      cell(7, ids.Ann, '2026-09-01', 'PM', 'Absent'),
      cell(8, ids.Ben, '2026-09-01', 'AM', 'Late'),
      cell(8, ids.Ben, '2026-09-01', 'AM', 'Late'),
      cell(9, 'NOPE', '2026-09-01', 'AM', 'Present'),
      cell(9, ids.Cy, '2026-09-01', 'AM', 'Sleepy'),
      cell(9, ids.Cy, '2025-01-01', 'AM', 'Present'),
    ];
    const preview = await admin('bulkAttendance', { action: 'preview', ...body(cells, { blank_count: 4 }) });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.summary.valid, 3);
    assert.equal(preview.data.summary.invalid, 4);
    assert.equal(preview.data.summary.blank, 4);
    assert.ok(preview.data.issues.every((issue) => issue.row && issue.message));

    // saving with invalid rows requires skip_invalid; nothing written otherwise
    const blocked = await admin('bulkAttendance', { action: 'commit', ...body(cells), fingerprint: preview.data.fingerprint });
    assert.equal(blocked.status, 400);
    assert.equal((await batch([{ entity: 'AttendanceRecord', query: { school_id: school.id }, options: { limit: 50 } }]))[0].items.length, 0);

    const good = await admin('bulkAttendance', { action: 'commit', ...body(cells), skip_invalid: true, fingerprint: preview.data.fingerprint });
    assert.equal(good.status, 200, JSON.stringify(good.data));
    assert.equal(good.data.created, 3);
    const sessions = (await batch([{ entity: 'AttendanceSession', query: { school_id: school.id }, options: { limit: 50 } }]))[0].items;
    assert.deepEqual(sessions.map((s) => s.session_label).sort(), ['Afternoon', 'Morning']);
    const afternoon = sessions.find((s) => s.session_label === 'Afternoon');
    assert.equal(afternoon.absent_count, 1);

    // existing record preserved unless explicitly authorised
    const change = [cell(7, ids.Ann, '2026-09-01', 'AM', 'Absent'), cell(8, ids.Cy, '2026-09-01', 'AM', 'Present')];
    const preview2 = await admin('bulkAttendance', { action: 'preview', ...body(change) });
    assert.equal(preview2.data.summary.updates, 1);
    assert.equal(preview2.data.summary.created, 1);
    const kept = await admin('bulkAttendance', { action: 'commit', ...body(change), fingerprint: preview2.data.fingerprint });
    assert.equal(kept.data.updated, 0);
    assert.equal(kept.data.created, 1);
    const record = async (studentId, label) => {
      const items = (await batch([{ entity: 'AttendanceRecord', query: { school_id: school.id, student_id: studentId }, options: { limit: 50 } }]))[0].items;
      const sessionRows = (await batch([{ entity: 'AttendanceSession', query: { school_id: school.id }, options: { limit: 50 } }]))[0].items;
      return items.find((item) => sessionRows.find((s) => s.id === item.session_id)?.session_label === label);
    };
    const ann = students.find((s) => s.first_name === 'Ann');
    assert.equal((await record(ann.id, 'Morning')).status, 'present');
    const overwritten = await admin('bulkAttendance', { action: 'commit', ...body(change), overwrite: true, fingerprint: (await admin('bulkAttendance', { action: 'preview', ...body(change) })).data.fingerprint });
    assert.equal(overwritten.data.updated, 1);
    assert.equal((await record(ann.id, 'Morning')).status, 'absent');
    assert.equal((await record(ann.id, 'Afternoon')).status, 'absent');

    // stale fingerprint is rejected
    const stale = await admin('bulkAttendance', { action: 'commit', ...body(change), overwrite: true, fingerprint: 'stale' });
    assert.equal(stale.status, 409);

    // permissions
    const pv = (cookie, payload) => as(cookie)('bulkAttendance', { action: 'preview', ...payload });
    assert.equal((await pv(homeCookie, body([cell(7, ids.Ann, '2026-09-02', 'AM', 'Present')]))).status, 200);
    assert.equal((await pv(otherCookie, body([cell(7, ids.Ann, '2026-09-02', 'AM', 'Present')]))).status, 403);
    assert.equal((await pv(subjCookie, body([cell(7, ids.Ann, '2026-09-02', 'AM', 'Present')]))).status, 403);
    const subjBody = { class_type: 'subject', class_id: subject.id, academic_year: year.name, cells: [cell(7, ids.Ann, '2026-09-02', 'PM', 'Present'), cell(8, ids.Cy, '2026-09-02', 'PM', 'Present')] };
    const subjPreview = await pv(subjCookie, subjBody);
    assert.equal(subjPreview.status, 200);
    assert.equal(subjPreview.data.summary.valid, 1);
    assert.equal(subjPreview.data.summary.invalid, 1);
    assert.equal((await pv(otherCookie, subjBody)).status, 403);

    // existing submitAttendance still works for the homeroom
    const submit = await as(homeCookie)('submitAttendance', {
      class_type: 'homeroom', class_id: homeroom.id, date: '2026-09-10', session_label: 'Morning',
      records: students.map((s) => ({ student_id: s.id, status: 'present' })),
    });
    assert.ok(submit.status < 500, JSON.stringify(submit.data));

    // subject class import: new classes, multiple teachers, invalid refs, additive existing
    const sub = (rows, action = 'preview', extra = {}) => admin('bulkSubjectClasses', { action, rows, ...extra });
    const rows = [
      { __row: 2, subject: 'Physics', year_group: 'Form 1', section: 'A', teachers: 'TN-001; TN-002', students: `${ids.Ann}, ${ids.Ben}` },
      { __row: 3, subject: 'History', year_group: 'Form 1', section: 'B', teachers: 'TN-003' },
      { __row: 4, subject: 'Physics', year_group: 'Form 9', teachers: 'TN-999', students: 'XXXX' },
      { __row: 5, subject: '', year_group: 'Form 1' },
    ];
    const subPreview = await sub(rows);
    assert.equal(subPreview.status, 200, JSON.stringify(subPreview.data));
    assert.equal(subPreview.data.summary.create, 2, JSON.stringify(subPreview.data.rows));
    assert.equal(subPreview.data.summary.invalid, 2);
    assert.equal((await sub(rows, 'commit')).status, 400);
    const subCommit = await sub(rows, 'commit', { skip_invalid: true });
    assert.equal(subCommit.status, 200, JSON.stringify(subCommit.data));
    assert.equal(subCommit.data.created, 2);
    assert.equal(subCommit.data.teachers_added, 3);
    assert.equal(subCommit.data.students_added, 2);
    const again = await sub([rows[0]], 'preview');
    assert.equal(again.data.summary.create, 0);
    assert.notEqual(again.data.rows[0].operation, 'create');
    const dup = await sub([rows[1], rows[1]], 'preview');
    assert.ok(dup.data.summary.invalid >= 1);
    // an unrelated teacher can only import into classes they teach
    const otherSub = await as(otherCookie)('bulkSubjectClasses', { action: 'preview', rows: [{ __row: 2, subject: 'Music', year_group: 'Form 1', section: 'Z' }] });
    assert.equal(otherSub.status, 200);
    assert.equal(otherSub.data.summary.create, 1);

    // teacher import: multiple assignments
    const tData = await admin('manageStaff', { action: 'import_template_data' });
    assert.equal(tData.status, 200);
    const tRows = [
      { __row: 2, full_name: 'New Teacher', teacher_number: 'TN-100', employment_status: 'active', employment_start_date: '2026-08-01', subject_specialisms: 'Mathematics; Physics', homeroom_classes: '', subject_classes: 'F1 Maths, Form 1 Physics A' },
      { __row: 3, full_name: 'Profile Only', teacher_number: 'TN-101' },
      { __row: 4, full_name: 'Dup', teacher_number: 'TN-001' },
      { __row: 5, full_name: 'Bad Ref', teacher_number: 'TN-102', subject_classes: 'Nonexistent' },
    ];
    const tPreview = await admin('manageStaff', { action: 'import_preview', rows: tRows });
    assert.equal(tPreview.data.summary.invalid, 1);
    assert.equal(tPreview.data.rows.find((r) => r.row === 5).errors.length > 0, true);
    assert.equal((await admin('manageStaff', { action: 'import_apply', rows: tRows })).status, 400);
    const tOk = await admin('manageStaff', { action: 'import_apply', rows: tRows.slice(0, 3) });
    assert.equal(tOk.status, 200, JSON.stringify(tOk.data));
    assert.equal(tOk.data.created, 2);
    // teachers cannot run staff imports
    assert.ok([401, 403].includes((await as(homeCookie)('manageStaff', { action: 'import_preview', rows: tRows })).status));
  } finally {
    child.kill();
  }
});
