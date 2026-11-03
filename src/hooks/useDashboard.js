import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { todayStr, fmtTime } from '@/lib/dates';
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

export function useAdminDashboard(schoolId, alertThreshold) {
  const [data, setData] = useState({
    loading: true,
    students: 0,
    homerooms: 0,
    homeroomList: [],
    classRows: [],
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
  });
  const today = todayStr();
  const monthStart = moment().startOf('month').format('YYYY-MM-DD');

  const load = useCallback(async () => {
    if (!schoolId) return;
    setData((current) => ({ ...current, loading: true }));
    const [studentCount, classesPage, membershipsResult, todayResult, todayRecordsResult, monthResult] = await Promise.all([
      base44.entities.Student.count({ school_id: schoolId, archived: false, status: 'active' }),
      base44.entities.HomeroomClass.filter(
        { school_id: schoolId, archived: false },
        { limit: 1000, sort: 'name' },
      ),
      fetchAllPages('ClassMembership', { school_id: schoolId, class_type: 'homeroom' }, 'student_name'),
      fetchAllPages('AttendanceSession', { school_id: schoolId, date: today }),
      fetchAllPages('AttendanceRecord', { school_id: schoolId, class_type: 'homeroom', date: today }),
      fetchAllPages('AttendanceRecord', {
        school_id: schoolId,
        class_type: 'homeroom',
        date: { $gte: monthStart, $lte: today },
      }),
    ]);

    const classes = classesPage.items || [];
    const memberships = membershipsResult.items;
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
      sessions: todaySessions,
      totals: todayTotals,
      monthTotals: monthlyTotals,
      attendanceToday: percent(todayTotals.present + todayTotals.late, todayTotals.students) || 0,
      registerCount: new Set(todaySessions.filter((session) => session.class_type === 'homeroom').map((session) => session.class_id)).size,
      monthlyTrend,
      recordedDays: trendByDate.size,
      flaggedStudents,
      threshold,
      dataTruncated: membershipsResult.truncated || todayResult.truncated || todayRecordsResult.truncated || monthResult.truncated,
    });
  }, [schoolId, today, monthStart, alertThreshold]);

  useEffect(() => { load(); }, [load]);
  return { ...data, reload: load, today };
}

export function useTeacherDashboard(schoolId, memberId) {
  const [data, setData] = useState({
    loading: true, classLinks: [], entries: [], todayEntries: [], sessions: [], calendar: null,
    dayName: '', homeroomCount: 0, subjectCount: 0, studentTotal: 0, submittedToday: 0, outstanding: 0,
    supervisionAssignments: [],
  });
  const today = todayStr();

  const load = useCallback(async () => {
    if (!schoolId || !memberId) return;
    setData((current) => ({ ...current, loading: true }));
    const [links, entries, sessions, calendar, supervision] = await Promise.all([
      base44.entities.ClassTeacher.filter({ school_id: schoolId, member_id: memberId }, { limit: 200 }),
      base44.entities.TimetableEntry.filter({ school_id: schoolId, member_id: memberId, archived: false }, { limit: 200 }),
      base44.entities.AttendanceSession.filter({ school_id: schoolId, date: today, member_id: memberId }, { limit: 100 }),
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

    const classIds = classLinks.map((link) => link.class_id);
    let studentTotal = 0;
    for (const id of classIds.slice(0, 20)) {
      studentTotal += await base44.entities.ClassMembership.count({ school_id: schoolId, class_id: id });
    }

    const subjectClassIds = new Set(classLinks.filter((link) => link.class_type === 'subject').map((link) => link.class_id));
    const homeroomIds = new Set(classLinks.filter((link) => link.class_type === 'homeroom').map((link) => link.class_id));
    const assignedHomeroomIds = [...homeroomIds];
    const [homeroomClasses, presentRecords] = assignedHomeroomIds.length
      ? await Promise.all([
        base44.entities.HomeroomClass.filter(
          { school_id: schoolId, id: { $in: assignedHomeroomIds } },
          { limit: 200 },
        ),
        base44.entities.AttendanceRecord.filter({
          school_id: schoolId,
          class_type: 'homeroom',
          class_id: { $in: assignedHomeroomIds },
          date: today,
          status: 'present',
        }, { limit: 1000 }),
      ])
      : [{ items: [] }, { items: [] }];
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
      subjectCount: subjectClassIds.size,
      studentTotal,
      submittedToday: todaySessions.length,
      outstanding: Math.max(0, todayEntries.length - todaySessions.length),
      supervisionAssignments: supervision.items || [],
      hasNoSchool: calendarToday?.day_type === 'no_school',
      calendarMissing: !calendarToday,
    });
  }, [schoolId, memberId, today]);

  useEffect(() => { load(); }, [load]);
  return { ...data, reload: load, today, fmtTime };
}
