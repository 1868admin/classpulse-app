import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Check, Pencil, Plus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { notifyError, notifySuccess } from '@/lib/notify';

const EMPTY_FORM = {
  exam_name: '',
  class_type: 'subject',
  class_id: '',
  subject: '',
  exam_date: '',
  start_time: '',
  end_time: '',
  room: '',
  notes: '',
};

const STATUS_LABELS = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export default function ExaminationTimetable({
  schoolId,
  isStaff,
  academicYears,
  academicYearId,
  onAcademicYearChange,
}) {
  const [entries, setEntries] = useState([]);
  const [subjectClasses, setSubjectClasses] = useState([]);
  const [homerooms, setHomerooms] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      const queries = [
        base44.entities.ExaminationTimetableEntry.filter(
          { school_id: schoolId },
          { limit: 2000, sort: ['exam_date', 'start_time'] },
        ),
      ];
      if (isStaff) {
        queries.push(
          base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 500, sort: 'name' }),
          base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 500, sort: 'name' }),
        );
      }
      const [entryPage, subjectPage, homeroomPage] = await Promise.all(queries);
      setEntries(entryPage.items || []);
      setSubjectClasses(subjectPage?.items || []);
      setHomerooms(homeroomPage?.items || []);
    } catch (error) {
      notifyError('Could not load examination timetable', error.message);
    }
  }, [schoolId, isStaff]);

  useEffect(() => { load(); }, [load]);

  const activeClasses = form.class_type === 'subject' ? subjectClasses : homerooms;
  const visibleEntries = useMemo(() => entries.filter((entry) => (
    entry.academic_year_id === academicYearId
    && (statusFilter === 'all' || entry.status === statusFilter)
  )), [entries, academicYearId, statusFilter]);

  const openNew = () => {
    setForm({ ...EMPTY_FORM, academic_year_id: academicYearId || '' });
    setDialogOpen(true);
  };

  const openEdit = (entry) => {
    setForm({
      id: entry.id,
      academic_year_id: entry.academic_year_id,
      exam_name: entry.exam_name,
      class_type: entry.class_type,
      class_id: entry.class_id,
      subject: entry.subject,
      exam_date: entry.exam_date,
      start_time: entry.start_time,
      end_time: entry.end_time,
      room: entry.room,
      notes: entry.notes || '',
    });
    setDialogOpen(true);
  };

  const chooseClass = (classId) => {
    const selected = activeClasses.find((item) => item.id === classId);
    setForm((current) => ({
      ...current,
      class_id: classId,
      subject: current.class_type === 'subject' ? (selected?.subject || '') : current.subject,
    }));
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await base44.functions.invoke('saveExaminationSchedule', { id: form.id, exam: form });
      notifySuccess(form.id ? 'Draft updated' : 'Draft saved', form.exam_name);
      setDialogOpen(false);
      await load();
    } catch (error) {
      notifyError('Could not save examination draft', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async (entry) => {
    setBusy(true);
    try {
      await base44.functions.invoke('publishExaminationSchedule', { id: entry.id });
      notifySuccess('Examination timetable published', entry.exam_name);
      await load();
    } catch (error) {
      notifyError('Could not publish examination', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await base44.functions.invoke('archiveExaminationSchedule', { id: archiveTarget.id });
      notifySuccess('Examination archived', archiveTarget.exam_name);
      setArchiveTarget(null);
      await load();
    } catch (error) {
      notifyError('Could not archive examination', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-52">
            <Label className="mb-1.5 block text-xs font-medium">Academic year</Label>
            <Select value={academicYearId || ''} onValueChange={onAcademicYearChange}>
              <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
              <SelectContent>
                {academicYears.map((year) => (
                  <SelectItem key={year.id} value={year.id}>{year.name}{year.is_current ? ' · Current' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isStaff && (
            <div className="min-w-40">
              <Label className="mb-1.5 block text-xs font-medium">Schedule status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {isStaff && (
          <Button onClick={openNew} disabled={!academicYearId}>
            <Plus className="mr-1.5 h-4 w-4" />Add examination
          </Button>
        )}
      </div>

      <div className="cp-card overflow-hidden">
        {visibleEntries.length ? (
          <div className="cp-scroll-x">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="cp-table-head"><tr>
                <th className="px-3 py-2.5 text-left">Date &amp; time</th>
                <th className="px-3 py-2.5 text-left">Examination</th>
                <th className="px-3 py-2.5 text-left">Class</th>
                <th className="px-3 py-2.5 text-left">Subject</th>
                <th className="px-3 py-2.5 text-left">Room</th>
                {isStaff && <th className="px-3 py-2.5 text-left">Status</th>}
                {isStaff && <th className="px-3 py-2.5 text-right">Actions</th>}
              </tr></thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-3 py-2.5">{entry.exam_date} · {entry.start_time}–{entry.end_time}</td>
                    <td className="px-3 py-2.5 font-medium">{entry.exam_name}</td>
                    <td className="px-3 py-2.5">{entry.class_name}</td>
                    <td className="px-3 py-2.5">{entry.subject}</td>
                    <td className="px-3 py-2.5">{entry.room}</td>
                    {isStaff && <td className="px-3 py-2.5">{STATUS_LABELS[entry.status]}</td>}
                    {isStaff && (
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          {entry.status === 'draft' && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openEdit(entry)} disabled={busy} aria-label={`Edit ${entry.exam_name}`}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => publish(entry)} disabled={busy}>
                                <Check className="mr-1 h-3.5 w-3.5" />Publish
                              </Button>
                            </>
                          )}
                          {entry.status !== 'archived' && (
                            <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(entry)} disabled={busy} aria-label={`Archive ${entry.exam_name}`}>
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-5 text-sm text-muted-foreground">
            {academicYearId ? 'No examination schedules for this selection.' : 'Choose an academic year to view examination schedules.'}
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{form.id ? 'Edit examination draft' : 'Add examination draft'}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="grid gap-3.5 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-[13px]">Examination name</Label>
              <Input required maxLength={120} value={form.exam_name || ''} onChange={(event) => setForm((current) => ({ ...current, exam_name: event.target.value }))} placeholder="End of term examination" />
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">Academic year</Label>
              <Select value={form.academic_year_id || ''} onValueChange={(value) => setForm((current) => ({ ...current, academic_year_id: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">Class type</Label>
              <Select value={form.class_type} onValueChange={(value) => setForm((current) => ({
                ...current,
                class_type: value,
                class_id: '',
                subject: '',
              }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="subject">Subject group</SelectItem>
                  <SelectItem value="homeroom">Homeroom class</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">Class</Label>
              <Select value={form.class_id || ''} onValueChange={chooseClass}>
                <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
                <SelectContent>{activeClasses.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">Subject</Label>
              <Input required maxLength={120} readOnly={form.class_type === 'subject'} value={form.subject || ''} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">Date</Label>
              <Input required type="date" value={form.exam_date || ''} onChange={(event) => setForm((current) => ({ ...current, exam_date: event.target.value }))} />
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">Start time</Label>
              <Input required type="time" value={form.start_time || ''} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} />
            </div>
            <div>
              <Label className="mb-1.5 block text-[13px]">End time</Label>
              <Input required type="time" value={form.end_time || ''} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[13px]">Exam room</Label>
              <Input required maxLength={120} value={form.room || ''} onChange={(event) => setForm((current) => ({ ...current, room: event.target.value }))} placeholder="Science Hall" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[13px]">Notes</Label>
              <Textarea maxLength={2000} value={form.notes || ''} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Archive examination?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {archiveTarget?.exam_name} will remain in the historical record and will no longer appear in teachers’ published schedules.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveTarget(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={archive} disabled={busy}>{busy ? 'Archiving…' : 'Archive examination'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
