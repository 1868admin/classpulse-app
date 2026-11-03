import { useMemo, useState } from 'react';
import moment from 'moment';
import { CheckCheck, Loader2, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { buildBulkCells, fromIso, isSelectableDate, normalizeDates, toIso } from '@/lib/bulkDates';
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
  const [pickedDates, setPickedDates] = useState([]);
  const [sessionChoice, setSessionChoice] = useState('both');
  const [status, setStatus] = useState('present');
  const [overwrite, setOverwrite] = useState(false);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [statuses, setStatuses] = useState({});
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const [classType, classId] = classKey.split('|');
  const sessions = SESSION_CHOICES.find((item) => item.value === sessionChoice).sessions;
  const dates = pickedDates;
  const rules = useMemo(() => ({
    start: data?.academic_year.start_date || '', end: data?.academic_year.end_date || '', noSchool: data?.no_school_dates || [],
  }), [data]);

  const reset = () => { setPickedDates([]); setData(null); setSelected(new Set()); setStatuses({}); setSearch(''); setPreview(null); setError(''); setOverwrite(false); };
  const close = (next) => { if (busy) return; if (!next) reset(); onOpenChange(next); };

  const loadStudents = async () => {
    setBusy('load'); setError('');
    try {
      const result = await call({ action: 'template_data', class_type: classType, class_id: classId });
      if (!result.students.length) throw new Error('This class has no students.');
      setData(result);
      setSelected(new Set());
      setStatuses({});
      setPreview(null);
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setBusy(''); }
  };

  const statusOf = (student) => statuses[student.id] || status;
  const selectedStudents = useMemo(() => (data?.students || []).filter((student) => selected.has(student.id)), [data, selected]);
  const visibleStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data?.students || [];
    return (data?.students || []).filter((student) =>
      `${student.first_name} ${student.surname} ${student.surname} ${student.first_name} ${student.student_id_no}`.toLowerCase().includes(term));
  }, [data, search]);

  const change = (fn) => { setPreview(null); fn(); };
  const toggle = (id, checked) => change(() => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  }));
  const selectAll = () => change(() => setSelected(new Set(data.students.map((student) => student.id))));
  const deselectAll = () => change(() => setSelected(new Set()));
  const applyToSelected = () => change(() => setStatuses((current) => {
    const next = { ...current };
    for (const id of selected) next[id] = status;
    return next;
  }));

  const buildCells = () => buildBulkCells({ dates, sessions, students: selectedStudents, statusOf });
  const pickDates = (days) => change(() => setPickedDates(normalizeDates((days || []).map(toIso).filter((iso) => isSelectableDate(iso, rules)))));
  const removeDate = (iso) => change(() => setPickedDates((current) => current.filter((item) => item !== iso)));
  const payload = (extra) => ({
    class_type: classType, class_id: classId, academic_year: data.academic_year.name, cells: buildCells(), overwrite, ...extra,
  });

  const review = async () => {
    setBusy('review'); setError('');
    try {
      const result = await call({ action: 'preview', ...payload({ overwrite: undefined }) });
      setPreview(result);
    } catch (err) { setError(err.response?.data?.error || err.message); } finally { setBusy(''); }
  };

  const apply = async () => {
    setBusy('save'); setError('');
    try {
      const result = await call({
        action: 'commit', source: 'bulk_mark', ...payload(), fingerprint: preview.fingerprint, file_name: 'Bulk mark',
      });
      notifySuccess('Attendance saved', `${result.created} added · ${result.updated} updated · ${result.unchanged + result.skipped_existing} existing preserved.`);
      onSaved?.();
      close(false);
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setError(message);
      setPreview(null);
      notifyError('Attendance was not saved', message);
    } finally { setBusy(''); }
  };

  const summary = preview?.summary;
  const updating = summary ? (overwrite ? summary.updates : 0) : 0;
  const preservedRecords = summary ? summary.unchanged + (overwrite ? 0 : summary.updates) : 0;
  const unselectedCount = (data?.students.length || 0) - selected.size;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Bulk-mark class attendance</DialogTitle>
          <DialogDescription>Select students, apply a status to only those students, adjust individuals, then review and confirm. Unselected students are never changed.</DialogDescription>
        </DialogHeader>
        {(error || loadError) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">{error || loadError}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1 block text-xs">Class</Label>
            <ClassSelect classes={classes} value={classKey} onChange={(value) => { setClassKey(value); reset(); }} loading={loading} />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Sessions</Label>
            <select className={selectClass} value={sessionChoice} onChange={(event) => change(() => setSessionChoice(event.target.value))} aria-label="Sessions">
              {SESSION_CHOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Status to apply</Label>
            <select className={selectClass} value={status} onChange={(event) => change(() => setStatus(event.target.value))} aria-label="Status">
              {ATTENDANCE_STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </div>
        </div>

        {!data ? (
          <div>
            <Button type="button" onClick={loadStudents} disabled={!classId || !!busy}>
              {busy === 'load' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="mr-1.5 h-3.5 w-3.5" />}
              Load students
            </Button>
          </div>
        ) : (
          <section className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {data.class.name} · {data.academic_year.name} · {data.students.length} students · {dates.length} date(s) × {sessions.join(' + ')}
            </p>
            <div className="space-y-2 rounded-lg border border-border p-2 sm:p-3">
              <Label className="block text-xs">Dates (tap days to add or remove; weekends, no-school days and days outside {data.academic_year.name} are unavailable)</Label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <Calendar
                  mode="multiple"
                  selected={dates.map(fromIso)}
                  onSelect={pickDates}
                  defaultMonth={dates.length ? fromIso(dates[0]) : (rules.start && today < rules.start ? fromIso(rules.start) : undefined)}
                  disabled={(day) => !isSelectableDate(toIso(day), rules)}
                  showOutsideDays={false}
                  className="mx-auto rounded-md border border-border p-2 sm:mx-0"
                />
                <div className="min-w-0 flex-1" aria-live="polite">
                  <p className="mb-1 text-xs font-medium">{dates.length} date(s) selected</p>
                  {dates.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {dates.map((iso) => (
                        <li key={iso} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                          {moment(iso).format('ddd D MMM YYYY')}
                          <button type="button" onClick={() => removeDate(iso)} aria-label={`Remove ${iso}`} className="rounded-full p-0.5 hover:bg-background"><X className="h-3 w-3" /></button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground">No dates selected yet.</p>}
                  {dates.length > 0 && <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => pickDates([])}>Clear dates</Button>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or Student ID" aria-label="Search students" className="h-8 max-w-xs" />
              <Button type="button" size="sm" variant="outline" onClick={selectAll}>Select all</Button>
              <Button type="button" size="sm" variant="outline" onClick={deselectAll}>Deselect all</Button>
              <Button type="button" size="sm" onClick={applyToSelected} disabled={!selected.size}>Apply {ATTENDANCE_STATUSES.find((item) => item.key === status)?.label} to selected</Button>
              <span className="text-xs text-muted-foreground" aria-live="polite">{selected.size} of {data.students.length} selected</span>
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="cp-table-head"><tr><th className="w-8 p-2" /><th className="p-2">Student ID</th><th className="p-2">Name</th><th className="p-2">Status to save</th></tr></thead>
                <tbody>
                  {visibleStudents.map((student) => {
                    const checked = selected.has(student.id);
                    return (
                      <tr key={student.id} className="border-t border-border/60">
                        <td className="p-2"><Checkbox checked={checked} onCheckedChange={(value) => toggle(student.id, value === true)} aria-label={`Select ${student.first_name} ${student.surname}`} /></td>
                        <td className="p-2">{student.student_id_no}</td>
                        <td className="p-2">{student.first_name} {student.surname}</td>
                        <td className="p-2">
                          {checked ? (
                            <select
                              className={`${selectClass} h-8 max-w-[10rem] py-0`}
                              value={statusOf(student)}
                              aria-label={`Status for ${student.first_name} ${student.surname}`}
                              onChange={(event) => change(() => setStatuses((current) => ({ ...current, [student.id]: event.target.value })))}
                            >
                              {ATTENDANCE_STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                            </select>
                          ) : <span className="text-muted-foreground">Unchanged</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!visibleStudents.length && <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No students match your search.</td></tr>}
                </tbody>
              </table>
            </div>
            <label className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <Checkbox checked={overwrite} onCheckedChange={(value) => change(() => setOverwrite(value === true))} className="mt-0.5" />
              <span>Overwrite existing attendance for these dates
                <span className="block text-xs text-muted-foreground">Unticked, registers that already have a record for a student are preserved and only missing records are added. AM and PM are saved separately.</span>
              </span>
            </label>
            {summary && (
              <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-sm" role="status">
                <p className="font-medium">Review before saving</p>
                <p>Students selected: {selected.size}</p>
                <p>Dates ({dates.length}): {dates.map((iso) => moment(iso).format('D MMM YYYY')).join(', ')}</p>
                <p>Sessions: {sessions.join(' + ')}</p>
                <p>Attendance records to create: {summary.created}</p>
                <p>Existing records to update: {updating}</p>
                <p>Students left unchanged: {unselectedCount}</p>
                <p>Existing records left unchanged: {preservedRecords}</p>
                {summary.invalid > 0 && <p className="text-destructive">{summary.invalid} entries are invalid and will block saving.</p>}
              </div>
            )}
          </section>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={!!busy}>Cancel</Button>
          {data && !preview && <Button type="button" onClick={review} disabled={!!busy || !selected.size || !dates.length}>{busy === 'review' ? 'Checking…' : 'Review changes'}</Button>}
          {data && preview && <Button type="button" onClick={apply} disabled={!!busy || summary.invalid > 0}>{busy === 'save' ? 'Saving…' : 'Confirm and save'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
