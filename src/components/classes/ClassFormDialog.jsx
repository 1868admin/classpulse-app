import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import TeacherPicker from '@/components/classes/TeacherPicker';
import { notifySuccess } from '@/lib/notify';

const SUBJECTS = ['Mathematics', 'English', 'Physics', 'Chemistry', 'Biology', 'Integrated Science', 'History', 'Geography', 'Spanish', 'French', 'Social Studies', 'Physical Education', 'Information Technology', 'Business Studies', 'Visual Arts', 'Music', 'Religious Education'];

export default function ClassFormDialog({ open, onOpenChange, type = 'subject', klass, yearGroups, homerooms, teachers, onSaved }) {
  const { schoolId, member, isStaff } = useSchool();
  const [form, setForm] = useState({ name: '', subject: '', year_group_id: '', room: '', notes: '', homeroom_ids: [], attendance_period: 'both' });
  const [teacherIds, setTeacherIds] = useState([]);
  const [primaryId, setPrimaryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [teachersLoaded, setTeachersLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setTeachersLoaded(!klass);
    setForm({
      name: klass?.name || '',
      subject: klass?.subject || '',
      year_group_id: klass?.year_group_id || '',
      room: klass?.room || '',
      notes: klass?.notes || '',
      homeroom_ids: klass?.homeroom_ids || [],
      attendance_period: klass?.attendance_period || 'both',
    });
    let cancelled = false;
    const loadTeachers = async () => {
      if (!klass) {
        setTeacherIds(member ? [member.id] : []);
        setPrimaryId(member?.id || '');
        return;
      }
      try {
        const links = await base44.entities.ClassTeacher.filter({ school_id: schoolId, class_id: klass.id, is_active: { $ne: false } }, { limit: 50 });
        if (cancelled) return;
        const items = links.items || [];
        setTeacherIds(items.map((l) => l.member_id));
        setPrimaryId(items.find((l) => l.is_primary)?.member_id || items[0]?.member_id || '');
        setTeachersLoaded(true);
      } catch (err) {
        if (!cancelled) setError(`Could not load the current teachers: ${err.message}`);
      }
    };
    loadTeachers();
    return () => { cancelled = true; };
  }, [open, klass, schoolId, member]);

  const toggleHomeroom = (id) => {
    setForm((f) => ({
      ...f,
      homeroom_ids: f.homeroom_ids.includes(id) ? f.homeroom_ids.filter((h) => h !== id) : [...f.homeroom_ids, id],
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Give the class a name.'); return; }
    if (type === 'subject' && !form.subject.trim()) { setError('Choose the subject.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await base44.functions.invoke('saveClass', {
        type,
        class_id: klass?.id || '',
        class: {
          name: form.name,
          subject: form.subject,
          year_group_id: form.year_group_id,
          room: form.room,
          notes: form.notes,
          homeroom_ids: form.homeroom_ids,
          attendance_period: form.attendance_period,
        },
        teacher_ids: teacherIds,
        primary_id: primaryId,
      });
      if (result.data?.error) throw new Error(result.data.error);
      const saved = result.data.class;
      notifySuccess(klass ? 'Class updated' : 'Class created', saved.name);
      onOpenChange(false);
      await onSaved?.(saved);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{klass ? 'Edit' : 'Create'} {type === 'subject' ? 'subject class' : 'homeroom class'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
          <div className={type === 'subject' ? '' : 'sm:col-span-2'}>
            <Label className="mb-1.5 block text-[13px]">Class name <span className="text-destructive">*</span></Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={type === 'subject' ? 'e.g. Form 4A Physics' : 'e.g. Form 1A'} />
          </div>
          {type === 'subject' && (
            <div>
              <Label className="mb-1.5 block text-[13px]">Subject <span className="text-destructive">*</span></Label>
              <Input list="cp-subjects" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Physics" />
              <datalist id="cp-subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
          )}
          <div>
            <Label className="mb-1.5 block text-[13px]">Year group</Label>
            <Select value={form.year_group_id || 'none'} onValueChange={(v) => setForm((f) => ({ ...f, year_group_id: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {yearGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Room</Label>
            <Input value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} placeholder="Lab 2" />
          </div>
          {type === 'homeroom' && (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[13px]">Attendance sessions</Label>
              <Select value={form.attendance_period} onValueChange={(value) => setForm((f) => ({ ...f, attendance_period: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">Morning</SelectItem>
                  <SelectItem value="afternoon">Afternoon</SelectItem>
                  <SelectItem value="both">Both morning and afternoon</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {type === 'subject' && (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[13px]">Homeroom classes (optional)</Label>
              <div className="flex flex-wrap gap-1.5">
                {homerooms.length === 0 && <p className="text-xs text-muted-foreground">No homeroom classes yet.</p>}
                {homerooms.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => toggleHomeroom(h.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${form.homeroom_ids.includes(h.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">
              {type === 'subject' ? 'Teachers who can take this class' : 'Homeroom teachers (multiple allowed)'}
            </Label>
            <TeacherPicker members={teachers} value={teacherIds} primaryId={primaryId} onChange={setTeacherIds} onPrimaryChange={setPrimaryId} />
            <p className="mt-1 text-[11px] text-muted-foreground">Tap the star to mark the primary teacher. All assigned teachers share the same class list.</p>
          </div>

          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </div>

          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !teachersLoaded}>{busy ? 'Saving…' : klass ? 'Save changes' : 'Create class'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}