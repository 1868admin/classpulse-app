import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, GraduationCap, Users } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EmptyState from '@/components/ui-bits/EmptyState';
import ClassFormDialog from '@/components/classes/ClassFormDialog';
import ClassOrderControls from '@/components/ui-bits/ClassOrderControls';
import { Button } from '@/components/ui/button';
import useOrderedItems from '@/hooks/useOrderedItems';

export default function Homerooms() {
  const { schoolId, isStaff, member } = useSchool();
  const [classes, setClasses] = useState([]);
  const [yearGroups, setYearGroups] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setLoadError('');
    try {
      const [cls, yg, staff, ct] = await base44.queryBatch([
        { entity: 'HomeroomClass', query: { school_id: schoolId, archived: false }, options: { limit: 100, sort: 'name' } },
        { entity: 'YearGroup', query: { school_id: schoolId }, options: { limit: 50, sort: 'level' } },
        { entity: 'SchoolMember', query: { school_id: schoolId, role: 'teacher', status: 'active', employment_status: { $ne: 'on_leave' } }, options: { limit: 200, sort: 'full_name' } },
        { entity: 'ClassTeacher', query: { school_id: schoolId, class_type: 'homeroom', is_active: { $ne: false } }, options: { limit: 400 } },
      ]);
      setClasses(cls.items || []);
      setYearGroups(yg.items || []);
      setTeachers((staff.items || []).filter((s) => s.status !== 'inactive'));
      setLinks(ct.items || []);
    } catch (err) {
      setLoadError(err.message || 'Could not load homeroom classes.');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  const myLinks = new Set(links.filter((l) => l.member_id === member?.id).map((l) => l.class_id));
  const visible = isStaff ? classes : classes.filter((c) => myLinks.has(c.id));
  const { items: orderedClasses, moveItem } = useOrderedItems(
    visible,
    `classpulse:class-order:${schoolId}:${member?.id}:homerooms`,
  );

  return (
    <AppShell title="Homeroom classes">
      <PageHeader
        title="Homeroom classes"
        subtitle={isStaff ? 'Each class can have several homeroom teachers sharing one register' : 'Classes you are a homeroom teacher of'}
        actions={isStaff ? <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" />New homeroom</Button> : null}
      />

      {loadError && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {loading && classes.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">Loading homeroom classes…</p>
      ) : visible.length === 0 && !loading && !loadError ? (
        <EmptyState icon={GraduationCap} title="No homeroom classes" description={isStaff ? 'Create your first form class and assign its homeroom teachers.' : 'You have not been assigned to a homeroom class yet.'} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orderedClasses.map((c, index) => {
            const classTeachers = links.filter((l) => l.class_id === c.id);
            return (
              <div key={c.id} className="cp-card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link to={`/homerooms/${c.id}`} className="text-base font-bold hover:text-primary">{c.name}</Link>
                    <p className="text-xs text-muted-foreground">
                      {c.year_group_name || 'No year group'}{c.room ? ` · ${c.room}` : ''}
                      {' · '}{c.attendance_period === 'morning' ? 'Morning' : c.attendance_period === 'afternoon' ? 'Afternoon' : 'Morning & afternoon'} attendance
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <ClassOrderControls
                      label={c.name}
                      canMoveUp={index > 0}
                      canMoveDown={index < orderedClasses.length - 1}
                      onMove={(direction) => moveItem(c.id, direction)}
                    />
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><GraduationCap className="h-4 w-4" /></span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {classTeachers.length === 0 && <span className="text-[11px] text-muted-foreground">No teachers assigned</span>}
                  {classTeachers.map((t) => (
                    <span key={t.id} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.is_primary ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {t.member_name}{t.is_primary ? ' · primary' : ''}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{c.student_count || 0} students</span>
                  <Link to={`/homerooms/${c.id}`} className="text-xs font-semibold text-primary hover:underline">Open register</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ClassFormDialog
        open={open}
        onOpenChange={setOpen}
        type="homeroom"
        klass={editing}
        yearGroups={yearGroups}
        homerooms={classes}
        teachers={teachers}
        onSaved={load}
      />
    </AppShell>
  );
}