import { useCallback, useEffect, useState } from 'react';
import { Plus, UserCog, ShieldCheck, Trash2, Pencil, Link2, BriefcaseBusiness, UsersRound, FileSpreadsheet } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EmptyState from '@/components/ui-bits/EmptyState';
import StaffDialog from '@/components/staff/StaffDialog';
import StaffLinkDialog from '@/components/staff/StaffLinkDialog';
import StaffEmploymentDialog from '@/components/staff/StaffEmploymentDialog';
import StaffAssignmentsDialog from '@/components/staff/StaffAssignmentsDialog';
import StaffImportDialog from '@/components/staff/StaffImportDialog';
import ConfirmDialog from '@/components/ui-bits/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notifySuccess, notifyError } from '@/lib/notify';
import { ROLE_LABELS } from '@/lib/nav';

export default function Staff() {
  const { schoolId, isSchoolAdmin, isStaff } = useSchool();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [link, setLink] = useState(null);
  const [employmentTeacher, setEmploymentTeacher] = useState(null);
  const [assignmentTeacher, setAssignmentTeacher] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [employmentFilter, setEmploymentFilter] = useState('all');
  const canManageStaff = isStaff;

  const load = useCallback(async () => {
    setLoading(true);
    const page = await base44.entities.SchoolMember.filter({ school_id: schoolId }, { limit: 200, sort: 'full_name' });
    setStaff(page.items || []);
    setLoading(false);
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    try {
      const res = await base44.functions.invoke('manageStaff', { action: 'remove', member_id: removing.id });
      if (res.data?.error) throw new Error(res.data.error);
      notifySuccess('Staff removed', `${removing.full_name} no longer has access.`);
      load();
    } catch (err) {
      notifyError('Could not remove staff', err.response?.data?.error || err.message);
    }
  };

  const createLink = async (m) => {
    try {
      const res = await base44.functions.invoke('manageStaff', { action: 'create_link', member_id: m.id });
      if (res.data?.error) throw new Error(res.data.error);
      setLink({ ...res.data, name: m.full_name });
      load();
    } catch (err) {
      notifyError('Could not create link', err.response?.data?.error || err.message);
    }
  };

  const visibleStaff = staff.filter((person) => {
    const subjects = Array.isArray(person.subject_specialisms) ? person.subject_specialisms.join(' ') : person.subject_specialisms;
    const query = search.trim().toLocaleLowerCase();
    const matchesText = !query || [person.full_name, person.teacher_number, subjects, person.role]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
    const matchesStatus = employmentFilter === 'all' || (person.employment_status || 'active') === employmentFilter;
    return matchesText && matchesStatus;
  });

  return (
    <AppShell title="Staff & accounts">
      <PageHeader
        title="Staff & accounts"
        subtitle={`${staff.length} staff profile(s) at this school`}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canManageStaff && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />Bulk import</Button>}
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" />Add teacher</Button>
          </div>
        )}
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_220px]">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, Teacher Number, subject…" aria-label="Search staff" />
        <Select value={employmentFilter} onValueChange={setEmploymentFilter}>
          <SelectTrigger><SelectValue placeholder="Employment status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All employment statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on_leave">On leave</SelectItem>
            <SelectItem value="departed">Departed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {staff.length === 0 && !loading ? (
        <EmptyState icon={UserCog} title="No staff profiles yet" description="Add a teacher profile now. A login account can be created now or later." />
      ) : visibleStaff.length === 0 ? (
        <EmptyState icon={UserCog} title="No matching staff" description="Change the search or employment status filter." />
      ) : (
        <div className="cp-card overflow-hidden">
          <div className="cp-scroll-x">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="cp-table-head">
                <tr>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Account</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Employment</th>
                  <th className="px-3 py-2.5">Account status</th>
                  <th className="px-3 py-2.5">Teacher number</th>
                  <th className="px-3 py-2.5">Subjects</th>
                  <th className="w-44 px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleStaff.map((m) => (
                  <tr key={m.id} className="border-t border-border/60 hover:bg-muted/40">
                    <td className="max-w-56 break-words px-3 py-2.5 font-medium">{m.full_name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      <span className="block">{m.has_local_login ? (m.username || 'Local account') : 'No login account'}</span>
                      <span className="block text-[11px]">{m.user_email || 'No email address'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                        {m.role === 'school_admin' && <ShieldCheck className="h-3 w-3" />}
                        {ROLE_LABELS[m.role] || m.role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {m.role === 'teacher' ? (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.employment_status === 'departed' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : m.employment_status === 'on_leave' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                          {{ active: 'Active', on_leave: 'On leave', departed: 'Departed' }[m.employment_status || 'active']}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${!m.has_local_login || m.status === 'invited' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : m.status === 'active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                        {!m.has_local_login ? 'No account' : m.status === 'invited' ? 'Password not set' : m.status === 'active' ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{m.teacher_number || '—'}</td>
                    <td className="max-w-[260px] break-words px-3 py-2.5 text-xs text-muted-foreground">{Array.isArray(m.subject_specialisms) ? m.subject_specialisms.join(', ') || '—' : m.subject_specialisms || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {m.has_local_login && m.status !== 'inactive' && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => createLink(m)} aria-label="Create setup or password reset link" title="Create account setup / password reset link"><Link2 className="h-3.5 w-3.5" /></Button>}
                        {canManageStaff && m.role === 'teacher' && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAssignmentTeacher(m)} aria-label="Manage teaching assignments" title="Manage assignments"><UsersRound className="h-3.5 w-3.5" /></Button>}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(m); setDialogOpen(true); }} aria-label="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {canManageStaff && m.role === 'teacher' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEmploymentTeacher(m)} aria-label={m.employment_status === 'departed' ? 'Reinstate teacher' : 'Change employment status'} title="Employment status">
                            <BriefcaseBusiness className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {isSchoolAdmin && m.role !== 'teacher' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRemoving(m)} aria-label="Remove">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">Teacher profiles and login accounts are separate. A Teacher Number identifies the profile and is never replaced during reinstatement.</p>

      <StaffDialog open={dialogOpen} onOpenChange={setDialogOpen} staff={editing} canGrantAdmin={isSchoolAdmin} onSaved={load} />
      <StaffImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />
      <StaffEmploymentDialog open={!!employmentTeacher} onOpenChange={(open) => !open && setEmploymentTeacher(null)} teacher={employmentTeacher} onChanged={load} />
      <StaffAssignmentsDialog open={!!assignmentTeacher} onOpenChange={(open) => !open && setAssignmentTeacher(null)} teacher={assignmentTeacher} onChanged={load} />
      <StaffLinkDialog link={link} onClose={() => setLink(null)} />
      {removing && (
        <ConfirmDialog
          open={!!removing}
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Remove ${removing.full_name}?`}
          description="Their class assignments will be removed and they will lose access to ClassPulse. Attendance records they submitted are kept."
          confirmLabel="Remove staff"
          destructive
          onConfirm={remove}
        />
      )}
    </AppShell>
  );
}