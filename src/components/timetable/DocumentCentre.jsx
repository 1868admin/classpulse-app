import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, Loader2, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { downloadPdf, fetchDocumentCatalog, fetchPdfBlob, fetchZipBlob, printPdf, saveBlob } from '@/lib/documents';
import { notifyError, notifySuccess } from '@/lib/notify';

const DOCUMENT_TYPES = [
  { id: 'master_timetable', label: 'Master timetable' },
  { id: 'teacher_timetable', label: 'Teacher timetable', target: 'teacher' },
  { id: 'class_timetable', label: 'Class timetable', target: 'class' },
  { id: 'room_timetable', label: 'Room timetable', target: 'room' },
  { id: 'examination_timetable', label: 'Examination timetable' },
  { id: 'teacher_supervision', label: 'Teacher supervision schedule', target: 'teacher' },
  { id: 'invigilation_schedule', label: 'Complete invigilation schedule' },
];

function CheckList({ title, items, selected, onChange }) {
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.value));
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <legend className="text-xs font-bold">{title} ({selected.size}/{items.length})</legend>
        <button
          type="button"
          className="text-xs font-semibold text-primary hover:underline"
          onClick={() => onChange(allSelected ? new Set() : new Set(items.map((item) => item.value)))}
        >
          {allSelected ? 'Clear' : 'Select all'}
        </button>
      </div>
      <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
        {items.length === 0 && <p className="text-xs text-muted-foreground">Nothing available for this year.</p>}
        {items.map((item) => (
          <label key={item.value} className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected.has(item.value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(item.value);
                else next.delete(item.value);
                onChange(next);
              }}
            />
            <span className="min-w-0 break-words">{item.label}{item.hint ? <span className="text-muted-foreground"> · {item.hint}</span> : null}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function DocumentCentre({ academicYears, academicYearId, onAcademicYearChange }) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState('published');
  const [type, setType] = useState('master_timetable');
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState({ url: '', label: '' });
  const [busy, setBusy] = useState('');
  const [teachers, setTeachers] = useState(new Set());
  const [classes, setClasses] = useState(new Set());
  const [rooms, setRooms] = useState(new Set());
  const [general, setGeneral] = useState(new Set());
  const [supervision, setSupervision] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      setCatalog(await fetchDocumentCatalog(academicYearId));
    } catch (error) {
      notifyError(error, 'Could not load the document centre');
    } finally {
      setLoading(false);
    }
  }, [academicYearId]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => () => { if (preview.url) URL.revokeObjectURL(preview.url); }, [preview.url]);
  useEffect(() => { setTarget(''); }, [type]);

  const typeInfo = DOCUMENT_TYPES.find((item) => item.id === type);
  const options = useMemo(() => {
    if (typeInfo?.target === 'teacher') return (catalog?.teachers || []).map((item) => ({ value: item.id, label: item.name }));
    if (typeInfo?.target === 'class') return (catalog?.classes || []).map((name) => ({ value: name, label: name }));
    if (typeInfo?.target === 'room') return (catalog?.rooms || []).map((name) => ({ value: name, label: name }));
    return [];
  }, [catalog, typeInfo]);

  const params = useCallback((kind, value) => ({
    kind,
    academic_year_id: catalog?.academic_year_id || academicYearId,
    scope,
    ...(value ? { [{ teacher: 'teacher_id', class: 'class_name', room: 'room' }[DOCUMENT_TYPES.find((item) => item.id === kind).target]]: value } : {}),
  }), [catalog, academicYearId, scope]);

  const needsTarget = Boolean(typeInfo?.target);
  const canGenerate = !needsTarget || Boolean(target);
  const filenameFor = () => `classpulse-${type.replace(/_/g, '-')}.pdf`;

  const runPreview = async () => {
    setBusy('preview');
    try {
      const blob = await fetchPdfBlob(params(type, target));
      setPreview({ url: URL.createObjectURL(blob), label: typeInfo.label });
    } catch (error) {
      notifyError(error, 'Could not generate the document');
    } finally {
      setBusy('');
    }
  };

  const runDownload = async () => {
    setBusy('download');
    try {
      await downloadPdf(params(type, target), filenameFor());
    } catch (error) {
      notifyError(error, 'Could not download the document');
    } finally {
      setBusy('');
    }
  };

  const runPrint = async () => {
    setBusy('print');
    try {
      await printPdf(params(type, target));
    } catch (error) {
      notifyError(error, 'Could not print the document');
    } finally {
      setBusy('');
    }
  };

  const bulkItems = useMemo(() => [
    ...[...general].map((kind) => ({ kind })),
    ...[...teachers].map((id) => ({ kind: 'teacher_timetable', teacher_id: id })),
    ...(supervision ? [...teachers].map((id) => ({ kind: 'teacher_supervision', teacher_id: id })) : []),
    ...[...classes].map((name) => ({ kind: 'class_timetable', class_name: name })),
    ...[...rooms].map((name) => ({ kind: 'room_timetable', room: name })),
  ], [general, teachers, supervision, classes, rooms]);

  const runZip = async () => {
    setBusy('zip');
    try {
      const blob = await fetchZipBlob({
        academic_year_id: catalog?.academic_year_id || academicYearId,
        scope,
        items: bulkItems,
      });
      saveBlob(blob, `classpulse-documents-${new Date().toISOString().slice(0, 10)}.zip`);
      notifySuccess('ZIP downloaded. Open manifest.txt to see any skipped documents.');
    } catch (error) {
      notifyError(error, 'Could not create the ZIP file');
    } finally {
      setBusy('');
    }
  };

  const toggleGeneral = (kind) => {
    const next = new Set(general);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setGeneral(next);
  };

  const summary = catalog?.lessons
    ? `${catalog.lessons.published}/${catalog.lessons.total} lessons published · ${catalog.examinations.published} published and ${catalog.examinations.draft} draft examinations`
    : '';

  return (
    <div className="space-y-4">
      <section className="cp-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="mb-1.5 text-xs font-medium">Academic year</p>
            <Select value={catalog?.academic_year_id || academicYearId} onValueChange={onAcademicYearChange}>
              <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
              <SelectContent>{academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}{year.is_current ? ' · Current' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">Schedule status</p>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="published">Published only (for distribution)</SelectItem>
                <SelectItem value="all">Include drafts (marked as draft)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={loadCatalog} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh schedule data
            </Button>
          </div>
        </div>
        {summary && <p className="mt-3 text-xs text-muted-foreground">{summary}</p>}
      </section>

      <section className="cp-card p-4">
        <h2 className="text-sm font-bold">Preview or download one document</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium">Document</p>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DOCUMENT_TYPES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {needsTarget && (
            <div>
              <p className="mb-1.5 text-xs font-medium">{typeInfo.target === 'teacher' ? 'Teacher' : typeInfo.target === 'class' ? 'Class' : 'Room'}</p>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue placeholder="Choose one" /></SelectTrigger>
                <SelectContent>{options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={runPreview} disabled={!canGenerate || Boolean(busy)}>
            {busy === 'preview' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            {preview.url ? 'Regenerate preview' : 'Preview'}
          </Button>
          <Button size="sm" variant="outline" onClick={runDownload} disabled={!canGenerate || Boolean(busy)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />Download PDF
          </Button>
          <Button size="sm" variant="outline" onClick={runPrint} disabled={!canGenerate || Boolean(busy)}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />Print
          </Button>
        </div>
        {preview.url && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Preview: {preview.label}. Regenerate after any schedule change.</p>
            <iframe title="PDF preview" src={preview.url} className="h-[70vh] w-full rounded-lg border border-border" />
          </div>
        )}
      </section>

      <section className="cp-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">Bulk export (ZIP)</h2>
            <p className="mt-1 text-xs text-muted-foreground">Select documents to bundle. Teachers or classes with nothing scheduled are skipped and listed in the manifest.</p>
          </div>
          <Button size="sm" onClick={runZip} disabled={!bulkItems.length || Boolean(busy)}>
            {busy === 'zip' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileArchive className="mr-1.5 h-3.5 w-3.5" />}
            Download ZIP ({bulkItems.length})
          </Button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-bold">School-wide documents</legend>
            {DOCUMENT_TYPES.filter((item) => !item.target).map((item) => (
              <label key={item.id} className="mt-1 flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" checked={general.has(item.id)} onChange={() => toggleGeneral(item.id)} />{item.label}
              </label>
            ))}
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={supervision} onChange={(event) => setSupervision(event.target.checked)} />
              Also add each selected teacher's supervision schedule
            </label>
          </fieldset>
          <CheckList
            title="Teacher timetables"
            items={(catalog?.teachers || []).map((item) => ({ value: item.id, label: item.name, hint: `${item.published_lessons} published` }))}
            selected={teachers}
            onChange={setTeachers}
          />
          <CheckList
            title="Class timetables"
            items={(catalog?.classes || []).map((name) => ({ value: name, label: name }))}
            selected={classes}
            onChange={setClasses}
          />
          <CheckList
            title="Room timetables"
            items={(catalog?.rooms || []).map((name) => ({ value: name, label: name }))}
            selected={rooms}
            onChange={setRooms}
          />
        </div>
      </section>
    </div>
  );
}
