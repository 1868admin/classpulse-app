import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Plus, Printer, Upload, WandSparkles } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EntryDialog from '@/components/timetable/EntryDialog';
import DocumentCentre from '@/components/timetable/DocumentCentre';
import TeacherDocuments from '@/components/timetable/TeacherDocuments';
import ExaminationTimetable from '@/components/timetable/ExaminationTimetable';
import InvigilationManagement from '@/components/timetable/InvigilationManagement';
import TimetableGenerator from '@/components/timetable/TimetableGenerator';
import TimetableUploadDialog from '@/components/timetable/TimetableUploadDialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtTime } from '@/lib/dates';
import { notifyError } from '@/lib/notify';

const MANAGEMENT_VIEWS = [
  { id: 'master', label: 'Master Timetable' },
  { id: 'teachers', label: 'Teacher Timetables' },
  { id: 'classes', label: 'Class Timetables' },
  { id: 'rooms', label: 'Room Timetables' },
  { id: 'import', label: 'Import Timetable' },
  { id: 'generate', label: 'Generate Timetable' },
  { id: 'examinations', label: 'Examination Timetable' },
  { id: 'invigilation', label: 'Invigilation Management' },
  { id: 'documents', label: 'PDF Distribution Centre' },
];

function EntryTable({ entries, getTeacherName }) {
  if (!entries.length) return <p className="p-5 text-sm text-muted-foreground">No timetable entries for this selection.</p>;
  return (
    <div className="cp-scroll-x">
      <table className="w-full min-w-[740px] text-sm">
        <thead className="cp-table-head"><tr>
          <th className="px-3 py-2.5 text-left">Day</th>
          <th className="px-3 py-2.5 text-left">Period</th>
          <th className="px-3 py-2.5 text-left">Teacher</th>
          <th className="px-3 py-2.5 text-left">Class</th>
          <th className="px-3 py-2.5 text-left">Subject</th>
          <th className="px-3 py-2.5 text-left">Room</th>
        </tr></thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-border/60">
              <td className="px-3 py-2.5">{entry.day_name}</td>
              <td className="px-3 py-2.5">{entry.period_number}{entry.start_time ? ` · ${fmtTime(entry.start_time)}–${fmtTime(entry.end_time)}` : ''}</td>
              <td className="px-3 py-2.5">{getTeacherName(entry.member_id)}</td>
              <td className="px-3 py-2.5">{entry.class_name || '—'}</td>
              <td className="px-3 py-2.5">{entry.subject || '—'}</td>
              <td className="px-3 py-2.5">{entry.room || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Timetable() {
  const { schoolId, school, member, isStaff } = useSchool();
  const [params, setParams] = useSearchParams();
  const [teachers, setTeachers] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [academicYearId, setAcademicYearId] = useState('');
  const [targetId, setTargetId] = useState(member?.id || '');
  const [entries, setEntries] = useState([]);
  const [subjectClasses, setSubjectClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entryDialog, setEntryDialog] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [classFilter, setClassFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const requestedView = params.get('view');
  const activeView = isStaff && MANAGEMENT_VIEWS.some((view) => view.id === requestedView)
    ? requestedView
    : !isStaff && ['examinations', 'invigilation'].includes(requestedView)
      ? requestedView
    : isStaff ? 'master' : 'teachers';

  const days = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const periods = school?.periods?.length
    ? school.periods
    : [1, 2, 3, 4, 5, 6].map((number) => ({ number, start: '', end: '' }));

  useEffect(() => {
    if (member?.id) setTargetId(member.id);
  }, [member?.id]);

  useEffect(() => {
    if (params.get('upload') === '1' && isStaff) {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('upload');
        next.set('view', 'import');
        return next;
      }, { replace: true });
    }
  }, [params, isStaff, setParams]);

  const setView = (view) => {
    const next = new URLSearchParams(params);
    next.set('view', view);
    next.delete('upload');
    setParams(next);
  };

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [yearPage, teacherPage, entryPage] = await Promise.all([
        base44.entities.AcademicYear.filter({ school_id: schoolId }, { limit: 50, sort: '-name' }),
        isStaff
          ? base44.entities.SchoolMember.filter({ school_id: schoolId, role: 'teacher', status: 'active' }, { limit: 500, sort: 'full_name' })
          : Promise.resolve({ items: [] }),
        base44.entities.TimetableEntry.filter({ school_id: schoolId, archived: false }, { limit: 2000 }),
      ]);
      const years = yearPage.items || [];
      const currentYearId = years.find((year) => year.is_current)?.id || '';
      setAcademicYears(years);
      setAcademicYearId((current) => current && years.some((year) => year.id === current)
        ? current
        : currentYearId || years[0]?.id || '');
      setTeachers(teacherPage.items || []);
      setEntries(entryPage.items || []);
      if (isStaff) {
        const classPage = await base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 500, sort: 'name' });
        setSubjectClasses(classPage.items || []);
      } else {
        setSubjectClasses([]);
      }
    } catch (error) {
      notifyError('Could not load timetable management', error.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, isStaff]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isStaff && teachers.length && !teachers.some((teacher) => teacher.id === targetId)) {
      setTargetId(teachers[0].id);
    }
  }, [isStaff, teachers, targetId]);

  const currentYearId = academicYears.find((year) => year.is_current)?.id || '';
  const yearEntries = useMemo(() => entries.filter((entry) => (
    (entry.academic_year_id || currentYearId) === academicYearId
    && (isStaff || (entry.member_id === member?.id && entry.published !== false))
  )), [entries, academicYearId, currentYearId, isStaff, member?.id]);

  const classes = useMemo(() => [...new Set(yearEntries.map((entry) => entry.class_name).filter(Boolean))].sort(), [yearEntries]);
  const rooms = useMemo(() => [...new Set(yearEntries.map((entry) => entry.room).filter(Boolean))].sort(), [yearEntries]);
  const filteredEntries = activeView === 'classes'
    ? yearEntries.filter((entry) => entry.class_name === classFilter)
    : activeView === 'rooms'
      ? yearEntries.filter((entry) => entry.room === roomFilter)
      : yearEntries;
  const getTeacherName = (id) => teachers.find((teacher) => teacher.id === id)?.full_name
    || (id === member?.id ? member?.full_name : '')
    || 'Teacher';

  const teacherEntries = activeView === 'teachers'
    ? yearEntries.filter((entry) => entry.member_id === (isStaff ? targetId : member?.id))
    : [];
  const teacherGrid = useMemo(() => {
    const map = {};
    teacherEntries.forEach((entry) => { map[`${entry.day_name}|${entry.period_number}`] = entry; });
    return map;
  }, [teacherEntries]);
  const targetName = isStaff ? getTeacherName(targetId) : member?.full_name || '';

  const headerTitle = activeView === 'examinations'
    ? 'Examination Timetable'
    : activeView === 'documents'
      ? 'PDF Distribution Centre'
    : activeView === 'invigilation'
      ? (isStaff ? 'Invigilation Management' : 'My Examination Supervision')
    : isStaff ? 'Timetable Management' : 'My Published Timetable';
  const headerSubtitle = activeView === 'examinations'
    ? 'Published examination schedules'
    : activeView === 'documents'
      ? 'Generate, preview and distribute timetable and supervision PDFs'
    : activeView === 'invigilation'
      ? (isStaff ? 'Allocate and manage examination supervisors' : 'Your published supervision assignments')
    : isStaff
    ? (academicYears.find((year) => year.id === academicYearId)?.name || 'Manage school timetables')
    : `${targetName} · ${teacherEntries.length} published lesson(s)`;

  return (
    <AppShell title={headerTitle}>
      <PageHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        actions={activeView !== 'generate' && activeView !== 'import' && activeView !== 'examinations' && activeView !== 'invigilation' && activeView !== 'documents' ? (
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1.5 h-3.5 w-3.5" />Print</Button>
            {isStaff && activeView === 'teachers' && (
              <Button size="sm" onClick={() => setEntryDialog({ entry: null })}><Plus className="mr-1.5 h-3.5 w-3.5" />Add lesson</Button>
            )}
            {isStaff && (
              <Button size="sm" className="bg-primary" onClick={() => setView('generate')}>
                <WandSparkles className="mr-1.5 h-3.5 w-3.5" />Generate Timetable
              </Button>
            )}
          </>
        ) : null}
      />

      {isStaff && (
        <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Timetable Management">
          {MANAGEMENT_VIEWS.map((view) => (
            <Button
              key={view.id}
              type="button"
              size="sm"
              variant={activeView === view.id ? 'default' : 'ghost'}
              role="tab"
              aria-selected={activeView === view.id}
              onClick={() => setView(view.id)}
              className="shrink-0"
            >
              {view.id === 'generate' && <WandSparkles className="mr-1 h-3.5 w-3.5" />}
              {view.id === 'import' && <Upload className="mr-1 h-3.5 w-3.5" />}
              {view.label}
            </Button>
          ))}
        </nav>
      )}
      {!isStaff && (
        <nav className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Timetables">
          <Button
            type="button"
            size="sm"
            variant={activeView === 'teachers' ? 'default' : 'ghost'}
            role="tab"
            aria-selected={activeView === 'teachers'}
            onClick={() => setView('teachers')}
          >
            My Published Timetable
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeView === 'examinations' ? 'default' : 'ghost'}
            role="tab"
            aria-selected={activeView === 'examinations'}
            onClick={() => setView('examinations')}
          >
            Examination Timetable
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeView === 'invigilation' ? 'default' : 'ghost'}
            role="tab"
            aria-selected={activeView === 'invigilation'}
            onClick={() => setView('invigilation')}
          >
            Examination Supervision
          </Button>
        </nav>
      )}

      {activeView === 'documents' && isStaff ? (
        <DocumentCentre
          academicYears={academicYears}
          academicYearId={academicYearId}
          onAcademicYearChange={setAcademicYearId}
        />
      ) : activeView === 'invigilation' ? (
        <InvigilationManagement
          schoolId={schoolId}
          isStaff={isStaff}
          academicYears={academicYears}
          academicYearId={academicYearId}
          onAcademicYearChange={setAcademicYearId}
        />
      ) : activeView === 'examinations' ? (
        <ExaminationTimetable
          schoolId={schoolId}
          isStaff={isStaff}
          academicYears={academicYears}
          academicYearId={academicYearId}
          onAcademicYearChange={setAcademicYearId}
        />
      ) : isStaff && activeView === 'generate' ? (
        <TimetableGenerator
          schoolId={schoolId}
          school={school}
          academicYearId={academicYearId}
          academicYears={academicYears}
          onAcademicYearChange={setAcademicYearId}
          onApproved={load}
        />
      ) : isStaff && activeView === 'import' ? (
        <section className="cp-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Import timetable</h2>
              <p className="mt-1 text-xs text-muted-foreground">Import a teacher's schedule from a CSV file into the selected academic year.</p>
            </div>
            <Button onClick={() => setUploadOpen(true)} disabled={!targetId}>
              <Upload className="mr-2 h-4 w-4" />Import Timetable
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium">Teacher</p>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger><SelectValue placeholder="Choose a teacher" /></SelectTrigger>
                <SelectContent>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium">Academic year</p>
              <Select value={academicYearId} onValueChange={setAcademicYearId}>
                <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
                <SelectContent>{academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </section>
      ) : activeView === 'generate' || activeView === 'import' ? null : activeView === 'teachers' && isStaff ? (
        <div className="mb-3 max-w-sm">
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger><SelectValue placeholder="Choose a teacher" /></SelectTrigger>
            <SelectContent>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.full_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : activeView === 'classes' ? (
        <div className="mb-3 max-w-sm">
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
            <SelectContent>{classes.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : activeView === 'rooms' ? (
        <div className="mb-3 max-w-sm">
          <Select value={roomFilter} onValueChange={setRoomFilter}>
            <SelectTrigger><SelectValue placeholder="Choose a room" /></SelectTrigger>
            <SelectContent>{rooms.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : null}

      {isStaff && activeView !== 'generate' && activeView !== 'import' && activeView !== 'examinations'
        && activeView !== 'invigilation' && activeView !== 'documents' && academicYears.length > 0 && (
        <div className="mb-3 max-w-sm">
          <Select value={academicYearId} onValueChange={setAcademicYearId}>
            <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
            <SelectContent>{academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}{year.is_current ? ' · Current' : ''}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      {!isStaff && ['teachers', 'invigilation'].includes(activeView) && <div className="mb-4"><TeacherDocuments /></div>}

      {(activeView === 'generate' && isStaff) || (activeView === 'documents' && isStaff) ? null : activeView === 'teachers' ? (
        !targetId ? (
          <p className="text-sm text-muted-foreground">Choose a teacher to view their timetable.</p>
        ) : (
          <div className="cp-card overflow-hidden">
            <div className="cp-scroll-x">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead className="cp-table-head"><tr>
                  <th className="w-24 px-3 py-2.5">Period</th>
                  {days.map((day) => <th key={day} className="px-3 py-2.5">{day}</th>)}
                </tr></thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period.number} className="border-t border-border/60">
                      <td className="bg-muted/30 px-3 py-2 align-top">
                        <p className="text-xs font-bold">P{period.number}</p>
                        {period.start && <p className="text-[10px] text-muted-foreground">{fmtTime(period.start)}–{fmtTime(period.end)}</p>}
                      </td>
                      {days.map((day) => {
                        const entry = teacherGrid[`${day}|${period.number}`];
                        return (
                          <td key={day} className="p-1.5 align-top">
                            <button
                              type="button"
                              disabled={!isStaff}
                              onClick={() => isStaff && setEntryDialog({ entry: entry || null, day, period: period.number })}
                              className={`h-full w-full rounded-lg border px-2 py-2 text-left ${entry ? 'border-primary/20 bg-primary/5' : 'border-dashed border-border/70 text-muted-foreground'} ${isStaff ? 'hover:border-primary/40' : 'cursor-default'}`}
                            >
                              {entry ? (
                                <>
                                  <p className="text-xs font-semibold leading-snug">{entry.subject || entry.class_name || 'Lesson'}</p>
                                  <p className="text-[10px] text-muted-foreground">{entry.class_name}{entry.room ? ` · ${entry.room}` : ''}</p>
                                </>
                              ) : <span className="text-[10px]">—</span>}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        <div className="cp-card overflow-hidden">
          {loading ? <p className="p-5 text-sm text-muted-foreground">Loading timetable…</p> : (
            <EntryTable entries={filteredEntries} getTeacherName={getTeacherName} />
          )}
        </div>
      )}

      {activeView === 'teachers' && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          {isStaff ? 'Select a cell to add or edit a teacher lesson.' : 'Only your published lessons are shown.'}
        </p>
      )}

      {isStaff && (
        <>
          <EntryDialog
            open={!!entryDialog}
            onOpenChange={(open) => !open && setEntryDialog(null)}
            entry={entryDialog?.entry || null}
            memberId={targetId}
            defaultDay={entryDialog?.day}
            defaultPeriod={entryDialog?.period}
            academicYearId={academicYearId}
            subjectClasses={subjectClasses}
            onSaved={load}
          />
          <TimetableUploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            memberId={targetId}
            academicYearId={academicYearId}
            subjectClasses={subjectClasses}
            canCreateClasses={false}
            onSaved={load}
          />
        </>
      )}
    </AppShell>
  );
}
