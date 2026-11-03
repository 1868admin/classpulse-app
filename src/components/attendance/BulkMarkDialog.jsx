import { useMemo, useState } from 'react';
import moment from 'moment';
import { CheckCheck, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notifyError, notifySuccess } from '@/lib/notify';
import { ATTENDANCE_STATUSES } from '@/lib/dates';
import { ClassSelect, SESSION_CHOICES, selectClass, useAttendanceClasses } from './AttendanceImportDialog';

const call = async (body) => {
  const response = await base44.functions.invoke('bulkAttendance', body);
  if (response.data?.error) throw new Error(response.data.error);
  return response.data;
};

export default function BulkMarkDialog({ open, onOpenChange, onSaved }) {
  const { classes, loading, error: loadError } = useAttendanceClasses(open);
  const today = moment().format('YYYY-MM-DD');
  const [classKey, setClassKey] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [sessionChoice, setSessionChoice] = useState('both');
  const [status, setStatus] = useState('present');
  const [overwrite, setOverwrite] = useState(false);
  const [data, setData] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const [classType, classId] = classKey.split('|');
  const sessions = SESSION_CHOICES.find((item) => item.value === sessionChoice).sessions;
  const dates = useMemo(() => (data?.dates || []).filter((item) => !item.skipped), [data]);

  const reset = () => { setData(null); setOverrides({}); setError(''); setOverwrite(false); };
  const close = (next) => { if (busy) return; if (!next) reset(); onOpenChange(next); };

  const loadStudents = async () => {
    setBusy('load'); setError('');
    try {
      const result = await call({ action: 'template_data', class_type: classType, class_id: classId, start_date: start, end_date: end });
      if (!result.students.length) throw new Error('This class has no students.');
      if (!result.dates.some((item) => !item.skipped)) throw new Error('No school days fall inside the selected dates.');
      setData(result);
      setOverrides({});
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setBusy(''); }
  };

  const apply = async () => {
    setBusy('save'); setError('');
    try {
      const cells = [];
      let row = 0;
      for (const item of dates) {
        for (const session of sessions) {
          for (const student of data.students) {
            row += 1;
            cells.push({ row, student_id_no: student.student_id_no, date: item.date, session, status: overrides[student.id] || status });
          }
        }
      }
      const result = await call({
        action: 'commit', source: 'bulk_mark', class_type: classType, class_id: classId, academic_year: data.academic_year.name,
        cells, overwrite, file_name: 'Bulk mark',
      });
      notifySuccess('Attendance saved', `${result.created} added · ${result.updated} updated · ${result.unchanged + result.skipped_existing} existing preserved.`);
      onSaved?.();
      close(false);
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setError(message);
      notifyError('Attendance was not saved', message);
    } finally { setBusy(''); }
  };

  const adjusted = Object.keys(overrides).length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Bulk-mark class attendance</DialogTitle>
          <DialogDescription>Apply one status to every student for a date or date range, then adjust individual students before saving.</DialogDescription>
        </DialogHeader>
        {(error || loadError) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">{error || loadError}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1 block text-xs">Class</Label>
            <ClassSelect classes={classes} value={classKey} onChange={(value) => { setClassKey(value); reset(); }} loading={loading} />
          </div>
          <div><Label className="mb-1 block text-xs">From</Label><Input type="date" value={start} onChange={(event) => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value); reset(); }} /></div>
          <div><Label className="mb-1 block text-xs">To</Label><Input type="date" value={end} min={start} onChange={(event) => { setEnd(event.target.value); reset(); }} /></div>
          <div>
            <Label className="mb-1 block text-xs">Sessions</Label>
            <select className={selectClass} value={sessionChoice} onChange={(event) => setSessionChoice(event.target.value)} aria-label="Sessions">
              {SESSION_CHOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Status for all students</Label>
            <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
              {ATTENDANCE_STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </div>
        </div>

        {!data ? (
          <div>
            <Button type="button" onClick={loadStudents} disabled={!classId || !start || !end || !!busy}>
              {busy === 'load' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="mr-1.5 h-3.5 w-3.5" />}
              Load students
            </Button>
          </div>
        ) : (
          <section className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {data.class.name} · {data.academic_year.name} · {data.students.length} students · {dates.length} school day(s) × {sessions.join(' + ')}
              {data.dates.some((item) => item.skipped) && ' · weekends and no-school days are skipped'}
            </p>
            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="cp-table-head"><tr><th className="p-2">Student ID</th><th className="p-2">Name</th><th className="p-2">Status</th></tr></thead>
                <tbody>
                  {data.students.map((student) => (
                    <tr key={student.id} className="border-t border-border/60">
                      <td className="p-2">{student.student_id_no}</td>
                      <td className="p-2">{student.first_name} {student.surname}</td>
                      <td className="p-2">
                        <select
                          className={`${selectClass} h-8 max-w-[10rem] py-0`}
                          value={overrides[student.id] || status}
                          aria-label={`Status for ${student.first_name} ${student.surname}`}
                          onChange={(event) => setOverrides((current) => {
                            const next = { ...current };
                            if (event.target.value === status) delete next[student.id]; else next[student.id] = event.target.value;
                            return next;
                          })}
                        >
                          {ATTENDANCE_STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <Checkbox checked={overwrite} onCheckedChange={(value) => setOverwrite(value === true)} className="mt-0.5" />
              <span>Overwrite existing attendance for these dates
                <span className="block text-xs text-muted-foreground">Unticked, registers that already have a record for a student are preserved and only missing records are added. AM and PM are saved separately.</span>
              </span>
            </label>
            {adjusted > 0 && <p className="text-xs text-muted-foreground">{adjusted} student(s) adjusted individually.</p>}
          </section>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={!!busy}>Cancel</Button>
          {data && <Button type="button" onClick={apply} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save attendance'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
