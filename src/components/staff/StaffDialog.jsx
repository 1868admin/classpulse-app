import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import { notifyError, notifySuccess } from '@/lib/notify';

const BLANK = {
  full_name: '',
  user_email: '',
  role: 'teacher',
  username: '',
  password: '',
  phone: '',
  teacher_number: '',
  subject_specialisms: '',
  employment_start_date: '',
  create_account: true,
};

export default function StaffDialog({ open, onOpenChange, staff, canGrantAdmin, onSaved }) {
  const { schoolId, school } = useSchool();
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [years, setYears] = useState([]);
  const [availabilityYearId, setAvailabilityYearId] = useState('');
  const [unavailable, setUnavailable] = useState([]);
  const [availabilityDay, setAvailabilityDay] = useState('');
  const [availabilityPeriod, setAvailabilityPeriod] = useState('');
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const days = school?.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
  const periods = school?.periods?.length
    ? school.periods
    : [1, 2, 3, 4, 5, 6].map((number) => ({ number, start: '', end: '' }));

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(staff
      ? {
          ...BLANK,
          ...staff,
          create_account: Boolean(staff.has_local_login),
          teacher_number: staff.teacher_number || '',
          employment_start_date: staff.employment_start_date || '',
          subject_specialisms: Array.isArray(staff.subject_specialisms)
            ? staff.subject_specialisms.join(', ')
            : staff.subject_specialisms || '',
          status: staff.status === 'invited' ? 'active' : staff.status,
        }
      : BLANK);
  }, [open, staff]);

  useEffect(() => {
    if (!open || !staff || staff.role !== 'teacher' || !schoolId) {
      setYears([]);
      setAvailabilityYearId('');
      setUnavailable([]);
      return;
    }
    let active = true;
    base44.entities.AcademicYear.filter({ school_id: schoolId }, { limit: 50, sort: '-name' })
      .then((page) => {
        if (!active) return;
        const items = page.items || [];
        setYears(items);
        setAvailabilityYearId((current) => current || items.find((year) => year.is_current)?.id || items[0]?.id || '');
      })
      .catch((loadError) => {
        if (active) notifyError('Could not load academic years', loadError.message);
      });
    return () => { active = false; };
  }, [open, staff, schoolId]);

  useEffect(() => {
    if (!open || !staff || !availabilityYearId) {
      setUnavailable([]);
      return;
    }
    let active = true;
    base44.entities.TeacherAvailability.filter({
      school_id: schoolId,
      member_id: staff.id,
      academic_year_id: availabilityYearId,
      is_available: false,
    }, { limit: 300, sort: 'day_name' })
      .then((page) => {
        if (active) setUnavailable(page.items || []);
      })
      .catch((loadError) => {
        if (active) notifyError('Could not load teacher availability', loadError.message);
      });
    return () => { active = false; };
  }, [open, staff, schoolId, availabilityYearId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) { setError('Enter the teacher\'s full name.'); return; }
    if (!staff && form.user_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.user_email)) { setError('Enter a valid email address or leave it blank.'); return; }
    if ((!staff || !staff.has_local_login) && form.create_account && form.username.trim() && form.username.trim().length < 3) { setError('Usernames need at least 3 characters.'); return; }
    if ((!staff || !staff.has_local_login) && form.create_account && form.password && form.password.length < 8) { setError('Passwords need at least 8 characters, or leave it blank to use a sign-in link.'); return; }
    if (staff && !staff.has_local_login && form.create_account && form.password && form.password.length < 8) {
      setError('This imported account needs a local password of at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = staff
        ? { action: 'update', member_id: staff.id, full_name: form.full_name, role: form.role, status: form.status || 'active', username: form.username, password: form.password || undefined, create_account: !staff.has_local_login && form.create_account, phone: form.phone, teacher_number: form.teacher_number, subject_specialisms: form.subject_specialisms, employment_start_date: form.employment_start_date }
        : { action: 'invite', full_name: form.full_name, user_email: form.user_email, role: form.role, username: form.username, password: form.password, create_account: form.create_account, phone: form.phone, teacher_number: form.teacher_number, subject_specialisms: form.subject_specialisms, employment_start_date: form.employment_start_date };
      const res = await base44.functions.invoke('manageStaff', payload);
      if (res.data?.error) throw new Error(res.data.error);
      onSaved();
      onOpenChange(false);
      if (staff) {
        notifySuccess('Staff profile updated', `${form.full_name} saved.`);
      } else if (form.create_account) {
        notifySuccess('Local account created', `${form.full_name} can sign in with username ${res.data?.member?.username || form.username}.`);
      } else {
        notifySuccess('Teacher profile created', `${form.full_name} can be assigned classes without a login account.`);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notifyError('Could not save local account', err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const addUnavailablePeriod = async () => {
    const period = periods.find((item) => Number(item.number) === Number(availabilityPeriod));
    if (!availabilityYearId || !availabilityDay || !period) {
      setError('Choose an academic year, day, and period.');
      return;
    }
    if (unavailable.some((slot) => slot.day_name === availabilityDay
      && Number(slot.period_number) === Number(period.number))) {
      setError('That unavailable period is already recorded.');
      return;
    }
    setAvailabilityBusy(true);
    setError('');
    try {
      const created = await base44.entities.TeacherAvailability.create({
        school_id: schoolId,
        member_id: staff.id,
        academic_year_id: availabilityYearId,
        day_name: availabilityDay,
        period_number: Number(period.number),
        start_time: period.start || '',
        end_time: period.end || '',
        is_available: false,
      });
      setUnavailable((current) => [...current, created]);
      setAvailabilityPeriod('');
      notifySuccess('Unavailable period added');
    } catch (availabilityError) {
      notifyError('Could not save teacher availability', availabilityError.response?.data?.error || availabilityError.message);
    } finally {
      setAvailabilityBusy(false);
    }
  };

  const removeUnavailablePeriod = async (slot) => {
    setAvailabilityBusy(true);
    try {
      await base44.entities.TeacherAvailability.delete(slot.id);
      setUnavailable((current) => current.filter((item) => item.id !== slot.id));
      notifySuccess('Unavailable period removed');
    } catch (availabilityError) {
      notifyError('Could not update teacher availability', availabilityError.response?.data?.error || availabilityError.message);
    } finally {
      setAvailabilityBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{staff ? 'Edit staff profile' : 'Add teacher or staff profile'}</DialogTitle></DialogHeader>
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
            <Input value={form.username} onChange={set('username')} placeholder={form.create_account ? 'rsmith' : 'Optional'} required={form.create_account && (!staff || !staff.has_local_login)} minLength={form.create_account ? 3 : undefined} maxLength={32} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">{staff ? 'Set / reset password' : 'Default password'}</Label>
            <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder={staff?.has_local_login ? 'Leave blank to keep current' : staff ? 'At least 8 characters' : 'Optional — leave blank to use a sign-in link'} required={Boolean(form.create_account && staff && !staff.has_local_login)} minLength={form.create_account ? 8 : undefined} disabled={!form.create_account && !staff?.has_local_login} />
            {!staff && <p className="mt-1 text-[11px] text-muted-foreground">Leave blank to let them choose their own: use the link button on the Staff page to send a setup link.</p>}
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Phone</Label>
            <Input value={form.phone} onChange={set('phone')} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Teacher number</Label>
            <Input value={form.teacher_number} onChange={set('teacher_number')} maxLength={40} placeholder="Optional, unique at this school" />
          </div>
          {form.role === 'teacher' && (
            <div>
              <Label className="mb-1.5 block text-[13px]">Employment start date</Label>
              <Input type="date" value={form.employment_start_date} onChange={set('employment_start_date')} />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[13px]">Subject specialisations</Label>
            <Input value={form.subject_specialisms} onChange={set('subject_specialisms')} placeholder="e.g. Physics, Mathematics" />
            <p className="mt-1 text-[11px] text-muted-foreground">Separate subjects with commas. They are saved as individual specialisms.</p>
          </div>
          {form.role === 'teacher' && (!staff || !staff.has_local_login) && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.create_account}
                onChange={(event) => setForm((current) => ({ ...current, create_account: event.target.checked }))}
              />
              Create a login account now
            </label>
          )}
          {staff && form.role === 'teacher' && (
            <div className="grid gap-3 rounded-xl border border-border p-3 sm:col-span-2">
              <div>
                <Label className="mb-1.5 block text-[13px]">Academic year availability</Label>
                <p className="text-[11px] text-muted-foreground">Mark periods when this teacher is unavailable. Unlisted periods remain schedulable.</p>
              </div>
              {years.length ? (
                <>
                  <Select value={availabilityYearId} onValueChange={setAvailabilityYearId}>
                    <SelectTrigger><SelectValue placeholder="Choose an academic year" /></SelectTrigger>
                    <SelectContent>{years.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}{year.is_current ? ' · Current' : ''}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Select value={availabilityDay} onValueChange={setAvailabilityDay}>
                      <SelectTrigger><SelectValue placeholder="Timetable day" /></SelectTrigger>
                      <SelectContent>{days.map((day) => <SelectItem key={day} value={day}>{day}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={availabilityPeriod} onValueChange={setAvailabilityPeriod}>
                      <SelectTrigger><SelectValue placeholder="Period" /></SelectTrigger>
                      <SelectContent>{periods.map((period) => <SelectItem key={period.number} value={String(period.number)}>Period {period.number}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={addUnavailablePeriod} disabled={availabilityBusy}>
                      <Plus className="mr-1 h-3.5 w-3.5" />Add
                    </Button>
                  </div>
                  <ul className="grid gap-1">
                    {unavailable.map((slot) => (
                      <li key={slot.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
                        <span>{slot.day_name} · Period {slot.period_number}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeUnavailablePeriod(slot)} disabled={availabilityBusy} aria-label={`Remove ${slot.day_name} period ${slot.period_number} unavailability`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                    {!unavailable.length && <li className="text-xs text-muted-foreground">No unavailable periods recorded for this year.</li>}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Add an academic year before setting availability.</p>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : staff ? 'Save profile' : form.create_account ? 'Create profile and account' : 'Create teacher profile'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}