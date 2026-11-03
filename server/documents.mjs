import { createHash } from 'node:crypto';
import { jsPDF } from 'jspdf';
import { zipSync, strToU8 } from 'fflate';
import { createRecord, getRecord, getRecords } from './database.mjs';

const isStaff = (member) => member && ['school_admin', 'it_admin'].includes(member.role);
const BRAND = [30, 64, 175];
const INK = [17, 24, 39];
const MUTED = [100, 116, 139];
const LINE = [203, 213, 225];
const STRIPE = [241, 245, 249];
const DRAFT = [180, 83, 9];
const MAX_BUNDLE_ITEMS = 1000;
const MAX_CELL_LINES = 14;

export const TEACHER_KINDS = ['teacher_timetable', 'teacher_supervision'];
export const DOCUMENT_KINDS = [
  'master_timetable', 'teacher_timetable', 'class_timetable', 'room_timetable',
  'examination_timetable', 'teacher_supervision', 'invigilation_schedule',
];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status, expose: true });
}

function requireDocumentActor(actor) {
  if (!actor) fail('Authentication required', 401);
  const member = actor.member;
  if (!member || member.status !== 'active' || !actor.schoolId) fail('You are not attached to an active school account', 403);
  if (!isStaff(member) && member.role !== 'teacher') fail('You do not have access to documents', 403);
  return member;
}

const forSchool = (entity, schoolId) => getRecords(entity).filter((item) => item.school_id === schoolId);
const text = (value) => String(value ?? '').trim();
const byText = (a, b) => text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });

function academicYearFor(schoolId, yearId) {
  const years = forSchool('AcademicYear', schoolId);
  const year = yearId
    ? years.find((item) => item.id === yearId)
    : years.find((item) => item.is_current) || years[0];
  if (!year) fail(yearId ? 'Academic year not found' : 'No academic year has been set up', 404);
  return { year, currentId: years.find((item) => item.is_current)?.id || '' };
}

function lessonEntries(schoolId, year, currentId, scope) {
  return forSchool('TimetableEntry', schoolId).filter((entry) => {
    if (entry.archived) return false;
    if (scope !== 'all' && entry.published === false) return false;
    return (entry.academic_year_id || currentId) === year.id;
  });
}

function examinations(schoolId, year, scope) {
  return forSchool('ExaminationTimetableEntry', schoolId).filter((exam) => exam.academic_year_id === year.id
    && (scope === 'all' ? exam.status !== 'archived' : exam.status === 'published'));
}

function assignmentsFor(schoolId, year, scope, exams) {
  const examIds = new Set(exams.map((exam) => exam.id));
  return forSchool('InvigilationAssignment', schoolId).filter((assignment) => assignment.academic_year_id === year.id
    && examIds.has(assignment.examination_id)
    && (scope === 'all' ? ['draft', 'published'].includes(assignment.status) : assignment.status === 'published'));
}

function versionOf(records) {
  const hash = createHash('sha1');
  const rows = records.map((item) => `${item.id}:${item.updated_date || item.created_date || ''}`).sort();
  for (const row of rows) hash.update(row);
  const latest = records.reduce((max, item) => {
    const stamp = String(item.updated_date || item.created_date || '');
    return stamp > max ? stamp : max;
  }, '');
  return `${latest ? latest.slice(0, 10) : 'n/a'} · rev ${hash.digest('hex').slice(0, 8)} · ${records.length} record${records.length === 1 ? '' : 's'}`;
}

// jsPDF's built-in fonts only cover WinAnsi; replace anything else to avoid garbled output.
function printable(value) {
  return String(value ?? '')
    .replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/\u00a0/g, ' ')
    .replace(/[^\n\t\x20-\x7e\u00a1-\u00ff]/g, '?');
}

function wrapText(doc, value, width) {
  const lines = [];
  for (const paragraph of printable(value).split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let piece = word;
      while (doc.getTextWidth(piece) > width && piece.length > 1) {
        let cut = piece.length - 1;
        while (cut > 1 && doc.getTextWidth(piece.slice(0, cut)) > width) cut -= 1;
        if (current) { lines.push(current); current = ''; }
        lines.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      const candidate = current ? `${current} ${piece}` : piece;
      if (current && doc.getTextWidth(candidate) > width) {
        lines.push(current);
        current = piece;
      } else current = candidate;
    }
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

function createPdf({ school, year, title, subtitle, version, orientation = 'landscape', draft = false }) {
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({ title: printable(`${title} - ${year.name}`), author: printable(school.name), creator: 'ClassPulse' });
  const page = { width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight() };
  const margin = 34;
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const ctx = {
    doc, page, margin, y: 0, contentBottom: page.height - 40,
    generated, version, draft, title,
    drawHeader() {
      doc.setFillColor(...BRAND);
      doc.rect(0, 0, page.width, 8, 'F');
      doc.setTextColor(...BRAND);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      const nameLines = wrapText(doc, school.name, page.width - margin * 2 - 150).slice(0, 2);
      doc.text(nameLines, margin, 32);
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text('ClassPulse', page.width - margin, 28, { align: 'right' });
      doc.text(printable(`Academic year ${year.name}`), page.width - margin, 40, { align: 'right' });
      let y = 32 + (nameLines.length - 1) * 17 + 18;
      doc.setTextColor(...INK);
      doc.setFontSize(13);
      doc.text(wrapText(doc, title, page.width - margin * 2).slice(0, 2), margin, y);
      y += 14;
      if (subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...MUTED);
        const subtitleLines = wrapText(doc, subtitle, page.width - margin * 2).slice(0, 3);
        doc.text(subtitleLines, margin, y);
        y += subtitleLines.length * 11;
      }
      if (draft) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...DRAFT);
        doc.text('DRAFT - NOT PUBLISHED. Do not distribute.', margin, y);
        y += 11;
      }
      doc.setDrawColor(...LINE);
      doc.line(margin, y, page.width - margin, y);
      ctx.y = y + 8;
    },
    newPage() { doc.addPage(); ctx.drawHeader(); },
  };
  ctx.drawHeader();
  ctx.finish = () => {
    const total = doc.getNumberOfPages();
    for (let number = 1; number <= total; number += 1) {
      doc.setPage(number);
      doc.setDrawColor(...LINE);
      doc.line(margin, page.height - 30, page.width - margin, page.height - 30);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(printable(`Generated ${generated} UTC  |  Schedule version: ${version}`), margin, page.height - 19);
      doc.text(`Page ${number} of ${total}`, page.width - margin, page.height - 19, { align: 'right' });
    }
    return Buffer.from(doc.output('arraybuffer'));
  };
  return ctx;
}

function drawTable(ctx, { columns, rows, emptyMessage = 'Nothing is scheduled.', fontSize = 8, onNewPage }) {
  const { doc, margin, page } = ctx;
  const total = columns.reduce((sum, column) => sum + column.weight, 0);
  const available = page.width - margin * 2;
  const widths = columns.map((column) => (column.weight / total) * available);
  const pad = 4;
  const lineHeight = fontSize + 2.5;

  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    const wrapped = columns.map((column, index) => wrapText(doc, column.header, widths[index] - pad * 2));
    const height = Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + pad * 2;
    if (ctx.y + height > ctx.contentBottom) { ctx.newPage(); onNewPage?.(); }
    doc.setFillColor(...BRAND);
    doc.rect(margin, ctx.y, available, height, 'F');
    doc.setTextColor(255, 255, 255);
    let x = margin;
    wrapped.forEach((lines, index) => {
      doc.text(lines, x + pad, ctx.y + pad + fontSize, { baseline: 'alphabetic' });
      x += widths[index];
    });
    ctx.y += height;
  };

  header();
  if (!rows.length) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...MUTED);
    doc.text(printable(emptyMessage), margin + pad, ctx.y + 16);
    ctx.y += 26;
    return;
  }
  rows.forEach((row, rowIndex) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    const maxLines = MAX_CELL_LINES;
    const cells = row.map((cell, index) => {
      const lines = wrapText(doc, cell?.text ?? cell, widths[index] - pad * 2);
      return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), '...'] : lines;
    });
    const height = Math.max(...cells.map((lines) => lines.length)) * lineHeight + pad * 2;
    if (ctx.y + height > ctx.contentBottom) {
      ctx.newPage();
      onNewPage?.();
      header();
    }
    if (rowIndex % 2 === 1) {
      doc.setFillColor(...STRIPE);
      doc.rect(margin, ctx.y, available, height, 'F');
    }
    doc.setDrawColor(...LINE);
    doc.rect(margin, ctx.y, available, height, 'S');
    let x = margin;
    cells.forEach((lines, index) => {
      if (index > 0) doc.line(x, ctx.y, x, ctx.y + height);
      doc.setFont('helvetica', row[index]?.bold ? 'bold' : 'normal');
      doc.setTextColor(...INK);
      doc.text(lines, x + pad, ctx.y + pad + fontSize);
      x += widths[index];
    });
    ctx.y += height;
  });
}

function sortedDays(school, entries) {
  const days = Array.isArray(school.day_names) && school.day_names.length ? [...school.day_names] : [];
  for (const entry of entries) if (entry.day_name && !days.includes(entry.day_name)) days.push(entry.day_name);
  return days;
}

function periodList(school, entries) {
  const periods = new Map();
  for (const period of school.periods || []) periods.set(Number(period.number), { number: Number(period.number), start: period.start, end: period.end });
  for (const entry of entries) {
    const number = Number(entry.period_number);
    if (!periods.has(number)) periods.set(number, { number, start: entry.start_time, end: entry.end_time });
  }
  return [...periods.values()].sort((a, b) => a.number - b.number);
}

const periodLabel = (period) => `Period ${period.number}${period.start && period.end ? `\n${period.start}-${period.end}` : ''}`;

function lessonCell(entry, show) {
  return [entry.subject, show.includes('class') && entry.class_name, show.includes('teacher') && entry.teacherName, show.includes('room') && entry.room && `Room ${entry.room}`]
    .filter(Boolean).join('\n');
}

function gridTimetable(ctx, school, entries, show) {
  const days = sortedDays(school, entries);
  const periods = periodList(school, entries);
  const rows = periods.map((period) => [
    { text: periodLabel(period), bold: true },
    ...days.map((day) => entries
      .filter((entry) => entry.day_name === day && Number(entry.period_number) === period.number)
      .sort((a, b) => byText(a.class_name, b.class_name))
      .map((entry) => lessonCell(entry, show)).join('\n---\n')),
  ]);
  drawTable(ctx, {
    columns: [{ header: 'Period', weight: 0.9 }, ...days.map((day) => ({ header: day, weight: 2 }))],
    rows,
    emptyMessage: 'No lessons are scheduled.',
    fontSize: 8.5,
  });
}

function masterTimetable(ctx, school, entries) {
  const periods = periodList(school, entries);
  const days = sortedDays(school, entries);
  const teachers = [...new Set(entries.map((entry) => entry.teacherName || 'Unassigned'))].sort(byText);
  if (!entries.length) {
    drawTable(ctx, { columns: [{ header: 'Teacher', weight: 1 }], rows: [], emptyMessage: 'No lessons are scheduled.' });
    return;
  }
  days.forEach((day, index) => {
    if (index > 0) ctx.newPage();
    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setFontSize(11);
    ctx.doc.setTextColor(...BRAND);
    ctx.doc.text(printable(day), ctx.margin, ctx.y + 12);
    ctx.y += 18;
    const rows = teachers.map((teacher) => [
      { text: teacher, bold: true },
      ...periods.map((period) => entries
        .filter((entry) => entry.day_name === day && Number(entry.period_number) === period.number
          && (entry.teacherName || 'Unassigned') === teacher)
        .map((entry) => [entry.subject, entry.class_name, entry.room && `Rm ${entry.room}`].filter(Boolean).join(' | '))
        .join('\n')),
    ]);
    drawTable(ctx, {
      columns: [{ header: 'Teacher', weight: 1.6 }, ...periods.map((period) => ({ header: periodLabel(period), weight: 1.4 }))],
      rows,
      fontSize: periods.length > 8 ? 6.5 : 7.5,
      onNewPage: () => {
        ctx.doc.setFont('helvetica', 'bold');
        ctx.doc.setFontSize(9);
        ctx.doc.setTextColor(...MUTED);
        ctx.doc.text(printable(`${day} (continued)`), ctx.margin, ctx.y + 9);
        ctx.y += 14;
      },
    });
  });
}

function examRows(exams) {
  return [...exams].sort((a, b) => byText(`${a.exam_date} ${a.start_time}`, `${b.exam_date} ${b.start_time}`) || byText(a.class_name, b.class_name))
    .map((exam) => [exam.exam_date, `${exam.start_time}-${exam.end_time}`, exam.exam_name, exam.subject, exam.class_name, exam.room, exam.notes || '']);
}

function memberName(memberId) {
  return text(getRecord('SchoolMember', memberId)?.full_name) || 'Unknown teacher';
}

const slug = (value) => text(value).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'document';

function assertTeacher(schoolId, teacherId) {
  const teacher = getRecord('SchoolMember', teacherId);
  if (!teacher || teacher.school_id !== schoolId || teacher.role !== 'teacher') fail('Teacher not found', 404);
  return teacher;
}

export function renderDocument(actor, request) {
  const member = requireDocumentActor(actor);
  const staff = isStaff(member);
  const kind = text(request.kind);
  if (!DOCUMENT_KINDS.includes(kind)) fail('Unknown document type');
  let teacherId = text(request.teacher_id);
  if (!staff) {
    if (!TEACHER_KINDS.includes(kind)) fail('You do not have access to this document', 403);
    if (teacherId && teacherId !== member.id) fail('You do not have access to this document', 403);
    teacherId = member.id;
  }
  const scope = staff && request.scope === 'all' ? 'all' : 'published';
  const schoolId = actor.schoolId;
  const school = getRecord('School', schoolId);
  if (!school) fail('School not found', 404);
  const { year, currentId } = academicYearFor(schoolId, text(request.academic_year_id));

  const exams = examinations(schoolId, year, scope);
  const teacherNames = new Map(forSchool('SchoolMember', schoolId).map((item) => [item.id, item.full_name]));
  const base = { school, year };
  let result;

  if (['master_timetable', 'teacher_timetable', 'class_timetable', 'room_timetable'].includes(kind)) {
    let entries = lessonEntries(schoolId, year, currentId, scope)
      .map((entry) => ({ ...entry, teacherName: teacherNames.get(entry.member_id) || '' }));
    let title = 'Master Timetable';
    let subtitle = 'All teachers, by day and period';
    let name = 'master-timetable';
    let show = [];
    if (kind === 'teacher_timetable') {
      const teacher = assertTeacher(schoolId, teacherId);
      entries = entries.filter((entry) => entry.member_id === teacher.id);
      title = `Teacher Timetable: ${teacher.full_name}`;
      subtitle = 'Weekly lesson timetable';
      name = `teacher-timetable-${slug(teacher.full_name)}`;
      show = ['class', 'room'];
    } else if (kind === 'class_timetable') {
      const className = text(request.class_name);
      if (!className) fail('Choose a class');
      entries = entries.filter((entry) => text(entry.class_name) === className);
      title = `Class Timetable: ${className}`;
      subtitle = 'Weekly lesson timetable';
      name = `class-timetable-${slug(className)}`;
      show = ['teacher', 'room'];
    } else if (kind === 'room_timetable') {
      const room = text(request.room);
      if (!room) fail('Choose a room');
      entries = entries.filter((entry) => text(entry.room) === room);
      title = `Room Timetable: ${room}`;
      subtitle = 'Weekly room usage';
      name = `room-timetable-${slug(room)}`;
      show = ['class', 'teacher'];
    }
    if (!staff && !entries.length) fail('No published timetable is available for you yet', 404);
    const ctx = createPdf({
      ...base, title, subtitle, version: versionOf(entries), draft: scope === 'all' && entries.some((entry) => entry.published === false),
    });
    if (kind === 'master_timetable') masterTimetable(ctx, school, entries);
    else gridTimetable(ctx, school, entries, show);
    result = { ctx, name, count: entries.length };
  } else if (kind === 'examination_timetable') {
    const className = text(request.class_name);
    const selected = className ? exams.filter((exam) => text(exam.class_name) === className) : exams;
    const ctx = createPdf({
      ...base, title: className ? `Examination Timetable: ${className}` : 'Examination Timetable',
      subtitle: 'Examinations by date and time', version: versionOf(selected), draft: scope === 'all' && selected.some((exam) => exam.status !== 'published'),
    });
    drawTable(ctx, {
      columns: ['Date', 'Time', 'Examination', 'Subject', 'Class', 'Room', 'Notes'].map((header, index) => ({ header, weight: [1, 1, 2, 1.6, 1.6, 1.2, 2][index] })),
      rows: examRows(selected),
      emptyMessage: 'No examinations are scheduled.',
    });
    result = { ctx, name: `examination-timetable${className ? `-${slug(className)}` : ''}`, count: selected.length };
  } else if (kind === 'teacher_supervision') {
    const teacher = assertTeacher(schoolId, teacherId);
    const assignments = assignmentsFor(schoolId, year, scope, exams).filter((item) => item.teacher_member_id === teacher.id);
    if (!staff && !assignments.length) fail('No published supervision schedule is available for you yet', 404);
    const ctx = createPdf({
      ...base, title: `Supervision Schedule: ${teacher.full_name}`, subtitle: 'Examination invigilation duties',
      version: versionOf(assignments), draft: scope === 'all' && assignments.some((item) => item.status !== 'published'),
    });
    drawTable(ctx, {
      columns: ['Date', 'Time', 'Examination', 'Subject', 'Room', 'Role'].map((header, index) => ({ header, weight: [1, 1, 2, 1.6, 1.4, 1.2][index] })),
      rows: [...assignments].sort((a, b) => byText(`${a.exam_date} ${a.start_time}`, `${b.exam_date} ${b.start_time}`))
        .map((item) => [item.exam_date, `${item.start_time}-${item.end_time}`, item.exam_name, item.subject, item.room, item.role === 'chief' ? 'Chief supervisor' : 'Assistant supervisor']),
      emptyMessage: 'No supervision duties are assigned.',
    });
    result = { ctx, name: `supervision-schedule-${slug(teacher.full_name)}`, count: assignments.length };
  } else {
    const assignments = assignmentsFor(schoolId, year, scope, exams);
    const grouped = new Map();
    for (const assignment of assignments) {
      const list = grouped.get(assignment.examination_id) || [];
      list.push(assignment);
      grouped.set(assignment.examination_id, list);
    }
    const rows = exams.filter((exam) => grouped.has(exam.id))
      .sort((a, b) => byText(`${a.exam_date} ${a.start_time} ${a.room}`, `${b.exam_date} ${b.start_time} ${b.room}`))
      .map((exam) => {
        const people = grouped.get(exam.id)
          .sort((a, b) => (a.role === b.role ? byText(a.teacher_name, b.teacher_name) : a.role === 'chief' ? -1 : 1))
          .map((item) => `${teacherNames.get(item.teacher_member_id) || item.teacher_name}${item.role === 'chief' ? ' (Chief)' : ''}${item.status === 'draft' ? ' [draft]' : ''}`);
        return [exam.exam_date, `${exam.start_time}-${exam.end_time}`, exam.exam_name, exam.subject, exam.room, people.join('\n')];
      });
    const ctx = createPdf({
      ...base, title: 'Invigilation Schedule', subtitle: 'Supervisors for every examination',
      version: versionOf(assignments), draft: scope === 'all' && assignments.some((item) => item.status !== 'published'),
    });
    drawTable(ctx, {
      columns: ['Date', 'Time', 'Examination', 'Subject', 'Room', 'Supervisors'].map((header, index) => ({ header, weight: [1, 1, 2, 1.6, 1.3, 3][index] })),
      rows,
      emptyMessage: 'No supervision duties are assigned.',
    });
    result = { ctx, name: 'invigilation-schedule', count: assignments.length };
  }

  return {
    filename: `classpulse-${result.name}-${slug(year.name)}.pdf`,
    buffer: result.ctx.finish(),
    count: result.count,
    schoolId,
  };
}

function auditDownload(actor, summary) {
  createRecord('AuditLog', {
    school_id: actor.schoolId,
    actor_name: actor.user.full_name || actor.user.username,
    actor_email: actor.user.email || '',
    action: 'document_download',
    entity_type: 'Document',
    entity_id: '',
    summary,
  });
}

export function downloadDocument(actor, request, { preview = false } = {}) {
  const document = renderDocument(actor, request);
  if (!preview && isStaff(actor.member)) auditDownload(actor, `Downloaded ${document.filename}`);
  return document;
}

export function renderBundle(actor, request) {
  const member = requireDocumentActor(actor);
  if (!isStaff(member)) fail('Only administrators can download document bundles', 403);
  const items = Array.isArray(request.items) ? request.items : [];
  if (!items.length) fail('Select at least one document');
  if (items.length > MAX_BUNDLE_ITEMS) fail(`A bundle can contain at most ${MAX_BUNDLE_ITEMS} documents`);
  const files = {};
  const manifest = [];
  const used = new Set();
  for (const item of items) {
    const params = { ...item, academic_year_id: request.academic_year_id, scope: request.scope };
    let document;
    try {
      document = renderDocument(actor, params);
    } catch (error) {
      if (error.status && error.status < 500) { manifest.push(`FAILED  ${item.kind}: ${error.message}`); continue; }
      throw error;
    }
    if (!document.count && request.skip_empty !== false) { manifest.push(`SKIPPED ${document.filename}: nothing scheduled`); continue; }
    let filename = document.filename;
    for (let n = 2; used.has(filename); n += 1) filename = document.filename.replace(/\.pdf$/, `-${n}.pdf`);
    used.add(filename);
    files[filename] = document.buffer;
    manifest.push(`OK      ${filename} (${document.count} entries)`);
  }
  if (!Object.keys(files).length) fail('None of the selected documents contain any scheduled entries', 404);
  const school = getRecord('School', actor.schoolId);
  const header = `ClassPulse document bundle\n${school?.name || ''}\nGenerated ${new Date().toISOString()}\n\n`;
  const entries = { ...files, 'manifest.txt': strToU8(`${header}${manifest.join('\n')}\n`) };
  const buffer = Buffer.from(zipSync(entries, { level: 0 }));
  auditDownload(actor, `Downloaded ZIP bundle with ${Object.keys(files).length} document(s)`);
  return { filename: `classpulse-documents-${new Date().toISOString().slice(0, 10)}.zip`, buffer, count: Object.keys(files).length };
}

export function documentCatalog(actor, yearId) {
  const member = requireDocumentActor(actor);
  const staff = isStaff(member);
  const schoolId = actor.schoolId;
  const years = forSchool('AcademicYear', schoolId).sort((a, b) => byText(b.name, a.name));
  const { year, currentId } = academicYearFor(schoolId, text(yearId));
  const lessonCounts = (scope) => {
    const counts = new Map();
    for (const entry of lessonEntries(schoolId, year, currentId, scope)) counts.set(entry.member_id, (counts.get(entry.member_id) || 0) + 1);
    return counts;
  };
  const published = lessonCounts('published');
  const exams = examinations(schoolId, year, 'published');
  const supervision = new Map();
  for (const assignment of assignmentsFor(schoolId, year, 'published', exams)) {
    supervision.set(assignment.teacher_member_id, (supervision.get(assignment.teacher_member_id) || 0) + 1);
  }
  const academic_years = years.map((item) => ({ id: item.id, name: item.name, is_current: Boolean(item.is_current) }));
  if (!staff) {
    return {
      academic_years, academic_year_id: year.id,
      own: { timetable: published.get(member.id) || 0, supervision: supervision.get(member.id) || 0 },
    };
  }
  const all = lessonCounts('all');
  const allEntries = lessonEntries(schoolId, year, currentId, 'all');
  const allExams = examinations(schoolId, year, 'all');
  return {
    academic_years, academic_year_id: year.id,
    teachers: forSchool('SchoolMember', schoolId).filter((item) => item.role === 'teacher' && item.status === 'active')
      .sort((a, b) => byText(a.full_name, b.full_name))
      .map((item) => ({
        id: item.id, name: item.full_name,
        published_lessons: published.get(item.id) || 0,
        total_lessons: all.get(item.id) || 0,
        supervision: supervision.get(item.id) || 0,
      })),
    classes: [...new Set(allEntries.map((entry) => text(entry.class_name)).filter(Boolean))].sort(byText),
    rooms: [...new Set(allEntries.map((entry) => text(entry.room)).filter(Boolean))].sort(byText),
    examinations: {
      published: allExams.filter((exam) => exam.status === 'published').length,
      draft: allExams.filter((exam) => exam.status === 'draft').length,
    },
    lessons: {
      published: allEntries.filter((entry) => entry.published !== false).length,
      total: allEntries.length,
    },
  };
}
