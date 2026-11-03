import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { notifyError, notifySuccess } from '@/lib/notify';
import { base44 } from '@/api/base44Client';

const HEADER_ALIASES = {
  full_name: ['fullname', 'name', 'teachername', 'staffname'],
  teacher_number: ['teachernumber', 'teacherno', 'staffnumber'],
  employment_status: ['employmentstatus', 'status'],
  employment_start_date: ['employmentstartdate', 'startdate'],
  effective_date: ['effectivedate', 'departuredate', 'leavedate', 'returndate'],
  employment_reason: ['employmentreason', 'reason', 'notes'],
  subject_specialisms: ['subjectspecialisms', 'specialisations', 'specializations', 'qualifiedsubjects'],
  homeroom_classes: ['homeroomclasses', 'homeroom', 'homeroomassignments'],
  subject_classes: ['subjectclasses', 'teachingassignments', 'assignedclasses'],
  year_dean: ['yeardean', 'yeargroupdean'],
};

function normalizeRows(rawRows) {
  return rawRows.map((raw) => {
    const values = {};
    for (const [header, value] of Object.entries(raw)) {
      const normalized = header.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
      const field = Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0];
      if (!field) continue;
      if (field.includes('date') && value instanceof Date) values[field] = value.toISOString().slice(0, 10);
      else if (field.includes('date') && typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        values[field] = parsed ? `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}` : '';
      } else values[field] = value;
    }
    return values;
  }).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

export default function StaffImportDialog({ open, onOpenChange, onImported }) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const readFile = async (file) => {
    setBusy(true);
    setFileName(file.name);
    setPreview(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The workbook does not contain a worksheet.');
      const parsed = normalizeRows(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
      if (!parsed.length) throw new Error('The first worksheet does not contain teacher rows.');
      if (parsed.length > 500) throw new Error('Import at most 500 teachers at a time.');
      setRows(parsed);
    } catch (error) {
      setRows([]);
      notifyError('Could not read staffing file', error.message);
    } finally {
      setBusy(false);
    }
  };

  const review = async () => {
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manageStaff', { action: 'import_preview', rows });
      if (response.data?.error) throw new Error(response.data.error);
      setPreview(response.data);
    } catch (error) {
      notifyError('Could not validate staffing file', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manageStaff', { action: 'import_apply', rows });
      if (response.data?.error) throw new Error(response.data.error);
      notifySuccess('Staffing import complete', `${response.data.created} created · ${response.data.updated} updated · ${response.data.assignments_added} assignments added.`);
      onImported();
      onOpenChange(false);
      setRows([]);
      setPreview(null);
    } catch (error) {
      notifyError('Could not apply staffing import', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const close = (nextOpen) => {
    if (!nextOpen && !busy) {
      setRows([]);
      setPreview(null);
      setFileName('');
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk staffing import</DialogTitle>
          <DialogDescription>Import teacher profiles, employment status, subject specialisations, class assignments, and Year Dean responsibility. Existing Teacher Numbers identify profiles and are never replaced.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
          }} />
          {fileName && <p className="text-xs text-muted-foreground">{fileName} · {rows.length} row(s)</p>}
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            Expected headers include Full Name, Teacher Number, Employment Status, Employment Start Date, Subject Specialisations, Homeroom Classes, Subject Classes, and Year Dean. Separate multiple subjects or classes with commas or semicolons. Class and year references must already exist.
          </div>
          {preview && (
            <section className="space-y-2">
              <div className="flex flex-wrap gap-3 text-sm">
                <span>{preview.summary.create} new</span><span>{preview.summary.update} updates</span>
                <span className={preview.summary.invalid ? 'text-destructive' : 'text-emerald-700'}>{preview.summary.invalid} invalid</span>
              </div>
              <div className="max-h-72 overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[700px] text-left text-xs">
                  <thead className="cp-table-head"><tr><th className="p-2">Row</th><th className="p-2">Teacher</th><th className="p-2">Teacher Number</th><th className="p-2">Action</th><th className="p-2">Employment</th><th className="p-2">Validation</th></tr></thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.row} className="border-t border-border/60 align-top">
                        <td className="p-2">{row.row}</td><td className="p-2 break-words">{row.full_name || '—'}</td>
                        <td className="p-2">{row.teacher_number || '—'}</td><td className="p-2 capitalize">{row.operation}</td>
                        <td className="p-2">{row.employment_status.replace('_', ' ')}</td>
                        <td className="p-2 break-words text-destructive">{row.errors.join('; ') || 'Ready'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.summary.invalid > 0 && <p className="text-xs text-muted-foreground">Correct the source spreadsheet and select it again. The import is atomic and cannot be partially applied.</p>}
            </section>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
          {!preview ? (
            <Button type="button" onClick={review} disabled={busy || !rows.length}>{busy ? 'Validating…' : 'Preview and validate'}</Button>
          ) : (
            <Button type="button" onClick={apply} disabled={busy || preview.summary.invalid > 0}>{busy ? 'Applying…' : 'Confirm import'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
