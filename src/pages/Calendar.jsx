import { useCallback, useEffect, useMemo, useState } from 'react';
import moment from 'moment';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Layers, Pencil, Plus, RotateCcw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import { DateAssignDialog, BulkCalendarDialog } from '@/components/calendar/CalendarDialogs';
import { Button } from '@/components/ui/button';
import { notifySuccess, notifyError } from '@/lib/notify';
import { todayStr, fmtTime } from '@/lib/dates';

export default function Calendar({ compact = false }) {
  const { schoolId, school, member, isStaff, isPlatformAdmin } = useSchool();
  const days = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const [month, setMonth] = useState(moment().startOf('month'));
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [records, setRecords] = useState([]);
  const [attendanceSessions, setAttendanceSessions] = useState([]);
  const [classCounts, setClassCounts] = useState({});
  const [timetableEntries, setTimetableEntries] = useState([]);
  const [examinations, setExaminations] = useState([]);
  const [invigilations, setInvigilations] = useState([]);
  const [editing, setEditing] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const start = month.clone().startOf('month').format('YYYY-MM-DD');
  const end = month.clone().endOf('month').format('YYYY-MM-DD');

  const load = useCallback(async () => {
    if (!schoolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [calendarPage, sessionPage, homeroomPage, subjectPage, teacherPage, timetablePage, examinationPage, invigilationPage] = await Promise.all([
        base44.entities.CalendarDate.filter({ school_id: schoolId, date: { $gte: start, $lte: end } }, { limit: 200 }),
        base44.entities.AttendanceSession.filter({ school_id: schoolId, date: { $gte: start, $lte: end } }, { limit: 1000 }),
        base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 200 }),
        base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 300 }),
        isStaff || isPlatformAdmin || !member ? Promise.resolve({ items: [] })
          : base44.entities.ClassTeacher.filter({ school_id: schoolId, member_id: member.id, is_active: { $ne: false } }, { limit: 300 }),
        base44.entities.TimetableEntry.filter({
          school_id: schoolId,
          archived: false,
          ...(member?.role === 'teacher' && !isPlatformAdmin ? { member_id: member.id, published: { $ne: false } } : {}),
        }, { limit: 2000 }),
        base44.entities.ExaminationTimetableEntry.filter({
          school_id: schoolId,
          status: 'published',
          exam_date: { $gte: start, $lte: end },
        }, { limit: 1000 }),
        base44.entities.InvigilationAssignment.filter({
          school_id: schoolId,
          status: 'published',
          exam_date: { $gte: start, $lte: end },
        }, { limit: 1000 }),
      ]);
      const availableIds = isStaff || isPlatformAdmin ? null : new Set((teacherPage.items || []).map((link) => link.class_id));
      setRecords(calendarPage.items || []);
      setAttendanceSessions((sessionPage.items || []).filter((session) =>
        !availableIds || availableIds.has(session.class_id)));
      setClassCounts(Object.fromEntries([
        ...(homeroomPage.items || []),
        ...(subjectPage.items || []),
      ].map((klass) => [klass.id, klass.student_count || 0])));
      setTimetableEntries(timetablePage.items || []);
      setExaminations(examinationPage.items || []);
      setInvigilations(invigilationPage.items || []);
    } catch (error) {
      notifyError('Could not load calendar', error.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, start, end, isStaff, isPlatformAdmin, member]);

  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => {
    const map = {};
    records.forEach((r) => { map[r.date] = r; });
    return map;
  }, [records]);
  const attendanceByDate = useMemo(() => {
    const map = {};
    attendanceSessions.forEach((session) => {
      const sessions = map[session.date] || [];
      sessions.push(session);
      map[session.date] = sessions;
    });
    return map;
  }, [attendanceSessions]);
  const selectedRecord = byDate[selectedDate];
  const selectedDayName = selectedRecord?.day_type === 'cycle' ? selectedRecord.day_name : '';
  const selectedLessons = selectedDayName
    ? timetableEntries.filter((entry) => entry.day_name === selectedDayName)
      .sort((a, b) => Number(a.period_number) - Number(b.period_number))
    : [];
  const selectedExaminations = examinations.filter((event) => event.exam_date === selectedDate);
  const selectedInvigilations = invigilations.filter((event) => event.exam_date === selectedDate);
  const selectedAttendance = attendanceByDate[selectedDate] || [];

  const changeMonth = (amount) => {
    const nextMonth = month.clone().add(amount, 'month');
    setMonth(nextMonth);
    if (!moment(selectedDate).isSame(nextMonth, 'month')) {
      setSelectedDate(nextMonth.format('YYYY-MM-01'));
    }
  };
  const goToToday = () => {
    setMonth(moment().startOf('month'));
    setSelectedDate(todayStr());
  };

  const upsert = async (date, payload) => {
    const existing = byDate[date];
    const data = { school_id: schoolId, date, ...payload };
    try {
      if (existing) await base44.entities.CalendarDate.update(existing.id, data);
      else await base44.entities.CalendarDate.create(data);
      notifySuccess('Calendar saved', `${moment(date).format('ddd D MMM')} updated.`);
      load();
    } catch (err) {
      notifyError('Could not save date', err.message);
    }
  };

  const applyBulk = async (form) => {
    const from = moment(form.from);
    const to = moment(form.to);
    if (to.isBefore(from)) { notifyError('Check the dates', 'The end date is before the start date.'); return; }
    let index = days.indexOf(form.day_name);
    const ops = [];
    let cursor = from.clone();
    while (cursor.isSameOrBefore(to)) {
      const dateStr = cursor.format('YYYY-MM-DD');
      const weekend = cursor.day() === 0 || cursor.day() === 6;
      if (form.day_type === 'cycle' && form.rotate) {
        if (!weekend) {
          ops.push({ date: dateStr, payload: { day_type: 'cycle', day_name: days[index % days.length], reason: '' } });
          index += 1;
        }
      } else if (!(form.day_type === 'cycle' && weekend)) {
        ops.push({ date: dateStr, payload: { day_type: form.day_type, day_name: form.day_type === 'cycle' ? form.day_name : '', reason: form.reason || '' } });
      }
      cursor = cursor.clone().add(1, 'day');
    }
    const existing = await base44.entities.CalendarDate.filter({ school_id: schoolId, date: { $gte: form.from, $lte: form.to } }, { limit: 400 });
    const existingMap = {};
    (existing.items || []).forEach((r) => { existingMap[r.date] = r; });
    const creates = [];
    for (const op of ops) {
      const found = existingMap[op.date];
      if (found) await base44.entities.CalendarDate.update(found.id, { school_id: schoolId, date: op.date, ...op.payload });
      else creates.push({ school_id: schoolId, date: op.date, ...op.payload });
    }
    if (creates.length) await base44.entities.CalendarDate.bulkCreate(creates);
    notifySuccess('Calendar updated', `${ops.length} date(s) updated.`);
    load();
  };

  const gridStart = month.clone().startOf('month').startOf('week');
  const gridEnd = month.clone().endOf('month').endOf('week');
  const cells = [];
  let c = gridStart.clone();
  while (c.isSameOrBefore(gridEnd)) {
    cells.push(c.clone());
    c = c.clone().add(1, 'day');
  }

  const badgeFor = (rec) => {
    if (!rec) return { label: 'Not set', cls: 'bg-muted text-muted-foreground' };
    if (rec.day_type === 'no_school') return { label: 'No school', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' };
    if (rec.day_type === 'special') return { label: 'Special', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' };
    return { label: rec.day_name || 'Day', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' };
  };

  const dayTypeLabel = !selectedRecord
    ? 'No school-day assignment'
    : selectedRecord.day_type === 'no_school'
      ? 'No school'
      : selectedRecord.day_type === 'special'
        ? 'Special schedule'
        : selectedRecord.day_name || 'Timetable day';

  const calendarGrid = (
    <div className="cp-card min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-[130px] text-center text-sm font-bold">{month.format('MMMM YYYY')}</p>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onClick={goToToday}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Today</Button>
          {isStaff && (
            <Button size="sm" onClick={() => setEditing({ date: selectedDate, record: selectedRecord })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Create New
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />Timetable day</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" />No school</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-400" />Special</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Register submitted</span>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName) => <div key={dayName} className="py-1.5">{dayName}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day) => {
          const dateStr = day.format('YYYY-MM-DD');
          const rec = byDate[dateStr];
          const badge = badgeFor(rec);
          const dateSessions = attendanceByDate[dateStr] || [];
          const attendanceState = !dateSessions.length
            ? 'not recorded'
            : dateSessions.some((session) => (session.student_count || 0) < (classCounts[session.class_id] || 0))
              ? 'partially completed'
              : 'completed';
          const outside = !day.isSame(month, 'month');
          const isToday = day.isSame(moment(), 'day');
          const isSelected = selectedDate === dateStr;
          const selectedExams = examinations.some((event) => event.exam_date === dateStr);
          const selectedInvigilation = invigilations.some((event) => event.exam_date === dateStr);
          return (
            <div
              key={dateStr}
              className={`min-h-[58px] border-b border-r border-border/60 p-1 text-left transition sm:min-h-[74px] sm:p-1.5 ${
                outside ? 'bg-muted/20 text-muted-foreground' : 'hover:bg-muted/40'
              } ${isSelected ? 'ring-2 ring-inset ring-primary/60' : ''}`}
            >
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  aria-label={`Select ${day.format('dddd, D MMMM YYYY')}`}
                  aria-pressed={isSelected}
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-semibold hover:bg-primary/10 ${
                    isToday ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
                  }`}
                >
                  {day.date()}
                </button>
                {isStaff && !outside && (
                  <button
                    type="button"
                    onClick={() => setEditing({ date: dateStr, record: rec })}
                    aria-label={`Edit calendar entry for ${day.format('D MMMM YYYY')}`}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
              {!outside && <span className={`mt-1 block truncate rounded px-1 py-0.5 text-[9px] font-semibold sm:text-[10px] ${badge.cls}`}>{badge.label}</span>}
              {!outside && (
                <div className="mt-1 flex items-center gap-1">
                  {attendanceState !== 'not recorded' && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${attendanceState === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      title={`Attendance ${attendanceState}`}
                    />
                  )}
                  {selectedExams && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Examination" />}
                  {selectedInvigilation && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" title="Invigilation" />}
                </div>
              )}
              {!outside && rec?.reason && <span className="mt-0.5 hidden truncate text-[9px] text-muted-foreground sm:block">{rec.reason}</span>}
            </div>
          );
        })}
      </div>
      {loading && <p className="px-3 py-2 text-xs text-muted-foreground">Refreshing calendar data…</p>}
    </div>
  );

  const selectedDayDetails = (
    <section className="cp-card min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="font-heading text-base font-semibold">{moment(selectedDate).format('dddd, D MMMM')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{dayTypeLabel}{selectedRecord?.reason ? ` · ${selectedRecord.reason}` : ''}</p>
        </div>
        <Link to={`/attendance?date=${selectedDate}`} className="text-xs font-semibold text-primary hover:underline">View registers</Link>
      </div>
      <div className="divide-y divide-border/70">
        {selectedRecord?.day_type === 'special' && (selectedRecord.special_periods || []).map((period, index) => (
          <div key={`${period.number}-${index}`} className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-violet-500" />
            <span className="min-w-0 flex-1 truncate">{period.label || `Period ${period.number}`}</span>
            <span className="text-xs text-muted-foreground">{fmtTime(period.start)}{period.end ? `–${fmtTime(period.end)}` : ''}</span>
          </div>
        ))}
        {selectedLessons.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{entry.subject || 'Lesson'} · {entry.class_name || 'Class'}</p>
              <p className="truncate text-[11px] text-muted-foreground">{entry.room || 'Room not set'}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(entry.start_time)}{entry.end_time ? `–${fmtTime(entry.end_time)}` : ''}</span>
          </div>
        ))}
        {selectedExaminations.map((event) => (
          <div key={event.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{event.exam_name} · {event.subject}</p>
              <p className="truncate text-[11px] text-muted-foreground">{event.class_name}{event.room ? ` · ${event.room}` : ''}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(event.start_time)}–{fmtTime(event.end_time)}</span>
          </div>
        ))}
        {selectedInvigilations.map((event) => (
          <div key={event.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <Layers className="h-3.5 w-3.5 shrink-0 text-violet-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{event.exam_name} · {event.subject}</p>
              <p className="truncate text-[11px] text-muted-foreground">{event.role === 'chief' ? 'Chief supervisor' : 'Assistant supervisor'} · {event.room}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(event.start_time)}–{fmtTime(event.end_time)}</span>
          </div>
        ))}
        {selectedAttendance.map((session) => (
          <div key={session.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{session.class_name} · {session.session_label}</p>
              <p className="text-[11px] text-muted-foreground">{session.present_count || 0} present · {session.absent_count || 0} absent · {session.late_count || 0} late</p>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Submitted</span>
          </div>
        ))}
        {!selectedLessons.length && !selectedExaminations.length && !selectedInvigilations.length
          && !selectedAttendance.length && !(selectedRecord?.special_periods || []).length && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {selectedRecord?.day_type === 'no_school'
              ? 'No school is scheduled for this date.'
              : 'No timetable, examination, invigilation or attendance events are scheduled for this date.'}
          </p>
        )}
      </div>
    </section>
  );

  const content = compact ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold">School calendar</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{moment(selectedDate).format('ddd D MMM')} · {dayTypeLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/calendar" className="text-xs font-semibold text-primary hover:underline">Full calendar</Link>
        </div>
      </div>
      <div className="grid min-w-0 gap-3 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">{calendarGrid}</div>
        <div className="min-w-0 xl:col-span-2">{selectedDayDetails}</div>
      </div>
    </div>
  ) : (
    <>
      <PageHeader
        title="School calendar"
        subtitle="Select dates to view school-day schedules, lessons, examinations and attendance"
        actions={
          <div className="flex flex-wrap gap-2">
            {isStaff && <Button size="sm" onClick={() => setEditing({ date: selectedDate, record: selectedRecord })}><Plus className="mr-1.5 h-3.5 w-3.5" />Create New</Button>}
            {isStaff && <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}><Layers className="mr-1.5 h-3.5 w-3.5" />Bulk update</Button>}
          </div>
        }
      />
      {calendarGrid}
      {selectedDayDetails}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        {isStaff ? 'Select a date to view its schedule or create/edit its school-day entry.' : 'Your school administrator maintains the school-day calendar.'}
        {!schoolId && ' No school is currently assigned to this account.'}
      </p>
    </>
  );

  return (
    <>
      {compact ? content : <AppShell title="School calendar">{content}</AppShell>}
      <DateAssignDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        date={editing?.date || ''}
        record={editing?.record}
        days={days}
        onSave={(payload) => upsert(editing.date, payload)}
      />
      {!compact && <BulkCalendarDialog open={bulkOpen} onOpenChange={setBulkOpen} days={days} onApply={applyBulk} />}
    </>
  );
}