import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import { parseCSV, downloadFile } from '@/lib/csv';
import { notifySuccess, notifyError } from '@/lib/notify';
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';

const FIELDS = [
  { key: 'student_id_no', label: 'Student ID' },
  { key: 'birth_paper_no', label: 'Birth Paper Number' },
  { key: 'first_name', label: 'First name', required: true },
  { key: 'surname', label: 'Surname', required: true },
  { key: 'middle_name', label: 'Middle name' },
  { key: 'gender', label: 'Gender' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'guardian_name', label: 'Guardian name' },
  { key: 'guardian_phone', label: 'Guardian phone' },
  { key: 'address', label: 'Address' },
];

export default function ImportStudentsDialog({
  open,
  onOpenChange,
  yearGroups,
  homerooms,
  onImported,
  targetClassType = '',
  targetClassId = '',
  defaultYearGroupId = '',
  defaultHomeroomId = '',
}) {
  const { schoolId, member } = useSchool();
  const canManageSensitive = ['school_admin', 'it_admin'].includes(member?.role);
  const visibleFields = useMemo(
    () => FIELDS.filter((field) => canManageSensitive || field.key !== 'birth_paper_no'),
    [canManageSensitive],
  );
  const fileRef = useRef(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [yearGroupId, setYearGroupId] = useState('');
  const [homeroomId, setHomeroomId] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [existingConflicts, setExistingConflicts] = useState([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicateCheckError, setDuplicateCheckError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setHeaders([]); setRows([]); setMapping({}); setFileName('');
    setYearGroupId(defaultYearGroupId);
    setHomeroomId(defaultHomeroomId);
    setExistingConflicts([]); setDuplicateCheckError(''); setConfirmOpen(false);
    base44.entities.ImportJob.filter({ school_id: schoolId, type: 'students' }, { limit: 5, sort: '-created_date' })
      .then((p) => setHistory(p.items || []));
  }, [open, schoolId, defaultYearGroupId, defaultHomeroomId]);

  const downloadTemplate = () => {
    const headers = canManageSensitive
      ? ['Student ID', 'Birth Paper Number', 'First name', 'Surname', 'Middle name', 'Gender', 'Date of birth', 'Guardian name', 'Guardian phone', 'Address']
      : ['Student ID', 'First name', 'Surname', 'Middle name', 'Gender', 'Date of birth', 'Guardian name', 'Guardian phone', 'Address'];
    const sample = canManageSensitive
      ? ['', '', 'Alana', 'Baptiste', 'Marie', 'female', '2013-04-18', 'Joanne Baptiste', '868-555-0111', '12 Woodbrook, Port of Spain']
      : ['', 'Alana', 'Baptiste', 'Marie', 'female', '2013-04-18', 'Joanne Baptiste', '868-555-0111', '12 Woodbrook, Port of Spain'];
    const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Students');
    const content = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    downloadFile('classpulse-student-import-template.xlsx', content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

 // In src/components/students/ImportStudentsDialog.jsx

const onFile = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setFileName(file.name);
  try {
    const extension = file.name.split('.').at(-1)?.toLowerCase();
    let parsed = { headers: [], rows: [] };
    
    if (extension === 'csv') {
      parsed = parseCSV(await file.text());
    } else if (['xls', 'xlsx'].includes(extension)) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('Worksheet empty');
      const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
      const nonEmpty = matrix.filter((row) => row.some((value) => String(value).trim()));
      const extractedHeaders = (nonEmpty.shift() || []).map((value) => String(value).trim());
      
      parsed = {
        headers: extractedHeaders,
        rows: nonEmpty.map((row) => Object.fromEntries(extractedHeaders.map((header, idx) => [header, String(row[idx] ?? '').trim()]))),
      };
    }

    if (!parsed.headers.length) {
      throw new Error('No headers found in the uploaded file');
    }

    setHeaders(parsed.headers);
    setRows(parsed.rows);

    // Auto-map columns
    const auto = {};
    visibleFields.forEach((f) => {
      const fieldKeyClean = f.key.toLowerCase().replace(/_/g, '');
      const match = parsed.headers.find((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '').includes(fieldKeyClean));
      if (match) auto[f.key] = match;
    });
    setMapping(auto);
    setResult(null);
  } catch (error) {
    notifyError('Could not read spreadsheet', error.message);
    setHeaders([]);
    setRows([]);
  }
};
  const mapped = rows.map((r) => {
    const out = {};
    visibleFields.forEach((f) => { if (mapping[f.key]) out[f.key] = r[mapping[f.key]] || ''; });
    return out;
  });

  const problems = [];
  const seen = new Set();
  const seenPeople = new Set();
  const seenBirthNumbers = new Set();
  mapped.forEach((r, i) => {
    const studentId = String(r.student_id_no || '').trim().toLowerCase();
    if (studentId && seen.has(studentId)) problems.push(`Row ${i + 2}: duplicate ID ${r.student_id_no} in file`);
    if (studentId) seen.add(studentId);
    if (!r.first_name) problems.push(`Row ${i + 2}: first name missing`);
    if (!r.surname) problems.push(`Row ${i + 2}: surname missing`);
    if (r.date_of_birth && r.first_name && r.surname) {
      const person = `${[r.first_name, r.middle_name, r.surname].filter(Boolean).join(' ').toLowerCase()}|${r.date_of_birth}`;
      if (seenPeople.has(person)) problems.push(`Row ${i + 2}: duplicate name and date of birth in file`);
      seenPeople.add(person);
    }
    const birthNumber = String(r.birth_paper_no || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (birthNumber && seenBirthNumbers.has(birthNumber)) problems.push(`Row ${i + 2}: duplicate Birth Paper Number in file`);
    if (birthNumber) seenBirthNumbers.add(birthNumber);
  });

  useEffect(() => {
    let active = true;
    setExistingConflicts([]);
    setDuplicateCheckError('');
    setCheckingDuplicates(false);
    if (!rows.length || !schoolId) return () => { active = false; };
    const currentRows = rows.map((row) => {
      const output = {};
      visibleFields.forEach((field) => { if (mapping[field.key]) output[field.key] = row[mapping[field.key]] || ''; });
      return output;
    });
    const ids = [...new Set(currentRows.map((row) => String(row.student_id_no || '').trim()).filter(Boolean))];
    const names = [...new Set(currentRows.filter((row) => row.date_of_birth && row.first_name && row.surname)
      .map((row) => [row.first_name, row.middle_name, row.surname].filter(Boolean).join(' ')))];
    const birthNumbers = canManageSensitive
      ? [...new Set(currentRows.map((row) => String(row.birth_paper_no || '').trim()).filter(Boolean))]
      : [];
    const alternatives = [];
    if (ids.length) alternatives.push({ student_id_no: { $in: ids } });
    if (names.length) alternatives.push({ full_name: { $in: names } });
    if (birthNumbers.length) alternatives.push({ birth_paper_no: { $in: birthNumbers } });
    if (!alternatives.length) return () => { active = false; };
    setCheckingDuplicates(true);
    base44.entities.Student.filter({ school_id: schoolId, $or: alternatives }, { limit: 2000 })
      .then((page) => {
        if (!active) return;
        const existing = page.items || [];
        const idSet = new Set(existing.map((student) => String(student.student_id_no || '').toLowerCase()));
        const people = new Set(existing.filter((student) => student.date_of_birth)
          .map((student) => `${String(student.full_name || '').toLowerCase()}|${student.date_of_birth}`));
        const conflicts = [];
        currentRows.forEach((row, index) => {
          if (row.student_id_no && idSet.has(String(row.student_id_no).trim().toLowerCase())) {
            conflicts.push(`Row ${index + 2}: student ID "${row.student_id_no}" already exists`);
          }
          const person = `${[row.first_name, row.middle_name, row.surname].filter(Boolean).join(' ').toLowerCase()}|${row.date_of_birth}`;
          if (row.date_of_birth && people.has(person)) conflicts.push(`Row ${index + 2}: student with matching name & DOB exists`);
        });
        setExistingConflicts(conflicts);
      })
      .catch((error) => { if (active) setDuplicateCheckError(`Could not check existing students: ${error.message}`); })
      .finally(() => { if (active) setCheckingDuplicates(false); });
    return () => { active = false; };
  }, [rows, mapping, schoolId, visibleFields, canManageSensitive]);

  const allProblems = [...problems, ...existingConflicts];
  const canImport = mapped.length > 0 && allProblems.length === 0 && !checkingDuplicates && !duplicateCheckError;

  const runImport = async () => {
    setBusy(true);
    const effectiveYearGroupId = yearGroupId || defaultYearGroupId;
    const effectiveHomeroomId = targetClassType === 'homeroom' ? targetClassId : homeroomId || defaultHomeroomId;
    const yg = yearGroups.find((g) => g.id === effectiveYearGroupId);
    const hr = homerooms.find((h) => h.id === effectiveHomeroomId);
    try {
      const res = await base44.functions.invoke('importStudents', {
        rows: mapped.map((row) => (canManageSensitive ? row : { ...row, birth_paper_no: '' })),
        file_name: fileName || 'students.csv',
        defaults: {
          year_group_id: effectiveYearGroupId || '',
          year_group_name: yg?.name || '',
          homeroom_class_id: effectiveHomeroomId || '',
          homeroom_class_name: hr?.name || '',
          class_type: targetClassType,
          class_id: targetClassId,
        },
      });

      const payload = res?.data ?? res;
      if (payload?.error) throw new Error(payload.error);
      setResult(payload);

      if (payload?.imported > 0) {
        notifySuccess('Import complete', `${payload.imported} student(s) added.`);
        if (typeof onImported === 'function') onImported();
      } else {
        const errorDetail = payload?.errors?.length 
          ? payload.errors.map(e => typeof e === 'string' ? e : `Row ${e.row}: ${e.reason}`).join('; ') 
          : 'Record already exists or was skipped.';
        notifyError('Import skipped', `0 students imported. ${errorDetail}`);
      }
      const p = await base44.entities.ImportJob.filter({ school_id: schoolId, type: 'students' }, { limit: 5, sort: '-created_date' });
      setHistory(p.items || []);
    } catch (err) {
      notifyError('Import failed', err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Import students</DialogTitle></DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="mr-1.5 h-3.5 w-3.5" />Template</Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" />Choose spreadsheet</Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          {fileName && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileSpreadsheet className="h-3.5 w-3.5" />{fileName} · {rows.length} row(s)</span>}
        </div>

        {headers.length > 0 && (
          <>
            <div className="rounded-xl border border-border p-3">
              <p className="mb-2 text-[13px] font-semibold">Column mapping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleFields.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="w-28 shrink-0 text-[12px]">{f.label}{f.required && <span className="text-destructive">*</span>}</Label>
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`flex items-center gap-1.5 text-xs ${allProblems.length ? 'text-amber-600' : 'text-emerald-600'}`}>
                {allProblems.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {allProblems.length ? `${allProblems.length} issue(s) — fix before importing` : `${mapped.length} rows ready to import`}
              </p>
              <Button size="sm" disabled={!canImport || busy} onClick={() => setConfirmOpen(true)}>
                {busy ? 'Importing…' : `Import ${mapped.length} student(s)`}
              </Button>
            </div>
          </>
        )}

        {result && (
          <div className={`rounded-xl border p-4 text-xs ${result.imported > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            <p className="font-semibold">Import finished: {result.imported || 0} student(s) added, {result.skipped || 0} skipped.</p>
            {result.errors?.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-destructive">Details / Reasons:</p>
                <ul className="mt-1 list-disc list-inside space-y-0.5 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>{typeof e === 'string' ? e : `Row ${e.row}: ${e.reason}`}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {confirmOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
              <h3 className="text-base font-semibold">Confirm student import</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Import {mapped.length} valid student record(s)? Existing records will not be overwritten.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
                <Button onClick={() => { setConfirmOpen(false); runImport(); }} disabled={busy}>{busy ? 'Importing…' : 'Confirm import'}</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}