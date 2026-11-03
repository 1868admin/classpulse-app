import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import moment from 'moment';
import { ClipboardCheck, CalendarDays, CheckCircle2, AlertCircle, Users, Upload, CheckCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EmptyState from '@/components/ui-bits/EmptyState';
import ClassOrderControls from '@/components/ui-bits/ClassOrderControls';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import AttendanceImportDialog from '@/components/attendance/AttendanceImportDialog';
import BulkMarkDialog from '@/components/attendance/BulkMarkDialog';
import { fmtDate } from '@/lib/dates';
import useOrderedItems from '@/hooks/useOrderedItems';

const attendanceClassKey = (item) => `${item.type}|${item.classId}`;
const getOrderItemKey = (item) => item.key;

export default function Attendance() {
  const [importOpen, setImportOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const { schoolId, school, member, isStaff } = useSchool();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get('date') || moment().format('YYYY-MM-DD'));
  const selectedClass = params.get('class') || '';
  const [calendar, setCalendar] = useState(null);
  const [links, setLinks] = useState([]);
  const [homerooms, setHomerooms] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!schoolId || !member) return;
    setLoading(true);
    const [cal, ct, hr, sc, tt, ses, staffRes] = await Promise.all([
      base44.entities.CalendarDate.filter({ school_id: schoolId, date }, { limit: 1 }),
      base44.entities.ClassTeacher.filter({ school_id: schoolId, is_active: { $ne: false }, ...(isStaff ? {} : { member_id: member.id }) }, { limit: 300 }),
      base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 100, sort: 'name' }),
      base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 200, sort: 'name' }),
      base44.entities.TimetableEntry.filter({ school_id: schoolId, archived: false, ...(isStaff ? {} : { member_id: member.id }) }, { limit: 300 }),
      base44.entities.AttendanceSession.filter({ school_id: schoolId, date }, { limit: 300 }),
      base44.entities.SchoolMember.filter({ school_id: schoolId, status: { $ne: 'inactive' } }, { limit: 200 }),
    ]);
    setCalendar((cal.items || [])[0] || null);
    setLinks(ct.items || []);
    setHomerooms(hr.items || []);
    setSubjects(sc.items || []);
    setEntries(tt.items || []);
    setSessions(ses.items || []);
    setStaff(staffRes.items || []);
    setLoading(false);
  }, [schoolId, member, date, isStaff]);

  useEffect(() => { load(); }, [load]);

  const dayName = calendar?.day_name || '';
  const noSchool = calendar?.day_type === 'no_school';

  const rows = useMemo(() => {
    const myHomeroomIds = isStaff ? null : new Set(links.filter((l) => l.class_type === 'homeroom').map((l) => l.class_id));
    const mySubjectIds = isStaff ? null : new Set(links.filter((l) => l.class_type === 'subject').map((l) => l.class_id));
    const out = [];

    homerooms
      .filter((h) => !myHomeroomIds || myHomeroomIds.has(h.id))
      .filter((h) => !selectedClass || selectedClass === h.id)
      .forEach((h) => {
        ['Morning', 'Afternoon'].forEach((label) => {
          const session = sessions.find((s) => s.class_id === h.id && s.session_label === label);
          const teachers = links.filter((l) => l.class_id === h.id).map((l) => l.member_name);
          out.push({
            key: `${h.id}-${label}`, classId: h.id, className: h.name, type: 'homeroom',
            label, period: '', subject: '', teachers, session,
          });
        });
      });

    const scheduled = entries
      .filter((entry) => entry.day_name && entry.day_name === dayName && entry.subject_class_id)
      .filter((entry) => !selectedClass || selectedClass === entry.subject_class_id)
      .filter((entry) => !mySubjectIds || mySubjectIds.has(entry.subject_class_id));
    const scheduledClassIds = new Set(scheduled.map((entry) => entry.subject_class_id));
    const entryGroups = new Map();
    for (const entry of scheduled) {
      const key = `${entry.member_id}|${entry.subject_class_id}|${entry.subject || ''}`;
      const group = entryGroups.get(key) || [];
      group.push(entry);
      entryGroups.set(key, group);
    }
    for (const group of entryGroups.values()) {
      const periods = [...new Map(group
        .toSorted((left, right) => Number(left.period_number) - Number(right.period_number))
        .map((entry) => [Number(entry.period_number), entry])).values()];
      for (let index = 0; index < periods.length; index += 1) {
        const current = periods[index];
        const next = periods[index + 1];
        const currentPeriod = Number(current.period_number);
        const isDouble = next && Number(next.period_number) === currentPeriod + 1;
        const periodNumbers = isDouble ? [currentPeriod, Number(next.period_number)] : [currentPeriod];
        if (isDouble) index += 1;
        const cls = subjects.find((subjectClass) => subjectClass.id === current.subject_class_id);
        if (!cls) continue;
        const label = isDouble ? `Periods ${periodNumbers.join(' + ')}` : `Period ${currentPeriod}`;
        const session = sessions.find((item) => {
          if (item.class_id !== cls.id) return false;
          const savedPeriods = Array.isArray(item.period_numbers) && item.period_numbers.length
            ? item.period_numbers.map(Number)
            : [Number(item.period_number)].filter(Boolean);
          return item.session_label === label || periodNumbers.some((period) => savedPeriods.includes(period));
        });
        const teachers = [...new Set(links.filter((link) => link.class_id === cls.id).map((link) => link.member_name))];
        out.push({
          key: `${cls.id}-${current.member_id}-${periodNumbers.join('-')}`,
          classId: cls.id,
          className: cls.name,
          type: 'subject',
          label,
          period: currentPeriod,
          periods: periodNumbers,
          subject: cls.subject,
          teachers,
          session,
          time: current.start_time,
        });
      }
    }

    const availableSubjectIds = isStaff
      ? subjects.map((subjectClass) => subjectClass.id)
      : [...(mySubjectIds || [])];
    for (const classId of availableSubjectIds) {
      if (selectedClass && selectedClass !== classId) continue;
      if (scheduledClassIds.has(classId)) continue;
      const cls = subjects.find((subjectClass) => subjectClass.id === classId);
      if (!cls) continue;
      const label = 'Class session';
      out.push({
        key: `${classId}-manual`,
        classId,
        className: cls.name,
        type: 'subject',
        label,
        period: '',
        periods: [],
        subject: cls.subject,
        teachers: links.filter((link) => link.class_id === cls.id).map((link) => link.member_name),
        session: sessions.find((item) => item.class_id === cls.id && item.session_label === label),
      });
    }

    return out;
  }, [homerooms, entries, dayName, links, sessions, subjects, isStaff, selectedClass]);

  const attendanceClasses = useMemo(() => [
    ...new Map(rows.map((row) => {
      const key = attendanceClassKey(row);
      return [key, { key, name: row.className }];
    })).values(),
  ], [rows]);
  const {
    items: orderedAttendanceClasses,
    moveItem: moveAttendanceClass,
  } = useOrderedItems(
    attendanceClasses,
    `classpulse:class-order:${schoolId}:${member?.id}:attendance`,
    getOrderItemKey,
  );
  const orderedRows = useMemo(() => {
    const positions = new Map(orderedAttendanceClasses.map((item, index) => [item.key, index]));
    return [...rows].sort((left, right) =>
      positions.get(attendanceClassKey(left)) - positions.get(attendanceClassKey(right)));
  }, [rows, orderedAttendanceClasses]);
  const orderControlRows = useMemo(() => {
    const seen = new Set();
    return new Set(rows.filter((row) => {
      const key = attendanceClassKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((row) => row.key));
  }, [rows]);
  const orderControls = (row) => {
    const key = attendanceClassKey(row);
    const index = orderedAttendanceClasses.findIndex((item) => item.key === key);
    return (
      <ClassOrderControls
        label={row.className}
        canMoveUp={index > 0}
        canMoveDown={index >= 0 && index < orderedAttendanceClasses.length - 1}
        onMove={(direction) => moveAttendanceClass(key, direction)}
      />
    );
  };

  const submitted = rows.filter((r) => r.session).length;
  const pending = rows.length - submitted;
  const totals = sessions.reduce((acc, s) => {
    acc.students += s.student_count || 0;
    acc.present += s.present_count || 0;
    acc.absent += s.absent_count || 0;
    acc.late += s.late_count || 0;
    return acc;
  }, { students: 0, present: 0, absent: 0, late: 0 });
  const rate = totals.students ? Math.round(((totals.present + totals.late) / totals.students) * 100) : 0;
  const memberName = (id) => staff.find((s) => s.id === id)?.full_name || '';

  return (
    <AppShell title="Attendance">
      <PageHeader
        title="Attendance centre"
        subtitle={`${fmtDate(date)} · ${noSchool ? 'No school' : dayName || 'No timetable day assigned'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={date} onChange={(e) => {
              setDate(e.target.value);
              setParams((current) => {
                current.set('date', e.target.value);
                return current;
              }, { replace: true });
            }} className="w-full sm:w-auto" />
            <Button variant="outline" size="sm" onClick={() => {
              const today = moment().format('YYYY-MM-DD');
              setDate(today);
              setParams((current) => {
                current.set('date', today);
                return current;
              }, { replace: true });
            }}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => setMarkOpen(true)}><CheckCheck className="mr-1.5 h-3.5 w-3.5" />Bulk mark</Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="mr-1.5 h-3.5 w-3.5" />Bulk import</Button>
            {selectedClass && <Button variant="outline" size="sm" onClick={() => {
              setParams((current) => {
                current.delete('class');
                current.delete('type');
                return current;
              }, { replace: true });
            }}>Change class</Button>}
          </div>
        }
      />

      {noSchool && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          This date is marked <strong>No school</strong>{calendar?.reason ? ` (${calendar.reason})` : ''}. Authorised teachers may still record attendance for the selected date.
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Attendance', value: `${rate}%`, icon: ClipboardCheck },
          { label: 'Registers submitted', value: `${submitted}/${rows.length}`, icon: CheckCircle2 },
          { label: 'Outstanding', value: pending, icon: AlertCircle },
          { label: 'Present today', value: totals.present, icon: Users },
        ].map((s) => (
          <div key={s.label} className="cp-card flex items-center gap-3 p-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="h-4 w-4" /></span>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold leading-tight">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState
          icon={CalendarDays}
          title="No registers expected for this date"
          description="No authorised classes are available for this date. Use the date selector to choose another date, or ask an administrator to assign you to a class."
        />
      ) : (
        <div className="cp-card overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-bold">Registers for {moment(date).format('ddd D MMM')}</h2>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="cp-table-head">
                <tr>
                  <th className="px-4 py-2">Class</th>
                  <th className="px-4 py-2">Session</th>
                  <th className="px-4 py-2">Teacher</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="w-28 px-4 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {orderedRows.map((r) => (
                  <tr key={r.key} className="border-t border-border/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{r.className}</p>
                          <p className="text-[11px] text-muted-foreground capitalize">{r.type}{r.subject ? ` · ${r.subject}` : ''}</p>
                        </div>
                        {orderControlRows.has(r.key) && orderControls(r)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">{r.label}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {r.session ? memberName(r.session.member_id) : r.teachers.join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.session ? (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />Submitted
                          </span>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {r.session.present_count} present · {r.session.absent_count} absent · {moment(r.session.submitted_at).format('h:mm a')}
                          </p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          <AlertCircle className="h-3 w-3" />Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        to={`/attendance/register?class=${r.classId}&type=${r.type}&label=${encodeURIComponent(r.label)}&date=${date}${r.period ? `&period=${r.period}` : ''}${r.periods?.length > 1 ? `&periods=${r.periods.join(',')}` : ''}`}
                        className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${r.session ? 'border border-border text-foreground hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
                      >
                        {r.session ? 'Review' : 'Take register'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {orderedRows.map((row) => (
              <article key={row.key} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold">{row.className}</h3>
                    <p className="text-xs text-muted-foreground capitalize">{row.type}{row.subject ? ` · ${row.subject}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {orderControlRows.has(row.key) && orderControls(row)}
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{row.label}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Teacher: {row.session ? memberName(row.session.member_id) : row.teachers.join(', ') || '—'}</p>
                <div className="flex items-center justify-between gap-2">
                  {row.session ? (
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Submitted · {row.session.present_count} present · {row.session.absent_count} absent
                    </span>
                  ) : <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Not recorded</span>}
                  <Link
                    to={`/attendance/register?class=${row.classId}&type=${row.type}&label=${encodeURIComponent(row.label)}&date=${date}${row.period ? `&period=${row.period}` : ''}${row.periods?.length > 1 ? `&periods=${row.periods.join(',')}` : ''}`}
                    className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    {row.session ? 'Review' : 'Take register'}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="cp-card mt-4 overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-bold">Registers submitted on this date</h2>
          </div>
          <div className="cp-scroll-x">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="cp-table-head">
                <tr>
                  <th className="px-4 py-2">Class</th>
                  <th className="px-4 py-2">Session</th>
                  <th className="px-4 py-2">Teacher</th>
                  <th className="px-4 py-2">Present</th>
                  <th className="px-4 py-2">Absent</th>
                  <th className="px-4 py-2">Late</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-border/60">
                    <td className="px-4 py-2">{s.class_name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{s.session_label}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{memberName(s.member_id) || s.member_name}</td>
                    <td className="px-4 py-2 font-semibold text-emerald-600">{s.present_count}</td>
                    <td className="px-4 py-2 font-semibold text-red-600">{s.absent_count}</td>
                    <td className="px-4 py-2 font-semibold text-amber-600">{s.late_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <AttendanceImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />
      <BulkMarkDialog open={markOpen} onOpenChange={setMarkOpen} onSaved={load} />
    </AppShell>
  );
}