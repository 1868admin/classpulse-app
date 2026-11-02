import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { getActor, isStaff, toList, audit } from '../../shared/auth.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user, member } = await getActor(base44);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!member) return Response.json({ error: 'No school membership' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const schoolId = member.school_id;
    const entries = Array.isArray(body.entries) ? body.entries.slice(0, 300) : [];
    if (!entries.length) return Response.json({ error: 'No timetable entries supplied' }, { status: 400 });

    const svc = base44.asServiceRole;
    let targetMemberId = member.id;
    if (body.member_id && isStaff(member)) targetMemberId = body.member_id;
    const target = targetMemberId === member.id
      ? member
      : await svc.entities.SchoolMember.get(targetMemberId).catch(() => null);
    if (!target || target.school_id !== schoolId) return Response.json({ error: 'Teacher not found' }, { status: 404 });

    const academicYear = toList(await svc.entities.AcademicYear.filter({ school_id: schoolId, is_current: true }, { limit: 1 }))[0] || null;

    const problems = [];
    const seen = new Set();
    const rows = [];
    entries.forEach((e, idx) => {
      const line = idx + 1;
      if (!e.day_name) { problems.push(`Row ${line}: missing timetable day`); return; }
      if (!Number(e.period_number)) { problems.push(`Row ${line}: missing period number`); return; }
      const key = `${e.day_name}|${e.period_number}`;
      if (seen.has(key)) { problems.push(`Row ${line}: duplicate ${e.day_name} period ${e.period_number}`); return; }
      seen.add(key);
      if (e.start_time && e.end_time && e.start_time >= e.end_time) {
        problems.push(`Row ${line}: start time must be before end time`);
        return;
      }
      rows.push({
        school_id: schoolId,
        member_id: target.id,
        user_id: target.user_id || '',
        academic_year_id: academicYear?.id || '',
        day_name: e.day_name,
        period_number: Number(e.period_number),
        start_time: e.start_time || '',
        end_time: e.end_time || '',
        subject: e.subject || '',
        class_name: e.class_name || '',
        subject_class_id: e.subject_class_id || '',
        homeroom_id: e.homeroom_id || '',
        room: e.room || '',
        notes: e.notes || '',
        archived: false,
      });
    });

    if (!rows.length) return Response.json({ error: 'No valid entries', problems }, { status: 400 });

    let archived = 0;
    if (body.mode === 'replace') {
      const existing = toList(await svc.entities.TimetableEntry.filter({ school_id: schoolId, member_id: target.id, archived: false }, { limit: 500 }));
      for (const e of existing) {
        await svc.entities.TimetableEntry.update(e.id, { archived: true });
        archived += 1;
      }
    }

    const created = await svc.entities.TimetableEntry.bulkCreate(rows);

    await audit(base44, {
      schoolId, user, action: 'timetable.saved', entityType: 'TimetableEntry',
      summary: `Saved ${created.length} timetable entries for ${target.full_name}${archived ? ` (${archived} previous archived)` : ''}${problems.length ? ` · ${problems.length} row problem(s)` : ''}`,
    });

    return Response.json({ saved: created.length, archived, problems });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}