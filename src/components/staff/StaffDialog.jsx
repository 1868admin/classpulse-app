import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { notifyError, notifySuccess } from '@/lib/notify';

const BLANK = { full_name: '', user_email: '', role: 'teacher', username: '', password: '', phone: '', subject_specialisms: '' };

export default function StaffDialog({ open, onOpenChange, staff, canGrantAdmin, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(staff
      ? { ...BLANK, ...staff, status: staff.status === 'invited' ? 'active' : staff.status }
      : BLANK);
  }, [open, staff]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Enter the teacher\'s full name.'); return; }
    if (!staff && form.user_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.user_email)) { setError('Enter a valid email address or leave it blank.'); return; }
    if (!staff && !form.username.trim()) { setError('Enter a username.'); return; }
    if (!staff && form.password.length < 8) { setError('Set a password of at least 8 characters.'); return; }
    if (staff && !staff.has_local_login && form.password.length < 8) {
      setError('This imported account needs a local password of at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = staff
        ? { action: 'update', member_id: staff.id, full_name: form.full_name, role: form.role, status: form.status || 'active', username: form.username, password: form.password || undefined, phone: form.phone, subject_specialisms: form.subject_specialisms }
        : { action: 'invite', full_name: form.full_name, user_email: form.user_email, role: form.role, username: form.username, password: form.password, phone: form.phone, subject_specialisms: form.subject_specialisms };
      const res = await base44.functions.invoke('manageStaff', payload);
      if (res.data?.error) throw new Error(res.data.error);
      onSaved();
      onOpenChange(false);
      if (staff) {
        notifySuccess('Local account updated', `${form.full_name} saved.`);
      } else {
        notifySuccess('Local account created', `${form.full_name} can sign in with username ${form.username}.`);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notifyError('Could not save local account', err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{staff ? 'Edit staff account' : 'Add staff account'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">Full name <span className="text-destructive">*</span></Label>
            <Input value={form.full_name} onChange={set('full_name')} placeholder="e.g. Mr R. Smith" />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">Email <span className="text-muted-foreground">(optional)</span></Label>
            <Input type="email" value={form.user_email} onChange={set('user_email')} disabled={!!staff} placeholder="teacher@school.edu.tt" />
            {!staff && <p className="mt-1 text-[11px] text-muted-foreground">No email is needed to sign in. Set a username and password below.</p>}
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="teacher">Teacher</SelectItem>
                <SelectItem value="it_admin">IT administrator</SelectItem>
                {canGrantAdmin && <SelectItem value="school_admin">School administrator</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {staff && (
            <div>
              <Label className="mb-1.5 block text-[13px]">Account status</Label>
              <Select value={form.status || 'active'} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Deactivated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="mb-1.5 block text-[13px]">Username <span className="text-destructive">*</span></Label>
            <Input value={form.username} onChange={set('username')} placeholder="rsmith" required={!staff || !staff.has_local_login} minLength={3} maxLength={32} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">{staff ? 'Set / reset password' : 'Default password'}</Label>
            <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder={staff?.has_local_login ? 'Leave blank to keep current' : 'At least 8 characters'} required={!staff || !staff.has_local_login} minLength={8} />
            {!staff && <p className="mt-1 text-[11px] text-muted-foreground">This password is active immediately. Share it privately with the staff member.</p>}
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Phone</Label>
            <Input value={form.phone} onChange={set('phone')} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">Subjects taught</Label>
            <Input value={form.subject_specialisms} onChange={set('subject_specialisms')} placeholder="e.g. Physics, Mathematics" />
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : staff ? 'Save account' : 'Create local account'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}