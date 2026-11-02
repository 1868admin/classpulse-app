import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server', 'index.mjs');
const setupToken = 'test-only-first-admin-key-0123456789abcdef';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url, child, output) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test server exited early: ${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Test server did not become ready: ${output()}`);
}

async function request(baseUrl, route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

test('one-time setup creates an admin who can create and link school workspaces', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'classpulse-admin-setup-'));
  const port = await unusedPort();
  const environment = {
    ...process.env,
    CLASSPULSE_DATA_DIR: path.join(tempDirectory, 'data'),
    CLASSPULSE_HOST: '127.0.0.1',
    CLASSPULSE_PORT: String(port),
    INITIAL_ADMIN_SETUP_TOKEN: setupToken,
  };
  delete environment.DATABASE_URL;
  delete environment.VERCEL;

  const child = spawn(process.execPath, [serverPath], { cwd: root, env: environment });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk; });
  child.stderr.on('data', (chunk) => { serverOutput += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(`${baseUrl}/api/health`, child, () => serverOutput);

    const { data: setupStatus } = await request(baseUrl, '/api/auth/setup-status');
    assert.deepEqual(setupStatus, {
      needs_setup: true,
      setup_available: true,
      requires_setup_token: true,
    });
    assert.equal(JSON.stringify(setupStatus).includes(setupToken), false);

    const rejected = await request(baseUrl, '/api/auth/setup', {
      method: 'POST',
      body: {
        fullName: 'Initial Administrator',
        username: 'admin.one',
        email: 'admin@example.test',
        password: 'valid-test-password',
        setupToken: 'incorrect-key',
      },
    });
    assert.equal(rejected.response.status, 403);

    const created = await request(baseUrl, '/api/auth/setup', {
      method: 'POST',
      body: {
        fullName: 'Initial Administrator',
        username: 'admin.one',
        email: 'admin@example.test',
        password: 'valid-test-password',
        setupToken,
      },
    });
    assert.equal(created.response.status, 201);
    const cookie = created.response.headers.get('set-cookie').split(';', 1)[0];
    assert.equal(created.data.user.role, 'admin');

    const { data: completedStatus } = await request(baseUrl, '/api/auth/setup-status');
    assert.equal(completedStatus.needs_setup, false);
    assert.equal(completedStatus.setup_available, false);

    const contextBeforeSchool = await request(baseUrl, '/api/functions/sessionContext', {
      method: 'POST',
      body: {},
      cookie,
    });
    assert.equal(contextBeforeSchool.data.user.role, 'admin');
    assert.equal(contextBeforeSchool.data.member, null);

    const provisioned = await request(baseUrl, '/api/functions/provisionSchool', {
      method: 'POST',
      body: {
        name: 'First School',
        academic_year_label: '2026/2027',
        year_group_names: ['Form 1', 'Form 2'],
      },
      cookie,
    });
    assert.equal(provisioned.data.member.role, 'school_admin');
    assert.equal(provisioned.data.member.school_id, provisioned.data.school.id);

    const staffAccount = await request(baseUrl, '/api/functions/manageStaff', {
      method: 'POST',
      body: {
        action: 'invite',
        full_name: 'Local Teacher',
        role: 'teacher',
        username: 'local.teacher',
        password: 'teacher-test-password',
      },
      cookie,
    });
    assert.equal(staffAccount.response.status, 200);
    assert.equal(staffAccount.data.member.user_email, '');
    assert.equal(staffAccount.data.member.username, 'local.teacher');
    const staffLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'local.teacher', password: 'teacher-test-password' },
    });
    assert.equal(staffLogin.response.status, 200);

    const existingSchool = await request(baseUrl, '/api/entities/School', {
      method: 'POST',
      body: { name: 'Existing School', code: 'EXISTING' },
      cookie,
    });
    assert.equal(existingSchool.response.status, 201);
    const linked = await request(baseUrl, '/api/functions/switchSchool', {
      method: 'POST',
      body: { school_id: existingSchool.data.id },
      cookie,
    });
    assert.equal(linked.data.ok, true);
    assert.equal(linked.data.school_id, existingSchool.data.id);

    const linkedContext = await request(baseUrl, '/api/functions/sessionContext', {
      method: 'POST',
      body: {},
      cookie,
    });
    assert.equal(linkedContext.data.school.id, existingSchool.data.id);
    assert.equal(linkedContext.data.member.role, 'school_admin');

    const secondSetup = await request(baseUrl, '/api/auth/setup', {
      method: 'POST',
      body: {
        fullName: 'Second Administrator',
        username: 'admin.two',
        password: 'another-valid-password',
        setupToken,
      },
    });
    assert.equal(secondSetup.response.status, 409);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
