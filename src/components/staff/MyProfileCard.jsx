import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notifySuccess } from '@/lib/notify';

export default function MyProfileCard() {
  const { member, user, refresh } = useSchool();
  const [form, setForm] = useState({ full_name: '', phone: '', subject_specialisms: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      full_name: member?.full_name || '',
      phone: member?.phone || '',
      subject_specialisms: member?.subject_specialisms || '',
    });
  }, [member]);

  const save = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Enter your full name.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await base44.functions.invoke('updateMyProfile', {
        full_name: form.full_name,
        phone: form.phone,
        subject_specialisms: form.subject_specialisms,
      });
      if (res.data?.error) throw new Error(res.data.error);
      await refresh();
      notifySuccess('Profile saved', 'Your name now appears across ClassPulse.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cp-card p-4">
      <h2 className="text-sm font-bold">My profile</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Signed in as {user?.email}. Changing your name never changes your sign-in email or password.
      </p>
      <form onSubmit={save} className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="mb-1 block text-[11px]">Display name</Label>
          <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div>
          <Label className="mb-1 block text-[11px]">Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <Label className="mb-1 block text-[11px]">Subjects taught</Label>
          <Input value={form.subject_specialisms} onChange={(e) => setForm({ ...form, subject_specialisms: e.target.value })} placeholder="e.g. Physics, Mathematics" />
        </div>
        {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button size="sm" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
        </div>
      </form>
    </div>
  );
}