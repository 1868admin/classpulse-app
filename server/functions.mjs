import { createRecord, database, deleteRecord, getRecord, getRecords, updateRecord, withTransaction } from './database.mjs';
import { createLocalAccount, disableAccount, getAccountForUser, setAccountActive, updateAccountCredentials, updateUser } from './auth.mjs';

const isStaff = (member) => member && ['school_admin', 'it_admin'].includes(member.role);
const isSchoolAdmin = (member) => member?.role === 'school_admin';
const inSchool = (record, schoolId) => record?.school_id === schoolId;
const records = (entity, predicate = () => true) => getRecords(entity).filter(predicate);
const find = (entity, predicate) => records(entity, predicate)[0] || null;

function requireActor(actor) {
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return actor;
}

function requireMembership(actor) {
  requireActor(actor);
  if (!actor.member || actor.member.status !== 'active') {
    throw Object.assign(new Error('You are not attached to an active school account'), { status: 403 });
  }
  return actor.member;
}

function requireStaff(member) {
  if (!isStaff(member)) throw Object.assign(new Error('Only school administrators can perform this action'), { status: 403 });
}

function audit(actor, { action, entityType = '', entityId = '', summary = '' }) {
  const member = actor.member;
  if (!member?.school_id) return;
  createRecord('AuditLog', {
    school_id: member.school_id,
    actor_name: actor.user.full_name || actor.user.username,
    actor_email: actor.user.email || '',
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
  });
}

function updateWhere(entity, predicate, patch) {
  const matches = records(entity, predicate);
  for (const record of matches) updateRecord(entity, record.id, patch);
  return matches.length;
}

function deleteWhere(entity, predicate) {
  const matches = records(entity, predicate);
  for (const record of matches) deleteRecord(entity, record.id);
  return matches.length;
}

function getActorSchool(actor) {
  return actor.member?.school_id || actor.user.school_id || '';
}

function sessionContext(actor) {
  requireActor(actor);
  const schoolId = getActorSchool(actor);
  const school = schoolId ? getRecord('School', schoolId) : null;
  return {
    user: {
      id: actor.user.id,
      full_name: actor.user.full_name,
      email: actor.user.email,
      username: actor.user.username,
      role: actor.user.role,
      school_id: schoolId,
    },
    member: actor.member
      ? {
          id: actor.member.id,
          role: actor.member.role,
          status: actor.member.status,
          full_name: actor.member.full_name,
          school_id: actor.member.school_id,
        }
      : null,
    school: school
      ? {
          id: school.id,
          name: school.name,
          code: school.code,
          academic_year_label: school.academic_year_label,
          attendance_alert_threshold: school.attendance_alert_threshold ?? 90,
          timetable_days: school.timetable_days,
          day_names: school.day_names,
          periods: school.periods,
          status: school.status,
        }
      : null,
  };
}

function provisionSchool(actor, body) {
  requireActor(actor);
  if (actor.user.role !== 'admin') {
    throw Object.assign(new Error('Only the local administrator can register a school'), { status: 403 });
  }
  const name = String(body.name || '').trim();
  if (!name) throw Object.assign(new Error('School name is required'), { status: 400 });
  const days = Number(body.timetable_days) > 0 ? Math.min(Number(body.timetable_days), 10) : 5;
  const dayNames = Array.isArray(body.day_names) && body.day_names.length
    ? body.day_names.slice(0, days)
    : Array.from({ length: days }, (_, index) => `Day ${index + 1}`);
  const periods = Array.isArray(body.periods) && body.periods.length ? body.periods : [
    { number: 1, start: '08:30', end: '09:20' },
    { number: 2, start: '09:20', end: '10:10' },
    { number: 3, start: '10:30', end: '11:20' },
    { number: 4, start: '11:20', end: '12:10' },
    { number: 5, start: '13:10', end: '14:00' },
    { number: 6, start: '14:00', end: '14:50' },
  ];
  const yearLabel = String(body.academic_year_label || '2026/2027');

  return withTransaction(() => {
    const school = createRecord('School', {
      name,
      code: String(body.code || name.slice(0, 6)).toUpperCase(),
      address: body.address || '',
      phone: body.phone || '',
      email: body.email || '',
      principal_name: body.principal_name || '',
      status: 'active',
      timetable_days: days,
      day_names: dayNames,
      periods,
      academic_year_label: yearLabel,
      setup_complete: false,
    });
    const academicYear = createRecord('AcademicYear', {
      school_id: school.id,
      name: yearLabel,
      start_date: body.year_start || '',
      end_date: body.year_end || '',
      is_current: true,
    });
    const groups = Array.isArray(body.year_group_names) && body.year_group_names.length
      ? body.year_group_names
      : ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5'];
    for (const [index, group] of groups.entries()) {
      createRecord('YearGroup', { school_id: school.id, name: String(group), level: index + 1, next_level: index + 2 });
    }
    for (const [index, name] of ['Term 1', 'Term 2', 'Term 3'].entries()) {
      createRecord('Term', {
        school_id: school.id,
        academic_year_id: academicYear.id,
        academic_year_name: yearLabel,
        name,
        is_current: index === 0,
      });
    }
    const member = createRecord('SchoolMember', {
      school_id: school.id,
      user_id: actor.user.id,
      user_email: actor.user.email || '',
      full_name: actor.user.full_name || actor.user.username,
      role: 'school_admin',
      status: 'active',
      username: actor.user.username,
    });
    updateUser(actor.user.id, {
      school_id: school.id,
      school_role: 'school_admin',
      member_id: member.id,
    });
    audit({ ...actor, member }, {
      action: 'school.created',
      entityType: 'School',
      entityId: school.id,
      summary: `Registered school ${name}`,
    });
    return { school, member, academicYear };
  });
}

function manageStaff(actor, body) {
  const member = requireMembership(actor);
  requireStaff(member);
  const schoolId = member.school_id;

  if (body.action === 'invite') {
    const email = String(body.user_email || '').trim().toLowerCase();
    const fullName = String(body.full_name || '').trim().replace(/\s+/g, ' ');
    const role = body.role || 'teacher';
    const username = String(body.username || email.split('@')[0] || '').trim();
    if (!fullName) {
      throw Object.assign(new Error("Enter the staff member's full name"), { status: 400 });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error('Enter a valid email address or leave it blank'), { status: 400 });
    }
    if (!['teacher', 'it_admin', 'school_admin'].includes(role)) {
      throw Object.assign(new Error('Unknown staff role'), { status: 400 });
    }
    if (role === 'school_admin' && !isSchoolAdmin(member)) {
      throw Object.assign(new Error('Only a school administrator can grant that role'), { status: 403 });
    }
    if (email && records('SchoolMember').some((item) => item.school_id === schoolId && item.user_email?.toLowerCase() === email)) {
      throw Object.assign(new Error('A staff account already exists for that email'), { status: 409 });
    }
    if (typeof body.password !== 'string' || body.password.length < 8) {
      throw Object.assign(new Error('Set a local password of at least 8 characters'), { status: 400 });
    }

    return withTransaction(() => {
      const user = createRecord('User', {
        email,
        full_name: fullName,
        role: 'user',
        school_id: schoolId,
        school_role: role,
      });
      createLocalAccount({ username, password: body.password, userId: user.id, email });
      const created = createRecord('SchoolMember', {
        school_id: schoolId,
        user_id: user.id,
        user_email: email,
        full_name: fullName,
        role,
        status: 'active',
        username,
        phone: body.phone || '',
        subject_specialisms: body.subject_specialisms || '',
      });
      updateUser(user.id, { member_id: created.id });
      audit({ ...actor, member }, {
        action: 'staff.created',
        entityType: 'SchoolMember',
        entityId: created.id,
        summary: `Created local account for ${fullName} (${role})`,
      });
      return { member: created, invited: false, local_account_created: true };
    });
  }

  if (body.action === 'update') {
    const target = getRecord('SchoolMember', body.member_id);
    if (!target || target.school_id !== schoolId) {
      throw Object.assign(new Error('Staff member not found'), { status: 404 });
    }
    if (target.role === 'school_admin' && !isSchoolAdmin(member)) {
      throw Object.assign(new Error('Only a school administrator can change an administrator account'), { status: 403 });
    }
    if (target.id === member.id && body.role && body.role !== target.role) {
      throw Object.assign(new Error('You cannot change your own role'), { status: 400 });
    }
    if (body.role === 'school_admin' && !isSchoolAdmin(member)) {
      throw Object.assign(new Error('Only a school administrator can grant that role'), { status: 403 });
    }
    const fullName = body.full_name === undefined ? target.full_name : String(body.full_name).trim().replace(/\s+/g, ' ');
    if (!fullName) throw Object.assign(new Error("Enter the staff member's full name"), { status: 400 });
    const patch = {
      full_name: fullName,
      role: body.role || target.role,
      status: body.status || target.status,
      username: body.username || target.username || '',
      phone: body.phone ?? target.phone ?? '',
      subject_specialisms: body.subject_specialisms ?? target.subject_specialisms ?? '',
    };

    return withTransaction(() => {
      let username = patch.username;
      const account = target.user_id ? getAccountForUser(target.user_id) : null;
      if (body.password || (username && username !== account?.username)) {
        if (account) {
          username = updateAccountCredentials({ userId: target.user_id, username, password: body.password });
        } else {
          if (!target.user_id || typeof body.password !== 'string' || body.password.length < 8) {
            throw Object.assign(new Error('This imported account needs a local password of at least 8 characters'), { status: 400 });
          }
          createLocalAccount({
            username,
            password: body.password,
            userId: target.user_id,
            email: target.user_email,
          });
          patch.status = 'active';
        }
      }
      patch.username = username;
      const updated = updateRecord('SchoolMember', target.id, patch);
      if (target.user_id) {
        updateUser(target.user_id, {
          full_name: fullName,
          school_role: patch.role,
          ...(patch.status === 'inactive' ? { school_id: '', member_id: '' } : { school_id: schoolId, member_id: target.id }),
        });
        if (patch.status === 'inactive') setAccountActive(target.user_id, false);
        else if (account) setAccountActive(target.user_id, true);
      }
      if (fullName !== target.full_name) {
        updateWhere('ClassTeacher', (item) => item.school_id === schoolId && item.member_id === target.id, { member_name: fullName });
        updateWhere('AttendanceSession', (item) => item.school_id === schoolId && item.member_id === target.id, { member_name: fullName });
      }
      audit({ ...actor, member }, {
        action: 'staff.updated',
        entityType: 'SchoolMember',
        entityId: target.id,
        summary: `Updated ${target.full_name}`,
      });
      return { member: updated };
    });
  }

  if (body.action === 'resend_invite') {
    throw Object.assign(new Error('Email invitations are unavailable in local mode. Edit this staff member to set or reset their local password.'), { status: 400 });
  }

  if (body.action === 'remove') {
    if (!isSchoolAdmin(member)) {
      throw Object.assign(new Error('Only a school administrator can remove staff'), { status: 403 });
    }
    const target = getRecord('SchoolMember', body.member_id);
    if (!target || target.school_id !== schoolId) {
      throw Object.assign(new Error('Staff member not found'), { status: 404 });
    }
    if (target.id === member.id) {
      throw Object.assign(new Error('You cannot remove your own account'), { status: 400 });
    }
    return withTransaction(() => {
      const links = deleteWhere('ClassTeacher', (item) => item.school_id === schoolId && item.member_id === target.id);
      deleteRecord('SchoolMember', target.id);
      if (target.user_id) {
        const remaining = records('SchoolMember', (item) => item.user_id === target.user_id && item.status !== 'inactive')[0];
        updateUser(target.user_id, {
          school_id: remaining?.school_id || '',
          school_role: remaining?.role || '',
          member_id: remaining?.id || '',
        });
        if (!remaining) disableAccount(target.user_id);
      }
      audit({ ...actor, member }, {
        action: 'staff.removed',
        entityType: 'SchoolMember',
        entityId: target.id,
        summary: `Removed ${target.full_name} and ${links} class assignments`,
      });
      return { ok: true };
    });
  }

  throw Object.assign(new Error('Unknown staff action'), { status: 400 });
}

function updateMyProfile(actor, body) {
  const member = requireMembership(actor);
  const patch = {};
  if (body.full_name !== undefined) {
    const fullName = String(body.full_name).trim().replace(/\s+/g, ' ');
    if (!fullName || fullName.length > 80) {
      throw Object.assign(new Error('Enter a full name of no more than 80 characters'), { status: 400 });
    }
    patch.full_name = fullName;
  }
  if (body.phone !== undefined) patch.phone = String(body.phone).trim().slice(0, 40);
  if (body.subject_specialisms !== undefined) patch.subject_specialisms = String(body.subject_specialisms).trim().slice(0, 160);
  if (!Object.keys(patch).length) throw Object.assign(new Error('Nothing to save'), { status: 400 });

  return withTransaction(() => {
    const updated = updateRecord('SchoolMember', member.id, patch);
    if (patch.full_name && patch.full_name !== member.full_name) {
      updateWhere('ClassTeacher', (item) => item.school_id === member.school_id && item.member_id === member.id, { member_name: patch.full_name });
      updateWhere('AttendanceSession', (item) => item.school_id === member.school_id && item.member_id === member.id, { member_name: patch.full_name });
      audit({ ...actor, member }, {
        action: 'profile.name_changed',
        entityType: 'SchoolMember',
        entityId: member.id,
        summary: `Display name changed from ${member.full_name} to ${patch.full_name}`,
      });
    }
    return { member: updated };
  });
}

function switchSchool(actor, body) {
  requireActor(actor);
  const memberships = records('SchoolMember', (member) => member.status !== 'inactive' && (
    member.user_id === actor.user.id ||
    (actor.user.email && String(member.user_email || '').toLowerCase() === String(actor.user.email).toLowerCase())
  ));
  if (body.list) {
    if (actor.user.role === 'admin') {
      return {
        schools: records('School').map((school) => {
          const member = memberships.find((candidate) => candidate.school_id === school.id);
          return { id: school.id, name: school.name, role: member?.role || 'school_admin', member_id: member?.id || '' };
        }),
      };
    }
    return {
      schools: memberships.map((member) => {
        const school = getRecord('School', member.school_id);
        return school ? { id: school.id, name: school.name, role: member.role, member_id: member.id } : null;
      }).filter(Boolean),
    };
  }
  let target = memberships.find((member) => member.school_id === body.school_id);
  if (!target && actor.user.role === 'admin') {
    const school = getRecord('School', body.school_id);
    if (school) {
      target = createRecord('SchoolMember', {
        school_id: school.id,
        user_id: actor.user.id,
        user_email: actor.user.email || '',
        full_name: actor.user.full_name || actor.user.username,
        role: 'school_admin',
        status: 'active',
        username: actor.user.username,
      });
    }
  }
  if (!target) throw Object.assign(new Error('You are not a member of that school'), { status: 403 });
  return withTransaction(() => {
    updateUser(actor.user.id, { school_id: target.school_id, school_role: target.role, member_id: target.id });
    updateRecord('SchoolMember', target.id, { user_id: actor.user.id });
    return { ok: true, school_id: target.school_id, role: target.role };
  });
}

function saveTimetableEntries(actor, body) {
  const member = requireMembership(actor);
  const schoolId = member.school_id;
  const entries = Array.isArray(body.entries) ? body.entries.slice(0, 300) : [];
  if (!entries.length) throw Object.assign(new Error('No timetable entries supplied'), { status: 400 });
  const target = body.member_id && isStaff(member)
    ? getRecord('SchoolMember', body.member_id)
    : member;
  if (!target || target.school_id !== schoolId) {
    throw Object.assign(new Error('Teacher not found'), { status: 404 });
  }
  const academicYear = find('AcademicYear', (year) => year.school_id === schoolId && year.is_current);
  const seen = new Set();
  const problems = [];
  const rows = [];
  for (const [index, entry] of entries.entries()) {
    const line = index + 1;
    if (!entry.day_name) { problems.push(`Row ${line}: missing timetable day`); continue; }
    if (!Number(entry.period_number)) { problems.push(`Row ${line}: missing period number`); continue; }
    const key = `${entry.day_name}|${entry.period_number}`;
    if (seen.has(key)) { problems.push(`Row ${line}: duplicate ${entry.day_name} period ${entry.period_number}`); continue; }
    seen.add(key);
    if (entry.start_time && entry.end_time && entry.start_time >= entry.end_time) {
      problems.push(`Row ${line}: start time must be before end time`);
      continue;
    }
    rows.push({
      school_id: schoolId,
      member_id: target.id,
      user_id: target.user_id || '',
      academic_year_id: academicYear?.id || '',
      day_name: entry.day_name,
      period_number: Number(entry.period_number),
      start_time: entry.start_time || '',
      end_time: entry.end_time || '',
      subject: entry.subject || '',
      class_name: entry.class_name || '',
      subject_class_id: entry.subject_class_id || '',
      homeroom_id: entry.homeroom_id || '',
      room: entry.room || '',
      notes: entry.notes || '',
      archived: false,
    });
  }
  if (!rows.length) {
    throw Object.assign(new Error('No valid entries'), { status: 400, details: { problems } });
  }

  return withTransaction(() => {
    let archived = 0;
    if (body.mode === 'replace') {
      const existing = records('TimetableEntry', (item) => item.school_id === schoolId && item.member_id === target.id && !item.archived);
      for (const entry of existing) {
        updateRecord('TimetableEntry', entry.id, { archived: true });
        archived += 1;
      }
    }
    const created = rows.map((row) => createRecord('TimetableEntry', row));
    audit({ ...actor, member }, {
      action: 'timetable.saved',
      entityType: 'TimetableEntry',
      summary: `Saved ${created.length} timetable entries for ${target.full_name}${archived ? ` (${archived} previous archived)` : ''}${problems.length ? ` · ${problems.length} row problem(s)` : ''}`,
    });
    return { saved: created.length, archived, problems };
  });
}

function submitAttendance(actor, body) {
  const member = requireMembership(actor);
  const schoolId = member.school_id;
  const { class_type, class_id, class_name, subject, date, day_name, period_number, session_label, records: incoming } = body;
  if (!class_id || !date || !session_label) {
    throw Object.assign(new Error('Class, date and session are required'), { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw Object.assign(new Error('Choose a valid attendance date'), { status: 400 });
  }
  if (!['homeroom', 'subject'].includes(class_type)) {
    throw Object.assign(new Error('Choose a valid class type'), { status: 400 });
  }
  if (!Array.isArray(incoming) || incoming.length > 1000) {
    throw Object.assign(new Error('Attendance records must be an array of no more than 1,000 students'), { status: 400 });
  }
  const classEntity = class_type === 'subject' ? 'SubjectClass' : 'HomeroomClass';
  const klass = getRecord(classEntity, class_id);
  if (!klass || klass.school_id !== schoolId || klass.archived) {
    throw Object.assign(new Error('Class not found'), { status: 404 });
  }
  if (!isStaff(member) && !records('ClassTeacher', (link) =>
    link.school_id === schoolId && link.class_id === class_id && link.member_id === member.id).length) {
    throw Object.assign(new Error('You are not assigned to that class'), { status: 403 });
  }
  const classMemberships = records('ClassMembership', (row) =>
    row.school_id === schoolId && row.class_type === class_type && row.class_id === class_id);
  const membershipByStudent = new Map(classMemberships.map((row) => [row.student_id, row]));
  const invalidStudent = incoming.find((record) => record.student_id && !membershipByStudent.has(record.student_id));
  if (invalidStudent) {
    throw Object.assign(new Error('Attendance can only be recorded for students enrolled in this class'), { status: 403 });
  }
  const periodNumbers = [...new Set((Array.isArray(body.period_numbers) ? body.period_numbers : [period_number])
    .map(Number).filter((number) => Number.isInteger(number) && number > 0))].sort((a, b) => a - b);
  if (periodNumbers.length > 10) {
    throw Object.assign(new Error('A register cannot be linked to more than 10 timetable periods'), { status: 400 });
  }
  const sessionKey = [schoolId, class_type, class_id, date, session_label].join('|');
  const academicYear = find('AcademicYear', (item) => item.school_id === schoolId && item.is_current);
  const counts = { total: incoming.length, present: 0, absent: 0, late: 0, excused: 0 };
  for (const record of incoming) {
    if (!['present', 'absent', 'late', 'excused'].includes(record.status || 'present')) {
      throw Object.assign(new Error('Attendance status must be present, absent, late or excused'), { status: 400 });
    }
    counts[record.status || 'present'] += 1;
  }
  const sameDateClassSessions = records('AttendanceSession', (item) =>
    item.school_id === schoolId && item.class_id === class_id && (item.class_type || 'homeroom') === class_type && item.date === date);
  const authorizedMemberId = body.member_id && isStaff(member) ? body.member_id : member.id;
  const hasTimetabledDoublePeriod = (session) => {
    if (class_type !== 'subject' || !day_name || session.member_id !== authorizedMemberId
      || String(session.subject || '').trim().toLowerCase() !== String(subject || '').trim().toLowerCase()) return false;
    const savedPeriods = Array.isArray(session.period_numbers) && session.period_numbers.length
      ? session.period_numbers.map(Number)
      : [Number(session.period_number)].filter(Boolean);
    if (savedPeriods.length !== 1 || periodNumbers.length !== 1
      || Math.abs(savedPeriods[0] - periodNumbers[0]) !== 1) return false;
    const periodsForTeacher = new Set(records('TimetableEntry', (entry) =>
      entry.school_id === schoolId && !entry.archived && entry.member_id === authorizedMemberId
      && entry.subject_class_id === class_id && entry.day_name === day_name
      && String(entry.subject || '').trim().toLowerCase() === String(subject || '').trim().toLowerCase())
      .map((entry) => Number(entry.period_number)));
    return periodsForTeacher.has(savedPeriods[0]) && periodsForTeacher.has(periodNumbers[0]);
  };
  const existing = sameDateClassSessions.find((item) => item.session_key === sessionKey)
    || sameDateClassSessions.find((item) => {
      const savedPeriods = Array.isArray(item.period_numbers) && item.period_numbers.length
        ? item.period_numbers.map(Number)
        : [Number(item.period_number)].filter(Boolean);
      return periodNumbers.some((period) => savedPeriods.includes(period));
    })
    || sameDateClassSessions.find(hasTimetabledDoublePeriod)
    || null;
  const existingPeriods = existing
    ? (Array.isArray(existing.period_numbers) && existing.period_numbers.length
      ? existing.period_numbers.map(Number)
      : [Number(existing.period_number)].filter(Boolean))
    : [];
  const linkedPeriods = [...new Set([...existingPeriods, ...periodNumbers])].sort((a, b) => a - b);
  const linkedLabel = linkedPeriods.length > 1
    ? `Periods ${linkedPeriods.join(' + ')}`
    : session_label;
  const linkedSessionKey = [schoolId, class_type, class_id, date, linkedLabel].join('|');
  if (existing && !isStaff(member) && existing.user_id !== actor.user.id) {
    throw Object.assign(new Error('This register was submitted by another teacher'), { status: 403 });
  }

  return withTransaction(() => {
    const sessionData = {
      school_id: schoolId,
      session_key: linkedSessionKey,
      class_type: class_type || 'homeroom',
      class_id,
      class_name: class_name || '',
      subject: subject || '',
      date,
      day_name: day_name || '',
      period_number: linkedPeriods[0] || Number(period_number) || 0,
      period_numbers: linkedPeriods,
      session_label: linkedLabel,
      member_id: authorizedMemberId,
      member_name: body.member_name && isStaff(member) ? body.member_name : member.full_name,
      user_id: actor.user.id,
      academic_year_id: academicYear?.id || '',
      student_count: counts.total,
      present_count: counts.present,
      absent_count: counts.absent,
      late_count: counts.late,
      excused_count: counts.excused,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      last_edited_by: actor.user.full_name || actor.user.email || actor.user.username,
    };
    const session = existing
      ? updateRecord('AttendanceSession', existing.id, sessionData)
      : createRecord('AttendanceSession', sessionData);
    const previous = records('AttendanceRecord', (record) =>
      record.school_id === schoolId && record.session_id === session.id);
    const previousByStudent = new Map(previous.map((record) => [record.student_id, record]));
    const creates = [];
    let changed = 0;
    for (const record of incoming) {
      if (!record.student_id) continue;
      const old = previousByStudent.get(record.student_id);
      const status = record.status || 'present';
      if (!old) {
        creates.push({
          school_id: schoolId,
          session_id: session.id,
          class_type: sessionData.class_type,
          class_id,
          date,
          student_id: record.student_id,
          student_name: record.student_name || '',
          student_id_no: record.student_id_no || '',
          status,
          note: record.note || '',
          marked_by: actor.user.full_name || actor.user.email || actor.user.username,
          academic_year_id: sessionData.academic_year_id,
        });
      } else {
        if (old.status !== status || (old.note || '') !== (record.note || '')) changed += 1;
        updateRecord('AttendanceRecord', old.id, { status, note: record.note || '' });
      }
    }
    for (const row of creates) createRecord('AttendanceRecord', row);
    const incomingIds = new Set(incoming.map((record) => record.student_id).filter(Boolean));
    for (const old of previous) {
      if (!incomingIds.has(old.student_id)) deleteRecord('AttendanceRecord', old.id);
    }
    audit({ ...actor, member }, {
      action: existing ? 'attendance.corrected' : 'attendance.submitted',
      entityType: 'AttendanceSession',
      entityId: session.id,
      summary: `${class_name || class_type} · ${date} · ${session_label}: ${counts.present} present, ${counts.absent} absent, ${counts.late} late`,
    });
    return { session, changed, created: creates.length };
  });
}

function bulkStudentAction(actor, body) {
  const member = requireMembership(actor);
  const schoolId = member.school_id;
  const ids = Array.isArray(body.student_ids) ? [...new Set(body.student_ids.filter(Boolean))] : [];
  if (!ids.length) throw Object.assign(new Error('No students selected'), { status: 400 });
  const selected = new Set(ids);
  const students = records('Student', (student) => student.school_id === schoolId && selected.has(student.id));
  if (!students.length) throw Object.assign(new Error('No matching students'), { status: 404 });
  const payload = body.payload || {};
  const action = body.action;
  const requireSchoolStaff = () => requireStaff(member);
  return withTransaction(() => {
    if (['assign_year_group', 'assign_homeroom', 'change_status', 'archive', 'restore'].includes(action)) {
      requireSchoolStaff();
    }
    if (action === 'assign_year_group') {
      updateWhere('Student', (item) => item.school_id === schoolId && selected.has(item.id), {
        year_group_id: payload.year_group_id || '',
        year_group_name: payload.year_group_name || '',
      });
    } else if (action === 'assign_homeroom') {
      updateWhere('Student', (item) => item.school_id === schoolId && selected.has(item.id), {
        year_group_id: payload.year_group_id || '',
        year_group_name: payload.year_group_name || '',
        homeroom_class_id: payload.homeroom_class_id || '',
        homeroom_class_name: payload.homeroom_class_name || '',
      });
      deleteWhere('ClassMembership', (item) => item.school_id === schoolId && item.class_type === 'homeroom' && selected.has(item.student_id));
      if (payload.homeroom_class_id) {
        for (const student of students) {
          createRecord('ClassMembership', {
            school_id: schoolId,
            class_type: 'homeroom',
            class_id: payload.homeroom_class_id,
            class_name: payload.homeroom_class_name || '',
            student_id: student.id,
            student_name: student.full_name,
            student_id_no: student.student_id_no,
            year_group_id: payload.year_group_id || student.year_group_id || '',
            year_group_name: payload.year_group_name || student.year_group_name || '',
            academic_year_id: student.academic_year_id || '',
          });
        }
        const total = records('ClassMembership', (item) => item.school_id === schoolId && item.class_type === 'homeroom' && item.class_id === payload.homeroom_class_id).length;
        updateRecord('HomeroomClass', payload.homeroom_class_id, { student_count: total });
      }
    } else if (action === 'change_status') {
      updateWhere('Student', (item) => item.school_id === schoolId && selected.has(item.id), { status: payload.status || 'active' });
    } else if (action === 'archive' || action === 'restore' || action === 'delete') {
      if (action === 'delete' && !isSchoolAdmin(member)) {
        throw Object.assign(new Error('Only a school administrator can archive students'), { status: 403 });
      }
      updateWhere('Student', (item) => item.school_id === schoolId && selected.has(item.id), {
        archived: action !== 'restore',
        status: action === 'restore' ? 'active' : 'inactive',
      });
    } else if (action === 'permanent_delete') {
      if (!isSchoolAdmin(member)) {
        throw Object.assign(new Error('Only a school administrator can permanently delete students'), { status: 403 });
      }
      deleteWhere('ClassMembership', (item) => item.school_id === schoolId && selected.has(item.student_id));
      deleteWhere('Student', (item) => item.school_id === schoolId && selected.has(item.id));
    } else if (action === 'add_to_class' || action === 'remove_from_class') {
      const classId = payload.class_id;
      const subjectClass = getRecord('SubjectClass', classId);
      if (!subjectClass || subjectClass.school_id !== schoolId) {
        throw Object.assign(new Error('Class not found'), { status: 404 });
      }
      if (!isStaff(member) && !records('ClassTeacher', (link) => link.school_id === schoolId && link.class_id === classId && link.member_id === member.id).length) {
        throw Object.assign(new Error('You are not a teacher of that class'), { status: 403 });
      }
      if (action === 'add_to_class') {
        const existing = new Set(records('ClassMembership', (item) => item.school_id === schoolId && item.class_id === classId && selected.has(item.student_id)).map((item) => item.student_id));
        for (const student of students.filter((item) => !existing.has(item.id))) {
          createRecord('ClassMembership', {
            school_id: schoolId,
            class_type: 'subject',
            class_id: classId,
            class_name: subjectClass.name,
            student_id: student.id,
            student_name: student.full_name,
            student_id_no: student.student_id_no,
            year_group_id: student.year_group_id || '',
            year_group_name: student.year_group_name || '',
            academic_year_id: student.academic_year_id || '',
          });
        }
      } else {
        deleteWhere('ClassMembership', (item) => item.school_id === schoolId && item.class_type === 'subject' && item.class_id === classId && selected.has(item.student_id));
      }
      const total = records('ClassMembership', (item) => item.school_id === schoolId && item.class_id === classId).length;
      updateRecord('SubjectClass', classId, { student_count: total });
    } else {
      throw Object.assign(new Error('Unknown student action'), { status: 400 });
    }
    audit({ ...actor, member }, {
      action: `students.${action}`,
      entityType: 'Student',
      entityId: ids.length === 1 ? ids[0] : '',
      summary: `${String(action).replace(/_/g, ' ')} for ${students.length} student(s)`,
    });
    return { ok: true, affected: students.length };
  });
}

function allocateStudentId(schoolId, yearGroupId, homeroomId) {
  const school = find('School', (record) => record.id === schoolId);
  const academicYear = find('AcademicYear', (record) => record.school_id === schoolId && record.is_current);
  const yearGroup = yearGroupId ? getRecord('YearGroup', yearGroupId) : null;
  const homeroom = homeroomId ? getRecord('HomeroomClass', homeroomId) : null;
  const yearLabel = String(academicYear?.name || school?.academic_year_label || '');
  const yearMatches = [...yearLabel.matchAll(/\d{4}/g)].map((match) => Number(match[0]));
  const endYear = yearMatches.at(-1) || new Date().getFullYear();
  const yearGroupLevel = Number(yearGroup?.level)
    || Number(String(yearGroup?.name || '').match(/\d+/)?.[0])
    || 0;
  const maxLevel = Math.max(1, ...records('YearGroup', (group) => group.school_id === schoolId)
    .map((group) => Number(group.level) || Number(String(group.name || '').match(/\d+/)?.[0]) || 0));
  const graduatingYear = endYear + Math.max(0, maxLevel - yearGroupLevel);
  const groupName = String(yearGroup?.name || '').trim();
  const className = String(homeroom?.name || '').trim();
  let classCode = className;
  if (groupName && classCode.toLowerCase().startsWith(groupName.toLowerCase())) {
    classCode = classCode.slice(groupName.length);
  } else {
    classCode = classCode.replace(/^(?:form\s*)?\d+\s*/i, '');
  }
  classCode = classCode.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'UNASSIGNED';
  const cohortKey = `${graduatingYear}:${classCode}`;
  const prefix = `${graduatingYear}-${classCode}-`;
  const existing = records('Student', (student) => student.school_id === schoolId)
    .map((student) => String(student.student_id_no || ''))
    .filter((studentId) => studentId.startsWith(prefix))
    .map((studentId) => Number(studentId.slice(prefix.length)))
    .filter((sequence) => Number.isSafeInteger(sequence) && sequence > 0);
  const savedSequence = database.prepare(
    'SELECT next_value FROM student_id_sequences WHERE school_id = ? AND cohort_key = ?',
  ).get(schoolId, cohortKey)?.next_value || 1;
  let sequence = Math.max(savedSequence, (existing.length ? Math.max(...existing) : 0) + 1);
  let studentId = `${prefix}${String(sequence).padStart(4, '0')}`;
  const usedIds = new Set(records('Student', (student) => student.school_id === schoolId)
    .map((student) => String(student.student_id_no || '').toLowerCase()));
  while (usedIds.has(studentId.toLowerCase())) {
    sequence += 1;
    studentId = `${prefix}${String(sequence).padStart(4, '0')}`;
  }
  database.prepare(`
    INSERT INTO student_id_sequences (school_id, cohort_key, next_value)
    VALUES (?, ?, ?)
    ON CONFLICT(school_id, cohort_key) DO UPDATE SET next_value = excluded.next_value
  `).run(schoolId, cohortKey, sequence + 1);
  return { studentId, graduatingYear };
}

function saveStudent(actor, body) {
  const member = requireMembership(actor);
  const isTeacher = member.role === 'teacher';
  if (!isTeacher) requireStaff(member);
  if (!['create', 'update'].includes(body.action)) {
    throw Object.assign(new Error('Choose whether to create or update a student'), { status: 400 });
  }
  if (isTeacher && body.action !== 'create') {
    throw Object.assign(new Error('Teachers can add students but cannot edit existing student profiles'), { status: 403 });
  }
  const schoolId = member.school_id;
  const input = body.student || {};
  const existing = body.action === 'update' ? getRecord('Student', body.student_id) : null;
  if (body.action === 'update' && (!existing || existing.school_id !== schoolId)) {
    throw Object.assign(new Error('Student not found'), { status: 404 });
  }
  const firstName = String(input.first_name || '').trim();
  const middleName = String(input.middle_name || '').trim();
  const surname = String(input.surname || '').trim();
  if (!firstName || !surname) {
    throw Object.assign(new Error('First name and surname are required'), { status: 400 });
  }
  let yearGroupId = String(input.year_group_id ?? existing?.year_group_id ?? '');
  const homeroomId = String(input.homeroom_class_id ?? existing?.homeroom_class_id ?? '');
  const homeroom = homeroomId ? getRecord('HomeroomClass', homeroomId) : null;
  if (isTeacher) {
    if (!homeroomId || !homeroom || homeroom.school_id !== schoolId || homeroom.archived) {
      throw Object.assign(new Error('Choose an active homeroom class in your school'), { status: 400 });
    }
    if (String(input.birth_paper_no || '').trim()) {
      throw Object.assign(new Error('Only school administrators and IT administrators can manage Birth Paper Numbers'), { status: 403 });
    }
    if (homeroom.year_group_id) {
      if (yearGroupId && yearGroupId !== homeroom.year_group_id) {
        throw Object.assign(new Error('The selected year group does not match the homeroom class'), { status: 400 });
      }
      yearGroupId = homeroom.year_group_id;
    }
    if (!yearGroupId) {
      throw Object.assign(new Error('Choose a year group before adding this student'), { status: 400 });
    }
  }
  const yearGroup = yearGroupId ? getRecord('YearGroup', yearGroupId) : null;
  if (yearGroupId && yearGroup?.school_id !== schoolId) {
    throw Object.assign(new Error('Year group does not belong to this school'), { status: 400 });
  }
  if (homeroomId && homeroom?.school_id !== schoolId) {
    throw Object.assign(new Error('Homeroom does not belong to this school'), { status: 400 });
  }
  const requestedId = String(input.student_id_no || '').trim();
  if (isTeacher && requestedId) {
    throw Object.assign(new Error('Student IDs are generated automatically when you add a student'), { status: 400 });
  }
  if (existing && requestedId && requestedId !== existing.student_id_no) {
    throw Object.assign(new Error('Student IDs are permanent. Use an authorised reassignment workflow to change one.'), { status: 409 });
  }
  const birthPaperNumber = String(input.birth_paper_no || '').trim();
  if (birthPaperNumber && !/^[A-Za-z0-9][A-Za-z0-9 /-]{2,31}$/.test(birthPaperNumber)) {
    throw Object.assign(new Error('Birth Paper Number must be 3–32 letters, numbers, spaces, slashes or hyphens'), { status: 400 });
  }

  return withTransaction(() => {
    const savedBirthPaperNumber = birthPaperNumber || (Object.hasOwn(input, 'birth_paper_no') ? '' : existing?.birth_paper_no || '');
    if (savedBirthPaperNumber) {
      const normalized = savedBirthPaperNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
      const duplicate = records('Student', (student) =>
        student.school_id === schoolId && student.id !== existing?.id
        && String(student.birth_paper_no || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
      if (duplicate.length) {
        throw Object.assign(new Error('That Birth Paper Number is already assigned to another student'), { status: 409 });
      }
    }

    const currentYear = find('AcademicYear', (year) => year.school_id === schoolId && year.is_current);
    const generated = existing
      ? { studentId: existing.student_id_no || '', graduatingYear: existing.graduating_year || 0 }
      : allocateStudentId(schoolId, yearGroupId, homeroomId);
    const studentId = existing?.student_id_no || requestedId || generated.studentId;
    if (!existing && records('Student', (student) =>
      student.school_id === schoolId && String(student.student_id_no || '').toLowerCase() === studentId.toLowerCase()).length) {
      throw Object.assign(new Error('That student ID already exists at this school'), { status: 409 });
    }
    const fullName = [firstName, middleName, surname].filter(Boolean).join(' ');
    const data = {
      school_id: schoolId,
      student_id_no: studentId,
      graduating_year: existing?.graduating_year || generated.graduatingYear,
      birth_paper_no: savedBirthPaperNumber,
      first_name: firstName,
      middle_name: middleName,
      surname,
      full_name: fullName,
      gender: String(input.gender || ''),
      date_of_birth: String(input.date_of_birth || ''),
      year_group_id: yearGroupId,
      year_group_name: yearGroup?.name || '',
      homeroom_class_id: homeroomId,
      homeroom_class_name: homeroom?.name || '',
      academic_year_id: existing?.academic_year_id || currentYear?.id || '',
      academic_year_name: existing?.academic_year_name || currentYear?.name || '',
      status: isTeacher ? 'active' : String(input.status || existing?.status || 'active'),
      date_enrolled: String(input.date_enrolled || ''),
      guardian_name: String(input.guardian_name || ''),
      guardian_phone: String(input.guardian_phone || ''),
      address: String(input.address || ''),
      notes: String(input.notes || ''),
      archived: existing?.archived || false,
    };
    if (!['active', 'inactive', 'transferred', 'graduated'].includes(data.status)) {
      throw Object.assign(new Error('Choose a valid student status'), { status: 400 });
    }

    const student = existing
      ? updateRecord('Student', existing.id, data)
      : createRecord('Student', data);
    const oldHomeroomId = existing?.homeroom_class_id || '';
    if (existing && oldHomeroomId !== homeroomId) {
      deleteWhere('ClassMembership', (record) =>
        record.school_id === schoolId && record.class_type === 'homeroom' && record.student_id === student.id);
    }
    if (homeroomId) {
      const membership = find('ClassMembership', (record) =>
        record.school_id === schoolId && record.class_type === 'homeroom'
        && record.class_id === homeroomId && record.student_id === student.id);
      const membershipData = {
        school_id: schoolId,
        class_type: 'homeroom',
        class_id: homeroomId,
        class_name: homeroom.name,
        student_id: student.id,
        student_name: fullName,
        student_id_no: studentId,
        year_group_id: yearGroupId,
        year_group_name: yearGroup?.name || '',
        academic_year_id: data.academic_year_id,
      };
      if (membership) updateRecord('ClassMembership', membership.id, membershipData);
      else createRecord('ClassMembership', membershipData);
    }
    for (const classId of new Set([oldHomeroomId, homeroomId].filter(Boolean))) {
      const count = records('ClassMembership', (record) =>
        record.school_id === schoolId && record.class_type === 'homeroom' && record.class_id === classId).length;
      const classRecord = getRecord('HomeroomClass', classId);
      if (classRecord) updateRecord('HomeroomClass', classId, { student_count: count });
    }
    audit({ ...actor, member }, {
      action: existing ? 'student.updated' : 'student.created',
      entityType: 'Student',
      entityId: student.id,
      summary: `${existing ? 'Updated' : 'Added'} ${fullName} (${studentId})`,
    });
    return { student };
  });
}

function assignStudents(actor, body) {
  const member = requireMembership(actor);
  const schoolId = member.school_id;
  const classType = body.class_type;
  const classId = String(body.class_id || '');
  const studentIds = [...new Set((Array.isArray(body.student_ids) ? body.student_ids : []).filter(Boolean))];
  if (!['homeroom', 'subject'].includes(classType) || !classId || !studentIds.length || studentIds.length > 2000) {
    throw Object.assign(new Error('Choose a class and between 1 and 2,000 students'), { status: 400 });
  }
  const classEntity = classType === 'homeroom' ? 'HomeroomClass' : 'SubjectClass';
  const klass = getRecord(classEntity, classId);
  if (!klass || klass.school_id !== schoolId || klass.archived) {
    throw Object.assign(new Error('Class not found'), { status: 404 });
  }
  const authorized = isStaff(member) || records('ClassTeacher', (link) =>
    link.school_id === schoolId && link.class_id === classId && link.member_id === member.id).length > 0;
  if (!authorized) throw Object.assign(new Error('You are not authorised to manage this class'), { status: 403 });
  const students = studentIds.map((id) => getRecord('Student', id));
  if (students.some((student) => !student || student.school_id !== schoolId || student.archived)) {
    throw Object.assign(new Error('One or more selected students are unavailable'), { status: 400 });
  }

  return withTransaction(() => {
    const existingIds = new Set(records('ClassMembership', (record) =>
      record.school_id === schoolId && record.class_type === classType && record.class_id === classId)
      .map((record) => record.student_id));
    const toAdd = students.filter((student) => !existingIds.has(student.id));
    for (const student of toAdd) {
      createRecord('ClassMembership', {
        school_id: schoolId,
        class_type: classType,
        class_id: classId,
        class_name: klass.name,
        student_id: student.id,
        student_name: student.full_name || [student.first_name, student.surname].filter(Boolean).join(' '),
        student_id_no: student.student_id_no || '',
        year_group_id: student.year_group_id || '',
        year_group_name: student.year_group_name || '',
        academic_year_id: student.academic_year_id || '',
      });
    }
    const total = records('ClassMembership', (record) =>
      record.school_id === schoolId && record.class_type === classType && record.class_id === classId).length;
    updateRecord(classEntity, klass.id, { student_count: total });
    audit({ ...actor, member }, {
      action: 'class.students_assigned',
      entityType: classEntity,
      entityId: klass.id,
      summary: `Added ${toAdd.length} student(s) to ${klass.name}`,
    });
    return { added: toAdd.length, skipped: studentIds.length - toAdd.length, student_count: total };
  });
}

function importStudents(actor, body) {
  const member = requireMembership(actor);
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 2000) {
    throw Object.assign(new Error('Choose a CSV with between 1 and 2,000 student rows'), { status: 400 });
  }
  if (!isStaff(member) && body.rows.some((row) => String(row.birth_paper_no || '').trim())) {
    throw Object.assign(new Error('Only school administrators and IT administrators can import Birth Paper Numbers'), { status: 403 });
  }
  const defaults = body.defaults || {};
  const schoolId = member.school_id;
  const targetClassType = defaults.class_type || '';
  const targetClassId = String(defaults.class_id || '');
  let targetClass = null;
  if (targetClassType || targetClassId) {
    if (!['homeroom', 'subject'].includes(targetClassType) || !targetClassId) {
      throw Object.assign(new Error('Choose a valid class for this import'), { status: 400 });
    }
    const targetEntity = targetClassType === 'homeroom' ? 'HomeroomClass' : 'SubjectClass';
    targetClass = getRecord(targetEntity, targetClassId);
    if (!targetClass || targetClass.school_id !== schoolId || targetClass.archived) {
      throw Object.assign(new Error('Import class not found'), { status: 404 });
    }
    if (!isStaff(member) && !records('ClassTeacher', (link) =>
      link.school_id === schoolId && link.class_id === targetClassId && link.member_id === member.id).length) {
      throw Object.assign(new Error('You are not authorised to import students into this class'), { status: 403 });
    }
  } else {
    requireStaff(member);
  }
  const targetHomeroomId = targetClassType === 'homeroom'
    ? targetClassId
    : String(defaults.homeroom_class_id || '');
  const targetYearGroupId = String(defaults.year_group_id || targetClass?.year_group_id || '');
  const yearGroup = targetYearGroupId ? getRecord('YearGroup', targetYearGroupId) : null;
  const homeroom = targetHomeroomId ? getRecord('HomeroomClass', targetHomeroomId) : null;
  if (targetYearGroupId && yearGroup?.school_id !== schoolId) {
    throw Object.assign(new Error('Year group does not belong to this school'), { status: 400 });
  }
  if (targetHomeroomId && homeroom?.school_id !== schoolId) {
    throw Object.assign(new Error('Homeroom does not belong to this school'), { status: 400 });
  }
  if (homeroom?.year_group_id && targetYearGroupId && homeroom.year_group_id !== targetYearGroupId) {
    throw Object.assign(new Error('The selected year group does not match the homeroom'), { status: 400 });
  }
  const imported = [];
  const skipped = [];
  const existingStudents = records('Student', (student) => student.school_id === schoolId);
  const existingIds = new Set(existingStudents.map((student) => String(student.student_id_no || '').toLowerCase()).filter(Boolean));
  const existingBirthNumbers = new Set(existingStudents.map((student) =>
    String(student.birth_paper_no || '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean));
  const seenNames = new Set(existingStudents.filter((student) => student.date_of_birth).map((student) =>
    `${String(student.full_name || '').toLowerCase()}|${student.date_of_birth}`));
  
  for (const [index, row] of body.rows.entries()) {
    const studentId = String(row.student_id_no || '').trim();
    const firstName = String(row.first_name || '').trim();
    const surname = String(row.surname || '').trim();
    const fullName = [firstName, row.middle_name, surname].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
    const birthNumber = String(row.birth_paper_no || '').trim();
    if (!firstName || !surname) {
      skipped.push({ row: index + 2, reason: 'First name and surname are required' });
      continue;
    }
    if (studentId && existingIds.has(studentId.toLowerCase())) {
      skipped.push({ row: index + 2, student_id_no: studentId, reason: `Student ID "${studentId}" already exists in database` });
      continue;
    }
    const nameKey = row.date_of_birth ? `${fullName.toLowerCase()}|${String(row.date_of_birth).trim()}` : '';
    if (nameKey && seenNames.has(nameKey)) {
      skipped.push({ row: index + 2, student_id_no: studentId, reason: `Student "${fullName}" (DOB: ${row.date_of_birth}) already exists` });
      continue;
    }
    if (birthNumber) {
      if (!/^[A-Za-z0-9][A-Za-z0-9 /-]{2,31}$/.test(birthNumber)) {
        skipped.push({ row: index + 2, student_id_no: studentId, reason: 'Birth Paper Number has an invalid format' });
        continue;
      }
      const normalizedBirthNumber = birthNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (existingBirthNumbers.has(normalizedBirthNumber)) {
        skipped.push({ row: index + 2, student_id_no: studentId, reason: 'Birth Paper Number already exists' });
        continue;
      }
      existingBirthNumbers.add(normalizedBirthNumber);
    }
    if (studentId) existingIds.add(studentId.toLowerCase());
    if (nameKey) seenNames.add(nameKey);

    let graduatingYear = 0;
    if (studentId) {
      const matchYear = studentId.match(/^(\d{4})/);
      if (matchYear) graduatingYear = parseInt(matchYear[1], 10);
    }

    imported.push({
      _source_row: index + 2,
      school_id: schoolId,
      student_id_no: studentId,
      graduating_year: graduatingYear,
      birth_paper_no: birthNumber,
      first_name: firstName,
      middle_name: String(row.middle_name || '').trim(),
      surname,
      full_name: fullName,
      gender: row.gender || '',
      date_of_birth: row.date_of_birth || '',
      year_group_id: targetYearGroupId,
      year_group_name: yearGroup?.name || '',
      homeroom_class_id: targetHomeroomId,
      homeroom_class_name: homeroom?.name || '',
      academic_year_id: find('AcademicYear', (year) => year.school_id === schoolId && year.is_current)?.id || '',
      status: 'active',
      guardian_name: row.guardian_name || '',
      guardian_phone: row.guardian_phone || '',
      address: row.address || '',
      archived: false,
    });
  }

  return withTransaction(() => {
    const txnExistingIds = new Set(records('Student', (s) => s.school_id === schoolId)
      .map((s) => String(s.student_id_no || '').toLowerCase()));
      
    const created = imported.map((student) => {
      const { _source_row: sourceRow, ...record } = student;
      if (!student.student_id_no) {
        const generated = allocateStudentId(schoolId, record.year_group_id, record.homeroom_class_id);
        record.student_id_no = generated.studentId;
        record.graduating_year = generated.graduatingYear;
      } else if (!record.graduating_year) {
        record.graduating_year = new Date().getFullYear() + 5;
      }
      if (txnExistingIds.has(record.student_id_no.toLowerCase())) {
        skipped.push({ row: sourceRow, student_id_no: record.student_id_no, reason: `Student ID "${record.student_id_no}" already exists` });
        return null;
      }
      txnExistingIds.add(record.student_id_no.toLowerCase());
      return createRecord('Student', record);
    }).filter(Boolean);

    if (targetHomeroomId) {
      for (const student of created) {
        createRecord('ClassMembership', {
          school_id: schoolId,
          class_type: 'homeroom',
          class_id: targetHomeroomId,
          class_name: student.homeroom_class_name,
          student_id: student.id,
          student_name: student.full_name,
          student_id_no: student.student_id_no,
          year_group_id: student.year_group_id,
          year_group_name: student.year_group_name,
          academic_year_id: student.academic_year_id,
        });
      }
      const total = records('ClassMembership', (item) => item.school_id === schoolId && item.class_type === 'homeroom' && item.class_id === targetHomeroomId).length;
      updateRecord('HomeroomClass', targetHomeroomId, { student_count: total });
    }
    
    if (targetClassType === 'subject') {
      const existingSubjectMemberships = new Set(records('ClassMembership', (item) => 
        item.school_id === schoolId && item.class_type === 'subject' && item.class_id === targetClassId
      ).map(m => m.student_id));
      
      for (const student of created) {
        if (!existingSubjectMemberships.has(student.id)) {
          createRecord('ClassMembership', {
            school_id: schoolId,
            class_type: 'subject',
            class_id: targetClassId,
            class_name: targetClass.name,
            student_id: student.id,
            student_name: student.full_name,
            student_id_no: student.student_id_no,
            year_group_id: student.year_group_id,
            year_group_name: student.year_group_name,
            academic_year_id: student.academic_year_id,
          });
          existingSubjectMemberships.add(student.id);
        }
      }
      updateRecord('SubjectClass', targetClassId, { student_count: existingSubjectMemberships.size });
    }
    
    const job = createRecord('ImportJob', {
      school_id: schoolId,
      type: 'students',
      file_name: body.file_name || 'students.csv',
      total_rows: body.rows.length,
      imported_count: created.length,
      failed_count: skipped.length,
      status: 'completed',
      errors: skipped.map((item) => typeof item === 'string' ? item : `Row ${item.row}: ${item.reason}`),
      created_by_name: actor.user.full_name || actor.user.username,
      summary: `Imported ${created.length}; skipped ${skipped.length}`,
    });
    
    audit({ ...actor, member }, {
      action: 'students.imported',
      entityType: 'ImportJob',
      entityId: job.id,
      summary: `Imported ${created.length} students; skipped ${skipped.length}`,
    });
    
    return { imported: created.length, skipped: skipped.length, errors: skipped, student_ids: created.map((student) => student.id), job };
  });
}
function promoteStudents(actor, body) {
  const member = requireMembership(actor);
  const schoolId = member.school_id;
  const classType = body.class_type || 'homeroom';
  const sourceClassId = String(body.source_class_id || '');
  const outcome = body.outcome || 'promoted';
  const ids = new Set(Array.isArray(body.student_ids) ? body.student_ids.filter(Boolean) : []);
  if (!ids.size) throw Object.assign(new Error('Select at least one student'), { status: 400 });
  const selected = records('Student', (student) => student.school_id === schoolId && ids.has(student.id));
  if (selected.length !== ids.size) {
    throw Object.assign(new Error('One or more selected students are unavailable'), { status: 400 });
  }
  if (!['homeroom', 'subject'].includes(classType) || !['promoted', 'repeating', 'transferred', 'graduated'].includes(outcome)) {
    throw Object.assign(new Error('Choose a valid class type and promotion outcome'), { status: 400 });
  }
  const target = body.to || {};
  const currentYear = find('AcademicYear', (year) => year.school_id === schoolId && year.is_current);
  const targetAcademicYearId = target.academic_year_id || currentYear?.id || '';
  const targetAcademicYear = targetAcademicYearId ? getRecord('AcademicYear', targetAcademicYearId) : null;
  if (targetAcademicYearId && targetAcademicYear?.school_id !== schoolId) {
    throw Object.assign(new Error('Destination academic year does not belong to this school'), { status: 400 });
  }

  if (classType === 'subject') {
    if (outcome === 'graduated') {
      throw Object.assign(new Error('Graduate students through their homeroom promotion workflow'), { status: 400 });
    }
    if (!sourceClassId) throw Object.assign(new Error('Choose the subject class being promoted'), { status: 400 });
    const sourceClass = getRecord('SubjectClass', sourceClassId);
    if (!sourceClass || sourceClass.school_id !== schoolId || sourceClass.archived) {
      throw Object.assign(new Error('Source subject class not found'), { status: 404 });
    }
    if (!isStaff(member) && !records('ClassTeacher', (link) =>
      link.school_id === schoolId && link.member_id === member.id
      && link.class_id === sourceClassId && link.class_type === 'subject').length) {
      throw Object.assign(new Error('You are not authorised to promote this subject class'), { status: 403 });
    }
    const sourceMembers = new Set(records('ClassMembership', (row) =>
      row.school_id === schoolId && row.class_type === 'subject' && row.class_id === sourceClassId)
      .map((row) => row.student_id));
    if (selected.some((student) => !sourceMembers.has(student.id))) {
      throw Object.assign(new Error('Selected students must be enrolled in the source subject class'), { status: 400 });
    }
    const destinationClassId = String(target.subject_class_id || '');
    const destinationClass = destinationClassId ? getRecord('SubjectClass', destinationClassId) : null;
    if (destinationClassId && (!destinationClass || destinationClass.school_id !== schoolId || destinationClass.archived)) {
      throw Object.assign(new Error('Destination subject class not found'), { status: 400 });
    }
    if (['promoted', 'transferred'].includes(outcome) && !destinationClass) {
      throw Object.assign(new Error('Choose a destination subject class'), { status: 400 });
    }
    if (destinationClass && String(destinationClass.subject || '').trim().toLowerCase()
      !== String(sourceClass.subject || '').trim().toLowerCase()) {
      throw Object.assign(new Error('Destination class must teach the same subject'), { status: 400 });
    }
    if (destinationClass?.academic_year_id && targetAcademicYearId
      && destinationClass.academic_year_id !== targetAcademicYearId) {
      throw Object.assign(new Error('Destination subject class does not belong to the selected academic year'), { status: 400 });
    }
    return withTransaction(() => {
      const currentEnrollments = records('StudentEnrollment', (row) =>
        row.school_id === schoolId && ids.has(row.student_id)
        && (row.destination_academic_year_id || row.academic_year_id || '') === (targetAcademicYearId || '')
        && (row.class_type || 'homeroom') === 'subject'
        && (row.source_class_id || '') === sourceClassId);
      if (currentEnrollments.length) {
        throw Object.assign(new Error('One or more students have already been promoted from this class for that academic year'), { status: 409 });
      }

      for (const student of selected) {
        createRecord('StudentEnrollment', {
          school_id: schoolId,
          student_id: student.id,
          student_name: student.full_name,
          student_id_no: student.student_id_no,
          academic_year_id: student.academic_year_id || currentYear?.id || '',
          academic_year_name: student.academic_year_name || currentYear?.name || '',
          year_group_id: student.year_group_id || sourceClass.year_group_id || '',
          year_group_name: student.year_group_name || sourceClass.year_group_name || '',
          homeroom_class_id: student.homeroom_class_id || '',
          homeroom_class_name: student.homeroom_class_name || '',
          class_type: 'subject',
          source_class_id: sourceClassId,
          source_class_name: sourceClass.name,
          destination_class_id: destinationClass?.id || '',
          destination_class_name: destinationClass?.name || '',
          destination_academic_year_id: targetAcademicYearId,
          status: 'completed',
          outcome,
        });

        if (outcome !== 'repeating') {
          deleteWhere('ClassMembership', (row) =>
            row.school_id === schoolId && row.class_type === 'subject'
            && row.class_id === sourceClassId && row.student_id === student.id);
          if (destinationClass && !find('ClassMembership', (row) =>
            row.school_id === schoolId && row.class_type === 'subject'
            && row.class_id === destinationClass.id && row.student_id === student.id)) {
            createRecord('ClassMembership', {
              school_id: schoolId,
              class_type: 'subject',
              class_id: destinationClass.id,
              class_name: destinationClass.name,
              student_id: student.id,
              student_name: student.full_name,
              student_id_no: student.student_id_no,
              year_group_id: destinationClass.year_group_id || student.year_group_id || '',
              year_group_name: destinationClass.year_group_name || student.year_group_name || '',
              academic_year_id: targetAcademicYearId,
            });
          }
        }

        const studentPatch = {};
        if (targetAcademicYearId) {
          studentPatch.academic_year_id = targetAcademicYearId;
          studentPatch.academic_year_name = targetAcademicYear.name || '';
        }
        updateRecord('Student', student.id, studentPatch);
      }
      const sourceCount = records('ClassMembership', (row) =>
        row.school_id === schoolId && row.class_type === 'subject' && row.class_id === sourceClassId).length;
      updateRecord('SubjectClass', sourceClassId, { student_count: sourceCount });
      if (destinationClass) {
        const destinationCount = records('ClassMembership', (row) =>
          row.school_id === schoolId && row.class_type === 'subject' && row.class_id === destinationClass.id).length;
        updateRecord('SubjectClass', destinationClass.id, { student_count: destinationCount });
      }
      audit({ ...actor, member }, {
        action: 'students.promoted',
        entityType: 'StudentEnrollment',
        entityId: sourceClassId,
        summary: `${outcome} ${selected.length} student(s) from ${sourceClass.name}${destinationClass ? ` to ${destinationClass.name}` : ''}`,
      });
      return {
        selected: selected.length,
        promoted: outcome === 'promoted' ? selected.length : 0,
        retained: outcome === 'repeating' ? selected.length : 0,
        transferred: outcome === 'transferred' ? selected.length : 0,
        graduated: outcome === 'graduated' ? selected.length : 0,
        errors: [],
      };
    });
  }

  const sourceClass = sourceClassId ? getRecord('HomeroomClass', sourceClassId) : null;
  if (sourceClassId && (!sourceClass || sourceClass.school_id !== schoolId || sourceClass.archived)) {
    throw Object.assign(new Error('Source homeroom class not found'), { status: 404 });
  }
  if (!isStaff(member)) {
    const allowedClasses = new Set(records('ClassTeacher', (link) =>
      link.school_id === schoolId && link.member_id === member.id && link.class_type === 'homeroom').map((link) => link.class_id));
    if (sourceClassId ? !allowedClasses.has(sourceClassId)
      : selected.some((student) => !allowedClasses.has(student.homeroom_class_id))) {
      throw Object.assign(new Error('You can only promote students from your assigned homeroom classes'), { status: 403 });
    }
  }
  if (sourceClassId) {
    const sourceMembers = new Set(records('ClassMembership', (row) =>
      row.school_id === schoolId && row.class_type === 'homeroom' && row.class_id === sourceClassId)
      .map((row) => row.student_id));
    if (selected.some((student) => !sourceMembers.has(student.id))) {
      throw Object.assign(new Error('Selected students must be enrolled in the source homeroom'), { status: 400 });
    }
  }
  const targetYearGroup = target.year_group_id ? getRecord('YearGroup', target.year_group_id) : null;
  const targetHomeroom = target.homeroom_class_id ? getRecord('HomeroomClass', target.homeroom_class_id) : null;
  if (['promoted', 'transferred'].includes(outcome) && !targetHomeroom) {
    throw Object.assign(new Error('Choose a destination homeroom class'), { status: 400 });
  }
  if (target.year_group_id && targetYearGroup?.school_id !== schoolId) {
    throw Object.assign(new Error('Destination year group does not belong to this school'), { status: 400 });
  }
  if (target.homeroom_class_id && targetHomeroom?.school_id !== schoolId) {
    throw Object.assign(new Error('Destination homeroom does not belong to this school'), { status: 400 });
  }
  if (targetHomeroom?.academic_year_id && targetAcademicYearId
    && targetHomeroom.academic_year_id !== targetAcademicYearId) {
    throw Object.assign(new Error('Destination homeroom does not belong to the selected academic year'), { status: 400 });
  }
  if (targetHomeroom?.year_group_id && target.year_group_id
    && targetHomeroom.year_group_id !== target.year_group_id) {
    throw Object.assign(new Error('Destination year group does not match the homeroom'), { status: 400 });
  }
  const resolvedYearGroupId = target.year_group_id || targetHomeroom?.year_group_id || '';
  const resolvedYearGroup = resolvedYearGroupId ? getRecord('YearGroup', resolvedYearGroupId) : null;

  return withTransaction(() => {
    const historyRows = records('StudentEnrollment', (row) => row.school_id === schoolId && ids.has(row.student_id));
    const existingPromotions = selected.filter((student) => historyRows.some((row) =>
      row.student_id === student.id
      && (row.destination_academic_year_id || '') === (targetAcademicYearId || '')
      && (row.class_type || 'homeroom') === 'homeroom'));
    if (existingPromotions.length) {
      throw Object.assign(new Error('One or more students have already been promoted from this class for that academic year'), { status: 409 });
    }

    for (const student of selected) {
      const academicYearId = student.academic_year_id || currentYear?.id || '';
      createRecord('StudentEnrollment', {
        school_id: schoolId,
        student_id: student.id,
        student_name: student.full_name,
        student_id_no: student.student_id_no,
        academic_year_id: academicYearId,
        academic_year_name: student.academic_year_name || currentYear?.name || '',
        year_group_id: student.year_group_id || '',
        year_group_name: student.year_group_name || '',
        homeroom_class_id: student.homeroom_class_id || '',
        homeroom_class_name: student.homeroom_class_name || '',
        class_type: 'homeroom',
        source_class_id: sourceClassId || student.homeroom_class_id || '',
        source_class_name: sourceClass?.name || student.homeroom_class_name || '',
        destination_class_id: target.homeroom_class_id || '',
        destination_class_name: targetHomeroom?.name || '',
        destination_academic_year_id: targetAcademicYearId,
        status: 'completed',
        outcome,
      });
      const patch = {};
      if (targetAcademicYearId) {
        patch.academic_year_id = targetAcademicYearId;
        patch.academic_year_name = targetAcademicYear?.name || '';
      }
      if (outcome === 'repeating') patch.status = 'active';
      else if (outcome === 'graduated' || outcome === 'transferred') patch.status = outcome;
      if (outcome !== 'repeating') {
        if (resolvedYearGroupId) {
          patch.year_group_id = resolvedYearGroupId;
          patch.year_group_name = target.year_group_name || resolvedYearGroup?.name || '';
        }
        if (target.homeroom_class_id) {
          patch.homeroom_class_id = target.homeroom_class_id || '';
          patch.homeroom_class_name = targetHomeroom?.name || '';
        } else if (outcome !== 'graduated' && student.homeroom_class_id) {
          patch.homeroom_class_id = student.homeroom_class_id;
          patch.homeroom_class_name = student.homeroom_class_name || '';
        }
        if (outcome === 'graduated') {
          patch.homeroom_class_id = '';
          patch.homeroom_class_name = '';
        }
      }
      updateRecord('Student', student.id, patch);
      const previousClassId = student.homeroom_class_id || '';
      if (outcome !== 'repeating') {
        deleteWhere('ClassMembership', (record) =>
          record.school_id === schoolId && record.class_type === 'homeroom' && record.student_id === student.id);
      }
      if (outcome !== 'repeating' && patch.homeroom_class_id && !find('ClassMembership', (record) =>
        record.school_id === schoolId && record.class_type === 'homeroom'
        && record.class_id === patch.homeroom_class_id && record.student_id === student.id)) {
        createRecord('ClassMembership', {
          school_id: schoolId,
          class_type: 'homeroom',
          class_id: patch.homeroom_class_id,
          class_name: patch.homeroom_class_name || '',
          student_id: student.id,
          student_name: student.full_name,
          student_id_no: student.student_id_no,
          year_group_id: patch.year_group_id || student.year_group_id || '',
          year_group_name: patch.year_group_name || student.year_group_name || '',
          academic_year_id: targetAcademicYearId,
        });
      }
      if (outcome === 'repeating') {
        updateWhere('ClassMembership', (record) =>
          record.school_id === schoolId && record.class_type === 'homeroom' && record.student_id === student.id,
        { academic_year_id: targetAcademicYearId });
      }
      if (previousClassId) {
        const count = records('ClassMembership', (record) =>
          record.school_id === schoolId && record.class_type === 'homeroom' && record.class_id === previousClassId).length;
        const previousClass = getRecord('HomeroomClass', previousClassId);
        if (previousClass) updateRecord('HomeroomClass', previousClassId, { student_count: count });
      }
      if (patch.homeroom_class_id && patch.homeroom_class_id !== previousClassId) {
        const count = records('ClassMembership', (record) =>
          record.school_id === schoolId && record.class_type === 'homeroom' && record.class_id === patch.homeroom_class_id).length;
        updateRecord('HomeroomClass', patch.homeroom_class_id, { student_count: count });
      }
    }
    if (body.approve) {
      updateWhere('StudentEnrollment', (record) => record.school_id === schoolId && ids.has(record.student_id) && record.status === 'pending', { status: 'approved' });
    }
    audit({ ...actor, member }, {
      action: 'students.promoted',
      entityType: 'Student',
      summary: `${outcome} ${selected.length} student(s) to ${target.year_group_name || targetHomeroom?.name || 'the next year group'}`,
    });
    return {
      selected: selected.length,
      promoted: outcome === 'promoted' ? selected.length : 0,
      retained: outcome === 'repeating' ? selected.length : 0,
      transferred: outcome === 'transferred' ? selected.length : 0,
      graduated: outcome === 'graduated' ? selected.length : 0,
      errors: [],
    };
  });
}

export function invokeFunction(name, actor, body = {}) {
  const handlers = {
    sessionContext,
    provisionSchool,
    manageStaff,
    updateMyProfile,
    switchSchool,
    saveTimetableEntries,
    submitAttendance,
    bulkStudentAction,
    importStudents,
    promoteStudents,
    saveStudent,
    assignStudents,
  };
  const handler = handlers[name];
  if (!handler) throw Object.assign(new Error(`Unknown local function: ${name}`), { status: 404 });
  return handler(actor, body);
}