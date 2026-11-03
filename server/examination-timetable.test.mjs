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

test('examination schedules enforce roles, enrolment conflicts, lifecycle and archival safety', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-examinations-'));
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

    const school = (await fn('provisionSchool', {
      name: 'Examination School',
      year_start: '2026-09-01',
      year_end: '2027-06-30',
      year_group_names: ['Form 1'],
    })).data.school;
    const years = (await call('/api/entities/AcademicYear/filter', 'POST', {
      query: { school_id: school.id },
    })).data.items;
    const academicYearId = years[0].id;
    const teacher = (await fn('manageStaff', {
      action: 'invite',
      full_name: 'Tina Teacher',
      role: 'teacher',
      username: 'tina.teacher',
      password: 'teacher-test-password',
    })).data.member;

    const saveClass = async (name, subject) => (await fn('saveClass', {
      type: 'subject',
      class: { name, subject },
      teacher_ids: [teacher.id],
    })).data.class;
    const maths = await saveClass('Form 1 Maths', 'Mathematics');
    const science = await saveClass('Form 1 Science', 'Science');
    const art = await saveClass('Form 1 Art', 'Art');
    const homeroom = (await fn('saveClass', {
      type: 'homeroom',
      class: { name: 'Form 1A' },
      teacher_ids: [teacher.id],
    })).data.class;
    const imported = await fn('importStudents', {
      rows: [{ first_name: 'Sam', surname: 'Student' }, { first_name: 'Alex', surname: 'Learner' }],
      defaults: {},
    });
    assert.equal(imported.status, 200);
    const [sharedStudentId, otherStudentId] = imported.data.student_ids;
    for (const classId of [maths.id, science.id]) {
      assert.equal((await fn('assignStudents', {
        class_type: 'subject',
        class_id: classId,
        student_ids: [sharedStudentId],
      })).status, 200);
    }
    assert.equal((await fn('assignStudents', {
      class_type: 'subject',
      class_id: art.id,
      student_ids: [otherStudentId],
    })).status, 200);
    assert.equal((await fn('assignStudents', {
      class_type: 'homeroom',
      class_id: homeroom.id,
      student_ids: [sharedStudentId],
    })).status, 200);

    const exam = (classId, overrides = {}) => ({
      academic_year_id: academicYearId,
      exam_name: 'Term 1 examination',
      class_type: 'subject',
      class_id: classId,
      exam_date: '2026-10-12',
      start_time: '09:00',
      end_time: '10:00',
      room: 'Exam Hall A',
      ...overrides,
    });
    const firstDraft = await fn('saveExaminationSchedule', { exam: exam(maths.id) });
    assert.equal(firstDraft.status, 200);
    assert.equal(firstDraft.data.entry.status, 'draft');
    const firstId = firstDraft.data.entry.id;

    const teacherLogin = await call('/api/auth/login', 'POST', {
      username: 'tina.teacher',
      password: 'teacher-test-password',
    });
    const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];
    const teacherFilter = await callAs(teacherCookie, '/api/entities/ExaminationTimetableEntry/filter', 'POST', {
      query: { school_id: school.id },
    });
    assert.deepEqual(teacherFilter.data.items, [], 'teachers cannot see draft schedules');
    const teacherBatch = await callAs(teacherCookie, '/api/functions/queryBatch', 'POST', {
      queries: [{ entity: 'ExaminationTimetableEntry', query: { school_id: school.id } }],
    });
    assert.deepEqual(teacherBatch.data.results[0].items, [], 'batch queries also hide drafts');
    assert.equal((await callAs(teacherCookie, `/api/entities/ExaminationTimetableEntry/${firstId}`)).status, 404);
    assert.equal((await callAs(teacherCookie, '/api/entities/ExaminationTimetableEntry', 'POST', {
      ...exam(maths.id),
      school_id: school.id,
    })).status, 403);
    assert.equal((await callAs(teacherCookie, '/api/functions/publishExaminationSchedule', 'POST', { id: firstId })).status, 403);
    assert.equal((await callAs(teacherCookie, '/api/functions/archiveExaminationSchedule', 'POST', { id: firstId })).status, 403);

    const sharedStudentConflict = await fn('saveExaminationSchedule', {
      exam: exam(science.id, { start_time: '09:30', end_time: '10:30', room: 'Exam Hall B' }),
    });
    assert.equal(sharedStudentConflict.status, 409);
    assert.ok(sharedStudentConflict.data.details.conflicts.some((conflict) => conflict.type === 'student'));
    const homeroomConflict = await fn('saveExaminationSchedule', {
      exam: exam(homeroom.id, {
        class_type: 'homeroom',
        subject: 'General Studies',
        start_time: '09:30',
        end_time: '10:30',
        room: 'Exam Hall D',
      }),
    });
    assert.equal(homeroomConflict.status, 409);
    assert.ok(homeroomConflict.data.details.conflicts.some((conflict) => conflict.type === 'student'));

    const separateStudentDraft = await fn('saveExaminationSchedule', {
      exam: exam(art.id, { room: 'Exam Hall C' }),
    });
    assert.equal(separateStudentDraft.status, 200, 'different students may sit exams at the same time');
    const roomConflict = await fn('saveExaminationSchedule', {
      exam: exam(art.id, { room: 'exam hall a' }),
    });
    assert.equal(roomConflict.status, 409);
    assert.ok(roomConflict.data.details.conflicts.some((conflict) => conflict.type === 'room'));

    const adjacentDraft = await fn('saveExaminationSchedule', {
      exam: exam(science.id, { start_time: '10:00', end_time: '11:00', room: 'Exam Hall A' }),
    });
    assert.equal(adjacentDraft.status, 200, 'adjacent examinations do not overlap');
    const invalidDate = await fn('saveExaminationSchedule', {
      exam: exam(art.id, { exam_date: '2026-02-31' }),
    });
    assert.equal(invalidDate.status, 400);
    const invalidTime = await fn('saveExaminationSchedule', {
      exam: exam(art.id, { start_time: '10:00', end_time: '09:00' }),
    });
    assert.equal(invalidTime.status, 400);
    const wrongYear = await fn('saveExaminationSchedule', {
      exam: exam(art.id, { academic_year_id: 'year-from-another-school' }),
    });
    assert.equal(wrongYear.status, 400);
    const outsideYear = await fn('saveExaminationSchedule', {
      exam: exam(art.id, { exam_date: '2027-07-01' }),
    });
    assert.equal(outsideYear.status, 400);

    const failedEdit = await fn('saveExaminationSchedule', {
      id: adjacentDraft.data.entry.id,
      exam: exam(science.id, { start_time: '09:30', end_time: '10:30', room: 'Exam Hall D' }),
    });
    assert.equal(failedEdit.status, 409);
    const unchangedDraft = await call(`/api/entities/ExaminationTimetableEntry/${adjacentDraft.data.entry.id}`);
    assert.equal(unchangedDraft.data.start_time, '10:00', 'rejected edits preserve the existing draft');

    const published = await fn('publishExaminationSchedule', { id: firstId });
    assert.equal(published.status, 200);
    assert.equal(published.data.entry.status, 'published');
    const visibleToTeacher = await callAs(teacherCookie, '/api/entities/ExaminationTimetableEntry/filter', 'POST', {
      query: { school_id: school.id },
    });
    assert.deepEqual(visibleToTeacher.data.items.map((entry) => entry.id), [firstId]);
    const hiddenDraft = await callAs(teacherCookie, '/api/functions/queryBatch', 'POST', {
      queries: [{ entity: 'ExaminationTimetableEntry', query: { id: adjacentDraft.data.entry.id } }],
    });
    assert.deepEqual(hiddenDraft.data.results[0].items, []);
    assert.equal((await fn('saveExaminationSchedule', { id: firstId, exam: exam(maths.id) })).status, 409);
    assert.equal((await call('/api/entities/ExaminationTimetableEntry', 'POST', {
      ...exam(maths.id),
      school_id: school.id,
    })).status, 403, 'generic entity writes cannot bypass the management workflow');
    assert.equal((await call(`/api/entities/ExaminationTimetableEntry/${firstId}`, 'DELETE')).status, 403);

    const attendance = await fn('submitAttendance', {
      class_type: 'subject',
      class_id: maths.id,
      class_name: maths.name,
      subject: maths.subject,
      date: '2026-10-01',
      session_label: 'Period 1',
      period_number: 1,
      records: [{ student_id: sharedStudentId, status: 'present' }],
    });
    assert.equal(attendance.status, 200);
    const timetableEntry = await call('/api/entities/TimetableEntry', 'POST', {
      school_id: school.id,
      member_id: teacher.id,
      academic_year_id: academicYearId,
      day_name: 'Day 1',
      period_number: 1,
      start_time: '08:30',
      end_time: '09:20',
      subject: 'Mathematics',
      class_name: maths.name,
      subject_class_id: maths.id,
      room: 'Room 1',
    });
    assert.equal(timetableEntry.status, 201);

    const archived = await fn('archiveExaminationSchedule', { id: firstId });
    assert.equal(archived.status, 200);
    assert.equal(archived.data.entry.status, 'archived');
    const teacherAfterArchive = await callAs(teacherCookie, '/api/entities/ExaminationTimetableEntry/filter', 'POST', {
      query: { school_id: school.id },
    });
    assert.deepEqual(teacherAfterArchive.data.items, []);
    const adminArchived = await call('/api/entities/ExaminationTimetableEntry/filter', 'POST', {
      query: { school_id: school.id, id: firstId },
    });
    assert.equal(adminArchived.data.items[0].status, 'archived', 'archiving retains the examination record');
    assert.equal((await call(`/api/entities/Student/${sharedStudentId}`)).status, 200);
    assert.equal((await call('/api/entities/ClassMembership/filter', 'POST', {
      query: { school_id: school.id, student_id: sharedStudentId },
    })).data.items.length, 3);
    assert.equal((await call('/api/entities/AttendanceSession/filter', 'POST', {
      query: { school_id: school.id },
    })).data.items.length, 1);
    assert.equal((await call('/api/entities/AttendanceRecord/filter', 'POST', {
      query: { school_id: school.id },
    })).data.items.length, 1);
    assert.equal((await call(`/api/entities/TimetableEntry/${timetableEntry.data.id}`)).status, 200);
    assert.equal((await call(`/api/entities/AcademicYear/${academicYearId}`, 'DELETE')).status, 409);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
