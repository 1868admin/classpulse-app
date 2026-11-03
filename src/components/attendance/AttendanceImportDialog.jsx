import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import ImportWizard from '@/components/imports/ImportWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { findAttendanceGrid, parseAttendanceGrid } from '@/lib/attendanceSheet';
import { downloadAttendanceTemplate } from '@/lib/importTemplates';
import { readWorkbook } from '@/lib/spreadsheet';
import moment from 'moment';

export const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const call = async (body) => {
  const response = await base44.functions.invoke('bulkAttendance', body);
  if (response.data?.error) throw new Error(response.data.error);
  return response.data;
};

export function useAttendanceClasses(open) {
  const [state, setState] = useState({ classes: [], years: [], loading: false, error: '' });
  useEffect(() => {
    if (!open) return;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    call({ action: 'classes' })
      .then((data) => active && setState({ classes: data.classes, years: data.academic_years, loading: false, error: '' }))
      .catch((error) => active && setState({ classes: [], years: [], loading: false, error: error.message }));
    return () => { active = false; };
  }, [open]);
  return state;
}

export function ClassSelect({ classes, value, onChange, loading = false }) {
  return (
    <select className={selectClass} value={value} onChange={(event) => onChange(event.target.value)} aria-label="Class">
      <option value="">{loading ? 'Loading classes…' : 'Choose a class…'}</option>
      <optgroup label="Homeroom classes">
        {classes.filter((item) => item.type === 'homeroom').map((item) => <option key={item.id} value={`homeroom|${item.id}`}>{item.name}</option>)}
      </optgroup>
      <optgroup label="Subject classes">
        {classes.filter((item) => item.type === 'subject').map((item) => <option key={item.id} value={`subject|${item.id}`}>{item.name}</option>)}
      </optgroup>
    </select>
  );
}

export const SESSION_CHOICES = [
  { value: 'both', label: 'AM and PM', sessions: ['AM', 'PM'] },
  { value: 'AM', label: 'AM only', sessions: ['AM'] },
  { value: 'PM', label: 'PM only', sessions: ['PM'] },
];

export default function AttendanceImportDialog({ open, onOpenChange, onImported, initialClass = '' }) {
  const { classes, loading, error } = useAttendanceClasses(open);
  const [classKey, setClassKey] = useState(initialClass);
  const [start, setStart] = useState(moment().startOf('month').format('YYYY-MM-DD'));
  const [end, setEnd] = useState(moment().endOf('month').format('YYYY-MM-DD'));
  const [sessionChoice, setSessionChoice] = useState('both');
  const [skippedNote, setSkippedNote] = useState('');

  const [classType, classId] = classKey.split('|');
  const sessions = useMemo(() => SESSION_CHOICES.find((item) => item.value === sessionChoice).sessions, [sessionChoice]);

  const onDownload = async (format) => {
    if (!classId) throw new Error('Choose a class first.');
    const data = await call({ action: 'template_data', class_type: classType, class_id: classId, start_date: start, end_date: end });
    await downloadAttendanceTemplate(data, sessions, format);
    const skipped = data.dates.filter((item) => item.skipped).length;
    setSkippedNote(skipped ? `${skipped} weekend, no-school or out-of-year day(s) were left out of the template.` : '');
  };

  const parseFile = async (file) => {
    const grid = findAttendanceGrid(await readWorkbook(file));
    if (!grid) throw new Error('No attendance worksheet was found. Use a template downloaded from ClassPulse.');
    return parseAttendanceGrid(grid);
  };

  const request = (payload, extra = {}) => call({
    class_id: payload.class_id, class_type: payload.class_type, academic_year: payload.academic_year,
    cells: payload.cells, blank_count: payload.blank_count, file_name: payload.file_name, ...extra,
  });

  const runPreview = async (payload) => {
    if (!payload.cells.length) {
      throw new Error('The spreadsheet has no attendance entries. Blank cells mean "no change", so there is nothing to import.');
    }
    const result = await request(payload, { action: 'preview' });
    const { summary } = result;
    return {
      heading: `${result.class.name} · ${result.academic_year.name} · ${payload.student_rows} student row(s)`,
      fingerprint: result.fingerprint,
      importable: summary.created + summary.updates,
      meta: summary,
      stats: [
        { label: 'Records detected', value: summary.detected },
        { label: 'Valid records', value: summary.valid, tone: 'good' },
        { label: 'Invalid records', value: summary.invalid, tone: summary.invalid ? 'bad' : 'neutral' },
        { label: 'New records', value: summary.created, tone: 'good' },
        { label: 'Existing records to update', value: summary.updates, tone: summary.updates ? 'warn' : 'neutral' },
        { label: 'Unchanged (same as existing)', value: summary.unchanged },
        { label: 'Blank cells (no change)', value: summary.blank },
      ],
      issues: result.issues.map((issue) => ({
        row: issue.row, column: issue.column,
        reference: [issue.student_id_no, issue.date, issue.session].filter(Boolean).join(' · '),
        message: issue.message,
      })),
      columns: [
        { key: 'row', label: 'Row' }, { key: 'student', label: 'Student' }, { key: 'date', label: 'Date' },
        { key: 'session', label: 'Session' }, { key: 'previous', label: 'Current' }, { key: 'status', label: 'Imported' }, { key: 'action', label: 'Action' },
      ],
      rows: result.changes.map((change) => ({
        row: change.row,
        student: `${change.student_id_no} ${change.student_name}`,
        date: change.date, session: change.session,
        previous: change.previous || '—', status: change.status,
        action: change.action === 'update' ? 'Update' : 'New',
      })),
    };
  };

  const runCommit = async (payload, options) => {
    const result = await request(payload, {
      action: 'commit', overwrite: !!options.overwrite, skip_invalid: !!options.skipInvalid, fingerprint: options.fingerprint,
    });
    return {
      title: 'Attendance import complete',
      lines: [
        `${result.created} new attendance record(s) saved`,
        `${result.updated} existing record(s) updated`,
        `${result.unchanged + result.skipped_existing} existing record(s) left unchanged`,
        `${result.blank} blank cell(s) ignored`,
        ...(result.skipped_invalid ? [`${result.skipped_invalid} invalid record(s) skipped`] : []),
        `${result.sessions_created} register(s) created, ${result.sessions_updated} existing register(s) updated`,
      ],
    };
  };

  return (
    <ImportWizard
      open={open}
      onOpenChange={onOpenChange}
      title="Bulk attendance import"
      description="Download a class template, complete it in Excel, then upload it. Blank cells never change existing attendance."
      instructions="Choose the class, dates and sessions. The template is generated from the current class list."
      templateControls={(
        <div className="space-y-2">
          <div>
            <Label className="mb-1 block text-xs">Class</Label>
            <ClassSelect classes={classes} value={classKey} onChange={setClassKey} loading={loading} />
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="mb-1 block text-xs">Start date</Label><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></div>
            <div><Label className="mb-1 block text-xs">End date</Label><Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></div>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Sessions</Label>
            <select className={selectClass} value={sessionChoice} onChange={(event) => setSessionChoice(event.target.value)} aria-label="Sessions">
              {SESSION_CHOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          {skippedNote && <p className="text-xs text-muted-foreground">{skippedNote}</p>}
        </div>
      )}
      downloadDisabled={!classId || !start || !end}
      onDownload={onDownload}
      parseFile={parseFile}
      runPreview={runPreview}
      runCommit={runCommit}
      allowSkipInvalid
      options={[{
        key: 'overwrite',
        label: 'I authorise updating existing attendance records that differ from this file',
        hint: 'Left unticked, existing records are preserved and only new records are added.',
        show: (preview) => preview.meta.updates > 0,
      }]}
      confirmLabel="Confirm and save attendance"
      reportName="attendance-import-errors.csv"
      onDone={onImported}
    />
  );
}
