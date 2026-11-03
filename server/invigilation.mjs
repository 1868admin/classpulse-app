import { createRecord, getRecord, getRecords, updateRecord, withTransaction } from './database.mjs';

const ACTIVE_STATUSES = new Set(['draft', 'published']);
const isStaff = (member) => member && ['school_admin', 'it_admin'].includes(member.role);
const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase();

function fail(message, status = 400, details) {
  throw Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

function requireManager(actor) {
  if (!actor) fail('Authentication required', 401);
  const member = actor.member;
  if (!member || member.status !== 'active') fail('You are not attached to an active school account', 403);
  if (!isStaff(member)) fail('Only school administrators and IT administrators can manage invigilation.', 403);
  return member;
}

function audit(actor, member, action, record, summary) {
  return createRecord('AuditLog', {
    school_id: member.school_id,
    actor_name: actor.user.full_name || actor.user.username,
    actor_email: actor.user.email || '',
    action,
    entity_type: record.entity_type || 'InvigilationAssignment',
    entity_id: record.entity_id || '',
    summary,
  });
}

function dateDayName(schoolId, date) {
  const calendarDate = getRecords('CalendarDate')
    .find((item) => item.school_id === schoolId && item.date === date);
  if (calendarDate) {
    return calendarDate.day_type === 'no_school' ? null : String(calendarDate.day_name || '');
  }
  const school = getRecord('School', schoolId);
  const names = Array.isArray(school?.day_names) ? school.day_names : [];
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return names[day === 0 ? 6 : day - 1] || '';
}

function timeMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function periodTime(school, day, periodNumber) {
  const calendarDate = getRecords('CalendarDate')
    .find((item) => item.school_id === school.id && item.date === day);
  const specialPeriod = calendarDate?.day_type === 'special'
    ? calendarDate.special_periods?.find((period) => Number(period.number) === Number(periodNumber))
    : null;
  const period = specialPeriod || school.periods?.find((item) => Number(item.number) === Number(periodNumber));
  return {
    start: timeMinutes(period?.start),
    end: timeMinutes(period?.end),
  };
}

function rangesOverlap(start, end, otherStart, otherEnd) {
  return start !== null && end !== null && otherStart !== null && otherEnd !== null
    ? start < otherEnd && otherStart < end
    : null;
}

function lessonConflicts(teacher, exam, academicYearId) {
  const dayName = dateDayName(exam.school_id, exam.exam_date);
  if (dayName === null) return [];
  const school = getRecord('School', exam.school_id) || { id: exam.school_id, periods: [] };
  const examStart = timeMinutes(exam.start_time);
  const examEnd = timeMinutes(exam.end_time);
  const currentYearId = getRecords('AcademicYear')
    .find((year) => year.school_id === exam.school_id && year.is_current)?.id || '';
  return getRecords('TimetableEntry').filter((entry) => {
    const entryYearId = entry.academic_year_id || currentYearId;
    if (entry.school_id !== exam.school_id || entry.member_id !== teacher.id
      || entry.archived || entry.published === false || entryYearId !== academicYearId
      || (dayName && normalize(entry.day_name) !== normalize(dayName))) return false;
    if (!dayName) return true;
    let lessonStart = timeMinutes(entry.start_time);
    let lessonEnd = timeMinutes(entry.end_time);
    if (lessonStart === null || lessonEnd === null) {
      const period = periodTime(school, exam.exam_date, entry.period_number);
      lessonStart = period.start;
      lessonEnd = period.end;
    }
    const overlap = rangesOverlap(examStart, examEnd, lessonStart, lessonEnd);
    return overlap === true || overlap === null;
  });
}

function availabilityConflicts(teacher, exam, academicYearId) {
  const dayName = dateDayName(exam.school_id, exam.exam_date);
  if (dayName === null) return [];
  const school = getRecord('School', exam.school_id) || { id: exam.school_id, periods: [] };
  const examStart = timeMinutes(exam.start_time);
  const examEnd = timeMinutes(exam.end_time);
  return getRecords('TeacherAvailability').filter((slot) => {
    if (slot.school_id !== exam.school_id || slot.member_id !== teacher.id
      || slot.academic_year_id !== academicYearId || slot.is_available !== false
      || (dayName && normalize(slot.day_name) !== normalize(dayName))) return false;
    if (!dayName) return true;
    if (slot.start_time && slot.end_time) {
      return rangesOverlap(examStart, examEnd, timeMinutes(slot.start_time), timeMinutes(slot.end_time)) === true;
    }
    const period = periodTime(school, exam.exam_date, slot.period_number);
    const overlap = rangesOverlap(examStart, examEnd, period.start, period.end);
    return overlap === true || overlap === null;
  });
}

function assignmentIsActive(assignment) {
  if (!ACTIVE_STATUSES.has(assignment.status)) return false;
  const exam = getRecord('ExaminationTimetableEntry', assignment.examination_id);
  return exam?.status === 'published';
}

function invigilationConflicts(teacher, exam, assignments, ignoreIds = []) {
  const ignored = new Set(ignoreIds);
  const start = timeMinutes(exam.start_time);
  const end = timeMinutes(exam.end_time);
  return assignments.filter((assignment) => {
    if (ignored.has(assignment.id) || assignment.school_id !== exam.school_id
      || assignment.teacher_member_id !== teacher.id || !assignmentIsActive(assignment)
      || assignment.examination_id === exam.id || assignment.exam_date !== exam.exam_date) return false;
    return rangesOverlap(start, end, timeMinutes(assignment.start_time), timeMinutes(assignment.end_time)) === true;
  });
}

function teachesExamSubject(teacherId, exam, academicYearId) {
  if (!exam.subject) return false;
  const links = getRecords('ClassTeacher').filter((link) => (
    link.school_id === exam.school_id && link.member_id === teacherId
    && link.class_type === 'subject'
    && link.is_active !== false
    && (!link.academic_year_id || link.academic_year_id === academicYearId)
  ));
  const classIds = new Set(links.map((link) => link.class_id));
  return getRecords('SubjectClass').some((subjectClass) => (
    subjectClass.school_id === exam.school_id && !subjectClass.archived
    && (!subjectClass.academic_year_id || subjectClass.academic_year_id === academicYearId)
    && classIds.has(subjectClass.id) && normalize(subjectClass.subject) === normalize(exam.subject)
  ));
}

function activeAssignments(schoolId) {
  return getRecords('InvigilationAssignment').filter((assignment) => (
    assignment.school_id === schoolId && assignmentIsActive(assignment)
  ));
}

function getExam(schoolId, examId) {
  const exam = getRecord('ExaminationTimetableEntry', examId);
  if (!exam || exam.school_id !== schoolId || exam.status !== 'published') {
    fail('Published examination not found.', 404);
  }
  return exam;
}

function getTeacher(schoolId, teacherId) {
  const teacher = getRecord('SchoolMember', teacherId);
  if (!teacher || teacher.school_id !== schoolId || teacher.role !== 'teacher' || teacher.status !== 'active'
    || (teacher.employment_status || 'active') !== 'active') {
    fail('Choose an active teacher belonging to this school.', 400);
  }
  return teacher;
}

function getAcademicYear(schoolId, yearId) {
  const academicYear = getRecord('AcademicYear', String(yearId || ''));
  if (!academicYear || academicYear.school_id !== schoolId) {
    fail('Choose an academic year belonging to this school.', 400);
  }
  return academicYear;
}

function validateRole(role) {
  if (!['chief', 'assistant'].includes(role)) fail('Choose chief or assistant supervisor.', 400);
  return role;
}

function getRequirement(schoolId, examId) {
  return getRecords('InvigilationRequirement')
    .find((item) => item.school_id === schoolId && item.examination_id === examId) || null;
}

function assignmentRecord(member, exam, teacher, role, values = {}) {
  return {
    school_id: member.school_id,
    academic_year_id: exam.academic_year_id,
    examination_id: exam.id,
    teacher_member_id: teacher.id,
    teacher_name: teacher.full_name || 'Teacher',
    exam_name: exam.exam_name,
    exam_date: exam.exam_date,
    start_time: exam.start_time,
    end_time: exam.end_time,
    room: exam.room,
    subject: exam.subject,
    role,
    status: values.status || 'draft',
    source: values.source || 'manual',
    confirmed: values.confirmed === true,
    required_supervisors: values.required_supervisors || 2,
    subject_teacher_warning: values.subject_teacher_warning === true,
    override_reason: values.override_reason || '',
    override_by: values.override_by || '',
    override_at: values.override_at || '',
    created_by: values.created_by || '',
    reassignment_required: false,
    staffing_issue_reason: '',
    updated_at: new Date().toISOString(),
  };
}

function assertAssignmentAllowed(teacher, exam, academicYearId, assignments, ignoreIds, override) {
  const examConflicts = invigilationConflicts(teacher, exam, assignments, ignoreIds);
  if (examConflicts.length) {
    fail('This teacher is already assigned to an overlapping examination.', 409, {
      conflicts: examConflicts.map((item) => ({ type: 'examination', assignment_id: item.id })),
    });
  }
  const unavailable = availabilityConflicts(teacher, exam, academicYearId);
  if (unavailable.length) {
    fail('This teacher is marked unavailable during the examination.', 409, {
      conflicts: unavailable.map((item) => ({ type: 'availability', availability_id: item.id })),
    });
  }
  const lessons = lessonConflicts(teacher, exam, academicYearId);
  if (lessons.length && !override.enabled) {
    fail('This teacher has a published lesson during the examination. An administrator may approve an override with a reason.', 409, {
      conflicts: lessons.map((item) => ({ type: 'lesson', timetable_entry_id: item.id })),
    });
  }
  if (lessons.length && override.enabled && !override.reason.trim()) {
    fail('A reason is required to override a published lesson conflict.', 400);
  }
  return lessons;
}

function upsertRequirement(actor, member, exam, required) {
  const current = getRequirement(member.school_id, exam.id);
  if (current && Number(current.required_supervisors) === required) return current;
  const values = {
    school_id: member.school_id,
    academic_year_id: exam.academic_year_id,
    examination_id: exam.id,
    required_supervisors: required,
    updated_by: member.id,
    updated_at: new Date().toISOString(),
  };
  const saved = current
    ? updateRecord('InvigilationRequirement', current.id, values)
    : createRecord('InvigilationRequirement', { ...values, created_by: member.id });
  audit(actor, member, 'invigilation.requirement.updated', {
    entity_type: 'InvigilationRequirement',
    entity_id: saved.id,
  }, `Set staffing requirement for ${exam.exam_name} in ${exam.room} to ${required} supervisor(s)`);
  return saved;
}

function generateAssignments(actor, member, body) {
  const academicYear = getAcademicYear(member.school_id, body.academic_year_id);
  const required = body.required_supervisors === undefined
    ? 2
    : Number(body.required_supervisors);
  if (!Number.isInteger(required) || required < 1 || required > 10) {
    fail('Required supervisors must be a whole number between 1 and 10.', 400);
  }
  const exams = getRecords('ExaminationTimetableEntry')
    .filter((exam) => exam.school_id === member.school_id
      && exam.academic_year_id === academicYear.id
      && exam.status === 'published')
    .sort((left, right) => left.exam_date.localeCompare(right.exam_date)
      || left.start_time.localeCompare(right.start_time)
      || left.room.localeCompare(right.room)
      || left.exam_name.localeCompare(right.exam_name)
      || left.id.localeCompare(right.id));
  const teachers = getRecords('SchoolMember')
    .filter((teacher) => teacher.school_id === member.school_id
      && teacher.role === 'teacher' && teacher.status === 'active'
      && (teacher.employment_status || 'active') === 'active');
  const unavailableIds = new Set(Array.isArray(body.unavailable_teacher_ids)
    ? body.unavailable_teacher_ids.map(String)
    : []);
  for (const id of unavailableIds) getTeacher(member.school_id, id);

  const current = activeAssignments(member.school_id);
  const examinationIds = new Set(exams.map((exam) => exam.id));
  const replacedIds = new Set(current
    .filter((assignment) => examinationIds.has(assignment.examination_id) && !assignment.confirmed)
    .map((assignment) => assignment.id));
  const kept = current.filter((assignment) => !replacedIds.has(assignment.id));
  const workloads = new Map();
  for (const assignment of kept) {
    workloads.set(assignment.teacher_member_id, (workloads.get(assignment.teacher_member_id) || 0) + 1);
  }
  const planned = [];
  const underStaffed = [];

  for (const exam of exams) {
    upsertRequirement(actor, member, exam, required);
    const confirmed = current.filter((assignment) => assignment.examination_id === exam.id && assignment.confirmed);
    const selected = confirmed.map((assignment) => ({ assignment, teacherId: assignment.teacher_member_id }));
    const selectedIds = new Set(selected.map((item) => item.teacherId));
    const oldGenerated = current.filter((assignment) => assignment.examination_id === exam.id && !assignment.confirmed);

    const eligible = (teacher, ignoreIds = []) => {
      if (unavailableIds.has(teacher.id) || selectedIds.has(teacher.id)) return false;
      try {
        assertAssignmentAllowed(teacher, exam, academicYear.id, kept.concat(planned), ignoreIds, { enabled: false, reason: '' });
        return true;
      } catch (error) {
        if (error.status === 409) return false;
        throw error;
      }
    };

    for (const old of oldGenerated) {
      if (selected.length >= required) break;
      const teacher = teachers.find((item) => item.id === old.teacher_member_id);
      if (!teacher || !eligible(teacher, [...replacedIds])) continue;
      selected.push({ assignment: old, teacherId: teacher.id });
      selectedIds.add(teacher.id);
      workloads.set(teacher.id, (workloads.get(teacher.id) || 0) + 1);
    }

    while (selected.length < required) {
      const candidates = teachers
        .filter((teacher) => eligible(teacher, [...replacedIds]))
        .map((teacher) => ({
          teacher,
          subjectPenalty: teachesExamSubject(teacher.id, exam, academicYear.id) ? 1 : 0,
          workload: workloads.get(teacher.id) || 0,
        }))
        .sort((left, right) => left.workload - right.workload
          || left.subjectPenalty - right.subjectPenalty
          || String(left.teacher.full_name).localeCompare(String(right.teacher.full_name))
          || left.teacher.id.localeCompare(right.teacher.id));
      const candidate = candidates[0];
      if (!candidate) break;
      const role = selected.some((item) => item.assignment.role === 'chief') ? 'assistant' : 'chief';
      const assignment = createRecord('InvigilationAssignment', assignmentRecord(
        member,
        exam,
        candidate.teacher,
        role,
        {
          status: 'draft',
          source: 'automatic',
          confirmed: false,
          required_supervisors: required,
          subject_teacher_warning: candidate.subjectPenalty === 1,
          created_by: member.id,
        },
      ));
      audit(actor, member, 'invigilation.generated_assignment', {
        entity_type: 'InvigilationAssignment',
        entity_id: assignment.id,
      }, `Automatically assigned ${candidate.teacher.full_name} as ${role} supervisor for ${exam.exam_name} in ${exam.room}`);
      selected.push({ assignment, teacherId: candidate.teacher.id });
      selectedIds.add(candidate.teacher.id);
      workloads.set(candidate.teacher.id, (workloads.get(candidate.teacher.id) || 0) + 1);
    }

    const hasChief = selected.some((item) => item.assignment.role === 'chief');
    if (!hasChief && selected.length) {
      const firstGenerated = selected.find((item) => !item.assignment.confirmed);
      if (firstGenerated) {
        const previousRole = firstGenerated.assignment.role;
        firstGenerated.assignment = updateRecord('InvigilationAssignment', firstGenerated.assignment.id, { role: 'chief' });
        audit(actor, member, 'invigilation.role_updated', {
          entity_type: 'InvigilationAssignment',
          entity_id: firstGenerated.assignment.id,
        }, `Updated ${firstGenerated.assignment.teacher_name}'s role from ${previousRole} to chief during allocation`);
      }
    }
    let assistantCount = selected.filter((item) => item.assignment.role === 'assistant').length;
    for (const item of selected) {
      let role = item.assignment.role;
      if (role === 'chief' && selected.some((other) => other !== item && other.assignment.role === 'chief')) {
        role = 'assistant';
      }
      if (role !== item.assignment.role) {
        const previousRole = item.assignment.role;
        item.assignment = updateRecord('InvigilationAssignment', item.assignment.id, { role });
        audit(actor, member, 'invigilation.role_updated', {
          entity_type: 'InvigilationAssignment',
          entity_id: item.assignment.id,
        }, `Updated ${item.assignment.teacher_name}'s role from ${previousRole} to ${role} during allocation`);
      }
    }
    assistantCount = selected.filter((item) => item.assignment.role === 'assistant').length;

    const selectedOldIds = new Set(selected.map((item) => item.assignment.id));
    for (const old of oldGenerated) {
      if (!selectedOldIds.has(old.id)) {
        const superseded = updateRecord('InvigilationAssignment', old.id, {
          status: 'superseded',
          updated_at: new Date().toISOString(),
        });
        audit(actor, member, 'invigilation.assignment_superseded', {
          entity_type: 'InvigilationAssignment',
          entity_id: superseded.id,
        }, `Superseded ${old.teacher_name}'s assignment for ${exam.exam_name} in ${exam.room} during regeneration`);
      }
    }
    planned.push(...selected.map((item) => item.assignment));
    if (selected.length < required || !selected.some((item) => item.assignment.role === 'chief')) {
      const warning = selected.length < required
        ? `Only ${selected.length} of ${required} required supervisor(s) could be assigned.`
        : 'No chief supervisor is assigned.';
      underStaffed.push({
        examination_id: exam.id,
        exam_name: exam.exam_name,
        exam_date: exam.exam_date,
        start_time: exam.start_time,
        room: exam.room,
        assigned: selected.length,
        required,
        warning,
      });
    } else if (!assistantCount && required > 1) {
      underStaffed.push({
        examination_id: exam.id,
        exam_name: exam.exam_name,
        exam_date: exam.exam_date,
        start_time: exam.start_time,
        room: exam.room,
        assigned: selected.length,
        required,
        warning: 'The room has no assistant supervisor.',
      });
    }
  }

  for (const id of replacedIds) {
    const record = getRecord('InvigilationAssignment', id);
    if (record?.status && ACTIVE_STATUSES.has(record.status)) {
      const superseded = updateRecord('InvigilationAssignment', id, {
        status: 'superseded',
        updated_at: new Date().toISOString(),
      });
      audit(actor, member, 'invigilation.assignment_superseded', {
        entity_type: 'InvigilationAssignment',
        entity_id: superseded.id,
      }, `Superseded ${record.teacher_name}'s assignment during regeneration`);
    }
  }
  const unavailableNames = [...unavailableIds]
    .map((id) => teachers.find((teacher) => teacher.id === id)?.full_name || id)
    .join(', ');
  audit(actor, member, 'invigilation.generated', {
    entity_type: 'InvigilationAssignment',
    entity_id: '',
  }, `Generated invigilation for ${academicYear.name}: ${planned.length} active assignment(s), ${underStaffed.length} staffing warning(s), unavailable teacher(s) excluded: ${unavailableNames || 'none'}`);
  return { assignments: planned, under_staffed: underStaffed, required_supervisors: required };
}

function assignTeacher(actor, member, body) {
  const exam = getExam(member.school_id, String(body.examination_id || ''));
  const year = getAcademicYear(member.school_id, exam.academic_year_id);
  const teacher = getTeacher(member.school_id, String(body.teacher_member_id || ''));
  const role = validateRole(body.role || 'assistant');
  const assignments = activeAssignments(member.school_id);
  const current = body.assignment_id
    ? getRecord('InvigilationAssignment', String(body.assignment_id))
    : null;
  if (body.assignment_id && (!current || current.school_id !== member.school_id
    || current.examination_id !== exam.id || !ACTIVE_STATUSES.has(current.status))) {
    fail('Active invigilation assignment not found.', 404);
  }
  if (assignments.some((item) => item.examination_id === exam.id
    && item.teacher_member_id === teacher.id && item.id !== current?.id)) {
    fail('This teacher already has an assignment in this examination room.', 409);
  }
  if (role === 'chief' && assignments.some((item) => item.examination_id === exam.id
    && item.role === 'chief' && item.id !== current?.id)) {
    fail('This examination room already has a chief supervisor.', 409);
  }
  const overrideEnabled = body.override_lesson_conflict === true;
  const overrideReason = String(body.override_reason || '').trim();
  if (overrideReason.length > 1000) fail('Override reasons must be 1,000 characters or fewer.', 400);
  const lessonConflicts = assertAssignmentAllowed(
    teacher,
    exam,
    year.id,
    assignments,
    current ? [current.id] : [],
    { enabled: overrideEnabled, reason: overrideReason },
  );
  const requirement = getRequirement(member.school_id, exam.id);
  const values = assignmentRecord(member, exam, teacher, role, {
    status: 'draft',
    source: 'manual',
    confirmed: true,
    required_supervisors: requirement?.required_supervisors || 2,
    subject_teacher_warning: teachesExamSubject(teacher.id, exam, year.id),
    override_reason: lessonConflicts.length ? overrideReason : '',
    override_by: lessonConflicts.length ? member.id : '',
    override_at: lessonConflicts.length ? new Date().toISOString() : '',
    created_by: member.id,
  });
  if (current) {
    updateRecord('InvigilationAssignment', current.id, {
      status: 'superseded',
      updated_at: new Date().toISOString(),
    });
  }
  const saved = createRecord('InvigilationAssignment', values);
  if (current) {
    audit(actor, member, 'invigilation.reassigned', {
      entity_type: 'InvigilationAssignment',
      entity_id: current.id,
    }, `Reassigned ${exam.exam_name} in ${exam.room} from ${current.teacher_name} to ${teacher.full_name} (${role} supervisor)`);
    audit(actor, member, 'invigilation.assigned', {
      entity_type: 'InvigilationAssignment',
      entity_id: saved.id,
    }, `Created replacement assignment for ${teacher.full_name} as ${role} supervisor for ${exam.exam_name} in ${exam.room}`);
  } else {
    audit(actor, member, 'invigilation.assigned', {
      entity_type: 'InvigilationAssignment',
      entity_id: saved.id,
    }, `Manually assigned ${teacher.full_name} as ${role} supervisor for ${exam.exam_name} in ${exam.room}`);
  }
  if (lessonConflicts.length) {
    audit(actor, member, 'invigilation.lesson_conflict_overridden', {
      entity_type: 'InvigilationAssignment',
      entity_id: saved.id,
    }, `Approved lesson conflict override for ${teacher.full_name} on ${exam.exam_date}: ${overrideReason}`);
  }
  return { assignment: saved, lesson_conflicts: lessonConflicts.map((item) => item.id) };
}

function removeAssignment(actor, member, body) {
  const assignment = getRecord('InvigilationAssignment', String(body.assignment_id || ''));
  if (!assignment || assignment.school_id !== member.school_id || !ACTIVE_STATUSES.has(assignment.status)) {
    fail('Active invigilation assignment not found.', 404);
  }
  const reason = String(body.reason || '').trim();
  if (!reason || reason.length > 1000) fail('Enter a removal reason of no more than 1,000 characters.', 400);
  const removed = updateRecord('InvigilationAssignment', assignment.id, {
    status: 'removed',
    removal_reason: reason,
    updated_at: new Date().toISOString(),
  });
  audit(actor, member, 'invigilation.removed', {
    entity_type: 'InvigilationAssignment',
    entity_id: assignment.id,
  }, `Removed ${assignment.teacher_name} from ${assignment.exam_name} in ${assignment.room}: ${reason}`);
  return { assignment: removed };
}

function confirmAssignment(actor, member, body) {
  const assignment = getRecord('InvigilationAssignment', String(body.assignment_id || ''));
  if (!assignment || assignment.school_id !== member.school_id || assignment.status !== 'draft') {
    fail('Draft invigilation assignment not found.', 404);
  }
  if (getRecord('ExaminationTimetableEntry', assignment.examination_id)?.status !== 'published') {
    fail('The associated examination is not published.', 409);
  }
  const confirmed = updateRecord('InvigilationAssignment', assignment.id, {
    confirmed: true,
    updated_at: new Date().toISOString(),
  });
  audit(actor, member, 'invigilation.confirmed', {
    entity_type: 'InvigilationAssignment',
    entity_id: assignment.id,
  }, `Confirmed ${assignment.teacher_name} as ${assignment.role} supervisor for ${assignment.exam_name} in ${assignment.room}`);
  return { assignment: confirmed };
}

function publishAssignments(actor, member, body) {
  const academicYear = getAcademicYear(member.school_id, body.academic_year_id);
  const updated = [];
  for (const assignment of activeAssignments(member.school_id)) {
    if (assignment.academic_year_id !== academicYear.id || assignment.status !== 'draft') continue;
    const exam = getRecord('ExaminationTimetableEntry', assignment.examination_id);
    if (exam?.status !== 'published') continue;
    updated.push(updateRecord('InvigilationAssignment', assignment.id, {
      status: 'published',
      confirmed: true,
      updated_at: new Date().toISOString(),
    }));
  }
  for (const assignment of updated) {
    audit(actor, member, 'invigilation.assignment_published', {
      entity_type: 'InvigilationAssignment',
      entity_id: assignment.id,
    }, `Published ${assignment.teacher_name}'s ${assignment.role} assignment for ${assignment.exam_name} in ${assignment.room}`);
  }
  audit(actor, member, 'invigilation.published', {
    entity_type: 'InvigilationAssignment',
    entity_id: '',
  }, `Published ${updated.length} invigilation assignment(s) for ${academicYear.name}`);
  return { published: updated.length };
}

export function manageInvigilation(actor, body = {}) {
  const member = requireManager(actor);
  return withTransaction(() => {
    switch (body.action) {
      case 'generate': return generateAssignments(actor, member, body);
      case 'assign':
      case 'reassign': return assignTeacher(actor, member, body);
      case 'remove': return removeAssignment(actor, member, body);
      case 'confirm': return confirmAssignment(actor, member, body);
      case 'publish': return publishAssignments(actor, member, body);
      default: fail('Choose a supported invigilation management action.', 400);
    }
  });
}
