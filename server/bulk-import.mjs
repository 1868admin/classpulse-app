import { createHash } from 'node:crypto';
import { createRecord, getRecord, getRecords, updateRecord, withTransaction } from './database.mjs';

const STATUS_ALIASES = {
  present: 'present', p: 'present', absent: 'absent', a: 'absent',
  late: 'late', l: 'late', excused: 'excused', e: 'excused',
};
const SESSION_LABELS = { AM: 'Morning', PM: 'Afternoon' };
const MAX_CELLS = 60000;
const MAX_ROWS = 1000;
export const SUBJECTS = ['Mathematics', 'English', 'Physics', 'Chemistry', 'Biology', 'Integrated Science', 'History', 'Geography', 'Spanish', 'French', 'Social Studies', 'Physical Education', 'Information Technology', 'Business Studies', 'Visual Arts', 'Music', 'Religious Education'];

const isStaff = (member) => member && ['school_admin', 'it_admin'].includes(member.role);
const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const records = (entity, predicate = () => true) => getRecords(entity).filter(predicate);
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const splitList = (value) => [...new Set((Array.isArray(value) ? value : String(value ?? '').split(/[;,\n]/))
  .map((item) => String(item ?? '').trim()).filter(Boolean))];

function fail(message, status = 400, details) {
  throw Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

function requireMember(actor) {
  if (!actor) fail('Unauthorized', 401);
  if (!actor.member || actor.member.status !== 'active') fail('You are not attached to an active school account', 403);
  return actor.member;
}

function actorName(actor) {
  return actor.user.full_name || actor.user.email || actor.user.username || '';
}

function activeLink(schoolId, classId, memberId) {
  return records('ClassTeacher', (link) => link.school_id === schoolId && link.class_id === classId
    && link.member_id === memberId && link.is_active !== false)[0] || null;
}

function logImport(actor, member, { type, action, fileName, total, imported, failed, errors = [], summary, status = 'completed' }) {
  const job = createRecord('ImportJob', {
    school_id: member.school_id,
    type,
    file_name: fileName || '',
    total_rows: total,
    imported_count: imported,
    failed_count: failed,
    status,
    errors: errors.slice(0, 200).map((item) => (typeof item === 'string' ? item : `Row ${item.row}: ${item.message}`)),
    created_by_name: actorName(actor),
    summary,
  });
  createRecord('AuditLog', {
    school_id: member.school_id,
    actor_name: actorName(actor),
    actor_email: actor.user.email || '',
    action,
    entity_type: 'ImportJob',
    entity_id: job.id,
    summary,
    details: JSON.stringify({ file_name: fileName || '', total, imported, failed, uploaded_at: job.created_date }),
  });
  return job;
}

// Failures roll back the import transaction, so the failure itself is logged afterwards.
function logFailure(actor, member, info, error) {
  try {
    logImport(actor, member, { ...info, imported: 0, failed: info.total, status: 'failed',
      summary: `${info.summary}: ${error.message}`, errors: [error.message] });
  } catch { /* logging must never mask the original error */ }
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

function accessibleClasses(member) {
  const schoolId = member.school_id;
  const staff = isStaff(member);
  const linked = new Set(records('ClassTeacher', (link) => link.school_id === schoolId && link.member_id === member.id
    && link.is_active !== false).map((link) => link.class_id));
  const pick = (entity, type) => records(entity, (item) => item.school_id === schoolId && !item.archived
    && (staff || linked.has(item.id)))
    .map((item) => ({ type, id: item.id, name: item.name, year_group_name: item.year_group_name || '', subject: item.subject || '' }));
  return [...pick('HomeroomClass', 'homeroom'), ...pick('SubjectClass', 'subject')]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function loadAttendanceClass(member, classType, classId) {
  if (!['homeroom', 'subject'].includes(classType)) fail('Choose a homeroom or subject class');
  const klass = getRecord(classType === 'subject' ? 'SubjectClass' : 'HomeroomClass', String(classId || ''));
  if (!klass || klass.school_id !== member.school_id || klass.archived) fail('Class not found', 404);
  if (!isStaff(member) && !activeLink(member.school_id, klass.id, member.id)) {
    fail('You are not assigned to that class, so you cannot import or bulk-mark its attendance', 403);
  }
  return klass;
}

function resolveYear(schoolId, name) {
  const years = records('AcademicYear', (year) => year.school_id === schoolId);
  if (String(name || '').trim()) {
    const year = years.find((item) => norm(item.name) === norm(name));
    if (!year) fail(`Academic year "${name}" was not found in this school`);
    return year;
  }
  const current = years.find((year) => year.is_current);
  if (!current) fail('No current academic year is configured');
  return current;
}

function eachDate(start, end) {
  const out = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86400000) {
    out.push(new Date(time).toISOString().slice(0, 10));
  }
  return out;
}

function attendanceTemplateData(member, body) {
  const klass = loadAttendanceClass(member, body.class_type, body.class_id);
  const schoolId = member.school_id;
  const year = resolveYear(schoolId, body.academic_year);
  const memberships = records('ClassMembership', (row) => row.school_id === schoolId
    && (row.class_type || 'homeroom') === body.class_type && row.class_id === klass.id);
  const students = memberships.map((row) => getRecord('Student', row.student_id))
    .filter((student) => student && student.school_id === schoolId && !student.archived)
    .map((student) => ({
      id: student.id,
      student_id_no: student.student_id_no || '',
      first_name: student.first_name || '',
      surname: student.surname || '',
    }))
    .sort((a, b) => `${a.surname} ${a.first_name}`.localeCompare(`${b.surname} ${b.first_name}`, undefined, { sensitivity: 'base' }));
  const dates = [];
  const noSchoolDates = records('CalendarDate', (row) => row.school_id === schoolId && row.day_type === 'no_school').map((row) => row.date);
  if (body.start_date || body.end_date) {
    if (!isIsoDate(body.start_date) || !isIsoDate(body.end_date)) fail('Choose a valid start and end date');
    if (body.end_date < body.start_date) fail('The end date must not be before the start date');
    if (Date.parse(body.end_date) - Date.parse(body.start_date) > 366 * 86400000) fail('Choose a range of no more than 366 days');
    const noSchool = new Map(records('CalendarDate', (row) => row.school_id === schoolId && row.day_type === 'no_school')
      .map((row) => [row.date, row.reason || 'No school']));
    for (const date of eachDate(body.start_date, body.end_date)) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      let skipped = '';
      if (weekday === 0 || weekday === 6) skipped = 'Weekend';
      else if (noSchool.has(date)) skipped = `No school (${noSchool.get(date)})`;
      else if (year.start_date && date < year.start_date || year.end_date && date > year.end_date) skipped = 'Outside academic year';
      dates.push({ date, skipped });
    }
  }
  return {
    class: { type: body.class_type, id: klass.id, name: klass.name },
    academic_year: { id: year.id, name: year.name, start_date: year.start_date || '', end_date: year.end_date || '' },
    students,
    dates,
    no_school_dates: noSchoolDates,
  };
}

function buildAttendanceContext(member, body) {
  const schoolId = member.school_id;
  const klass = loadAttendanceClass(member, body.class_type, body.class_id);
  const year = resolveYear(schoolId, body.academic_year);
  const memberIds = new Set(records('ClassMembership', (row) => row.school_id === schoolId
    && (row.class_type || 'homeroom') === body.class_type && row.class_id === klass.id).map((row) => row.student_id));
  const studentsByNumber = new Map();
  for (const student of records('Student', (item) => item.school_id === schoolId)) {
    const key = norm(student.student_id_no);
    if (!key) continue;
    const current = studentsByNumber.get(key);
    if (!current || (current.archived && !student.archived)) studentsByNumber.set(key, student);
  }
  const noSchool = new Set(records('CalendarDate', (row) => row.school_id === schoolId && row.day_type === 'no_school')
    .map((row) => row.date));
  const sessions = records('AttendanceSession', (item) => item.school_id === schoolId && item.class_id === klass.id
    && (item.class_type || 'homeroom') === body.class_type);
  const sessionIds = new Set(sessions.map((item) => item.id));
  const existingRecords = new Map(records('AttendanceRecord', (item) => item.school_id === schoolId && sessionIds.has(item.session_id))
    .map((item) => [`${item.session_id}|${item.student_id}`, item]));
  return { member, schoolId, klass, classType: body.class_type, year, memberIds, studentsByNumber, noSchool, sessions, existingRecords };
}

function findSession(ctx, date, label) {
  const key = [ctx.schoolId, ctx.classType, ctx.klass.id, date, label].join('|');
  return ctx.sessions.find((item) => item.date === date && (item.session_key === key || item.session_label === label)) || null;
}

function evaluateAttendance(ctx, cells, actor) {
  const issues = [];
  const valid = [];
  const seen = new Map();
  const bad = new Set();
  const flag = (cell, message) => {
    bad.add(cell);
    issues.push({ row: cell.row || 0, column: cell.column || '', student_id_no: cell.student_id_no || '', date: cell.date || '', session: cell.session || '', message });
  };
  for (const cell of cells) {
    const idNo = String(cell.student_id_no ?? '').trim();
    const student = idNo ? ctx.studentsByNumber.get(norm(idNo)) : null;
    if (!idNo) flag(cell, 'Student ID is missing');
    else if (!student || student.archived) flag(cell, `Student ID "${idNo}" does not match any student in this school`);
    else if (!ctx.memberIds.has(student.id)) flag(cell, `Student ${idNo} (${student.full_name || student.surname}) is not enrolled in ${ctx.klass.name}`);

    const date = String(cell.date ?? '').trim();
    let dateOk = true;
    if (!isIsoDate(date)) { flag(cell, `Invalid date "${date}"`); dateOk = false; }
    else if ((ctx.year.start_date && date < ctx.year.start_date) || (ctx.year.end_date && date > ctx.year.end_date)) {
      flag(cell, `${date} is outside the academic year ${ctx.year.name}`); dateOk = false;
    } else if (ctx.noSchool.has(date)) { flag(cell, `${date} is marked as a no-school day`); dateOk = false; }

    const session = String(cell.session ?? '').trim().toUpperCase();
    if (!SESSION_LABELS[session]) flag(cell, `Invalid session "${cell.session ?? ''}". Use AM or PM`);

    const status = STATUS_ALIASES[norm(cell.status)];
    if (!status) flag(cell, `Invalid status "${cell.status ?? ''}". Use Present, Absent, Late or Excused`);

    if (student && dateOk && SESSION_LABELS[session]) {
      const key = `${student.id}|${date}|${session}`;
      if (seen.has(key)) flag(cell, `Duplicate entry for student ${idNo}, ${date} ${session} (first entered on row ${seen.get(key)})`);
      else seen.set(key, cell.row || 0);
    }
    if (bad.has(cell)) continue;

    const label = SESSION_LABELS[session];
    const existingSession = findSession(ctx, date, label);
    if (existingSession && !isStaff(ctx.member) && existingSession.user_id !== actor.user.id) {
      flag(cell, `The ${date} ${session} register was submitted by another teacher`);
      continue;
    }
    const existing = existingSession ? ctx.existingRecords.get(`${existingSession.id}|${student.id}`) || null : null;
    valid.push({
      cell, student, date, session, label, status, existingSession, existing,
      action: !existing ? 'create' : existing.status === status ? 'unchanged' : 'update',
    });
  }
  return { issues, valid };
}

function attendanceFingerprint(ctx, valid) {
  const parts = new Set();
  for (const item of valid) {
    const { existingSession, existing } = item;
    parts.add(`S|${item.date}|${item.label}|${existingSession ? `${existingSession.id}:${existingSession.updated_date}` : 'none'}`);
    if (existing) parts.add(`R|${existing.id}:${existing.updated_date}`);
  }
  return createHash('sha1').update([...parts].sort().join('\n')).digest('hex');
}

function summariseAttendance(cells, blank, { issues, valid }, overwrite) {
  const count = (action) => valid.filter((item) => item.action === action).length;
  const invalidCells = new Set(issues.map((issue) => `${issue.row}|${issue.column}|${issue.date}|${issue.session}|${issue.student_id_no}`)).size;
  return {
    detected: cells.length,
    valid: valid.length,
    invalid: invalidCells,
    created: count('create'),
    updates: count('update'),
    unchanged: count('unchanged'),
    blank,
    will_update: overwrite ? count('update') : 0,
    preserved: count('unchanged') + (overwrite ? 0 : count('update')),
  };
}

function parseAttendanceBody(body) {
  const cells = Array.isArray(body.cells) ? body.cells : [];
  if (!cells.length) fail('No attendance entries were found. Blank cells are treated as "no change".');
  if (cells.length > MAX_CELLS) fail(`Import at most ${MAX_CELLS.toLocaleString()} attendance entries at a time`);
  return { cells, blank: Number(body.blank_count) || 0 };
}

function attendancePreview(actor, member, body) {
  const { cells, blank } = parseAttendanceBody(body);
  const ctx = buildAttendanceContext(member, body);
  const result = evaluateAttendance(ctx, cells, actor);
  return {
    class: { id: ctx.klass.id, name: ctx.klass.name, type: ctx.classType },
    academic_year: { id: ctx.year.id, name: ctx.year.name },
    summary: summariseAttendance(cells, blank, result, false),
    issues: result.issues,
    fingerprint: attendanceFingerprint(ctx, result.valid),
    changes: result.valid.filter((item) => item.action !== 'unchanged').slice(0, 500).map((item) => ({
      row: item.cell.row || 0,
      student_id_no: item.student.student_id_no,
      student_name: item.student.full_name || `${item.student.first_name} ${item.student.surname}`.trim(),
      date: item.date,
      session: item.session,
      status: item.status,
      previous: item.existing?.status || '',
      action: item.action,
    })),
  };
}

function attendanceCommit(actor, member, body) {
  const { cells, blank } = parseAttendanceBody(body);
  const overwrite = body.overwrite === true;
  const info = { type: 'attendance', action: 'attendance.bulk_import_failed', fileName: body.file_name, total: cells.length,
    summary: 'Attendance bulk import failed' };
  try {
    return withTransaction(() => {
      const ctx = buildAttendanceContext(member, body);
      const result = evaluateAttendance(ctx, cells, actor);
      if (result.issues.length && body.skip_invalid !== true) {
        fail('Resolve the attendance errors, or choose to skip invalid records, before importing', 400, { issues: result.issues.slice(0, 200) });
      }
      if (body.fingerprint && body.fingerprint !== attendanceFingerprint(ctx, result.valid)) {
        fail('Attendance for this class changed after the preview was created. Preview the import again before saving.', 409);
      }
      const summary = summariseAttendance(cells, blank, result, overwrite);
      const groups = new Map();
      for (const item of result.valid) {
        const key = `${item.date}|${item.label}`;
        groups.set(key, [...(groups.get(key) || []), item]);
      }
      let created = 0;
      let updated = 0;
      let sessionsCreated = 0;
      let sessionsUpdated = 0;
      const by = actorName(actor);
      const now = new Date().toISOString();
      for (const items of groups.values()) {
        const { date, label } = items[0];
        let session = items[0].existingSession;
        let touched = false;
        const writes = items.filter((item) => item.action === 'create' || (item.action === 'update' && overwrite));
        if (!writes.length) continue;
        if (!session) {
          session = createRecord('AttendanceSession', {
            school_id: ctx.schoolId,
            session_key: [ctx.schoolId, ctx.classType, ctx.klass.id, date, label].join('|'),
            class_type: ctx.classType,
            class_id: ctx.klass.id,
            class_name: ctx.klass.name,
            subject: ctx.klass.subject || '',
            date,
            day_name: '',
            period_number: 0,
            period_numbers: [],
            session_label: label,
            member_id: member.id,
            member_name: member.full_name,
            user_id: actor.user.id,
            academic_year_id: ctx.year.id,
            student_count: 0,
            present_count: 0, absent_count: 0, late_count: 0, excused_count: 0,
            status: 'submitted',
            submitted_at: now,
            last_edited_by: by,
            source: 'bulk_import',
          });
          sessionsCreated += 1;
        } else touched = true;
        for (const item of writes) {
          if (item.action === 'create') {
            createRecord('AttendanceRecord', {
              school_id: ctx.schoolId,
              session_id: session.id,
              class_type: ctx.classType,
              class_id: ctx.klass.id,
              date,
              student_id: item.student.id,
              student_name: item.student.full_name || '',
              student_id_no: item.student.student_id_no || '',
              status: item.status,
              note: '',
              marked_by: by,
              academic_year_id: ctx.year.id,
            });
            created += 1;
          } else {
            updateRecord('AttendanceRecord', item.existing.id, { status: item.status, marked_by: by });
            updated += 1;
          }
        }
        const all = records('AttendanceRecord', (row) => row.school_id === ctx.schoolId && row.session_id === session.id);
        const tally = (status) => all.filter((row) => row.status === status).length;
        updateRecord('AttendanceSession', session.id, {
          student_count: all.length,
          present_count: tally('present'), absent_count: tally('absent'), late_count: tally('late'), excused_count: tally('excused'),
          last_edited_by: by,
        });
        if (touched) sessionsUpdated += 1;
      }
      const skippedExisting = overwrite ? 0 : summary.updates;
      const source = body.source === 'bulk_mark' ? 'Bulk-marked' : 'Imported';
      const text = `${source} attendance for ${ctx.klass.name}: ${created} added, ${updated} updated, ${summary.unchanged + skippedExisting} existing preserved, ${result.issues.length ? summary.invalid : 0} skipped as invalid`;
      const job = logImport(actor, member, {
        type: 'attendance',
        action: body.source === 'bulk_mark' ? 'attendance.bulk_marked' : 'attendance.bulk_imported',
        fileName: body.file_name, total: cells.length, imported: created + updated, failed: summary.invalid,
        errors: result.issues, summary: text,
      });
      return {
        job_id: job.id,
        created, updated,
        unchanged: summary.unchanged,
        skipped_existing: skippedExisting,
        skipped_invalid: summary.invalid,
        blank,
        sessions_created: sessionsCreated,
        sessions_updated: sessionsUpdated,
        summary: text,
      };
    });
  } catch (error) {
    logFailure(actor, member, info, error);
    throw error;
  }
}

export function bulkAttendance(actor, body) {
  const member = requireMember(actor);
  switch (body.action) {
    case 'classes': {
      const years = records('AcademicYear', (year) => year.school_id === member.school_id);
      return {
        classes: accessibleClasses(member),
        academic_years: years.map((year) => ({ id: year.id, name: year.name, is_current: !!year.is_current })),
      };
    }
    case 'template_data': return attendanceTemplateData(member, body);
    case 'preview': return attendancePreview(actor, member, body);
    case 'commit': return attendanceCommit(actor, member, body);
    default: return fail('Unknown bulk attendance action');
  }
}

/* ------------------------------------------------------------------ */
/* Subject classes                                                     */
/* ------------------------------------------------------------------ */

const eligibleTeacher = (item) => item.role === 'teacher' && item.status === 'active'
  && (item.employment_status || 'active') === 'active';

function subjectContext(member) {
  const schoolId = member.school_id;
  const inSchool = (item) => item.school_id === schoolId;
  const classes = records('SubjectClass', (item) => inSchool(item) && !item.archived);
  const subjects = new Map();
  for (const name of [...SUBJECTS, ...classes.map((item) => item.subject)]) {
    if (name && !subjects.has(norm(name))) subjects.set(norm(name), name);
  }
  return {
    schoolId,
    staff: isStaff(member),
    classes,
    subjects,
    yearGroups: records('YearGroup', inSchool),
    years: records('AcademicYear', inSchool),
    homerooms: records('HomeroomClass', (item) => inSchool(item) && !item.archived),
    teachers: records('SchoolMember', (item) => inSchool(item) && item.role === 'teacher'),
    students: records('Student', inSchool),
    links: records('ClassTeacher', (item) => inSchool(item) && item.class_type === 'subject' && item.is_active !== false),
    memberships: records('ClassMembership', (item) => inSchool(item) && item.class_type === 'subject'),
  };
}

function subjectTemplateData(member) {
  const ctx = subjectContext(member);
  const classRows = ctx.classes
    .filter((item) => ctx.staff || ctx.links.some((link) => link.class_id === item.id && link.member_id === member.id))
    .map((item) => ({
      name: item.name,
      subject: item.subject,
      year_group: item.year_group_name || '',
      section: item.section || '',
      academic_year: ctx.years.find((year) => year.id === item.academic_year_id)?.name || '',
      teachers: ctx.links.filter((link) => link.class_id === item.id).map((link) => {
        const teacher = ctx.teachers.find((candidate) => candidate.id === link.member_id);
        return teacher?.teacher_number || link.member_name;
      }),
      homerooms: item.homeroom_names || [],
      room: item.room || '',
    }));
  return {
    subjects: [...ctx.subjects.values()].sort(),
    year_groups: ctx.yearGroups.map((item) => item.name),
    academic_years: ctx.years.map((item) => ({ name: item.name, is_current: !!item.is_current })),
    homerooms: ctx.homerooms.map((item) => item.name),
    teachers: ctx.teachers.filter(eligibleTeacher).map((item) => ({ full_name: item.full_name, teacher_number: item.teacher_number || '' })),
    existing_classes: classRows,
  };
}

function matchTeacher(ctx, token) {
  const key = norm(token);
  const byNumber = ctx.teachers.filter((item) => norm(item.teacher_number) === key);
  if (byNumber.length === 1) return { teacher: byNumber[0] };
  const byName = ctx.teachers.filter((item) => norm(item.full_name) === key);
  if (byName.length === 1) return { teacher: byName[0] };
  if (byName.length > 1) return { error: `Teacher "${token}" matches more than one profile; use the Teacher Number` };
  return { error: `Teacher "${token}" was not found` };
}

function inspectSubjectClasses(member, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) fail(`Upload between 1 and ${MAX_ROWS} subject class rows`);
  const ctx = subjectContext(member);
  const currentYear = ctx.years.find((year) => year.is_current);
  const seenNames = new Set();
  return rows.map((input, index) => {
    const row = Number(input.__row) || index + 2;
    const errors = [];
    const warnings = [];
    const text = (key) => String(input[key] ?? '').trim().replace(/\s+/g, ' ');
    const subjectInput = text('subject');
    const subject = ctx.subjects.get(norm(subjectInput));
    if (!subjectInput) errors.push('Subject is required');
    else if (!subject) errors.push(`Subject "${subjectInput}" is not a recognised subject. Choose one from the template list`);

    const yearGroupInput = text('year_group');
    const yearGroup = ctx.yearGroups.find((item) => norm(item.name) === norm(yearGroupInput));
    if (!yearGroupInput) errors.push('Form/Year Group is required');
    else if (!yearGroup) errors.push(`Year group "${yearGroupInput}" was not found`);

    const yearInput = text('academic_year');
    const year = yearInput ? ctx.years.find((item) => norm(item.name) === norm(yearInput)) : currentYear;
    if (yearInput && !year) errors.push(`Academic year "${yearInput}" was not found`);
    else if (!year) errors.push('No current academic year is configured; enter an Academic Year');

    const section = text('section');
    const name = text('name') || [yearGroup?.name || yearGroupInput, subject || subjectInput, section].filter(Boolean).join(' ');
    if (!name) errors.push('Subject Class Name is required (or provide Year Group, Subject and Section)');
    if (name.length > 120) errors.push('Subject Class Name must be 120 characters or fewer');
    if (name) {
      if (seenNames.has(norm(name))) errors.push(`Subject class "${name}" appears more than once in this file`);
      seenNames.add(norm(name));
    }

    const existing = ctx.classes.find((item) => norm(item.name) === norm(name)) || null;
    if (existing) {
      if (subject && norm(existing.subject) !== norm(subject)) errors.push(`Existing class "${existing.name}" is ${existing.subject}; import will not change its subject`);
      if (yearGroup && existing.year_group_id && existing.year_group_id !== yearGroup.id) errors.push(`Existing class "${existing.name}" belongs to ${existing.year_group_name}; import will not change its year group`);
      if (year && existing.academic_year_id && existing.academic_year_id !== year.id) errors.push(`Existing class "${existing.name}" belongs to a different academic year`);
      if (!ctx.staff && !ctx.links.some((link) => link.class_id === existing.id && link.member_id === member.id)) {
        errors.push(`You are not authorised to change the existing class "${existing.name}"`);
      }
    }

    const activeTeacherIds = new Set(existing ? ctx.links.filter((link) => link.class_id === existing.id).map((link) => link.member_id) : []);
    const teachers = [];
    for (const token of splitList(input.teachers)) {
      const match = matchTeacher(ctx, token);
      if (match.error) errors.push(match.error);
      else if (!eligibleTeacher(match.teacher)) errors.push(`Teacher "${token}" is not an active teacher`);
      else if (!teachers.some((item) => item.id === match.teacher.id)) teachers.push(match.teacher);
    }
    if (!existing && !ctx.staff && !teachers.some((item) => item.id === member.id)) {
      teachers.push(ctx.teachers.find((item) => item.id === member.id) || member);
      warnings.push('You were added as a teacher of this new class');
    }
    if (!existing && !teachers.length) warnings.push('No teacher assigned yet');

    const homerooms = [];
    for (const token of splitList(input.homerooms)) {
      const homeroom = ctx.homerooms.find((item) => norm(item.name) === norm(token));
      if (!homeroom) errors.push(`Homeroom class "${token}" was not found`);
      else if (!homerooms.some((item) => item.id === homeroom.id)) homerooms.push(homeroom);
    }

    const memberIds = new Set(existing ? ctx.memberships.filter((item) => item.class_id === existing.id).map((item) => item.student_id) : []);
    const students = [];
    for (const token of splitList(input.students)) {
      const matches = ctx.students.filter((item) => norm(item.student_id_no) === norm(token));
      const student = matches.find((item) => !item.archived) || matches[0];
      if (!student) errors.push(`Student ID "${token}" was not found`);
      else if (student.archived) errors.push(`Student ${token} is archived`);
      else if (!students.some((item) => item.id === student.id)) students.push(student);
    }

    const teachersToAdd = teachers.filter((item) => !activeTeacherIds.has(item.id));
    const studentsToAdd = students.filter((item) => !memberIds.has(item.id));
    return {
      row,
      name,
      subject: subject || subjectInput,
      year_group: yearGroup,
      academic_year: year,
      section,
      room: text('room'),
      notes: text('notes'),
      existing_id: existing?.id || '',
      operation: existing ? (teachersToAdd.length || studentsToAdd.length || homerooms.length ? 'update' : 'unchanged') : 'create',
      teachers, teachers_to_add: teachersToAdd,
      students, students_to_add: studentsToAdd,
      homerooms,
      errors, warnings,
    };
  });
}

function subjectSummary(items) {
  const ok = items.filter((item) => !item.errors.length);
  return {
    total: items.length,
    create: ok.filter((item) => item.operation === 'create').length,
    update: ok.filter((item) => item.operation === 'update').length,
    unchanged: ok.filter((item) => item.operation === 'unchanged').length,
    invalid: items.length - ok.length,
    teacher_assignments: ok.reduce((sum, item) => sum + item.teachers_to_add.length, 0),
    student_assignments: ok.reduce((sum, item) => sum + item.students_to_add.length, 0),
  };
}

const slimSubjectRow = (item) => ({
  row: item.row, name: item.name, subject: item.subject, year_group: item.year_group?.name || '',
  academic_year: item.academic_year?.name || '', operation: item.operation,
  teachers: item.teachers.map((teacher) => teacher.full_name), teachers_to_add: item.teachers_to_add.length,
  students: item.students.length, students_to_add: item.students_to_add.length,
  errors: item.errors, warnings: item.warnings,
});

function subjectCommit(actor, member, body) {
  const info = { type: 'subject_classes', action: 'subject_classes.bulk_import_failed', fileName: body.file_name,
    total: Array.isArray(body.rows) ? body.rows.length : 0, summary: 'Subject class bulk import failed' };
  try {
    return withTransaction(() => {
      const items = inspectSubjectClasses(member, body.rows);
      const invalid = items.filter((item) => item.errors.length);
      if (invalid.length && body.skip_invalid !== true) {
        fail('Resolve the import errors before creating or updating subject classes', 400, { rows: items.map(slimSubjectRow) });
      }
      const schoolId = member.school_id;
      const today = new Date().toISOString().slice(0, 10);
      let created = 0;
      let updated = 0;
      let teachersAdded = 0;
      let studentsAdded = 0;
      for (const item of items.filter((entry) => !entry.errors.length)) {
        let klass = item.existing_id ? getRecord('SubjectClass', item.existing_id) : null;
        if (!klass) {
          klass = createRecord('SubjectClass', {
            school_id: schoolId,
            name: item.name,
            subject: item.subject,
            section: item.section,
            year_group_id: item.year_group.id,
            year_group_name: item.year_group.name,
            academic_year_id: item.academic_year.id,
            homeroom_ids: item.homerooms.map((homeroom) => homeroom.id),
            homeroom_names: item.homerooms.map((homeroom) => homeroom.name),
            owner_member_id: member.id,
            room: item.room,
            notes: item.notes,
            student_count: 0,
            archived: false,
          });
          created += 1;
        } else if (item.operation === 'update') {
          const homeroomIds = [...new Set([...(klass.homeroom_ids || []), ...item.homerooms.map((homeroom) => homeroom.id)])];
          klass = updateRecord('SubjectClass', klass.id, {
            homeroom_ids: homeroomIds,
            homeroom_names: homeroomIds.map((id) => getRecord('HomeroomClass', id)?.name).filter(Boolean),
            academic_year_id: klass.academic_year_id || item.academic_year.id,
          });
          updated += 1;
        }
        const hasPrimary = records('ClassTeacher', (link) => link.school_id === schoolId && link.class_id === klass.id
          && link.is_active !== false && link.is_primary).length > 0;
        item.teachers_to_add.forEach((teacher, position) => {
          createRecord('ClassTeacher', {
            school_id: schoolId,
            class_type: 'subject',
            class_id: klass.id,
            class_name: klass.name,
            member_id: teacher.id,
            user_id: teacher.user_id || '',
            member_name: teacher.full_name || '',
            is_primary: !hasPrimary && position === 0,
            is_active: true,
            assigned_at: today,
          });
          teachersAdded += 1;
        });
        for (const student of item.students_to_add) {
          createRecord('ClassMembership', {
            school_id: schoolId,
            class_type: 'subject',
            class_id: klass.id,
            class_name: klass.name,
            student_id: student.id,
            student_name: student.full_name || [student.first_name, student.surname].filter(Boolean).join(' '),
            student_id_no: student.student_id_no || '',
            year_group_id: student.year_group_id || '',
            year_group_name: student.year_group_name || '',
            academic_year_id: student.academic_year_id || '',
          });
          studentsAdded += 1;
        }
        if (item.students_to_add.length) {
          updateRecord('SubjectClass', klass.id, {
            student_count: records('ClassMembership', (row) => row.school_id === schoolId
              && row.class_type === 'subject' && row.class_id === klass.id).length,
          });
        }
      }
      const skipped = invalid.length;
      const text = `Subject class import: ${created} created, ${updated} updated, ${teachersAdded} teacher and ${studentsAdded} student assignment(s) added, ${skipped} row(s) skipped`;
      const job = logImport(actor, member, {
        type: 'subject_classes', action: 'subject_classes.bulk_imported', fileName: body.file_name,
        total: items.length, imported: created + updated, failed: skipped,
        errors: invalid.flatMap((item) => item.errors.map((message) => ({ row: item.row, message }))), summary: text,
      });
      return { job_id: job.id, created, updated, teachers_added: teachersAdded, students_added: studentsAdded, skipped, summary: text };
    });
  } catch (error) {
    logFailure(actor, member, info, error);
    throw error;
  }
}

export function bulkSubjectClasses(actor, body) {
  const member = requireMember(actor);
  switch (body.action) {
    case 'template_data': return subjectTemplateData(member);
    case 'preview': {
      const items = inspectSubjectClasses(member, body.rows);
      return { rows: items.map(slimSubjectRow), summary: subjectSummary(items) };
    }
    case 'commit': return subjectCommit(actor, member, body);
    default: return fail('Unknown bulk subject class action');
  }
}
