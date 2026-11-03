import { database, getRecords } from './database.mjs';

function isOperatorObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).some((key) => key.startsWith('$'));
}

function matchesValue(actual, expected, options = '') {
  if (!isOperatorObject(expected)) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      return Object.entries(expected).every(([key, value]) => matchesValue(actual?.[key], value));
    }
    return actual === expected;
  }

  return Object.entries(expected).every(([operator, value]) => {
    switch (operator) {
      case '$eq': return actual === value;
      case '$ne': return actual !== value;
      case '$in': return Array.isArray(value) && value.includes(actual);
      case '$nin': return Array.isArray(value) && !value.includes(actual);
      case '$gt': return actual > value;
      case '$gte': return actual >= value;
      case '$lt': return actual < value;
      case '$lte': return actual <= value;
      case '$exists': return value ? actual !== undefined : actual === undefined;
      case '$regex': {
        const haystack = String(actual ?? '');
        const needle = String(value ?? '');
        return (expected.$options || options).includes('i')
          ? haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase())
          : haystack.includes(needle);
      }
      case '$options': return true;
      default: return false;
    }
  });
}

export function matchesQuery(record, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return false;
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$and') return Array.isArray(expected) && expected.every((part) => matchesQuery(record, part));
    if (key === '$or') return Array.isArray(expected) && expected.some((part) => matchesQuery(record, part));
    if (key === '$nor') return Array.isArray(expected) && expected.every((part) => !matchesQuery(record, part));
    return matchesValue(record[key], expected, query.$options || '');
  });
}

export function getAccessibleRecords(entity, actor) {
  const rows = getRecords(entity);
  if (entity === 'User') return rows.filter((record) => record.id === actor.user.id);
  const visible = actor.user.role === 'admin'
    ? rows
    : !actor.schoolId
      ? []
      : rows.filter((record) => entity === 'School'
        ? record.id === actor.schoolId
        : record.school_id === actor.schoolId);
  if (entity === 'TimetableEntry' && actor.member?.role === 'teacher') {
    return visible.filter((entry) => entry.member_id === actor.member.id
      && !entry.archived && entry.published !== false);
  }
  if (entity === 'ExaminationTimetableEntry' && actor.member?.role === 'teacher') {
    return visible.filter((entry) => entry.status === 'published');
  }
  if (entity === 'InvigilationAssignment' && actor.member?.role === 'teacher') {
    const publishedExaminations = new Set(getRecords('ExaminationTimetableEntry')
      .filter((entry) => entry.school_id === actor.schoolId && entry.status === 'published')
      .map((entry) => entry.id));
    return visible.filter((assignment) => assignment.teacher_member_id === actor.member.id
      && assignment.status === 'published'
      && publishedExaminations.has(assignment.examination_id));
  }
  if (entity === 'InvigilationRequirement' && actor.member?.role === 'teacher') return [];
  if (['AttendanceRecord', 'AttendanceSession'].includes(entity) && actor.member?.role === 'teacher') {
    const assignedClasses = new Set(getRecords('ClassTeacher')
      .filter((link) => link.school_id === actor.schoolId && link.member_id === actor.member.id)
      .map((link) => `${link.class_type || 'homeroom'}|${link.class_id}`));
    return visible.filter((record) => assignedClasses.has(`${record.class_type || 'homeroom'}|${record.class_id}`));
  }
  if (entity === 'Student' && !['school_admin', 'it_admin'].includes(actor.member?.role)
    && actor.user.role !== 'admin') {
    return visible.map(({ birth_paper_no, ...student }) => student);
  }
  if (entity !== 'SchoolMember') return visible;
  return visible.map((member) => {
    const account = member.user_id
      ? database.prepare('SELECT username FROM accounts WHERE user_id = ?').get(member.user_id)
      : null;
    return { ...member, has_local_login: !!account, username: account?.username || member.username || '' };
  });
}

export function queryRecords(entity, actor, query = {}) {
  return getAccessibleRecords(entity, actor).filter((record) => matchesQuery(record, query));
}

export function sortedRecords(records, sort) {
  const fields = (Array.isArray(sort) ? sort : [sort])
    .filter((field) => typeof field === 'string' && field.trim())
    .map((field) => {
      const clean = field.trim();
      return { key: clean.startsWith('-') ? clean.slice(1) : clean, direction: clean.startsWith('-') ? -1 : 1 };
    });
  if (!fields.length) return records;
  return records.toSorted((left, right) => {
    for (const { key, direction } of fields) {
      const a = left[key] ?? '';
      const b = right[key] ?? '';
      if (a < b) return -direction;
      if (a > b) return direction;
    }
    return 0;
  });
}

export function encodeCursor(offset) {
  return Buffer.from(String(offset)).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return 0;
  const decoded = Number(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(decoded) || decoded < 0) {
    throw Object.assign(new Error('Invalid pagination cursor'), { status: 400 });
  }
  return decoded;
}

export function paginate(records, options = {}) {
  const limit = Math.min(1000, Math.max(1, Number(options.limit) || 100));
  const offset = decodeCursor(options.cursor);
  const ordered = sortedRecords(records, options.sort);
  const items = ordered.slice(offset, offset + limit);
  return {
    items,
    next_cursor: offset + limit < ordered.length ? encodeCursor(offset + limit) : null,
  };
}
