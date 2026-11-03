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

test('timetable writes reject teacher, class, room and overlapping-time conflicts atomically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-timetable-'));
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
  let cookie = '';
  const callAs = async (sessionCookie, route, method = 'GET', body) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  };
  const call = (route, method = 'GET', body) => callAs(cookie, route, method, body);
  const fn = (name, body) => call(`/api/functions/${name}`, 'POST', body);

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const setup = await call('/api/auth/setup', 'POST', {
      fullName: 'Admin',
      username: 'admin.one',
      email: 'admin@example.test',
      password: 'valid-test-password',
      setupToken,
    });
    cookie = setup.headers.get('set-cookie').split(';')[0];

    const school = (await fn('provisionSchool', { name: 'Test School' })).data.school;
    const teacherA = (await fn('manageStaff', {
      action: 'invite',
      full_name: 'Tina Teacher',
      role: 'teacher',
      teacher_number: 'T-001',
      subject_specialisms: ['Mathematics', 'Physics'],
      username: 'tina.teacher',
      password: 'teacher-test-password',
    })).data.member;
    const teacherB = (await fn('manageStaff', {
      action: 'invite',
      full_name: 'Tom Teacher',
      role: 'teacher',
      teacher_number: 'T-002',
    })).data.member;
    assert.equal(teacherA.teacher_number, 'T-001');
    assert.deepEqual(teacherA.subject_specialisms, ['Mathematics', 'Physics']);
    const duplicateTeacherNumber = await fn('manageStaff', {
      action: 'update',
      member_id: teacherB.id,
      teacher_number: ' t-001 ',
    });
    assert.equal(duplicateTeacherNumber.status, 409);

    const yearResponse = await call('/api/entities/AcademicYear/filter', 'POST', {
      query: { school_id: school.id },
    });
    const academicYearId = yearResponse.data.items[0].id;
    const nextYear = await call('/api/entities/AcademicYear', 'POST', {
      school_id: school.id,
      name: '2027/2028',
      is_current: false,
    });

    const unavailable = await call('/api/entities/TeacherAvailability', 'POST', {
      school_id: school.id,
      member_id: teacherA.id,
      academic_year_id: academicYearId,
      day_name: 'Day 2',
      period_number: 1,
      start_time: '08:30',
      end_time: '09:20',
      is_available: false,
    });
    assert.equal(unavailable.status, 201);

    const teacherLogin = await call('/api/auth/login', 'POST', {
      username: 'tina.teacher',
      password: 'teacher-test-password',
    });
    const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];
    const ownAvailability = await callAs(teacherCookie, '/api/entities/TeacherAvailability', 'POST', {
      school_id: school.id,
      member_id: teacherA.id,
      academic_year_id: academicYearId,
      day_name: 'Day 4',
      period_number: 4,
      is_available: false,
    });
    assert.equal(ownAvailability.status, 201, 'teachers may manage their own availability');
    const otherTeacherAvailability = await callAs(teacherCookie, '/api/entities/TeacherAvailability', 'POST', {
      school_id: school.id,
      member_id: teacherB.id,
      academic_year_id: academicYearId,
      day_name: 'Day 4',
      period_number: 4,
      is_available: false,
    });
    assert.equal(otherTeacherAvailability.status, 403, "teachers cannot change a colleague's availability");
    const lesson = (memberId, overrides = {}) => ({
      school_id: school.id,
      member_id: memberId,
      academic_year_id: academicYearId,
      day_name: 'Day 1',
      period_number: 1,
      start_time: '08:30',
      end_time: '09:20',
      subject: 'Mathematics',
      class_name: 'Form 1A',
      subject_class_id: 'class-a',
      room: 'Room 1',
      ...overrides,
    });

    const first = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherA.id));
    assert.equal(first.status, 201);

    const availabilityConflict = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherA.id, {
      day_name: 'Day 2',
      subject_class_id: 'class-unavailable',
      class_name: 'Form 2A',
      room: 'Room 6',
    }));
    assert.equal(availabilityConflict.status, 409);
    assert.ok(availabilityConflict.data.details.conflicts.some((conflict) => conflict.type === 'availability'));

    const otherYearLesson = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherA.id, {
      academic_year_id: nextYear.data.id,
      day_name: 'Day 2',
      subject_class_id: 'class-next-year',
      class_name: 'Form 3A',
      room: 'Room 7',
    }));
    assert.equal(otherYearLesson.status, 201, 'teacher availability applies only to its academic year');

    const replaceNextYear = await fn('saveTimetableEntries', {
      member_id: teacherA.id,
      academic_year_id: nextYear.data.id,
      mode: 'replace',
      entries: [{
        day_name: 'Day 3',
        period_number: 4,
        start_time: '11:20',
        end_time: '12:10',
        subject: 'Mathematics',
        class_name: 'Form 3C',
        room: 'Room 8',
      }],
    });
    assert.equal(replaceNextYear.status, 200);
    const teacherAEntries = await call('/api/entities/TimetableEntry/filter', 'POST', {
      query: { school_id: school.id, member_id: teacherA.id },
    });
    assert.equal(teacherAEntries.data.items.find((entry) => entry.id === first.data.id).archived, false);
    assert.equal(teacherAEntries.data.items.find((entry) => entry.id === otherYearLesson.data.id).archived, true);

    const invalidAcademicYear = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherA.id, {
      academic_year_id: 'year-from-another-school',
      day_name: 'Day 3',
      subject_class_id: 'class-invalid-year',
      class_name: 'Form 3B',
    }));
    assert.equal(invalidAcademicYear.status, 400);
    assert.equal((await call(`/api/entities/AcademicYear/${academicYearId}`, 'DELETE')).status, 409);

    const teacherConflict = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherA.id, {
      period_number: 2,
      start_time: '09:00',
      end_time: '09:40',
      subject_class_id: 'class-b',
      class_name: 'Form 1B',
      room: 'Room 2',
    }));
    assert.equal(teacherConflict.status, 409);
    assert.ok(teacherConflict.data.details.conflicts.some((conflict) => conflict.type === 'teacher'));

    const classConflict = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherB.id, {
      subject: 'Science',
      room: 'Room 2',
    }));
    assert.equal(classConflict.status, 409);
    assert.ok(classConflict.data.details.conflicts.some((conflict) => conflict.type === 'class'));

    const roomConflict = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherB.id, {
      subject_class_id: 'class-b',
      class_name: 'Form 1B',
      subject: 'Science',
    }));
    assert.equal(roomConflict.status, 409);
    assert.ok(roomConflict.data.details.conflicts.some((conflict) => conflict.type === 'room'));

    const adjacentPeriod = await call('/api/entities/TimetableEntry', 'POST', lesson(teacherB.id, {
      period_number: 2,
      start_time: '09:20',
      end_time: '10:10',
      subject_class_id: 'class-b',
      class_name: 'Form 1B',
    }));
    assert.equal(adjacentPeriod.status, 201, 'adjacent lessons may use the same room');

    const updateConflict = await call(`/api/entities/TimetableEntry/${first.data.id}`, 'PATCH', {
      period_number: 2,
      start_time: '09:20',
      end_time: '10:10',
    });
    assert.equal(updateConflict.status, 409);
    const unchanged = await call(`/api/entities/TimetableEntry/${first.data.id}`);
    assert.equal(unchanged.data.period_number, 1, 'a rejected edit leaves the original entry unchanged');

    const bulkConflict = await call('/api/entities/TimetableEntry/bulk', 'POST', [
      lesson(teacherB.id, { period_number: 3, start_time: '10:10', end_time: '11:00', room: 'Room 3' }),
      lesson(teacherB.id, {
        period_number: 3,
        start_time: '10:10',
        end_time: '11:00',
        subject_class_id: 'class-c',
        class_name: 'Form 1C',
        room: 'Room 4',
      }),
    ]);
    assert.equal(bulkConflict.status, 409);

    const importConflict = await fn('saveTimetableEntries', {
      member_id: teacherB.id,
      mode: 'replace',
      entries: [{
        day_name: 'Day 1',
        period_number: 1,
        start_time: '08:30',
        end_time: '09:20',
        subject: 'Science',
        class_name: 'Form 1A',
        subject_class_id: 'class-a',
        room: 'Room 5',
      }],
    });
    assert.equal(importConflict.status, 409);

    const teacherBEntries = await call('/api/entities/TimetableEntry/filter', 'POST', {
      query: { school_id: school.id, member_id: teacherB.id, archived: false },
    });
    assert.equal(teacherBEntries.data.items.length, 1, 'failed replacement leaves the prior schedule intact');
    assert.equal(teacherBEntries.data.items[0].period_number, 2);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
