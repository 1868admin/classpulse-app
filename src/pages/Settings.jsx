import { useCallback, useEffect, useState } from 'react';
import { Building2, Clock, ShieldCheck, Plus, Trash2, ScrollText } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notifySuccess, notifyError } from '@/lib/notify';
import MyProfileCard from '@/components/staff/MyProfileCard';
import moment from 'moment';

export default function Settings() {
  const { school, schoolId, isStaff, isSchoolAdmin, member, user, refresh } = useSchool();
  const [details, setDetails] = useState({});
  const [days, setDays] = useState(5);
  const [dayNames, setDayNames] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [yearGroups, setYearGroups] = useState([]);
  const [newGroup, setNewGroup] = useState('');
  const [logs, setLogs] = useState([]);
  const [schools, setSchools] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) return;
    const [yg, au, sw] = await Promise.all([
      base44.entities.YearGroup.filter({ school_id: schoolId }, { limit: 50, sort: 'level' }),
      base44.entities.AuditLog.filter({ school_id: schoolId }, { limit: 20, sort: '-created_date' }),
      base44.functions.invoke('switchSchool', { list: true }).catch(() => ({ data: { schools: [] } })),
    ]);
    setYearGroups(yg.items || []);
    setLogs(au.items || []);
    setSchools(sw.data?.schools || []);
  }, [schoolId]);

  useEffect(() => {
    if (!school) return;
    setDetails({
      name: school.name || '', code: school.code || '', address: school.address || '',
      phone: school.phone || '', email: school.email || '', principal_name: school.principal_name || '',
      academic_year_label: school.academic_year_label || '',
      attendance_alert_threshold: String(school.attendance_alert_threshold ?? 90),
    });
    setDays(school.timetable_days || 5);
    setDayNames(school.day_names || ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5']);
    setPeriods(school.periods || []);
  }, [school]);

  useEffect(() => { load(); }, [load]);

  const saveDetails = async () => {
    const attendanceThreshold = Number(details.attendance_alert_threshold);
    if (!Number.isFinite(attendanceThreshold) || attendanceThreshold < 0 || attendanceThreshold > 100) {
      notifyError('Invalid attendance threshold', 'Enter a percentage from 0 to 100.');
      return;
    }
    setBusy(true);
    try {
      const full = await base44.entities.School.get(schoolId);
      await base44.entities.School.update(schoolId, { ...full, ...details, attendance_alert_threshold: attendanceThreshold });
      notifySuccess('School settings saved');
      refresh();
    } catch (err) {
      notifyError('Could not save settings', err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveCycle = async () => {
    setBusy(true);
    try {
      const names = Array.from({ length: Number(days) }, (_, i) => dayNames[i] || `Day ${i + 1}`);
      await base44.entities.School.update(schoolId, { timetable_days: Number(days), day_names: names, periods });
      notifySuccess('Timetable cycle saved', `${names.length} day(s), ${periods.length} period(s)`);
      refresh();
    } catch (err) {
      notifyError('Could not save cycle', err.message);
    } finally {
      setBusy(false);
    }
  };

  const addGroup = async () => {
    if (!newGroup.trim()) return;
    await base44.entities.YearGroup.create({ school_id: schoolId, name: newGroup.trim(), level: yearGroups.length + 1, next_level: yearGroups.length + 2 });
    notifySuccess('Year group added', newGroup);
    setNewGroup('');
    load();
  };

  const removeGroup = async (g) => {
    await base44.entities.YearGroup.delete(g.id);
    notifySuccess('Year group removed', g.name);
    load();
  };

  const switchTo = async (id) => {
    if (id === schoolId) return;
    const res = await base44.functions.invoke('switchSchool', { school_id: id });
    if (res.data?.error) { notifyError('Could not switch school', res.data.error); return; }
    notifySuccess('Switched school', 'Reloading your workspace.');
    await refresh();
  };

  if (!isStaff) {
    return (
      <AppShell title="Settings">
        <PageHeader title="My profile" subtitle="Your ClassPulse account" />
        <div className="max-w-xl space-y-3">
          <MyProfileCard />
          <div className="cp-card p-4">
            <p className="text-xs text-muted-foreground">Role: {member?.role?.replace('_', ' ')} · School: {school?.name}</p>
            <p className="mt-2 text-xs text-muted-foreground">Change your password from the sign-in screen using “Forgot password”. Your role and class assignments are set by a school administrator.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Settings">
      <PageHeader title="School settings" subtitle="Details, timetable cycle and audit trail" />

      {schools.length > 1 && (
        <div className="cp-card mb-4 flex flex-wrap items-center gap-3 p-4">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Active school</p>
          <Select value={schoolId} onValueChange={switchTo}>
            <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
            <SelectContent>{schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0"><MyProfileCard /></div>
        <div className="cp-card min-w-0 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><Building2 className="h-4 w-4" />School details</h2>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {[['name', 'School name'], ['code', 'Short code'], ['principal_name', 'Principal'], ['phone', 'Phone'], ['email', 'Email'], ['academic_year_label', 'Academic year']].map(([k, label]) => (
              <div key={k}>
                <Label className="mb-1 block text-[11px]">{label}</Label>
                <Input value={details[k] || ''} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-[11px]">Address</Label>
              <Input value={details.address || ''} onChange={(e) => setDetails({ ...details, address: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-[11px]">Attendance alert threshold (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                value={details.attendance_alert_threshold ?? '90'}
                onChange={(e) => setDetails({ ...details, attendance_alert_threshold: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">The dashboard flags students whose attendance this month is below this percentage.</p>
            </div>
          </div>
          <Button size="sm" className="mt-3" onClick={saveDetails} disabled={busy}>Save details</Button>
        </div>

        <div className="cp-card min-w-0 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><Clock className="h-4 w-4" />Timetable cycle</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="mb-1 block text-[11px]">Cycle days</Label>
              <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} day(s)</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-[11px]">Day names</Label>
              <Input value={dayNames.slice(0, days).join(', ')} onChange={(e) => setDayNames(e.target.value.split(',').map((s) => s.trim()))} />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {periods.map((p, i) => (
              <div key={i} className="grid min-w-0 grid-cols-2 items-center gap-2 sm:flex">
                <div className="col-span-2 flex items-center justify-between sm:contents">
                  <span className="text-[11px] font-semibold text-muted-foreground sm:w-16 sm:shrink-0">Period {p.number}</span>
                  <button onClick={() => setPeriods(periods.filter((_, j) => j !== i).map((x, j) => ({ ...x, number: j + 1 })))} className="text-muted-foreground hover:text-destructive sm:order-last" aria-label="Remove period">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input type="time" value={p.start || ''} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="h-8 min-w-0 sm:flex-1" />
                <Input type="time" value={p.end || ''} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className="h-8 min-w-0 sm:flex-1" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPeriods([...periods, { number: periods.length + 1, start: '', end: '' }])}><Plus className="mr-1.5 h-3.5 w-3.5" />Period</Button>
            <Button size="sm" onClick={saveCycle} disabled={busy}>Save cycle</Button>
          </div>
        </div>

        <div className="cp-card min-w-0 p-4">
          <h2 className="text-sm font-bold">Year groups</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {yearGroups.map((g) => (
              <span key={g.id} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {g.name}
                {isSchoolAdmin && (
                  <button onClick={() => removeGroup(g)} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${g.name}`}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
            {yearGroups.length === 0 && <p className="text-xs text-muted-foreground">No year groups yet.</p>}
          </div>
          <div className="mt-3 flex gap-2">
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="e.g. Form 6" className="h-9 min-w-0 flex-1" />
            <Button size="sm" className="shrink-0" onClick={addGroup}><Plus className="mr-1.5 h-3.5 w-3.5" />Add</Button>
          </div>
        </div>

        <div className="cp-card min-w-0 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><ScrollText className="h-4 w-4" />Audit trail</h2>
          <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
            {logs.length === 0 && <p className="text-xs text-muted-foreground">No administrative actions recorded yet.</p>}
            {logs.map((l) => (
              <div key={l.id} className="rounded-lg border border-border px-2.5 py-1.5">
                <p className="text-[11px] font-semibold">{l.action}</p>
                <p className="text-[11px] text-muted-foreground">{l.summary}</p>
                <p className="text-[10px] text-muted-foreground">{l.actor_name} · {moment(l.created_date).format('D MMM YYYY, h:mm a')}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Only members of {school?.name} can read this school's students, classes and attendance.
      </p>
    </AppShell>
  );
}