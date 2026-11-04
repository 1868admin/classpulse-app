import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import moment from 'moment';
import { ArrowLeft, ArrowRight, Download, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { buttonVariants } from '@/components/ui/button';
import { notifyError, notifySuccess } from '@/lib/notify';
import { STATUS_STYLES } from '@/lib/dates';
import { downloadWorkbookBuffer } from '@/lib/spreadsheet';
import { buildAttendanceWorkbook } from '@/lib/attendanceWorkbook';

const STATUS_CODES = { present: 'P', absent: 'A', late: 'L', excused: 'E' };
const STATUS_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' };

async function fetchAllPages(entity, query) {
  const items = [];
  let cursor;
  for (let page = 0; page < 100; page += 1) {
    const result = await base44.entities[entity].filter(query, { limit: 1000, ...(cursor ? { cursor } : {}) });
    items.push(...(result.items || []));
    cursor = result.next_cursor;
    if (!cursor) return items;
  }
  throw new Error('The register contains too many records to load safely. Narrow the date range and try again.');
}

function periodNumbers(session) {
  return Array.isArray(session.period_numbers) && session.period_numbers.length
    ? session.period_numbers.map(Number)
    : [Number(session.period_number)].filter(Boolean);
}

function cellKey(studentId, date) {
  return `${studentId}|${date}`;
}

function isNonSchoolDay(date, calendars) {
  return [0, 6].includes(moment(date).day()) || calendars.get(date)?.day_type === 'no_school';
}

export default function AttendanceSheetView({
  schoolId,
  classId,
  classType,
  className,
  subject,
  label,
  period,
  periods = [],
  date,
  month,
  setMonth,
  members,
  schoolName,
  academicYear,
  teacherName,
  termName,
  saveCell,
}) {
  const [cells, setCells] = useState({});
  const [calendars, setCalendars] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [activeCell, setActiveCell] = useState('');
  const [savingCell, setSavingCell] = useState('');
  const loadRequestRef = useRef(0);

  const monthStart = moment(`${month}-01`).format('YYYY-MM-DD');
  const monthEnd = moment(`${month}-01`).endOf('month').format('YYYY-MM-DD');
  const periodKey = periods.join(',');
  const days = useMemo(() => Array.from(
    { length: moment(`${month}-01`).daysInMonth() },
    (_, index) => moment(`${month}-01`).add(index, 'days').format('YYYY-MM-DD'),
  ), [month]);

  const load = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (!schoolId || !classId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const [sessionRows, calendarRows] = await Promise.all([
        fetchAllPages('AttendanceSession', {
          school_id: schoolId,
          class_type: classType,
          class_id: classId,
          date: { $gte: monthStart, $lte: monthEnd },
        }),
        fetchAllPages('CalendarDate', {
          school_id: schoolId,
          date: { $gte: monthStart, $lte: monthEnd },
        }),
      ]);
      const selectedPeriods = [...new Set([...periodKey.split(',').map(Number), Number(period)]
        .filter((value) => Number(value) > 0))];
      const sessions = sessionRows.filter((session) => session.session_label === label
        || (classType === 'subject' && selectedPeriods.some((value) => periodNumbers(session).includes(value))));
      const sessionById = new Map(sessions.map((session) => [session.id, session]));
      const records = sessions.length
        ? await fetchAllPages('AttendanceRecord', {
          school_id: schoolId,
          class_id: classId,
          date: { $gte: monthStart, $lte: monthEnd },
          session_id: { $in: sessions.map((session) => session.id) },
        })
        : [];
      const next = {};
      records.forEach((record) => {
        const key = cellKey(record.student_id, record.date);
        const current = next[key];
        const session = sessionById.get(record.session_id);
        const currentSession = current && sessionById.get(current.session_id);
        if (!current || (session?.session_label === label && currentSession?.session_label !== label)) {
          next[key] = { ...record };
        }
      });
      if (loadRequestRef.current === requestId) {
        setCells(next);
        setCalendars(new Map(calendarRows.map((calendar) => [calendar.date, calendar])));
      }
    } catch (error) {
      if (loadRequestRef.current === requestId) {
        setLoadError(error.message || 'Attendance records could not be loaded.');
        notifyError('Could not load monthly attendance', error.message);
      }
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false);
    }
  }, [schoolId, classId, classType, label, period, periodKey, monthStart, monthEnd]);

  useEffect(() => {
    load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);

  const totals = useMemo(() => {
    const result = new Map();
    members.forEach((student) => {
      const summary = { present: 0, absent: 0, late: 0, excused: 0, marked: 0 };
      days.forEach((day) => {
        const status = cells[cellKey(student.student_id, day)]?.status;
        if (!Object.hasOwn(summary, status)) return;
        summary[status] += 1;
        summary.marked += 1;
      });
      result.set(student.student_id, summary);
    });
    return result;
  }, [members, days, cells]);

  const changeCell = async (student, day, status) => {
    const key = cellKey(student.student_id, day);
    const previous = cells[key];
    const clear = status === 'clear';
    const pending = clear ? null : {
      ...previous,
      student_id: student.student_id,
      student_name: student.student_name || '',
      student_id_no: student.student_id_no || '',
      class_id: classId,
      class_type: classType,
      date: day,
      status,
    };
    setCells((current) => {
      const next = { ...current };
      if (clear) delete next[key];
      else next[key] = pending;
      return next;
    });
    setActiveCell('');
    setSavingCell(key);
    try {
      const calendar = calendars.get(day);
      const result = await saveCell({
        student,
        day,
        status,
        clear,
        dayName: calendar?.day_name || moment(day).format('dddd'),
        note: previous?.note || '',
      });
      if (!result) {
        setCells((current) => {
          const next = { ...current };
          if (previous) next[key] = previous;
          else delete next[key];
          return next;
        });
        return;
      }
      const savedSession = result.session;
      setCells((current) => {
        if (clear) return current;
        return { ...current, [key]: { ...current[key], session_id: savedSession?.id } };
      });
    } catch (error) {
      setCells((current) => {
        const next = { ...current };
        if (previous) next[key] = previous;
        else delete next[key];
        return next;
      });
      notifyError('Could not save attendance', error.message);
    } finally {
      setSavingCell('');
    }
  };

  const exportWorkbook = async () => {
    setExporting(true);
    try {
      const { filename, buffer } = await buildAttendanceWorkbook({
        schoolName,
        academicYear,
        className,
        classType,
        subject,
        teacherName,
        termName,
        label,
        month,
        days,
        members,
        cells,
        totals,
        calendars,
      });
      await downloadWorkbookBuffer(filename, buffer);
      notifySuccess('Register exported', 'The Excel workbook is ready to download.');
    } catch (error) {
      notifyError('Could not export register', error.message);
    } finally {
      setExporting(false);
    }
  };

  const monthTitle = moment(`${month}-01`).format('MMMM YYYY');

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold">Monthly roll matrix</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{monthTitle} · {members.length} enrolled students</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous month" className={buttonVariants({ variant: 'outline', size: 'icon' })} onClick={() => setMonth(moment(`${month}-01`).subtract(1, 'month').format('YYYY-MM'))}>
            <ArrowLeft />
          </button>
          <input
            type="month"
            value={month}
            aria-label="Attendance month"
            onChange={(event) => setMonth(event.target.value)}
            className="h-9 min-w-36 rounded-md border border-input bg-background px-2 text-sm"
          />
          <button type="button" aria-label="Next month" className={buttonVariants({ variant: 'outline', size: 'icon' })} onClick={() => setMonth(moment(`${month}-01`).add(1, 'month').format('YYYY-MM'))}>
            <ArrowRight />
          </button>
          <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => setMonth(moment().format('YYYY-MM'))}>This month</button>
          <button type="button" className={buttonVariants({ size: 'sm' })} onClick={exportWorkbook} disabled={loading || exporting}>
            <Download className="h-4 w-4" />{exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
      </div>

      {loadError && !loading ? (
        <div role="alert" className="cp-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span className="text-destructive">{loadError}</span>
          <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={load}>Retry loading</button>
        </div>
      ) : loading ? (
        <div className="cp-card flex items-center gap-2 p-6 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Loading attendance records…</div>
      ) : (
        <div className="cp-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="cp-table-head">
                  <th className="sticky left-0 z-30 min-w-12 border-b border-border bg-card px-2 py-2 text-center">No.</th>
                  <th className="sticky left-12 z-30 min-w-48 border-b border-border bg-card px-3 py-2 text-left">Student name</th>
                  <th className="min-w-24 border-b border-border bg-card px-2 py-2 text-left">Student ID</th>
                  {days.map((day) => (
                    <th key={day} title={calendars.get(day)?.reason || ''} className={`min-w-[4.25rem] border-b border-border px-1 py-2 text-center ${isNonSchoolDay(day, calendars) ? 'bg-muted text-muted-foreground' : 'bg-card'}`}>
                      <span className="block font-medium">{moment(day).format('ddd')}</span>
                      <span className="block text-[11px]">{moment(day).format('D MMM')}</span>
                    </th>
                  ))}
                  {[
                    ['P', 'Present'],
                    ['A', 'Absent (unexcused)'],
                    ['L', 'Late'],
                    ['E', 'Excused'],
                    ['Total', 'Total marked days'],
                  ].map(([heading, description]) => (
                    <th key={heading} title={description} aria-label={description} className="min-w-[4.25rem] border-b border-border bg-muted px-2 py-2 text-center">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((student, index) => {
                  const summary = totals.get(student.student_id);
                  return (
                    <tr key={student.id} className="hover:bg-muted/30">
                      <td className="sticky left-0 z-20 border-b border-border/60 bg-card px-2 py-1 text-center text-muted-foreground">{index + 1}</td>
                      <td className="sticky left-12 z-20 border-b border-border/60 bg-card px-3 py-1 font-medium">{student.student_name || 'Unnamed student'}</td>
                      <td className="border-b border-border/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">{student.student_id_no || '—'}</td>
                      {days.map((day) => {
                        const key = cellKey(student.student_id, day);
                        const record = cells[key];
                        const isActive = activeCell === key;
                        const unavailable = isNonSchoolDay(day, calendars);
                        return (
                          <td key={day} className={`relative border-b border-border/60 px-1 py-1 text-center ${unavailable ? 'bg-muted/50' : ''}`}>
                            {isActive ? (
                              <select
                                autoFocus
                                aria-label={`Attendance for ${student.student_name} on ${moment(day).format('D MMMM YYYY')}`}
                                value={record?.status || ''}
                                disabled={savingCell === key}
                                onBlur={() => setActiveCell('')}
                                onChange={(event) => changeCell(student, day, event.target.value)}
                                className="h-11 min-w-14 rounded-md border border-primary bg-background px-1 text-xs"
                              >
                                <option value="" disabled>Mark…</option>
                                {Object.entries(STATUS_LABELS).map(([status, name]) => (
                                  <option key={status} value={status}>{STATUS_CODES[status]} · {name}</option>
                                ))}
                                {record && <option value="clear">Clear status</option>}
                              </select>
                            ) : (
                              <button
                                type="button"
                                disabled={Boolean(savingCell)}
                                title={`${moment(day).format('ddd D MMM')}${unavailable ? ' · Non-school day' : ''}${record ? ` · ${STATUS_LABELS[record.status]}` : ' · Not marked'}`}
                                aria-label={`${student.student_name}, ${moment(day).format('D MMM')}, ${record ? STATUS_LABELS[record.status] : 'not marked'}`}
                                onClick={() => setActiveCell(key)}
                                className={`min-h-11 min-w-12 rounded-md border border-transparent px-2 font-bold transition hover:border-border ${record ? STATUS_STYLES[record.status] : unavailable ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
                              >
                                {STATUS_CODES[record?.status] || '—'}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="border-b border-border/60 px-2 py-1 text-center font-semibold text-emerald-700 dark:text-emerald-300">{summary.present}</td>
                      <td className="border-b border-border/60 px-2 py-1 text-center font-semibold text-red-700 dark:text-red-300">{summary.absent}</td>
                      <td className="border-b border-border/60 px-2 py-1 text-center font-semibold text-amber-700 dark:text-amber-300">{summary.late}</td>
                      <td className="border-b border-border/60 px-2 py-1 text-center font-semibold text-blue-700 dark:text-blue-300">{summary.excused}</td>
                      <td className="border-b border-border/60 px-2 py-1 text-center font-bold">{summary.marked}</td>
                    </tr>
                  );
                })}
                {!members.length && (
                  <tr><td colSpan={days.length + 8} className="p-8 text-center text-sm text-muted-foreground">No students are enrolled in this class.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            P Present · A Absent (unexcused) · L Late · E Excused · Blank Not marked · Shaded dates are weekends or No School. Select a cell to update or clear it.
          </div>
        </div>
      )}
    </section>
  );
}
