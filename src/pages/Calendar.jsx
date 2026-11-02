import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { ChevronLeft, ChevronRight, CalendarDays, Layers, Pencil } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import { DateAssignDialog, BulkCalendarDialog } from '@/components/calendar/CalendarDialogs';
import { Button } from '@/components/ui/button';
import { notifySuccess, notifyError } from '@/lib/notify';

export default function Calendar() {
  const { schoolId, school, member, isStaff } = useSchool();
  const navigate = useNavigate();
  const days = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const [month, setMonth] = useState(moment().startOf('month'));
  const [records, setRecords] = useState([]);
  const [attendanceSessions, setAttendanceSessions] = useState([]);
  const [classCounts, setClassCounts] = useState({});
  const [editing, setEditing] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const start = month.clone().startOf('month').format('YYYY-MM-DD');
  const end = month.clone().endOf('month').format('YYYY-MM-DD');

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [calendarPage, sessionPage, homeroomPage, subjectPage, teacherPage] = await Promise.all([
        base44.entities.CalendarDate.filter({ school_id: schoolId, date: { $gte: start, $lte: end } }, { limit: 200 }),
        base44.entities.AttendanceSession.filter({ school_id: schoolId, date: { $gte: start, $lte: end } }, { limit: 1000 }),
        base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 200 }),
        base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 300 }),
        isStaff || !member ? Promise.resolve({ items: [] })
          : base44.entities.ClassTeacher.filter({ school_id: schoolId, member_id: member.id }, { limit: 300 }),
      ]);
      const availableIds = isStaff ? null : new Set((teacherPage.items || []).map((link) => link.class_id));
      setRecords(calendarPage.items || []);
      setAttendanceSessions((sessionPage.items || []).filter((session) =>
        !availableIds || availableIds.has(session.class_id)));
      setClassCounts(Object.fromEntries([
        ...(homeroomPage.items || []),
        ...(subjectPage.items || []),
      ].map((klass) => [klass.id, klass.student_count || 0])));
    } catch (error) {
      notifyError('Could not load calendar', error.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, start, end, isStaff, member]);

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

  return (
    <AppShell title="School calendar">
      <PageHeader
        title="School calendar"
        subtitle="Assign the timetable day, closures and special schedules to each date"
        actions={isStaff && <Button size="sm" onClick={() => setBulkOpen(true)}><Layers className="mr-1.5 h-3.5 w-3.5" />Bulk update</Button>}
      />

      <div className="cp-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(month.clone().subtract(1, 'month'))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-[150px] text-center text-sm font-bold">{month.format('MMMM YYYY')}</p>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(month.clone().add(1, 'month'))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />Timetable day</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" />No school</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-400" />Special</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Complete</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Partial</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />Not recorded</span>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
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
            return (
              <div
                key={dateStr}
                className={`min-h-[74px] border-b border-r border-border/60 p-1.5 text-left transition last:border-r-0 ${outside ? 'bg-muted/20 text-muted-foreground' : 'hover:bg-muted/40'}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/attendance?date=${dateStr}`)}
                    aria-label={`Take attendance for ${day.format('dddd, D MMMM YYYY')}`}
                    className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-semibold hover:bg-primary/10 ${isToday ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`}
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
                {!outside && (
                  <span className={`mt-1 block truncate rounded px-1 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                )}
                {!outside && (
                  <span
                    className={`mt-1 inline-block h-2 w-2 rounded-full align-middle ${
                      attendanceState === 'completed' ? 'bg-emerald-500'
                        : attendanceState === 'partially completed' ? 'bg-amber-500' : 'bg-muted-foreground/50'
                    }`}
                    title={`Attendance ${attendanceState}`}
                    aria-label={`Attendance ${attendanceState}`}
                  />
                )}
                {!outside && rec?.reason && <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{rec.reason}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        {isStaff ? 'Select a date to open its attendance registers. Use the edit icon to change its calendar schedule.' : 'Select any date to open attendance registers. Your school administrator maintains the calendar schedule.'}
        {loading && ' Refreshing…'}
      </p>

      <DateAssignDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        date={editing?.date || ''}
        record={editing?.record}
        days={days}
        onSave={(payload) => upsert(editing.date, payload)}
      />
      <BulkCalendarDialog open={bulkOpen} onOpenChange={setBulkOpen} days={days} onApply={applyBulk} />
    </AppShell>
  );
}