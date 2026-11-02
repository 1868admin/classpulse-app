import { useCallback, useEffect, useMemo, useState } from 'react';
import moment from 'moment';
import { GraduationCap, Plus, CheckCircle2, Users, ArrowRight, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notifySuccess, notifyError } from '@/lib/notify';

export default function Academic() {
  const { schoolId, member, isStaff } = useSchool();
  const [years, setYears] = useState([]);
  const [terms, setTerms] = useState([]);
  const [yearGroups, setYearGroups] = useState([]);
  const [homerooms, setHomerooms] = useState([]);
  const [subjectClasses, setSubjectClasses] = useState([]);
  const [classLinks, setClassLinks] = useState([]);
  const [students, setStudents] = useState([]);
  const [sourceMembershipIds, setSourceMembershipIds] = useState(null);
  const [promotionHistory, setPromotionHistory] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [fromGroup, setFromGroup] = useState('all');
  const [promotionType, setPromotionType] = useState('homeroom');
  const [sourceClassId, setSourceClassId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [newYear, setNewYear] = useState({ name: '', start_date: '', end_date: '' });
  const [newTerm, setNewTerm] = useState({ name: 'Term 1', academic_year_id: '', start_date: '', end_date: '' });
  const [target, setTarget] = useState({
    year_group_id: '', homeroom_class_id: '', subject_class_id: '',
    academic_year_id: '', outcome: 'promoted',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) return;
    const [y, t, g, h, s, sc, links] = await Promise.all([
      base44.entities.AcademicYear.filter({ school_id: schoolId }, { limit: 50, sort: '-name' }),
      base44.entities.Term.filter({ school_id: schoolId }, { limit: 100, sort: 'name' }),
      base44.entities.YearGroup.filter({ school_id: schoolId }, { limit: 50, sort: 'level' }),
      base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 100, sort: 'name' }),
      base44.entities.Student.filter({ school_id: schoolId, archived: { $ne: true } }, { limit: 500, sort: 'surname' }),
      base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 200, sort: 'name' }),
      member && !isStaff
        ? base44.entities.ClassTeacher.filter({ school_id: schoolId, member_id: member.id }, { limit: 200 })
        : Promise.resolve({ items: [] }),
    ]);
    setYears(y.items || []);
    setTerms(t.items || []);
    setYearGroups(g.items || []);
    setHomerooms(h.items || []);
    setSubjectClasses(sc.items || []);
    setClassLinks(links.items || []);
    setStudents(s.items || []);
    setTarget((previous) => ({
      ...previous,
      academic_year_id: previous.academic_year_id || (y.items || []).find((year) => year.is_current)?.id || (y.items || [])[0]?.id || '',
    }));
    setNewTerm((n) => ({ ...n, academic_year_id: n.academic_year_id || (y.items || [])[0]?.id || '' }));
    setNewYear((n) => ({ ...n, name: n.name || (y.items || [])[0]?.name ? '' : n.name }));
  }, [schoolId, member, isStaff]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => students.filter((student) =>
      (sourceClassId ? sourceMembershipIds?.has(student.id) : isStaff)
      && (fromGroup === 'all' || student.year_group_id === fromGroup)),
    [students, fromGroup, sourceClassId, sourceMembershipIds, isStaff],
  );

  const sourceClasses = useMemo(() => {
    const classes = promotionType === 'subject' ? subjectClasses : homerooms;
    if (isStaff) return classes;
    const assigned = new Set(classLinks.filter((link) => link.class_type === promotionType).map((link) => link.class_id));
    return classes.filter((klass) => assigned.has(klass.id));
  }, [promotionType, subjectClasses, homerooms, isStaff, classLinks]);
  const sourceClass = sourceClasses.find((klass) => klass.id === sourceClassId);
  const destinationSubjectClasses = subjectClasses.filter((klass) =>
    (!sourceClass || String(klass.subject || '').trim().toLowerCase() === String(sourceClass.subject || '').trim().toLowerCase())
    && (!klass.academic_year_id || !target.academic_year_id || klass.academic_year_id === target.academic_year_id));
  const destinationHomerooms = homerooms.filter((klass) =>
    (!target.year_group_id || !klass.year_group_id || klass.year_group_id === target.year_group_id)
    && (!klass.academic_year_id || !target.academic_year_id || klass.academic_year_id === target.academic_year_id));

  useEffect(() => {
    setSourceMembershipIds(null);
    setPromotionHistory([]);
    if (!sourceClassId || !schoolId) return undefined;
    let active = true;
    Promise.all([
      base44.entities.ClassMembership.filter({
        school_id: schoolId, class_type: promotionType, class_id: sourceClassId,
      }, { limit: 1000 }),
      base44.entities.StudentEnrollment.filter({
        school_id: schoolId, class_type: promotionType, source_class_id: sourceClassId,
      }, { limit: 30, sort: '-created_date' }),
    ]).then(([membershipPage, historyPage]) => {
      if (!active) return;
      setSourceMembershipIds(new Set((membershipPage.items || []).map((item) => item.student_id)));
      setPromotionHistory(historyPage.items || []);
    }).catch((error) => {
      if (active) notifyError('Could not load class promotion data', error.message);
    });
    return () => { active = false; };
  }, [schoolId, sourceClassId, promotionType]);

  const addYear = async () => {
    if (!newYear.name.trim()) { notifyError('Name required', 'Enter the academic year, e.g. 2027/2028.'); return; }
    await base44.entities.AcademicYear.create({ school_id: schoolId, ...newYear, is_current: false });
    notifySuccess('Academic year added', newYear.name);
    setNewYear({ name: '', start_date: '', end_date: '' });
    load();
  };

  const addTerm = async () => {
    if (!newTerm.name.trim()) { notifyError('Name required', 'Enter the term name.'); return; }
    const yr = years.find((y) => y.id === newTerm.academic_year_id);
    await base44.entities.Term.create({ school_id: schoolId, ...newTerm, academic_year_name: yr?.name || '', is_current: false });
    notifySuccess('Term added', `${newTerm.name} · ${yr?.name || ''}`);
    setNewTerm({ name: 'Term 1', academic_year_id: newTerm.academic_year_id, start_date: '', end_date: '' });
    load();
  };

  const setCurrentYear = async (id) => {
    for (const y of years) await base44.entities.AcademicYear.update(y.id, { is_current: y.id === id });
    notifySuccess('Current year updated');
    load();
  };

  const reviewPromotion = () => {
    if (!selected.size) { notifyError('No students selected', 'Select the students you are promoting.'); return; }
    if (!sourceClassId && (!isStaff || promotionType === 'subject')) {
      notifyError('Choose a class', 'Select the class roster being reviewed for promotion.');
      return;
    }
    if (promotionType === 'subject' && target.outcome === 'promoted' && !target.subject_class_id) {
      notifyError('Choose a destination class', 'Select the next academic year subject class.');
      return;
    }
    if (promotionType === 'subject' && target.outcome === 'transferred' && !target.subject_class_id) {
      notifyError('Choose a destination class', 'Select the subject class students are transferring into.');
      return;
    }
    if (promotionType === 'homeroom' && ['promoted', 'transferred'].includes(target.outcome) && !target.homeroom_class_id) {
      notifyError('Choose a destination homeroom', 'Select the homeroom class students are moving into.');
      return;
    }
    setConfirmOpen(true);
  };

  const promote = async () => {
    const yg = yearGroups.find((g) => g.id === target.year_group_id);
    const hr = homerooms.find((h) => h.id === target.homeroom_class_id);
    const nextYear = years.find((year) => year.id === target.academic_year_id);
    setBusy(true);
    try {
      const res = await base44.functions.invoke('promoteStudents', {
        student_ids: [...selected],
        class_type: promotionType,
        source_class_id: sourceClassId,
        outcome: target.outcome,
        to: {
          year_group_id: target.year_group_id,
          year_group_name: yg?.name || '',
          homeroom_class_id: promotionType === 'homeroom' && target.homeroom_class_id
            ? target.homeroom_class_id
            : undefined,
          homeroom_class_name: hr?.name || '',
          subject_class_id: promotionType === 'subject' ? target.subject_class_id : '',
          academic_year_id: target.academic_year_id || '',
          academic_year_name: nextYear?.name || '',
        },
      });
      if (res.data?.error) throw new Error(res.data.error);
      setSummary(res.data);
      notifySuccess('Promotion complete', `${res.data.promoted} promoted · ${res.data.retained} retained · ${res.data.transferred} transferred · ${res.data.graduated} graduated.`);
      setSelected(new Set());
      setConfirmOpen(false);
      load();
      if (sourceClassId) {
        const [membershipPage, historyPage] = await Promise.all([
          base44.entities.ClassMembership.filter({ school_id: schoolId, class_type: promotionType, class_id: sourceClassId }, { limit: 1000 }),
          base44.entities.StudentEnrollment.filter({ school_id: schoolId, class_type: promotionType, source_class_id: sourceClassId }, { limit: 30, sort: '-created_date' }),
        ]);
        setSourceMembershipIds(new Set((membershipPage.items || []).map((item) => item.student_id)));
        setPromotionHistory(historyPage.items || []);
      }
    } catch (err) {
      notifyError('Promotion failed', err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const changePromotionType = (value) => {
    setPromotionType(value);
    setTarget((previous) => ({
      ...previous,
      outcome: value === 'subject' && previous.outcome === 'graduated' ? 'promoted' : previous.outcome,
    }));
    setSourceClassId('');
    setSourceMembershipIds(null);
    setSelected(new Set());
    setSummary(null);
  };

  return (
    <AppShell title="Academic years">
      <PageHeader
        title="Academic years & promotion"
        subtitle={isStaff
          ? 'Terms, year rollover and student promotion — history is always preserved'
          : 'Review and promote students from your assigned homeroom or subject classes'}
      />

      {isStaff && <div className="grid gap-4 lg:grid-cols-2">
        <div className="cp-card p-4">
          <h2 className="text-sm font-bold">Academic years</h2>
          <div className="mt-2 space-y-1.5">
            {years.map((y) => (
              <div key={y.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{y.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {y.start_date ? moment(y.start_date).format('D MMM YYYY') : 'No start'} – {y.end_date ? moment(y.end_date).format('D MMM YYYY') : 'No end'}
                  </p>
                </div>
                {y.is_current ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" />Current</span>
                ) : (
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setCurrentYear(y.id)}>Make current</Button>
                )}
              </div>
            ))}
            {years.length === 0 && <p className="text-xs text-muted-foreground">No academic years yet.</p>}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Input placeholder="2027/2028" value={newYear.name} onChange={(e) => setNewYear({ ...newYear, name: e.target.value })} />
            <Input type="date" value={newYear.start_date} onChange={(e) => setNewYear({ ...newYear, start_date: e.target.value })} />
            <Input type="date" value={newYear.end_date} onChange={(e) => setNewYear({ ...newYear, end_date: e.target.value })} />
          </div>
          <Button size="sm" className="mt-2" onClick={addYear}><Plus className="mr-1.5 h-3.5 w-3.5" />Add academic year</Button>
        </div>

        <div className="cp-card p-4">
          <h2 className="text-sm font-bold">Terms</h2>
          <div className="mt-2 space-y-1.5">
            {terms.map((t) => (
              <p key={t.id} className="rounded-lg border border-border px-2.5 py-1.5 text-sm">
                {t.name} <span className="text-[11px] text-muted-foreground">· {t.academic_year_name || '—'}</span>
              </p>
            ))}
            {terms.length === 0 && <p className="text-xs text-muted-foreground">No terms yet.</p>}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input placeholder="Term name" value={newTerm.name} onChange={(e) => setNewTerm({ ...newTerm, name: e.target.value })} />
            <Select value={newTerm.academic_year_id} onValueChange={(v) => setNewTerm({ ...newTerm, academic_year_id: v })}>
              <SelectTrigger><SelectValue placeholder="Academic year" /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="date" value={newTerm.start_date} onChange={(e) => setNewTerm({ ...newTerm, start_date: e.target.value })} />
            <Input type="date" value={newTerm.end_date} onChange={(e) => setNewTerm({ ...newTerm, end_date: e.target.value })} />
          </div>
          <Button size="sm" className="mt-2" onClick={addTerm}><Plus className="mr-1.5 h-3.5 w-3.5" />Add term</Button>
        </div>
      </div>}

      {!isStaff && (
        <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
          You can promote only students enrolled in a class assigned to you. Select a source class to load its roster; student profiles, IDs, and historical attendance remain preserved.
        </div>
      )}

      <div className="cp-card mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div>
            <h2 className="text-sm font-bold">Promote students</h2>
            <p className="text-xs text-muted-foreground">{selected.size} selected · destination year {years.find((year) => year.id === target.academic_year_id)?.name || 'not selected'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={promotionType} onValueChange={changePromotionType}>
              <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="homeroom">Homeroom</SelectItem>
                <SelectItem value="subject">Subject class</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceClassId || 'none'} onValueChange={(value) => {
              setSourceClassId(value === 'none' ? '' : value);
              setSelected(new Set());
              setSummary(null);
            }}>
              <SelectTrigger className="h-8 w-[190px]"><SelectValue placeholder="Choose source class" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose source class</SelectItem>
                {sourceClasses.map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>{klass.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fromGroup} onValueChange={(v) => { setFromGroup(v); setSelected(new Set()); }}>
              <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All year groups</SelectItem>
                {yearGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(filtered.map((s) => s.id)))}>Select all</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</Button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filtered.map((s) => (
            <label key={s.id} className="flex items-center gap-2.5 border-b border-border/50 px-4 py-2 text-sm last:border-0 hover:bg-muted/40">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 rounded border-border" />
              <span className="min-w-0 flex-1 truncate">{s.full_name}</span>
              <span className="text-[11px] text-muted-foreground">{s.year_group_name || '—'} · {s.homeroom_class_name || 'no homeroom'}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {sourceClassId && sourceMembershipIds === null ? 'Loading class roster…' : 'No students in this class and year group.'}
          </p>}
        </div>
        <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="mb-1 block text-[11px]">Destination academic year</Label>
            <Select value={target.academic_year_id || 'none'} onValueChange={(v) => setTarget({ ...target, academic_year_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose year" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No year selected</SelectItem>
                {years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-[11px]">Outcome</Label>
            <Select value={target.outcome} onValueChange={(v) => setTarget({ ...target, outcome: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="promoted">Promote</SelectItem>
                <SelectItem value="repeating">Repeating</SelectItem>
                <SelectItem value="transferred">Transferring</SelectItem>
                {promotionType === 'homeroom' && <SelectItem value="graduated">Graduated</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {promotionType === 'homeroom' && <div>
            <Label className="mb-1 block text-[11px]">New year group</Label>
            <Select value={target.year_group_id || 'none'} onValueChange={(v) => setTarget({ ...target, year_group_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Keep current" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Keep current</SelectItem>
                {yearGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
          {promotionType === 'homeroom' ? <div>
            <Label className="mb-1 block text-[11px]">New homeroom</Label>
            <Select value={target.homeroom_class_id || 'none'} onValueChange={(v) => setTarget({ ...target, homeroom_class_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Keep current" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Keep current</SelectItem>
                {destinationHomerooms.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div> : <div>
            <Label className="mb-1 block text-[11px]">Destination subject class</Label>
            <Select value={target.subject_class_id || 'none'} onValueChange={(v) => setTarget({ ...target, subject_class_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose next class" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose destination</SelectItem>
                {destinationSubjectClasses.map((klass) => <SelectItem key={klass.id} value={klass.id}>{klass.name} · {klass.subject}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
          <div className="flex items-end">
            <Button className="w-full" size="sm" onClick={reviewPromotion} disabled={busy || !selected.size}>
              <ArrowRight className="mr-1.5 h-3.5 w-3.5" />Review promotion
            </Button>
          </div>
        </div>
        {summary && (
          <div className="border-t border-border p-3 text-xs">
            <p className="font-semibold">Last promotion summary: {summary.selected} selected · {summary.promoted} promoted · {summary.retained} retained · {summary.transferred} transferred · {summary.graduated} graduated</p>
            {summary.errors?.map((error, index) => <p key={index} className="mt-1 text-destructive">{error}</p>)}
          </div>
        )}
        {promotionHistory.length > 0 && (
          <div className="border-t border-border p-3">
            <p className="mb-2 text-xs font-semibold">Recent promotion history for {sourceClass?.name}</p>
            <div className="space-y-1">
              {promotionHistory.slice(0, 5).map((entry) => (
                <p key={entry.id} className="text-[11px] text-muted-foreground">
                  {entry.student_name} · {entry.outcome} · {entry.academic_year_name || 'Academic year not recorded'}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <GraduationCap className="h-3.5 w-3.5" />
        Each promotion writes an enrolment history record, so previous year groups, homerooms and attendance stay intact.
        <Users className="h-3.5 w-3.5" />
      </p>
      {confirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="promotion-review-title">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 id="promotion-review-title" className="text-base font-semibold">Review student promotion</h2>
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close review">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm">{selected.size} student(s) from {sourceClass?.name || 'the selected students'} will be marked as {target.outcome}.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Destination: {years.find((year) => year.id === target.academic_year_id)?.name || 'No academic year'}
              {promotionType === 'subject'
                ? ` · ${subjectClasses.find((klass) => klass.id === target.subject_class_id)?.name || 'No subject class selected'}`
                : ` · ${homerooms.find((klass) => klass.id === target.homeroom_class_id)?.name || sourceClass?.name || 'Current homeroom'}`}
            </p>
            <p className="mt-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">Student IDs and historical attendance will be preserved. Confirm only after reviewing the selected roster and destination.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={promote} disabled={busy}>{busy ? 'Applying…' : 'Confirm promotion'}</Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}