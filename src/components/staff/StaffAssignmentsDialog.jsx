import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notifyError, notifySuccess } from '@/lib/notify';
import { useSchool } from '@/context/SchoolContext';

const keyOf = (type, id) => `${type}|${id}`;

export default function StaffAssignmentsDialog({ open, onOpenChange, teacher, onChanged }) {
  const { schoolId } = useSchool();
  const [classes, setClasses] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [original, setOriginal] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!open || !teacher || !schoolId) return;
    setBusy(true);
    try {
      const [homerooms, subjects, links] = await Promise.all([
        base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 500, sort: 'name' }),
        base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 500, sort: 'name' }),
        base44.entities.ClassTeacher.filter({ school_id: schoolId, member_id: teacher.id, is_active: { $ne: false } }, { limit: 1000 }),
      ]);
      const available = [
        ...(homerooms.items || []).map((item) => ({ id: item.id, name: item.name, type: 'homeroom', detail: 'Homeroom' })),
        ...(subjects.items || []).map((item) => ({ id: item.id, name: item.name, type: 'subject', detail: item.subject || 'Subject' })),
      ].sort((a, b) => a.name.localeCompare(b.name));
      const active = new Set((links.items || []).map((item) => keyOf(item.class_type, item.class_id)));
      setClasses(available);
      setOriginal(active);
      setSelected(new Set(active));
      setPreview(null);
    } catch (error) {
      notifyError('Could not load teacher assignments', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  }, [open, teacher, schoolId]);

  useEffect(() => { void load(); }, [load]);

  const changes = () => classes.flatMap((item) => {
    const key = keyOf(item.type, item.id);
    if (selected.has(key) === original.has(key)) return [];
    return [{
      action: selected.has(key) ? 'assign' : 'remove',
      class_type: item.type,
      class_id: item.id,
      member_ids: [teacher.id],
    }];
  });

  const previewChanges = async () => {
    const pending = changes();
    if (!pending.length) return;
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manageStaff', { action: 'assignment_preview', changes: pending });
      if (response.data?.error) throw new Error(response.data.error);
      setPreview(response.data);
    } catch (error) {
      notifyError('Could not preview assignment changes', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview?.changes?.length) return;
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manageStaff', { action: 'assignment_apply', changes: preview.changes });
      if (response.data?.error) throw new Error(response.data.error);
      notifySuccess('Assignments updated', `${response.data.assigned} added · ${response.data.removed} removed.`);
      await load();
      onChanged();
    } catch (error) {
      notifyError('Could not save assignments', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const changeCount = changes().length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Teaching assignments{teacher ? ` · ${teacher.full_name}` : ''}</DialogTitle>
          <DialogDescription>Choose any number of homeroom and subject classes. Assignments are kept as history when removed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {['homeroom', 'subject'].map((type) => (
            <fieldset key={type} className="rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-bold">{type === 'homeroom' ? 'Homeroom responsibilities' : 'Subject classes'}</legend>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {classes.filter((item) => item.type === type).map((item) => {
                  const key = keyOf(item.type, item.id);
                  return (
                    <label key={key} className="flex min-w-0 items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={selected.has(key)} onChange={(event) => {
                        setPreview(null);
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        });
                      }} />
                      <span className="min-w-0 break-words">{item.name}<span className="block text-xs text-muted-foreground">{item.detail}</span></span>
                    </label>
                  );
                })}
                {!classes.some((item) => item.type === type) && <p className="text-xs text-muted-foreground">No active classes.</p>}
              </div>
            </fieldset>
          ))}
        </div>
        {preview && (
          <section className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-semibold">Change preview: {preview.changes.length} assignment change(s)</p>
            <p className="mt-1 text-muted-foreground">
              {preview.affected_timetable_entries.length} existing timetable lesson(s) and {preview.affected_invigilation_duties.length} supervision duty/duties touch these classes or this teacher. No schedule is changed automatically.
            </p>
            {preview.affected_timetable_entries.length > 0 && <p className="mt-2 break-words text-xs">{preview.affected_timetable_entries.slice(0, 8).map((item) => `${item.day_name} P${item.period_number} · ${item.class_name}`).join(' | ')}</p>}
          </section>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          {!preview ? (
            <Button type="button" onClick={previewChanges} disabled={busy || !changeCount}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Preview changes ({changeCount})
            </Button>
          ) : (
            <Button type="button" onClick={save} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm assignments
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
