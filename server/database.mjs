import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const dataDirectory = path.resolve(process.env.CLASSPULSE_DATA_DIR || path.join(root, 'data'));
export const databasePath = path.join(dataDirectory, 'classpulse.sqlite');
export const isPostgresMode = Boolean(process.env.DATABASE_URL);
if (process.env.VERCEL && !isPostgresMode) {
  throw new Error('DATABASE_URL must be configured for the Vercel deployment');
}

const requestDatabaseContext = new AsyncLocalStorage();

function initializeSqliteDatabase(db, local = false) {
  db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS records (
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    school_id TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    PRIMARY KEY (entity, id)
  );
  CREATE TABLE IF NOT EXISTS student_id_sequences (
    school_id TEXT NOT NULL,
    cohort_key TEXT NOT NULL,
    next_value INTEGER NOT NULL,
    PRIMARY KEY (school_id, cohort_key)
  );
  CREATE TABLE IF NOT EXISTS accounts (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL,
    window_started_at INTEGER NOT NULL,
    blocked_until INTEGER NOT NULL DEFAULT 0
  );
`);
  if (local) {
    db.exec('CREATE INDEX IF NOT EXISTS records_by_school ON records(entity, school_id)');
    db.exec('CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at)');
  }
}

let localDatabase = null;
let pool = null;
let schemaPromise = null;
if (!isPostgresMode) {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  localDatabase = new DatabaseSync(databasePath);
  chmodSync(databasePath, 0o600);
  initializeSqliteDatabase(localDatabase, true);
} else {
  const connectionUrl = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (!['require', 'verify-ca', 'verify-full'].includes(connectionUrl.searchParams.get('sslmode'))) {
    connectionUrl.searchParams.set('sslmode', 'require');
  }
  connectionUrl.searchParams.set('uselibpqcompat', 'true');
  pool = new Pool({
    connectionString: connectionUrl.toString(),
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  });
}

export const database = isPostgresMode
  ? new Proxy({}, {
      get(_target, property) {
        if (property === 'name') return 'Supabase PostgreSQL';
        const currentDatabase = requestDatabaseContext.getStore()?.database;
        if (!currentDatabase) {
          throw new Error('Database access must run inside a PostgreSQL request transaction');
        }
        const value = currentDatabase[property];
        return typeof value === 'function' ? value.bind(currentDatabase) : value;
      },
    })
  : localDatabase;

function readEntityDefinition(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const entityDirectory = path.join(root, 'base44', 'entities');
export const entityDefinitions = new Map(
  readdirSync(entityDirectory)
    .filter((name) => name.endsWith('.jsonc'))
    .map((name) => {
      const definition = readEntityDefinition(path.join(entityDirectory, name));
      return [definition.name, definition];
    }),
);
const extraDefinition = path.join(root, 'HomeroomClass.jsonc');
try {
  const definition = readEntityDefinition(extraDefinition);
  entityDefinitions.set(definition.name, definition);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS records (
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    school_id TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL,
    PRIMARY KEY (entity, id)
  );
  CREATE INDEX IF NOT EXISTS records_by_school ON records(entity, school_id);
  CREATE UNIQUE INDEX IF NOT EXISTS records_student_id_unique
    ON records(school_id, lower(data->>'student_id_no'))
    WHERE entity = 'Student' AND COALESCE(data->>'student_id_no', '') <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS records_initial_admin_unique
    ON records((data->>'role'))
    WHERE entity = 'User' AND data->>'role' = 'admin' AND COALESCE(data->>'school_id', '') = '';
  CREATE UNIQUE INDEX IF NOT EXISTS records_birth_paper_unique
    ON records(school_id, lower(regexp_replace(data->>'birth_paper_no', '[^a-zA-Z0-9]', '', 'g')))
    WHERE entity = 'Student' AND COALESCE(data->>'birth_paper_no', '') <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS records_class_membership_unique
    ON records(school_id, COALESCE(data->>'class_type', 'homeroom'), (data->>'class_id'), (data->>'student_id'))
    WHERE entity = 'ClassMembership';
  CREATE UNIQUE INDEX IF NOT EXISTS records_attendance_session_unique
    ON records(school_id, (data->>'session_key'))
    WHERE entity = 'AttendanceSession' AND COALESCE(data->>'session_key', '') <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS records_student_enrollment_unique
    ON records(
      school_id,
      COALESCE(data->>'class_type', 'homeroom'),
      (data->>'student_id'),
      COALESCE(data->>'source_class_id', ''),
      COALESCE(data->>'destination_academic_year_id', '')
    )
    WHERE entity = 'StudentEnrollment';
  CREATE TABLE IF NOT EXISTS student_id_sequences (
    school_id TEXT NOT NULL,
    cohort_key TEXT NOT NULL,
    next_value INTEGER NOT NULL,
    PRIMARY KEY (school_id, cohort_key)
  );
  CREATE TABLE IF NOT EXISTS accounts (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_unique ON accounts(lower(username));
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL,
    window_started_at BIGINT NOT NULL,
    blocked_until BIGINT NOT NULL DEFAULT 0
  );
`;

function ensurePostgresSchema() {
  schemaPromise ||= pool.query(postgresSchema)
    .then(() => undefined)
    .catch((error) => {
      schemaPromise = null;
      throw error;
    });
  return schemaPromise;
}

export function initializePostgresDatabase() {
  if (!isPostgresMode) {
    throw new Error('Set DATABASE_URL before initializing PostgreSQL');
  }
  return ensurePostgresSchema();
}

export async function closePostgresPool() {
  if (pool) await pool.end();
}

function snapshotKey(...parts) {
  return JSON.stringify(parts);
}

async function loadPostgresSnapshot(client, db) {
  const records = await client.query('SELECT entity, id, school_id, data FROM records');
  const accounts = await client.query('SELECT user_id, username, password_hash, active, created_at FROM accounts');
  const sessions = await client.query('SELECT token_hash, user_id, expires_at FROM sessions');
  const loginAttempts = await client.query('SELECT attempt_key, failures, window_started_at, blocked_until FROM login_attempts');
  const sequences = await client.query('SELECT school_id, cohort_key, next_value FROM student_id_sequences');
  const original = {
    records: new Map(),
    accounts: new Map(),
    sessions: new Map(),
    loginAttempts: new Map(),
    sequences: new Map(),
  };
  const insertRecord = db.prepare('INSERT INTO records (entity, id, school_id, data) VALUES (?, ?, ?, ?)');
  for (const row of records.rows) {
    const data = typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
    original.records.set(snapshotKey(row.entity, row.id), data);
    insertRecord.run(row.entity, row.id, row.school_id, data);
  }
  const insertAccount = db.prepare(
    'INSERT INTO accounts (user_id, username, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const row of accounts.rows) {
    const active = row.active ? 1 : 0;
    original.accounts.set(row.user_id, [row.username, row.password_hash, active, row.created_at]);
    insertAccount.run(row.user_id, row.username, row.password_hash, active, row.created_at);
  }
  const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  for (const row of sessions.rows) {
    const expiresAt = Number(row.expires_at);
    original.sessions.set(snapshotKey(row.token_hash), [row.user_id, expiresAt]);
    insertSession.run(row.token_hash, row.user_id, expiresAt);
  }
  const insertLoginAttempt = db.prepare(
    'INSERT INTO login_attempts (attempt_key, failures, window_started_at, blocked_until) VALUES (?, ?, ?, ?)',
  );
  for (const row of loginAttempts.rows) {
    const values = [Number(row.failures), Number(row.window_started_at), Number(row.blocked_until)];
    original.loginAttempts.set(snapshotKey(row.attempt_key), values);
    insertLoginAttempt.run(row.attempt_key, ...values);
  }
  const insertSequence = db.prepare(
    'INSERT INTO student_id_sequences (school_id, cohort_key, next_value) VALUES (?, ?, ?)',
  );
  for (const row of sequences.rows) {
    const key = snapshotKey(row.school_id, row.cohort_key);
    const nextValue = Number(row.next_value);
    original.sequences.set(key, nextValue);
    insertSequence.run(row.school_id, row.cohort_key, nextValue);
  }
  return original;
}

async function syncRecords(client, db, original) {
  const current = db.prepare('SELECT entity, id, school_id, data FROM records').all();
  const seen = new Set();
  for (const row of current) {
    const key = snapshotKey(row.entity, row.id);
    seen.add(key);
    const previous = original.get(key);
    if (previous === undefined) {
      await client.query(
        'INSERT INTO records (entity, id, school_id, data) VALUES ($1, $2, $3, $4::jsonb)',
        [row.entity, row.id, row.school_id, row.data],
      );
    } else if (previous !== row.data) {
      const result = await client.query(
        `UPDATE records SET school_id = $3, data = $4::jsonb
         WHERE entity = $1 AND id = $2 AND data = $5::jsonb`,
        [row.entity, row.id, row.school_id, row.data, previous],
      );
      if (result.rowCount !== 1) throw Object.assign(new Error('Concurrent record update'), { code: '40001' });
    }
  }
  for (const [key, previous] of original) {
    if (seen.has(key)) continue;
    const [entity, id] = JSON.parse(key);
    const result = await client.query(
      'DELETE FROM records WHERE entity = $1 AND id = $2 AND data = $3::jsonb',
      [entity, id, previous],
    );
    if (result.rowCount !== 1) throw Object.assign(new Error('Concurrent record deletion'), { code: '40001' });
  }
}

async function syncSimpleTable(client, db, table, original, columns, keyColumns, numericColumns = []) {
  const columnList = columns.join(', ');
  const current = db.prepare(`SELECT ${columnList} FROM ${table}`).all();
  const keyOf = (row) => snapshotKey(...keyColumns.map((column) => row[column]));
  const valuesOf = (row) => columns.filter((column) => !keyColumns.includes(column))
    .map((column) => numericColumns.includes(column) ? Number(row[column]) : row[column]);
  const seen = new Set();
  const pgColumns = columns.map((column) => `"${column}"`).join(', ');
  const pgValues = columns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = columns.filter((column) => !keyColumns.includes(column))
    .map((column, index) => `"${column}" = $${keyColumns.length + index + 1}`).join(', ');
  for (const row of current) {
    const key = keyOf(row);
    seen.add(key);
    const values = valuesOf(row);
    const previous = original.get(key);
    const currentValues = keyColumns.map((column) => row[column]).concat(values);
    if (previous === undefined) {
      await client.query(
        `INSERT INTO ${table} (${pgColumns}) VALUES (${pgValues})`,
        currentValues,
      );
    } else if (JSON.stringify(previous) !== JSON.stringify(values)) {
      const where = keyColumns.map((column, index) => `"${column}" = $${index + 1}`).join(' AND ');
      const updateValues = currentValues.concat(previous);
      const previousConditions = columns.filter((column) => !keyColumns.includes(column))
        .map((column, index) => `"${column}" = $${keyColumns.length + values.length + index + 1}`).join(' AND ');
      const result = await client.query(
        `UPDATE ${table} SET ${updates}
         WHERE ${where} AND ${previousConditions}`,
        updateValues,
      );
      if (result.rowCount !== 1) throw Object.assign(new Error(`Concurrent ${table} update`), { code: '40001' });
    }
  }
  for (const [key, previous] of original) {
    if (seen.has(key)) continue;
    const keyValues = JSON.parse(key);
    const where = keyColumns.map((column, index) => `"${column}" = $${index + 1}`).join(' AND ');
    const oldValues = keyColumns.concat(columns.filter((column) => !keyColumns.includes(column)))
      .map((column, index) => keyColumns.includes(column) ? keyValues[keyColumns.indexOf(column)] : previous[columns.filter((item) => !keyColumns.includes(item)).indexOf(column)]);
    const previousConditions = columns.filter((column) => !keyColumns.includes(column))
      .map((column, index) => `"${column}" = $${keyColumns.length + index + 1}`).join(' AND ');
    const result = await client.query(
      `DELETE FROM ${table} WHERE ${where} AND ${previousConditions}`,
      oldValues,
    );
    if (result.rowCount !== 1) throw Object.assign(new Error(`Concurrent ${table} deletion`), { code: '40001' });
  }
}

async function flushPostgresSnapshot(client, db, original) {
  await syncRecords(client, db, original.records);

  const accountOriginal = original.accounts;
  const accountCurrent = db.prepare(
    'SELECT user_id, username, password_hash, active, created_at FROM accounts',
  ).all();
  const accountSeen = new Set();
  for (const row of accountCurrent) {
    accountSeen.add(row.user_id);
    const values = [row.username, row.password_hash, Number(row.active), row.created_at];
    const previous = accountOriginal.get(row.user_id);
    if (!previous) {
      await client.query(
        'INSERT INTO accounts (user_id, username, password_hash, active, created_at) VALUES ($1, $2, $3, $4, $5)',
        [row.user_id, row.username, row.password_hash, Boolean(row.active), row.created_at],
      );
    } else if (JSON.stringify(previous) !== JSON.stringify(values)) {
      const result = await client.query(
        `UPDATE accounts SET username = $2, password_hash = $3, active = $4, created_at = $5
         WHERE user_id = $1 AND username = $6 AND password_hash = $7 AND active = $8 AND created_at = $9`,
        [row.user_id, row.username, row.password_hash, Boolean(row.active), row.created_at,
          previous[0], previous[1], Boolean(previous[2]), previous[3]],
      );
      if (result.rowCount !== 1) throw Object.assign(new Error('Concurrent account update'), { code: '40001' });
    }
  }
  for (const [userId, previous] of accountOriginal) {
    if (accountSeen.has(userId)) continue;
    const result = await client.query(
      `DELETE FROM accounts
       WHERE user_id = $1 AND username = $2 AND password_hash = $3 AND active = $4 AND created_at = $5`,
      [userId, previous[0], previous[1], Boolean(previous[2]), previous[3]],
    );
    if (result.rowCount !== 1) throw Object.assign(new Error('Concurrent account deletion'), { code: '40001' });
  }

  await syncSimpleTable(
    client, db, 'sessions', original.sessions,
    ['token_hash', 'user_id', 'expires_at'], ['token_hash'], ['expires_at'],
  );
  await syncSimpleTable(
    client, db, 'login_attempts', original.loginAttempts,
    ['attempt_key', 'failures', 'window_started_at', 'blocked_until'],
    ['attempt_key'], ['failures', 'window_started_at', 'blocked_until'],
  );
  await syncSimpleTable(
    client, db, 'student_id_sequences', original.sequences,
    ['school_id', 'cohort_key', 'next_value'], ['school_id', 'cohort_key'], ['next_value'],
  );
}

export async function withRequestDatabase(callback) {
  if (!isPostgresMode) return callback();
  await initializePostgresDatabase();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    const requestDatabase = new DatabaseSync(':memory:');
    let transactionStarted = false;
    try {
      initializeSqliteDatabase(requestDatabase);
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      transactionStarted = true;
      const original = await loadPostgresSnapshot(client, requestDatabase);
      const result = await requestDatabaseContext.run(
        { database: requestDatabase },
        callback,
      );
      await flushPostgresSnapshot(client, requestDatabase, original);
      await client.query('COMMIT');
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
      }
      if (['40001', '40P01'].includes(error.code) && attempt < 2) continue;
      if (error.code === '23505') {
        const messages = {
          accounts_username_unique: 'That username is already in use.',
          records_initial_admin_unique: 'Initial administrator setup is already complete.',
          records_student_id_unique: 'That student ID is already in use.',
          records_birth_paper_unique: 'A student with that birth paper number already exists.',
          records_class_membership_unique: 'This student is already assigned to that class.',
          records_attendance_session_unique: 'An attendance session already exists for this class and date.',
          records_student_enrollment_unique: 'This student enrollment already exists.',
        };
        console.error('PostgreSQL unique constraint violation:', error.constraint || 'unknown');
        throw Object.assign(new Error(messages[error.constraint] || 'This change conflicts with existing data. Refresh and try again.'), {
          status: 409,
        });
      }
      if (['40001', '40P01'].includes(error.code)) {
        throw Object.assign(new Error('Another user changed this data at the same time. Please retry.'), {
          status: 503,
          expose: true,
        });
      }
      throw error;
    } finally {
      requestDatabase.close();
      client.release();
    }
  }
  throw Object.assign(new Error('Another user changed this data at the same time. Please retry.'), {
    status: 503,
    expose: true,
  });
}

export function getRecord(entity, id) {
  const row = database.prepare('SELECT data FROM records WHERE entity = ? AND id = ?').get(entity, id);
  return row ? JSON.parse(row.data) : null;
}

export function getRecords(entity) {
  return database.prepare('SELECT data FROM records WHERE entity = ?').all(entity).map((row) => JSON.parse(row.data));
}

export function createRecord(entity, input) {
  const definition = entityDefinitions.get(entity);
  if (!definition) throw Object.assign(new Error(`Unknown entity: ${entity}`), { status: 404 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Record must be an object'), { status: 400 });
  }

  const now = new Date().toISOString();
  const defaults = Object.fromEntries(
    Object.entries(definition.properties || {})
      .filter(([, property]) => Object.hasOwn(property, 'default'))
      .map(([key, property]) => [key, property.default]),
  );
  const record = {
    ...defaults,
    ...input,
    id: input.id || randomUUID(),
    created_date: input.created_date || now,
    updated_date: now,
  };
  for (const required of definition.required || []) {
    if (record[required] === undefined || record[required] === null || record[required] === '') {
      throw Object.assign(new Error(`${required} is required`), { status: 400 });
    }
  }
  database.prepare(
    'INSERT INTO records (entity, id, school_id, data) VALUES (?, ?, ?, ?)',
  ).run(entity, record.id, record.school_id || '', JSON.stringify(record));
  return record;
}

export function updateRecord(entity, id, patch) {
  const current = getRecord(entity, id);
  if (!current) throw Object.assign(new Error(`${entity} record not found`), { status: 404 });
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw Object.assign(new Error('Update must be an object'), { status: 400 });
  }
  const next = { ...current, ...patch, id: current.id, updated_date: new Date().toISOString() };
  database.prepare('UPDATE records SET school_id = ?, data = ? WHERE entity = ? AND id = ?')
    .run(next.school_id || '', JSON.stringify(next), entity, id);
  return next;
}

export function deleteRecord(entity, id) {
  return database.prepare('DELETE FROM records WHERE entity = ? AND id = ?').run(entity, id).changes > 0;
}

export function withTransaction(callback) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
