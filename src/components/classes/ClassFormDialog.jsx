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
  const [form, setForm] = useState({ name: '', subject: '', year_group_id: '', room: '', notes: '', homeroom_ids: [] });
  const [teacherIds, setTeacherIds] = useState([]);
  const [primaryId, setPrimaryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm({
      name: klass?.name || '',
      subject: klass?.subject || '',
      year_group_id: klass?.year_group_id || '',
      room: klass?.room || '',
      notes: klass?.notes || '',
      homeroom_ids: klass?.homeroom_ids || [],
    });
    const loadTeachers = async () => {
      if (klass) {
        const links = await base44.entities.ClassTeacher.filter({ school_id: schoolId, class_id: klass.id }, { limit: 50 });
        const items = links.items || [];
        setTeacherIds(items.map((l) => l.member_id));
        setPrimaryId(items.find((l) => l.is_primary)?.member_id || items[0]?.member_id || '');
      } else {
        setTeacherIds(member ? [member.id] : []);
        setPrimaryId(member?.id || '');
      }
    };
    loadTeachers();
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
      const yg = yearGroups.find((g) => g.id === form.year_group_id);
      const chosenHomerooms = homerooms.filter((h) => form.homeroom_ids.includes(h.id));
      const base = {
        school_id: schoolId,
        name: form.name.trim(),
        year_group_id: form.year_group_id || '',
        year_group_name: yg?.name || '',
        room: form.room || '',
        notes: form.notes || '',
      };
      const payload = type === 'subject'
        ? {
          ...base,
          subject: form.subject.trim(),
          homeroom_ids: form.homeroom_ids,
          homeroom_names: chosenHomerooms.map((h) => h.name),
          owner_member_id: klass?.owner_member_id || member?.id || '',
        }
        : base;

      let saved = klass;
      if (klass) {
        saved = await base44.entities[type === 'subject' ? 'SubjectClass' : 'HomeroomClass'].update(klass.id, payload);
      } else {
        saved = await base44.entities[type === 'subject' ? 'SubjectClass' : 'HomeroomClass'].create({ ...payload, archived: false, student_count: 0 });
      }

      if (type === 'subject' || teacherIds.length || (klass && teacherIds.length === 0)) {
        const existing = await base44.entities.ClassTeacher.filter({ school_id: schoolId, class_id: saved.id }, { limit: 50 });
        const existingItems = existing.items || [];
        for (const link of existingItems) {
          if (!teacherIds.includes(link.member_id)) await base44.entities.ClassTeacher.delete(link.id);
        }
        for (const tid of teacherIds) {
          const memberRec = teachers.find((t) => t.id === tid);
          const found = existingItems.find((l) => l.member_id === tid);
          if (found) {
            await base44.entities.ClassTeacher.update(found.id, { is_primary: tid === primaryId });
          } else {
            await base44.entities.ClassTeacher.create({
              school_id: schoolId,
              class_type: type,
              class_id: saved.id,
              class_name: saved.name,
              member_id: tid,
              user_id: memberRec?.user_id || '',
              member_name: memberRec?.full_name || '',
              is_primary: tid === primaryId,
            });
          }
        }
      }

      notifySuccess(klass ? 'Class updated' : 'Class created', saved.name);
      onSaved(saved);
      onOpenChange(false);
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
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : klass ? 'Save changes' : 'Create class'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}