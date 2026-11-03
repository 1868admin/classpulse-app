import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setupToken = 'test-only-first-admin-key-0123456789abcdef';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// jsPDF compresses page streams; inflate them to assert on the drawn text.
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { chunks.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')); } catch { /* not a flate stream */ }
  }
  return chunks.join('\n').replace(/\\([()\\])/g, '$1');
}
const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

test('PDF distribution is generated from saved schedules with enforced access', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-documents-'));
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
  const raw = (sessionCookie, route, method = 'GET', body) => fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const callAs = async (sessionCookie, route, method = 'GET', body) => {
    const response = await raw(sessionCookie, route, method, body);
    return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
  };
  const call = (route, method = 'GET', body) => callAs(cookie, route, method, body);
  const fn = (name, body) => call(`/api/functions/${name}`, 'POST', body);
  const binary = async (sessionCookie, route, method = 'GET', body) => {
    const response = await raw(sessionCookie, route, method, body);
    return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
  };

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const setup = await call('/api/auth/setup', 'POST', {
      fullName: 'Documents Admin', username: 'docs-admin', email: 'docs-admin@example.test',
      password: 'valid-test-password', setupToken,
    });
    assert.equal(setup.status, 201);
    cookie = setup.headers.get('set-cookie').split(';')[0];

    const school = (await fn('provisionSchool', {
      name: 'Documents School', year_start: '2026-09-01', year_end: '2027-06-30', year_group_names: ['Form 1'],
    })).data.school;
    const academicYearId = (await call('/api/entities/AcademicYear/filter', 'POST', {
      query: { school_id: school.id },
    })).data.items[0].id;

    const longName = 'Dr Alexandra Wilhelmina Featherstonehaugh-Cholmondeley-Montgomery-Smythe';
    const invite = async (name, username, role = 'teacher') => (await fn('manageStaff', {
      action: 'invite', full_name: name, role, username, password: 'teacher-test-password',
    })).data.member;
    const alpha = await invite('Teacher Alpha', 'doc.alpha');
    const bravo = await invite('Teacher Bravo', 'doc.bravo');
    const long = await invite(longName, 'doc.long');
    const itAdmin = await invite('IT Documents', 'doc.it', 'it_admin');
    const login = async (username) => {
      const response = await callAs('', '/api/auth/login', 'POST', { username, password: 'teacher-test-password' });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };

    const lesson = async (member, values) => {
      const response = await call('/api/entities/TimetableEntry', 'POST', {
        school_id: school.id, member_id: member.id, academic_year_id: academicYearId,
        day_name: 'Day 1', period_number: 1, start_time: '08:00', end_time: '08:45',
        subject: 'Mathematics', class_name: 'Form 1A', room: 'Room 1', archived: false, published: true, ...values,
      });
      assert.equal(response.status, 201, JSON.stringify(response.data));
    };
    await lesson(alpha, {});
    await lesson(alpha, { day_name: 'Day 2', subject: 'Draft Only Subject', published: false });
    await lesson(bravo, { subject: 'Bravo Secret Draft', published: false, period_number: 2, start_time: '09:00', end_time: '09:45', class_name: 'Form 1C', room: 'Room 3' });
    await lesson(long, { subject: 'Physics', class_name: 'Form 1B', room: 'Lab 2' });

    const subjectClass = (await fn('saveClass', { type: 'subject', class: { name: 'Form 1 Maths', subject: 'Mathematics' }, teacher_ids: [] })).data.class;
    const exam = async (name, publish) => {
      const saved = await fn('saveExaminationSchedule', {
        exam: {
          academic_year_id: academicYearId, exam_name: name, class_type: 'subject', class_id: subjectClass.id,
          exam_date: publish ? '2026-10-12' : '2026-10-14', start_time: '09:00', end_time: '10:00', room: publish ? 'Hall A' : 'Hall B',
        },
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      if (publish) assert.equal((await fn('publishExaminationSchedule', { id: saved.data.entry.id })).status, 200);
      return saved.data.entry;
    };
    const publishedExam = await exam('Published Term Exam', true);
    await exam('Secret Draft Exam', false);
    const assign = async (teacher, role) => {
      const response = await fn('manageInvigilation', {
        action: 'assign', examination_id: publishedExam.id, teacher_member_id: teacher.id, role,
      });
      assert.equal(response.status, 200, JSON.stringify(response.data));
    };
    await assign(alpha, 'chief');
    await assign(long, 'assistant');

    // Before assignments are published, teachers see nothing.
    const alphaCookie = await login('doc.alpha');
    const bravoCookie = await login('doc.bravo');
    const pdfUrl = (params) => `/api/documents/pdf?${new URLSearchParams({ academic_year_id: academicYearId, ...params })}`;
    assert.equal((await binary(alphaCookie, pdfUrl({ kind: 'teacher_supervision' }))).status, 404);
    assert.equal((await fn('manageInvigilation', { action: 'publish', academic_year_id: academicYearId })).status, 200);

    // Anonymous requests are rejected.
    assert.equal((await binary('', pdfUrl({ kind: 'master_timetable' }))).status, 401);

    // Administrators: each document type is a valid PDF built from saved data.
    const kinds = [
      { kind: 'master_timetable' }, { kind: 'teacher_timetable', teacher_id: alpha.id },
      { kind: 'class_timetable', class_name: 'Form 1A' }, { kind: 'room_timetable', room: 'Room 1' },
      { kind: 'examination_timetable' }, { kind: 'teacher_supervision', teacher_id: alpha.id }, { kind: 'invigilation_schedule' },
    ];
    for (const params of kinds) {
      const result = await binary(cookie, pdfUrl({ ...params, disposition: 'inline' }));
      assert.equal(result.status, 200, params.kind);
      assert.equal(result.headers.get('content-type'), 'application/pdf');
      assert.match(result.headers.get('content-disposition'), /^inline/);
      assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
      const content = pdfText(result.buffer);
      assert.match(content, /Documents School/, `${params.kind} shows the school name`);
      assert.match(content, /Generated \d{4}-\d{2}-\d{2}/, `${params.kind} shows generation date`);
      assert.match(content, /Schedule version: /);
      assert.doesNotMatch(content, /Draft Only Subject|Bravo Secret Draft|Secret Draft Exam/, `${params.kind} excludes drafts by default`);
    }
    const teacherDoc = pdfText((await binary(cookie, pdfUrl({ kind: 'teacher_timetable', teacher_id: alpha.id }))).buffer);
    assert.match(teacherDoc, /Mathematics/);
    assert.match(teacherDoc, /Form 1A/);
    const examDoc = pdfText((await binary(cookie, pdfUrl({ kind: 'examination_timetable' }))).buffer);
    assert.match(examDoc, /Published Term Exam/);
    assert.match(examDoc, /Hall A/);
    const invDoc = pdfText((await binary(cookie, pdfUrl({ kind: 'invigilation_schedule' }))).buffer);
    assert.match(invDoc, /Teacher Alpha \(Chief\)/);

    // Draft inclusion is administrator-only and clearly marked.
    const draftDoc = pdfText((await binary(cookie, pdfUrl({ kind: 'master_timetable', scope: 'all' }))).buffer);
    assert.match(draftDoc, /Bravo Secret Draft/);
    assert.match(draftDoc, /DRAFT - NOT PUBLISHED/);
    const itDoc = await binary(await login('doc.it'), pdfUrl({ kind: 'master_timetable' }));
    assert.equal(itDoc.status, 200);

    // Long names wrap rather than clip.
    const longDoc = pdfText((await binary(cookie, pdfUrl({ kind: 'master_timetable' }))).buffer);
    assert.match(longDoc, /Featherstonehaugh/);
    assert.match(longDoc, /Smythe/);
    assert.doesNotMatch(longDoc, new RegExp(`\\(${longName}\\)`), 'long names are wrapped across lines');

    // Teachers: own published documents only.
    const own = await binary(alphaCookie, pdfUrl({ kind: 'teacher_timetable' }));
    assert.equal(own.status, 200);
    const ownText = pdfText(own.buffer);
    assert.match(ownText, /Mathematics/);
    assert.doesNotMatch(ownText, /Draft Only Subject|Physics/);
    assert.match(own.headers.get('content-disposition'), /^attachment/);
    const ownSupervision = pdfText((await binary(alphaCookie, pdfUrl({ kind: 'teacher_supervision', teacher_id: alpha.id }))).buffer);
    assert.match(ownSupervision, /Published Term Exam/);
    assert.match(ownSupervision, /Chief supervisor/);

    for (const forbidden of [
      pdfUrl({ kind: 'teacher_timetable', teacher_id: long.id }),
      pdfUrl({ kind: 'teacher_supervision', teacher_id: long.id }),
      pdfUrl({ kind: 'master_timetable' }),
      pdfUrl({ kind: 'invigilation_schedule' }),
      pdfUrl({ kind: 'examination_timetable' }),
      pdfUrl({ kind: 'teacher_timetable', teacher_id: alpha.id, scope: 'all' }) + '&teacher_id=' + bravo.id,
    ]) {
      assert.equal((await binary(alphaCookie, forbidden)).status, 403, forbidden);
    }
    // scope=all is ignored for teachers, so unpublished lessons never appear.
    const scoped = await binary(bravoCookie, pdfUrl({ kind: 'teacher_timetable', scope: 'all' }));
    assert.equal(scoped.status, 404, 'a teacher with only draft lessons has no document');
    assert.equal((await binary(bravoCookie, pdfUrl({ kind: 'teacher_supervision' }))).status, 404);
    assert.equal((await binary(alphaCookie, '/api/documents/zip', 'POST', { items: [{ kind: 'master_timetable' }] })).status, 403);

    // Catalogue is role-scoped.
    const adminCatalog = (await callAs(cookie, `/api/documents/catalog?academic_year_id=${academicYearId}`)).data;
    assert.equal(adminCatalog.teachers.length, 3);
    assert.ok(adminCatalog.classes.includes('Form 1A'));
    const teacherCatalog = (await callAs(alphaCookie, '/api/documents/catalog')).data;
    assert.deepEqual(teacherCatalog.own, { timetable: 1, supervision: 1 });
    assert.equal(teacherCatalog.teachers, undefined);

    // Bulk ZIP: unique files, manifest, skipped empty documents.
    const items = [
      ...adminCatalog.teachers.map((teacher) => ({ kind: 'teacher_timetable', teacher_id: teacher.id })),
      { kind: 'teacher_timetable', teacher_id: alpha.id },
      { kind: 'master_timetable' }, { kind: 'invigilation_schedule' },
    ];
    const zip = await binary(cookie, '/api/documents/zip', 'POST', { academic_year_id: academicYearId, items });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    const files = unzipSync(new Uint8Array(zip.buffer));
    const names = Object.keys(files);
    assert.ok(names.includes('manifest.txt'));
    const pdfs = names.filter((name) => name.endsWith('.pdf'));
    assert.equal(new Set(pdfs).size, pdfs.length);
    assert.equal(pdfs.length, 5, 'Bravo has no published lessons and is skipped; duplicate Alpha gets a unique name');
    for (const name of pdfs) assert.equal(Buffer.from(files[name]).subarray(0, 5).toString(), '%PDF-');
    assert.match(Buffer.from(files['manifest.txt']).toString(), /SKIPPED.*bravo/i);
    assert.equal((await binary(cookie, '/api/documents/zip', 'POST', { items: [] })).status, 400);

    // Large timetables paginate without error and regenerate with saved changes.
    const crowd = [];
    for (let n = 0; n < 12; n += 1) crowd.push(await invite(`Crowd Teacher ${n} ${'Longsurname'.repeat(3)}`, `doc.crowd${n}`));
    const bulk = [];
    for (let day = 1; day <= 5; day += 1) {
      for (let period = 1; period <= 8; period += 1) {
        for (let n = 0; n < 12; n += 1) {
          bulk.push({
            school_id: school.id, member_id: crowd[n].id, academic_year_id: academicYearId,
            day_name: `Day ${day}`, period_number: period, start_time: `${7 + period}:00`.padStart(5, '0'), end_time: `${7 + period}:45`.padStart(5, '0'),
            subject: `Subject ${n} ${'extended '.repeat(4)}`, class_name: `Class ${n}`, room: `Studio ${n}`, archived: false, published: true,
          });
        }
      }
    }
    assert.equal((await call('/api/entities/TimetableEntry/bulk', 'POST', bulk)).status, 201);
    const large = await binary(cookie, pdfUrl({ kind: 'master_timetable' }));
    assert.equal(large.status, 200);
    assert.ok(pageCount(large.buffer) >= 5, 'one page group per timetable day');
    const before = pdfText((await binary(cookie, pdfUrl({ kind: 'teacher_timetable', teacher_id: alpha.id }))).buffer);
    await lesson(alpha, { subject: 'Regenerated Subject', day_name: 'Day 3', period_number: 7, class_name: 'Form 9Z', room: 'Room 9', start_time: '15:00', end_time: '15:45' });
    const after = pdfText((await binary(cookie, pdfUrl({ kind: 'teacher_timetable', teacher_id: alpha.id }))).buffer);
    assert.doesNotMatch(before, /Regenerated Subject/);
    assert.match(after, /Regenerated Subject/);

    const audit = (await call('/api/entities/AuditLog/filter', 'POST', { query: { school_id: school.id, action: 'document_download' } })).data.items;
    assert.ok(audit.length >= 1);
    assert.ok(itAdmin.id);
  } finally {
    child.kill();
  }
});
