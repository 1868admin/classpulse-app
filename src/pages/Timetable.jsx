import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Upload, CalendarClock, Printer } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EntryDialog from '@/components/timetable/EntryDialog';
import TimetableUploadDialog from '@/components/timetable/TimetableUploadDialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtTime } from '@/lib/dates';
import { notifyError } from '@/lib/notify';

export default function Timetable() {
  const { schoolId, school, member, isStaff } = useSchool();
  const [params] = useSearchParams();
  const [teachers, setTeachers] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [academicYearId, setAcademicYearId] = useState('');
  const [yearsReady, setYearsReady] = useState(false);
  const [targetId, setTargetId] = useState(member?.id || '');
  const [entries, setEntries] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entryDialog, setEntryDialog] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const days = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const periods = school?.periods?.length ? school.periods : [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, start: '', end: '' }));

  useEffect(() => { if (member?.id) setTargetId(member.id); }, [member?.id]);
  useEffect(() => { if (params.get('upload') === '1') setUploadOpen(true); }, [params]);

  useEffect(() => {
    if (!schoolId) return undefined;
    let active = true;
    setYearsReady(false);
    setAcademicYears([]);
    setAcademicYearId('');
    base44.entities.AcademicYear.filter({ school_id: schoolId }, { limit: 50, sort: '-name' })
      .then((page) => {
        if (!active) return;
        const items = page.items || [];
        setAcademicYears(items);
        setAcademicYearId(items.find((year) => year.is_current)?.id || items[0]?.id || '');
      })
      .catch((error) => {
        if (active) notifyError('Could not load academic years', error.message);
      })
      .finally(() => {
        if (active) setYearsReady(true);
      });
    return () => { active = false; };
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId || !isStaff) return;
    base44.entities.SchoolMember.filter({ school_id: schoolId, role: { $ne: 'school_admin' }, status: { $ne: 'inactive' } }, { limit: 200, sort: 'full_name' })
      .then((p) => setTeachers(p.items || []))
      .catch((error) => notifyError('Could not load teachers', error.message));
  }, [schoolId, isStaff]);

  const load = useCallback(async () => {
    if (!schoolId || !targetId || !yearsReady) return;
    setLoading(true);
    try {
      const [ent, links] = await Promise.all([
        base44.entities.TimetableEntry.filter({ school_id: schoolId, member_id: targetId, archived: false }, { limit: 200 }),
        base44.entities.ClassTeacher.filter({ school_id: schoolId, member_id: targetId, class_type: 'subject' }, { limit: 200 }),
      ]);
      const currentYearId = academicYears.find((year) => year.is_current)?.id || '';
      const displayYearId = academicYearId || currentYearId;
      const visibleEntries = (ent.items || []).filter((entry) => !displayYearId
        || entry.academic_year_id === displayYearId
        || (!entry.academic_year_id && displayYearId === currentYearId));
      const classIds = (links.items || []).map((link) => link.class_id);
      let classes = [];
      if (classIds.length) {
        const res = await base44.entities.SubjectClass.filter({ school_id: schoolId, id: { $in: classIds }, archived: false }, { limit: 200 });
        classes = res.items || [];
      }
      setEntries(visibleEntries);
      setSubjects(classes);
    } catch (error) {
      notifyError('Could not load timetable', error.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, targetId, yearsReady, academicYears, academicYearId]);

  useEffect(() => { load(); }, [load]);

  const grid = useMemo(() => {
    const map = {};
    entries.forEach((e) => { map[`${e.day_name}|${e.period_number}`] = e; });
    return map;
  }, [entries]);

  const targetName = isStaff
    ? (teachers.find((t) => t.id === targetId)?.full_name || member?.full_name || '')
    : member?.full_name;

  return (
    <AppShell title="Timetable">
      <PageHeader
        title="Timetable"
        subtitle={targetName ? `${targetName} · ${entries.length} lesson(s)` : 'Select a teacher'}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1.5 h-3.5 w-3.5" />Print</Button>
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}><Upload className="mr-1.5 h-3.5 w-3.5" />Upload CSV</Button>
            <Button size="sm" onClick={() => setEntryDialog({ entry: null })}><Plus className="mr-1.5 h-3.5 w-3.5" />Add lesson</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-3">
        {isStaff && (
          <div className="w-full max-w-xs">
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger><SelectValue placeholder="Choose a teacher" /></SelectTrigger>
              <SelectContent>
                {teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {academicYears.length > 0 && (
          <div className="w-full max-w-xs">
            <Select value={academicYearId} onValueChange={setAcademicYearId}>
              <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
              <SelectContent>
                {academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}{year.is_current ? ' · Current' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!targetId ? (
        <p className="text-sm text-muted-foreground">Choose a teacher to view their timetable.</p>
      ) : (
        <div className="cp-card overflow-hidden">
          <div className="cp-scroll-x">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="cp-table-head">
                <tr>
                  <th className="w-24 px-3 py-2.5">Period</th>
                  {days.map((d) => <th key={d} className="px-3 py-2.5">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.number} className="border-t border-border/60">
                    <td className="bg-muted/30 px-3 py-2 align-top">
                      <p className="text-xs font-bold">P{p.number}</p>
                      {p.start && <p className="text-[10px] text-muted-foreground">{fmtTime(p.start)}–{fmtTime(p.end)}</p>}
                    </td>
                    {days.map((d) => {
                      const e = grid[`${d}|${p.number}`];
                      return (
                        <td key={d} className="p-1.5 align-top">
                          <button
                            onClick={() => setEntryDialog({ entry: e || null, day: d, period: p.number })}
                            className={`h-full w-full rounded-lg border px-2 py-2 text-left transition ${e ? 'border-primary/20 bg-primary/5 hover:border-primary/40' : 'border-dashed border-border/70 text-muted-foreground hover:bg-muted/60'}`}
                          >
                            {e ? (
                              <>
                                <p className="text-xs font-semibold leading-snug">{e.subject || e.class_name || 'Lesson'}</p>
                                <p className="text-[10px] text-muted-foreground">{e.class_name}{e.room ? ` · ${e.room}` : ''}</p>
                              </>
                            ) : (
                              <span className="text-[10px]">+</span>
                            )}
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
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" />
        Tap any cell to add or edit a lesson. {loading ? 'Refreshing…' : 'Changes save immediately.'}
      </p>

      <EntryDialog
        open={!!entryDialog}
        onOpenChange={(o) => !o && setEntryDialog(null)}
        entry={entryDialog?.entry || null}
        memberId={targetId}
        defaultDay={entryDialog?.day}
        defaultPeriod={entryDialog?.period}
        academicYearId={academicYearId}
        subjectClasses={subjects}
        onSaved={load}
      />

      <TimetableUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        memberId={targetId}
        academicYearId={academicYearId}
        subjectClasses={subjects}
        canCreateClasses={!isStaff || targetId === member?.id}
        onSaved={load}
      />
    </AppShell>
  );
}