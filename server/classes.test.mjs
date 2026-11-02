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

test('class, teacher, student and batch-query workflows', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classpulse-classes-'));
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
  const call = async (route, method = 'GET', body) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
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
      fullName: 'Admin', username: 'admin.one', email: 'a@example.test', password: 'valid-test-password', setupToken,
    });
    cookie = setup.headers.get('set-cookie').split(';')[0];
    const school = (await fn('provisionSchool', { name: 'Test School', year_group_names: ['Form 1', 'Form 2'] })).data.school;
    const [form1, form2] = (await batch([{ entity: 'YearGroup', query: { school_id: school.id }, options: { sort: 'level' } }])).data.results[0].items;
    const tina = (await fn('manageStaff', { action: 'invite', full_name: 'Tina Teacher', role: 'teacher', username: 'tina.t', password: 'teacher-pass-1' })).data.member;
    const tom = (await fn('manageStaff', { action: 'invite', full_name: 'Tom Teacher', role: 'teacher' })).data.member;
    assert.ok(tom.username, 'a passwordless invite still gets a generated username');

    const homeroom = await fn('saveClass', {
      type: 'homeroom', class: { name: 'Form 1A', year_group_id: form1.id }, teacher_ids: [tina.id, tom.id], primary_id: tom.id,
    });
    assert.equal(homeroom.status, 200);
    assert.equal(homeroom.data.class.year_group_name, 'Form 1');
    assert.equal((await fn('saveClass', { type: 'homeroom', class: { name: 'form 1a' } })).status, 409);
    assert.equal((await fn('saveClass', { type: 'subject', class: { name: 'X', subject: 'Y' }, teacher_ids: ['missing'] })).status, 400);

    const subject = await fn('saveClass', {
      type: 'subject', class: { name: 'Form 1 Maths', subject: 'Mathematics', homeroom_ids: [homeroom.data.class.id] }, teacher_ids: [tina.id],
    });
    assert.deepEqual(subject.data.class.homeroom_names, ['Form 1A']);

    const edited = await fn('saveClass', {
      type: 'homeroom', class_id: homeroom.data.class.id, class: { name: 'Form 1B', year_group_id: form2.id }, teacher_ids: [tina.id],
    });
    assert.equal(edited.data.class.year_group_name, 'Form 2');

    const [classes, links] = (await batch([
      { entity: 'HomeroomClass', query: { school_id: school.id, archived: false } },
      { entity: 'ClassTeacher', query: { school_id: school.id, class_id: homeroom.data.class.id } },
    ])).data.results;
    assert.deepEqual(classes.items.map((item) => item.name), ['Form 1B']);
    assert.equal(links.items.length, 1);
    assert.equal(links.items[0].class_name, 'Form 1B');
    assert.equal((await batch([{ entity: 'Nope' }])).status, 404);

    const imported = await fn('importStudents', {
      rows: [{ first_name: 'Bob', surname: 'Ray' }, { first_name: 'Cy', surname: 'Doe' }],
      defaults: { year_group_id: form2.id, homeroom_class_id: homeroom.data.class.id },
    });
    assert.equal(imported.data.imported, 2);
    const studentIds = imported.data.student_ids;
    const assigned = await fn('assignStudents', { class_type: 'subject', class_id: subject.data.class.id, student_ids: studentIds });
    assert.equal(assigned.data.added, 2);
    const memberships = (await batch([{ entity: 'ClassMembership', query: { class_id: subject.data.class.id } }])).data.results[0].items;
    const removed = await fn('removeClassStudent', { membership_id: memberships[0].id });
    assert.equal(removed.data.student_count, 1);

    cookie = (await call('/api/auth/login', 'POST', { username: 'tina.t', password: 'teacher-pass-1' }))
      .headers.get('set-cookie').split(';')[0];
    assert.equal((await fn('saveClass', { type: 'homeroom', class: { name: 'Nope' } })).status, 403);
    const own = await fn('saveClass', { type: 'subject', class: { name: 'Tina Art', subject: 'Art' }, teacher_ids: [] });
    assert.equal(own.status, 200);
    const ownLinks = (await batch([{ entity: 'ClassTeacher', query: { class_id: own.data.class.id } }])).data.results[0].items;
    assert.equal(ownLinks[0].member_id, tina.id, 'a teacher who creates a class is assigned to it');
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
