import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer, RefreshCw, ShieldCheck, UserPlus, UserRoundX } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { notifyError, notifySuccess } from '@/lib/notify';

const EMPTY_FORM = {
  examination_id: '',
  assignment_id: '',
  teacher_member_id: '',
  role: 'assistant',
  override_lesson_conflict: false,
  override_reason: '',
};

const ACTIVE_STATUSES = new Set(['draft', 'published']);

function downloadSchedule(rows) {
  const headers = ['Date', 'Start', 'End', 'Room', 'Subject', 'Examination', 'Role'];
  const fields = ['exam_date', 'start_time', 'end_time', 'room', 'subject', 'exam_name', 'role'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers, ...rows.map((row) => fields.map((field) => row[field]))]
    .map((row) => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'my-examination-supervision.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function InvigilationManagement({
  schoolId,
  isStaff,
  academicYears,
  academicYearId,
  onAcademicYearChange,
}) {
  const [assignments, setAssignments] = useState([]);
  const [exams, setExams] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('schedule');
  const [showHistory, setShowHistory] = useState(false);
  const [examFilter, setExamFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [requiredSupervisors, setRequiredSupervisors] = useState(2);
  const [unavailableIds, setUnavailableIds] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState('');

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const queries = [
        base44.entities.InvigilationAssignment.filter(
          { school_id: schoolId },
          { limit: 2000, sort: ['exam_date', 'start_time', 'room'] },
        ),
      ];
      if (isStaff) {
        queries.push(
          base44.entities.ExaminationTimetableEntry.filter(
            { school_id: schoolId, status: 'published' },
            { limit: 2000, sort: ['exam_date', 'start_time'] },
          ),
          base44.entities.SchoolMember.filter(
            { school_id: schoolId, role: 'teacher', status: 'active', employment_status: { $ne: 'on_leave' } },
            { limit: 500, sort: 'full_name' },
          ),
          base44.entities.InvigilationRequirement.filter({ school_id: schoolId }, { limit: 2000 }),
        );
      }
      const [assignmentPage, examPage, teacherPage, requirementPage] = await Promise.all(queries);
      setAssignments(assignmentPage.items || []);
      setExams(examPage?.items || []);
      setTeachers(teacherPage?.items || []);
      setRequirements(requirementPage?.items || []);
    } catch (error) {
      notifyError('Could not load invigilation schedule', error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, isStaff]);

  useEffect(() => { load(); }, [load]);

  const yearExams = useMemo(() => exams.filter((exam) => exam.academic_year_id === academicYearId), [exams, academicYearId]);
  const yearRequirements = useMemo(
    () => requirements.filter((item) => item.academic_year_id === academicYearId),
    [requirements, academicYearId],
  );
  const requirementByExam = useMemo(
    () => new Map(yearRequirements.map((item) => [item.examination_id, item.required_supervisors])),
    [yearRequirements],
  );
  const yearAssignments = useMemo(() => assignments.filter((assignment) => assignment.academic_year_id === academicYearId), [assignments, academicYearId]);
  const activeAssignments = useMemo(
    () => yearAssignments.filter((assignment) => ACTIVE_STATUSES.has(assignment.status)
      && (!isStaff || yearExams.some((exam) => exam.id === assignment.examination_id))),
    [yearAssignments, isStaff, yearExams],
  );
  const displayAssignments = isStaff && showHistory ? yearAssignments : activeAssignments;
  const visibleAssignments = useMemo(() => displayAssignments.filter((assignment) => (
    (!examFilter || assignment.examination_id === examFilter)
    && (!teacherFilter || assignment.teacher_member_id === teacherFilter)
    && (!roomFilter || assignment.room.toLocaleLowerCase().includes(roomFilter.trim().toLocaleLowerCase()))
    && (!dateFilter || assignment.exam_date === dateFilter)
  )), [displayAssignments, examFilter, teacherFilter, roomFilter, dateFilter]);

  const staffingWarnings = useMemo(() => yearExams.map((exam) => {
    const assigned = activeAssignments.filter((assignment) => assignment.examination_id === exam.id);
    const required = Number(requirementByExam.get(exam.id) || 2);
    const hasChief = assigned.some((assignment) => assignment.role === 'chief');
    if (assigned.length >= required && hasChief) return null;
    return {
      examination_id: exam.id,
      exam_name: exam.exam_name,
      exam_date: exam.exam_date,
      room: exam.room,
      assigned: assigned.length,
      required,
      warning: assigned.length < required
        ? (assigned.length ? `Understaffed: ${assigned.length} of ${required} supervisor(s).` : 'Unstaffed examination.')
        : 'No chief supervisor assigned.',
    };
  }).filter(Boolean), [yearExams, activeAssignments, requirementByExam]);

  const workload = useMemo(() => {
    const counts = new Map();
    for (const assignment of activeAssignments) {
      counts.set(assignment.teacher_member_id, (counts.get(assignment.teacher_member_id) || 0) + 1);
    }
    return teachers.map((teacher) => ({
      ...teacher,
      assignments: counts.get(teacher.id) || 0,
    })).sort((left, right) => right.assignments - left.assignments || left.full_name.localeCompare(right.full_name));
  }, [activeAssignments, teachers]);

  const teacherName = (id) => teachers.find((teacher) => teacher.id === id)?.full_name
    || assignments.find((assignment) => assignment.teacher_member_id === id)?.teacher_name
    || 'Teacher';

  const callManagement = async (action, data, success, failure) => {
    setBusy(true);
    try {
      const { data: result } = await base44.functions.invoke('manageInvigilation', { action, ...data });
      notifySuccess(success);
      await load();
      return result;
    } catch (error) {
      notifyError(failure, error.response?.data?.error || error.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!academicYearId) return;
    await callManagement('generate', {
      academic_year_id: academicYearId,
      required_supervisors: Number(requiredSupervisors),
      unavailable_teacher_ids: unavailableIds,
    }, 'Invigilation assignments generated', 'Could not generate assignments');
  };

  const openAssign = (exam, assignment = null) => {
    setForm({
      ...EMPTY_FORM,
      examination_id: exam.id,
      assignment_id: assignment?.id || '',
      teacher_member_id: assignment?.teacher_member_id || '',
      role: assignment?.role || 'assistant',
    });
    setDialogOpen(true);
  };

  const saveAssignment = async (event) => {
    event.preventDefault();
    const action = form.assignment_id ? 'reassign' : 'assign';
    const result = await callManagement(action, form, form.assignment_id ? 'Supervisor reassigned' : 'Supervisor assigned', 'Could not save supervisor assignment');
    if (result) setDialogOpen(false);
  };

  const confirmAssignment = (assignment) => callManagement(
    'confirm',
    { assignment_id: assignment.id },
    'Assignment confirmed',
    'Could not confirm assignment',
  );

  const removeAssignment = async (event) => {
    event.preventDefault();
    if (!removeTarget) return;
    const result = await callManagement('remove', {
      assignment_id: removeTarget.id,
      reason: removeReason,
    }, 'Supervisor removed; historical assignment retained', 'Could not remove supervisor');
    if (result) {
      setRemoveTarget(null);
      setRemoveReason('');
    }
  };

  const publish = () => callManagement(
    'publish',
    { academic_year_id: academicYearId },
    'Assignments published to teachers',
    'Could not publish assignments',
  );

  const teacherRow = (assignment) => (
    <tr key={assignment.id} className="border-t border-border/60">
      {view !== 'schedule' && (
        <td className="px-3 py-2.5">
          {view === 'teacher' ? assignment.teacher_name || teacherName(assignment.teacher_member_id)
            : view === 'examination' ? assignment.exam_name : assignment.room}
        </td>
      )}
      <td className="whitespace-nowrap px-3 py-2.5">{assignment.exam_date} · {assignment.start_time}–{assignment.end_time}</td>
      <td className="px-3 py-2.5 font-medium">
        {assignment.exam_name}
        {assignment.reassignment_required && <span className="mt-1 block text-[11px] font-semibold text-amber-700">{assignment.staffing_issue_reason || 'Reassignment required'}</span>}
      </td>
      <td className="px-3 py-2.5">{assignment.subject}</td>
      <td className="px-3 py-2.5">{assignment.room}</td>
      <td className="px-3 py-2.5">
        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${assignment.role === 'chief' ? 'bg-amber-100 text-amber-900' : 'bg-muted text-muted-foreground'}`}>
          {assignment.role === 'chief' ? 'Chief supervisor' : 'Assistant supervisor'}
        </span>
      </td>
      {showHistory && <td className="px-3 py-2.5 capitalize">{assignment.status}</td>}
      {isStaff && (
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1">
            {yearExams.some((exam) => exam.id === assignment.examination_id)
              && !assignment.confirmed && assignment.status === 'draft' && (
              <Button size="sm" variant="outline" onClick={() => confirmAssignment(assignment)} disabled={busy}>Confirm</Button>
            )}
            {yearExams.some((exam) => exam.id === assignment.examination_id) && ACTIVE_STATUSES.has(assignment.status) && (
              <Button size="sm" variant="ghost" onClick={() => openAssign(
                yearExams.find((exam) => exam.id === assignment.examination_id),
                assignment,
              )} disabled={busy} aria-label={`Reassign ${assignment.teacher_name}`}>
                Reassign
              </Button>
            )}
            {yearExams.some((exam) => exam.id === assignment.examination_id) && ACTIVE_STATUSES.has(assignment.status) && (
              <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(assignment)} disabled={busy} aria-label={`Remove ${assignment.teacher_name}`}>
                <UserRoundX className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {assignment.override_reason && <p className="mt-1 max-w-48 text-right text-[11px] text-amber-800">Override: {assignment.override_reason}</p>}
          {assignment.subject_teacher_warning && <p className="mt-1 max-w-48 text-right text-[11px] text-amber-800">Teaches this subject</p>}
        </td>
      )}
    </tr>
  );

  const tableRows = view === 'workload' ? [] : [...visibleAssignments].sort((left, right) => (
    (view === 'teacher' ? left.teacher_name.localeCompare(right.teacher_name)
      : view === 'examination' ? left.exam_name.localeCompare(right.exam_name)
        : view === 'room' ? left.room.localeCompare(right.room) : 0)
    || left.exam_date.localeCompare(right.exam_date)
    || left.start_time.localeCompare(right.start_time)
    || left.room.localeCompare(right.room)
    || left.role.localeCompare(right.role)
  ));
  const groupLabel = view === 'teacher' ? 'Teacher'
    : view === 'examination' ? 'Examination'
      : view === 'room' ? 'Room' : '';

  if (!isStaff) {
    const personalAssignments = [...visibleAssignments].sort((left, right) => (
      left.exam_date.localeCompare(right.exam_date) || left.start_time.localeCompare(right.start_time)
    ));
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-sm flex-1">
            <Label className="mb-1.5 block text-xs font-medium">Academic year</Label>
            <Select value={academicYearId || ''} onValueChange={onAcademicYearChange}>
              <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
              <SelectContent>{academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadSchedule(personalAssignments)} disabled={!personalAssignments.length}>
              <Download className="mr-1.5 h-3.5 w-3.5" />Download CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1.5 h-3.5 w-3.5" />Print</Button>
          </div>
        </div>
        <div className="cp-card overflow-hidden">
          {loading ? <p className="p-5 text-sm text-muted-foreground">Loading your supervision schedule…</p>
            : personalAssignments.length ? (
              <div className="cp-scroll-x">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="cp-table-head"><tr>
                    <th className="px-3 py-2.5 text-left">Date &amp; time</th>
                    <th className="px-3 py-2.5 text-left">Examination</th>
                    <th className="px-3 py-2.5 text-left">Subject</th>
                    <th className="px-3 py-2.5 text-left">Room</th>
                    <th className="px-3 py-2.5 text-left">Your role</th>
                  </tr></thead>
                  <tbody>{personalAssignments.map((assignment) => (
                    <tr key={assignment.id} className="border-t border-border/60">
                      <td className="whitespace-nowrap px-3 py-2.5">{assignment.exam_date} · {assignment.start_time}–{assignment.end_time}</td>
                      <td className="px-3 py-2.5 font-medium">{assignment.exam_name}</td>
                      <td className="px-3 py-2.5">{assignment.subject}</td>
                      <td className="px-3 py-2.5">{assignment.room}</td>
                      <td className="px-3 py-2.5 font-semibold">{assignment.role === 'chief' ? 'Chief supervisor' : 'Assistant supervisor'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="p-5 text-sm text-muted-foreground">{academicYearId ? 'No published supervision assignments for this academic year.' : 'Choose an academic year.'}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="mb-1.5 block text-xs font-medium">Academic year</Label>
            <Select value={academicYearId || ''} onValueChange={onAcademicYearChange}>
              <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
              <SelectContent>{academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs font-medium">Schedule view</Label>
            <Select value={view} onValueChange={setView}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="schedule">Full schedule</SelectItem>
                <SelectItem value="teacher">By teacher</SelectItem>
                <SelectItem value="examination">By examination</SelectItem>
                <SelectItem value="room">By room</SelectItem>
                <SelectItem value="workload">Workload summary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {view !== 'workload' && (
            <div>
              <Label className="mb-1.5 block text-xs font-medium">Examination</Label>
              <Select value={examFilter || 'all'} onValueChange={(value) => setExamFilter(value === 'all' ? '' : value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All examinations</SelectItem>
                  {yearExams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.exam_name} · {exam.room}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading || busy}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
          <Button size="sm" onClick={generate} disabled={!academicYearId || busy}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Generate / regenerate
          </Button>
          <Button size="sm" variant="outline" onClick={publish} disabled={!academicYearId || busy}>
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Publish assignments
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="cp-card p-4">
          <Label htmlFor="required-supervisors" className="text-xs font-medium">Required supervisors per examination room</Label>
          <Input id="required-supervisors" className="mt-1.5 max-w-28" type="number" min="1" max="10" value={requiredSupervisors} onChange={(event) => setRequiredSupervisors(event.target.value)} />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold">Mark teachers unavailable for this generation</summary>
            <div className="mt-2 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
              {teachers.map((teacher) => (
                <label key={teacher.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={unavailableIds.includes(teacher.id)}
                    onChange={(event) => setUnavailableIds((current) => event.target.checked
                      ? [...current, teacher.id]
                      : current.filter((id) => id !== teacher.id))}
                  />
                  {teacher.full_name}
                </label>
              ))}
            </div>
          </details>
        </div>
        <div className="cp-card p-4">
          <p className="text-xs font-semibold">Staffing status</p>
          <p className="mt-1 text-sm">{staffingWarnings.length ? `${staffingWarnings.length} examination(s) need attention` : 'All published examinations meet their supervisor count.'}</p>
          <p className="mt-1 text-xs text-muted-foreground">A regeneration keeps administrator-confirmed assignments and retains unchanged eligible assignments.</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium">
        <input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />
        Include removed and superseded assignment history
      </label>

      {staffingWarnings.length > 0 && (
        <section className="cp-card border-amber-300 bg-amber-50/60 p-4">
          <h3 className="text-sm font-bold text-amber-950">Staffing warnings</h3>
          <ul className="mt-2 space-y-1 text-xs text-amber-900">
            {staffingWarnings.map((item) => (
              <li key={item.examination_id}>{item.exam_date} · {item.room} · {item.exam_name}: {item.warning}</li>
            ))}
          </ul>
        </section>
      )}

      {view === 'workload' ? (
        <div className="cp-card overflow-hidden">
          <div className="cp-scroll-x">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="cp-table-head"><tr><th className="px-3 py-2.5 text-left">Teacher</th><th className="px-3 py-2.5 text-right">Assignments</th></tr></thead>
              <tbody>{workload.map((teacher) => (
                <tr key={teacher.id} className="border-t border-border/60">
                  <td className="px-3 py-2.5">{teacher.full_name}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{teacher.assignments}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={teacherFilter || 'all'} onValueChange={(value) => setTeacherFilter(value === 'all' ? '' : value)}>
              <SelectTrigger><SelectValue placeholder="All teachers" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All teachers</SelectItem>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.full_name}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="date" aria-label="Filter by date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
            <Input aria-label="Filter by room" placeholder="Filter by room" value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)} />
          </div>
          <div className="cp-card overflow-hidden">
            {loading ? <p className="p-5 text-sm text-muted-foreground">Loading invigilation schedule…</p>
              : tableRows.length ? (
                <div className="cp-scroll-x">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="cp-table-head"><tr>
                      {groupLabel && <th className="px-3 py-2.5 text-left">{groupLabel}</th>}
                      <th className="px-3 py-2.5 text-left">Date &amp; time</th>
                      <th className="px-3 py-2.5 text-left">Examination</th>
                      <th className="px-3 py-2.5 text-left">Subject</th>
                      <th className="px-3 py-2.5 text-left">Room</th>
                      <th className="px-3 py-2.5 text-left">Role</th>
                      {showHistory && <th className="px-3 py-2.5 text-left">Status</th>}
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr></thead>
                    <tbody>{tableRows.map(teacherRow)}</tbody>
                  </table>
                </div>
              ) : <p className="p-5 text-sm text-muted-foreground">{academicYearId ? 'No active invigilation assignments for this selection.' : 'Choose an academic year.'}</p>}
          </div>
          {yearExams.length > 0 && (
            <div className="cp-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div><h3 className="text-sm font-bold">Examination staffing</h3><p className="text-xs text-muted-foreground">Published examinations and assigned supervisors</p></div>
              </div>
              <div className="divide-y divide-border/60">
                {yearExams.map((exam) => {
                  const assigned = activeAssignments.filter((item) => item.examination_id === exam.id);
                  const required = Number(requirementByExam.get(exam.id) || 2);
                  return (
                    <div key={exam.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{exam.exam_date} · {exam.start_time}–{exam.end_time} · {exam.room}</p>
                        <p className="truncate text-xs text-muted-foreground">{exam.exam_name} · {exam.subject} · {assigned.length}/{required} supervisors</p>
                        {assigned.length > 0 && <p className="mt-1 text-xs">{assigned.map((item) => `${item.teacher_name} (${item.role})${item.confirmed ? ' · confirmed' : ''}`).join(' · ')}</p>}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => openAssign(exam)} disabled={busy}>
                        <UserPlus className="mr-1.5 h-3.5 w-3.5" />Assign teacher
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{form.assignment_id ? 'Reassign supervisor' : 'Assign supervisor'}</DialogTitle></DialogHeader>
          <form onSubmit={saveAssignment} className="grid gap-4">
            <div>
              <Label className="mb-1.5 block text-[13px]">Teacher</Label>
              <Select value={form.teacher_member_id || ''} onValueChange={(value) => setForm((current) => ({ ...current, teacher_member_id: value }))}>
                <SelectTrigger><SelectValue placeholder="Choose a teacher" /></SelectTrigger>
                <SelectContent>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">Role</Label>
              <Select value={form.role} onValueChange={(value) => setForm((current) => ({ ...current, role: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="chief">Chief supervisor</SelectItem><SelectItem value="assistant">Assistant supervisor</SelectItem></SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.override_lesson_conflict}
                onChange={(event) => setForm((current) => ({ ...current, override_lesson_conflict: event.target.checked }))}
              />
              <span>Approve an override if this teacher has a published lesson during this examination.</span>
            </label>
            {form.override_lesson_conflict && (
              <div>
                <Label className="mb-1.5 block text-[13px]">Administrator reason (required when a lesson conflict exists)</Label>
                <Textarea required maxLength={1000} value={form.override_reason} onChange={(event) => setForm((current) => ({ ...current, override_reason: event.target.value }))} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !form.teacher_member_id}>{busy ? 'Saving…' : form.assignment_id ? 'Reassign' : 'Assign'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove supervisor?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The assignment remains in the historical record and will be marked removed.</p>
          <form onSubmit={removeAssignment} className="grid gap-3">
            <div>
              <Label className="mb-1.5 block text-[13px]">Reason</Label>
              <Textarea required maxLength={1000} value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Removing…' : 'Remove supervisor'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
