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

test('invigilation allocation, overrides, history and teacher access are enforced', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-invigilation-'));
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
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
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
      fullName: 'Invigilation Admin',
      username: 'invigil-admin',
      email: 'invigil-admin@example.test',
      password: 'valid-test-password',
      setupToken,
    });
    assert.equal(setup.status, 201);
    cookie = setup.headers.get('set-cookie').split(';')[0];

    const school = (await fn('provisionSchool', {
      name: 'Invigilation School',
      year_start: '2026-09-01',
      year_end: '2027-06-30',
      year_group_names: ['Form 1'],
    })).data.school;
    const years = (await call('/api/entities/AcademicYear/filter', 'POST', {
      query: { school_id: school.id },
    })).data.items;
    const academicYearId = years[0].id;

    const staff = [];
    for (const [index, name] of ['Teacher Alpha', 'Teacher Bravo', 'Teacher Charlie', 'Teacher Delta'].entries()) {
      const { data } = await fn('manageStaff', {
        action: 'invite',
        full_name: name,
        role: 'teacher',
        username: `teacher.${index}`,
        password: 'teacher-test-password',
      });
      staff.push(data.member);
    }
    const [subjectTeacher, lessonTeacher, availableTeacher, fourthTeacher] = staff;
    const itAdmin = (await fn('manageStaff', {
      action: 'invite',
      full_name: 'IT Administrator',
      role: 'it_admin',
      username: 'it.invigilator',
      password: 'teacher-test-password',
    })).data.member;

    const saveClass = async (name, subject, teacherIds = []) => (await fn('saveClass', {
      type: 'subject',
      class: { name, subject },
      teacher_ids: teacherIds,
    })).data.class;
    const maths = await saveClass('Form 1 Maths', 'Mathematics', [subjectTeacher.id]);
    const science = await saveClass('Form 1 Science', 'Science', [availableTeacher.id]);
    const art = await saveClass('Form 1 Art', 'Art');
    const language = await saveClass('Form 1 Language', 'Language');

    const createExam = async (classId, room, overrides = {}) => {
      const result = await fn('saveExaminationSchedule', {
        exam: {
          academic_year_id: academicYearId,
          exam_name: 'Term 1 examination',
          class_type: 'subject',
          class_id: classId,
          exam_date: '2026-10-12',
          start_time: '09:00',
          end_time: '10:00',
          room,
          ...overrides,
        },
      });
      assert.equal(result.status, 200);
      const { data } = await fn('publishExaminationSchedule', { id: result.data.entry.id });
      assert.equal(data.entry.status, 'published');
      return data.entry;
    };
    const mathsExam = await createExam(maths.id, 'Exam Hall A');
    const scienceExam = await createExam(science.id, 'Exam Hall B');
    const artExam = await createExam(art.id, 'Exam Hall C', {
      exam_date: '2026-10-13',
      start_time: '11:00',
      end_time: '12:00',
    });

    const calendar = await call('/api/entities/CalendarDate', 'POST', {
      school_id: school.id,
      date: '2026-10-12',
      day_type: 'cycle',
      day_name: 'Day 1',
    });
    assert.equal(calendar.status, 201);
    const lesson = await call('/api/entities/TimetableEntry', 'POST', {
      school_id: school.id,
      member_id: lessonTeacher.id,
      academic_year_id: academicYearId,
      day_name: 'Day 1',
      period_number: 1,
      start_time: '09:00',
      end_time: '10:00',
      subject: 'Mathematics',
      class_name: 'Form 1',
      room: 'Room 4',
      archived: false,
      published: true,
    });
    assert.equal(lesson.status, 201);

    const generated = await fn('manageInvigilation', {
      action: 'generate',
      academic_year_id: academicYearId,
      required_supervisors: 2,
    });
    assert.equal(generated.status, 200);
    assert.ok(generated.data.assignments.length >= 5);
    assert.ok(
      generated.data.under_staffed.some((item) => item.examination_id === scienceExam.id),
      JSON.stringify(generated.data),
    );

    const mathAssignments = (await call('/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id, examination_id: mathsExam.id },
    })).data.items.filter((item) => ['draft', 'published'].includes(item.status));
    assert.equal(mathAssignments.length, 2, 'a room can have multiple supervisors');
    assert.equal(mathAssignments.filter((item) => item.role === 'chief').length, 1);
    assert.equal(mathAssignments.filter((item) => item.role === 'assistant').length, 1);
    assert.ok(mathAssignments.every((item) => item.teacher_member_id !== subjectTeacher.id),
      'actual subject teachers are avoided when other eligible teachers are available');
    assert.ok(mathAssignments.every((item) => item.teacher_member_id !== lessonTeacher.id),
      'published lesson conflicts are excluded by automatic allocation');

    const activeAssignments = (await call('/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id, academic_year_id: academicYearId },
    })).data.items.filter((item) => ['draft', 'published'].includes(item.status));
    const teacherLoad = staff.map((teacher) => activeAssignments
      .filter((assignment) => assignment.teacher_member_id === teacher.id).length);
    assert.ok(Math.max(...teacherLoad) - Math.min(...teacherLoad) <= 1,
      `duties should be balanced across eligible staff: ${teacherLoad.join(', ')}`);

    const confirmedId = mathAssignments.find((item) => item.role === 'chief').id;
    const confirmed = await fn('manageInvigilation', { action: 'confirm', assignment_id: confirmedId });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.data.assignment.confirmed, true);

    const regenerated = await fn('manageInvigilation', {
      action: 'generate',
      academic_year_id: academicYearId,
      required_supervisors: 2,
      unavailable_teacher_ids: [fourthTeacher.id],
    });
    assert.equal(regenerated.status, 200);
    const preserved = await call(`/api/entities/InvigilationAssignment/${confirmedId}`);
    assert.equal(preserved.data.id, confirmedId, 'regeneration preserves an administrator-confirmed assignment');
    assert.equal(preserved.data.confirmed, true);
    const mathAfterRegeneration = (await call('/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id, examination_id: mathsExam.id },
    })).data.items.filter((item) => ['draft', 'published'].includes(item.status));
    assert.ok(!mathAfterRegeneration.some((item) => item.teacher_member_id === fourthTeacher.id),
      'administratively unavailable teachers are excluded during generation');

    const overlappingAssignment = await fn('manageInvigilation', {
      action: 'assign',
      examination_id: scienceExam.id,
      teacher_member_id: mathAssignments.find((item) => item.id === confirmedId).teacher_member_id,
      role: 'assistant',
      override_lesson_conflict: true,
      override_reason: 'This reason does not permit overlapping exam assignments.',
    });
    assert.equal(overlappingAssignment.status, 409, 'a teacher cannot receive overlapping examination assignments');

    const missingOverrideReason = await fn('manageInvigilation', {
      action: 'assign',
      examination_id: scienceExam.id,
      teacher_member_id: lessonTeacher.id,
      role: 'assistant',
      override_lesson_conflict: true,
    });
    assert.equal(missingOverrideReason.status, 400);
    const override = await fn('manageInvigilation', {
      action: 'assign',
      examination_id: scienceExam.id,
      teacher_member_id: lessonTeacher.id,
      role: 'assistant',
      override_lesson_conflict: true,
      override_reason: 'The lesson has been cancelled for the examination session.',
    });
    assert.equal(override.status, 200);
    assert.equal(override.data.assignment.override_reason, 'The lesson has been cancelled for the examination session.');
    assert.ok(override.data.lesson_conflicts.includes(lesson.data.id));
    const overrideAudit = await call('/api/entities/AuditLog/filter', 'POST', {
      query: { school_id: school.id, action: 'invigilation.lesson_conflict_overridden' },
    });
    assert.equal(overrideAudit.data.items.length, 1);

    const extraExam = await createExam(language.id, 'Exam Hall D', {
      exam_date: '2026-10-14',
      start_time: '13:00',
      end_time: '14:00',
    });
    const manual = await fn('manageInvigilation', {
      action: 'assign',
      examination_id: extraExam.id,
      teacher_member_id: lessonTeacher.id,
      role: 'chief',
    });
    assert.equal(manual.status, 200, 'administrators can manually assign teachers');
    assert.equal(manual.data.assignment.source, 'manual');
    const reassigned = await fn('manageInvigilation', {
      action: 'reassign',
      examination_id: extraExam.id,
      assignment_id: manual.data.assignment.id,
      teacher_member_id: fourthTeacher.id,
      role: 'chief',
    });
    assert.equal(reassigned.status, 200);
    assert.equal((await call(`/api/entities/InvigilationAssignment/${manual.data.assignment.id}`)).data.status, 'superseded',
      'reassignment retains the prior assignment as history');
    assert.equal(reassigned.data.assignment.teacher_member_id, fourthTeacher.id);
    const removed = await fn('manageInvigilation', {
      action: 'remove',
      assignment_id: reassigned.data.assignment.id,
      reason: 'Teacher reassigned to another examination duty.',
    });
    assert.equal(removed.status, 200);
    assert.equal((await call(`/api/entities/InvigilationAssignment/${reassigned.data.assignment.id}`)).data.status, 'removed');

    const teacherCookieFor = async (username) => {
      const login = await call('/api/auth/login', 'POST', {
        username,
        password: 'teacher-test-password',
      });
      assert.equal(login.status, 200);
      return login.headers.get('set-cookie').split(';')[0];
    };
    const teacherCookie = await teacherCookieFor('teacher.1');
    const unauthorizedCall = await callAs(teacherCookie, '/api/functions/manageInvigilation', 'POST', {
      action: 'generate',
      academic_year_id: academicYearId,
    });
    assert.equal(unauthorizedCall.status, 403);
    assert.equal((await callAs(teacherCookie, '/api/entities/InvigilationAssignment', 'POST', {
      school_id: school.id,
      examination_id: artExam.id,
      teacher_member_id: availableTeacher.id,
      role: 'assistant',
      status: 'published',
    })).status, 403, 'generic entity writes cannot bypass the management workflow');
    assert.equal((await callAs(teacherCookie, `/api/entities/InvigilationRequirement/${(await call('/api/entities/InvigilationRequirement/filter', 'POST', {
      query: { school_id: school.id, examination_id: mathsExam.id },
    })).data.items[0].id}`)).status, 404);
    assert.equal((await call('/api/entities/InvigilationAssignment', 'POST', {
      school_id: school.id,
      examination_id: mathsExam.id,
      teacher_member_id: availableTeacher.id,
      role: 'assistant',
      status: 'draft',
    })).status, 403, 'administrators must use the audit-aware management workflow');
    const retainedAssignment = (await call('/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id, examination_id: mathsExam.id },
    })).data.items[0];
    assert.equal((await call(`/api/entities/InvigilationAssignment/${retainedAssignment.id}`, 'PATCH', {
      role: 'assistant',
    })).status, 403);
    assert.equal((await call(`/api/entities/InvigilationAssignment/${retainedAssignment.id}`, 'DELETE')).status, 403);
    assert.equal((await call('/api/entities/AcademicYear/' + academicYearId, 'DELETE')).status, 409,
      'historical invigilation records prevent academic-year deletion');

    const published = await fn('manageInvigilation', {
      action: 'publish',
      academic_year_id: academicYearId,
    });
    assert.equal(published.status, 200);
    assert.ok(published.data.published > 0);
    const publishedAssignmentIds = (await call('/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id, academic_year_id: academicYearId, status: 'published' },
    })).data.items.map((item) => item.id);
    const postPublicationRegeneration = await fn('manageInvigilation', {
      action: 'generate',
      academic_year_id: academicYearId,
      required_supervisors: 2,
    });
    assert.equal(postPublicationRegeneration.status, 200);
    const afterPublishedRegeneration = (await call('/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id, academic_year_id: academicYearId, status: 'published' },
    })).data.items;
    assert.ok(publishedAssignmentIds.every((id) => afterPublishedRegeneration.some((item) => (
      item.id === id && item.confirmed
    ))), 'publishing confirms duties so later regeneration preserves them');

    const ownAssignments = await callAs(teacherCookie, '/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id },
    });
    assert.ok(ownAssignments.data.items.length > 0);
    assert.ok(ownAssignments.data.items.every((item) => (
      item.teacher_member_id === lessonTeacher.id
      && item.status === 'published'
      && item.examination_id
    )), 'teachers see only their own published assignments');
    assert.ok(ownAssignments.data.items.some((item) => item.id === override.data.assignment.id));
    const ownId = ownAssignments.data.items[0].id;
    const otherTeacherAssignment = (await call('/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id, teacher_member_id: availableTeacher.id },
    })).data.items[0];
    assert.equal((await callAs(teacherCookie, `/api/entities/InvigilationAssignment/${otherTeacherAssignment.id}`)).status, 404);
    assert.equal((await callAs(teacherCookie, `/api/entities/InvigilationAssignment/${ownId}`, 'PATCH', { role: 'chief' })).status, 403);
    const teacherBatch = await callAs(teacherCookie, '/api/functions/queryBatch', 'POST', {
      queries: [{ entity: 'InvigilationAssignment', query: { school_id: school.id } }],
    });
    assert.ok(teacherBatch.data.results[0].items.every((item) => item.teacher_member_id === lessonTeacher.id));
    assert.deepEqual((await callAs(teacherCookie, '/api/entities/InvigilationRequirement/filter', 'POST', {
      query: { school_id: school.id },
    })).data.items, []);

    await fn('archiveExaminationSchedule', { id: scienceExam.id });
    assert.equal((await callAs(teacherCookie, `/api/entities/InvigilationAssignment/${override.data.assignment.id}`)).status, 404,
      'assignments are hidden when their examination is no longer published');

    const itLogin = await call('/api/auth/login', 'POST', {
      username: 'it.invigilator',
      password: 'teacher-test-password',
    });
    const itCookie = itLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await callAs(itCookie, '/api/functions/manageInvigilation', 'POST', {
      action: 'publish',
      academic_year_id: academicYearId,
    })).status, 200, 'IT administrators may manage and publish invigilation');
    assert.equal((await callAs('', '/api/entities/InvigilationAssignment/filter', 'POST', {
      query: { school_id: school.id },
    })).status, 401, 'unauthenticated requests cannot read assignments');

    const removalAudit = await call('/api/entities/AuditLog/filter', 'POST', {
      query: { school_id: school.id, action: 'invigilation.removed' },
    });
    assert.equal(removalAudit.data.items.length, 1, 'removals are audited');
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
