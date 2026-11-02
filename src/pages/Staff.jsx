import { useCallback, useEffect, useState } from 'react';
import { Plus, UserCog, ShieldCheck, Trash2, Pencil } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EmptyState from '@/components/ui-bits/EmptyState';
import StaffDialog from '@/components/staff/StaffDialog';
import ConfirmDialog from '@/components/ui-bits/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { notifySuccess, notifyError } from '@/lib/notify';
import { ROLE_LABELS } from '@/lib/nav';

export default function Staff() {
  const { schoolId, isSchoolAdmin } = useSchool();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

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

  return (
    <AppShell title="Staff & accounts">
      <PageHeader
        title="Staff & accounts"
        subtitle={`${staff.length} account(s) at this school`}
        actions={<Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" />Add staff</Button>}
      />

      {staff.length === 0 && !loading ? (
        <EmptyState icon={UserCog} title="No staff accounts yet" description="Invite teachers so they can take attendance and manage their own classes." />
      ) : (
        <div className="cp-card overflow-hidden">
          <div className="cp-scroll-x">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="cp-table-head">
                <tr>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Local account</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Subjects</th>
                  <th className="w-32 px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((m) => (
                  <tr key={m.id} className="border-t border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-2.5 font-medium">{m.full_name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      <span className="block">{m.username || 'Username not set'}</span>
                      <span className="block text-[11px]">{m.user_email || 'No email address'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                        {m.role === 'school_admin' && <ShieldCheck className="h-3 w-3" />}
                        {ROLE_LABELS[m.role] || m.role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${!m.has_local_login || m.status === 'invited' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : m.status === 'active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                        {!m.has_local_login ? 'Password not set' : m.status === 'invited' ? 'Password not set' : m.status}
                      </span>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-xs text-muted-foreground">{m.subject_specialisms || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(m); setDialogOpen(true); }} aria-label="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isSchoolAdmin && (
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

      <p className="mt-3 text-xs text-muted-foreground">
        Accounts are stored on this computer. Use Edit to create a password for imported staff or change an existing local password.
      </p>

      <StaffDialog open={dialogOpen} onOpenChange={setDialogOpen} staff={editing} canGrantAdmin={isSchoolAdmin} onSaved={load} />
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