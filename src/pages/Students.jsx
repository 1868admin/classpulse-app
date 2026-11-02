import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Upload, Download, Users, CheckCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import SearchInput from '@/components/ui-bits/SearchInput';
import EmptyState from '@/components/ui-bits/EmptyState';
import StudentsTable from '@/components/students/StudentsTable';
import StudentFormDialog from '@/components/students/StudentFormDialog';
import BulkActionsBar from '@/components/students/BulkActionsBar';
import ImportStudentsDialog from '@/components/students/ImportStudentsDialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notifySuccess, notifyError } from '@/lib/notify';
import { toCSV, downloadFile } from '@/lib/csv';

const PAGE_SIZE = 50;

export default function Students() {
  const { schoolId, member, isStaff, isSchoolAdmin, isTeacher } = useSchool();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [yearGroupId, setYearGroupId] = useState('all');
  const [homeroomId, setHomeroomId] = useState('all');
  const [subjectClassId, setSubjectClassId] = useState('all');
  const [academicYearId, setAcademicYearId] = useState('all');
  const [gender, setGender] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('surname');
  const [view, setView] = useState('active');
  const [yearGroups, setYearGroups] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [homerooms, setHomerooms] = useState([]);
  const [subjectClasses, setSubjectClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    Promise.all([
      base44.entities.YearGroup.filter({ school_id: schoolId }, { limit: 50, sort: 'level' }),
      base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 100, sort: 'name' }),
      base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 150, sort: 'name' }),
      base44.entities.AcademicYear.filter({ school_id: schoolId }, { limit: 50, sort: '-name' }),
    ]).then(([yg, hr, sc, ay]) => {
      setYearGroups(yg.items || []);
      setHomerooms(hr.items || []);
      setSubjectClasses(sc.items || []);
      setAcademicYears(ay.items || []);
    });
  }, [schoolId]);

  const buildQuery = useCallback(() => {
    const clauses = [{ school_id: schoolId }];
    if (view === 'archived') clauses.push({ archived: true });
    else if (view === 'active') clauses.push({ archived: { $ne: true } });
    if (yearGroupId !== 'all') clauses.push({ year_group_id: yearGroupId });
    if (homeroomId !== 'all') clauses.push({ homeroom_class_id: homeroomId });
    if (academicYearId !== 'all') clauses.push({ academic_year_id: academicYearId });
    if (gender !== 'all') clauses.push({ gender });
    if (status !== 'all') clauses.push({ status });
    if (q.trim()) {
      clauses.push({
        $or: [
          { student_id_no: { $regex: q.trim(), $options: 'i' } },
          { first_name: { $regex: q.trim(), $options: 'i' } },
          { surname: { $regex: q.trim(), $options: 'i' } },
          { full_name: { $regex: q.trim(), $options: 'i' } },
        ],
      });
    }
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }, [schoolId, view, yearGroupId, homeroomId, academicYearId, gender, status, q]);

  const filteredQuery = useCallback(async () => {
    const query = buildQuery();
    if (subjectClassId === 'all') return query;
    const page = await base44.entities.ClassMembership.filter({
      school_id: schoolId,
      class_type: 'subject',
      class_id: subjectClassId,
    }, { limit: 1000 });
    const ids = [...new Set((page.items || []).map((item) => item.student_id).filter(Boolean))];
    return { $and: [query, { id: { $in: ids } }] };
  }, [buildQuery, schoolId, subjectClassId]);

  const load = useCallback(async (nextCursor = null) => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const query = await filteredQuery();
      const page = await base44.entities.Student.filter(query, {
        limit: PAGE_SIZE,
        sort,
        ...(nextCursor ? { cursor: nextCursor } : {}),
      });
      setStudents((prev) => (nextCursor ? [...prev, ...(page.items || [])] : page.items || []));
      setCursor(page.next_cursor || null);
    } finally {
      setLoading(false);
    }
  }, [schoolId, filteredQuery, sort]);

  useEffect(() => { load(); setSelected(new Set()); }, [load]);
  useEffect(() => { setParams(q ? { q } : {}, { replace: true }); }, [q, setParams]);

  const allLoadedSelected = students.length > 0 && students.every((s) => selected.has(s.id));

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (allLoadedSelected) setSelected(new Set());
    else setSelected(new Set(students.map((s) => s.id)));
  };

  const selectAllFiltered = async () => {
    const query = await filteredQuery();
    const page = await base44.entities.Student.filter(query, { limit: 1000, sort });
    setSelected(new Set((page.items || []).map((s) => s.id)));
    notifySuccess('Selection updated', `${(page.items || []).length} student(s) selected.`);
  };

  const runBulk = async (action, payload) => {
    try {
      const res = await base44.functions.invoke('bulkStudentAction', { action, student_ids: [...selected], payload });
      if (res.data?.error) throw new Error(res.data.error);
      notifySuccess('Students updated', `${res.data.affected} record(s) changed.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      notifyError('Update failed', err.response?.data?.error || err.message);
    }
  };

  const archiveOne = async (s) => {
    await base44.entities.Student.update(s.id, { archived: true, status: 'inactive' });
    notifySuccess('Student archived', `${s.full_name} moved to the archive.`);
    load();
  };

  const restoreOne = async (s) => {
    await base44.entities.Student.update(s.id, { archived: false, status: 'active' });
    notifySuccess('Student restored', `${s.full_name} is back on the roll.`);
    load();
  };

  const exportCsv = async () => {
    const query = await filteredQuery();
    const page = await base44.entities.Student.filter(query, { limit: 1000, sort });
    const rows = (page.items || []).map((s) => [
      s.student_id_no, s.first_name, s.middle_name, s.surname, s.gender, s.date_of_birth,
      s.year_group_name, s.homeroom_class_name, s.status, s.date_enrolled, s.guardian_name, s.guardian_phone,
    ]);
    downloadFile('classpulse-students.csv', toCSV(
      ['Student ID', 'First name', 'Middle name', 'Surname', 'Gender', 'DOB', 'Year group', 'Homeroom', 'Status', 'Enrolled', 'Guardian', 'Guardian phone'],
      rows,
    ));
    notifySuccess('Export ready', `${rows.length} student(s) exported.`);
  };

  const canManage = isStaff;
  const canAddStudent = isStaff || isTeacher;

  return (
    <AppShell title="Students">
      <PageHeader
        title="Students"
        subtitle={`${students.length}${cursor ? '+' : ''} shown${selected.size ? ` · ${selected.size} selected` : ''}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="mr-1.5 h-3.5 w-3.5" />Export</Button>
            {canManage && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="mr-1.5 h-3.5 w-3.5" />Import</Button>}
            {canAddStudent && <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" />Add student</Button>}
          </>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <SearchInput value={q} onChange={setQ} placeholder="Search ID, first or surname…" className="lg:col-span-2" />
        <Select value={yearGroupId} onValueChange={setYearGroupId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All year groups</SelectItem>
            {yearGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={homeroomId} onValueChange={setHomeroomId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All homerooms</SelectItem>
            {homerooms.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={subjectClassId} onValueChange={setSubjectClassId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subject classes</SelectItem>
            {subjectClasses.map((classItem) => <SelectItem key={classItem.id} value={classItem.id}>{classItem.name} · {classItem.subject}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={academicYearId} onValueChange={setAcademicYearId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All academic years</SelectItem>
            {academicYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={gender} onValueChange={setGender}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All genders</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="male">Male</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {['active', 'inactive', 'transferred', 'graduated'].map((value) => <SelectItem key={value} value={value} className="capitalize">{value}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={view} onValueChange={setView}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active roll</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All students</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="surname">Last name A–Z</SelectItem>
            <SelectItem value="-surname">Last name Z–A</SelectItem>
            <SelectItem value="first_name">First name A–Z</SelectItem>
            <SelectItem value="-first_name">First name Z–A</SelectItem>
            <SelectItem value="full_name">Full name A–Z</SelectItem>
            <SelectItem value="-full_name">Full name Z–A</SelectItem>
            <SelectItem value="student_id_no">Student ID A–Z</SelectItem>
            <SelectItem value="-student_id_no">Student ID Z–A</SelectItem>
            <SelectItem value="year_group_name">Year group A–Z</SelectItem>
            <SelectItem value="homeroom_class_name">Homeroom A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={selectAllFiltered} className="text-xs">
          <CheckCheck className="mr-1.5 h-3.5 w-3.5" />Select all filtered
        </Button>
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelected(new Set())}>Clear selection</Button>
        )}
      </div>

      {students.length === 0 && !loading ? (
        <EmptyState
          icon={Users}
          title="No students found"
          description={q || yearGroupId !== 'all' || homeroomId !== 'all' ? 'Try clearing your filters or searching a different name.' : 'Add students one at a time, or import your roll from a CSV file.'}
          action={canAddStudent ? <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" />Add student</Button> : undefined}
        />
      ) : (
        <StudentsTable
          students={students}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onEdit={(s) => { setEditing(s); setFormOpen(true); }}
          onArchive={archiveOne}
          onRestore={restoreOne}
          canManage={canManage}
        />
      )}

      {cursor && (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => load(cursor)} disabled={loading}>
            {loading ? 'Loading…' : 'Load more students'}
          </Button>
        </div>
      )}

      <BulkActionsBar
        count={selected.size}
        yearGroups={yearGroups}
        homerooms={homerooms}
        subjectClasses={subjectClasses}
        onAction={runBulk}
        canManage={canManage}
        canDelete={isSchoolAdmin}
      />

      <StudentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        student={editing}
        yearGroups={yearGroups}
        homerooms={homerooms}
        academicYears={academicYears}
        onSaved={load}
      />

      <ImportStudentsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        yearGroups={yearGroups}
        homerooms={homerooms}
        onImported={load}
      />
    </AppShell>
  );
}