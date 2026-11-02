import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import { notifySuccess, notifyError } from '@/lib/notify';

const BLANK = {
  student_id_no: '', birth_paper_no: '', first_name: '', middle_name: '', surname: '', gender: '',
  date_of_birth: '', year_group_id: '', homeroom_class_id: '', status: 'active',
  date_enrolled: '', guardian_name: '', guardian_phone: '', address: '', notes: '',
};

export default function StudentFormDialog({ open, onOpenChange, student, yearGroups, homerooms, academicYears = [], onSaved }) {
  const { schoolId, school, isStaff, isTeacher } = useSchool();
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [profileError, setProfileError] = useState('');
  useEffect(() => {
    let active = true;
    setProfileError('');
    if (open) {
      setForm(student ? { ...BLANK, ...student } : BLANK);
      if (student) {
        base44.entities.Student.get(student.id)
          .then((record) => { if (active) setForm({ ...BLANK, ...student, ...record }); })
          .catch((error) => {
            if (!active) return;
            setProfileError(`Could not load student details: ${error.message}`);
          });
      }
    }
    setErrors({});
    return () => { active = false; };
  }, [open, student]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }));

  const validate = () => {
    const next = {};
    if (!form.first_name.trim()) next.first_name = 'First name is required';
    if (!form.surname.trim()) next.surname = 'Surname is required';
    const homeroom = homerooms.find((item) => item.id === form.homeroom_class_id);
    if (isTeacher && !homeroom) next.homeroom_class_id = 'Choose a homeroom class';
    if (isTeacher && !(form.year_group_id || homeroom?.year_group_id)) {
      next.year_group_id = 'Choose the student’s year group';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const yg = yearGroups.find((g) => g.id === form.year_group_id);
      const hr = homerooms.find((h) => h.id === form.homeroom_class_id);
      const payload = {
        school_id: schoolId,
        student_id_no: student ? student.student_id_no || '' : '',
        birth_paper_no: isStaff ? form.birth_paper_no.trim() : '',
        first_name: form.first_name.trim(),
        middle_name: form.middle_name || '',
        surname: form.surname.trim(),
        full_name: [form.first_name, form.middle_name, form.surname].filter(Boolean).join(' ').trim(),
        gender: form.gender || '',
        date_of_birth: form.date_of_birth || '',
        year_group_id: form.year_group_id || '',
        year_group_name: yg?.name || '',
        homeroom_class_id: form.homeroom_class_id || '',
        homeroom_class_name: hr?.name || '',
        status: form.status || 'active',
        date_enrolled: form.date_enrolled || '',
        guardian_name: form.guardian_name || '',
        guardian_phone: form.guardian_phone || '',
        address: form.address || '',
        notes: form.notes || '',
      };

      const result = await base44.functions.invoke('saveStudent', {
        action: student ? 'update' : 'create',
        student_id: student?.id,
        student: payload,
      });
      if (result.data?.error) throw new Error(result.data.error);
      const saved = result.data.student;
      notifySuccess(student ? 'Student updated' : 'Student added',
        `${saved.full_name} · ${saved.student_id_no}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      notifyError('Could not save student', err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const idPattern = getStudentIdPattern({
    school, academicYears, yearGroups, homerooms,
    yearGroupId: form.year_group_id, homeroomId: form.homeroom_class_id,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{student ? 'Edit student' : 'Add student'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
          {!student && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm sm:col-span-2">
              <p className="font-semibold">Student ID is assigned automatically</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Select the correct year group and homeroom. The permanent ID follows
                graduating year–homeroom code–sequence (YYYY-CLASS-NNNN); the next
                available number is allocated when you save.
              </p>
              <p className="mt-1 text-xs">
                {idPattern ? `ID pattern for these selections: ${idPattern}` : 'Choose a year group and homeroom to see the ID pattern.'}
              </p>
              {isTeacher && <p className="mt-1 text-xs font-medium">You may choose any active homeroom in your school.</p>}
            </div>
          )}
          <Field label="Student ID" hint={student ? 'Permanent' : 'Generated on save'} error={errors.student_id_no}>
            <Input value={form.student_id_no} readOnly placeholder="Generated from year group and homeroom" />
          </Field>
          {isStaff && (
            <Field label="Birth Paper Number" hint="Optional">
              <Input value={form.birth_paper_no} onChange={set('birth_paper_no')} autoComplete="off" />
            </Field>
          )}
          {isStaff && <Field label="Status">
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['active', 'inactive', 'transferred', 'graduated'].map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>}
          <Field label="First name" required error={errors.first_name}>
            <Input value={form.first_name} onChange={set('first_name')} />
          </Field>
          <Field label="Middle name"><Input value={form.middle_name} onChange={set('middle_name')} /></Field>
          <Field label="Surname" required error={errors.surname}>
            <Input value={form.surname} onChange={set('surname')} />
          </Field>
          <Field label="Gender">
            <Select value={form.gender || 'unspecified'} onValueChange={(v) => setForm((f) => ({ ...f, gender: v === 'unspecified' ? '' : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unspecified">Not recorded</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date of birth"><Input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} /></Field>
          <Field label="Year group" required={isTeacher} error={errors.year_group_id}>
            <Select
              value={form.year_group_id || 'none'}
              onValueChange={(v) => setForm((f) => ({ ...f, year_group_id: v === 'none' ? '' : v }))}
            >
              <SelectTrigger disabled={isTeacher && !!homerooms.find((item) => item.id === form.homeroom_class_id)?.year_group_id}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {yearGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Homeroom class" required={isTeacher} error={errors.homeroom_class_id}>
            <Select
              value={form.homeroom_class_id || 'none'}
              onValueChange={(v) => {
              const homeroomId = v === 'none' ? '' : v;
              const selectedHomeroom = homerooms.find((item) => item.id === homeroomId);
              setForm((f) => ({
                ...f,
                homeroom_class_id: homeroomId,
                year_group_id: selectedHomeroom?.year_group_id || (isTeacher ? '' : f.year_group_id),
              }));
            }}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {homerooms.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date enrolled"><Input type="date" value={form.date_enrolled} onChange={set('date_enrolled')} /></Field>
          {profileError && <p className="text-sm text-destructive sm:col-span-2">{profileError}</p>}
          <Field label="Guardian name"><Input value={form.guardian_name} onChange={set('guardian_name')} /></Field>
          <Field label="Guardian phone"><Input value={form.guardian_phone} onChange={set('guardian_phone')} /></Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input value={form.notes} onChange={set('notes')} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !!profileError}>{busy ? 'Saving…' : student ? 'Save changes' : 'Add student'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getStudentIdPattern({ school, academicYears, yearGroups, homerooms, yearGroupId, homeroomId }) {
  const homeroom = homerooms.find((item) => item.id === homeroomId);
  const yearGroup = yearGroups.find((item) => item.id === (yearGroupId || homeroom?.year_group_id));
  if (!homeroom || !yearGroup) return '';

  const yearLabel = school?.academic_year_label || academicYears.find((item) => item.is_current)?.name || '';
  const yearMatches = [...String(yearLabel).matchAll(/\d{4}/g)].map((match) => Number(match[0]));
  const endYear = yearMatches.at(-1) || new Date().getFullYear();
  const levelOf = (group) => Number(group.level) || Number(String(group.name || '').match(/\d+/)?.[0]) || 0;
  const maxLevel = Math.max(1, ...yearGroups.map(levelOf));
  const graduatingYear = endYear + Math.max(0, maxLevel - levelOf(yearGroup));
  const groupName = String(yearGroup.name || '').trim();
  let classCode = String(homeroom.name || '').trim();
  if (groupName && classCode.toLowerCase().startsWith(groupName.toLowerCase())) {
    classCode = classCode.slice(groupName.length);
  } else {
    classCode = classCode.replace(/^(?:form\s*)?\d+\s*/i, '');
  }
  classCode = classCode.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'UNASSIGNED';
  return `${graduatingYear}-${classCode}-NNNN`;
}

function Field({ label, required, hint, error, className = '', children }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-[13px]">
        {label} {required && <span className="text-destructive">*</span>}
        {hint && <span className="ml-1 font-normal text-muted-foreground">({hint})</span>}
      </Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}