import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCheck, Search, CheckCircle2, Printer, Table2, UserRoundCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notifyError } from '@/lib/notify';
import { ATTENDANCE_STATUSES, fmtDate } from '@/lib/dates';
import AttendanceSheetView from '@/components/attendance/AttendanceSheetView';
import moment from 'moment';

const statusBtn = {
  present: 'bg-emerald-600 text-white',
  late: 'bg-amber-500 text-white',
  absent: 'bg-red-600 text-white',
  excused: 'bg-blue-600 text-white',
};

export default function AttendanceRegister() {
  const [params, setParams] = useSearchParams();
  const classId = params.get('class');
  const type = params.get('type') || 'homeroom';
  const routeLabel = params.get('label') || 'Morning';
  const date = params.get('date') || moment().format('YYYY-MM-DD');
  const period = params.get('period') || '';
  const requestedPeriods = (params.get('periods') || '')
    .split(',')
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  const label = requestedPeriods.length > 1
    ? `Periods ${[...new Set(requestedPeriods)].sort((a, b) => a - b).join(' + ')}`
    : routeLabel;

  const { schoolId, member, school, isStaff } = useSchool();
  const [klass, setKlass] = useState(null);
  const [members, setMembers] = useState([]);
  const [studentProfiles, setStudentProfiles] = useState([]);
  const [marks, setMarks] = useState({});
  const [notes, setNotes] = useState({});
  const [session, setSession] = useState(null);
  const [terms, setTerms] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [classOptions, setClassOptions] = useState([]);
  const [classLinks, setClassLinks] = useState([]);
  const [calendar, setCalendar] = useState(null);
  const [term, setTerm] = useState('');
  const [view, setView] = useState('daily');
  const [classFilter, setClassFilter] = useState('all');
  const [month, setMonth] = useState(moment(date).format('YYYY-MM'));
  const [saveStatus, setSaveStatus] = useState('saved');
  const [saveError, setSaveError] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [genderFilter, setGenderFilter] = useState('all');
  const [yearGroupFilter, setYearGroupFilter] = useState('all');
  const [homeroomFilter, setHomeroomFilter] = useState('all');
  const [academicYearFilter, setAcademicYearFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [manualPeriods, setManualPeriods] = useState(params.get('periods') || (period ? String(period) : ''));
  const saveQueueRef = useRef(Promise.resolve());
  const loadRequestRef = useRef(0);
  const pendingWritesRef = useRef(0);
  const failedWritesRef = useRef(new Map());
  const marksRef = useRef({});
  const notesRef = useRef({});
  const currentContextRef = useRef('');
  currentContextRef.current = `${type}|${classId}|${date}|${label}`;

  const load = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (!schoolId || !classId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    const entity = type === 'subject' ? 'SubjectClass' : 'HomeroomClass';
    try {
      const [cls, mem, ses, cal, links, homerooms, subjects, years, termRows] = await Promise.all([
        base44.entities[entity].get(classId),
        base44.entities.ClassMembership.filter({ school_id: schoolId, class_type: type, class_id: classId }, { limit: 1000, sort: 'student_name' }),
        base44.entities.AttendanceSession.filter({ school_id: schoolId, class_type: type, class_id: classId, date }, { limit: 100 }),
        base44.entities.CalendarDate.filter({ school_id: schoolId, date }, { limit: 1 }),
        base44.entities.ClassTeacher.filter({
          school_id: schoolId,
          is_active: { $ne: false },
          ...(isStaff ? {} : { member_id: member?.id }),
        }, { limit: 1000 }),
        base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 1000, sort: 'name' }),
        base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 1000, sort: 'name' }),
        base44.entities.AcademicYear.filter({ school_id: schoolId }, { limit: 100 }),
        base44.entities.Term.filter({ school_id: schoolId }, { limit: 100 }),
      ]);
      if (loadRequestRef.current !== requestId) return;
      const assigned = links.items || [];
      const assignedKeys = new Set(assigned.map((item) => `${item.class_type || 'homeroom'}|${item.class_id}`));
      const options = [
        ...(homerooms.items || []).map((item) => ({ ...item, type: 'homeroom' })),
        ...(subjects.items || []).map((item) => ({ ...item, type: 'subject' })),
      ].filter((item) => isStaff || assignedKeys.has(`${item.type}|${item.id}`))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      const list = mem.items || [];
      const profiles = list.length
        ? await base44.entities.Student.filter({
          school_id: schoolId,
          id: { $in: list.map((item) => item.student_id) },
        }, { limit: 1000 })
        : { items: [] };
      const existing = (ses.items || []).find((item) => {
        if (item.session_label === label) return true;
        const savedPeriods = Array.isArray(item.period_numbers) && item.period_numbers.length
          ? item.period_numbers.map(Number)
          : [Number(item.period_number)].filter(Boolean);
        return requestedPeriods.some((value) => savedPeriods.includes(value));
      }) || null;
      setSession(existing);
      const nextMarks = {};
      const nextNotes = {};
      if (existing) {
        const recs = await base44.entities.AttendanceRecord.filter(
          { school_id: schoolId, session_id: existing.id },
          { limit: 1000 },
        );
        (recs.items || []).forEach((record) => {
          nextMarks[record.student_id] = record.status;
          nextNotes[record.student_id] = record.note || '';
        });
      }
      if (loadRequestRef.current !== requestId) return;
      setClassLinks(assigned);
      setClassOptions(options);
      setKlass(cls);
      setTerms(termRows.items || []);
      setAcademicYears(years.items || []);
      setCalendar((cal.items || [])[0] || null);
      setMembers(list);
      setStudentProfiles(profiles.items || []);
      setMarks(nextMarks);
      setNotes(nextNotes);
      marksRef.current = nextMarks;
      notesRef.current = nextNotes;
      setManualPeriods(params.get('periods') || (period ? String(period) : ''));
      setSaveStatus('saved');
      setSaveError('');
    } catch (error) {
      if (loadRequestRef.current === requestId) {
        setLoadError(error.message || 'Attendance register could not be loaded.');
        notifyError('Could not load attendance register', error.message);
      }
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false);
    }
  }, [schoolId, classId, type, date, label, params, period, requestedPeriods.join(','), isStaff, member?.id]);

  useEffect(() => {
    load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);
  useEffect(() => {
    if (type !== 'homeroom' || klass?.id !== classId) return;
    const allowedLabels = klass.attendance_period === 'morning'
      ? ['Morning']
      : klass.attendance_period === 'afternoon'
        ? ['Afternoon']
        : ['Morning', 'Afternoon'];
    if (!allowedLabels.includes(routeLabel)) {
      setParams((current) => {
        current.set('label', allowedLabels[0]);
        return current;
      }, { replace: true });
    }
  }, [type, klass, classId, routeLabel, setParams]);
  useEffect(() => { setMonth(moment(date).format('YYYY-MM')); }, [date]);

  useEffect(() => {
    const warnBeforeUnload = (event) => {
      if (saveStatus === 'saved') return;
      event.preventDefault();
      event.returnValue = '';
    };
    const warnBeforeNavigation = (event) => {
      if (saveStatus === 'saved') return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href]');
      if (!link || link.target || link.origin !== window.location.origin) return;
      if (!window.confirm('Attendance changes are still saving or need retrying. Leave this register?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', warnBeforeNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', warnBeforeNavigation, true);
    };
  }, [saveStatus]);

  const saveRecords = useCallback((records, options = {}) => {
    if (!records.length) return Promise.resolve(null);
    const targetDate = options.date || date;
    const targetLabel = options.label || label;
    const periods = [...new Set(manualPeriods.split(/[,\s+]+/).map(Number)
      .filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
    const sessionLabel = periods.length > 1 ? `Periods ${periods.join(' + ')}` : targetLabel;
    const payload = {
      class_type: type,
      class_id: classId,
      class_name: klass?.name || '',
      subject: klass?.subject || '',
      date: targetDate,
      day_name: options.dayName ?? (targetDate === date ? calendar?.day_name || '' : ''),
      period_number: periods[0] || Number(period) || 0,
      period_numbers: periods,
      session_label: sessionLabel,
      records,
    };
    const writeKeys = records.map((record) => `${targetDate}|${sessionLabel}|${record.student_id}`);
    const task = saveQueueRef.current.catch(() => null).then(async () => {
      const result = await base44.functions.invoke('submitAttendance', payload);
      if (result.data?.error) throw new Error(result.data.error);
      writeKeys.forEach((key) => failedWritesRef.current.delete(key));
      if (currentContextRef.current === `${type}|${classId}|${targetDate}|${sessionLabel}`) setSession(result.data.session);
      setSaveError('');
      return result.data;
    });
    pendingWritesRef.current += 1;
    setSaveStatus('saving');
    setSaveError('');
    records.forEach((record, index) => {
      failedWritesRef.current.set(writeKeys[index], { payload, record });
    });
    saveQueueRef.current = task;
    return task.catch((error) => {
      setSaveError(error.response?.data?.error || error.message || 'Attendance could not be saved.');
      notifyError('Could not save attendance', error.response?.data?.error || error.message);
      return null;
    }).finally(() => {
      pendingWritesRef.current -= 1;
      setSaveStatus(pendingWritesRef.current ? 'saving' : failedWritesRef.current.size ? 'error' : 'saved');
    });
  }, [manualPeriods, label, type, classId, klass, date, calendar, period]);

  const saveSheetCell = async ({ student, day, status, clear, dayName, note }) => {
    const result = await saveRecords([{
      student_id: student.student_id,
      student_name: student.student_name || '',
      student_id_no: student.student_id_no || '',
      ...(clear ? { clear: true } : {
        status,
        note: note || '',
      }),
    }], { date: day, label, dayName });
    if (result) {
      handleCellSaved({
        date: day,
        studentId: student.student_id,
        status: clear ? '' : status,
        session: result.session,
      });
    }
    return result;
  };

  const setStatus = (student, status) => {
    const next = { ...marksRef.current, [student.student_id]: status };
    marksRef.current = next;
    setMarks(next);
    saveRecords([{
      student_id: student.student_id,
      student_name: student.student_name || '',
      student_id_no: student.student_id_no || '',
      status,
      note: notesRef.current[student.student_id] || '',
    }]);
  };

  const markUnmarkedPresent = () => {
    const unmarked = members.filter((student) => !marksRef.current[student.student_id]);
    if (!unmarked.length) return;
    const next = { ...marksRef.current };
    unmarked.forEach((student) => { next[student.student_id] = 'present'; });
    marksRef.current = next;
    setMarks(next);
    saveRecords(unmarked.map((student) => ({
      student_id: student.student_id,
      student_name: student.student_name || '',
      student_id_no: student.student_id_no || '',
      status: 'present',
      note: notesRef.current[student.student_id] || '',
    })));
  };

  const retryFailedWrites = () => {
    const failed = [...failedWritesRef.current.values()];
    failedWritesRef.current.clear();
    setSaveError('');
    failed.forEach(({ payload, record }) => {
      const retryPayload = { ...payload, records: [record] };
      saveQueueRef.current = saveQueueRef.current.catch(() => null).then(async () => {
        const result = await base44.functions.invoke('submitAttendance', retryPayload);
        if (result.data?.error) throw new Error(result.data.error);
        if (currentContextRef.current === `${payload.class_type}|${payload.class_id}|${payload.date}|${payload.session_label}`) {
          setSession(result.data.session);
        }
        return result.data;
      }).catch((error) => {
        failedWritesRef.current.set(`${payload.date}|${payload.session_label}|${record.student_id}`, { payload, record });
        setSaveError(error.response?.data?.error || error.message || 'Attendance could not be saved.');
        notifyError('Could not save attendance', error.response?.data?.error || error.message);
      }).finally(() => {
        pendingWritesRef.current -= 1;
        setSaveStatus(pendingWritesRef.current ? 'saving' : failedWritesRef.current.size ? 'error' : 'saved');
      });
      pendingWritesRef.current += 1;
      setSaveStatus('saving');
    });
  };

  const profileById = useMemo(() => new Map(studentProfiles.map((student) => [student.id, student])), [studentProfiles]);
  const filterOptions = useMemo(() => {
    const uniqueValues = (key) => [...new Set(studentProfiles.map((student) => student[key]).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
    return {
      genders: uniqueValues('gender'),
      yearGroups: uniqueValues('year_group_name'),
      homerooms: uniqueValues('homeroom_class_name'),
      academicYears: uniqueValues('academic_year_name'),
    };
  }, [studentProfiles]);
  const visible = useMemo(() => {
    const normalizedTerm = term.trim().toLowerCase();
    return members
      .filter((memberRow) => {
        const student = profileById.get(memberRow.student_id) || {};
        const fullName = student.full_name || memberRow.student_name || '';
        const searchable = [
          fullName, student.first_name, student.middle_name, student.surname,
          student.student_id_no, memberRow.student_id_no,
        ].filter(Boolean).join(' ').toLowerCase();
        return (!normalizedTerm || searchable.includes(normalizedTerm))
          && (genderFilter === 'all' || student.gender === genderFilter)
          && (yearGroupFilter === 'all' || student.year_group_name === yearGroupFilter)
          && (homeroomFilter === 'all' || student.homeroom_class_name === homeroomFilter)
          && (academicYearFilter === 'all' || student.academic_year_name === academicYearFilter)
          && (statusFilter === 'all' || student.status === statusFilter);
      })
      .sort((a, b) => {
        const firstStudent = profileById.get(a.student_id) || {};
        const secondStudent = profileById.get(b.student_id) || {};
        let first = firstStudent.full_name || a.student_name || '';
        let second = secondStudent.full_name || b.student_name || '';
        if (sortBy.startsWith('id')) {
          first = firstStudent.student_id_no || a.student_id_no || '';
          second = secondStudent.student_id_no || b.student_id_no || '';
        } else if (sortBy.startsWith('first')) {
          first = firstStudent.first_name || a.student_name || '';
          second = secondStudent.first_name || b.student_name || '';
        } else if (sortBy.startsWith('last')) {
          first = firstStudent.surname || a.student_name || '';
          second = secondStudent.surname || b.student_name || '';
        }
        const comparison = String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: 'base' });
        return sortBy.endsWith('desc') ? -comparison : comparison;
      });
  }, [members, profileById, term, sortBy, genderFilter, yearGroupFilter, homeroomFilter, academicYearFilter, statusFilter]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0 };
    members.forEach((student) => {
      const status = marks[student.student_id];
      if (Object.hasOwn(c, status)) c[status] += 1;
    });
    return c;
  }, [marks, members]);
  const markedCount = members.filter((student) => marks[student.student_id]).length;
  const unmarkedCount = Math.max(0, members.length - markedCount);
  const attendanceStatus = !markedCount ? 'Not Started' : markedCount >= members.length ? 'Completed' : 'In Progress';
  const currentAcademicYear = academicYears.find((year) => year.id === klass?.academic_year_id)
    || academicYears.find((year) => year.is_current);
  const academicYearName = klass?.academic_year_name || currentAcademicYear?.name || school?.academic_year_label || '—';
  const currentTerm = terms.find((item) => item.start_date && item.end_date && date >= item.start_date && date <= item.end_date)
    || terms.find((item) => item.is_current);
  const assignedTeacherNames = [...new Set(classLinks
    .filter((item) => item.class_id === classId && (item.class_type || 'homeroom') === type)
    .map((item) => item.member_name)
    .filter(Boolean))];
  const teacherName = session?.member_name || assignedTeacherNames.join(', ') || member?.full_name || '—';
  const groupedClasses = useMemo(() => ({
    all: classOptions,
    homeroom: classOptions.filter((item) => item.type === 'homeroom'),
    subject: classOptions.filter((item) => item.type === 'subject'),
  }), [classOptions]);
  const visibleClasses = groupedClasses[classFilter] || classOptions;
  const classSelectOptions = visibleClasses.some((item) => item.id === classId) || !klass
    ? visibleClasses
    : [...visibleClasses, { ...klass, type }];
  const markClass = (item) => {
    if (saveStatus !== 'saved' && !window.confirm('Attendance changes are still saving or need retrying. Leave this register?')) return;
    if (saveStatus !== 'saved') {
      failedWritesRef.current.clear();
      setSaveStatus('saved');
      setSaveError('');
    }
    setParams((current) => {
      current.set('class', item.id);
      current.set('type', item.type);
      current.set('label', item.type === 'homeroom' ? 'Morning' : 'Class session');
      current.delete('period');
      current.delete('periods');
      return current;
    });
  };
  const updateDate = (nextDate) => {
    if (saveStatus !== 'saved' && !window.confirm('Attendance changes are still saving or need retrying. Change the date?')) return;
    if (saveStatus !== 'saved') {
      failedWritesRef.current.clear();
      setSaveStatus('saved');
      setSaveError('');
    }
    setMonth(moment(nextDate).format('YYYY-MM'));
    setParams((current) => {
      current.set('date', nextDate);
      return current;
    });
  };
  const handleCellSaved = ({ date: savedDate, studentId, status, session: savedSession }) => {
    if (savedDate !== date) return;
    const next = { ...marksRef.current };
    if (status) next[studentId] = status;
    else delete next[studentId];
    marksRef.current = next;
    setMarks(next);
    if (savedSession) setSession(savedSession);
  };
  const statusBadges = [
    { key: 'present', short: 'P', label: 'Present', color: 'text-emerald-700 dark:text-emerald-300' },
    { key: 'absent', short: 'A', label: 'Absent', color: 'text-red-700 dark:text-red-300' },
    { key: 'late', short: 'L', label: 'Late', color: 'text-amber-700 dark:text-amber-300' },
    { key: 'excused', short: 'E', label: 'Excused', color: 'text-blue-700 dark:text-blue-300' },
  ];

  return (
    <AppShell title="Register">
      <Link to="/attendance" className="print:hidden mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />Back to attendance centre
      </Link>

      <PageHeader
        title={`${klass?.name || 'Attendance register'} · ${label}`}
        subtitle={`${school?.name || 'School'} · ${fmtDate(date)}${type === 'subject' && klass?.subject ? ` · ${klass.subject}` : ''}`}
        actions={<Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>}
      />

      <nav aria-label="Class category" className="mb-3 flex flex-wrap gap-2 print:hidden">
        {[
          ['all', 'All Classes'],
          ['homeroom', 'Form Classes'],
          ['subject', 'Subject Classes'],
        ].map(([key, title]) => (
          <Button key={key} type="button" variant={classFilter === key ? 'default' : 'outline'} size="sm" onClick={() => setClassFilter(key)}>
            {title}<span className="ml-1 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px]">{groupedClasses[key].length}</span>
          </Button>
        ))}
      </nav>

      <section className="mb-3 grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Select class
          <Select value={classId || ''} disabled={saveStatus === 'saving'} onValueChange={(id) => {
            const selected = classOptions.find((item) => item.id === id);
            if (selected) markClass(selected);
          }}>
            <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
            <SelectContent>
              {classSelectOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.subject ? ` · ${item.subject}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Attendance date
            <Input type="date" value={date} disabled={saveStatus === 'saving'} onChange={(event) => updateDate(event.target.value)} />
        </label>
        <div className="flex items-end gap-2">
            <Button type="button" variant="outline" className="w-full" disabled={saveStatus === 'saving'} onClick={() => updateDate(moment().format('YYYY-MM-DD'))}>Today</Button>
          {type === 'homeroom' ? (
              <Select value={routeLabel} disabled={saveStatus === 'saving'} onValueChange={(value) => {
              if (saveStatus !== 'saved' && !window.confirm('Attendance changes are still saving or need retrying. Change the register session?')) return;
                if (saveStatus !== 'saved') {
                  failedWritesRef.current.clear();
                  setSaveStatus('saved');
                  setSaveError('');
                }
                setParams((current) => { current.set('label', value); return current; });
              }}>
              <SelectTrigger aria-label="Form session"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(klass?.attendance_period === 'morning' ? ['Morning'] : klass?.attendance_period === 'afternoon' ? ['Afternoon'] : ['Morning', 'Afternoon']).map((sessionLabel) => (
                  <SelectItem key={sessionLabel} value={sessionLabel}>{sessionLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        {type === 'subject' && (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Linked timetable periods
            <Input
              inputMode="numeric"
              value={manualPeriods}
              disabled={saveStatus === 'saving'}
              onChange={(event) => {
                if (saveStatus !== 'saved' && !window.confirm('Attendance changes are still saving or need retrying. Change the linked periods?')) return;
                if (saveStatus !== 'saved') {
                  failedWritesRef.current.clear();
                  setSaveStatus('saved');
                  setSaveError('');
                }
                const value = event.target.value;
                setManualPeriods(value);
                setParams((current) => {
                  if (value.trim()) current.set('periods', value.replace(/\s+/g, ''));
                  else current.delete('periods');
                  return current;
                }, { replace: true });
              }}
              placeholder="Optional, e.g. 2,3"
            />
          </label>
        )}
      </section>

      <section className="mb-3 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${type === 'homeroom' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200'}`}>
            {type === 'homeroom' ? 'Form Class / Homeroom' : 'Subject Class'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">School:</strong> {school?.name || '—'}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Subject:</strong> {type === 'subject' ? klass?.subject || '—' : 'Form attendance'}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Assigned teacher:</strong> {teacherName}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Academic year:</strong> {academicYearName}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Current term:</strong> {currentTerm?.name || '—'}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Enrolled:</strong> {members.length}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Marked:</strong> {markedCount} / {members.length}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Date:</strong> {fmtDate(date)}</p>
        <p className="text-xs text-muted-foreground"><strong className="text-foreground">Status:</strong> {attendanceStatus}</p>
      </section>

      {calendar?.day_type === 'no_school' && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          This date is marked No School{calendar.reason ? `: ${calendar.reason}` : ''}. No students are pre-marked; any attendance entered is an explicit teacher action.
        </div>
      )}

      {loadError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          <span className="text-destructive">{loadError}</span>
          <Button type="button" variant="outline" size="sm" onClick={load}>Retry loading</Button>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Attendance input method">
          <Button type="button" role="tab" aria-selected={view === 'daily'} variant={view === 'daily' ? 'default' : 'outline'} onClick={() => setView('daily')}>
            <UserRoundCheck className="h-4 w-4" />Daily Roll-Call
          </Button>
          <Button type="button" role="tab" aria-selected={view === 'sheet'} variant={view === 'sheet' ? 'default' : 'outline'} onClick={() => setView('sheet')}>
            <Table2 className="h-4 w-4" />Sheet View (Roll Matrix)
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Selected date</span>
          {statusBadges.map((item) => (
            <span key={item.key} className={`rounded-md bg-muted px-2 py-1 text-xs font-semibold ${item.color}`}>{item.short} {counts[item.key]}</span>
          ))}
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">Unmarked {unmarkedCount}</span>
          {view === 'daily' && (
            <Button type="button" size="sm" onClick={markUnmarkedPresent} disabled={!unmarkedCount || loading}>
              <CheckCheck className="h-4 w-4" />Mark All Present
            </Button>
          )}
        </div>
      </div>

      {saveStatus !== 'saved' && (
        <div role="status" className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${saveStatus === 'error' ? 'border border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200' : 'border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
          <span>{saveStatus === 'saving' ? 'Saving attendance changes…' : `Changes not saved: ${saveError}`}</span>
          {saveStatus === 'error' && <Button type="button" variant="outline" size="sm" onClick={retryFailedWrites}>Retry save</Button>}
        </div>
      )}
      {saveStatus === 'saved' && !loading && (
        <p role="status" className="mb-3 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{markedCount ? 'All attendance changes saved automatically.' : 'No unsaved attendance changes.'}</p>
      )}

      {view === 'sheet' ? (
        <AttendanceSheetView
          schoolId={schoolId}
          classId={classId}
          classType={type}
          className={klass?.name}
          subject={klass?.subject}
          label={label}
          period={period}
          periods={requestedPeriods}
          date={date}
          month={month}
          setMonth={setMonth}
          members={members}
          schoolName={school?.name}
          academicYear={academicYearName}
          teacherName={teacherName}
          termName={currentTerm?.name || ''}
          saveCell={saveSheetCell}
        />
      ) : (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Find a student…" className="min-w-0 flex-1 bg-transparent text-sm outline-none sm:w-48" />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger><SelectValue placeholder="Sort students" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">Full name A–Z</SelectItem>
                <SelectItem value="name-desc">Full name Z–A</SelectItem>
                <SelectItem value="first-asc">First name A–Z</SelectItem>
                <SelectItem value="last-asc">Last name A–Z</SelectItem>
                <SelectItem value="id-asc">Student ID A–Z</SelectItem>
                <SelectItem value="id-desc">Student ID Z–A</SelectItem>
              </SelectContent>
            </Select>
            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger><SelectValue placeholder="Gender" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                {filterOptions.genders.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={yearGroupFilter} onValueChange={setYearGroupFilter}>
              <SelectTrigger><SelectValue placeholder="Year group" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All year groups</SelectItem>
                {filterOptions.yearGroups.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={homeroomFilter} onValueChange={setHomeroomFilter}>
              <SelectTrigger><SelectValue placeholder="Homeroom" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All homerooms</SelectItem>
                {filterOptions.homerooms.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={academicYearFilter} onValueChange={setAcademicYearFilter}>
              <SelectTrigger><SelectValue placeholder="Academic year" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All academic years</SelectItem>
                {filterOptions.academicYears.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Student status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {['active', 'inactive', 'transferred', 'graduated'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {members.length === 0 && !loading ? (
            <div className="cp-card p-8 text-center">
              <p className="text-sm font-semibold">This class has no students yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Add students to the class before taking attendance.</p>
            </div>
          ) : (
            <div className="cp-card overflow-hidden">
              <div className="divide-y divide-border/60">
                {visible.map((student) => (
                  <article key={student.id} className="grid gap-2.5 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold leading-5">{student.student_name || 'Unnamed student'}</p>
                      <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">ID: {student.student_id_no || 'Not assigned'}</p>
                    </div>
                    <Input
                      value={notes[student.student_id] || ''}
                      onChange={(event) => {
                        const nextNotes = { ...notesRef.current, [student.student_id]: event.target.value };
                        notesRef.current = nextNotes;
                        setNotes(nextNotes);
                      }}
                      onBlur={() => {
                        const status = marksRef.current[student.student_id];
                        if (status) saveRecords([{
                          student_id: student.student_id,
                          student_name: student.student_name || '',
                          student_id_no: student.student_id_no || '',
                          status,
                          note: notesRef.current[student.student_id] || '',
                        }]);
                      }}
                      aria-label={`Attendance comment for ${student.student_name}`}
                      placeholder="Optional remark"
                      className="h-10 w-full text-sm"
                    />
                    <div className="grid grid-cols-4 gap-1 sm:flex sm:overflow-hidden sm:rounded-lg sm:border sm:border-border">
                      {ATTENDANCE_STATUSES.map((status) => {
                        const active = marks[student.student_id] === status.key;
                        const short = { present: 'P', absent: 'A', late: 'L', excused: 'E' }[status.key];
                        return (
                          <button
                            key={status.key}
                            type="button"
                            title={status.label}
                            aria-label={`${status.label} for ${student.student_name}`}
                            onClick={() => setStatus(student, status.key)}
                            aria-pressed={active}
                            className={`min-h-11 min-w-11 rounded-lg border border-border px-2 text-sm font-bold transition sm:min-h-10 sm:rounded-none sm:border-0 ${active ? statusBtn[status.key] : 'bg-card text-muted-foreground hover:bg-muted'}`}
                          >
                            {short}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-right text-[11px] text-muted-foreground print:hidden">
            {unmarkedCount} student(s) not yet marked · Changes save automatically for {teacherName} · {label} · {fmtDate(date)}.
          </p>
        </>
      )}
    </AppShell>
  );
}