import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { database, databasePath, entityDefinitions, getRecord, getRecords, updateRecord, withTransaction } from './database.mjs';
import { getAccountForUser } from './auth.mjs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node server/import-base44.mjs <base44-export.json>');
  process.exit(2);
}

const MAX_IMPORT_BYTES = 250 * 1024 * 1024;
const stats = await importBundle(inputPath);
console.log(`Imported ${stats.imported} records across ${stats.entities} entities.`);
console.log(`Skipped ${stats.skipped} duplicate records.`);
console.log(`Database backup: ${stats.backup}`);

async function importBundle(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length > MAX_IMPORT_BYTES) throw new Error('Export file exceeds the 250 MB import limit.');
  const bundle = JSON.parse(buffer.toString('utf8'));
  const source = bundle.entities || bundle;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Export file must contain an entities object.');
  }
  if (source.User === undefined) source.User = [];
  const definedEntities = Object.keys(source).filter((name) => entityDefinitions.has(name));
  if (!definedEntities.length) throw new Error('No matching ClassPulse entities were found in the export.');
  const unknown = Object.keys(source).filter((name) => !entityDefinitions.has(name));
  if (unknown.length) throw new Error(`Export contains unrecognized entity names: ${unknown.join(', ')}`);
  for (const name of definedEntities) {
    if (!Array.isArray(source[name])) throw new Error(`Entity ${name} must contain an array of records.`);
  }

  const exportedUserIds = new Set(source.User.map((user) => String(user?.id || '')).filter(Boolean));
  for (const member of source.SchoolMember || []) {
    if (!member || typeof member !== 'object' || Array.isArray(member)) continue;
    const userId = String(member.user_id || randomUUID());
    member.user_id = userId;
    if (exportedUserIds.has(userId)) continue;
    exportedUserIds.add(userId);
    source.User.push({
      id: userId,
      email: member.user_email || '',
      full_name: member.full_name || '',
      role: 'user',
      school_id: member.school_id || '',
      school_role: member.role || '',
      member_id: member.id || '',
    });
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backupPath = `${databasePath}.before-import-${timestamp}`;
  database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);

  return withTransaction(() => {
    const accountUsers = new Map(
      getRecords('User')
        .filter((user) => getAccountForUser(user.id))
        .map((user) => [String(user.email || '').trim().toLowerCase(), user])
        .filter(([email]) => email),
    );
    const idMap = new Map();
    const emailMap = new Map();
    for (const importedUser of source.User || []) {
      if (!importedUser || typeof importedUser !== 'object') continue;
      const email = String(importedUser.email || '').trim().toLowerCase();
      const matchingUser = email ? accountUsers.get(email) : null;
      const localUser = matchingUser || (importedUser.id ? getRecord('User', importedUser.id) : null);
      if (importedUser.id && localUser) idMap.set(importedUser.id, localUser.id);
      if (email && localUser) emailMap.set(email, localUser.id);
    }

    let imported = 0;
    let skipped = 0;
    for (const entity of definedEntities) {
      for (const original of source[entity]) {
        if (!original || typeof original !== 'object' || Array.isArray(original)) {
          throw new Error(`Entity ${entity} contains a record that is not an object.`);
        }
        const row = { ...original, id: original.id || randomUUID() };
        if (typeof row.user_id === 'string') row.user_id = idMap.get(row.user_id) || row.user_id;
        if (entity === 'SchoolMember' && !row.user_id && row.user_email) {
          row.user_id = emailMap.get(String(row.user_email).trim().toLowerCase()) || '';
        }

        if (entity === 'User') {
          const localId = idMap.get(original.id) || row.id;
          const existing = getRecord('User', localId);
          if (existing) {
            const importedSchoolId = original.school_id || '';
            const importedMemberId = original.member_id || '';
            updateRecord('User', localId, {
              ...original,
              ...existing,
              id: localId,
              school_id: importedSchoolId || existing.school_id || '',
              school_role: original.school_role || existing.school_role || '',
              member_id: importedMemberId || existing.member_id || '',
              role: existing.role || original.role || 'user',
              username: existing.username || original.username || '',
            });
            skipped += 1;
            continue;
          }
          row.id = localId;
        }

        if (getRecord(entity, row.id)) {
          skipped += 1;
          continue;
        }
        const now = new Date().toISOString();
        const data = {
          ...row,
          id: row.id,
          created_date: row.created_date || now,
          updated_date: row.updated_date || now,
        };
        database.prepare('INSERT INTO records (entity, id, school_id, data) VALUES (?, ?, ?, ?)')
          .run(entity, data.id, data.school_id || '', JSON.stringify(data));
        imported += 1;
      }
    }

    for (const member of getRecords('SchoolMember')) {
      if (!member.user_id) continue;
      const user = getRecord('User', member.user_id);
      if (!user || (user.school_id && user.member_id)) continue;
      updateRecord('User', user.id, {
        school_id: member.school_id,
        school_role: member.role,
        member_id: member.id,
      });
    }
    return { imported, skipped, entities: definedEntities.length, backup: backupPath };
  });
}
