import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import ImportWizard from '@/components/imports/ImportWizard';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadTeacherTemplate } from '@/lib/importTemplates';
import { gridToObjects, readWorkbook } from '@/lib/spreadsheet';

const ALIASES = {
  full_name: ['fullname', 'name', 'teachername', 'staffname'],
  teacher_number: ['teachernumber', 'teacherno', 'staffnumber'],
  employment_status: ['employmentstatus', 'status'],
  employment_start_date: ['employmentstartdate', 'startdate'],
  effective_date: ['effectivedate', 'departuredate', 'leavedate', 'returndate'],
  employment_reason: ['employmentreason', 'reason', 'notes', 'employmentnotes'],
  subject_specialisms: ['subjectspecialisms', 'subjectspecialisations', 'specialisations', 'specializations', 'qualifiedsubjects'],
  homeroom_classes: ['homeroomclasses', 'homeroom', 'homeroomassignments'],
  subject_classes: ['subjectclasses', 'teachingassignments', 'assignedclasses'],
  year_dean: ['yeardean', 'yeargroupdean'],
};
const DATE_FIELDS = ['employment_start_date', 'effective_date'];

const call = async (body) => {
  try {
    const response = await base44.functions.invoke('manageStaff', body);
    if (response.data?.error) throw new Error(response.data.error);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || error.message);
  }
};

export default function StaffImportDialog({ open, onOpenChange, onImported }) {
  const [includeExisting, setIncludeExisting] = useState(false);

  const onDownload = async (format) => {
    const data = await call({ action: 'import_template_data' });
    await downloadTeacherTemplate(data, { format, includeExisting });
  };

  const parseFile = async (file) => {
    const sheets = await readWorkbook(file);
    const sheet = sheets.find((item) => !['instructions', 'lists'].includes(item.name.toLowerCase())) || sheets[0];
    const rows = gridToObjects(sheet.rows, ALIASES, DATE_FIELDS);
    if (!rows.length) throw new Error('The worksheet does not contain teacher rows.');
    if (rows.length > 500) throw new Error('Import at most 500 teachers at a time.');
    return { rows };
  };

  const runPreview = async (payload) => {
    const result = await call({ action: 'import_preview', rows: payload.rows });
    const { summary } = result;
    return {
      importable: summary.create + summary.update,
      stats: [
        { label: 'Rows detected', value: summary.total },
        { label: 'New teachers', value: summary.create, tone: 'good' },
        { label: 'Existing teachers updated', value: summary.update, tone: summary.update ? 'warn' : 'neutral' },
        { label: 'Invalid rows', value: summary.invalid, tone: summary.invalid ? 'bad' : 'neutral' },
      ],
      issues: result.rows.flatMap((row) => row.errors.map((message) => ({ row: row.row, reference: row.teacher_number || row.full_name, message }))),
      columns: [
        { key: 'row', label: 'Row' }, { key: 'name', label: 'Teacher' }, { key: 'number', label: 'Teacher Number' },
        { key: 'action', label: 'Action' }, { key: 'status', label: 'Employment' }, { key: 'notes', label: 'Validation' },
      ],
      rows: result.rows.map((row) => ({
        row: row.row, name: row.full_name || '—', number: row.teacher_number || '—', action: row.operation,
        status: (row.employment_status || '').replace('_', ' '), notes: row.errors.join('; ') || 'Ready',
      })),
    };
  };

  const runCommit = async (payload) => {
    const result = await call({ action: 'import_apply', rows: payload.rows });
    return {
      title: 'Staffing import complete',
      lines: [
        `${result.created} teacher profile(s) created`,
        `${result.updated} existing profile(s) updated`,
        `${result.assignments_added} class assignment(s) added`,
      ],
    };
  };

  return (
    <ImportWizard
      open={open}
      onOpenChange={onOpenChange}
      title="Bulk teacher import"
      description="Import teacher profiles, employment status, subject specialisations, class assignments and Year Dean responsibility. Existing Teacher Numbers identify profiles and are never replaced."
      instructions="Separate multiple subjects or classes with commas or semicolons. Class and year references must already exist. The import is all-or-nothing."
      templateControls={(
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={includeExisting} onCheckedChange={(value) => setIncludeExisting(value === true)} className="mt-0.5" />
          <span>Include current teachers in the template</span>
        </label>
      )}
      onDownload={onDownload}
      parseFile={parseFile}
      runPreview={runPreview}
      runCommit={runCommit}
      confirmLabel="Confirm teacher import"
      reportName="teacher-import-errors.csv"
      onDone={onImported}
    />
  );
}
