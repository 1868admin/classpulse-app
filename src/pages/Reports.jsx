import { useCallback, useEffect, useMemo, useState } from 'react';
import moment from 'moment';
import { Download, FileText, Printer } from 'lucide-react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { base44 } from '@/api/base44Client';
import { useSchool } from '@/context/SchoolContext';
import AppShell from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toCSV, downloadFile } from '@/lib/csv';
import { notifySuccess, notifyError } from '@/lib/notify';

const REPORT_TABS = [
  { id: 'class', label: 'Class report' },
  { id: 'student', label: 'Student report' },
  { id: 'daily', label: 'Daily sheet' },
  { id: 'summary', label: 'Summary & trends' },
];
const STATUS_KEYS = ['present', 'absent', 'late', 'excused'];
const EMPTY_COUNTS = { sessions: 0, present: 0, absent: 0, late: 0, excused: 0 };
const ALL_CLASSES = '__all_classes__';

async function fetchAll(entity, query, cap = 100) {
  const items = [];
  let cursor = null;
  for (let pageNumber = 0; pageNumber < cap; pageNumber += 1) {
    const page = await base44.entities[entity].filter(query, {
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!cursor) return { items, truncated: false };
  }
  return { items, truncated: !!cursor };
}

function sumStatuses(records) {
  const summary = { ...EMPTY_COUNTS, sessionIds: new Set() };
  records.forEach((record) => {
    summary.sessionIds.add(record.session_id);
    if (STATUS_KEYS.includes(record.status)) summary[record.status] += 1;
  });
  summary.sessions = summary.sessionIds.size;
  delete summary.sessionIds;
  return summary;
}

function attendancePercent(counts) {
  const total = counts.present + counts.absent + counts.late + counts.excused;
  return total ? ((counts.present + counts.late) / total) * 100 : null;
}

function percentText(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
}

export default function Reports() {
  const { schoolId, school, member, isStaff } = useSchool();
  const [reportType, setReportType] = useState('class');
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [classValue, setClassValue] = useState('');
  const [studentOptions, setStudentOptions] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [studentLoading, setStudentLoading] = useState(false);
  const [from, setFrom] = useState(moment().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(moment().format('YYYY-MM-DD'));
  const [dailyDate, setDailyDate] = useState(moment().format('YYYY-MM-DD'));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const selectedClass = useMemo(
    () => classes.find((item) => item.key === classValue) || null,
    [classes, classValue],
  );
  const isTeacher = member?.role === 'teacher';

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) return undefined;
    setClassesLoading(true);
    (async () => {
      let links = [];
      if (isTeacher) {
        const result = await fetchAll('ClassTeacher', { school_id: schoolId, member_id: member.id }, 10);
        links = result.items;
      }

      const teacherClassIds = new Set(links.map((link) => `${link.class_type || 'homeroom'}|${link.class_id}`));
      const [homerooms, subjects] = await Promise.all([
        base44.entities.HomeroomClass.filter({ school_id: schoolId, archived: false }, { limit: 1000, sort: 'name' }),
        base44.entities.SubjectClass.filter({ school_id: schoolId, archived: false }, { limit: 1000, sort: 'name' }),
      ]);
      const available = [
        ...(homerooms.items || []).map((item) => ({ ...item, type: 'homeroom', key: `homeroom|${item.id}` })),
        ...(subjects.items || []).map((item) => ({ ...item, type: 'subject', key: `subject|${item.id}` })),
      ]
        .filter((item) => !isTeacher || teacherClassIds.has(item.key))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      if (!cancelled) {
        setClasses(available);
        setClassValue((current) => available.some((item) => item.key === current) ? current : available[0]?.key || '');
      }
    })()
      .catch((error) => {
        if (!cancelled) notifyError('Could not load report classes', error.message);
      })
      .finally(() => {
        if (!cancelled) setClassesLoading(false);
      });
    return () => { cancelled = true; };
  }, [schoolId, isTeacher, member?.id]);

  useEffect(() => {
    let cancelled = false;
    if (reportType !== 'student' || !schoolId || !classes.length) {
      setStudentOptions([]);
      setStudentId('');
      return undefined;
    }

    setStudentLoading(true);
    (async () => {
      const memberships = await fetchAll('ClassMembership', {
        school_id: schoolId,
        class_id: { $in: classes.map((item) => item.id) },
      });
      const rosterById = new Map();
      memberships.items.forEach((membership) => {
        if (!rosterById.has(membership.student_id)) rosterById.set(membership.student_id, membership.student_name || '');
      });
      const ids = [...rosterById.keys()];
      const profiles = ids.length
        ? await fetchAll('Student', { school_id: schoolId, id: { $in: ids }, archived: { $ne: true } })
        : { items: [] };
      const options = profiles.items
        .map((student) => ({
          id: student.id,
          name: student.full_name || rosterById.get(student.id) || 'Student',
          studentId: student.student_id_no || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      if (!cancelled) {
        setStudentOptions(options);
        setStudentId((current) => options.some((item) => item.id === current) ? current : options[0]?.id || '');
      }
    })()
      .catch((error) => {
        if (!cancelled) notifyError('Could not load students for report', error.message);
      })
      .finally(() => {
        if (!cancelled) setStudentLoading(false);
      });
    return () => { cancelled = true; };
  }, [reportType, schoolId, classes]);

  const changeTab = (next) => {
    setReportType(next);
    if (next !== 'summary' && classValue === ALL_CLASSES) setClassValue(classes[0]?.key || '');
    setReport(null);
  };

  const buildReport = useCallback(async () => {
    if (reportType === 'daily' && !dailyDate) {
      notifyError('Choose a date', 'Select a date for the daily attendance sheet.');
      return;
    }
    if (from > to) {
      notifyError('Invalid date range', 'The start date must be on or before the end date.');
      return;
    }
    if (reportType !== 'summary' && !selectedClass) {
      notifyError('Choose a class', 'Select one of your available classes to build this report.');
      return;
    }
    if (reportType === 'student' && !studentId) {
      notifyError('Choose a student', 'Select a student to build their attendance report.');
      return;
    }

    setLoading(true);
    try {
      let result;
      if (reportType === 'class' || reportType === 'daily') {
        const dateFrom = reportType === 'daily' ? dailyDate : from;
        const dateTo = reportType === 'daily' ? dailyDate : to;
        const [membershipResult, recordResult, sessionResult] = await Promise.all([
          fetchAll('ClassMembership', { school_id: schoolId, class_type: selectedClass.type, class_id: selectedClass.id }),
          fetchAll('AttendanceRecord', {
            school_id: schoolId,
            class_type: selectedClass.type,
            class_id: selectedClass.id,
            date: { $gte: dateFrom, $lte: dateTo },
          }),
          fetchAll('AttendanceSession', {
            school_id: schoolId,
            class_type: selectedClass.type,
            class_id: selectedClass.id,
            date: { $gte: dateFrom, $lte: dateTo },
          }),
        ]);
        const ids = [...new Set(membershipResult.items.map((item) => item.student_id))];
        const profilesResult = ids.length
          ? await fetchAll('Student', { school_id: schoolId, id: { $in: ids } })
          : { items: [], truncated: false };
        const profilesById = new Map(profilesResult.items.map((student) => [student.id, student]));
        const recordsByStudent = new Map();
        recordResult.items.forEach((record) => {
          const studentRecords = recordsByStudent.get(record.student_id) || [];
          studentRecords.push(record);
          recordsByStudent.set(record.student_id, studentRecords);
        });
        const summary = sumStatuses(recordResult.items);
        const rosterRows = membershipResult.items
          .map((membership) => {
            const profile = profilesById.get(membership.student_id) || {};
            const studentRecords = recordsByStudent.get(membership.student_id) || [];
            const counts = sumStatuses(studentRecords);
            return {
              number: 0,
              student: profile.full_name || membership.student_name || 'Student',
              registration: profile.student_id_no || membership.student_id_no || '',
              sessions: reportType === 'daily' ? (studentRecords.length ? studentRecords.length : 'Not recorded') : counts.sessions,
              present: reportType === 'daily' ? studentRecords.filter((item) => item.status === 'present').length ? 'Present' : studentRecords.length ? studentRecords[0].status : 'Not recorded' : counts.present,
              absent: reportType === 'daily' ? '' : counts.absent,
              late: reportType === 'daily' ? '' : counts.late,
              excused: reportType === 'daily' ? '' : counts.excused,
              attendance: reportType === 'daily' ? '' : percentText(attendancePercent(counts)),
              note: reportType === 'daily' ? studentRecords[0]?.note || '' : '',
            };
          })
          .sort((a, b) => a.student.localeCompare(b.student, undefined, { numeric: true, sensitivity: 'base' }))
          .map((row, index) => ({ ...row, number: index + 1 }));
        const recordedSessions = new Set(sessionResult.items.map((item) => item.id)).size;
        const avg = rosterRows.filter((row) => row.attendance !== '—').length
          ? rosterRows.reduce((total, row) => total + (row.attendance === '—' ? 0 : Number.parseFloat(row.attendance)), 0)
            / rosterRows.filter((row) => row.attendance !== '—').length
          : null;
        result = {
          title: `${reportType === 'daily' ? 'Daily attendance sheet' : 'Class attendance report'} — ${selectedClass.name}`,
          subtitle: `${school?.name || 'ClassPulse'} · ${moment(dateFrom).format('D MMM YYYY')} to ${moment(dateTo).format('D MMM YYYY')}`,
          info: [
            `Students: ${membershipResult.items.length}`,
            `Sessions recorded: ${recordedSessions}`,
            `Present ${summary.present} · Absent ${summary.absent} · Late ${summary.late} · Excused ${summary.excused}`,
            `Average attendance: ${percentText(avg)}`,
          ],
          headers: reportType === 'daily'
            ? ['#', 'Student', 'Registration', 'Attendance status', 'Note']
            : ['#', 'Student', 'Registration', 'Sessions', 'Present', 'Absent', 'Late', 'Excused', 'Attendance %'],
          rows: rosterRows,
          exportRows: reportType === 'daily'
            ? rosterRows.map((row) => [row.number, row.student, row.registration, row.present, row.note])
            : rosterRows.map((row) => [row.number, row.student, row.registration, row.sessions, row.present, row.absent, row.late, row.excused, row.attendance]),
          truncated: membershipResult.truncated || recordResult.truncated || sessionResult.truncated || profilesResult.truncated,
          type: reportType,
        };
      } else if (reportType === 'student') {
        const [memberships, homeroomRecords, subjectRecords] = await Promise.all([
          fetchAll('ClassMembership', { school_id: schoolId, student_id: studentId, class_id: { $in: classes.map((item) => item.id) } }),
          fetchAll('AttendanceRecord', { school_id: schoolId, student_id: studentId, class_type: 'homeroom', date: { $gte: from, $lte: to } }),
          fetchAll('AttendanceRecord', { school_id: schoolId, student_id: studentId, class_type: 'subject', date: { $gte: from, $lte: to } }),
        ]);
        const validClassKeys = new Set(memberships.items.map((item) => `${item.class_type}|${item.class_id}`));
        const relevant = [...homeroomRecords.items, ...subjectRecords.items]
          .filter((record) => validClassKeys.has(`${record.class_type || 'homeroom'}|${record.class_id}`));
        const classByKey = new Map(classes.map((item) => [item.key, item]));
        const grouped = new Map();
        relevant.forEach((record) => {
          const type = record.class_type || 'homeroom';
          const key = `${type}|${record.class_id}`;
          const counts = grouped.get(key) || {
            ...EMPTY_COUNTS,
            sessionIds: new Set(),
            className: classByKey.get(key)?.name || record.class_name || 'Class',
            type,
          };
          counts.sessionIds.add(record.session_id);
          if (STATUS_KEYS.includes(record.status)) counts[record.status] += 1;
          grouped.set(key, counts);
        });
        const rows = [...grouped.values()]
          .map((counts, index) => ({
            number: index + 1,
            className: counts.className,
            type: counts.type,
            sessions: counts.sessionIds.size,
            present: counts.present,
            absent: counts.absent,
            late: counts.late,
            excused: counts.excused,
            attendance: percentText(attendancePercent(counts)),
          }))
          .sort((a, b) => a.className.localeCompare(b.className));
        const student = studentOptions.find((item) => item.id === studentId);
        result = {
          title: `Student attendance report — ${student?.name || 'Student'}`,
          subtitle: `${school?.name || 'ClassPulse'} · ${moment(from).format('D MMM YYYY')} to ${moment(to).format('D MMM YYYY')}`,
          info: [`Student ID: ${student?.studentId || '—'}`, `Classes: ${memberships.items.length}`, `Sessions with records: ${rows.reduce((total, row) => total + row.sessions, 0)}`],
          headers: ['#', 'Class', 'Type', 'Sessions', 'Present', 'Absent', 'Late', 'Excused', 'Attendance %'],
          rows,
          exportRows: rows.map((row) => [row.number, row.className, row.type, row.sessions, row.present, row.absent, row.late, row.excused, row.attendance]),
          truncated: memberships.truncated || homeroomRecords.truncated || subjectRecords.truncated,
          type: reportType,
        };
      } else {
        const chosenClasses = classValue === ALL_CLASSES ? classes : selectedClass ? [selectedClass] : [];
        const classIds = chosenClasses.map((item) => item.id);
        if (!classIds.length) throw new Error('No assigned classes are available for the selected report.');
        const [homerooms, subjects] = await Promise.all([
          fetchAll('AttendanceRecord', {
            school_id: schoolId,
            class_type: 'homeroom',
            class_id: { $in: classIds },
            date: { $gte: from, $lte: to },
          }),
          fetchAll('AttendanceRecord', {
            school_id: schoolId,
            class_type: 'subject',
            class_id: { $in: classIds },
            date: { $gte: from, $lte: to },
          }),
        ]);
        const dateGroups = new Map();
        [...homerooms.items, ...subjects.items].forEach((record) => {
          const counts = dateGroups.get(record.date) || { ...EMPTY_COUNTS, sessionIds: new Set() };
          counts.sessionIds.add(record.session_id);
          if (STATUS_KEYS.includes(record.status)) counts[record.status] += 1;
          dateGroups.set(record.date, counts);
        });
        const rows = [...dateGroups.entries()]
          .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
          .map(([date, counts], index) => ({
            number: index + 1,
            date: moment(date).format('D MMM YYYY'),
            sessions: counts.sessionIds.size,
            present: counts.present,
            absent: counts.absent,
            late: counts.late,
            excused: counts.excused,
            attendance: percentText(attendancePercent(counts)),
          }));
        result = {
          title: `Attendance summary & trends — ${classValue === ALL_CLASSES ? 'All assigned classes' : selectedClass.name}`,
          subtitle: `${school?.name || 'ClassPulse'} · ${moment(from).format('D MMM YYYY')} to ${moment(to).format('D MMM YYYY')}`,
          info: [
            `Days with recorded attendance: ${rows.length}`,
            `Classes included: ${chosenClasses.length}`,
            `Students marked: ${rows.reduce((total, row) => total + row.present + row.absent + row.late + row.excused, 0)}`,
          ],
          headers: ['#', 'Date', 'Sessions', 'Present', 'Absent', 'Late', 'Excused', 'Attendance %'],
          rows,
          exportRows: rows.map((row) => [row.number, row.date, row.sessions, row.present, row.absent, row.late, row.excused, row.attendance]),
          truncated: homerooms.truncated || subjects.truncated,
          type: reportType,
        };
      }
      setReport(result);
      notifySuccess('Report ready', `${result.rows.length} row(s) in the preview.`);
    } catch (error) {
      notifyError('Could not build report', error.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, school?.name, reportType, selectedClass, classValue, classes, studentId, studentOptions, from, to, dailyDate]);

  const exportCsv = () => {
    if (!report) return;
    downloadFile(`classpulse-${report.type}-${moment().format('YYYY-MM-DD')}.csv`, toCSV(report.headers, report.exportRows));
    notifySuccess('CSV ready', 'The report was downloaded.');
  };

  const exportExcel = () => {
    if (!report) return;
    const worksheet = XLSX.utils.aoa_to_sheet([report.headers, ...report.exportRows]);
    worksheet['!cols'] = report.headers.map((header) => ({ wch: Math.max(12, Math.min(32, header.length + 4)) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance report');
    XLSX.writeFile(workbook, `classpulse-${report.type}-${moment().format('YYYY-MM-DD')}.xlsx`);
    notifySuccess('Excel ready', 'The report was downloaded.');
  };

  const exportPdf = () => {
    if (!report) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(15);
    doc.text(report.title, 14, 16);
    doc.setFontSize(9);
    doc.text(report.subtitle, 14, 22);
    report.info.forEach((line, index) => doc.text(line, 14, 29 + index * 5));
    const startY = 34 + report.info.length * 5;
    const pageWidth = doc.internal.pageSize.getWidth() - 28;
    const columnWidth = pageWidth / report.headers.length;
    const drawHeader = (y) => {
      doc.setFont(undefined, 'bold');
      doc.setFontSize(7);
      report.headers.forEach((header, index) => doc.text(String(header).slice(0, 20), 14 + index * columnWidth, y));
      doc.setFont(undefined, 'normal');
      doc.setFontSize(7);
    };
    drawHeader(startY);
    let y = startY + 6;
    report.exportRows.forEach((row) => {
      if (y > 190) {
        doc.addPage();
        y = 16;
        drawHeader(y);
        y += 6;
      }
      row.forEach((value, index) => {
        doc.text(String(value ?? '—').slice(0, index === 1 ? 32 : 20), 14 + index * columnWidth, y);
      });
      y += 6;
    });
    doc.save(`classpulse-${report.type}-${moment().format('YYYY-MM-DD')}.pdf`);
    notifySuccess('PDF ready', 'The report was downloaded.');
  };

  const classSelectValue = reportType === 'summary' && classValue === ALL_CLASSES ? ALL_CLASSES : classValue;
  const buildDisabled = loading || classesLoading || !classes.length
    || (reportType !== 'summary' && !selectedClass)
    || (reportType === 'student' && (studentLoading || !studentId));

  return (
    <AppShell title="Reports">
      <div className="space-y-4">
        <header className="border-b border-border pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">Reports &amp; exports</p>
          <h1 className="mt-1 font-heading text-2xl font-semibold sm:text-3xl">Build a report</h1>
          <p className="mt-1 text-sm text-muted-foreground">Preview exactly what will be exported, then download it as CSV, Excel or PDF — or print a clean copy.</p>
        </header>

        <div className="flex flex-wrap gap-1 rounded-xl bg-muted/80 p-1" role="tablist" aria-label="Report type">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={reportType === tab.id}
              onClick={() => changeTab(tab.id)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition sm:text-sm ${reportType === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(reportType !== 'student' || classes.length > 0) && (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {reportType === 'student' ? 'Student' : reportType === 'summary' ? 'Class' : 'Class'}
                </label>
                {reportType === 'student' ? (
                  <Select value={studentId} onValueChange={setStudentId} disabled={studentLoading || !studentOptions.length}>
                    <SelectTrigger><SelectValue placeholder={studentLoading ? 'Loading students…' : 'Choose student'} /></SelectTrigger>
                    <SelectContent>
                      {studentOptions.map((student) => (
                        <SelectItem key={student.id} value={student.id}>{student.name}{student.studentId ? ` · ${student.studentId}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={classSelectValue}
                    onValueChange={(value) => { setClassValue(value); setReport(null); }}
                    disabled={classesLoading || !classes.length}
                  >
                    <SelectTrigger><SelectValue placeholder={classesLoading ? 'Loading classes…' : 'Choose class'} /></SelectTrigger>
                    <SelectContent>
                      {reportType === 'summary' && <SelectItem value={ALL_CLASSES}>All assigned classes</SelectItem>}
                      {classes.map((item) => (
                        <SelectItem key={item.key} value={item.key}>{item.name}{item.type === 'subject' ? ` · ${item.subject || 'Subject'}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            {reportType === 'daily' ? (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="daily-report-date">Date</label>
                <Input id="daily-report-date" type="date" value={dailyDate} onChange={(event) => setDailyDate(event.target.value)} />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="report-from">From</label>
                  <Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="report-to">To</label>
                  <Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!report}><Download className="mr-1.5 h-3.5 w-3.5" />CSV</Button>
            <Button size="sm" variant="outline" onClick={exportExcel} disabled={!report}><Download className="mr-1.5 h-3.5 w-3.5" />Excel</Button>
            <Button size="sm" variant="outline" onClick={exportPdf} disabled={!report}><FileText className="mr-1.5 h-3.5 w-3.5" />PDF</Button>
            <Button size="sm" variant="outline" onClick={() => window.print()} disabled={!report}><Printer className="mr-1.5 h-3.5 w-3.5" />Print</Button>
            <Button size="sm" onClick={buildReport} disabled={buildDisabled}>{loading ? 'Building…' : 'Build report'}</Button>
          </div>
        </section>

        {isTeacher && (
          <p className="text-xs text-muted-foreground">Reports are limited to classes assigned to you.</p>
        )}

        {report ? (
          <section className="cp-card overflow-hidden print:border-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <h2 className="font-heading text-base font-semibold">{report.title}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{report.subtitle}</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">{report.rows.length} rows</span>
            </div>
            <div className="border-b border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
              {report.info.map((line) => <p key={line}>{line}</p>)}
              {report.truncated && <p className="mt-1 text-amber-700 dark:text-amber-300">Results reached the local report limit. Narrow the date range to view a complete report.</p>}
            </div>
            <div className="cp-scroll-x">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="cp-table-head">
                  <tr>{report.headers.map((header) => <th key={header} className="px-3 py-2.5">{header}</th>)}</tr>
                </thead>
                <tbody>
                  {report.rows.map((row, index) => (
                    <tr key={`${row.registration || row.student || row.date || row.className}-${index}`} className="border-t border-border/70">
                      {report.type === 'student' ? (
                        <>
                          <td className="px-3 py-2.5 text-muted-foreground">{row.number}</td>
                          <td className="px-3 py-2.5 font-medium">{row.className}</td>
                          <td className="px-3 py-2.5 capitalize">{row.type}</td>
                          <td className="px-3 py-2.5">{row.sessions}</td>
                          <td className="px-3 py-2.5">{row.present}</td>
                          <td className="px-3 py-2.5">{row.absent}</td>
                          <td className="px-3 py-2.5">{row.late}</td>
                          <td className="px-3 py-2.5">{row.excused}</td>
                          <td className="px-3 py-2.5">{row.attendance}</td>
                        </>
                      ) : report.type === 'summary' ? (
                        <>
                          <td className="px-3 py-2.5 text-muted-foreground">{row.number}</td>
                          <td className="px-3 py-2.5 font-medium">{row.date}</td>
                          <td className="px-3 py-2.5">{row.sessions}</td>
                          <td className="px-3 py-2.5">{row.present}</td>
                          <td className="px-3 py-2.5">{row.absent}</td>
                          <td className="px-3 py-2.5">{row.late}</td>
                          <td className="px-3 py-2.5">{row.excused}</td>
                          <td className="px-3 py-2.5">{row.attendance}</td>
                        </>
                      ) : report.type === 'daily' ? (
                        <>
                          <td className="px-3 py-2.5 text-muted-foreground">{row.number}</td>
                          <td className="px-3 py-2.5 font-medium">{row.student}</td>
                          <td className="px-3 py-2.5 font-mono text-xs">{row.registration || '—'}</td>
                          <td className="px-3 py-2.5 capitalize">{row.present}</td>
                          <td className="px-3 py-2.5">{row.note || '—'}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2.5 text-muted-foreground">{row.number}</td>
                          <td className="px-3 py-2.5 font-medium">{row.student}</td>
                          <td className="px-3 py-2.5 font-mono text-xs">{row.registration || '—'}</td>
                          <td className="px-3 py-2.5">{row.sessions}</td>
                          <td className="px-3 py-2.5">{row.present}</td>
                          <td className="px-3 py-2.5">{row.absent}</td>
                          <td className="px-3 py-2.5">{row.late}</td>
                          <td className="px-3 py-2.5">{row.excused}</td>
                          <td className="px-3 py-2.5">{row.attendance}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  {report.rows.length === 0 && (
                    <tr><td className="px-4 py-8 text-center text-sm text-muted-foreground" colSpan={report.headers.length}>No records found for this selection and date range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="cp-card px-4 py-12 text-center text-sm text-muted-foreground">
            Choose the report options, then select <strong className="text-foreground">Build report</strong> to preview the real attendance records.
          </section>
        )}
      </div>
    </AppShell>
  );
}
