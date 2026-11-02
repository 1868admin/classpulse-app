import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import { notifySuccess, notifyError } from '@/lib/notify';

export default function EntryDialog({ open, onOpenChange, entry, memberId, subjectClasses, defaultDay, defaultPeriod, onSaved }) {
  const { schoolId, school } = useSchool();
  const days = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const periods = school?.periods || [];
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    const p = periods.find((x) => x.number === (entry?.period_number || defaultPeriod)) || periods[0] || {};
    setForm({
      day_name: entry?.day_name || defaultDay || days[0],
      period_number: entry?.period_number || defaultPeriod || p.number || 1,
      start_time: entry?.start_time || p.start || '',
      end_time: entry?.end_time || p.end || '',
      subject: entry?.subject || '',
      class_name: entry?.class_name || '',
      subject_class_id: entry?.subject_class_id || '',
      room: entry?.room || '',
      notes: entry?.notes || '',
    });
  }, [open, entry, defaultDay, defaultPeriod]);

  const setPeriod = (num) => {
    const p = periods.find((x) => x.number === Number(num));
    setForm((f) => ({ ...f, period_number: Number(num), start_time: p?.start || f.start_time, end_time: p?.end || f.end_time }));
  };

  const pickClass = (classId) => {
    const cls = subjectClasses.find((c) => c.id === classId);
    setForm((f) => ({
      ...f,
      subject_class_id: classId === 'none' ? '' : classId,
      class_name: cls?.name || f.class_name,
      subject: cls?.subject || f.subject,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subject && !form.class_name) { setError('Add a subject or class name.'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = {
        school_id: schoolId,
        member_id: memberId,
        day_name: form.day_name,
        period_number: Number(form.period_number),
        start_time: form.start_time,
        end_time: form.end_time,
        subject: form.subject,
        class_name: form.class_name,
        subject_class_id: form.subject_class_id,
        room: form.room,
        notes: form.notes,
        archived: false,
      };
      if (entry) await base44.entities.TimetableEntry.update(entry.id, payload);
      else await base44.entities.TimetableEntry.create(payload);
      notifySuccess(entry ? 'Lesson updated' : 'Lesson added', `${form.day_name} · period ${form.period_number}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      notifyError('Could not save lesson', err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    await base44.entities.TimetableEntry.delete(entry.id);
    notifySuccess('Lesson removed');
    onSaved();
    onOpenChange(false);
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{entry ? 'Edit lesson' : 'Add lesson'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[13px]">Timetable day</Label>
            <Select value={form.day_name} onValueChange={(v) => setForm((f) => ({ ...f, day_name: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{days.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Period</Label>
            <Select value={String(form.period_number || 1)} onValueChange={setPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(periods.length ? periods : [{ number: 1 }, { number: 2 }, { number: 3 }]).map((p) => (
                  <SelectItem key={p.number} value={String(p.number)}>Period {p.number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Start</Label>
            <Input type="time" value={form.start_time || ''} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">End</Label>
            <Input type="time" value={form.end_time || ''} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">Link a subject class</Label>
            <Select value={form.subject_class_id || 'none'} onValueChange={pickClass}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked</SelectItem>
                {subjectClasses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.subject}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Subject</Label>
            <Input value={form.subject || ''} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Physics" />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Class name</Label>
            <Input value={form.class_name || ''} onChange={(e) => setForm((f) => ({ ...f, class_name: e.target.value }))} placeholder="Form 4A" />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Room</Label>
            <Input value={form.room || ''} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Notes</Label>
            <Input value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="sm:col-span-2">
            {entry && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={remove} disabled={busy}>Delete lesson</Button>}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save lesson'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}