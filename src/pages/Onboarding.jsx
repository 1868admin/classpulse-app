import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { School, ShieldAlert } from 'lucide-react';

const EMPTY = {
  name: '', code: '', address: '', phone: '', email: '', principal_name: '',
  academic_year_label: '2026/2027', timetable_days: 5,
  year_group_names: 'Form 1, Form 2, Form 3, Form 4, Form 5',
};

export default function Onboarding() {
  const { user, isPlatformAdmin, refresh } = useSchool();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existingSchools, setExistingSchools] = useState(false);
  const [checkingSchools, setCheckingSchools] = useState(isPlatformAdmin);
  const [schoolsCheckFailed, setSchoolsCheckFailed] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    base44.entities.School.filter({}, { limit: 1 })
      .then((page) => setExistingSchools((page.items || []).length > 0))
      .catch((loadError) => {
        setSchoolsCheckFailed(true);
        setError(`Could not check the local schools database: ${loadError.message}`);
      })
      .finally(() => setCheckingSchools(false));
  }, [isPlatformAdmin]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Enter the school name.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await base44.functions.invoke('provisionSchool', {
        ...form,
        timetable_days: Number(form.timetable_days) || 5,
        year_group_names: form.year_group_names.split(',').map((s) => s.trim()).filter(Boolean),
      });
      if (res.data?.error) throw new Error(res.data.error);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not register the school.');
    } finally {
      setBusy(false);
    }
  };

  if (!isPlatformAdmin) {
    const checkAccess = async () => {
      setCheckingAccess(true);
      try {
        await refresh();
      } finally {
        setCheckingAccess(false);
      }
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="cp-card max-w-md p-7 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-bold">Your account isn't attached to a school yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask your school administrator to add <span className="font-medium text-foreground">{user?.email || user?.username}</span>.
            Once they do, your school, classes and registers will appear here.
          </p>
          <div className="mt-5 grid gap-2">
            <Button className="w-full" variant="outline" onClick={checkAccess} disabled={checkingAccess}>
              {checkingAccess ? 'Checking access…' : 'Check again'}
            </Button>
            <Button className="w-full" variant="ghost" onClick={() => base44.auth.logout(window.location.href)}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  }

  if (existingSchools) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="cp-card max-w-lg p-7 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <School className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-bold">Existing school data is available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Open the school list to securely link this administrator account to an existing school. This avoids creating duplicate school records.
          </p>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <Button className="mt-5 w-full" onClick={() => navigate('/platform')}>Open schools</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">CP</span>
          <span className="font-heading text-base font-extrabold tracking-tight">CLASSPULSE</span>
        </div>
        <div className="cp-card p-6 sm:p-8">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <School className="h-5 w-5" />
          </span>
          <h1 className="text-xl font-extrabold">Create your school</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This creates the school, its academic year and year groups, and links your account as its school administrator. You can add more schools later from the Schools page.
          </p>
          <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="School name" required value={form.name} onChange={set('name')} placeholder="e.g. Belmont Secondary School" className="sm:col-span-2" />
            <Field label="Short code" value={form.code} onChange={set('code')} placeholder="BSS" />
            <Field label="Academic year" value={form.academic_year_label} onChange={set('academic_year_label')} placeholder="2026/2027" />
            <Field label="Principal" value={form.principal_name} onChange={set('principal_name')} placeholder="Name" />
            <Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="868-000-0000" />
            <Field label="School email" value={form.email} onChange={set('email')} type="email" placeholder="office@school.edu.tt" />
            <Field label="Timetable cycle days" value={form.timetable_days} onChange={set('timetable_days')} type="number" />
            <Field label="Address" value={form.address} onChange={set('address')} placeholder="Street, town" className="sm:col-span-2" />
            <Field label="Year groups (comma separated)" value={form.year_group_names} onChange={set('year_group_names')} className="sm:col-span-2" />
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || checkingSchools || schoolsCheckFailed} className="w-full sm:w-auto">
                {checkingSchools ? 'Checking local data…' : schoolsCheckFailed ? 'Reload to retry' : busy ? 'Creating school…' : 'Create school'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className = '', ...props }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-[13px]">
        {label} {props.required && <span className="text-destructive">*</span>}
      </Label>
      <Input {...props} />
    </div>
  );
}