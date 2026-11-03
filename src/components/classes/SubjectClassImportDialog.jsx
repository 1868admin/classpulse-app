import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import ImportWizard from '@/components/imports/ImportWizard';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadSubjectClassTemplate } from '@/lib/importTemplates';
import { gridToObjects, readWorkbook } from '@/lib/spreadsheet';

const ALIASES = {
  name: ['subjectclassname', 'classname', 'name'],
  subject: ['subject'],
  year_group: ['formyeargroup', 'yeargroup', 'form', 'year'],
  section: ['classsection', 'section', 'classidentifier', 'identifier'],
  academic_year: ['academicyear'],
  teachers: ['assignedteachers', 'assignedteacher', 'teachers', 'teacher'],
  students: ['studentids', 'studentid', 'students', 'associatedstudents'],
  homerooms: ['homeroomclasses', 'homerooms', 'homeroom'],
  room: ['room'],
  notes: ['notes'],
};

const call = async (body) => {
  try {
    const response = await base44.functions.invoke('bulkSubjectClasses', body);
    if (response.data?.error) throw new Error(response.data.error);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || error.message);
  }
};

export default function SubjectClassImportDialog({ open, onOpenChange, onImported }) {
  const [includeExisting, setIncludeExisting] = useState(false);

  const onDownload = async (format) => {
    const data = await call({ action: 'template_data' });
    await downloadSubjectClassTemplate(data, { format, includeExisting });
  };

  const parseFile = async (file) => {
    const sheets = await readWorkbook(file);
    const sheet = sheets.find((item) => item.name.toLowerCase() !== 'instructions' && item.name.toLowerCase() !== 'lists') || sheets[0];
    const rows = gridToObjects(sheet.rows, ALIASES);
    if (!rows.length) throw new Error('The worksheet has no subject class rows.');
    if (rows.length > 500) throw new Error('Import at most 500 subject classes at a time.');
    return { rows };
  };

  const runPreview = async (payload) => {
    const result = await call({ action: 'preview', rows: payload.rows });
    const { summary } = result;
    return {
      importable: summary.create + summary.update,
      fingerprint: '',
      stats: [
        { label: 'Rows detected', value: summary.total },
        { label: 'New classes', value: summary.create, tone: 'good' },
        { label: 'Existing classes extended', value: summary.update, tone: summary.update ? 'warn' : 'neutral' },
        { label: 'Unchanged', value: summary.unchanged },
        { label: 'Invalid rows', value: summary.invalid, tone: summary.invalid ? 'bad' : 'neutral' },
        { label: 'Teacher assignments to add', value: summary.teacher_assignments },
        { label: 'Student assignments to add', value: summary.student_assignments },
      ],
      issues: result.rows.flatMap((row) => row.errors.map((message) => ({ row: row.row, reference: row.name, message }))),
      columns: [
        { key: 'row', label: 'Row' }, { key: 'name', label: 'Class' }, { key: 'subject', label: 'Subject' },
        { key: 'year_group', label: 'Year group' }, { key: 'operation', label: 'Action' },
        { key: 'teachers', label: 'Teachers' }, { key: 'students', label: 'Students' }, { key: 'notes', label: 'Notes' },
      ],
      rows: result.rows.map((row) => ({
        row: row.row, name: row.name || '—', subject: row.subject, year_group: row.year_group,
        operation: row.operation, teachers: `${row.teachers.join(', ') || '—'}`,
        students: `${row.students} (+${row.students_to_add})`, notes: [...row.errors, ...row.warnings].join('; ') || 'Ready',
      })),
    };
  };

  const runCommit = async (payload, options) => {
    const result = await call({ action: 'commit', rows: payload.rows, skip_invalid: !!options.skipInvalid, file_name: payload.file_name });
    return {
      title: 'Subject class import complete',
      lines: [
        `${result.created} subject class(es) created`,
        `${result.updated} existing class(es) extended`,
        `${result.teachers_added} teacher assignment(s) added`,
        `${result.students_added} student assignment(s) added`,
        ...(result.skipped ? [`${result.skipped} invalid row(s) skipped`] : []),
      ],
    };
  };

  return (
    <ImportWizard
      open={open}
      onOpenChange={onOpenChange}
      title="Bulk subject class import"
      description="Create subject classes, assign several teachers and enrol students from one spreadsheet. Existing classes are only ever added to."
      instructions="Teachers are matched by Teacher Number and students by Student ID. Separate several values with commas or semicolons."
      templateControls={(
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={includeExisting} onCheckedChange={(value) => setIncludeExisting(value === true)} className="mt-0.5" />
          <span>Include my existing subject classes in the template</span>
        </label>
      )}
      onDownload={onDownload}
      parseFile={parseFile}
      runPreview={runPreview}
      runCommit={runCommit}
      allowSkipInvalid
      confirmLabel="Confirm subject class import"
      reportName="subject-class-import-errors.csv"
      onDone={onImported}
    />
  );
}
