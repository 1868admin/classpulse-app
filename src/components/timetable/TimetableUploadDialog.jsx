import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseCSV, toCSV, downloadFile } from '@/lib/csv';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import { notifySuccess, notifyError } from '@/lib/notify';
import { Upload, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';

const FIELDS = [
  { key: 'day_name', label: 'Day', required: true },
  { key: 'period_number', label: 'Period', required: true },
  { key: 'start_time', label: 'Start time' },
  { key: 'end_time', label: 'End time' },
  { key: 'subject', label: 'Subject' },
  { key: 'class_name', label: 'Class' },
  { key: 'room', label: 'Room' },
  { key: 'notes', label: 'Notes' },
];

export default function TimetableUploadDialog({ open, onOpenChange, memberId, subjectClasses, academicYearId, canCreateClasses, onSaved }) {
  const { schoolId, school } = useSchool();
  const fileRef = useRef(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [createMissing, setCreateMissing] = useState(true);

  useEffect(() => {
    if (!open) return;
    setRows([]); setHeaders([]); setMapping({}); setFileName(''); setResult(null);
  }, [open]);

  const template = () => {
    const days = school?.day_names || ['Day 1', 'Day 2'];
    const content = toCSV(
      ['Day', 'Period', 'Start time', 'End time', 'Subject', 'Class', 'Room', 'Notes'],
      [
        [days[0], '1', '08:30', '09:20', 'Physics', 'Form 4A Physics', 'Lab 2', ''],
        [days[0], '2', '09:20', '10:10', 'Physics', 'Form 4B Physics', 'Lab 2', ''],
        [days[1] || days[0], '3', '10:30', '11:20', 'Mathematics', 'Form 4A Maths', 'R12', 'Bring calculators'],
      ],
    );
    downloadFile('classpulse-timetable-template.csv', content);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const parsed = parseCSV(await file.text());
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    const auto = {};
    FIELDS.forEach((f) => {
      const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
      const match = parsed.headers.find((h) => norm(h) === norm(f.label) || norm(h) === norm(f.key));
      if (match) auto[f.key] = match;
    });
    setMapping(auto);
  };

  const mapped = useMemo(() => rows.map((r) => {
    const out = {};
    FIELDS.forEach((f) => { if (mapping[f.key]) out[f.key] = r[mapping[f.key]] || ''; });
    if (out.period_number) out.period_number = Number(String(out.period_number).replace(/[^0-9]/g, '')) || 0;
    return out;
  }), [rows, mapping]);

  const dayNames = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const analysis = useMemo(() => {
    const problems = [];
    const seen = new Set();
    const unmatched = new Map();
    mapped.forEach((r, i) => {
      const line = i + 2;
      if (!r.day_name) problems.push(`Row ${line}: no day given`);
      else if (!dayNames.some((d) => norm(d) === norm(r.day_name))) problems.push(`Row ${line}: "${r.day_name}" is not one of your timetable days`);
      if (!r.period_number) problems.push(`Row ${line}: no period number`);
      if (r.start_time && r.end_time && r.start_time >= r.end_time) problems.push(`Row ${line}: start time is after end time`);
      const key = `${norm(r.day_name)}|${r.period_number}`;
      if (seen.has(key)) problems.push(`Row ${line}: ${r.day_name} period ${r.period_number} appears twice`);
      seen.add(key);
      if (r.class_name && !subjectClasses.some((c) => norm(c.name) === norm(r.class_name))) {
        unmatched.set(r.class_name, { subject: r.subject || '' });
      }
    });
    return { problems, unmatched: [...unmatched.entries()] };
  }, [mapped, dayNames, subjectClasses]);

  const runImport = async () => {
    setBusy(true);
    try {
      let classes = subjectClasses;
      if (createMissing && analysis.unmatched.length && canCreateClasses) {
        const created = await base44.entities.SubjectClass.bulkCreate(analysis.unmatched.map(([name, meta]) => ({
          school_id: schoolId, name, subject: meta.subject || name, archived: false, student_count: 0,
          owner_member_id: memberId, homeroom_ids: [], homeroom_names: [],
        })));
        classes = [...subjectClasses, ...created];
      }
      const entries = mapped.map((r) => {
        const cls = classes.find((c) => norm(c.name) === norm(r.class_name));
        const dayMatch = dayNames.find((d) => norm(d) === norm(r.day_name));
        return {
          day_name: dayMatch || r.day_name,
          period_number: r.period_number,
          start_time: r.start_time,
          end_time: r.end_time,
          subject: r.subject || cls?.subject || '',
          class_name: r.class_name || cls?.name || '',
          subject_class_id: cls?.id || '',
          room: r.room,
          notes: r.notes,
        };
      });
      const res = await base44.functions.invoke('saveTimetableEntries', {
        entries,
        mode: 'replace',
        member_id: memberId,
        academic_year_id: academicYearId,
      });
      if (res.data?.error) throw new Error(res.data.error);
      setResult(res.data);
      notifySuccess('Timetable saved', `${res.data.saved} lesson(s) imported.`);
      onSaved();
    } catch (err) {
      notifyError('Import failed', err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = mapped.length > 0 && analysis.problems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Upload timetable</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={template}><Download className="mr-1.5 h-3.5 w-3.5" />Template</Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" />Choose CSV</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          {fileName && <span className="text-xs text-muted-foreground">{fileName} · {rows.length} row(s)</span>}
        </div>
        <p className="text-xs text-muted-foreground">Excel files: File → Save As → CSV, then upload the CSV here.</p>

        {headers.length > 0 && (
          <>
            <div className="rounded-xl border border-border p-3">
              <p className="mb-2 text-[13px] font-semibold">Column mapping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="w-24 shrink-0 text-[12px]">{f.label}{f.required && <span className="text-destructive">*</span>}</Label>
                    <Select value={mapping[f.key] || 'none'} onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === 'none' ? '' : v }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Not mapped" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not mapped</SelectItem>
                        {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="max-h-48 overflow-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="cp-table-head sticky top-0">
                  <tr>{FIELDS.filter((f) => mapping[f.key]).map((f) => <th key={f.key} className="px-2 py-1.5">{f.label}</th>)}</tr>
                </thead>
                <tbody>
                  {mapped.slice(0, 40).map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="px-2 py-1.5">{r[f.key] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {analysis.unmatched.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-semibold">{analysis.unmatched.length} class name(s) don't match your subject classes</p>
                <p className="mt-1">{analysis.unmatched.map(([n]) => n).join(', ')}</p>
                {canCreateClasses && (
                  <label className="mt-2 flex items-center gap-2">
                    <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} className="h-3.5 w-3.5 rounded border-border" />
                    Create these as new subject classes for me
                  </label>
                )}
              </div>
            )}

            <div className={`flex items-center gap-1.5 text-xs ${analysis.problems.length ? 'text-amber-600' : 'text-emerald-600'}`}>
              {analysis.problems.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {analysis.problems.length ? `${analysis.problems.length} problem(s) to fix in the file` : `${mapped.length} lessons ready to import`}
            </div>
            {analysis.problems.length > 0 && (
              <ul className="max-h-24 overflow-auto rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {analysis.problems.slice(0, 15).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!ready || busy} onClick={runImport}>{busy ? 'Importing…' : 'Confirm and save timetable'}</Button>
            </DialogFooter>
          </>
        )}

        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            Saved {result.saved} lesson(s). {result.archived ? `${result.archived} previous lesson(s) archived.` : ''}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}