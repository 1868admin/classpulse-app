import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { database, createRecord, getRecord, updateRecord, withTransaction } from './database.mjs';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  const [saltHex, keyHex] = String(storedHash).split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validateCredentials(username, password) {
  if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 64) {
    throw Object.assign(new Error('Enter a username or email address'), { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw Object.assign(new Error('Passwords must be between 8 and 256 characters'), { status: 400 });
  }
}

export function findAccount(usernameOrEmail) {
  const normalized = String(usernameOrEmail || '').trim().toLowerCase();
  if (!normalized) return null;
  const byUsername = database.prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE').get(normalized);
  if (byUsername) return byUsername;
  for (const row of database.prepare('SELECT id, data FROM records WHERE entity = ?').all('User')) {
    const user = JSON.parse(row.data);
    if (String(user.email || '').toLowerCase() === normalized) {
      const account = database.prepare('SELECT * FROM accounts WHERE user_id = ?').get(user.id);
      if (account) return account;
    }
  }
  return null;
}

export function createLocalAccount({ username, password, userId, email = '' }) {
  validateCredentials(username, password);
  const cleanUsername = username.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(cleanUsername)) {
    throw Object.assign(new Error('Usernames must be 3–32 characters and use letters, numbers, dots, underscores or hyphens'), { status: 400 });
  }
  if (database.prepare('SELECT user_id FROM accounts WHERE username = ? COLLATE NOCASE').get(cleanUsername)) {
    throw Object.assign(new Error('That username is already in use'), { status: 409 });
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  const existingEmail = cleanEmail
    ? database.prepare('SELECT data FROM records WHERE entity = ?').all('User')
      .some((row) => {
        const user = JSON.parse(row.data);
        return user.id !== userId && String(user.email || '').toLowerCase() === cleanEmail;
      })
    : false;
  if (existingEmail) throw Object.assign(new Error('An account already uses that email'), { status: 409 });

  const createdAt = new Date().toISOString();
  database.prepare(
    'INSERT INTO accounts (user_id, username, password_hash, active, created_at) VALUES (?, ?, ?, 1, ?)',
  ).run(userId, cleanUsername, hashPassword(password), createdAt);
}

export function signIn(username, password, remoteAddress = '') {
  const attemptKey = hashToken(`${remoteAddress}|${String(username || '').trim().toLowerCase()}`);
  const now = Date.now();
  const attempts = database.prepare('SELECT * FROM login_attempts WHERE attempt_key = ?').get(attemptKey);
  if (attempts?.blocked_until > now) {
    throw Object.assign(new Error('Too many failed sign-in attempts. Try again in 15 minutes.'), { status: 429 });
  }
  if (attempts && now - attempts.window_started_at >= LOGIN_WINDOW_MS) {
    database.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(attemptKey);
  }
  const account = findAccount(username);
  if (!account || !account.active || !verifyPassword(String(password || ''), account.password_hash)) {
    const activeAttempts = attempts && now - attempts.window_started_at < LOGIN_WINDOW_MS ? attempts : null;
    const failures = (activeAttempts?.failures || 0) + 1;
    database.prepare(`
      INSERT INTO login_attempts (attempt_key, failures, window_started_at, blocked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(attempt_key) DO UPDATE SET
        failures = excluded.failures,
        window_started_at = excluded.window_started_at,
        blocked_until = excluded.blocked_until
    `).run(attemptKey, failures, activeAttempts?.window_started_at || now, failures >= LOGIN_FAILURE_LIMIT ? now + LOGIN_WINDOW_MS : 0);
    throw Object.assign(new Error('Invalid username or password'), { status: 401 });
  }
  database.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(attemptKey);
  return createSession(account.user_id);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

export function revokeSession(token) {
  if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function getTokenFromRequest(request) {
  const cookies = request.headers.cookie || '';
  const token = cookies.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('classpulse_session='))
    ?.slice('classpulse_session='.length);
  return token || '';
}

export function getActor(request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const session = database.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token));
  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    revokeSession(token);
    return null;
  }

  const account = database.prepare('SELECT active, username FROM accounts WHERE user_id = ?').get(session.user_id);
  const user = getRecord('User', session.user_id);
  if (!account?.active || !user) {
    revokeSession(token);
    return null;
  }
  const memberships = database.prepare('SELECT data FROM records WHERE entity = ?').all('SchoolMember')
    .map((row) => JSON.parse(row.data))
    .filter((member) => member.status !== 'inactive' && (
      member.user_id === user.id ||
      (user.email && String(member.user_email || '').toLowerCase() === String(user.email).toLowerCase())
    ));
  const member = memberships.find((candidate) => candidate.id === user.member_id)
    || memberships.find((candidate) => candidate.school_id === user.school_id)
    || memberships[0]
    || null;
  const schoolId = member?.school_id || user.school_id || '';
  return { user: { ...user, username: account.username, school_id: schoolId }, member, schoolId, token };
}

export function createFirstAdmin({ username, password, fullName, email }) {
  if (database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count > 0) {
    throw Object.assign(new Error('Initial setup is already complete'), { status: 409 });
  }
  validateCredentials(username, password);
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!name) throw Object.assign(new Error('Enter your full name'), { status: 400 });
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw Object.assign(new Error('Enter a valid email address'), { status: 400 });
  }

  const user = withTransaction(() => {
    const existing = cleanEmail
      ? database.prepare('SELECT id, data FROM records WHERE entity = ?').all('User')
        .map((row) => JSON.parse(row.data))
        .find((record) => String(record.email || '').toLowerCase() === cleanEmail)
      : null;
    const created = existing
      ? updateRecord('User', existing.id, {
          username: username.trim(),
          email: cleanEmail,
          full_name: name,
          role: 'admin',
        })
      : createRecord('User', {
          username: username.trim(),
          email: cleanEmail,
          full_name: name,
          role: 'admin',
          school_id: '',
          school_role: '',
          member_id: '',
        });
    createLocalAccount({ username, password, userId: created.id, email: cleanEmail });
    return created;
  });
  return { user, session: createSession(user.id) };
}

export function updateAccountCredentials({ userId, username, password }) {
  const account = database.prepare('SELECT * FROM accounts WHERE user_id = ?').get(userId);
  if (!account) throw Object.assign(new Error('This staff member does not have a local login yet'), { status: 404 });
  const cleanUsername = String(username || account.username).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(cleanUsername)) {
    throw Object.assign(new Error('Usernames must be 3–32 characters and use letters, numbers, dots, underscores or hyphens'), { status: 400 });
  }
  const usernameOwner = database.prepare('SELECT user_id FROM accounts WHERE username = ? COLLATE NOCASE').get(cleanUsername);
  if (usernameOwner && usernameOwner.user_id !== userId) {
    throw Object.assign(new Error('That username is already in use'), { status: 409 });
  }
  if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8 || password.length > 256)) {
    throw Object.assign(new Error('Passwords must be between 8 and 256 characters'), { status: 400 });
  }
  database.prepare('UPDATE accounts SET username = ?, password_hash = ? WHERE user_id = ?')
    .run(cleanUsername, password ? hashPassword(password) : account.password_hash, userId);
  if (password) database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return cleanUsername;
}

export function disableAccount(userId) {
  database.prepare('UPDATE accounts SET active = 0 WHERE user_id = ?').run(userId);
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function setAccountActive(userId, active) {
  database.prepare('UPDATE accounts SET active = ? WHERE user_id = ?').run(active ? 1 : 0, userId);
  if (!active) database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function isFirstRun() {
  return database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count === 0;
}

export function getAccountForUser(userId) {
  return database.prepare('SELECT user_id, username, active FROM accounts WHERE user_id = ?').get(userId) || null;
}

export function updateUser(userId, patch) {
  return updateRecord('User', userId, patch);
}
