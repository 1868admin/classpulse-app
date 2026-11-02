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
  yearGroups = [],
  homerooms = [],
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
  const [existingConflicts, setExistingConflicts] = useState([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setFileName('');
    setYearGroupId(defaultYearGroupId);
    setHomeroomId(defaultHomeroomId);
    setExistingConflicts([]);
    setConfirmOpen(false);
  }, [open, defaultYearGroupId, defaultHomeroomId]);

  const downloadTemplate = () => {
    const templateHeaders = canManageSensitive
      ? ['Student ID', 'Birth Paper Number', 'First name', 'Surname', 'Middle name', 'Gender', 'Date of birth', 'Guardian name', 'Guardian phone', 'Address']
      : ['Student ID', 'First name', 'Surname', 'Middle name', 'Gender', 'Date of birth', 'Guardian name', 'Guardian phone', 'Address'];
    const sample = canManageSensitive
      ? ['', '', 'Alana', 'Baptiste', 'Marie', 'female', '2013-04-18', 'Joanne Baptiste', '868-555-0111', '12 Woodbrook, Port of Spain']
      : ['', 'Alana', 'Baptiste', 'Marie', 'female', '2013-04-18', 'Joanne Baptiste', '868-555-0111', '12 Woodbrook, Port of Spain'];
    const sheet = XLSX.utils.aoa_to_sheet([templateHeaders, sample]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Students');
    const content = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    downloadFile('classpulse-student-import-template.xlsx', content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const extension = file.name.split('.').at(-1)?.toLowerCase();
      let detectedHeaders = [];
      let detectedRows = [];

      if (extension === 'csv') {
        const text = await file.text();
        const parsed = parseCSV(text);
        detectedHeaders = parsed.headers || [];
        detectedRows = parsed.rows || [];
      } else if (['xls', 'xlsx'].includes(extension)) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error('Spreadsheet has no worksheets.');
        const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
        const nonEmpty = matrix.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()));
        if (!nonEmpty.length) throw new Error('Spreadsheet is empty.');

        detectedHeaders = (nonEmpty[0] || []).map((cell) => String(cell ?? '').trim());
        detectedRows = nonEmpty.slice(1).map((rowArr) => {
          const rowObj = {};
          detectedHeaders.forEach((h, idx) => {
            if (h) rowObj[h] = String(rowArr[idx] ?? '').trim();
          });
          return rowObj;
        });
      } else {
        notifyError('Unsupported file', 'Choose an .xlsx, .xls or .csv file.');
        return;
      }

      if (!detectedHeaders.length) {
        throw new Error('No column headers found in file.');
      }

      setHeaders(detectedHeaders);
      setRows(detectedRows);

      const autoMapping = {};
      visibleFields.forEach((f) => {
        const fieldKeyClean = f.key.toLowerCase().replace(/_/g, '');
        const fieldLabelClean = f.label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const match = detectedHeaders.find((h) => {
          const headerClean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
          return headerClean === fieldKeyClean || headerClean === fieldLabelClean || headerClean.includes(fieldKeyClean);
        });
        if (match) autoMapping[f.key] = match;
      });

      setMapping(autoMapping);
      setResult(null);
    } catch (error) {
      notifyError('Could not read file', error.message);
      setHeaders([]);
      setRows([]);
    }
  };

  const mapped = useMemo(() => {
    return rows.map((r) => {
      const out = {};
      visibleFields.forEach((f) => {
        if (mapping[f.key]) out[f.key] = r[mapping[f.key]] || '';
      });
      return out;
    });
  }, [rows, mapping, visibleFields]);

  const problems = useMemo(() => {
    const list = [];
    const seenIds = new Set();
    const seenPeople = new Set();
    const seenBirthNums = new Set();
    mapped.forEach((r, i) => {
      const studentId = String(r.student_id_no || '').trim().toLowerCase();
      if (studentId && seenIds.has(studentId)) list.push(`Row ${i + 2}: duplicate Student ID "${r.student_id_no}" in file`);
      if (studentId) seenIds.add(studentId);
      if (!r.first_name) list.push(`Row ${i + 2}: First name missing`);
      if (!r.surname) list.push(`Row ${i + 2}: Surname missing`);
      if (r.date_of_birth && r.first_name && r.surname) {
        const personKey = `${[r.first_name, r.middle_name, r.surname].filter(Boolean).join(' ').toLowerCase()}|${r.date_of_birth}`;
        if (seenPeople.has(personKey)) list.push(`Row ${i + 2}: duplicate student name & DOB in file`);
        seenPeople.add(personKey);
      }
      const birthNumber = String(r.birth_paper_no || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (birthNumber && seenBirthNums.has(birthNumber)) list.push(`Row ${i + 2}: duplicate Birth Paper Number in file`);
      if (birthNumber) seenBirthNums.add(birthNumber);
    });
    return list;
  }, [mapped]);

  useEffect(() => {
    let active = true;
    setExistingConflicts([]);
    if (!rows.length || !schoolId) return;

    setCheckingDuplicates(true);
    base44.entities.Student.filter({ school_id: schoolId }, { limit: 2000 })
      .then((page) => {
        if (!active) return;
        const existingStudents = page.items || [];
        const existingIds = new Set(existingStudents.map((s) => String(s.student_id_no || '').toLowerCase()).filter(Boolean));
        const existingPeople = new Set(existingStudents.filter((s) => s.date_of_birth).map((s) => `${String(s.full_name || '').toLowerCase()}|${s.date_of_birth}`));

        const conflicts = [];
        mapped.forEach((row, index) => {
          if (row.student_id_no && existingIds.has(String(row.student_id_no).trim().toLowerCase())) {
            conflicts.push(`Row ${index + 2}: Student ID "${row.student_id_no}" already exists in database`);
          }
          const personKey = `${[row.first_name, row.middle_name, row.surname].filter(Boolean).join(' ').toLowerCase()}|${row.date_of_birth}`;
          if (row.date_of_birth && existingPeople.has(personKey)) {
            conflicts.push(`Row ${index + 2}: Student with matching name & DOB already exists in database`);
          }
        });
        setExistingConflicts(conflicts);
      })
      .catch(() => {})
      .finally(() => { if (active) setCheckingDuplicates(false); });

    return () => { active = false; };
  }, [rows, mapped, schoolId]);

  const allProblems = [...problems, ...existingConflicts];
  const canImport = mapped.length > 0 && allProblems.length === 0 && !checkingDuplicates;

  const runImport = async () => {
    setBusy(true);
    const effectiveYearGroupId = yearGroupId || defaultYearGroupId;
    const effectiveHomeroomId = targetClassType === 'homeroom' ? targetClassId : homeroomId || defaultHomeroomId;
    const yg = (yearGroups || []).find((g) => g.id === effectiveYearGroupId);
    const hr = (homerooms || []).find((h) => h.id === effectiveHomeroomId);
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
        notifySuccess('Import complete', `${payload.imported} student(s) added successfully.`);
        if (typeof onImported === 'function') onImported();
      } else {
        const errorDetail = payload?.errors?.length
          ? payload.errors.map(e => typeof e === 'string' ? e : `Row ${e.row}: ${e.reason}`).join('; ')
          : 'Record already exists or was skipped.';
        notifyError('Import notice', `0 students imported. ${errorDetail}`);
      }
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
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="mr-1.5 h-3.5 w-3.5" />Template
          </Button>
          <Button size="sm" onClick={() => { if (fileRef.current) fileRef.current.value = ''; fileRef.current?.click(); }}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />Choose spreadsheet
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          {fileName && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5" />{fileName} · {rows.length} row(s)
            </span>
          )}
        </div>

        {headers.length > 0 && (
          <div className="space-y-4 border-t pt-3">
            <div className="rounded-xl border border-border p-3">
              <p className="mb-2 text-[13px] font-semibold">Column mapping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleFields.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="w-28 shrink-0 text-[12px]">
                      {f.label}{f.required && <span className="text-destructive">*</span>}
                    </Label>
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
                {allProblems.length ? `${allProblems.length} issue(s) — resolve before importing` : `${mapped.length} rows ready to import`}
              </p>
              <Button size="sm" disabled={!canImport || busy} onClick={() => setConfirmOpen(true)}>
                {busy ? 'Importing…' : `Import ${mapped.length} student(s)`}
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className={`rounded-xl border p-4 text-xs ${result.imported > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            <p className="font-semibold">Import finished: {result.imported || 0} student(s) added, {result.skipped || 0} skipped.</p>
            {result.errors?.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-destructive">Skipped details:</p>
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
                <Button onClick={() => { setConfirmOpen(false); runImport(); }} disabled={busy}>
                  {busy ? 'Importing…' : 'Confirm import'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}