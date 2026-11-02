import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCheck, ClipboardCheck, Search, CheckCircle2, Printer } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notifySuccess, notifyError } from '@/lib/notify';
import { ATTENDANCE_STATUSES, fmtDate } from '@/lib/dates';
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

  const { schoolId, member, school } = useSchool();
  const [klass, setKlass] = useState(null);
  const [members, setMembers] = useState([]);
  const [studentProfiles, setStudentProfiles] = useState([]);
  const [marks, setMarks] = useState({});
  const [notes, setNotes] = useState({});
  const [session, setSession] = useState(null);
  const [term, setTerm] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [genderFilter, setGenderFilter] = useState('all');
  const [yearGroupFilter, setYearGroupFilter] = useState('all');
  const [homeroomFilter, setHomeroomFilter] = useState('all');
  const [academicYearFilter, setAcademicYearFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualPeriods, setManualPeriods] = useState(params.get('periods') || (period ? String(period) : ''));

  const load = useCallback(async () => {
    if (!schoolId || !classId) return;
    setLoading(true);
    const entity = type === 'subject' ? 'SubjectClass' : 'HomeroomClass';
    const [cls, mem, ses] = await Promise.all([
      base44.entities[entity].get(classId).catch(() => null),
      base44.entities.ClassMembership.filter({ school_id: schoolId, class_id: classId }, { limit: 300, sort: 'student_name' }),
      base44.entities.AttendanceSession.filter({ school_id: schoolId, class_id: classId, date }, { limit: 100 }),
    ]);
    setKlass(cls);
    const list = mem.items || [];
    setMembers(list);
    if (list.length) {
      const profiles = await base44.entities.Student.filter({
        school_id: schoolId,
        id: { $in: list.map((item) => item.student_id) },
      }, { limit: 300 });
      setStudentProfiles(profiles.items || []);
    } else {
      setStudentProfiles([]);
    }
    const existing = (ses.items || []).find((item) => {
      if (item.session_label === label) return true;
      const savedPeriods = Array.isArray(item.period_numbers) && item.period_numbers.length
        ? item.period_numbers.map(Number)
        : [Number(item.period_number)].filter(Boolean);
      return requestedPeriods.some((value) => savedPeriods.includes(value));
    }) || null;
    setSession(existing);
    if (existing) {
      const recs = await base44.entities.AttendanceRecord.filter({ school_id: schoolId, session_id: existing.id }, { limit: 400 });
      const nextMarks = {};
      const nextNotes = {};
      (recs.items || []).forEach((r) => { nextMarks[r.student_id] = r.status; nextNotes[r.student_id] = r.note || ''; });
      list.forEach((m) => { if (!nextMarks[m.student_id]) nextMarks[m.student_id] = 'present'; });
      setMarks(nextMarks);
      setNotes(nextNotes);
    } else {
      const fresh = {};
      list.forEach((m) => { fresh[m.student_id] = 'present'; });
      setMarks(fresh);
      setNotes({});
    }
    setManualPeriods(params.get('periods') || (period ? String(period) : ''));
    setLoading(false);
  }, [schoolId, classId, type, date, label, params, period, requestedPeriods.join(',')]);

  useEffect(() => { load(); }, [load]);

  const markAll = (status) => {
    const next = {};
    members.forEach((m) => { next[m.student_id] = status; });
    setMarks(next);
  };

  const setStatus = (id, status) => setMarks((m) => ({ ...m, [id]: status }));

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
    Object.values(marks).forEach((s) => { c[s] = (c[s] || 0) + 1; });
    return c;
  }, [marks]);

  const save = async () => {
    setSaving(true);
    try {
      const periods = [...new Set(manualPeriods.split(/[,\s+]+/).map(Number)
        .filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
      const sessionLabel = periods.length > 1 ? `Periods ${periods.join(' + ')}` : routeLabel;
      const records = members.map((m) => ({
        student_id: m.student_id,
        student_name: m.student_name,
        student_id_no: m.student_id_no,
        status: marks[m.student_id] || 'present',
        note: notes[m.student_id] || '',
      }));
      const res = await base44.functions.invoke('submitAttendance', {
        class_type: type,
        class_id: classId,
        class_name: klass?.name || '',
        subject: klass?.subject || '',
        date,
        day_name: '',
        period_number: periods[0] || Number(period) || 0,
        period_numbers: periods,
        session_label: sessionLabel,
        records,
      });
      if (res.data?.error) throw new Error(res.data.error);
      setSession(res.data.session);
      notifySuccess(session ? 'Register updated' : 'Register submitted', `${klass?.name} · ${label}`);
    } catch (err) {
      notifyError('Could not save register', err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const backTo = '/attendance';

  return (
    <AppShell title="Register">
      <Link to={backTo} className="print:hidden mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />Back to attendance centre
      </Link>

      <PageHeader
        title={`${klass?.name || 'Register'} · ${label}`}
        subtitle={[
          school?.name,
          fmtDate(date),
          type === 'subject' ? klass?.subject : 'Homeroom attendance',
          `Teacher: ${member?.full_name || '—'}`,
          `Academic year: ${klass?.academic_year_name || school?.academic_year_label || '—'}`,
          `${members.length} student(s)`,
          session ? `Updated by ${session.last_edited_by || session.member_name} at ${moment(session.submitted_at).format('h:mm a')}` : '',
        ].filter(Boolean).join(' · ')}
        actions={
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}><Printer className="mr-1.5 h-3.5 w-3.5" />Print sheet</Button>
            <Button variant="outline" size="sm" className="print:hidden" onClick={() => markAll('present')}><CheckCheck className="mr-1.5 h-3.5 w-3.5" />All present</Button>
            <Button size="sm" onClick={save} disabled={saving || loading}>
              <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />{saving ? 'Saving…' : session ? 'Update register' : 'Submit register'}
            </Button>
          </div>
        }
      />

      <div className="mb-3 grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 print:hidden">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Attendance date
          <Input type="date" value={date} onChange={(event) => {
            setParams((current) => {
              current.set('date', event.target.value);
              return current;
            });
          }} />
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const today = moment().format('YYYY-MM-DD');
            setParams((current) => {
              current.set('date', today);
              return current;
            });
          }}>Today</Button>
        </label>
        {type === 'subject' && (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Linked timetable periods (optional)
            <Input
              inputMode="numeric"
              value={manualPeriods}
              onChange={(event) => {
                const value = event.target.value;
                setManualPeriods(value);
                setParams((current) => {
                  if (value.trim()) current.set('periods', value.replace(/\s+/g, ''));
                  else current.delete('periods');
                  return current;
                }, { replace: true });
              }}
              placeholder="For a double period, enter e.g. 2,3"
            />
          </label>
        )}
      </div>

      {session && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Register saved {moment(session.submitted_at).format('D MMM YYYY, h:mm a')}. Corrections are recorded in the audit trail.
        </div>
      )}

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find a student…" className="min-w-0 flex-1 bg-transparent text-sm outline-none sm:w-48" />
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
      <div className="mb-3 flex flex-wrap gap-2 print:hidden">
        {ATTENDANCE_STATUSES.map((s) => (
          <span key={s.key} className="rounded-lg bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            {s.label}: {counts[s.key] || 0}
          </span>
        ))}
      </div>

      {members.length === 0 && !loading ? (
        <div className="cp-card p-8 text-center">
          <p className="text-sm font-semibold">This class has no students yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add students to the class before taking attendance.</p>
        </div>
      ) : (
        <div className="cp-card overflow-hidden">
          <div className="divide-y divide-border/60">
            {visible.map((m) => (
              <article key={m.id} className="grid gap-2.5 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold leading-5">{m.student_name || 'Unnamed student'}</p>
                  <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">ID: {m.student_id_no || 'Not assigned'}</p>
                </div>
                <Input
                  value={notes[m.student_id] || ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [m.student_id]: e.target.value }))}
                  aria-label={`Attendance note for ${m.student_name}`}
                  placeholder="Attendance note"
                  className="h-10 w-full text-sm"
                />
                <div className="grid grid-cols-2 gap-1 sm:flex sm:overflow-hidden sm:rounded-lg sm:border sm:border-border">
                  {ATTENDANCE_STATUSES.map((s) => {
                    const active = (marks[m.student_id] || 'present') === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => setStatus(m.student_id, s.key)}
                        aria-pressed={active}
                        className={`min-h-11 rounded-lg border border-border px-3 text-xs font-semibold transition sm:min-h-9 sm:rounded-none sm:border-0 ${active ? statusBtn[s.key] : 'bg-card text-muted-foreground hover:bg-muted'}`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2 print:hidden">
        <Button onClick={save} disabled={saving || loading}>{saving ? 'Saving…' : session ? 'Update register' : 'Submit register'}</Button>
      </div>
      <p className="mt-2 text-right text-[11px] text-muted-foreground print:hidden">Attendance is saved against {member?.full_name || 'your staff profile'} and {label} of {fmtDate(date)}.</p>
    </AppShell>
  );
}