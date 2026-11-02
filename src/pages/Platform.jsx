import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import EmptyState from '@/components/ui-bits/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notifyError, notifySuccess } from '@/lib/notify';

const EMPTY_SCHOOL = { name: '', code: '', academic_year_label: '2026/2027' };

export default function Platform() {
  const { refresh, schoolId } = useSchool();
  const navigate = useNavigate();
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_SCHOOL);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await base44.entities.School.filter({}, { limit: 500, sort: 'name' });
      setSchools(page.items || []);
    } catch (error) {
      notifyError('Could not load schools', error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createSchool = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await base44.functions.invoke('provisionSchool', form);
      setForm(EMPTY_SCHOOL);
      setOpen(false);
      await refresh();
      await load();
      notifySuccess('School added', `${form.name} is ready for setup.`);
    } catch (error) {
      notifyError('Could not add school', error.response?.data?.error || error.message);
    } finally {
      setBusy(false);
    }
  };

  const openSchool = async (school) => {
    try {
      if (school.id !== schoolId) {
        const result = await base44.functions.invoke('switchSchool', { school_id: school.id });
        if (result.data?.error) throw new Error(result.data.error);
        await refresh();
      }
      navigate('/');
    } catch (error) {
      notifyError('Could not open school', error.response?.data?.error || error.message);
    }
  };

  return (
    <AppShell title="Schools">
      <PageHeader
        title="Schools"
        subtitle="Manage separate school workspaces on this computer."
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Add school</Button>}
      />
      {schools.length === 0 && !loading ? (
        <EmptyState icon={Building2} title="No schools yet" description="Add a school to begin setting up ClassPulse." />
      ) : (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {schools.map((school) => (
            <div key={school.id} className="cp-card flex min-w-0 items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{school.name}</p>
                <p className="truncate text-xs text-muted-foreground">{school.code || 'No school code'} · {school.academic_year_label || 'No academic year'}</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => openSchool(school)} aria-label={`Open ${school.name}`}>
                Open <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {loading && <p className="mt-4 text-center text-sm text-muted-foreground">Loading schools…</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a school</DialogTitle></DialogHeader>
          <form onSubmit={createSchool} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="school-name">School name</Label>
              <Input id="school-name" autoFocus value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-code">Short code</Label>
              <Input id="school-code" value={form.code} onChange={(event) => setForm((value) => ({ ...value, code: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="year-label">Academic year</Label>
              <Input id="year-label" value={form.academic_year_label} onChange={(event) => setForm((value) => ({ ...value, academic_year_label: event.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create school'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
