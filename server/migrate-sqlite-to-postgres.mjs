import { chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.resolve(process.env.CLASSPULSE_DATA_DIR || path.join(root, 'data'));
const defaultSource = path.join(dataDirectory, 'classpulse.sqlite');
const apply = process.argv.includes('--apply');
const sourceArgumentIndex = process.argv.indexOf('--source');
const sourceArgument = sourceArgumentIndex >= 0 ? process.argv[sourceArgumentIndex + 1] : '';
const sourcePath = sourceArgument
  ? path.resolve(sourceArgument)
  : defaultSource;

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) throw new Error(`The local database contains duplicate ${label} values; resolve them before migration.`);
    seen.add(value);
  }
}

export function validateSource(source) {
  const integrity = source.prepare('PRAGMA integrity_check').get();
  if (integrity.integrity_check !== 'ok') throw new Error('The local SQLite database did not pass its integrity check.');

  const records = source.prepare('SELECT entity, id, school_id, data FROM records').all()
    .map((row) => ({ ...row, value: JSON.parse(row.data) }));
  const accounts = source.prepare('SELECT user_id, username, password_hash, active, created_at FROM accounts').all();
  const sequences = source.prepare(
    'SELECT school_id, cohort_key, next_value FROM student_id_sequences',
  ).all();
  const students = records.filter((row) => row.entity === 'Student');
  const keyOf = (schoolId, value) => `${schoolId}\u0000${value}`;

  assertUnique(students.map((row) =>
    row.value.student_id_no ? keyOf(row.school_id, String(row.value.student_id_no).toLowerCase()) : ''),
  'student ID');
  assertUnique(students.map((row) =>
    row.value.birth_paper_no
      ? keyOf(row.school_id, String(row.value.birth_paper_no).toLowerCase().replace(/[^a-z0-9]/g, ''))
      : ''),
  'Birth Paper Number');
  assertUnique(accounts.map((account) => account.username.toLowerCase()), 'username');
  assertUnique(records.filter((row) => row.entity === 'AttendanceSession')
    .map((row) => row.value.session_key ? keyOf(row.school_id, row.value.session_key) : ''),
  'attendance session key');
  assertUnique(records.filter((row) => row.entity === 'User'
    && row.value.role === 'admin' && !row.value.school_id)
    .map(() => 'initial-admin'),
  'initial administrator');
  assertUnique(records.filter((row) => row.entity === 'ClassMembership')
    .map((row) => keyOf(
      row.school_id,
      `${row.value.class_type || 'homeroom'}|${row.value.class_id || ''}|${row.value.student_id || ''}`,
    )),
  'class membership');
  assertUnique(records.filter((row) => row.entity === 'StudentEnrollment')
    .map((row) => keyOf(
      row.school_id,
      `${row.value.class_type || 'homeroom'}|${row.value.student_id || ''}|${row.value.source_class_id || ''}|${row.value.destination_academic_year_id || ''}`,
    )),
  'student enrollment');

  return { records, accounts, sequences };
}

function makeBackup(sourcePath, source) {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const backupPath = `${sourcePath}.pre-cloud-${timestamp}`;
  source.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  chmodSync(backupPath, 0o600);
  return backupPath;
}

async function insertRows(client, table, columns, rows, jsonColumn = '') {
  const batchSize = 250;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const parameters = [];
    const valueGroups = batch.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        parameters.push(row[column]);
        const parameter = `$${rowIndex * columns.length + columnIndex + 1}`;
        return column === jsonColumn ? `${parameter}::jsonb` : parameter;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valueGroups.join(', ')}`,
      parameters,
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL in the private environment before connecting to Supabase.');
  }
  if (sourceArgumentIndex >= 0 && !sourceArgument) {
    throw new Error('Provide a path after --source.');
  }
  const { closePostgresPool, initializePostgresDatabase } = await import('./database.mjs');
  if (sourcePath === path.parse(sourcePath).root) throw new Error('Choose a local SQLite database file.');
  const source = new DatabaseSync(sourcePath, { readOnly: !apply });
  let pool;
  try {
    const data = validateSource(source);
    await initializePostgresDatabase();
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 10000,
    });
    const client = await pool.connect();
    try {
      const counts = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM records) AS records,
          (SELECT COUNT(*) FROM accounts) AS accounts,
          (SELECT COUNT(*) FROM sessions) AS sessions,
          (SELECT COUNT(*) FROM login_attempts) AS login_attempts,
          (SELECT COUNT(*) FROM student_id_sequences) AS sequences
      `);
      if (Object.values(counts.rows[0]).some((count) => Number(count) !== 0)) {
        throw new Error('The Supabase database is not empty. Migration stopped without changing it.');
      }

      if (!apply) {
        console.log(`Dry run passed: ${data.records.length} records, ${data.accounts.length} accounts, and ${data.sequences.length} ID sequences validated. No records were uploaded.`);
        return;
      }

      const backupPath = makeBackup(sourcePath, source);
      await client.query('BEGIN');
      try {
        await insertRows(client, 'records', ['entity', 'id', 'school_id', 'data'],
          data.records.map(({ entity, id, school_id, data: record }) => ({
            entity, id, school_id, data: JSON.stringify(record),
          })), 'data');
        await insertRows(client, 'accounts',
          ['user_id', 'username', 'password_hash', 'active', 'created_at'], data.accounts.map((account) => ({
            ...account,
            active: Boolean(account.active),
          })));
        await insertRows(client, 'student_id_sequences',
          ['school_id', 'cohort_key', 'next_value'], data.sequences);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(`Migration completed. ${data.records.length} records, ${data.accounts.length} accounts, and ${data.sequences.length} ID sequences were transferred. Existing sessions and login attempts were not transferred; users will sign in again.`);
      console.log(`Local backup created at ${backupPath}`);
    } finally {
      client.release();
    }
  } finally {
    source.close();
    if (pool) await pool.end();
    await closePostgresPool();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
