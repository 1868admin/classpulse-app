import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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

test('attendance updates are additive, correctable, clearable and session-specific', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-attendance-'));
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      CLASSPULSE_DATA_DIR: path.join(dir, 'data'),
      CLASSPULSE_HOST: '127.0.0.1',
      CLASSPULSE_PORT: String(port),
      INITIAL_ADMIN_SETUP_TOKEN: setupToken,
    },
    stdio: 'ignore',
  });
  const call = async (route, method = 'GET', body, cookie = '') => {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  };
  const invokeAs = (cookie) => (name, body) => call(`/api/functions/${name}`, 'POST', body, cookie);

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(healthy, true, 'the test server should start');

    const setup = await call('/api/auth/setup', 'POST', {
      fullName: 'Attendance Admin',
      username: 'attendance.admin',
      password: 'valid-test-password',
      setupToken,
    });
    const adminCookie = setup.headers.get('set-cookie').split(';')[0];
    const admin = invokeAs(adminCookie);
    const school = (await admin('provisionSchool', {
      name: 'Attendance School',
      year_start: '2026-09-01',
      year_end: '2027-06-30',
      year_group_names: ['Form 1'],
    })).data.school;
    const teacher = (await admin('manageStaff', {
      action: 'invite',
      full_name: 'Attendance Teacher',
      role: 'teacher',
      username: 'attendance.teacher',
      password: 'teacher-test-password',
    })).data.member;
    const unassigned = (await admin('manageStaff', {
      action: 'invite',
      full_name: 'Other Teacher',
      role: 'teacher',
      username: 'attendance.other',
      password: 'other-test-password',
    })).data.member;
    const klass = (await admin('saveClass', {
      type: 'homeroom',
      class: { name: 'Form 1A' },
      teacher_ids: [teacher.id],
    })).data.class;
    const yearGroup = (await admin('queryBatch', {
      queries: [{ entity: 'YearGroup', query: { school_id: school.id }, options: { limit: 10 } }],
    })).data.results[0].items[0];
    const imported = await admin('importStudents', {
      rows: [
        { first_name: 'Alma', surname: 'Alpha', student_id_no: 'A-001' },
        { first_name: 'Basil', surname: 'Beta', student_id_no: 'A-002' },
      ],
      defaults: { year_group_id: yearGroup.id, homeroom_class_id: klass.id },
    });
    const [firstId, secondId] = imported.data.student_ids;
    const [first, second] = (await admin('queryBatch', {
      queries: [{ entity: 'Student', query: { school_id: school.id }, options: { limit: 10 } }],
    })).data.results[0].items;
    assert.deepEqual(new Set([first.id, second.id]), new Set([firstId, secondId]));
    const teacherLogin = await call('/api/auth/login', 'POST', {
      username: 'attendance.teacher',
      password: 'teacher-test-password',
    });
    const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];
    const teacherCall = invokeAs(teacherCookie);
    const otherLogin = await call('/api/auth/login', 'POST', {
      username: 'attendance.other',
      password: 'other-test-password',
    });
    const otherCall = invokeAs(otherLogin.headers.get('set-cookie').split(';')[0]);
    const attendance = (date, sessionLabel, records) => ({
      class_type: 'homeroom',
      class_id: klass.id,
      class_name: klass.name,
      date,
      session_label: sessionLabel,
      records,
    });
    const record = (student, status) => ({
      student_id: student.id,
      student_name: student.full_name,
      student_id_no: student.student_id_no,
      status,
    });

    const firstMark = await teacherCall('submitAttendance', attendance('2026-09-08', 'Morning', [record(first, 'present')]));
    assert.equal(firstMark.status, 200);
    assert.equal(firstMark.data.session.student_count, 1);
    assert.equal(firstMark.data.session.present_count, 1);
    assert.equal(firstMark.data.session.status, 'in_progress');

    const secondMark = await teacherCall('submitAttendance', attendance('2026-09-08', 'Morning', [record(second, 'absent')]));
    assert.equal(secondMark.data.session.student_count, 2);
    assert.equal(secondMark.data.session.absent_count, 1);
    assert.equal(secondMark.data.session.status, 'submitted');

    const correction = await teacherCall('submitAttendance', attendance('2026-09-08', 'Morning', [record(first, 'late')]));
    assert.equal(correction.data.session.present_count, 0);
    assert.equal(correction.data.session.late_count, 1);
    assert.equal(correction.data.session.absent_count, 1);

    const morningRows = (await call('/api/entities/AttendanceRecord/filter', 'POST', {
      query: { school_id: school.id, class_id: klass.id, date: '2026-09-08' },
    }, teacherCookie)).data.items;
    assert.equal(morningRows.length, 2);
    assert.equal(new Set(morningRows.map((item) => item.student_id)).size, 2);
    assert.equal(morningRows.find((item) => item.student_id === first.id).status, 'late');
    assert.equal(morningRows.find((item) => item.student_id === second.id).status, 'absent');

    const cleared = await teacherCall('submitAttendance', attendance('2026-09-08', 'Morning', [{
      student_id: first.id,
      clear: true,
    }]));
    assert.equal(cleared.data.session.student_count, 1);
    assert.equal(cleared.data.session.late_count, 0);
    assert.equal(cleared.data.session.absent_count, 1);

    const afternoon = await teacherCall('submitAttendance', attendance('2026-09-08', 'Afternoon', [record(first, 'present')]));
    assert.equal(afternoon.data.session.session_label, 'Afternoon');
    const sessions = (await call('/api/entities/AttendanceSession/filter', 'POST', {
      query: { school_id: school.id, class_id: klass.id, date: '2026-09-08' },
    }, teacherCookie)).data.items;
    assert.equal(sessions.length, 2, 'morning and afternoon registers remain separate');
    const afterAfternoon = (await call('/api/entities/AttendanceRecord/filter', 'POST', {
      query: { school_id: school.id, class_id: klass.id, date: '2026-09-08' },
    }, teacherCookie)).data.items;
    assert.equal(afterAfternoon.length, 2, 'clearing a mark does not affect the other student or session');
    assert.equal(afterAfternoon.find((item) => item.session_id === afternoon.data.session.id).status, 'present');
    assert.equal((await otherCall('submitAttendance', attendance('2026-09-08', 'Morning', [record(second, 'present')]))).status, 403);

    const concurrent = await Promise.all([
      teacherCall('submitAttendance', attendance('2026-09-09', 'Morning', [record(first, 'present')])),
      teacherCall('submitAttendance', attendance('2026-09-09', 'Morning', [record(first, 'present')])),
    ]);
    assert.ok(concurrent.every((result) => result.status === 200));
    const concurrentRows = (await call('/api/entities/AttendanceRecord/filter', 'POST', {
      query: { school_id: school.id, class_id: klass.id, date: '2026-09-09' },
    }, teacherCookie)).data.items;
    assert.equal(concurrentRows.length, 1, 'repeated writes do not create duplicate student records');

    const disabledDay = await call('/api/entities/CalendarDate', 'POST', {
      school_id: school.id,
      date: '2026-09-10',
      day_type: 'no_school',
      reason: 'Holiday',
    }, adminCookie);
    assert.equal(disabledDay.status, 201);
    assert.equal((await call('/api/entities/AttendanceRecord/filter', 'POST', {
      query: { school_id: school.id, class_id: klass.id, date: '2026-09-10' },
    }, teacherCookie)).data.items.length, 0, 'a holiday does not create automatic absences');
    const originalStudentIds = (await call('/api/entities/Student/filter', 'POST', {
      query: { school_id: school.id },
    }, adminCookie)).data.items.map((student) => student.student_id_no).sort();
    assert.deepEqual(originalStudentIds, ['A-001', 'A-002']);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
