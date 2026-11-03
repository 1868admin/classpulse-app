import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { notifyError } from '@/lib/notify';
import { downloadIssueReport } from '@/lib/spreadsheet';

const STEPS = ['Template', 'Upload', 'Preview', 'Summary'];
const TONES = {
  good: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-destructive',
  warn: 'text-amber-700 dark:text-amber-400',
  neutral: 'text-foreground',
};

const errorText = (error) => error?.response?.data?.error || error?.message || 'Something went wrong.';

/**
 * Shared shell for every bulk import: download template → upload → preview/validation → confirm → summary.
 * Each import supplies its own template, parser, preview and commit callbacks.
 */
export default function ImportWizard({
  open, onOpenChange, title, description, instructions, templateControls,
  onDownload, formats = ['xlsx', 'csv'], downloadDisabled = false,
  parseFile, runPreview, runCommit, options = [], allowSkipInvalid = false,
  confirmLabel = 'Confirm import', reportName = 'import-errors.csv', onDone,
}) {
  const [step, setStep] = useState('start');
  const [fileName, setFileName] = useState('');
  const [payload, setPayload] = useState(null);
  const [preview, setPreview] = useState(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [choices, setChoices] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  const reset = () => {
    setStep('start'); setFileName(''); setPayload(null); setPreview(null);
    setSkipInvalid(false); setChoices({}); setResult(null); setError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const close = (next) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const download = async (format) => {
    setBusy(`download-${format}`);
    setError('');
    try { await onDownload(format); } catch (err) { setError(errorText(err)); } finally { setBusy(''); }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy('preview');
    setError('');
    setFileName(file.name);
    try {
      const parsed = await parseFile(file);
      const checked = await runPreview(parsed);
      setPayload({ ...parsed, file_name: file.name });
      setPreview(checked);
      setSkipInvalid(false);
      setChoices({});
      setStep('preview');
    } catch (err) {
      setError(errorText(err));
      setPayload(null);
      setPreview(null);
      if (fileInput.current) fileInput.current.value = '';
    } finally {
      setBusy('');
    }
  };

  const confirm = async () => {
    setBusy('commit');
    setError('');
    try {
      const outcome = await runCommit(payload, { skipInvalid, ...choices, fingerprint: preview.fingerprint });
      setResult(outcome);
      setStep('done');
      onDone?.(outcome);
    } catch (err) {
      setError(errorText(err));
      notifyError('Import was not saved', errorText(err));
    } finally {
      setBusy('');
    }
  };

  const issues = preview?.issues || [];
  const blockedByErrors = issues.length > 0 && !(allowSkipInvalid && skipInvalid);
  const canConfirm = !!preview && preview.importable > 0 && !blockedByErrors && !preview.blocker && !busy;
  const stepIndex = step === 'start' ? 1 : step === 'preview' ? 2 : 3;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Import steps">
          {STEPS.map((label, index) => (
            <li key={label} className={`flex items-center gap-1.5 ${index <= stepIndex ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${index < stepIndex || (step === 'done' && index === 3) ? 'bg-primary text-primary-foreground' : 'border border-border'}`}>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {error && (
          <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{error}</span>
          </div>
        )}

        {step === 'start' && (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-3 rounded-xl border border-border p-3">
              <h3 className="text-sm font-semibold">1. Download a template</h3>
              {instructions && <p className="text-xs text-muted-foreground">{instructions}</p>}
              {templateControls}
              <div className="flex flex-wrap gap-2">
                {formats.includes('xlsx') && (
                  <Button type="button" size="sm" disabled={downloadDisabled || !!busy} onClick={() => download('xlsx')}>
                    {busy === 'download-xlsx' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Download Excel template
                  </Button>
                )}
                {formats.includes('csv') && (
                  <Button type="button" size="sm" variant="outline" disabled={downloadDisabled || !!busy} onClick={() => download('csv')}>
                    {busy === 'download-csv' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />}
                    Download CSV template
                  </Button>
                )}
              </div>
            </section>
            <section className="space-y-3 rounded-xl border border-border p-3">
              <h3 className="text-sm font-semibold">2. Upload the completed spreadsheet</h3>
              <p className="text-xs text-muted-foreground">Accepts .xlsx and .csv files up to 10 MB. The file is checked and previewed before anything is saved.</p>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                id="import-file"
                disabled={!!busy}
                onChange={(event) => upload(event.target.files?.[0])}
              />
              <Button type="button" size="sm" variant="secondary" disabled={!!busy} onClick={() => fileInput.current?.click()}>
                {busy === 'preview' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                {busy === 'preview' ? 'Checking file…' : 'Choose file'}
              </Button>
              {fileName && <p className="break-all text-xs text-muted-foreground">{fileName}</p>}
            </section>
          </div>
        )}

        {step === 'preview' && preview && (
          <section className="space-y-3">
            <p className="break-all text-xs text-muted-foreground">{fileName}{preview.heading ? ` · ${preview.heading}` : ''}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {preview.stats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border p-2.5">
                  <div className={`text-xl font-bold ${TONES[stat.tone || 'neutral']}`}>{stat.value}</div>
                  <div className="text-[11px] text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
            {preview.blocker && <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{preview.blocker}</p>}

            {issues.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-destructive">{issues.length} validation issue{issues.length === 1 ? '' : 's'}</h3>
                  <Button type="button" size="sm" variant="outline" onClick={() => downloadIssueReport(reportName, issues)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />Download error report
                  </Button>
                </div>
                <div className="max-h-56 overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="cp-table-head"><tr><th className="p-2">Row</th><th className="p-2">Column</th><th className="p-2">Reference</th><th className="p-2">Problem</th></tr></thead>
                    <tbody>
                      {issues.slice(0, 100).map((issue, index) => (
                        <tr key={`${issue.row}-${issue.column}-${index}`} className="border-t border-border/60 align-top">
                          <td className="p-2">{issue.row || '—'}</td><td className="p-2">{issue.column || '—'}</td>
                          <td className="p-2 break-words">{issue.reference || '—'}</td><td className="p-2 break-words text-destructive">{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {issues.length > 100 && <p className="text-xs text-muted-foreground">Showing the first 100. Download the error report for all {issues.length}.</p>}
                <p className="text-xs text-muted-foreground">Correct the spreadsheet and upload it again{allowSkipInvalid ? ', or import only the valid records below' : ''}.</p>
              </div>
            )}

            {preview.rows?.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead className="cp-table-head"><tr>{preview.columns.map((column) => <th key={column.key} className="p-2">{column.label}</th>)}</tr></thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map((row, index) => (
                      <tr key={index} className="border-t border-border/60 align-top">
                        {preview.columns.map((column) => <td key={column.key} className="p-2 break-words">{row[column.key] ?? '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.rows?.length > 200 && <p className="text-xs text-muted-foreground">Showing the first 200 of {preview.rows.length} rows.</p>}

            <div className="space-y-2 rounded-lg bg-muted/40 p-3">
              {allowSkipInvalid && issues.length > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={skipInvalid} onCheckedChange={(value) => setSkipInvalid(value === true)} className="mt-0.5" />
                  <span>Skip the invalid records and import only the valid ones. Invalid records are not saved.</span>
                </label>
              )}
              {options.filter((option) => option.show?.(preview) ?? true).map((option) => (
                <label key={option.key} className="flex items-start gap-2 text-sm">
                  <Checkbox checked={!!choices[option.key]} onCheckedChange={(value) => setChoices((current) => ({ ...current, [option.key]: value === true }))} className="mt-0.5" />
                  <span>{option.label}{option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}</span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">The import is saved as a single all-or-nothing operation and recorded in the audit log.</p>
            </div>
          </section>
        )}

        {step === 'done' && result && (
          <section className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
            <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" />{result.title}</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">{result.lines.map((line) => <li key={line}>{line}</li>)}</ul>
          </section>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 'done' ? (
            <>
              <Button type="button" variant="outline" onClick={reset}>Import another file</Button>
              <Button type="button" onClick={() => close(false)}>Close</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => (step === 'preview' ? reset() : close(false))} disabled={!!busy}>
                {step === 'preview' ? 'Choose a different file' : 'Cancel'}
              </Button>
              {step === 'preview' && (
                <Button type="button" onClick={confirm} disabled={!canConfirm}>
                  {busy === 'commit' ? 'Importing…' : confirmLabel}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
