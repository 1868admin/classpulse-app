import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function DateAssignDialog({ open, onOpenChange, date, record, days, onSave }) {
  const [form, setForm] = useState({ day_type: 'cycle', day_name: '', reason: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      day_type: record?.day_type || 'cycle',
      day_name: record?.day_name || days[0],
      reason: record?.reason || '',
    });
  }, [open, record, days]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{date}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-[13px]">Day type</Label>
            <Select value={form.day_type} onValueChange={(v) => setForm((f) => ({ ...f, day_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cycle">Timetable day</SelectItem>
                <SelectItem value="no_school">No school</SelectItem>
                <SelectItem value="special">Special schedule</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.day_type === 'cycle' && (
            <div>
              <Label className="mb-1.5 block text-[13px]">Timetable day</Label>
              <Select value={form.day_name} onValueChange={(v) => setForm((f) => ({ ...f, day_name: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{days.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {form.day_type !== 'cycle' && (
            <div>
              <Label className="mb-1.5 block text-[13px]">Reason</Label>
              <Input
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder={form.day_type === 'no_school' ? 'Public holiday, closure…' : 'Exams, sports day, half day…'}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onSave({ ...form, day_name: form.day_type === 'cycle' ? form.day_name : '' }); onOpenChange(false); } finally { setBusy(false); }
            }}
          >
            {busy ? 'Saving…' : 'Save date'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkCalendarDialog({ open, onOpenChange, days, onApply }) {
  const [form, setForm] = useState({ from: '', to: '', day_type: 'cycle', day_name: days[0], reason: '', rotate: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm((f) => ({ ...f, day_name: days[0] }));
  }, [open, days]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Bulk calendar update</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[13px]">From</Label>
            <Input type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">To</Label>
            <Input type="date" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">Apply</Label>
            <Select value={form.day_type} onValueChange={(v) => setForm((f) => ({ ...f, day_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cycle">Timetable day</SelectItem>
                <SelectItem value="no_school">No school</SelectItem>
                <SelectItem value="special">Special schedule</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.day_type === 'cycle' && (
            <>
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-[13px]">Starting day</Label>
                <Select value={form.day_name} onValueChange={(v) => setForm((f) => ({ ...f, day_name: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{days.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                <input type="checkbox" checked={form.rotate} onChange={(e) => setForm((f) => ({ ...f, rotate: e.target.checked }))} className="h-3.5 w-3.5 rounded border-border" />
                Continue the cycle day by day (skips weekends)
              </label>
            </>
          )}
          {form.day_type !== 'cycle' && (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[13px]">Reason</Label>
              <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Term break" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy || !form.from || !form.to}
            onClick={async () => {
              setBusy(true);
              try { await onApply(form); onOpenChange(false); } finally { setBusy(false); }
            }}
          >
            {busy ? 'Applying…' : 'Apply to dates'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}