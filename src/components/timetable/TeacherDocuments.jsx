import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadPdf, fetchDocumentCatalog, printPdf } from '@/lib/documents';
import { notifyError } from '@/lib/notify';

const DOCUMENTS = [
  { kind: 'teacher_timetable', label: 'My timetable', countKey: 'timetable', file: 'my-timetable.pdf' },
  { kind: 'teacher_supervision', label: 'My supervision schedule', countKey: 'supervision', file: 'my-supervision-schedule.pdf' },
];

export default function TeacherDocuments() {
  const [own, setOwn] = useState(null);
  const [yearId, setYearId] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchDocumentCatalog()
      .then((data) => { if (!cancelled) { setOwn(data.own || {}); setYearId(data.academic_year_id || ''); } })
      .catch(() => { if (!cancelled) setOwn({}); });
    return () => { cancelled = true; };
  }, []);

  const run = async (document, action) => {
    setBusy(`${document.kind}:${action}`);
    try {
      const params = { kind: document.kind, academic_year_id: yearId };
      if (action === 'print') await printPdf(params);
      else await downloadPdf(params, document.file);
    } catch (error) {
      notifyError(error, 'Could not open the document');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="cp-card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-bold">My documents</h2>
        <p className="text-xs text-muted-foreground">Published schedules only. Download a PDF or print directly.</p>
      </div>
      <div className="divide-y divide-border/60">
        {DOCUMENTS.map((document) => {
          const available = (own?.[document.countKey] || 0) > 0;
          return (
            <div key={document.kind} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold">{document.label}</p>
                <p className="text-xs text-muted-foreground">
                  {own === null ? 'Checking...' : available ? `${own[document.countKey]} published entr${own[document.countKey] === 1 ? 'y' : 'ies'}` : 'Not published yet'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!available || Boolean(busy)} onClick={() => run(document, 'download')}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />Download PDF
                </Button>
                <Button size="sm" variant="outline" disabled={!available || Boolean(busy)} onClick={() => run(document, 'print')}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" />Print
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
