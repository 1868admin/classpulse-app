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

test('teacher profiles retain identity through employment and staffing imports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-staff-'));
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
  const call = async (route, method = 'GET', body, sessionCookie = cookie) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  };
  const fn = (name, body) => call(`/api/functions/${name}`, 'POST', body);
  const batch = (queries) => fn('queryBatch', { queries });

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    const setup = await call('/api/auth/setup', 'POST', {
      fullName: 'Staff Admin', username: 'staff.admin', email: 'staff.admin@example.test',
      password: 'valid-test-password', setupToken,
    });
    assert.equal(setup.status, 201);
    cookie = setup.headers.get('set-cookie').split(';')[0];

    const school = (await fn('provisionSchool', {
      name: 'Staffing School', year_start: '2026-09-01', year_end: '2027-06-30', year_group_names: ['Form 1'],
    })).data.school;
    const [yearGroup, academicYear] = (await batch([
      { entity: 'YearGroup', query: { school_id: school.id }, options: { limit: 10 } },
      { entity: 'AcademicYear', query: { school_id: school.id }, options: { limit: 10 } },
    ])).data.results.map((result) => result.items[0]);

    const invite = async (values) => (await fn('manageStaff', { action: 'invite', role: 'teacher', ...values })).data.member;
    const teacher = await invite({
      full_name: 'Teacher One', username: 'teacher.one', password: 'teacher-password-1', teacher_number: 'TN-001',
    });
    const replacement = await invite({
      full_name: 'Teacher Two', username: 'teacher.two', password: 'teacher-password-2', teacher_number: 'TN-002',
    });
    const profileOnly = await invite({
      full_name: 'Profile Only', create_account: false, teacher_number: 'TN-003',
    });
    assert.equal(profileOnly.user_id, '');
    assert.equal(profileOnly.teacher_number, 'TN-003');
    assert.equal((await batch([{ entity: 'SchoolMember', query: { id: profileOnly.id } }])).data.results[0].items[0].has_local_login, false);
    assert.equal((await fn('manageStaff', { action: 'invite', full_name: 'Duplicate', teacher_number: 'TN-001' })).status, 409);

    const homeroom = (await fn('saveClass', {
      type: 'homeroom', class: { name: 'Form 1A', year_group_id: yearGroup.id }, teacher_ids: [teacher.id],
    })).data.class;
    const subjectClass = (await fn('saveClass', {
      type: 'subject', class: { name: 'Form 1 Mathematics', subject: 'Mathematics' }, teacher_ids: [teacher.id],
    })).data.class;
    const students = await fn('importStudents', {
      rows: [{ first_name: 'Learner', surname: 'One' }],
      defaults: { year_group_id: yearGroup.id, homeroom_class_id: homeroom.id },
    });
    assert.equal(students.data.imported, 1);
    const lesson = await call('/api/entities/TimetableEntry', 'POST', {
      school_id: school.id, member_id: teacher.id, academic_year_id: academicYear.id,
      day_name: 'Day 1', period_number: 1, start_time: '08:00', end_time: '08:45',
      subject: 'Mathematics', class_name: 'Form 1A', subject_class_id: subjectClass.id, room: 'Room 1', published: true,
    });
    assert.equal(lesson.status, 201);
    const futureYear = await call('/api/entities/AcademicYear', 'POST', {
      school_id: school.id, name: '2040/2041', start_date: '2040-09-01', end_date: '2041-06-30', is_current: false,
    });
    assert.equal(futureYear.status, 201);
    const futureLesson = await call('/api/entities/TimetableEntry', 'POST', {
      school_id: school.id, member_id: teacher.id, academic_year_id: futureYear.data.id,
      day_name: 'Day 2', period_number: 1, start_time: '08:00', end_time: '08:45',
      subject: 'Mathematics', class_name: 'Form 1A', subject_class_id: subjectClass.id, room: 'Room 1', published: true,
    });
    assert.equal(futureLesson.status, 201);
    const unaffectedLesson = await call('/api/entities/TimetableEntry', 'POST', {
      school_id: school.id, member_id: replacement.id, academic_year_id: academicYear.id,
      day_name: 'Day 1', period_number: 2, start_time: '09:00', end_time: '09:45',
      subject: 'English', class_name: 'Form 1A', room: 'Room 2', published: true,
    });
    assert.equal(unaffectedLesson.status, 201);

    const examResult = await fn('saveExaminationSchedule', { exam: {
      academic_year_id: academicYear.id, exam_name: 'Term Exam', class_type: 'subject', class_id: subjectClass.id,
      exam_date: '2026-12-01', start_time: '11:00', end_time: '12:00', room: 'Hall A',
    } });
    assert.equal(examResult.status, 200);
    const examId = examResult.data.entry.id;
    assert.equal((await fn('publishExaminationSchedule', { id: examId })).status, 200);
    const duty = await fn('manageInvigilation', {
      action: 'assign', examination_id: examId, teacher_member_id: teacher.id, role: 'chief',
    });
    assert.equal(duty.status, 200);
    const dutyId = duty.data.assignment.id;

    const impact = await fn('manageStaff', {
      action: 'employment_preview', member_id: teacher.id, employment_status: 'departed', effective_date: '2026-11-10',
    });
    assert.equal(impact.status, 200);
    assert.equal(impact.data.impact.affected_student_count, 1);
    assert.equal(impact.data.impact.timetable_entries.length, 2);
    assert.equal(impact.data.impact.upcoming_invigilation_duties.length, 1);
    assert.equal((await fn('manageStaff', {
      action: 'employment_change', member_id: teacher.id, employment_status: 'departed',
      effective_date: '2026-11-10', reason: 'Leaving the school',
    })).status, 200);

    const departureRecords = (await batch([
      { entity: 'SchoolMember', query: { id: teacher.id } },
      { entity: 'ClassTeacher', query: { school_id: school.id, member_id: teacher.id } },
      { entity: 'TimetableEntry', query: { id: lesson.data.id } },
      { entity: 'TimetableEntry', query: { id: futureLesson.data.id } },
      { entity: 'InvigilationAssignment', query: { id: dutyId } },
      { entity: 'TimetableEntry', query: { id: unaffectedLesson.data.id } },
    ])).data.results;
    const [departed, flaggedLesson, flaggedFutureLesson, flaggedDuty, unchangedLesson] = [
      departureRecords[0].items[0], departureRecords[2].items[0], departureRecords[3].items[0],
      departureRecords[4].items[0], departureRecords[5].items[0],
    ];
    const links = departureRecords[1].items;
    assert.equal(departed.id, teacher.id);
    assert.equal(departed.teacher_number, 'TN-001');
    assert.equal(departed.employment_status, 'departed');
    assert.equal(departed.status, 'inactive');
    assert.equal(departed.employment_history.length, 1);
    assert.equal(links.length, 2);
    assert.equal(links.filter((link) => link.is_active !== false).length, 0);
    assert.equal(flaggedLesson.reassignment_required, true);
    assert.equal(flaggedFutureLesson.reassignment_required, true);
    assert.equal(flaggedDuty.reassignment_required, true);
    assert.equal(unchangedLesson.reassignment_required, false);
    assert.equal((await fn('manageStaff', { action: 'remove', member_id: teacher.id })).status, 409);
    assert.equal((await call('/api/auth/login', 'POST', { username: 'teacher.one', password: 'teacher-password-1' }, '')).status, 401);
    assert.equal((await fn('manageStaff', {
      action: 'assignment_apply', changes: [{ action: 'assign', class_type: 'homeroom', class_id: homeroom.id, member_ids: [teacher.id] }],
    })).status, 400);
    assert.equal((await call('/api/entities/TimetableEntry', 'POST', {
      school_id: school.id, member_id: teacher.id, academic_year_id: academicYear.id,
      day_name: 'Day 3', period_number: 3, subject: 'Science', class_name: 'Form 1A',
    })).status, 400);

    assert.equal((await fn('manageStaff', {
      action: 'employment_change', member_id: teacher.id, employment_status: 'active', effective_date: '2026-11-15',
    })).status, 200);
    const restoredLogin = await call('/api/auth/login', 'POST', { username: 'teacher.one', password: 'teacher-password-1' }, '');
    assert.equal(restoredLogin.status, 200);
    const restored = (await batch([{ entity: 'SchoolMember', query: { id: teacher.id } }])).data.results[0].items[0];
    assert.equal(restored.id, teacher.id);
    assert.equal(restored.teacher_number, 'TN-001');
    assert.equal(restored.employment_status, 'active');
    assert.equal(restored.return_date, '2026-11-15');
    assert.equal(restored.employment_history.length, 2);
    assert.equal((await fn('manageStaff', {
      action: 'assignment_apply', changes: [{ action: 'assign', class_type: 'homeroom', class_id: homeroom.id, member_ids: [teacher.id] }],
    })).status, 200);
    const reassigned = await call(`/api/entities/TimetableEntry/${lesson.data.id}`, 'PATCH', { member_id: replacement.id });
    assert.equal(reassigned.status, 200);
    assert.equal(reassigned.data.reassignment_required, false);

    const invalidImport = [{ full_name: 'New Teacher', teacher_number: 'TN-004', subject_classes: 'Not A Class' }];
    const invalidPreview = await fn('manageStaff', { action: 'import_preview', rows: invalidImport });
    assert.equal(invalidPreview.data.summary.invalid, 1);
    assert.equal((await fn('manageStaff', { action: 'import_apply', rows: invalidImport })).status, 400);
    const validImport = [{
      full_name: 'Teacher One', teacher_number: 'TN-001', subject_specialisms: 'Mathematics, Physics',
      subject_classes: 'Form 1 Mathematics', year_dean: 'Form 1',
    }, {
      full_name: 'Imported Teacher', teacher_number: 'TN-004', employment_status: 'Active',
      homeroom_classes: 'Form 1A',
    }];
    const preview = await fn('manageStaff', { action: 'import_preview', rows: validImport });
    assert.equal(preview.data.summary.invalid, 0);
    const imported = await fn('manageStaff', { action: 'import_apply', rows: validImport });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.created, 1);
    assert.equal(imported.data.updated, 1);
    const importRecords = (await batch([
      { entity: 'SchoolMember', query: { id: teacher.id } },
      { entity: 'YearGroup', query: { id: yearGroup.id } },
      { entity: 'SchoolMember', query: { teacher_number: 'TN-004' } },
      { entity: 'ClassTeacher', query: { school_id: school.id, class_id: subjectClass.id, member_id: teacher.id } },
    ])).data.results;
    const [originalAfterImport, dean, importedTeacher] = importRecords.map((result) => result.items[0]);
    const assignmentHistory = importRecords[3].items;
    assert.equal(originalAfterImport.id, teacher.id);
    assert.equal(originalAfterImport.teacher_number, 'TN-001');
    assert.deepEqual(originalAfterImport.subject_specialisms, ['Mathematics', 'Physics']);
    assert.equal(dean.dean_member_id, teacher.id);
    assert.equal(importedTeacher.has_local_login, false);
    assert.equal(assignmentHistory.length, 2);
    assert.equal(assignmentHistory.filter((item) => item.is_active !== false).length, 1);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
