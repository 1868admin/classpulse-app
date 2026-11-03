import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, WandSparkles } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notifyError, notifySuccess } from '@/lib/notify';

const normalize = (value) => String(value || '').trim().toLocaleLowerCase();

function intervalsOverlap(left, right) {
  const toMinutes = (value) => {
    if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  };
  const leftStart = toMinutes(left.start_time);
  const leftEnd = toMinutes(left.end_time);
  const rightStart = toMinutes(right.start_time);
  const rightEnd = toMinutes(right.end_time);
  return leftStart !== null && leftEnd !== null && rightStart !== null && rightEnd !== null
    && leftStart < rightEnd && rightStart < leftEnd;
}

function sameClass(left, right) {
  if (left.subject_class_id && right.subject_class_id) return left.subject_class_id === right.subject_class_id;
  return normalize(left.class_name) !== '' && normalize(left.class_name) === normalize(right.class_name);
}

function findConflict(candidate, scheduled, unavailable) {
  const unavailableSlot = unavailable.find((slot) => slot.member_id === candidate.member_id
    && normalize(slot.day_name) === normalize(candidate.day_name)
    && (Number(slot.period_number) === Number(candidate.period_number) || intervalsOverlap(slot, candidate)));
  if (unavailableSlot) return 'Teacher is unavailable at this time.';

  for (const other of scheduled) {
    if (normalize(candidate.day_name) !== normalize(other.day_name)) continue;
    const samePeriod = Number(candidate.period_number) === Number(other.period_number);
    if (!samePeriod && !intervalsOverlap(candidate, other)) continue;
    if (candidate.member_id === other.member_id) return 'Teacher is already scheduled at this time.';
    if (sameClass(candidate, other)) return 'Class is already scheduled at this time.';
    if (candidate.room && normalize(candidate.room) === normalize(other.room)) return 'Room is already booked at this time.';
  }
  return '';
}

function loadCount(scheduled, key) {
  return scheduled.filter((entry) => entry.day_name === key).length;
}

export default function TimetableGenerator({ schoolId, school, academicYearId, onAcademicYearChange, academicYears, onApproved }) {
  const days = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const periods = school?.periods?.length
    ? school.periods
    : [1, 2, 3, 4, 5, 6].map((number) => ({ number, start: '', end: '' }));
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [links, setLinks] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [existingEntries, setExistingEntries] = useState([]);
  const [requirements, setRequirements] = useState({});
  const [draft, setDraft] = useState([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [allowPartialApproval, setAllowPartialApproval] = useState(false);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId || !academicYearId) return;
    setLoading(true);
    try {
      const [classPage, teacherPage, linkPage, availabilityPage, entryPage] = await Promise.all([
        base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 500, sort: 'name' }),
        base44.entities.SchoolMember.filter({ school_id: schoolId, role: 'teacher', status: 'active' }, { limit: 500, sort: 'full_name' }),
        base44.entities.ClassTeacher.filter({ school_id: schoolId, class_type: 'subject' }, { limit: 1000 }),
        base44.entities.TeacherAvailability.filter({
          school_id: schoolId,
          academic_year_id: academicYearId,
          is_available: false,
        }, { limit: 1000 }),
        base44.entities.TimetableEntry.filter({ school_id: schoolId, archived: false }, { limit: 2000 }),
      ]);
      const yearEntries = (entryPage.items || []).filter((entry) => entry.academic_year_id === academicYearId
        || (!entry.academic_year_id && academicYears.find((year) => year.is_current)?.id === academicYearId));
      setClasses((classPage.items || []).filter((item) => !item.academic_year_id || item.academic_year_id === academicYearId));
      setTeachers(teacherPage.items || []);
      setLinks((linkPage.items || []).filter((item) => !item.academic_year_id || item.academic_year_id === academicYearId));
      setAvailability(availabilityPage.items || []);
      setExistingEntries(yearEntries);
      setRequirements((previous) => {
        const next = {};
        for (const subjectClass of classPage.items || []) {
          if (subjectClass.archived || (subjectClass.academic_year_id && subjectClass.academic_year_id !== academicYearId)) continue;
          const assigned = (linkPage.items || []).find((link) => link.class_id === subjectClass.id
            && (!link.academic_year_id || link.academic_year_id === academicYearId));
          const previousRequirement = previous[subjectClass.id];
          next[subjectClass.id] = {
            teacherId: previousRequirement?.teacherId || assigned?.member_id || subjectClass.owner_member_id || '',
            lessons: previousRequirement?.lessons ?? Math.max(1, yearEntries.filter((entry) => entry.subject_class_id === subjectClass.id).length),
            room: previousRequirement?.room ?? subjectClass.room ?? '',
          };
        }
        return next;
      });
    } catch (error) {
      notifyError('Could not load timetable generation data', error.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, academicYearId, academicYears]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDraft([]); }, [academicYearId]);

  const yearEntries = useMemo(() => existingEntries.filter((entry) => !entry.archived), [existingEntries]);
  const scheduledDraft = useMemo(() => draft.filter((entry) => entry.day_name && Number(entry.period_number) > 0), [draft]);
  const conflicts = useMemo(() => {
    const found = [];
    const scheduled = replaceExisting ? [] : [...yearEntries];
    for (const entry of scheduledDraft) {
      const conflict = findConflict(entry, scheduled, availability);
      if (conflict) found.push({ id: entry.id, message: conflict });
      scheduled.push(entry);
    }
    return found;
  }, [scheduledDraft, yearEntries, replaceExisting, availability]);
  const conflictById = useMemo(() => new Map(conflicts.map((item) => [item.id, item.message])), [conflicts]);
  const unscheduled = draft.length - scheduledDraft.length;
  const activeTeachers = teachers;

  const availableTeachersFor = (subjectClass) => {
    const assigned = links.filter((link) => link.class_id === subjectClass.id)
      .map((link) => link.member_id);
    if (!assigned.length && subjectClass.owner_member_id) assigned.push(subjectClass.owner_member_id);
    return activeTeachers.filter((teacher) => !assigned.length || assigned.includes(teacher.id));
  };

  const setRequirement = (classId, key, value) => {
    setRequirements((current) => ({ ...current, [classId]: { ...current[classId], [key]: value } }));
  };

  const generate = () => {
    const baseSchedule = replaceExisting ? [] : [...yearEntries];
    const tasks = [];
    for (const subjectClass of classes) {
      const requirement = requirements[subjectClass.id] || {};
      const amount = Math.max(0, Math.min(20, Number(requirement.lessons) || 0));
      const alreadyScheduled = replaceExisting
        ? 0
        : yearEntries.filter((entry) => entry.subject_class_id === subjectClass.id).length;
      const toGenerate = Math.max(0, amount - alreadyScheduled);
      for (let index = 0; index < toGenerate; index += 1) {
        tasks.push({
          id: `${subjectClass.id}-${index + 1}-${crypto.randomUUID()}`,
          subject_class_id: subjectClass.id,
          class_name: subjectClass.name,
          subject: subjectClass.subject,
          member_id: requirement.teacherId,
          room: requirement.room || '',
          day_name: '',
          period_number: 0,
          start_time: '',
          end_time: '',
          notes: '',
          status: 'unscheduled',
        });
      }
    }
    tasks.sort((left, right) => {
      const leftOptions = left.member_id ? days.length * periods.length : 0;
      const rightOptions = right.member_id ? days.length * periods.length : 0;
      return leftOptions - rightOptions || left.subject_class_id.localeCompare(right.subject_class_id);
    });

    for (const task of tasks) {
      if (!task.member_id) continue;
      const options = days.flatMap((day) => periods.map((period) => ({
        ...task,
        day_name: day,
        period_number: Number(period.number),
        start_time: period.start || '',
        end_time: period.end || '',
      }))).filter((candidate) => !findConflict(candidate, baseSchedule, availability));
      options.sort((left, right) => {
        const leftLoad = loadCount(baseSchedule.filter((entry) => entry.member_id === task.member_id), left.day_name);
        const rightLoad = loadCount(baseSchedule.filter((entry) => entry.member_id === task.member_id), right.day_name);
        return leftLoad - rightLoad || Number(left.period_number) - Number(right.period_number);
      });
      if (options.length) {
        const assigned = { ...options[0], status: 'scheduled' };
        task.day_name = assigned.day_name;
        task.period_number = assigned.period_number;
        task.start_time = assigned.start_time;
        task.end_time = assigned.end_time;
        task.status = 'scheduled';
        baseSchedule.push(assigned);
      }
    }
    setDraft(tasks);
    setAllowPartialApproval(false);
  };

  const updateAssignment = (id, changes) => {
    setDraft((current) => current.map((entry) => {
      if (entry.id !== id) return entry;
      const next = { ...entry, ...changes };
      if (changes.period_number !== undefined) {
        const period = periods.find((item) => Number(item.number) === Number(changes.period_number));
        next.start_time = period?.start || '';
        next.end_time = period?.end || '';
      }
      next.status = next.day_name && Number(next.period_number) > 0 ? 'scheduled' : 'unscheduled';
      return next;
    }));
  };

  const approve = async () => {
    if (!scheduledDraft.length || conflicts.length || (unscheduled > 0 && !allowPartialApproval)) return;
    setApproving(true);
    try {
      const result = await base44.functions.invoke('approveGeneratedTimetable', {
        academic_year_id: academicYearId,
        mode: replaceExisting ? 'replace' : 'merge',
        entries: scheduledDraft.map(({ id, status, ...entry }) => entry),
      });
      notifySuccess('Timetable draft approved', `${result.data.approved} lesson(s) approved and published.`);
      setDraft([]);
      setAllowPartialApproval(false);
      await onApproved();
      await load();
    } catch (error) {
      notifyError('Could not approve timetable', error.response?.data?.error || error.message);
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="cp-card space-y-4 p-4">
        <div>
          <h2 className="text-sm font-bold">Generation requirements</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set weekly lesson counts, teachers and rooms for each subject class. The generator respects existing lessons, room/class/teacher conflicts and recorded unavailability.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs">Academic year</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={academicYearId} onChange={(event) => onAcademicYearChange(event.target.value)}>
              {academicYears.map((year) => <option key={year.id} value={year.id}>{year.name}{year.is_current ? ' · Current' : ''}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end rounded-lg border border-border px-3 py-2 text-xs">
            <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />
            Replace this year's timetable on approval
          </label>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading classes, staff and availability…</p>
        ) : classes.length ? (
          <div className="cp-scroll-x overflow-hidden rounded-xl border border-border">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="cp-table-head"><tr>
                <th className="px-3 py-2 text-left">Subject class</th>
                <th className="px-3 py-2 text-left">Teacher</th>
                <th className="px-3 py-2 text-left">Room</th>
                <th className="w-32 px-3 py-2 text-left">Lessons / week</th>
              </tr></thead>
              <tbody>
                {classes.map((subjectClass) => {
                  const eligible = availableTeachersFor(subjectClass);
                  const value = requirements[subjectClass.id] || { teacherId: '', lessons: 1, room: subjectClass.room || '' };
                  return (
                    <tr key={subjectClass.id} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <p className="font-medium">{subjectClass.name}</p>
                        <p className="text-xs text-muted-foreground">{subjectClass.subject}</p>
                      </td>
                      <td className="px-3 py-2">
                        <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={value.teacherId} onChange={(event) => setRequirement(subjectClass.id, 'teacherId', event.target.value)}>
                          <option value="">Select a teacher</option>
                          {eligible.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>)}
                        </select>
                        {!eligible.length && <span className="text-[11px] text-amber-700">No active teacher is available.</span>}
                      </td>
                      <td className="px-3 py-2"><Input value={value.room} onChange={(event) => setRequirement(subjectClass.id, 'room', event.target.value)} placeholder="Optional" /></td>
                      <td className="px-3 py-2"><Input type="number" min="0" max="20" value={value.lessons} onChange={(event) => setRequirement(subjectClass.id, 'lessons', event.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Create active subject classes and assign teachers before generating a timetable.
          </p>
        )}
        {loading && null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{yearEntries.length} existing lesson(s) in this academic year.</p>
          <Button onClick={generate} disabled={loading || !classes.length || !academicYearId || !teachers.length}>
            <WandSparkles className="mr-2 h-4 w-4" />Generate proposal
          </Button>
        </div>
      </section>

      {draft.length > 0 && (
        <section className="cp-card space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Proposed timetable</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Review and adjust assignments before approval. {scheduledDraft.length} scheduled · {unscheduled} unscheduled.
              </p>
            </div>
            <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${conflicts.length ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700'}`}>
              {conflicts.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {conflicts.length ? `${conflicts.length} conflict(s) to resolve` : 'No conflicts detected'}
            </div>
          </div>
          <div className="cp-scroll-x overflow-hidden rounded-xl border border-border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="cp-table-head"><tr>
                <th className="px-3 py-2 text-left">Class / subject</th>
                <th className="px-3 py-2 text-left">Teacher</th>
                <th className="px-3 py-2 text-left">Day</th>
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-3 py-2 text-left">Room</th>
                <th className="px-3 py-2 text-left">Review</th>
              </tr></thead>
              <tbody>
                {draft.map((entry) => (
                  <tr key={entry.id} className={`border-t border-border/60 ${conflictById.has(entry.id) ? 'bg-destructive/5' : ''}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{entry.class_name}</p>
                      <p className="text-xs text-muted-foreground">{entry.subject}</p>
                    </td>
                    <td className="px-3 py-2">
                      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={entry.member_id} onChange={(event) => updateAssignment(entry.id, { member_id: event.target.value })}>
                        <option value="">Select teacher</option>
                        {availableTeachersFor(classes.find((item) => item.id === entry.subject_class_id) || {}).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={entry.day_name} onChange={(event) => updateAssignment(entry.id, { day_name: event.target.value })}>
                        <option value="">Unscheduled</option>
                        {days.map((day) => <option key={day} value={day}>{day}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={entry.period_number || ''} onChange={(event) => updateAssignment(entry.id, { period_number: Number(event.target.value) || 0 })}>
                        <option value="">Unscheduled</option>
                        {periods.map((period) => <option key={period.number} value={period.number}>Period {period.number}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><Input value={entry.room} onChange={(event) => updateAssignment(entry.id, { room: event.target.value })} /></td>
                    <td className="max-w-56 px-3 py-2 text-xs">
                      {conflictById.get(entry.id) || (entry.day_name ? 'Ready' : 'Unscheduled — assign a free slot or leave out')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {conflicts.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <p className="font-semibold text-destructive">Resolve all conflicts before approval</p>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {conflicts.map((conflict) => <li key={conflict.id}>{draft.find((entry) => entry.id === conflict.id)?.class_name}: {conflict.message}</li>)}
              </ul>
            </div>
          )}
          {unscheduled > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
              <input className="mt-0.5" type="checkbox" checked={allowPartialApproval} onChange={(event) => setAllowPartialApproval(event.target.checked)} />
              <span>Approve only the {scheduledDraft.length} scheduled lesson(s). Leave {unscheduled} unscheduled lesson(s) out of the published timetable.</span>
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setDraft([])}>Discard proposal</Button>
            <Button onClick={approve} disabled={approving || !scheduledDraft.length || conflicts.length > 0 || (unscheduled > 0 && !allowPartialApproval)}>
              {approving ? 'Approving…' : 'Approve final draft'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
