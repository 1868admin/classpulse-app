import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { notifyError, notifySuccess } from '@/lib/notify';

const today = () => new Date().toISOString().slice(0, 10);
const statusLabel = (status) => ({ active: 'Active', on_leave: 'On leave', departed: 'Departed' }[status] || status);

export default function StaffEmploymentDialog({ open, onOpenChange, teacher, onChanged }) {
  const [status, setStatus] = useState('on_leave');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !teacher) return;
    const current = teacher.employment_status || 'active';
    setStatus(current === 'departed' ? 'active' : current === 'on_leave' ? 'active' : 'on_leave');
    setEffectiveDate(today());
    setReason('');
    setImpact(null);
  }, [open, teacher]);

  const body = () => ({
    member_id: teacher.id,
    employment_status: status,
    effective_date: effectiveDate,
    reason,
  });

  const preview = async () => {
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manageStaff', { action: 'employment_preview', ...body() });
      if (response.data?.error) throw new Error(response.data.error);
      setImpact(response.data.impact);
    } catch (error) {
      notifyError('Could not preview staffing impact', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manageStaff', { action: 'employment_change', ...body() });
      if (response.data?.error) throw new Error(response.data.error);
      notifySuccess('Employment status updated', `${teacher.full_name} is now ${statusLabel(status).toLowerCase()}.`);
      onChanged();
      onOpenChange(false);
    } catch (error) {
      notifyError('Could not update employment status', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const classes = impact?.classes || [];
  const lessons = impact?.timetable_entries || [];
  const duties = impact?.upcoming_invigilation_duties || [];
  const isDeparting = status === 'departed';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Update employment status{teacher ? ` · ${teacher.full_name}` : ''}</DialogTitle>
          <DialogDescription>Review staffing impact before confirming. Historical timetable and examination records are retained.</DialogDescription>
        </DialogHeader>
        {teacher?.employment_history?.length > 0 && (
          <section className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-bold">Employment history</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {[...teacher.employment_history].reverse().slice(0, 6).map((item, index) => (
                <li key={`${item.changed_at || item.effective_date}-${index}`} className="break-words">
                  {statusLabel(item.from_status)} → {statusLabel(item.to_status)} · {item.effective_date}{item.reason ? ` · ${item.reason}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs">New status</Label>
            <Select value={status} onValueChange={(value) => { setStatus(value); setImpact(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active / Reinstate</SelectItem>
                <SelectItem value="on_leave">On leave</SelectItem>
                <SelectItem value="departed">Departed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Effective date</Label>
            <Input type="date" value={effectiveDate} onChange={(event) => { setEffectiveDate(event.target.value); setImpact(null); }} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-xs">Administrative note / reason</Label>
            <Textarea value={reason} onChange={(event) => { setReason(event.target.value); setImpact(null); }} maxLength={500} rows={2} />
          </div>
        </div>
        {impact && (
          <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <p>Confirming will retain all history, end {classes.length} active class assignment(s), flag {lessons.length} timetable lesson(s), and flag {duties.length} upcoming supervision duty/duties for review.</p>
            </div>
            <p><strong>Affected students:</strong> {impact.affected_student_count || 0}</p>
            <div>
              <p className="font-semibold">Classes</p>
              <p className="break-words text-muted-foreground">{classes.map((item) => `${item.class_name} (${item.student_count} students)`).join(', ') || 'None'}</p>
            </div>
            {lessons.length > 0 && (
              <div>
                <p className="font-semibold">Timetable lessons requiring review</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {lessons.slice(0, 8).map((item) => <li key={item.id}>{item.day_name}, period {item.period_number} · {item.class_name || item.subject || 'Lesson'}</li>)}
                </ul>
              </div>
            )}
            {duties.length > 0 && (
              <div>
                <p className="font-semibold">Upcoming supervision duties</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {duties.slice(0, 8).map((item) => <li key={item.id}>{item.exam_date} · {item.exam_name} · {item.room}</li>)}
                </ul>
              </div>
            )}
            {status === 'active' && <p>Previous teaching assignments will not be restored; assign responsibilities after reinstatement review.</p>}
          </section>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {!impact ? (
            <Button type="button" onClick={preview} disabled={busy || !effectiveDate}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Preview impact
            </Button>
          ) : (
            <Button type="button" variant={isDeparting ? 'destructive' : 'default'} onClick={confirm} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {isDeparting ? 'Mark Teacher as Departed' : status === 'active' ? 'Reinstate Teacher' : 'Place on leave'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
