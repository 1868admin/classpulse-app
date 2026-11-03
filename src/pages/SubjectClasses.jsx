import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, BookOpen, Users, Archive, Upload } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EmptyState from '@/components/ui-bits/EmptyState';
import SearchInput from '@/components/ui-bits/SearchInput';
import ClassOrderControls from '@/components/ui-bits/ClassOrderControls';
import ClassFormDialog from '@/components/classes/ClassFormDialog';
import SubjectClassImportDialog from '@/components/classes/SubjectClassImportDialog';
import ConfirmDialog from '@/components/ui-bits/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { notifySuccess, notifyError } from '@/lib/notify';
import useOrderedItems from '@/hooks/useOrderedItems';

export default function SubjectClasses() {
  const { schoolId, isStaff, member, isTeacher } = useSchool();
  const [classes, setClasses] = useState([]);
  const [yearGroups, setYearGroups] = useState([]);
  const [homerooms, setHomerooms] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setLoadError('');
    try {
      const [cls, yg, hr, staff, ct] = await base44.queryBatch([
        { entity: 'SubjectClass', query: { school_id: schoolId, archived: false }, options: { limit: 200, sort: 'name' } },
        { entity: 'YearGroup', query: { school_id: schoolId }, options: { limit: 50, sort: 'level' } },
        { entity: 'HomeroomClass', query: { school_id: schoolId, archived: false }, options: { limit: 100, sort: 'name' } },
        { entity: 'SchoolMember', query: { school_id: schoolId, role: 'teacher', status: 'active', employment_status: { $ne: 'on_leave' } }, options: { limit: 200, sort: 'full_name' } },
        { entity: 'ClassTeacher', query: { school_id: schoolId, class_type: 'subject', is_active: { $ne: false } }, options: { limit: 500 } },
      ]);
      setClasses(cls.items || []);
      setYearGroups(yg.items || []);
      setHomerooms(hr.items || []);
      setTeachers(staff.items || []);
      setLinks(ct.items || []);
    } catch (err) {
      setLoadError(err.message || 'Could not load subject classes.');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  const myClassIds = new Set(links.filter((l) => l.member_id === member?.id).map((l) => l.class_id));
  const visible = (isStaff ? classes : classes.filter((c) => myClassIds.has(c.id)))
    .filter((c) => !term || `${c.name} ${c.subject}`.toLowerCase().includes(term.toLowerCase()));
  const { items: orderedClasses, moveItem } = useOrderedItems(
    visible,
    `classpulse:class-order:${schoolId}:${member?.id}:subject-classes`,
  );

  const archive = async () => {
    try {
      await base44.entities.SubjectClass.update(archiving.id, { archived: true });
      notifySuccess('Class archived', `${archiving.name} was archived. Attendance history is kept.`);
      load();
    } catch (err) {
      notifyError('Could not archive class', err.message);
    }
  };

  return (
    <AppShell title="Subject classes">
      <PageHeader
        title="Subject classes"
        subtitle={isStaff ? 'Every subject class in the school' : 'Classes you teach — create one any time, no timetable needed'}
        actions={<>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-1.5 h-3.5 w-3.5" />Bulk import</Button>
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" />Create class</Button>
        </>}
      />

      <div className="mb-3 max-w-sm"><SearchInput value={term} onChange={setTerm} placeholder="Search class or subject…" /></div>

      {loadError && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {loading && classes.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">Loading subject classes…</p>
      ) : visible.length === 0 && !loading && !loadError ? (
        <EmptyState
          icon={BookOpen}
          title="No subject classes"
          description={isTeacher ? 'Create your first subject class, choose the subject, then add students from the school directory.' : 'Subject classes created by teachers will appear here.'}
          action={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" />Create class</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orderedClasses.map((c, index) => {
            const classTeachers = links.filter((l) => l.class_id === c.id);
            const canEdit = isStaff || classTeachers.some((l) => l.member_id === member?.id);
            return (
              <div key={c.id} className="cp-card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/subject-classes/${c.id}`} className="block truncate text-base font-bold hover:text-primary">{c.name}</Link>
                    <p className="text-xs text-muted-foreground">{c.subject}{c.year_group_name ? ` · ${c.year_group_name}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ClassOrderControls
                      label={c.name}
                      canMoveUp={index > 0}
                      canMoveDown={index < orderedClasses.length - 1}
                      onMove={(direction) => moveItem(c.id, direction)}
                    />
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300"><BookOpen className="h-4 w-4" /></span>
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {classTeachers.length === 0 && <span className="text-[11px] text-muted-foreground">No teachers</span>}
                  {classTeachers.map((t) => (
                    <span key={t.id} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.is_primary ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' : 'bg-muted text-muted-foreground'}`}>
                      {t.member_name}
                    </span>
                  ))}
                </div>
                {c.homeroom_names?.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">Homerooms: {c.homeroom_names.join(', ')}</p>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{c.student_count || 0} students</span>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <button onClick={() => setArchiving(c)} className="text-muted-foreground hover:text-destructive" aria-label="Archive class">
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <Link to={`/subject-classes/${c.id}`} className="text-xs font-semibold text-primary hover:underline">Open class</Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SubjectClassImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />
      <ClassFormDialog
        open={open}
        onOpenChange={setOpen}
        type="subject"
        klass={editing}
        yearGroups={yearGroups}
        homerooms={homerooms}
        teachers={teachers}
        onSaved={load}
      />

      {archiving && (
        <ConfirmDialog
          open={!!archiving}
          onOpenChange={(o) => !o && setArchiving(null)}
          title={`Archive ${archiving.name}?`}
          description="The class will be hidden from active lists. Attendance already recorded stays available in reports."
          confirmLabel="Archive class"
          destructive
          onConfirm={archive}
        />
      )}
    </AppShell>
  );
}