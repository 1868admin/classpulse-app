import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Trash2, Archive, RotateCcw, Users, UserPlus, UserMinus, Tag, ArrowUpCircle } from 'lucide-react';
import ConfirmDialog from '@/components/ui-bits/ConfirmDialog';

export default function BulkActionsBar({ count, yearGroups, homerooms, subjectClasses, onAction, canDelete, canManage }) {
  const [dialog, setDialog] = useState(null);
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!count) return null;

  const open = (name) => { setValue(''); setDialog(name); };

  const run = async (action, payload) => {
    setBusy(true);
    try { await onAction(action, payload); } finally { setBusy(false); setDialog(null); }
  };

  const options = {
    year: yearGroups.map((g) => ({ id: g.id, name: g.name, extra: g.name })),
    homeroom: homerooms.map((h) => ({ id: h.id, name: `${h.name}${h.year_group_name ? ` · ${h.year_group_name}` : ''}`, extra: h.year_group_name })),
    class: subjectClasses.map((c) => ({ id: c.id, name: `${c.name}`, extra: c.subject })),
    status: ['active', 'inactive', 'transferred', 'graduated'].map((s) => ({ id: s, name: s })),
  };

  const dialogConfig = {
    year: { title: 'Assign year group', label: 'Year group', key: 'year', action: 'assign_year_group' },
    homeroom: { title: 'Assign homeroom', label: 'Homeroom class', key: 'homeroom', action: 'assign_homeroom' },
    class: { title: 'Add to subject class', label: 'Subject class', key: 'class', action: 'add_to_class' },
    removeClass: { title: 'Remove from subject class', label: 'Subject class', key: 'class', action: 'remove_from_class' },
    status: { title: 'Change status', label: 'Status', key: 'status', action: 'change_status' },
  };

  const cfg = dialogConfig[dialog];

  const confirmConfig = {
    delete: {
      title: `Archive ${count} student${count === 1 ? '' : 's'}?`,
      description: 'Archived students are hidden from the active roll but their attendance history is preserved. You can restore them at any time from the Archived filter.',
      label: 'Archive students',
      action: 'delete',
      payload: {},
      destructive: true,
    },
    permanent: {
      title: `Permanently delete ${count} student${count === 1 ? '' : 's'}?`,
      description: 'This removes the student records and their class memberships. Attendance history linked to these students will no longer be reachable. This cannot be undone.',
      label: 'Delete permanently',
      action: 'permanent_delete',
      payload: {},
      destructive: true,
    },
    archive: { title: `Archive ${count} student(s)?`, description: 'They will be moved to the archive and can be restored later.', label: 'Archive', action: 'archive', payload: {} },
    restore: { title: `Restore ${count} student(s)?`, description: 'They will return to the active roll.', label: 'Restore', action: 'restore', payload: {} },
  };

  return (
    <>
      <div className="sticky bottom-3 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card p-2.5 shadow-lg">
        <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{count} selected</span>
        {canManage && (
          <>
            <Button size="sm" variant="outline" onClick={() => open('year')}><ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" />Year group</Button>
            <Button size="sm" variant="outline" onClick={() => open('homeroom')}><Users className="mr-1.5 h-3.5 w-3.5" />Homeroom</Button>
            <Button size="sm" variant="outline" onClick={() => open('class')}><UserPlus className="mr-1.5 h-3.5 w-3.5" />Add to class</Button>
            <Button size="sm" variant="outline" onClick={() => open('removeClass')}><UserMinus className="mr-1.5 h-3.5 w-3.5" />Remove from class</Button>
            <Button size="sm" variant="outline" onClick={() => open('status')}><Tag className="mr-1.5 h-3.5 w-3.5" />Status</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm('archive')}><Archive className="mr-1.5 h-3.5 w-3.5" />Archive</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm('restore')}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Restore</Button>
          </>
        )}
        {canDelete && (
          <>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm('delete')}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Archive / delete</Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirm('permanent')}>Delete permanently</Button>
          </>
        )}
      </div>

      <Dialog open={!!cfg} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{cfg?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label className="text-[13px]">{cfg?.label}</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {(options[cfg?.key] || []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              disabled={!value || busy}
              onClick={() => {
                const chosen = (options[cfg.key] || []).find((o) => o.id === value);
                const payload = cfg.key === 'year'
                  ? { year_group_id: value, year_group_name: chosen?.extra || '' }
                  : cfg.key === 'homeroom'
                    ? { homeroom_class_id: value, homeroom_class_name: chosen?.name?.split(' · ')[0] || '', year_group_id: '' }
                    : cfg.key === 'class'
                      ? { class_id: value }
                      : { status: value };
                run(cfg.action, payload);
              }}
            >
              {busy ? 'Working…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirm && (
        <ConfirmDialog
          open={!!confirm}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirmConfig[confirm].title}
          description={confirmConfig[confirm].description}
          confirmLabel={confirmConfig[confirm].label}
          destructive={confirmConfig[confirm].destructive}
          onConfirm={() => onAction(confirmConfig[confirm].action, confirmConfig[confirm].payload)}
        />
      )}
    </>
  );
}