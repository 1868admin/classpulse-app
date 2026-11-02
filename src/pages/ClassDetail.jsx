import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, UserPlus, X, ClipboardCheck, Star, Pencil, Upload, FileSpreadsheet, FileText } from 'lucide-react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import PageHeader from '@/components/ui-bits/PageHeader';
import StudentPicker from '@/components/classes/StudentPicker';
import ClassFormDialog from '@/components/classes/ClassFormDialog';
import ImportStudentsDialog from '@/components/students/ImportStudentsDialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notifySuccess, notifyError } from '@/lib/notify';
import { fmtDate } from '@/lib/dates';

export default function ClassDetail({ type = 'subject' }) {
  const { id } = useParams();
  const { schoolId, member, school, isStaff } = useSchool();
  const entity = type === 'subject' ? 'SubjectClass' : 'HomeroomClass';
  const [klass, setKlass] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [members, setMembers] = useState([]);
  const [studentProfiles, setStudentProfiles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [yearGroups, setYearGroups] = useState([]);
  const [homerooms, setHomerooms] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sortOrder, setSortOrder] = useState('name-asc');

  const load = useCallback(async () => {
    if (!schoolId || !id) return;
    setLoading(true);
    setLoadError('');
    try {
      const [cls, links, mem, ses, staff, yg, hr] = await base44.queryBatch([
        { entity, query: { school_id: schoolId, id }, options: { limit: 1 } },
        { entity: 'ClassTeacher', query: { school_id: schoolId, class_id: id }, options: { limit: 50 } },
        { entity: 'ClassMembership', query: { school_id: schoolId, class_id: id }, options: { limit: 300, sort: 'student_name' } },
        { entity: 'AttendanceSession', query: { school_id: schoolId, class_id: id }, options: { limit: 12, sort: '-date' } },
        { entity: 'SchoolMember', query: { school_id: schoolId, status: { $ne: 'inactive' } }, options: { limit: 200, sort: 'full_name' } },
        { entity: 'YearGroup', query: { school_id: schoolId }, options: { limit: 50, sort: 'level' } },
        { entity: 'HomeroomClass', query: { school_id: schoolId, archived: false }, options: { limit: 100, sort: 'name' } },
      ]);
      setKlass(cls.items?.[0] || null);
      setTeachers(links.items || []);
      const classMembers = mem.items || [];
      setMembers(classMembers);
      setSessions(ses.items || []);
      setStaffList(staff.items || []);
      setYearGroups(yg.items || []);
      setHomerooms(hr.items || []);
      if (classMembers.length) {
        const profiles = await base44.entities.Student.filter({
          school_id: schoolId,
          id: { $in: classMembers.map((item) => item.student_id) },
        }, { limit: 300 });
        setStudentProfiles(profiles.items || []);
      } else {
        setStudentProfiles([]);
      }
    } catch (err) {
      setLoadError(err.message || 'Could not load this class.');
    } finally {
      setLoading(false);
    }
  }, [schoolId, id, entity]);

  useEffect(() => { load(); }, [load]);

  const canEdit = isStaff || teachers.some((t) => t.member_id === member?.id);
  const sortedMembers = useMemo(() => {
    const sorted = [...members];
    sorted.sort((a, b) => {
      const first = sortOrder.startsWith('id') ? a.student_id_no : a.student_name;
      const second = sortOrder.startsWith('id') ? b.student_id_no : b.student_name;
      const comparison = String(first || '').localeCompare(String(second || ''), undefined, { numeric: true, sensitivity: 'base' });
      return sortOrder.endsWith('desc') ? -comparison : comparison;
    });
    return sorted;
  }, [members, sortOrder]);

  const exportRows = sortedMembers.map((classMember, index) => {
    const profile = studentProfiles.find((student) => student.id === classMember.student_id);
    return [
      index + 1,
      classMember.student_id_no || profile?.student_id_no || '',
      classMember.student_name || profile?.full_name || '',
      profile?.gender || '',
      '',
    ];
  });
  const exportMetadata = [
    ['School', school?.name || ''],
    ['Academic year', klass?.academic_year_name || school?.academic_year_label || ''],
    ['Class', klass?.name || ''],
    ...(type === 'subject' ? [['Subject', klass?.subject || '']] : []),
    ['Teacher', teachers.map((teacher) => teacher.member_name).filter(Boolean).join(', ')],
  ];

  const exportExcel = () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ...exportMetadata,
      [],
      ['No.', 'Student ID', 'Student full name', 'Gender', 'Attendance'],
      ...exportRows,
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Class list');
    const filename = `${klass.name.replace(/[^a-z0-9_-]+/gi, '-')}-class-list.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  const exportPdf = () => {
    const pdf = new jsPDF({ orientation: 'landscape' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const left = 12;
    const widths = [12, 35, 75, 28, pageWidth - 24 - 12 - 35 - 75 - 28];
    const headings = ['No.', 'Student ID', 'Student full name', 'Gender', 'Attendance'];
    const drawTableHeader = (y) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      let x = left;
      headings.forEach((heading, index) => {
        pdf.rect(x, y, widths[index], 8);
        pdf.text(heading, x + 2, y + 5.5);
        x += widths[index];
      });
      pdf.setFont('helvetica', 'normal');
      return y + 8;
    };

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(school?.name || 'ClassPulse', left, 14);
    pdf.setFontSize(12);
    pdf.text(`${klass.name}${type === 'subject' && klass.subject ? ` · ${klass.subject}` : ''}`, left, 22);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(`Academic year: ${klass.academic_year_name || school?.academic_year_label || '—'}`, left, 28);
    pdf.text(`Teacher: ${teachers.map((teacher) => teacher.member_name).filter(Boolean).join(', ') || '—'}`, left, 33);
    pdf.text(`Students: ${exportRows.length}`, pageWidth - 12, 33, { align: 'right' });

    let y = drawTableHeader(38);
    for (const row of exportRows) {
      if (y > pdf.internal.pageSize.getHeight() - 15) {
        pdf.addPage();
        y = drawTableHeader(12);
      }
      let x = left;
      row.forEach((value, index) => {
        pdf.rect(x, y, widths[index], 8);
        const text = pdf.splitTextToSize(String(value || ''), widths[index] - 4)[0] || '';
        pdf.text(text, x + 2, y + 5.5);
        x += widths[index];
      });
      y += 8;
    }
    pdf.save(`${klass.name.replace(/[^a-z0-9_-]+/gi, '-')}-class-list.pdf`);
  };

  const addStudents = async (ids) => {
    try {
      const result = await base44.functions.invoke('assignStudents', {
        class_type: type,
        class_id: id,
        student_ids: ids,
      });
      if (result.data?.error) throw new Error(result.data.error);
      notifySuccess(
        'Students assigned',
        `${result.data.added} added${result.data.skipped ? ` · ${result.data.skipped} already enrolled` : ''} in ${klass?.name}.`,
      );
      load();
    } catch (err) {
      notifyError('Could not add students', err.message);
    }
  };

  const removeStudent = async (m) => {
    try {
      const result = await base44.functions.invoke('removeClassStudent', { membership_id: m.id });
      if (result.data?.error) throw new Error(result.data.error);
      notifySuccess('Student removed', `${m.student_name} removed from the class.`);
      load();
    } catch (err) {
      notifyError('Could not remove student', err.response?.data?.error || err.message);
    }
  };

  if (loading && !klass) {
    return <AppShell title="Class"><p className="text-sm text-muted-foreground">Loading class…</p></AppShell>;
  }
  if (!klass) {
    return (
      <AppShell title="Class">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{loadError || 'This class could not be found.'}</span>
          {loadError && <Button size="sm" variant="outline" onClick={load}>Retry</Button>}
        </div>
      </AppShell>
    );
  }

  const backTo = type === 'subject' ? '/subject-classes' : '/homerooms';

  return (
    <AppShell title={klass.name}>
      <Link to={backTo} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />Back to {type === 'subject' ? 'subject classes' : 'homeroom classes'}
      </Link>

      <PageHeader
        title={klass.name}
        subtitle={[type === 'subject' ? klass.subject : 'Homeroom class', klass.year_group_name, klass.room].filter(Boolean).join(' · ')}
        actions={
          <>
            {canEdit && <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit class</Button>}
            <Link to={`/attendance?class=${klass.id}&type=${type}`}>
              <Button size="sm"><ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />Take attendance</Button>
            </Link>
          </>
        }
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <div className="cp-card min-w-0 p-4">
          <h2 className="text-sm font-bold">Teachers</h2>
          <div className="mt-2 space-y-1.5">
            {teachers.length === 0 && <p className="text-xs text-muted-foreground">No teachers assigned yet.</p>}
            {teachers.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5">
                <span className="text-xs font-medium">{t.member_name}</span>
                {t.is_primary && <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300"><Star className="h-2.5 w-2.5 fill-amber-600" />Primary</span>}
              </div>
            ))}
          </div>
          {klass.homeroom_names?.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">Linked homerooms: {klass.homeroom_names.join(', ')}</p>
          )}
          {klass.notes && <p className="mt-3 text-[11px] text-muted-foreground">{klass.notes}</p>}
        </div>

        <div className="cp-card min-w-0 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-bold">Students</h2>
              <p className="text-xs text-muted-foreground">{members.length} on the class list</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={sortOrder} onValueChange={setSortOrder}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Name A–Z</SelectItem>
                  <SelectItem value="name-desc">Name Z–A</SelectItem>
                  <SelectItem value="id-asc">ID ascending</SelectItem>
                  <SelectItem value="id-desc">ID descending</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={exportPdf}><FileText className="mr-1.5 h-3.5 w-3.5" />PDF</Button>
              <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />Excel</Button>
              {canEdit && <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-1.5 h-3.5 w-3.5" />Import</Button>}
              {canEdit && <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}><UserPlus className="mr-1.5 h-3.5 w-3.5" />Add students</Button>}
            </div>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {members.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No students in this class yet.</p>}
            {sortedMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-2 border-b border-border/50 px-4 py-2 last:border-0">
                <span className="min-w-0 flex-1 truncate text-sm">{m.student_name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{m.student_id_no}</span>
                {canEdit && (
                  <button onClick={() => removeStudent(m)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`Remove ${m.student_name}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="cp-card min-w-0 lg:col-span-3">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-bold">Attendance history</h2>
            <p className="text-xs text-muted-foreground">Most recent registers for this class</p>
          </div>
          <div className="w-full min-w-0 max-w-full overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="cp-table-head">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Session</th>
                  <th className="px-4 py-2">Teacher</th>
                  <th className="px-4 py-2">Present</th>
                  <th className="px-4 py-2">Absent</th>
                  <th className="px-4 py-2">Late</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">No registers submitted for this class yet.</td></tr>
                )}
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-border/60">
                    <td className="px-4 py-2">{fmtDate(s.date)}</td>
                    <td className="px-4 py-2">{s.session_label}</td>
                    <td className="px-4 py-2 text-muted-foreground">{s.member_name || '—'}</td>
                    <td className="px-4 py-2 font-semibold text-emerald-600">{s.present_count}</td>
                    <td className="px-4 py-2 font-semibold text-red-600">{s.absent_count}</td>
                    <td className="px-4 py-2 font-semibold text-amber-600">{s.late_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <StudentPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        yearGroups={yearGroups}
        homerooms={homerooms}
        excludeIds={members.map((m) => m.student_id)}
        onConfirm={addStudents}
      />
      <ImportStudentsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        yearGroups={yearGroups}
        homerooms={homerooms}
        onImported={load}
        targetClassType={type}
        targetClassId={id}
        defaultYearGroupId={klass.year_group_id || ''}
        defaultHomeroomId={type === 'homeroom' ? id : ''}
      />
      <ClassFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        type={type}
        klass={klass}
        yearGroups={yearGroups}
        homerooms={homerooms}
        teachers={staffList}
        onSaved={load}
      />
    </AppShell>
  );
}