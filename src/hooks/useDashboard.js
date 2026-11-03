import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { todayStr, fmtTime } from '@/lib/dates';
import { notifyError } from '@/lib/notify';
import moment from 'moment';

async function fetchAllPages(entity, query, sort) {
  const items = [];
  let cursor = null;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await base44.entities[entity].filter(query, {
      limit: 1000,
      sort,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!cursor) return { items, truncated: false };
  }
  return { items, truncated: !!cursor };
}

const EMPTY_TOTALS = { students: 0, present: 0, absent: 0, late: 0, excused: 0 };

function registerRow({ klass, type, label, session, teachers = [], periods = [], date, enrolled = 0 }) {
  const present = Number(session?.present_count || 0);
  const absent = Number(session?.absent_count || 0);
  const late = Number(session?.late_count || 0);
  const assignedTeachers = [...new Set(teachers.filter(Boolean))];
  return {
    key: `${type}|${klass.id}|${label}`,
    classId: klass.id,
    className: klass.name,
    classType: type,
    subject: klass.subject || '',
    label,
    periods,
    date,
    teachers: assignedTeachers,
    teacher: assignedTeachers.join(', ') || session?.member_name || '—',
    enrolled,
    present,
    absent,
    late,
    rate: enrolled ? ((present + late) / enrolled) * 100 : null,
    session: session || null,
  };
}

function sessionMatches(session, classId, label, periods = []) {
  if (session.class_id !== classId) return false;
  if (session.session_label === label) return true;
  const savedPeriods = Array.isArray(session.period_numbers) && session.period_numbers.length
    ? session.period_numbers.map(Number)
    : [Number(session.period_number)].filter(Boolean);
  return periods.some((period) => savedPeriods.includes(Number(period)));
}

function subjectLessonRows(entries, classes, sessions, classLinks, counts, date) {
  const classesById = new Map(classes.map((klass) => [klass.id, klass]));
  const grouped = new Map();
  entries.filter((entry) => entry.day_name && entry.subject_class_id).forEach((entry) => {
    const key = `${entry.member_id}|${entry.subject_class_id}|${entry.subject || ''}`;
    const group = grouped.get(key) || [];
    group.push(entry);
    grouped.set(key, group);
  });

  const rows = [];
  const representedSessions = new Set();
  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => Number(a.period_number) - Number(b.period_number));
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];
      const period = Number(current.period_number);
      const isDouble = next && Number(next.period_number) === period + 1;
      const periods = isDouble ? [period, Number(next.period_number)] : [period];
      if (isDouble) index += 1;
      const klass = classesById.get(current.subject_class_id);
      if (!klass) continue;
      const label = periods.length > 1 ? `Periods ${periods.join(' + ')}` : `Period ${period}`;
      const session = sessions.find((item) => item.class_type === 'subject'
        && sessionMatches(item, klass.id, label, periods)) || null;
      if (session) representedSessions.add(session.id);
      const teachers = classLinks
        .filter((link) => link.class_id === klass.id && link.class_type === 'subject')
        .map((link) => link.member_name);
      if (current.member_name) teachers.push(current.member_name);
      rows.push(registerRow({
        klass,
        type: 'subject',
        label,
        periods,
        session,
        teachers,
        enrolled: counts.get(klass.id) || 0,
        date,
      }));
    }
  }

  sessions.filter((session) => session.class_type === 'subject' && !representedSessions.has(session.id))
    .forEach((session) => {
      const klass = classesById.get(session.class_id);
      if (!klass) return;
      const teachers = classLinks
        .filter((link) => link.class_id === klass.id && link.class_type === 'subject')
        .map((link) => link.member_name);
      rows.push(registerRow({
        klass,
        type: 'subject',
        label: session.session_label || 'Class session',
        periods: Array.isArray(session.period_numbers) ? session.period_numbers : [],
        session,
        teachers,
        enrolled: counts.get(klass.id) || 0,
        date,
      }));
    });
  const uniqueRows = new Map();
  rows.forEach((row) => {
    const existing = uniqueRows.get(row.key);
    if (!existing) {
      uniqueRows.set(row.key, row);
      return;
    }
    existing.teachers = [...new Set([...existing.teachers, ...row.teachers])];
    existing.teacher = existing.teachers.join(', ') || existing.teacher;
  });
  return [...uniqueRows.values()];
}

export function useAdminDashboard(schoolId, alertThreshold) {
  const [data, setData] = useState({
    loading: true,
    students: 0,
    homerooms: 0,
    homeroomList: [],
    classRows: [],
    attendanceRows: { morning: [], afternoon: [], subject: [] },
    sessions: [],
    totals: EMPTY_TOTALS,
    monthTotals: EMPTY_TOTALS,
    attendanceToday: 0,
    registerCount: 0,
    monthlyTrend: [],
    recordedDays: 0,
    flaggedStudents: [],
    threshold: 90,
    dataTruncated: false,
    error: null,
  });
  const today = todayStr();
  const monthStart = moment().startOf('month').format('YYYY-MM-DD');

  const load = useCallback(async () => {
    if (!schoolId) return;
    setData((current) => ({ ...current, loading: true, error: null }));
    try {
    const [studentCount, homeroomsPage, subjectClassesPage, membershipsResult, classLinksResult, timetableResult, calendarResult, todayResult, todayRecordsResult, monthResult] = await Promise.all([
      base44.entities.Student.count({ school_id: schoolId, archived: false, status: 'active' }),
      base44.entities.HomeroomClass.filter(
        { school_id: schoolId, archived: false },
        { limit: 1000, sort: 'name' },
      ),
      base44.entities.SubjectClass.filter(
        { school_id: schoolId, archived: false },
        { limit: 1000, sort: 'name' },
      ),
      fetchAllPages('ClassMembership', { school_id: schoolId }, 'student_name'),
      fetchAllPages('ClassTeacher', { school_id: schoolId, is_active: { $ne: false } }, 'member_name'),
      fetchAllPages('TimetableEntry', { school_id: schoolId, archived: false }, 'period_number'),
      base44.entities.CalendarDate.filter({ school_id: schoolId, date: today }, { limit: 1 }),
      fetchAllPages('AttendanceSession', { school_id: schoolId, date: today }),
      fetchAllPages('AttendanceRecord', { school_id: schoolId, class_type: 'homeroom', date: today }),
      fetchAllPages('AttendanceRecord', {
        school_id: schoolId,
        class_type: 'homeroom',
        date: { $gte: monthStart, $lte: today },
      }),
    ]);

    const classes = homeroomsPage.items || [];
    const subjectClasses = subjectClassesPage.items || [];
    const memberships = membershipsResult.items;
    const classLinks = classLinksResult.items;
    const timetableEntries = timetableResult.items;
    const todaySessions = todayResult.items;
    const todayRecords = todayRecordsResult.items;
    const monthRecords = monthResult.items;
    const classCounts = new Map();
    memberships.forEach((membership) => {
      classCounts.set(membership.class_id, (classCounts.get(membership.class_id) || 0) + 1);
    });
    const todaySessionsByClass = new Map();
    const todayPresentRecords = todayRecords.filter((record) => record.status === 'present');
    const presentStudentIds = [...new Set(todayPresentRecords.map((record) => record.student_id))];
    const presentStudents = presentStudentIds.length
      ? await base44.entities.Student.filter(
        { school_id: schoolId, id: { $in: presentStudentIds } },
        { limit: 1000 },
      )
      : { items: [] };
    const presentGenderById = new Map((presentStudents.items || []).map((student) => [
      student.id,
      String(student.gender || '').trim().toLowerCase(),
    ]));
    const presentByClass = new Map();
    todayPresentRecords.forEach((record) => {
      const counts = presentByClass.get(record.class_id) || { boys: new Set(), girls: new Set() };
      const gender = presentGenderById.get(record.student_id);
      if (gender === 'male' || gender === 'boy' || gender === 'm') counts.boys.add(record.student_id);
      if (gender === 'female' || gender === 'girl' || gender === 'f') counts.girls.add(record.student_id);
      presentByClass.set(record.class_id, counts);
    });
    todaySessions
      .filter((session) => session.class_type === 'homeroom')
      .forEach((session) => {
        const sessions = todaySessionsByClass.get(session.class_id) || [];
        sessions.push(session);
        todaySessionsByClass.set(session.class_id, sessions);
      });

    const monthlyTotals = { ...EMPTY_TOTALS };
    const monthByClass = new Map();
    const monthByStudent = new Map();
    const trendByDate = new Map();
    const statusKeys = ['present', 'absent', 'late', 'excused'];
    const accumulate = (target, status) => {
      target.students = (target.students || 0) + 1;
      target[status] = (target[status] || 0) + 1;
    };

    monthRecords.forEach((record) => {
      const status = statusKeys.includes(record.status) ? record.status : 'present';
      accumulate(monthlyTotals, status);

      const classStats = monthByClass.get(record.class_id) || { total: 0, present: 0, late: 0 };
      classStats.total += 1;
      if (status === 'present') classStats.present += 1;
      if (status === 'late') classStats.late += 1;
      monthByClass.set(record.class_id, classStats);

      const studentStats = monthByStudent.get(record.student_id) || {
        name: record.student_name || 'Student',
        studentId: record.student_id_no || '',
        total: 0,
        present: 0,
        late: 0,
      };
      studentStats.total += 1;
      if (status === 'present') studentStats.present += 1;
      if (status === 'late') studentStats.late += 1;
      monthByStudent.set(record.student_id, studentStats);

      const dateStats = trendByDate.get(record.date) || { total: 0, attending: 0 };
      dateStats.total += 1;
      if (status === 'present' || status === 'late') dateStats.attending += 1;
      trendByDate.set(record.date, dateStats);
    });

    const threshold = Number.isFinite(Number(alertThreshold)) && Number(alertThreshold) >= 0
      ? Number(alertThreshold)
      : 90;
    const percent = (part, total) => (total ? (part / total) * 100 : null);
    const classRows = classes.map((klass) => {
      const enrolled = classCounts.get(klass.id) || 0;
      const submittedSessions = todaySessionsByClass.get(klass.id) || [];
      const completedSession = enrolled > 0 && submittedSessions.some((session) => (session.student_count || 0) >= enrolled);
      const partialSession = submittedSessions.some((session) => (session.student_count || 0) < enrolled);
      const todayStatus = submittedSessions.length === 0
        ? 'not_taken'
        : completedSession ? 'complete' : partialSession ? 'partial' : 'complete';
      const monthStats = monthByClass.get(klass.id) || { total: 0, present: 0, late: 0 };
      const todayGenderCounts = presentByClass.get(klass.id) || { boys: new Set(), girls: new Set() };
      const presentCounts = { boysPresent: todayGenderCounts.boys.size, girlsPresent: todayGenderCounts.girls.size };
      return {
        ...klass,
        enrolled,
        todayStatus,
        ...presentCounts,
        monthRate: percent(monthStats.present + monthStats.late, monthStats.total),
      };
    });
    const dailyRows = (label) => classes.map((klass) => {
      const session = todaySessions.find((item) => item.class_type === 'homeroom'
        && item.class_id === klass.id && item.session_label === label);
      const teachers = classLinks
        .filter((link) => link.class_id === klass.id && link.class_type === 'homeroom')
        .map((link) => link.member_name);
      return registerRow({
        klass,
        type: 'homeroom',
        label,
        session,
        teachers,
        enrolled: classCounts.get(klass.id) || 0,
        date: today,
      });
    });
    const calendarToday = (calendarResult.items || [])[0];
    const todayLessonEntries = timetableEntries.filter((entry) =>
      calendarToday?.day_type === 'cycle' && entry.day_name === calendarToday.day_name);
    const attendanceRows = {
      morning: dailyRows('Morning'),
      afternoon: dailyRows('Afternoon'),
      subject: subjectLessonRows(
        todayLessonEntries,
        subjectClasses,
        todaySessions,
        classLinks,
        classCounts,
        today,
      ),
    };
    const attendanceDays = moment().date();
    const monthlyTrend = Array.from({ length: attendanceDays }, (_, index) => {
      const date = moment().startOf('month').add(index, 'days').format('YYYY-MM-DD');
      const dateStats = trendByDate.get(date);
      return {
        date,
        label: moment(date).format('D'),
        rate: percent(dateStats?.attending || 0, dateStats?.total || 0),
      };
    });
    const flaggedStudents = [...monthByStudent.values()]
      .map((student) => ({
        ...student,
        rate: percent(student.present + student.late, student.total),
      }))
      .filter((student) => student.rate !== null && student.rate < threshold)
      .sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name))
      .slice(0, 5);
    const todayTotals = todaySessions
      .filter((session) => session.class_type === 'homeroom')
      .reduce((totals, session) => ({
        students: totals.students + (session.student_count || 0),
        present: totals.present + (session.present_count || 0),
        absent: totals.absent + (session.absent_count || 0),
        late: totals.late + (session.late_count || 0),
        excused: totals.excused + (session.excused_count || 0),
      }), { ...EMPTY_TOTALS });

    setData({
      loading: false,
      students: studentCount,
      homerooms: classes.length,
      homeroomList: classes,
      classRows,
      attendanceRows,
      sessions: todaySessions,
      totals: todayTotals,
      monthTotals: monthlyTotals,
      attendanceToday: percent(todayTotals.present + todayTotals.late, todayTotals.students) || 0,
      registerCount: new Set(todaySessions.filter((session) => session.class_type === 'homeroom').map((session) => session.class_id)).size,
      monthlyTrend,
      recordedDays: trendByDate.size,
      flaggedStudents,
      threshold,
      dataTruncated: membershipsResult.truncated || classLinksResult.truncated || timetableResult.truncated
        || todayResult.truncated || todayRecordsResult.truncated || monthResult.truncated,
    });
    } catch (error) {
      notifyError('Could not load dashboard', error?.message || 'Dashboard data could not be loaded.');
      setData((current) => ({ ...current, loading: false, error }));
    }
  }, [schoolId, today, monthStart, alertThreshold]);

  useEffect(() => { load(); }, [load]);
  return { ...data, reload: load, today };
}

export function useTeacherDashboard(schoolId, memberId) {
  const [data, setData] = useState({
    loading: true, classLinks: [], entries: [], todayEntries: [], sessions: [], calendar: null,
    dayName: '', homeroomCount: 0, subjectCount: 0, studentTotal: 0, submittedToday: 0, outstanding: 0,
    supervisionAssignments: [], homeroomRows: [], attendanceRows: { morning: [], afternoon: [], subject: [] },
    hasNoSchool: false, calendarMissing: false, error: null,
  });
  const today = todayStr();

  const load = useCallback(async () => {
    if (!schoolId || !memberId) return;
    setData((current) => ({ ...current, loading: true, error: null }));
    try {
    const [links, entries, sessions, calendar, supervision] = await Promise.all([
      base44.entities.ClassTeacher.filter({ school_id: schoolId, member_id: memberId, is_active: { $ne: false } }, { limit: 200 }),
      base44.entities.TimetableEntry.filter({ school_id: schoolId, member_id: memberId, archived: false, published: { $ne: false } }, { limit: 200 }),
      base44.entities.AttendanceSession.filter({ school_id: schoolId, date: today }, { limit: 300 }),
      base44.entities.CalendarDate.filter({ school_id: schoolId, date: today }, { limit: 1 }),
      base44.entities.InvigilationAssignment.filter(
        { school_id: schoolId, teacher_member_id: memberId, status: 'published', exam_date: { $gte: today } },
        { limit: 100, sort: ['exam_date', 'start_time'] },
      ),
    ]);
    const classLinks = links.items || [];
    const todaySessions = sessions.items || [];
    const calendarToday = (calendar.items || [])[0] || null;
    const dayName = calendarToday?.day_type === 'cycle' ? calendarToday.day_name : '';
    const todayEntries = (entries.items || [])
      .filter((entry) => entry.day_name === dayName)
      .sort((a, b) => a.period_number - b.period_number);

    const classIds = [...new Set(classLinks.map((link) => link.class_id))];
    const enrollmentByClass = new Map();
    let studentTotal = 0;
    const enrollments = await Promise.all(classIds.map(async (id) => [
      id,
      await base44.entities.ClassMembership.count({ school_id: schoolId, class_id: id }),
    ]));
    enrollments.forEach(([id, count]) => {
      enrollmentByClass.set(id, count);
      studentTotal += count;
    });

    const subjectClassIds = new Set(classLinks.filter((link) => link.class_type === 'subject').map((link) => link.class_id));
    const homeroomIds = new Set(classLinks.filter((link) => link.class_type === 'homeroom').map((link) => link.class_id));
    const assignedHomeroomIds = [...homeroomIds];
    const assignedSubjectIds = [...subjectClassIds];
    const [homeroomClasses, assignedSubjectClasses, presentRecords] = assignedHomeroomIds.length || assignedSubjectIds.length
      ? await Promise.all([
        assignedHomeroomIds.length
          ? base44.entities.HomeroomClass.filter(
            { school_id: schoolId, id: { $in: assignedHomeroomIds } },
            { limit: 200 },
          )
          : Promise.resolve({ items: [] }),
        assignedSubjectIds.length
          ? base44.entities.SubjectClass.filter(
            { school_id: schoolId, id: { $in: assignedSubjectIds } },
            { limit: 200 },
          )
          : Promise.resolve({ items: [] }),
        assignedHomeroomIds.length
          ? base44.entities.AttendanceRecord.filter({
            school_id: schoolId,
            class_type: 'homeroom',
            class_id: { $in: assignedHomeroomIds },
            date: today,
            status: 'present',
          }, { limit: 1000 })
          : Promise.resolve({ items: [] }),
      ])
      : [{ items: [] }, { items: [] }, { items: [] }];
    const presentRecordsList = presentRecords.items || [];
    const presentStudentIds = [...new Set(presentRecordsList.map((record) => record.student_id))];
    const presentStudents = presentStudentIds.length
      ? await base44.entities.Student.filter(
        { school_id: schoolId, id: { $in: presentStudentIds } },
        { limit: 1000 },
      )
      : { items: [] };
    const genderByStudentId = new Map((presentStudents.items || []).map((student) => [
      student.id,
      String(student.gender || '').trim().toLowerCase(),
    ]));
    const presentCountsByClass = new Map();
    presentRecordsList.forEach((record) => {
      const counts = presentCountsByClass.get(record.class_id) || { boys: new Set(), girls: new Set() };
      const gender = genderByStudentId.get(record.student_id);
      if (gender === 'male' || gender === 'boy' || gender === 'm') counts.boys.add(record.student_id);
      if (gender === 'female' || gender === 'girl' || gender === 'f') counts.girls.add(record.student_id);
      presentCountsByClass.set(record.class_id, counts);
    });
    const homeroomRows = (homeroomClasses.items || []).map((klass) => ({
      ...klass,
      boysPresent: (presentCountsByClass.get(klass.id)?.boys || new Set()).size,
      girlsPresent: (presentCountsByClass.get(klass.id)?.girls || new Set()).size,
    }));
    const homeroomById = new Map((homeroomClasses.items || []).map((klass) => [klass.id, klass]));
    const assignedSubjects = assignedSubjectClasses.items || [];
    const dailyRows = (label) => [...homeroomIds].map((id) => {
      const klass = homeroomById.get(id);
      if (!klass) return null;
      const session = todaySessions.find((item) => item.class_type === 'homeroom'
        && item.class_id === id && item.session_label === label);
      return registerRow({
        klass,
        type: 'homeroom',
        label,
        session,
        teachers: classLinks.filter((link) => link.class_id === id).map((link) => link.member_name),
        enrolled: enrollmentByClass.get(id) || 0,
        date: today,
      });
    }).filter(Boolean);
    const attendanceRows = {
      morning: dailyRows('Morning'),
      afternoon: dailyRows('Afternoon'),
      subject: subjectLessonRows(
        todayEntries,
        assignedSubjects,
        todaySessions,
        classLinks,
        enrollmentByClass,
        today,
      ),
    };

    setData({
      loading: false,
      classLinks,
      entries: entries.items || [],
      todayEntries,
      sessions: todaySessions,
      calendar: calendarToday,
      dayName,
      homeroomCount: homeroomIds.size,
      homeroomRows,
      attendanceRows,
      subjectCount: subjectClassIds.size,
      studentTotal,
      submittedToday: todaySessions.length,
      outstanding: Math.max(0, todayEntries.length - todaySessions.length),
      supervisionAssignments: supervision.items || [],
      hasNoSchool: calendarToday?.day_type === 'no_school',
      calendarMissing: !calendarToday,
    });
    } catch (error) {
      notifyError('Could not load dashboard', error?.message || 'Dashboard data could not be loaded.');
      setData((current) => ({ ...current, loading: false, error }));
    }
  }, [schoolId, memberId, today]);

  useEffect(() => { load(); }, [load]);
  return { ...data, reload: load, today, fmtTime };
}
