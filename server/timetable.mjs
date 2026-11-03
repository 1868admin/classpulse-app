import { getRecords } from './database.mjs';

const normalize = (value) => String(value ?? '').trim().toLowerCase();

export function getCurrentAcademicYearId(schoolId) {
  if (!schoolId) return '';
  return getRecords('AcademicYear')
    .find((year) => year.school_id === schoolId && year.is_current)?.id || '';
}

function classId(entry) {
  if (entry.subject_class_id) return `subject:${entry.subject_class_id}`;
  if (entry.homeroom_id) return `homeroom:${entry.homeroom_id}`;
  return '';
}

function sameClass(left, right) {
  const leftId = classId(left);
  const rightId = classId(right);
  if (leftId && rightId) return leftId === rightId;
  const leftName = normalize(left.class_name);
  return leftName !== '' && leftName === normalize(right.class_name);
}

function minutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const [hours, mins] = value.split(':').map(Number);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

function sameTimeSlot(left, right, yearFor) {
  if (left.school_id !== right.school_id
    || yearFor(left) !== yearFor(right)
    || normalize(left.day_name) !== normalize(right.day_name)) return false;

  if (Number(left.period_number) === Number(right.period_number)) return true;

  const leftStart = minutes(left.start_time);
  const leftEnd = minutes(left.end_time);
  const rightStart = minutes(right.start_time);
  const rightEnd = minutes(right.end_time);
  return leftStart !== null && leftEnd !== null && rightStart !== null && rightEnd !== null
    && leftStart < rightEnd && rightStart < leftEnd;
}

function validateEntry(entry) {
  if (!String(entry.school_id || '').trim()
    || !String(entry.member_id || '').trim()
    || !String(entry.day_name || '').trim()) {
    throw Object.assign(new Error('School, teacher, and timetable day are required.'), { status: 400 });
  }
  const period = Number(entry.period_number);
  if (!Number.isInteger(period) || period < 1) {
    throw Object.assign(new Error('Period number must be a positive whole number.'), { status: 400 });
  }
  const start = entry.start_time || '';
  const end = entry.end_time || '';
  if (Boolean(start) !== Boolean(end)) {
    throw Object.assign(new Error('Provide both a start time and an end time.'), { status: 400 });
  }
  if (start || end) {
    const startMinutes = minutes(start);
    const endMinutes = minutes(end);
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
      throw Object.assign(new Error('Lesson times must be valid and the start must be before the end.'), { status: 400 });
    }
  }
}

export function assertNoTimetableConflicts(candidates, existing, { ignoreIds = [] } = {}) {
  const ignored = new Set(ignoreIds);
  const yearCache = new Map();
  const yearFor = (entry) => {
    if (entry.academic_year_id) return entry.academic_year_id;
    if (!yearCache.has(entry.school_id)) {
      yearCache.set(entry.school_id, getCurrentAcademicYearId(entry.school_id));
    }
    return yearCache.get(entry.school_id);
  };
  const scheduled = existing.filter((entry) => !entry.archived && !ignored.has(entry.id));
  const unavailable = getRecords('TeacherAvailability').filter((slot) => slot.is_available !== true);
  const conflicts = [];

  candidates.forEach((candidate, candidateIndex) => {
    if (candidate.archived) return;
    validateEntry(candidate);

    const unavailableSlot = unavailable.find((slot) => {
      if (slot.school_id !== candidate.school_id
        || slot.member_id !== candidate.member_id
        || slot.academic_year_id !== yearFor(candidate)
        || normalize(slot.day_name) !== normalize(candidate.day_name)) return false;
      if (Number(slot.period_number) === Number(candidate.period_number)) return true;
      const slotStart = minutes(slot.start_time);
      const slotEnd = minutes(slot.end_time);
      const candidateStart = minutes(candidate.start_time);
      const candidateEnd = minutes(candidate.end_time);
      return slotStart !== null && slotEnd !== null && candidateStart !== null && candidateEnd !== null
        && slotStart < candidateEnd && candidateStart < slotEnd;
    });
    if (unavailableSlot) {
      conflicts.push({
        row: candidateIndex + 1,
        type: 'availability',
        message: `Teacher is unavailable at ${candidate.day_name} period ${Number(candidate.period_number)}.`,
        conflicting_entry_id: unavailableSlot.id || null,
      });
    }

    for (const other of scheduled) {
      if (!sameTimeSlot(candidate, other, yearFor)) continue;
      const period = Number(candidate.period_number);
      const when = `${candidate.day_name} period ${period}`;

      if (candidate.member_id && candidate.member_id === other.member_id) {
        conflicts.push({
          row: candidateIndex + 1,
          type: 'teacher',
          message: `Teacher already has a lesson at ${when}.`,
          conflicting_entry_id: other.id || null,
        });
      }

      if (sameClass(candidate, other)) {
        conflicts.push({
          row: candidateIndex + 1,
          type: 'class',
          message: `Class ${candidate.class_name || other.class_name || 'in this lesson'} already has a lesson at ${when}.`,
          conflicting_entry_id: other.id || null,
        });
      }

      const room = normalize(candidate.room);
      if (room && room === normalize(other.room)) {
        conflicts.push({
          row: candidateIndex + 1,
          type: 'room',
          message: `Room ${candidate.room} is already booked at ${when}.`,
          conflicting_entry_id: other.id || null,
        });
      }
    }

    scheduled.push(candidate);
  });

  if (conflicts.length) {
    const uniqueMessages = [...new Set(conflicts.map((conflict) => `Row ${conflict.row}: ${conflict.message}`))];
    const summary = uniqueMessages.slice(0, 5).join(' ');
    const remaining = uniqueMessages.length - 5;
    throw Object.assign(new Error(`Timetable conflict detected. ${summary}${remaining > 0 ? ` And ${remaining} more.` : ''}`), {
      status: 409,
      details: { conflicts: conflicts.slice(0, 100) },
    });
  }
}
